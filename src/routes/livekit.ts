import { Router } from 'express';
import { AccessToken, EgressClient, EncodedFileOutput, S3Upload, RoomServiceClient } from 'livekit-server-sdk';
import { verifyFirebaseToken, AuthenticatedRequest } from '../middleware/auth.middleware';
import { config } from '../config';
import admin from 'firebase-admin';

const router = Router();

router.post('/token', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
  const { roomName, participantName } = req.body;
  const user = req.user;

  if (!roomName || !participantName) {
    return res.status(400).json({ error: 'Missing roomName or participantName' });
  }

  if (!user) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  if (!config.livekit.apiKey || !config.livekit.apiSecret || !config.livekit.host) {
    console.error('LiveKit API key, secret, or host not configured');
    return res.status(500).json({ error: 'LiveKit server not configured' });
  }

  if (!config.livekit.r2.accessKey || !config.livekit.r2.secretKey || !config.livekit.r2.bucket || !config.livekit.r2.endpoint) {
    console.error('LiveKit R2 credentials not configured');
    return res.status(500).json({ error: 'LiveKit R2 storage not configured' });
  }

  const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: user.uid,
    name: participantName,
  });

  at.addGrant({ roomJoin: true, room: roomName });

  const token = await at.toJwt();

  // Start recording if not already started
  try {
    const roomService = new RoomServiceClient(config.livekit.host, config.livekit.apiKey, config.livekit.apiSecret);
    await roomService.createRoom({ name: roomName });
    
    const egressClient = new EgressClient(config.livekit.host, config.livekit.apiKey, config.livekit.apiSecret);
    const egresses = await egressClient.listEgress({ roomName });
    if (egresses.length === 0) {
      // Start room composite egress for recording
      const s3Upload = new S3Upload({
        accessKey: config.livekit.r2.accessKey,
        secret: config.livekit.r2.secretKey,
        bucket: config.livekit.r2.bucket,
        endpoint: config.livekit.r2.endpoint,
      });
      const output = new EncodedFileOutput({
        filepath: `recordings/${roomName}-${Date.now()}.mp4`,
        output: { case: 's3', value: s3Upload },
      });
      await egressClient.startRoomCompositeEgress(roomName, output);
    }
  } catch (error) {
    console.error(`Failed to start recording for room ${roomName}`, error);
    // Continue without failing the request
  }

  try {
    const userDocRef = admin.firestore().collection('users').doc(user.uid);
    await userDocRef.update({ isBusy: true });
  } catch (error) {
    console.error(`Failed to update user status for ${user.uid}`, error);
    // Continue without failing the request
  }

  res.json({ token });
});

export default router;
