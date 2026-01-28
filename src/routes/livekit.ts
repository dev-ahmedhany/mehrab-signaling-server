import { Router } from 'express';
import { AccessToken } from 'livekit-server-sdk';
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

  if (!config.livekit.apiKey || !config.livekit.apiSecret) {
    console.error('LiveKit API key or secret not configured');
    return res.status(500).json({ error: 'LiveKit server not configured' });
  }

  const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: user.uid,
    name: participantName,
  });

  at.addGrant({ roomJoin: true, room: roomName });

  const token = await at.toJwt();

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
