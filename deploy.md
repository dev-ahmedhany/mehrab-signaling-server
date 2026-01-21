Here's a step-by-step guide to deploy the signaling server and TURN server on separate VPS instances:

  Prerequisites

  1. Two VPS instances (DigitalOcean, Hetzner, AWS, etc.) with public IPs:
    - VPS 1: Signaling Server
    - VPS 2: TURN Server
  2. DNS records pointing to your VPS instances:
    - signal.ahmedhany.dev → Signaling Server VPS IP
    - turn.ahmedhany.dev → TURN Server VPS IP

  ---
  Step 1: Setup DNS Records

  In your domain registrar (Cloudflare, Namecheap, etc.), add these A records:

  Type: A    Name: signal    Value: SIGNALING_VPS_IP    TTL: Auto
  Type: A    Name: turn      Value: TURN_VPS_IP         TTL: Auto

  If using Cloudflare: Set proxy status to "DNS only" (gray cloud) for both records, especially for
  TURN.

  ═══════════════════════════════════════════════════════════════════════════════
  PART 1: SIGNALING SERVER DEPLOYMENT (VPS 1)
  ═══════════════════════════════════════════════════════════════════════════════

  ---
  Step 2: SSH into Signaling Server VPS

  ssh root@SIGNALING_VPS_IP

  ---
  Step 3: Install Dependencies (Signaling Server)

  # Update system
  apt update && apt upgrade -y

  # Install Docker
  curl -fsSL https://get.docker.com | sh

  # Install Docker Compose
  curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname
  -s)-$(uname -m)" -o /usr/local/bin/docker-compose
  chmod +x /usr/local/bin/docker-compose

  # Install Certbot and Nginx
  apt install -y certbot nginx git

  ---
  Step 4: Configure Firewall (Signaling Server)

  # Enable UFW
  ufw allow 22/tcp      # SSH
  ufw allow 80/tcp      # HTTP (for SSL cert)
  ufw allow 443/tcp     # HTTPS
  ufw --force enable

  ---
  Step 5: Get SSL Certificate (Signaling Server)

  # Stop nginx temporarily
  systemctl stop nginx

  # Get certificate for signaling domain only
  certbot certonly --standalone -d signal.ahmedhany.dev

  # Certificate saved to:
  # /etc/letsencrypt/live/signal.ahmedhany.dev/fullchain.pem
  # /etc/letsencrypt/live/signal.ahmedhany.dev/privkey.pem

  ---
  Step 6: Clone and Configure the Project (Signaling Server)

  # Clone your repository (or copy files)
  cd /opt
  git clone https://github.com/YOUR_USERNAME/mehrab.git
  cd mehrab/mehrab-signaling-server

  # Or if not using git, create the directory and copy files:
  # mkdir -p /opt/mehrab-signaling-server
  # cd /opt/mehrab-signaling-server
  # # Then copy all files from mehrab-signaling-server/

  ---
  Step 7: Create Environment File (Signaling Server)

  nano .env

  Add the following (replace with your actual values):

  # Server Configuration
  PORT=3000
  NODE_ENV=production

  # Firebase Configuration (from Firebase Console > Project Settings > Service Accounts)
  FIREBASE_PROJECT_ID=your-firebase-project-id
  FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
  FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_ACTUAL_PRIVATE_KEY_HERE\n-----END PRIVATE
  KEY-----\n"

  # TURN Server Configuration (points to the separate TURN server)
  TURN_SECRET=GENERATE_A_SECURE_RANDOM_STRING_MIN_32_CHARS
  TURN_DOMAIN=turn.ahmedhany.dev
  TURN_CREDENTIAL_TTL=3600

  # CORS Configuration
  CORS_ORIGIN=*

  Generate a secure TURN secret:
  openssl rand -hex 32

  IMPORTANT: Save this TURN_SECRET - you'll need the same value on the TURN server!

  ---
  Step 8: Configure Nginx Reverse Proxy (Signaling Server)

  nano /etc/nginx/sites-available/signal.ahmedhany.dev

  Add:

  server {
      listen 80;
      server_name signal.ahmedhany.dev;
      return 301 https://$server_name$request_uri;
  }

  server {
      listen 443 ssl http2;
      server_name signal.ahmedhany.dev;

      ssl_certificate /etc/letsencrypt/live/signal.ahmedhany.dev/fullchain.pem;
      ssl_certificate_key /etc/letsencrypt/live/signal.ahmedhany.dev/privkey.pem;

      ssl_protocols TLSv1.2 TLSv1.3;
      ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
      ssl_prefer_server_ciphers off;

      location / {
          proxy_pass http://127.0.0.1:3000;
          proxy_http_version 1.1;
          proxy_set_header Upgrade $http_upgrade;
          proxy_set_header Connection "upgrade";
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
          proxy_read_timeout 86400;
      }
  }

  Enable the site:

  ln -s /etc/nginx/sites-available/signal.ahmedhany.dev /etc/nginx/sites-enabled/
  nginx -t
  systemctl start nginx
  systemctl enable nginx

  ---
  Step 9: Deploy Signaling Server with Docker

  cd /opt/mehrab/mehrab-signaling-server

  # Build and start (only signaling server, no coturn)
  docker-compose up -d --build signaling-server

  # Check status
  docker-compose ps

  # View logs
  docker-compose logs -f signaling-server

  ---
  Step 10: Setup Auto-renewal for SSL (Signaling Server)

  crontab -e

  Add:

  0 0 1 * * certbot renew --quiet --post-hook "systemctl reload nginx"

  ---
  Step 11: Verify Signaling Server Deployment

  # Test health endpoint
  curl https://signal.ahmedhany.dev/health

  # Expected output:
  # {"status":"ok","timestamp":"...","stats":{"totalRooms":0,"totalParticipants":0}}

  ═══════════════════════════════════════════════════════════════════════════════
  PART 2: TURN SERVER DEPLOYMENT (VPS 2)
  ═══════════════════════════════════════════════════════════════════════════════

  ---
  Step 12: SSH into TURN Server VPS

  ssh root@TURN_VPS_IP

  ---
  Step 13: Install Dependencies (TURN Server)

  # Update system
  apt update && apt upgrade -y

  # Install Coturn and Certbot
  apt install -y coturn certbot

  ---
  Step 14: Configure Firewall (TURN Server)

  # Enable UFW
  ufw allow 22/tcp           # SSH
  ufw allow 80/tcp           # HTTP (for SSL cert)
  ufw allow 3478/udp         # TURN UDP
  ufw allow 3478/tcp         # TURN TCP
  ufw allow 5349/tcp         # TURN TLS
  ufw allow 49152:65535/udp  # TURN relay range
  ufw --force enable

  ---
  Step 15: Get SSL Certificate (TURN Server)

  # Get certificate for TURN domain
  certbot certonly --standalone -d turn.ahmedhany.dev

  # Certificate saved to:
  # /etc/letsencrypt/live/turn.ahmedhany.dev/fullchain.pem
  # /etc/letsencrypt/live/turn.ahmedhany.dev/privkey.pem

  ---
  Step 16: Configure Coturn

  nano /etc/turnserver.conf

  Add the following configuration:

  # Network settings
  listening-port=3478
  tls-listening-port=5349

  # YOUR TURN SERVER'S PUBLIC IP (required!)
  external-ip=TURN_VPS_PUBLIC_IP

  # Relay address range
  min-port=49152
  max-port=65535

  # Realm
  realm=ahmedhany.dev

  # Authentication (use SAME secret as signaling server!)
  use-auth-secret
  static-auth-secret=SAME_TURN_SECRET_AS_SIGNALING_SERVER

  # SSL Certificates
  cert=/etc/letsencrypt/live/turn.ahmedhany.dev/fullchain.pem
  pkey=/etc/letsencrypt/live/turn.ahmedhany.dev/privkey.pem

  # Logging
  log-file=/var/log/turnserver.log
  verbose

  # Security
  no-multicast-peers
  denied-peer-ip=10.0.0.0-10.255.255.255
  denied-peer-ip=172.16.0.0-172.31.255.255
  denied-peer-ip=192.168.0.0-192.168.255.255
  denied-peer-ip=127.0.0.0-127.255.255.255

  fingerprint
  lt-cred-mech
  user-quota=10
  stale-nonce=600
  no-cli

  Get your public IP:
  curl ifconfig.me

  ---
  Step 17: Enable and Start Coturn

  # Enable coturn service
  echo "TURNSERVER_ENABLED=1" >> /etc/default/coturn

  # Start coturn
  systemctl enable coturn
  systemctl start coturn

  # Check status
  systemctl status coturn

  # View logs
  tail -f /var/log/turnserver.log

  ---
  Step 18: Setup Auto-renewal for SSL (TURN Server)

  crontab -e

  Add:

  0 0 1 * * certbot renew --quiet --post-hook "systemctl restart coturn"

  ---
  Step 19: Verify TURN Server Deployment

  # Test TURN server
  apt install coturn-utils -y
  turnutils_uclient -T -u "test:user" -w "test" turn.ahmedhany.dev -p 3478

  # Or test from external using:
  # https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

  ═══════════════════════════════════════════════════════════════════════════════
  QUICK COMMANDS REFERENCE
  ═══════════════════════════════════════════════════════════════════════════════

  Signaling Server (VPS 1):
  ---
  # View logs
  docker-compose logs -f signaling-server

  # Restart service
  docker-compose restart signaling-server

  # Stop service
  docker-compose down

  # Update and redeploy
  cd /opt/mehrab/mehrab-signaling-server
  git pull
  docker-compose up -d --build signaling-server

  TURN Server (VPS 2):
  ---
  # View logs
  tail -f /var/log/turnserver.log

  # Restart service
  systemctl restart coturn

  # Stop service
  systemctl stop coturn

  # Check status
  systemctl status coturn

  ═══════════════════════════════════════════════════════════════════════════════
  TROUBLESHOOTING
  ═══════════════════════════════════════════════════════════════════════════════

  If signaling server health check fails:
  ---
  # Check if container is running
  docker-compose ps

  # Check signaling server logs
  docker-compose logs signaling-server

  # Check if port 3000 is listening
  netstat -tlnp | grep 3000

  # Check Nginx config
  nginx -t

  If TURN doesn't work:
  ---
  # Check Coturn logs
  tail -100 /var/log/turnserver.log

  # Verify external-ip is set correctly in /etc/turnserver.conf
  grep external-ip /etc/turnserver.conf

  # Verify firewall ports are open
  ufw status

  # Check if coturn is running
  systemctl status coturn

  # Test TURN connectivity from outside
  # Use https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

  If SSL issues on Signaling Server:
  ---
  # Check certificate
  openssl s_client -connect signal.ahmedhany.dev:443 -servername signal.ahmedhany.dev

  # Check Nginx config
  nginx -t

  If SSL issues on TURN Server:
  ---
  # Check certificate
  openssl s_client -connect turn.ahmedhany.dev:5349 -servername turn.ahmedhany.dev

  # Verify certificate paths in /etc/turnserver.conf
  grep -E "cert=|pkey=" /etc/turnserver.conf

  ═══════════════════════════════════════════════════════════════════════════════
  FINAL CHECKLIST
  ═══════════════════════════════════════════════════════════════════════════════

  Signaling Server (VPS 1):
  - [ ] DNS record signal.ahmedhany.dev points to Signaling VPS IP
  - [ ] SSL certificate obtained for signal.ahmedhany.dev
  - [ ] .env file configured with Firebase credentials
  - [ ] .env file has TURN_SECRET and TURN_DOMAIN=turn.ahmedhany.dev
  - [ ] Firewall ports open (22, 80, 443)
  - [ ] Docker container running
  - [ ] Nginx configured and running
  - [ ] curl https://signal.ahmedhany.dev/health returns OK

  TURN Server (VPS 2):
  - [ ] DNS record turn.ahmedhany.dev points to TURN VPS IP
  - [ ] SSL certificate obtained for turn.ahmedhany.dev
  - [ ] /etc/turnserver.conf has correct external-ip (TURN VPS IP)
  - [ ] static-auth-secret matches TURN_SECRET from Signaling Server
  - [ ] Firewall ports open (22, 80, 3478/udp, 3478/tcp, 5349/tcp, 49152-65535/udp)
  - [ ] Coturn service running
  - [ ] TURN connectivity test passes

  Both Servers:
  - [ ] TURN_SECRET is identical on both servers
  - [ ] Flutter app updated with production URLs
