# Deployment Guide: Mehrab Signaling Server

This guide provides instructions for deploying the Mehrab signaling server to a production environment.

## 1. Prerequisites

Before you begin, ensure you have the following:

- A server (e.g., a Linux VM from any cloud provider like AWS, Google Cloud, DigitalOcean, etc.).
- **Node.js**: Version 18.x or later installed on the server.
- **Firebase Project**: A Firebase project with Firestore and Firebase Authentication enabled.
- **LiveKit Account**: A LiveKit account (either cloud-hosted or self-hosted) to obtain API keys.
- **Git**: Installed on the server to clone the repository.
- **PM2**: A process manager for Node.js applications. Install it globally on your server: `npm install -g pm2`.

## 2. Configuration

The server is configured using environment variables.

### 2.1. Create a `.env` file

On your server, create a `.env` file in the root of the `mehrab-signaling-server` directory.

```bash
touch .env
```

### 2.2. Populate Environment Variables

Add the following environment variables to the `.env` file. Replace the placeholder values with your actual credentials and configuration.

```dotenv
# Server Configuration
PORT=3000
NODE_ENV=production
CORS_ORIGIN=https://mehrab-alquran.com

# Firebase Admin SDK Credentials
# Go to your Firebase project settings -> Service accounts -> Generate new private key
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# LiveKit API Credentials
# Get these from your LiveKit project settings
LIVEKIT_API_KEY=your-livekit-api-key
LIVEKIT_API_SECRET=your-livekit-api-secret

# TURN Server Configuration (Optional, but recommended for better WebRTC reliability)
TURN_SECRET=your-turn-secret
TURN_DOMAIN=turn.your-domain.com
```

**Note on `FIREBASE_PRIVATE_KEY`**: The private key must be enclosed in double quotes, and newlines (`\n`) must be preserved.

## 3. Deployment Steps

Follow these steps on your production server:

### 3.1. Clone the Repository

Clone your project repository to the server.

```bash
git clone <your-repository-url>
cd <your-repository-url>/mehrab-signaling-server
```

### 3.2. Install Dependencies

Install the project dependencies.

```bash
npm install --production
```

The `--production` flag ensures that only production dependencies are installed, skipping development dependencies like `typescript`, `ts-node-dev`, etc.

### 3.3. Build the Application

Compile the TypeScript source code into JavaScript. The compiled output will be placed in the `dist` directory.

```bash
npm run build
```

### 3.4. Start the Application with PM2

Use `pm2` to start the application. This will run the server as a background process and automatically restart it if it crashes.

```bash
pm2 start dist/index.js --name mehrab-signaling-server
```

### 3.5. Verify the Application is Running

You can check the status of the application and view logs using the following `pm2` commands:

- **Check status**: `pm2 status`
- **View logs**: `pm2 logs mehrab-signaling-server`

### 3.6. Save the PM2 Process List

To ensure your application automatically restarts after a server reboot, save the current `pm2` process list.

```bash
pm2 save
```

## 4. Reverse Proxy (Recommended)

It is highly recommended to run the signaling server behind a reverse proxy like Nginx. A reverse proxy can provide:
- **SSL Termination**: Handling HTTPS requests and encrypting traffic.
- **Load Balancing**: (Optional) Distributing traffic across multiple instances of the server.
- **Easier Port Mapping**: Exposing the server on standard ports (80 for HTTP, 443 for HTTPS) without running the Node.js application as root.

### Example Nginx Configuration

Here is a basic example of an Nginx server block that proxies requests to the signaling server.

Create a new file in `/etc/nginx/sites-available/your-domain.com`:

```nginx
server {
    listen 80;
    server_name signaling.your-domain.com;

    # Redirect HTTP to HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name signaling.your-domain.com;

    # SSL certificate configuration
    ssl_certificate /etc/letsencrypt/live/signaling.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/signaling.your-domain.com/privkey.pem;

    # WebSocket and reverse proxy settings
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site and restart Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/your-domain.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

This completes the deployment process for the Mehrab signaling server.
