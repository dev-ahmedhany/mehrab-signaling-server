# Quick Start Guide

## 5-Minute Local Setup

### 1. Start Signaling Server

```bash
cd mehrab-signaling-server
cp .env.example .env
# Edit .env with your Firebase credentials
npm install
npm run dev
```

### 2. Update Flutter App

Edit `mehrab/lib/core/utilities/services/webrtc_constants.dart`:

```dart
// For Android Emulator:
static const String signalingServerUrl = 'http://10.0.2.2:3000';

// For iOS Simulator:
static const String signalingServerUrl = 'http://localhost:3000';

// For physical device (replace with your computer's IP):
static const String signalingServerUrl = 'http://192.168.1.100:3000';
```

### 3. Run Flutter App

```bash
cd mehrab
flutter pub get
flutter run
```

### 4. Test

1. Login as a student on one device
2. Login as a teacher on another device
3. Student calls teacher
4. Teacher answers
5. Verify audio works

---

## Production Deployment (30 minutes)

### 1. On Your VPS

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Clone and configure
git clone <your-repo>
cd mehrab/mehrab-signaling-server
cp .env.example .env
nano .env  # Add production values

# Get SSL certs
sudo apt install certbot
sudo certbot certonly --standalone -d signal.yourdomain.com
mkdir certs
sudo cp /etc/letsencrypt/live/signal.yourdomain.com/*.pem certs/

# Deploy
docker-compose up -d --build
```

### 2. Update Flutter Constants

```dart
static const String signalingServerUrl = 'https://signal.yourdomain.com';
static const String turnDomain = 'turn.yourdomain.com';
```

### 3. Build Release

```bash
flutter build apk --release
flutter build ios --release
```

---

## Essential Commands

```bash
# Check server status
curl https://signal.yourdomain.com/health

# View logs
docker-compose logs -f

# Restart services
docker-compose restart

# Stop services
docker-compose down

# Update and redeploy
git pull
docker-compose up -d --build
```

---

## Firewall Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 3000 | TCP | Signaling (internal) |
| 443 | TCP | HTTPS/WSS |
| 3478 | UDP/TCP | TURN |
| 5349 | TCP | TURN TLS |
| 49152-65535 | UDP | TURN relay |
