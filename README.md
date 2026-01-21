# Mehrab WebRTC Signaling Server

A Node.js signaling server for WebRTC peer-to-peer calls with TURN server support.

## Table of Contents

- [Local Development](#local-development)
- [Testing Locally](#testing-locally)
- [Production Deployment](#production-deployment)
- [Flutter App Configuration](#flutter-app-configuration)
- [Verification & Testing](#verification--testing)
- [Troubleshooting](#troubleshooting)

---

## Local Development

### Prerequisites

- Node.js 18+ installed
- Docker & Docker Compose (for TURN server)
- Firebase project with Authentication enabled
- Flutter development environment

### 1. Setup Signaling Server

```bash
# Navigate to signaling server directory
cd mehrab-signaling-server

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

### 2. Configure Environment Variables

Edit `.env` file with your Firebase credentials:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Firebase Configuration (get from Firebase Console > Project Settings > Service Accounts)
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"

# TURN Server Configuration
TURN_SECRET=your-secure-random-secret-min-32-chars
TURN_DOMAIN=localhost
TURN_CREDENTIAL_TTL=3600

# CORS Configuration
CORS_ORIGIN=*
```

**To get Firebase credentials:**
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project
3. Go to Project Settings > Service Accounts
4. Click "Generate new private key"
5. Copy the values from the downloaded JSON file

### 3. Start the Signaling Server

```bash
# Development mode with hot reload
npm run dev

# Or build and run production
npm run build
npm start
```

The server will start at `http://localhost:3000`

### 4. Start Local TURN Server (Optional for LAN testing)

For testing across different networks, you need a TURN server:

```bash
# Start only Coturn container
docker run -d \
  --name coturn \
  -p 3478:3478/udp \
  -p 3478:3478/tcp \
  -e TURN_SECRET=your-secure-random-secret-min-32-chars \
  coturn/coturn:4.6 \
  -n \
  --log-file=stdout \
  --use-auth-secret \
  --static-auth-secret=your-secure-random-secret-min-32-chars \
  --realm=localhost \
  --fingerprint \
  --lt-cred-mech
```

---

## Testing Locally

### Option 1: Same Machine Testing (Simplest)

1. **Start the signaling server:**
   ```bash
   cd mehrab-signaling-server
   npm run dev
   ```

2. **Update Flutter constants for local testing:**

   Edit `mehrab/lib/core/utilities/services/webrtc_constants.dart`:
   ```dart
   class WebRTCConstants {
     // For iOS Simulator or Android Emulator
     static const String signalingServerUrl = 'http://10.0.2.2:3000'; // Android Emulator
     // static const String signalingServerUrl = 'http://localhost:3000'; // iOS Simulator

     static const String turnDomain = 'localhost';
   }
   ```

3. **Run Flutter app:**
   ```bash
   cd mehrab
   flutter pub get
   flutter run
   ```

### Option 2: Local Network Testing (Two Devices)

1. **Find your computer's local IP:**
   ```bash
   # macOS
   ipconfig getifaddr en0

   # Linux
   hostname -I | awk '{print $1}'

   # Windows
   ipconfig | findstr IPv4
   ```
   Example output: `192.168.1.100`

2. **Start signaling server bound to all interfaces:**
   ```bash
   cd mehrab-signaling-server
   npm run dev
   ```

3. **Update Flutter constants:**
   ```dart
   class WebRTCConstants {
     static const String signalingServerUrl = 'http://192.168.1.100:3000';
     static const String turnDomain = '192.168.1.100';
   }
   ```

4. **Run app on two devices** (both connected to same WiFi)

### Option 3: Testing with ngrok (Remote Testing)

For testing across different networks without deploying:

1. **Install ngrok:**
   ```bash
   # macOS
   brew install ngrok

   # Or download from https://ngrok.com/download
   ```

2. **Start signaling server:**
   ```bash
   npm run dev
   ```

3. **Expose via ngrok:**
   ```bash
   ngrok http 3000
   ```

   You'll get a URL like: `https://abc123.ngrok.io`

4. **Update Flutter constants:**
   ```dart
   class WebRTCConstants {
     static const String signalingServerUrl = 'https://abc123.ngrok.io';
     static const String turnDomain = 'localhost'; // TURN won't work with ngrok
   }
   ```

   > **Note:** TURN server won't work through ngrok. P2P calls on the same network will work, but calls across different networks may fail without TURN.

### Test Scenarios

| Scenario | Expected Behavior |
|----------|-------------------|
| Both devices on same WiFi | Direct P2P connection (no TURN needed) |
| One on WiFi, one on 4G | Requires TURN server for relay |
| Corporate firewall | Requires TURN over TCP/TLS (port 443) |

---

## Production Deployment

### Prerequisites

- VPS with public IP (e.g., DigitalOcean, AWS, Hetzner)
- Domain name pointing to your VPS
- SSL certificates (Let's Encrypt)

### 1. Server Setup

```bash
# SSH into your server
ssh root@your-server-ip

# Install Docker
curl -fsSL https://get.docker.com | sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install Certbot for SSL
sudo apt update
sudo apt install -y certbot
```

### 2. Get SSL Certificates

```bash
# Stop any service on port 80
sudo systemctl stop nginx 2>/dev/null || true

# Get certificates for your domains
sudo certbot certonly --standalone -d signal.ahmedhany.dev -d turn.ahmedhany.dev

# Certificates will be saved to:
# /etc/letsencrypt/live/signal.ahmedhany.dev/fullchain.pem
# /etc/letsencrypt/live/signal.ahmedhany.dev/privkey.pem
```

### 3. Clone and Configure

```bash
# Clone your repository
git clone https://github.com/your-repo/mehrab.git
cd mehrab/mehrab-signaling-server

# Create production environment file
nano .env
```

Add production configuration:

```env
PORT=3000
NODE_ENV=production

FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=your-service-account-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

TURN_SECRET=generate-a-very-secure-random-string-at-least-32-characters
TURN_DOMAIN=turn.ahmedhany.dev
TURN_CREDENTIAL_TTL=3600

CORS_ORIGIN=*
```

### 4. Configure Coturn for Production

Edit `turnserver.conf`:

```conf
# Network settings
listening-port=3478
tls-listening-port=5349

# Your server's public IP
external-ip=YOUR_PUBLIC_IP

# Relay address range
min-port=49152
max-port=65535

# Realm
realm=ahmedhany.dev

# Authentication
use-auth-secret
static-auth-secret=YOUR_TURN_SECRET_FROM_ENV

# SSL Certificates
cert=/etc/coturn/certs/fullchain.pem
pkey=/etc/coturn/certs/privkey.pem

# Logging
log-file=stdout
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
```

### 5. Setup SSL Certificates Directory

```bash
# Create certs directory
mkdir -p certs

# Copy certificates
sudo cp /etc/letsencrypt/live/signal.ahmedhany.dev/fullchain.pem certs/
sudo cp /etc/letsencrypt/live/signal.ahmedhany.dev/privkey.pem certs/
sudo chown -R $USER:$USER certs/
```

### 6. Deploy with Docker Compose

```bash
# Build and start services
docker-compose up -d --build

# Check logs
docker-compose logs -f

# Check status
docker-compose ps
```

### 7. Setup Nginx Reverse Proxy (Recommended)

Install and configure Nginx for SSL termination:

```bash
sudo apt install -y nginx

sudo nano /etc/nginx/sites-available/signal.ahmedhany.dev
```

Add configuration:

```nginx
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

    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket timeout
        proxy_read_timeout 86400;
    }
}
```

Enable and restart:

```bash
sudo ln -s /etc/nginx/sites-available/signal.ahmedhany.dev /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 8. Configure Firewall

```bash
# Allow required ports
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw allow 3478/udp    # TURN UDP
sudo ufw allow 3478/tcp    # TURN TCP
sudo ufw allow 5349/tcp    # TURN TLS
sudo ufw allow 49152:65535/udp  # TURN relay ports

sudo ufw enable
```

### 9. Auto-renew SSL Certificates

```bash
# Add to crontab
sudo crontab -e

# Add this line (renews every month)
0 0 1 * * certbot renew --quiet && cp /etc/letsencrypt/live/signal.ahmedhany.dev/*.pem /path/to/mehrab-signaling-server/certs/ && docker-compose -f /path/to/mehrab-signaling-server/docker-compose.yml restart coturn
```

---

## Flutter App Configuration

### Update Production Constants

Edit `mehrab/lib/core/utilities/services/webrtc_constants.dart`:

```dart
class WebRTCConstants {
  static const String signalingServerUrl = 'https://signal.ahmedhany.dev';
  static const String turnDomain = 'turn.ahmedhany.dev';
}
```

### Build and Release

```bash
cd mehrab

# Get dependencies
flutter pub get

# Build Android
flutter build apk --release

# Build iOS
flutter build ios --release
```

---

## Verification & Testing

### 1. Test Signaling Server Health

```bash
# Check health endpoint
curl https://signal.ahmedhany.dev/health

# Expected response:
# {"status":"ok","timestamp":"2024-...","stats":{"totalRooms":0,"totalParticipants":0}}
```

### 2. Test TURN Credentials API

```bash
# Get a Firebase auth token (from your app or Firebase console)
TOKEN="your-firebase-id-token"

curl -H "Authorization: Bearer $TOKEN" https://signal.ahmedhany.dev/api/turn-credentials

# Expected response:
# {"iceServers":[{"urls":"stun:stun.l.google.com:19302"},{"urls":["stun:turn.ahmedhany.dev:3478","turn:turn.ahmedhany.dev:3478?transport=udp",...]}]}
```

### 3. Test TURN Server Connectivity

```bash
# Install turnutils
sudo apt install coturn-utils

# Test TURN connectivity
turnutils_uclient -T -u "timestamp:user" -w "credential" turn.ahmedhany.dev

# Or use online tester: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
```

### 4. Test WebSocket Connection

```bash
# Install wscat
npm install -g wscat

# Test WebSocket (will fail auth but confirms server is reachable)
wscat -c wss://signal.ahmedhany.dev/socket.io/?transport=websocket
```

### 5. Flutter App Testing Checklist

| Test | How to Verify |
|------|---------------|
| **P2P on same WiFi** | Two devices on same network, call connects directly |
| **P2P across networks** | One on WiFi, one on 4G, call connects via TURN |
| **Audio quality** | Clear voice, no echo, no delays |
| **Video toggle** | Can enable/disable video during call |
| **Camera switch** | Front/back camera switching works |
| **Speaker toggle** | Earpiece/speaker switching works |
| **Mute toggle** | Muting works, remote can't hear |
| **Call end** | Both sides disconnect cleanly |
| **Reconnection** | Brief network loss recovers |
| **Background** | Call continues when app backgrounded |
| **CallKit (iOS)** | Native call UI appears |

### 6. Monitor Connection Type

In your app, you can check if using TURN relay:

```dart
// In WebRTCCallService, add this debug method:
Future<void> checkConnectionType() async {
  final stats = await _peerConnection?.getStats();
  for (var report in stats ?? []) {
    if (report.type == 'candidate-pair' && report.values['state'] == 'succeeded') {
      final localType = report.values['localCandidateType'];
      final remoteType = report.values['remoteCandidateType'];
      print('Connection: local=$localType, remote=$remoteType');
      // 'host' = direct P2P
      // 'relay' = using TURN server
    }
  }
}
```

---

## Troubleshooting

### Common Issues

#### 1. "Connection failed" error

**Possible causes:**
- Signaling server not reachable
- Firebase authentication failed
- TURN server not configured

**Solutions:**
```bash
# Check signaling server
curl https://signal.ahmedhany.dev/health

# Check Firebase token is valid
# In Flutter, verify FirebaseAuth.instance.currentUser is not null

# Check TURN server
turnutils_uclient -T turn.ahmedhany.dev
```

#### 2. Call connects but no audio

**Possible causes:**
- Microphone permission not granted
- Audio session not configured
- Firewall blocking UDP

**Solutions:**
- Check app permissions in device settings
- Verify AudioSessionService is initialized
- Try TURN over TCP (port 443)

#### 3. Video not showing

**Possible causes:**
- Camera permission not granted
- Renderer not initialized
- Track not added to peer connection

**Solutions:**
- Check camera permission
- Verify `localRenderer.initialize()` was called
- Check `addTrack` is called after getting media stream

#### 4. Works on WiFi, fails on 4G

**Possible causes:**
- TURN server not reachable
- UDP blocked by carrier
- Credentials expired

**Solutions:**
- Verify TURN server is accessible from mobile network
- Enable TURN over TCP/TLS
- Check credential TTL

#### 5. High latency / poor quality

**Possible causes:**
- Using TURN relay when P2P possible
- Network congestion
- High packet loss

**Solutions:**
- Check connection type (should be 'host' for P2P)
- Monitor network quality via `getStats()`
- Consider implementing quality adaptation

### Debug Logging

Enable verbose logging in development:

```dart
// In webrtc_call_service.dart, logs are already added with debugPrint
// For more verbose WebRTC logs:
import 'package:flutter_webrtc/flutter_webrtc.dart';

// In initialize():
WebRTC.initialize(); // Enables internal logging
```

### Server Logs

```bash
# View all logs
docker-compose logs -f

# View only signaling server
docker-compose logs -f signaling-server

# View only TURN server
docker-compose logs -f coturn
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Flutter App                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ SocketService│  │WebRTCService│  │ TurnCredentialService │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
└─────────┼────────────────┼─────────────────────┼────────────────┘
          │                │                     │
          │ Socket.io      │ ICE/STUN/TURN       │ HTTPS
          ▼                ▼                     ▼
┌─────────────────┐  ┌───────────┐  ┌─────────────────────────────┐
│Signaling Server │  │TURN Server│  │  Firebase Auth (JWT verify) │
│   (Node.js)     │  │ (Coturn)  │  │                             │
└─────────────────┘  └───────────┘  └─────────────────────────────┘
          │                │
          └────────────────┘
              Same VPS
```

**Call Flow:**
1. Student initiates call → Firebase doc created
2. Teacher receives push notification → Accepts call
3. Both connect to signaling server via Socket.io
4. Student creates WebRTC offer → Sends via signaling
5. Teacher receives offer → Creates answer → Sends via signaling
6. ICE candidates exchanged → P2P connection established
7. Audio/video streams flow directly between peers (or via TURN)

---

## Support

For issues:
1. Check this troubleshooting guide
2. Review server logs: `docker-compose logs -f`
3. Check Flutter debug console
4. Open an issue on GitHub with logs
