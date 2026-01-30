import { Router } from 'express';
import express from 'express';
import { AccessToken, EncodedFileOutput, S3Upload, WebhookReceiver, RoomServiceClient, EgressClient } from 'livekit-server-sdk';
import { verifyFirebaseToken, AuthenticatedRequest } from '../middleware/auth.middleware';
import { config } from '../config';
import admin from 'firebase-admin';
import { Mutex } from 'async-mutex';
import winston from 'winston';
import rateLimit from 'express-rate-limit';

// Define types for webhook events to replace 'any'
interface Room {
  name: string;
  numParticipants: number;
}

interface Participant {
  identity: string;
}

interface EgressInfo {
  egressId: string;
  roomName: string;
}

interface WebhookEvent {
  event: string;
  room?: Room;
  participant?: Participant;
  egressInfo?: EgressInfo;
}

const router = Router();

// Setup structured logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.Console(),
  ],
});

// Rate limiting for token endpoint
const tokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many token requests from this IP, please try again later.',
});

// Rate limiting for webhook endpoint
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 1000, // higher limit for webhooks
  message: 'Too many webhook requests.',
});

// Validate configuration at startup
if (!config.livekit.apiKey || !config.livekit.apiSecret || !config.livekit.host) {
  const errorMsg = 'LiveKit API key, secret, or host not configured';
  logger.error(errorMsg);
  throw new Error(errorMsg);
}
if (!config.livekit.r2.accessKey || !config.livekit.r2.secretKey || !config.livekit.r2.bucket || !config.livekit.r2.endpoint) {
  const errorMsg = 'LiveKit R2 credentials not configured';
  logger.error(errorMsg);
  throw new Error(errorMsg);
}

// Initialize WebhookReceiver for signature validation
const webhookReceiver = new WebhookReceiver(config.livekit.apiKey, config.livekit.apiSecret);

// Store active recordings to manage them
const activeRecordings = new Map<string, { egressId: string, startTime: Date }>();
const processingRooms = new Set<string>();
const mutex = new Mutex();
const stopMutex = new Mutex(); // Mutex for stopping recordings to prevent races

router.post('/token', tokenLimiter, verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  const { roomName, participantName } = req.body;
  const user = req.user;
  const userAgent = req.get('User-Agent') || 'Unknown';
  const clientType = userAgent.includes('Dart') ? 'Flutter App' : 
                     userAgent.includes('Mozilla') ? 'Web Browser' : 'Unknown';

  logger.info(`Token request from ${clientType} (User-Agent: ${userAgent.substring(0, 100)}), user: ${user?.uid || 'unauthenticated'}, room: ${roomName}`);

  // Validate input
  if (!roomName || typeof roomName !== 'string' || roomName.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(roomName)) {
    logger.warn('Invalid roomName in token request');
    return res.status(400).json({ error: 'Invalid roomName' });
  }
  if (!participantName || typeof participantName !== 'string' || participantName.length > 100) {
    logger.warn('Invalid participantName in token request');
    return res.status(400).json({ error: 'Invalid participantName' });
  }

  if (!user) {
    logger.warn('User not authenticated in token request');
    return res.status(401).json({ error: 'User not authenticated' });
  }

  const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: user.uid,
    name: participantName,
  });

  at.addGrant({ roomJoin: true, room: roomName });

  try {
    const token = await at.toJwt();
    logger.info(`Generated token for user ${user.uid} in room ${roomName}`);

    // Create room if it doesn't exist
    try {
      const roomService = new RoomServiceClient(config.livekit.host, config.livekit.apiKey, config.livekit.apiSecret);
      await roomService.createRoom({ name: roomName, emptyTimeout: 30 });
      logger.info(`Created room ${roomName} with 30s empty timeout`);
    } catch (error) {
      logger.error(`Failed to create room ${roomName}:`, error);
      // Continue without failing the request
    }

    // Update user status
    try {
      const userDocRef = admin.firestore().collection('users').doc(user.uid);
      await userDocRef.update({ isBusy: true });
      logger.info(`Updated user ${user.uid} status to busy`);
    } catch (error) {
      logger.error(`Failed to update user status for ${user.uid}:`, error);
      // Continue without failing the request
    }

    res.json({ token });
  } catch (error) {
    logger.error('Error generating token:', error);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

// Helper functions for webhook event handling
async function handleRoomStarted(event: WebhookEvent) {
  if (!event.room) return;
  const room = event.room;
  logger.info(`Room ${room.name} started`);
}

async function handleParticipantJoined(event: WebhookEvent) {
  if (!event.room) return;
  const room = event.room;
  logger.info(`Participant ${event.participant?.identity} joined room ${room.name}`);

  await mutex.runExclusive(async () => {
    if (processingRooms.has(room.name)) {
      logger.info(`Recording already being started for room ${room.name}`);
      return;
    }
    processingRooms.add(room.name);

    try {
      const roomService = new RoomServiceClient(config.livekit.host, config.livekit.apiKey, config.livekit.apiSecret);
      const rooms = await roomService.listRooms([room.name]);
      const currentRoom = rooms.length > 0 ? rooms[0] : null;

      if (currentRoom && currentRoom.numParticipants >= 2 && !activeRecordings.has(room.name)) {
        const egressClient = new EgressClient(config.livekit.host, config.livekit.apiKey, config.livekit.apiSecret);
        const egresses = await egressClient.listEgress({ roomName: room.name });

        if (egresses.length === 0) {
          const s3Upload = new S3Upload({
            accessKey: config.livekit.r2.accessKey,
            secret: config.livekit.r2.secretKey,
            bucket: config.livekit.r2.bucket,
            endpoint: config.livekit.r2.endpoint,
          });
          const output = new EncodedFileOutput({
            filepath: `recordings/${room.name}-${Date.now()}.mp4`,
            output: { case: 's3', value: s3Upload },
          });

          const egressResponse = await egressClient.startRoomCompositeEgress(room.name, output);

          activeRecordings.set(room.name, {
            egressId: egressResponse.egressId,
            startTime: new Date(),
          });

          logger.info(`Started recording ${egressResponse.egressId} for room ${room.name} via webhook (participants: ${currentRoom.numParticipants})`);
        } else {
          logger.info(`Egress already exists for room ${room.name}`);
        }
      } else {
        logger.info(`Not starting recording for room ${room.name}: participants=${currentRoom?.numParticipants || 0}, recording active=${activeRecordings.has(room.name)}`);
      }
    } catch (error) {
      logger.error(`Error starting recording for room ${room.name}:`, error);
    } finally {
      processingRooms.delete(room.name);
    }
  });
}

async function handleParticipantLeft(event: WebhookEvent) {
  if (!event.room) return;
  const room = event.room;
  logger.info(`Participant ${event.participant?.identity} left room ${room.name}`);

  // Update user status to not busy
  if (event.participant?.identity) {
    try {
      const userDocRef = admin.firestore().collection('users').doc(event.participant.identity);
      await userDocRef.update({ isBusy: false });
      logger.info(`Updated user ${event.participant.identity} status to not busy`);
    } catch (error) {
      logger.error(`Failed to update user status for ${event.participant.identity}:`, error);
    }
  }

  await stopMutex.runExclusive(async () => {
    const roomService = new RoomServiceClient(config.livekit.host, config.livekit.apiKey, config.livekit.apiSecret);
    const rooms = await roomService.listRooms([room.name]);
    const currentRoom = rooms.length > 0 ? rooms[0] : null;

    if (!currentRoom || currentRoom.numParticipants <= 1) {
      const recording = activeRecordings.get(room.name);
      if (recording) {
        try {
          const egressClient = new EgressClient(config.livekit.host, config.livekit.apiKey, config.livekit.apiSecret);
          await egressClient.stopEgress(recording.egressId);
          logger.info(`Stopped recording ${recording.egressId} for room ${room.name} via webhook (participants: ${currentRoom?.numParticipants || 0})`);
          activeRecordings.delete(room.name);
        } catch (error) {
          logger.error(`Error stopping recording for room ${room.name}:`, error);
        }
      } else {
        logger.info(`No active recording to stop for room ${room.name}`);
      }
    } else {
      logger.info(`Not stopping recording for room ${room.name}: participants=${currentRoom?.numParticipants || 0}`);
    }
  });
}

async function handleRoomFinished(event: WebhookEvent) {
  if (!event.room) return;
  const room = event.room;
  logger.info(`Room ${room.name} finished`);

  await stopMutex.runExclusive(async () => {
    const recording = activeRecordings.get(room.name);
    if (recording) {
      try {
        const egressClient = new EgressClient(config.livekit.host, config.livekit.apiKey, config.livekit.apiSecret);
        await egressClient.stopEgress(recording.egressId);
        logger.info(`Stopped recording ${recording.egressId} for finished room ${room.name}`);
        activeRecordings.delete(room.name);
      } catch (error) {
        logger.error(`Error stopping recording for finished room ${room.name}:`, error);
      }
    } else {
      logger.info(`No active recording for finished room ${room.name}`);
    }
  });
}

async function handleEgressEnded(event: WebhookEvent) {
  if (!event.egressInfo) return;
  logger.info(`Egress ${event.egressInfo.egressId} ended for room ${event.egressInfo.roomName}`);

  if (event.egressInfo.roomName && activeRecordings.has(event.egressInfo.roomName)) {
    activeRecordings.delete(event.egressInfo.roomName);
  }
}

router.post('/webhook', webhookLimiter, express.raw({ type: 'application/webhook+json' }), async (req, res) => {
  try {
    // Validate webhook body
    if (!Buffer.isBuffer(req.body)) {
      logger.warn('Invalid webhook body type');
      return res.status(400).send('Invalid request body');
    }

    const authHeader = req.get('Authorization');
    if (!authHeader) {
      logger.warn('Missing Authorization header in webhook');
      return res.status(401).send('Unauthorized');
    }

    // Validate the webhook signature
    const event: WebhookEvent = await webhookReceiver.receive(req.body.toString(), authHeader);
    logger.info(`Received webhook event: ${event.event} for room: ${event.room?.name || 'unknown'}`);

    switch (event.event) {
    case 'room_started':
      await handleRoomStarted(event);
      break;

    case 'participant_joined':
      await handleParticipantJoined(event);
      break;

    case 'participant_left':
      await handleParticipantLeft(event);
      break;

    case 'room_finished':
      await handleRoomFinished(event);
      break;

    case 'egress_ended':
      await handleEgressEnded(event);
      break;

    default:
      logger.info(`Unhandled webhook event: ${event.event}`);
      break;
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('Webhook processing error:', error);
    if (error instanceof Error && (error.message.includes('signature') || error.message.includes('Authorization'))) {
      return res.status(401).send('Unauthorized');
    }
    res.status(500).send('Internal Server Error');
  }
});

export default router;
