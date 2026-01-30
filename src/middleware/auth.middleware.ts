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

  console.log('Auth header present:', !!authHeader);
  if (authHeader) {
    console.log('Auth header starts with Bearer:', authHeader.startsWith('Bearer '));
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('No valid auth header, allowing as guest');
    // Temporarily allow non-auth requests
    req.user = null;
    next();
    return;
  }

  const token = authHeader.split('Bearer ')[1];

  console.log('Token extracted, length:', token ? token.length : 0);
  if (!token || token.length < 100) {
    console.log('Token is empty or too short, allowing as guest');
    // Invalid token format or too short
    req.user = null;
    next();
    return;
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    console.log('Token verified successfully for user:', decodedToken.uid);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Token verification failed for valid-length token:', error);
    console.log('Failed token (first 50 chars):', token.substring(0, 50));
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
