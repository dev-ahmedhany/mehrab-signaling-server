import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import admin from 'firebase-admin';
import path from 'path';

import { config, validateConfig } from './config';
import { verifyFirebaseToken, AuthenticatedRequest } from './middleware/auth.middleware';
import { getIceServerConfig } from './services/turn-credential.service';
import { setupSocketHandlers, getRoomStats } from './socket';

validateConfig();

if (config.firebase.projectId && config.firebase.clientEmail && config.firebase.privateKey) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: config.firebase.projectId,
      clientEmail: config.firebase.clientEmail,
      privateKey: config.firebase.privateKey,
    }),
  });
  console.log('Firebase Admin SDK initialized');
} else {
  console.warn('Firebase Admin SDK not initialized - missing credentials');
}

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: config.cors.origin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(cors({
  origin: config.cors.origin,
  credentials: true,
}));
app.use(express.json());

// Serve test client in development
if (config.nodeEnv === 'development') {
  app.use('/test', express.static(path.join(__dirname, '../test-client')));
}

app.get('/health', (req, res) => {
  const stats = getRoomStats();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    stats,
  });
});

app.get('/api/turn-credentials', verifyFirebaseToken, (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const iceConfig = getIceServerConfig(req.user.uid);
  res.json(iceConfig);
});

app.post('/api/send-notification', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { token, topic, title, body, data } = req.body;

  if ((!token && !topic) || !title || !body) {
    res.status(400).json({ error: 'Missing required fields: token or topic, title, body' });
    return;
  }

  try {
    const message: any = {
      notification: {
        title,
        body,
      },
      data: data || {},
    };

    if (token) {
      message.token = token;
    } else if (topic) {
      message.topic = topic;
    }

    const response = await admin.messaging().send(message);
    res.json({ success: true, messageId: response });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

setupSocketHandlers(io);

httpServer.listen(config.port, () => {
  console.log(`Signaling server running on port ${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
