import { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import { Socket } from 'socket.io';

export interface AuthenticatedRequest extends Request {
  user?: admin.auth.DecodedIdToken | null;
}

// Admin email whitelist
const ADMIN_EMAILS = ['dev.ahmedhany@gmail.com'];

export function isAdminEmail(email: string | undefined): boolean {
  return email ? ADMIN_EMAILS.includes(email.toLowerCase()) : false;
}

export async function verifyFirebaseToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
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
  } catch {
    return null;
  }
}

// Admin-only middleware - requires authentication and admin email
export async function verifyAdminToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);

    if (!isAdminEmail(decodedToken.email)) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Admin token verification failed:', error);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Verify admin for socket connections
export async function verifyAdminSocketToken(socket: Socket): Promise<admin.auth.DecodedIdToken | null> {
  const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return null;
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);

    if (!isAdminEmail(decodedToken.email)) {
      return null;
    }

    return decodedToken;
  } catch (error) {
    console.error('Admin socket token verification failed:', error);
    return null;
  }
}
