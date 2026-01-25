import { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import { Socket } from 'socket.io';

export interface AuthenticatedRequest extends Request {
  user?: admin.auth.DecodedIdToken | null;
}

export async function verifyFirebaseToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // Temporarily allow non-auth requests
    req.user = null;
    next();
    return;
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    // Temporarily allow even on error
    req.user = null;
    next();
  }
}

export async function verifySocketToken(socket: Socket): Promise<admin.auth.DecodedIdToken | null> {
  const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    console.error('Socket connection rejected: No token provided');
    return null;
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    console.error('Socket token verification failed:', error);
    return null;
  }
}
