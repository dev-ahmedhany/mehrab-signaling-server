import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import admin from 'firebase-admin';
import path from 'path';
import crypto from 'crypto';

import { config, validateConfig } from './config';
import { verifyFirebaseToken, verifyAdminToken, AuthenticatedRequest } from './middleware/auth.middleware';
import { getIceServerConfig } from './services/turn-credential.service';
import { setupSocketHandlers, getRoomStats, getDetailedStats, getActiveRooms, getLogs } from './socket';
import livekitRouter from './routes/livekit';

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
app.set('trust proxy', true);
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

// Serve admin dashboard
app.use('/admin', express.static(path.join(__dirname, '../admin-dashboard')));

app.get('/health', (req, res) => {
  const stats = getRoomStats();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    stats,
  });
});

// Admin API endpoints - protected with Firebase Auth (admin only)
app.get('/api/admin/stats', verifyAdminToken, async (req: AuthenticatedRequest, res) => {
  const stats = await getDetailedStats();
  res.json(stats);
});

app.get('/api/admin/rooms', verifyAdminToken, async (req: AuthenticatedRequest, res) => {
  const rooms = await getActiveRooms();
  res.json({ rooms });
});

app.get('/api/admin/logs', verifyAdminToken, (req: AuthenticatedRequest, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const logs = getLogs(limit);
  res.json({ logs });
});

app.use('/api/livekit', livekitRouter);

app.get('/api/turn-credentials', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user ? req.user.uid : `guest-${crypto.randomUUID()}`;

    const iceConfig = await getIceServerConfig(userId);

    res.json(iceConfig);
  } catch (error) {
    console.error('Error getting TURN credentials:', error);
    // Fallback to default config
    const userId = req.user ? req.user.uid : `guest-${crypto.randomUUID()}`;
    const iceConfig = getIceServerConfig(userId);
    res.json(iceConfig);
  }
});

app.post('/api/send-notification', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  const { token, topic, title, body, data } = req.body;

  console.log('Send notification request:', { hasToken: !!token, hasTopic: !!topic, title, body, hasData: !!data });

  if (!topic || !title || !body) {
    res.status(400).json({ error: 'Missing required fields: topic, title, body' });
    return;
  }

  // Check if teacher is already busy (in a call)
  try {
    const teacherDoc = await admin.firestore().collection('users').doc(topic).get();
    if (teacherDoc.exists && teacherDoc.data()?.isBusy) {
      console.log(`Teacher ${topic} is already in a call, rejecting notification`);
      return res.status(409).json({ error: 'Teacher is already in a call' });
    }
  } catch (error) {
    console.error(`Error checking teacher status for ${topic}:`, error);
    // Continue with sending notification despite error
  }

  try {
    const baseMessage = {
      notification: { title, body },
      data: data || {},
    };

    const message: admin.messaging.Message = { ...baseMessage, topic };

    console.log('Sending FCM message:', { token: token ? '[REDACTED]' : undefined, topic, title, body });
    const response = await admin.messaging().send(message);
    console.log('FCM message sent successfully:', response);
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
