Here's a step-by-step guide to deploy the signaling server and TURN server on separate Oracle Cloud VPS instances:

  Prerequisites

  1. Two Oracle Cloud VPS instances with public IPs:
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
  Step 2: Configure Oracle Cloud VCN Security Lists (Signaling Server)

  In Oracle Cloud Console:
  1. Go to: Networking → Virtual Cloud Networks
  2. Click your VCN name
  3. Click Subnets → click your subnet
  4. Click the Security List (e.g., "Default Security List for...")
  5. Click "Add Ingress Rules"
  6. Add these rules:

  | Source CIDR | IP Protocol | Destination Port Range |
  |-------------|-------------|------------------------|
  | 0.0.0.0/0   | TCP         | 80                     |
  | 0.0.0.0/0   | TCP         | 443                    |

  Note: Leave "Source Port Range" empty for all rules.

  ---
  Step 3: SSH into Signaling Server VPS

  ssh ubuntu@SIGNALING_VPS_IP

  ---
  Step 4: Configure OS Firewall - iptables (Signaling Server)

  Oracle Cloud uses iptables with a REJECT rule that blocks traffic by default.
  You must add rules BEFORE the REJECT rule.

  # Check current iptables rules
  sudo iptables -L INPUT -n --line-numbers

  # Find the line number of the REJECT rule (usually line 5)
  # Add port 80 and 443 BEFORE the REJECT rule

  sudo iptables -I INPUT 5 -p tcp --dport 80 -m state --state NEW -j ACCEPT
  sudo iptables -I INPUT 6 -p tcp --dport 443 -m state --state NEW -j ACCEPT

  # Verify the rules were added correctly
  sudo iptables -L INPUT -n --line-numbers

  # Save iptables rules to persist after reboot
  sudo apt install -y iptables-persistent
  sudo netfilter-persistent save

  ---
  Step 5: Install Dependencies (Signaling Server)

  # Update system
  sudo apt update && sudo apt upgrade -y

  # Install Node.js 20.x
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs

  # Install PM2 globally (process manager)
  sudo npm install -g pm2

  # Install Certbot and Nginx
  sudo apt install -y certbot nginx git

  ---
  Step 6: Get SSL Certificate (Signaling Server)

  # Stop nginx temporarily (if running)
  sudo systemctl stop nginx

  # Get certificate for signaling domain
  sudo certbot certonly --standalone -d signal.ahmedhany.dev

  # Certificate saved to:
  # /etc/letsencrypt/live/signal.ahmedhany.dev/fullchain.pem
  # /etc/letsencrypt/live/signal.ahmedhany.dev/privkey.pem

  ---
  Step 7: Clone and Configure the Project (Signaling Server)

  # Clone your repository
  cd /opt
  sudo git clone https://github.com/dev-ahmedhany/mehrab-signaling-server.git
  sudo chown -R $USER:$USER mehrab-signaling-server
  cd mehrab-signaling-server

  # Install dependencies
  npm install

  # Build TypeScript
  npm run build

  ---
  Step 8: Create Environment File (Signaling Server)

  nano .env

  Add the following (replace with your actual values):

  # Server Configuration
  PORT=3000
  NODE_ENV=production

  # Firebase Configuration (from Firebase Console > Project Settings > Service Accounts)
  FIREBASE_PROJECT_ID=your-firebase-project-id
  FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
  FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_ACTUAL_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"

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
  Step 9: Configure Nginx Reverse Proxy (Signaling Server)

  sudo nano /etc/nginx/sites-available/signal.ahmedhany.dev

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

  sudo ln -s /etc/nginx/sites-available/signal.ahmedhany.dev /etc/nginx/sites-enabled/
  sudo nginx -t
  sudo systemctl start nginx
  sudo systemctl enable nginx

  ---
  Step 10: Start Signaling Server with PM2

  cd /opt/mehrab-signaling-server

  # Start the server
  pm2 start dist/index.js --name signaling-server

  # Setup auto-start on reboot
  pm2 startup
  # Run the command it outputs (starts with sudo env PATH=...)

  # Save current process list
  pm2 save

  # Check status
  pm2 status

  # View logs
  pm2 logs signaling-server

  ---
  Step 11: Setup Auto-renewal for SSL (Signaling Server)

  sudo crontab -e

  Add:

  0 0 1 * * certbot renew --quiet --post-hook "systemctl reload nginx"

  ---
  Step 12: Verify Signaling Server Deployment

  # Test health endpoint
  curl https://signal.ahmedhany.dev/health

  # Expected output:
  # {"status":"ok","timestamp":"...","stats":{"totalRooms":0,"totalParticipants":0}}

  ═══════════════════════════════════════════════════════════════════════════════
  PART 2: TURN SERVER DEPLOYMENT (VPS 2)
  ═══════════════════════════════════════════════════════════════════════════════

  ---
  Step 13: Configure Oracle Cloud VCN Security Lists (TURN Server)

  In Oracle Cloud Console:
  1. Go to: Networking → Virtual Cloud Networks
  2. Click your VCN name
  3. Click Subnets → click your subnet
  4. Click the Security List
  5. Click "Add Ingress Rules"
  6. Add these rules:

  | Source CIDR | IP Protocol | Destination Port Range |
  |-------------|-------------|------------------------|
  | 0.0.0.0/0   | TCP         | 80                     |
  | 0.0.0.0/0   | TCP         | 3478                   |
  | 0.0.0.0/0   | UDP         | 3478                   |
  | 0.0.0.0/0   | TCP         | 5349                   |
  | 0.0.0.0/0   | UDP         | 49152-65535            |

  Note: Leave "Source Port Range" empty for all rules.

  ---
  Step 14: SSH into TURN Server VPS

  ssh ubuntu@TURN_VPS_IP

  ---
  Step 15: Configure OS Firewall - iptables (TURN Server)

  # Check current iptables rules
  sudo iptables -L INPUT -n --line-numbers

  # Find the line number of the REJECT rule (usually line 5)
  # Add TURN ports BEFORE the REJECT rule

  sudo iptables -I INPUT 5 -p tcp --dport 80 -m state --state NEW -j ACCEPT
  sudo iptables -I INPUT 6 -p tcp --dport 3478 -m state --state NEW -j ACCEPT
  sudo iptables -I INPUT 7 -p udp --dport 3478 -j ACCEPT
  sudo iptables -I INPUT 8 -p tcp --dport 5349 -m state --state NEW -j ACCEPT
  sudo iptables -I INPUT 9 -p udp --dport 49152:65535 -j ACCEPT

  # Verify the rules were added correctly
  sudo iptables -L INPUT -n --line-numbers

  # Save iptables rules to persist after reboot
  sudo apt install -y iptables-persistent
  sudo netfilter-persistent save

  ---
  Step 16: Install Dependencies (TURN Server)

  # Update system
  sudo apt update && sudo apt upgrade -y

  # Install Coturn and Certbot
  sudo apt install -y coturn certbot

  ---
  Step 17: Get SSL Certificate (TURN Server)

  # Get certificate for TURN domain
  sudo certbot certonly --standalone -d turn.ahmedhany.dev

  # Certificate saved to:
  # /etc/letsencrypt/live/turn.ahmedhany.dev/fullchain.pem
  # /etc/letsencrypt/live/turn.ahmedhany.dev/privkey.pem

  ---
  Step 18: Configure Coturn

  sudo nano /etc/turnserver.conf

  Add the following configuration:

  # --- LISTENING PORTS ---
  listening-port=3478
  tls-listening-port=5349

  # --- NETWORK ---
  # YOUR TURN SERVER'S PUBLIC IP
  external-ip=TURN_VPS_PUBLIC_IP

  # --- PERFORMANCE TWEAKS ---
  # Relay address range
  # 49152-65535 gives you ~16,000 ports.
  # Since you want 3000+ users, this is safe (approx 5 ports per user).
  min-port=49152
  max-port=65535

  # AUTHENTICATION
  realm=ahmedhany.dev
  use-auth-secret
  static-auth-secret=SAME_TURN_SECRET_AS_SIGNALING_SERVER

  # SSL (Let's Encrypt)
  cert=/etc/letsencrypt/live/turn.ahmedhany.dev/fullchain.pem
  pkey=/etc/letsencrypt/live/turn.ahmedhany.dev/privkey.pem

  # --- LOGGING (CRITICAL CHANGE) ---
  # Disable verbose for production!
  # verbose
  # log-file=/var/log/turnserver.log
  # Use syslog instead to let the OS handle log rotation nicely
  syslog

  # --- SECURITY ---
  no-multicast-peers
  # (Your manual IP blocks are good, keep them if you wish,
  # but no-loopback-peers handles 127.0.0.0 automatically)
  denied-peer-ip=10.0.0.0-10.255.255.255
  denied-peer-ip=172.16.0.0-172.31.255.255
  denied-peer-ip=192.168.0.0-192.168.255.255

  # --- WEBRTC STANDARDS ---
  fingerprint
  lt-cred-mech
  stale-nonce=600

  # --- ANTI-ABUSE ---
  # Limit allocations per user session to save RAM/Ports
  user-quota=10
  total-quota=10000

  # Security
  no-cli

  Get your public IP:
  curl ifconfig.me

  ---
  Step 19: Enable and Start Coturn

  # Enable coturn service
  echo "TURNSERVER_ENABLED=1" | sudo tee -a /etc/default/coturn

  # Start coturn
  sudo systemctl enable coturn
  sudo systemctl start coturn

  # Check status
  sudo systemctl status coturn

  # View logs
  sudo tail -f /var/log/turnserver.log

  ---
  Step 20: Setup Auto-renewal for SSL (TURN Server)

  sudo crontab -e

  Add:

  0 0 1 * * certbot renew --quiet --post-hook "systemctl restart coturn"

  ---
  Step 21: Verify TURN Server Deployment

  # Test TURN server
  turnutils_uclient -T -u "test:user" -w "test" turn.ahmedhany.dev -p 3478

  # Or test from external using:
  # https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

  ---
  Step 22: Essential OS Tuning (TURN Server)

  Hetzner's default Ubuntu image limits open files. If you have 3,000 users, you need at least 6,000 open file descriptors (sockets).

  Run these commands:

  # Open the system limits file:
  sudo nano /etc/security/limits.conf

  # Add these lines at the bottom:
  *       soft    nofile  65535
  *       hard    nofile  65535
  root    soft    nofile  65535
  root    hard    nofile  65535
  turnserver soft nofile 65535
  turnserver hard nofile 65535

  # Edit the systemd service override (to ensure the service sees these limits):
  sudo systemctl edit coturn
  # (Or turnserver depending on how it's named in your install).

  # Add these lines into the editor that opens:
  [Service]
  LimitNOFILE=65536

  # Restart the service:
  sudo systemctl daemon-reload
  sudo systemctl restart coturn

  ---
  Step 23: Firewall (UFW) - TURN Server

  Make sure you open the entire range of ports, not just the listening port, or audio will fail.

  # Allow the listening ports
  sudo ufw allow 3478/tcp
  sudo ufw allow 3478/udp
  sudo ufw allow 5349/tcp
  sudo ufw allow 5349/udp

  # CRITICAL: Allow the relay port range for audio traffic
  sudo ufw allow 49152:65535/udp
  sudo ufw allow 49152:65535/tcp

  sudo ufw enable

  ═══════════════════════════════════════════════════════════════════════════════
  QUICK COMMANDS REFERENCE
  ═══════════════════════════════════════════════════════════════════════════════

  Signaling Server (VPS 1):
  ---
  # View logs
  pm2 logs signaling-server

  # Restart service
  pm2 restart signaling-server

  # Stop service
  pm2 stop signaling-server

  # Check status
  pm2 status

  # Update and redeploy
  cd /opt/mehrab-signaling-server
  git pull
  npm install
  npm run build
  pm2 restart signaling-server

  TURN Server (VPS 2):
  ---
  # View logs
  sudo tail -f /var/log/turnserver.log

  # Restart service
  sudo systemctl restart coturn

  # Stop service
  sudo systemctl stop coturn

  # Check status
  sudo systemctl status coturn

  ═══════════════════════════════════════════════════════════════════════════════
  TROUBLESHOOTING
  ═══════════════════════════════════════════════════════════════════════════════

  If ports are blocked (connection timeout):
  ---
  # 1. Check Oracle Cloud VCN Security Lists in the Console
  #    Make sure ingress rules are added for the required ports

  # 2. Check iptables rules on the server
  sudo iptables -L INPUT -n --line-numbers

  # Look for REJECT rule - your port rules must be BEFORE it
  # If rules are in wrong order, delete and re-add them

  # Test if port is open from your local machine:
  curl -v http://YOUR_DOMAIN:PORT

  # "Connection refused" = port open but nothing listening (good!)
  # "Connection timeout" = port blocked at network level (fix firewall)

  If signaling server health check fails:
  ---
  # Check if PM2 process is running
  pm2 status

  # Check signaling server logs
  pm2 logs signaling-server

  # Check if port 3000 is listening
  sudo ss -tlnp | grep 3000

  # Check Nginx config
  sudo nginx -t

  # Restart signaling server
  pm2 restart signaling-server

  If TURN doesn't work:
  ---
  # Check Coturn logs
  sudo tail -100 /var/log/turnserver.log

  # Verify external-ip is set correctly in /etc/turnserver.conf
  grep external-ip /etc/turnserver.conf

  # Check iptables rules
  sudo iptables -L INPUT -n --line-numbers

  # Check if coturn is running
  sudo systemctl status coturn

  # Test TURN connectivity from outside
  # Use https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

  If SSL issues on Signaling Server:
  ---
  # Check certificate
  openssl s_client -connect signal.ahmedhany.dev:443 -servername signal.ahmedhany.dev

  # Check Nginx config
  sudo nginx -t

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
  - [x] DNS record signal.ahmedhany.dev points to Signaling VPS IP
  - [x] Oracle Cloud VCN Security List: ports 80, 443 open
  - [x] iptables: ports 80, 443 added BEFORE REJECT rule
  - [ ] SSL certificate obtained for signal.ahmedhany.dev
  - [ ] .env file configured with Firebase credentials
  - [ ] .env file has TURN_SECRET and TURN_DOMAIN=turn.ahmedhany.dev
  - [ ] PM2 process running
  - [ ] Nginx configured and running
  - [ ] curl https://signal.ahmedhany.dev/health returns OK

  TURN Server (VPS 2):
  - [ ] DNS record turn.ahmedhany.dev points to TURN VPS IP
  - [ ] Oracle Cloud VCN Security List: ports 80, 3478, 5349, 49152-65535 open
  - [ ] iptables: TURN ports added BEFORE REJECT rule
  - [ ] SSL certificate obtained for turn.ahmedhany.dev
  - [ ] /etc/turnserver.conf has correct external-ip (TURN VPS IP)
  - [ ] static-auth-secret matches TURN_SECRET from Signaling Server
  - [ ] Coturn service running
  - [ ] TURN connectivity test passes

  Both Servers:
  - [ ] TURN_SECRET is identical on both servers
  - [ ] Flutter app updated with production URLs
