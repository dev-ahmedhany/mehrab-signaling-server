import { Router } from 'express';
import express from 'express';
import { AccessToken, EncodedFileOutput, S3Upload, WebhookReceiver, RoomServiceClient, EgressClient, AudioCodec, EncodingOptions } from 'livekit-server-sdk';
import { verifyFirebaseToken, AuthenticatedRequest } from '../middleware/auth.middleware';
import { config } from '../config';
import admin from 'firebase-admin';
import { Mutex } from 'async-mutex';
import winston from 'winston';
import rateLimit from 'express-rate-limit';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';

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

// Initialize S3 client for R2
const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${config.livekit.r2.endpoint}`,
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.livekit.r2.accessKey,
    secretAccessKey: config.livekit.r2.secretKey,
  },
});

// Store active recordings to manage them
const activeRecordings = new Map<string, { egressId: string, startTime: Date }>();
const processingRooms = new Set<string>();
const mutex = new Mutex();
const stopMutex = new Mutex(); // Mutex for stopping recordings to prevent races
const participantJoins = new Map<string, number>(); // Track participant joins per room

router.post('/token', tokenLimiter, verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  const { roomName, participantName } = req.body;
  const user = req.user;
  const userAgent = req.get('User-Agent') || 'Unknown';
  const clientType = userAgent.includes('Dart') ? 'Flutter App' : 
                     userAgent.includes('Mozilla') ? 'Web Browser' : 'Unknown';

  // logger.info(`Token request from ${clientType} (User-Agent: ${userAgent.substring(0, 100)}), user: ${user?.uid || 'unauthenticated'}, room: ${roomName}`);

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
    // logger.info(`Generated token for user ${user.uid} in room ${roomName}`);

    // Create room if it doesn't exist
    try {
      const roomService = new RoomServiceClient(config.livekit.host, config.livekit.apiKey, config.livekit.apiSecret);
      await roomService.createRoom({ name: roomName, emptyTimeout: 30 });
      // logger.info(`Created room ${roomName} with 30s empty timeout`);
    } catch (error) {
      logger.error(`Failed to create room ${roomName}:`, error);
      // Continue without failing the request
    }

    // Update user status
    try {
      const userDocRef = admin.firestore().collection('users').doc(user.uid);
      await userDocRef.update({ isBusy: true });
      // logger.info(`Updated user ${user.uid} status to busy`);
    } catch (error) {
      logger.error(`Failed to update user status for ${user.uid}:`, error);
      // Continue without failing the request
    }

    res.json({ token, host: config.livekit.host });
  } catch (error) {
    logger.error('Error generating token:', error);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

// Helper functions for webhook event handling
async function handleRoomStarted(event: WebhookEvent) {
  if (!event.room) return;
  const room = event.room;
  // logger.info(`Room ${room.name} started`);
}

async function handleParticipantJoined(event: WebhookEvent) {
  if (!event.room) return;
  const room = event.room;
  // logger.info(`Participant ${event.participant?.identity} joined room ${room.name}`);

  const currentJoins = participantJoins.get(room.name) || 0;
  participantJoins.set(room.name, currentJoins + 1);
  // logger.info(`Current joins for room ${room.name}: ${participantJoins.get(room.name)}`);

  await mutex.runExclusive(async () => {
    if (processingRooms.has(room.name)) {
      // logger.info(`Recording already being started for room ${room.name}`);
      return;
    }
    processingRooms.add(room.name);

    try {
      // logger.info(`Checking recording start for room ${room.name}: joins=${participantJoins.get(room.name)}, active=${activeRecordings.has(room.name)}`);
      if (participantJoins.get(room.name)! >= 2 && !activeRecordings.has(room.name)) {
        const egressClient = new EgressClient(config.livekit.host, config.livekit.apiKey, config.livekit.apiSecret);
        const egresses = await egressClient.listEgress({ roomName: room.name });

        if (egresses.length === 0) {
          const s3Upload = new S3Upload({
            accessKey: config.livekit.r2.accessKey,
            secret: config.livekit.r2.secretKey,
            bucket: config.livekit.r2.bucket,
            endpoint: config.livekit.r2.endpoint,
          });
          const now = new Date();
          const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
          const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '');
          // Reverse date and time for descending sort (latest first)
          const dateNum = parseInt(dateStr);
          const timeNum = parseInt(timeStr);
          const revDateStr = (99999999 - dateNum).toString().padStart(8, '0');
          const revTimeStr = (999999 - timeNum).toString().padStart(6, '0');
          const output = new EncodedFileOutput({
            filepath: `recordings/${revDateStr}/${revTimeStr}-${room.name}.mp4`,
            output: { case: 's3', value: s3Upload },
          });

          // Create encoding options for high-quality AAC audio (optimized for human voice)
          const encodingOptions = new EncodingOptions({
            audioCodec: AudioCodec.AAC,
            audioBitrate: 256,        // High quality bitrate for voice
            audioFrequency: 44100,    // CD quality sampling rate
            audioQuality: 5,          // Highest quality setting available
          });

          const egressResponse = await egressClient.startRoomCompositeEgress(room.name, output, { 
            audioOnly: true,
            encodingOptions: encodingOptions,
          });

          activeRecordings.set(room.name, {
            egressId: egressResponse.egressId,
            startTime: new Date(),
          });

          // logger.info(`Started recording ${egressResponse.egressId} for room ${room.name} via webhook (joins: ${participantJoins.get(room.name)})`);
        } else {
          // logger.info(`Egress already exists for room ${room.name}`);
        }
      } else {
        // logger.info(`Not starting recording for room ${room.name}: joins=${participantJoins.get(room.name)}, recording active=${activeRecordings.has(room.name)}`);
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
  // logger.info(`Participant ${event.participant?.identity} left room ${room.name}`);

  // Decrement join count
  const currentJoins = participantJoins.get(room.name) || 0;
  if (currentJoins > 0) {
    participantJoins.set(room.name, currentJoins - 1);
  }
  // logger.info(`Current joins after leave for room ${room.name}: ${participantJoins.get(room.name)}`);

  // Update user status to not busy
  if (event.participant?.identity && !event.participant.identity.startsWith('EG_')) { //recording bot
    try {
      const userDocRef = admin.firestore().collection('users').doc(event.participant.identity);
      await userDocRef.update({ isBusy: false });
      // logger.info(`Updated user ${event.participant.identity} status to not busy`);
    } catch (error) {
      logger.error(`Failed to update user status for ${event.participant.identity}:`, error);
    }
  }

  await stopMutex.runExclusive(async () => {
    const roomService = new RoomServiceClient(config.livekit.host, config.livekit.apiKey, config.livekit.apiSecret);
    const rooms = await roomService.listRooms([room.name]);
    const currentRoom = rooms.length > 0 ? rooms[0] : null;
    // logger.info(`Checking recording stop for room ${room.name}: current participants=${currentRoom?.numParticipants || 0}, joins=${participantJoins.get(room.name)}`);

    if (!currentRoom || currentRoom.numParticipants <= 1) {
      const recording = activeRecordings.get(room.name);
      if (recording) {
        try {
          const egressClient = new EgressClient(config.livekit.host, config.livekit.apiKey, config.livekit.apiSecret);
          await egressClient.stopEgress(recording.egressId);
          // logger.info(`Stopped recording ${recording.egressId} for room ${room.name} via webhook (participants: ${currentRoom?.numParticipants || 0})`);
          activeRecordings.delete(room.name);
        } catch (error) {
          logger.error(`Error stopping recording for room ${room.name}:`, error);
        }
      } else {
        // logger.info(`No active recording to stop for room ${room.name}`);
      }
    } else {
      // logger.info(`Not stopping recording for room ${room.name}: participants=${currentRoom?.numParticipants || 0}`);
    }
  });
}

async function handleRoomFinished(event: WebhookEvent) {
  if (!event.room) return;
  const room = event.room;
  // logger.info(`Room ${room.name} finished`);

  // Clean up
  participantJoins.delete(room.name);

  await stopMutex.runExclusive(async () => {
    const recording = activeRecordings.get(room.name);
    if (recording) {
      try {
        const egressClient = new EgressClient(config.livekit.host, config.livekit.apiKey, config.livekit.apiSecret);
        await egressClient.stopEgress(recording.egressId);
        // logger.info(`Stopped recording ${recording.egressId} for finished room ${room.name}`);
        activeRecordings.delete(room.name);
      } catch (error) {
        logger.error(`Error stopping recording for finished room ${room.name}:`, error);
      }
    } else {
      // logger.info(`No active recording for finished room ${room.name}`);
    }
  });
}

async function handleEgressEnded(event: WebhookEvent) {
  if (!event.egressInfo) return;
  // logger.info(`Egress ${event.egressInfo.egressId} ended for room ${event.egressInfo.roomName}`);

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
    // logger.info(`Received webhook event: ${event.event} for room: ${event.room?.name || 'unknown'}`);

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

    case 'egress_started':
      // logger.info(`Egress started for room ${event.room?.name || 'unknown'}`);
      break;
    case 'egress_updated':
      // logger.info(`Egress updated for room ${event.room?.name || 'unknown'}`);
      break;
    case 'track_published':
      // logger.info(`Track published in room ${event.room?.name || 'unknown'}`);
      break;
    case 'track_unpublished':
      // logger.info(`Track unpublished in room ${event.room?.name || 'unknown'}`);
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

router.get('/recordings', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  

  try {
    console.log('Fetching recordings for user:', user.email);
    console.log('Bucket:', config.livekit.r2.bucket);
    console.log('Endpoint:', `https://${config.livekit.r2.endpoint}`);
    if (user.email !== 'dev.ahmedhany@gmail.com' || !user.email_verified) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // List objects in recordings/
    console.log('Listing objects with prefix: recordings/');
    const listCommand = new ListObjectsV2Command({
      Bucket: config.livekit.r2.bucket,
      Prefix: 'recordings/',
    });

    const listResponse = await s3Client.send(listCommand);
    console.log('List response received, contents length:', listResponse.Contents?.length || 0);
    const recordings = [];

    if (listResponse.Contents) {
      // First, collect JSON files
      const jsonFiles = listResponse.Contents.filter(obj => obj.Key && obj.Key.endsWith('.json'));
      const recordingMap = new Map<string, any>();

      // Fetch and parse JSON files
      for (const obj of jsonFiles) {
        if (obj.Key) {
          console.log('Fetching JSON:', obj.Key);
          try {
            const getCommand = new GetObjectCommand({
              Bucket: config.livekit.r2.bucket,
              Key: obj.Key,
            });
            const response = await s3Client.send(getCommand);
            const body = await response.Body?.transformToString();
            if (body) {
              const data = JSON.parse(body);
              if (data.files && data.files.length > 0) {
                const filename = data.files[0].filename;
                // Use custom domain URL directly from filename
                const location = `https://r2.mehrab-alquran.com/${filename}`;
                recordingMap.set(filename, { location, data });
              }
            }
          } catch (error) {
            console.error('Error fetching JSON:', obj.Key, error);
          }
        }
      }

      // Now, process audio files
      for (const obj of listResponse.Contents) {
        if (obj.Key && obj.Key.includes('.m4a')) {
          console.log('Processing recording:', obj.Key);
          const recording = recordingMap.get(obj.Key);
          const url = recording?.location || 'N/A';

          // Parse key to get date and room
          const parts = obj.Key.split('/');
          if (parts.length >= 3) {
            const revDateStr = parts[1];
            const filename = parts[2];
            const dateNum = 99999999 - parseInt(revDateStr);
            const date = new Date(dateNum / 10000, (dateNum % 10000) / 100 - 1, dateNum % 100);
            const roomName = filename.split('-').slice(1).join('-').replace('.acc', '').replace('.m4a', '').replace('.ogg', '');

            recordings.push({
              key: obj.Key,
              url: url,
              lastModified: obj.LastModified,
              size: obj.Size,
              date: date.toISOString(),
              roomName,
            });
          }
        }
      }
    } else {
      console.log('No contents in list response');
    }

    console.log('Total recordings processed:', recordings.length);
    // Sort by date desc
    recordings.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    res.json({ recordings });
  } catch (error) {
    console.error('Error fetching recordings:', error);
    logger.error('Error fetching recordings:', error);
    res.status(500).json({ error: 'Failed to fetch recordings' });
  }
});

// Admin endpoints for managing egress sessions
router.get('/admin/egress', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  const user = req.user;
  if (!user || user.email !== 'dev.ahmedhany@gmail.com' || !user.email_verified) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const egressClient = new EgressClient(config.livekit.host, config.livekit.apiKey, config.livekit.apiSecret);
    const egresses = await egressClient.listEgress();

    const formattedEgresses = egresses.map(egress => ({
      egressId: egress.egressId,
      roomName: egress.roomName,
      status: egress.status,
      startedAt: egress.startedAt ? new Date(Number(egress.startedAt) * 1000).toISOString() : null,
      endedAt: egress.endedAt ? new Date(Number(egress.endedAt) * 1000).toISOString() : null,
      error: egress.error,
    }));

    res.json({ egresses: formattedEgresses });
  } catch (error) {
    logger.error('Error fetching egress sessions:', error);
    res.status(500).json({ error: 'Failed to fetch egress sessions' });
  }
});

router.post('/admin/egress/:egressId/stop', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  const user = req.user;
  if (!user || user.email !== 'dev.ahmedhany@gmail.com' || !user.email_verified) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { egressId } = req.params;

  try {
    const egressClient = new EgressClient(config.livekit.host, config.livekit.apiKey, config.livekit.apiSecret);
    const result = await egressClient.stopEgress(egressId);

    res.json({
      success: true,
      message: `Egress session ${egressId} stopped successfully`,
      result: {
        egressId: result.egressId,
        status: result.status,
      }
    });
  } catch (error) {
    logger.error(`Error stopping egress ${egressId}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to stop egress session: ${errorMessage}` });
  }
});

export default router;
