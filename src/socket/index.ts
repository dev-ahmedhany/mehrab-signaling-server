import { Server, Socket } from 'socket.io';
import admin from 'firebase-admin';
import { verifySocketToken, verifyAdminSocketToken } from '../middleware/auth.middleware';
import { getIceServerConfig, IceServerConfig } from '../services/turn-credential.service';
import { getUsersInfo } from '../services/user.service';

// WebRTC types (server just forwards these, doesn't process them)
interface RTCSessionDescriptionInit {
  type?: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp?: string;
}

interface RTCIceCandidateInit {
  candidate?: string;
  sdpMLineIndex?: number | null;
  sdpMid?: string | null;
  usernameFragment?: string | null;
}

interface RoomParticipant {
  socketId: string;
  odId: string;
  joinedAt: Date;
  displayName?: string;
}

interface RoomState {
  participants: Map<string, RoomParticipant>;
  createdAt: Date;
  callConnectedAt?: Date;
}

export interface LogEntry {
  timestamp: Date;
  type: 'info' | 'warning' | 'error' | 'connection' | 'call';
  message: string;
  roomId?: string;
  userId?: string;
  socketId?: string;
}

// Helper to set user busy status if they are a teacher
async function setUserBusy(uid: string, busy: boolean): Promise<void> {
  if (uid.startsWith('guest-')) return; // Skip guests

  try {
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    if (userDoc.exists && userDoc.data()?.isOnline !== undefined) {
      // It's a teacher
      await admin.firestore().collection('users').doc(uid).update({ isBusy: busy });
      addLog({
        type: 'info',
        message: `Set teacher ${uid} busy: ${busy}`,
        userId: uid,
      });
    }
  } catch (error) {
    console.error(`Error setting busy for ${uid}:`, error);
  }
}

export interface RoomInfo {
  roomId: string;
  createdAt: Date;
  callConnectedAt?: Date;
  duration: number;
  participants: ParticipantInfo[];
}

// Note: Room persistence removed - clients now handle reconnection by remembering their room ID
// and rejoining automatically. The grace period mechanism handles temporary disconnections.

const rooms = new Map<string, RoomState>();
const logs: LogEntry[] = [];
const MAX_LOGS = 500;

// Track pending disconnections for grace period
const pendingDisconnections = new Map<string, NodeJS.Timeout>(); // odId -> timeout
const DISCONNECT_GRACE_PERIOD = 15000; // 15 seconds grace period for reconnection

// Store io instance for admin broadcasts
let ioInstance: Server | null = null;

// Helper to add log entry
function addLog(entry: Omit<LogEntry, 'timestamp'>): void {
  const logEntry: LogEntry = {
    ...entry,
    timestamp: new Date(),
  };
  logs.unshift(logEntry);
  if (logs.length > MAX_LOGS) {
    logs.pop();
  }
  console.log(`[${entry.type.toUpperCase()}] ${entry.message}`);

  // Broadcast to admin dashboard
  broadcastAdminUpdate();
}

// Broadcast updates to admin dashboard
async function broadcastAdminUpdate(): Promise<void> {
  if (ioInstance) {
    const stats = await getDetailedStats();
    ioInstance.to('admin-room').emit('admin-stats', stats);
  }
}

// Export function to get all active rooms with details (async to fetch user info)
export async function getActiveRooms(): Promise<RoomInfo[]> {
  const now = new Date();
  const activeRooms: RoomInfo[] = [];

  // Collect all user IDs to batch fetch
  const allUserIds: string[] = [];
  for (const room of rooms.values()) {
    for (const participant of room.participants.values()) {
      if (!participant.odId.startsWith('guest-')) {
        allUserIds.push(participant.odId);
      }
    }
  }

  // Batch fetch user info from Firestore
  const usersInfo = await getUsersInfo(allUserIds);

  for (const [roomId, room] of rooms.entries()) {
    const participants: ParticipantInfo[] = Array.from(room.participants.values()).map(p => {
      const userInfo = usersInfo.get(p.odId);
      return {
        odId: p.odId,
        socketId: p.socketId,
        joinedAt: p.joinedAt,
        duration: Math.floor((now.getTime() - p.joinedAt.getTime()) / 1000),
        displayName: userInfo?.displayName || p.displayName || 'Unknown',
        photoURL: userInfo?.photoURL || null,
        deviceModel: userInfo?.deviceModel,
        deviceVersion: userInfo?.deviceVersion,
        countryCode: userInfo?.countryCode,
        phoneNumber: userInfo?.phoneNumber,
        countryCodeNumber: userInfo?.countryCodeNumber,
      };
    });

    activeRooms.push({
      roomId,
      createdAt: room.createdAt,
      callConnectedAt: room.callConnectedAt,
      duration: Math.floor((now.getTime() - room.createdAt.getTime()) / 1000),
      participants,
    });
  }

  return activeRooms;
}

// Export function to get logs
export function getLogs(limit: number = 100): LogEntry[] {
  return logs.slice(0, limit);
}

// Export function to get detailed stats
export async function getDetailedStats(): Promise<{
  totalRooms: number;
  totalParticipants: number;
  activeRooms: RoomInfo[];
  recentLogs: LogEntry[];
  serverUptime: number;
}> {
  return {
    totalRooms: rooms.size,
    totalParticipants: Array.from(rooms.values()).reduce((acc, room) => acc + room.participants.size, 0),
    activeRooms: await getActiveRooms(),
    recentLogs: getLogs(50),
    serverUptime: Math.floor(process.uptime()),
  };
}

export function setupSocketHandlers(io: Server): void {
  ioInstance = io;

  io.use(async (socket, next) => {
    // Temporarily allow non-auth users
    const user = await verifySocketToken(socket);
    socket.data.user = user; // Can be null for non-auth users
    next();
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as admin.auth.DecodedIdToken | null;
    const userId = user ? user.uid : `guest-${socket.id}`;

    addLog({
      type: 'connection',
      message: `User connected: ${userId}`,
      userId,
      socketId: socket.id,
    });

    socket.on('join-room', (data: { callId: string }) => {
      handleJoinRoom(io, socket, data.callId, userId);
    });

    socket.on('offer', (data: { offer: RTCSessionDescriptionInit; to: string }) => {
      handleOffer(socket, data);
    });

    socket.on('answer', (data: { answer: RTCSessionDescriptionInit; to: string }) => {
      handleAnswer(socket, data);
    });

    socket.on('ice-candidate', (data: { candidate: RTCIceCandidateInit; to: string }) => {
      handleIceCandidate(socket, data);
    });

    socket.on('video-state', (data: { enabled: boolean; to: string }) => {
      handleVideoState(socket, data);
    });

    socket.on('leave-room', (data: { callId: string }) => {
      handleLeaveRoom(io, socket, data.callId, userId);
    });

    // Admin dashboard support - requires admin authentication
    socket.on('admin-subscribe', async () => {
      const adminUser = await verifyAdminSocketToken(socket);

      if (!adminUser) {
        socket.emit('admin-error', { error: 'Admin access required' });
        return;
      }

      socket.join('admin-room');

      // Send current stats immediately
      const stats = await getDetailedStats();
      socket.emit('admin-stats', stats);
    });

    socket.on('get-ice-config', async (callback: (config: IceServerConfig) => void) => {
      try {
        const iceConfig = await getIceServerConfig(userId);
        callback(iceConfig);
      } catch (error) {
        console.error(`Error getting ICE config for ${userId}:`, error);
        // Fallback to default config
        const iceConfig = await getIceServerConfig(userId);
        callback(iceConfig);
      }
    });

    socket.on('disconnect', () => {
      handleDisconnect(io, socket, userId);
    });
  });
}

function handleJoinRoom(io: Server, socket: Socket, callId: string, odId: string): void {
  // Cancel any pending disconnection for this user in this room
  const disconnectKey = `${odId}:${callId}`;
  if (pendingDisconnections.has(disconnectKey)) {
    clearTimeout(pendingDisconnections.get(disconnectKey));
    pendingDisconnections.delete(disconnectKey);
    addLog({
      type: 'info',
      message: `Cancelled pending disconnection for user ${odId} in room ${callId}`,
      roomId: callId,
      userId: odId,
      socketId: socket.id,
    });
  }

  let room = rooms.get(callId);

  if (!room) {
    room = {
      participants: new Map(),
      createdAt: new Date(),
    };
    rooms.set(callId, room);

    addLog({
      type: 'call',
      message: `New call room created: ${callId}`,
      roomId: callId,
      userId: odId,
    });
  }

  const existingParticipant = Array.from(room.participants.values()).find(p => p.odId === odId);
  if (existingParticipant) {
    addLog({
      type: 'info',
      message: `User ${odId} reconnected to room, updating socket ID`,
      roomId: callId,
      userId: odId,
      socketId: socket.id,
    });
    room.participants.delete(existingParticipant.socketId);
  }

  room.participants.set(socket.id, {
    socketId: socket.id,
    odId,
    joinedAt: new Date(),
  });

  // Set teacher busy when joining room
  setUserBusy(odId, true);

  // Mark call as connected when second participant joins
  if (room.participants.size === 2 && !room.callConnectedAt) {
    room.callConnectedAt = new Date();
    addLog({
      type: 'call',
      message: `Call connected in room ${callId}`,
      roomId: callId,
    });
  }

  socket.join(callId);

  const otherParticipants = Array.from(room.participants.values())
    .filter(p => p.socketId !== socket.id)
    .map(p => ({ odId: p.odId, socketId: p.socketId }));

  socket.emit('room-joined', {
    callId,
    participants: otherParticipants,
  });

  socket.to(callId).emit('user-joined', {
    odId,
    socketId: socket.id,
  });

  addLog({
    type: 'info',
    message: `User ${odId} joined room ${callId} (${room.participants.size} participants)`,
    roomId: callId,
    userId: odId,
    socketId: socket.id,
  });
}

function handleOffer(socket: Socket, data: { offer: RTCSessionDescriptionInit; to: string }): void {
  console.log(`Forwarding offer from ${socket.id} to ${data.to}`);

  const user = socket.data.user as admin.auth.DecodedIdToken | null;
  const fromUid = user ? user.uid : `guest-${socket.id}`;

  socket.to(data.to).emit('offer', {
    offer: data.offer,
    from: socket.id,
    fromUid,
  });
}

function handleAnswer(socket: Socket, data: { answer: RTCSessionDescriptionInit; to: string }): void {
  console.log(`Forwarding answer from ${socket.id} to ${data.to}`);

  const user = socket.data.user as admin.auth.DecodedIdToken | null;
  const fromUid = user ? user.uid : `guest-${socket.id}`;

  socket.to(data.to).emit('answer', {
    answer: data.answer,
    from: socket.id,
    fromUid,
  });
}

function handleIceCandidate(socket: Socket, data: { candidate: RTCIceCandidateInit; to: string }): void {
  socket.to(data.to).emit('ice-candidate', {
    candidate: data.candidate,
    from: socket.id,
  });
}

function handleVideoState(socket: Socket, data: { enabled: boolean; to: string }): void {
  console.log(`Forwarding video state (${data.enabled}) from ${socket.id} to ${data.to}`);
  socket.to(data.to).emit('video-state', {
    enabled: data.enabled,
    from: socket.id,
  });
}

function handleLeaveRoom(io: Server, socket: Socket, callId: string, odId: string): void {
  // Clear any pending disconnection since user is explicitly leaving
  const disconnectKey = `${odId}:${callId}`;
  if (pendingDisconnections.has(disconnectKey)) {
    clearTimeout(pendingDisconnections.get(disconnectKey));
    pendingDisconnections.delete(disconnectKey);
  }

  const room = rooms.get(callId);
  if (room) {
    const participant = room.participants.get(socket.id);
    const duration = participant
      ? Math.floor((new Date().getTime() - participant.joinedAt.getTime()) / 1000)
      : 0;

    room.participants.delete(socket.id);
    socket.leave(callId);

    // Set teacher not busy when leaving room
    setUserBusy(odId, false);

    socket.to(callId).emit('user-left', {
      odId,
      socketId: socket.id,
    });

    addLog({
      type: 'info',
      message: `User ${odId} left room ${callId} after ${duration}s`,
      roomId: callId,
      userId: odId,
      socketId: socket.id,
    });

    if (room.participants.size === 0) {
      const roomDuration = Math.floor((new Date().getTime() - room.createdAt.getTime()) / 1000);
      rooms.delete(callId);

      addLog({
        type: 'call',
        message: `Call ended in room ${callId} (duration: ${roomDuration}s)`,
        roomId: callId,
      });
    }
  }
}

function handleDisconnect(io: Server, socket: Socket, odId: string): void {
  addLog({
    type: 'connection',
    message: `User ${odId} disconnected, starting grace period`,
    userId: odId,
    socketId: socket.id,
  });

  // Find the room this user was in
  for (const [callId, room] of rooms.entries()) {
    if (room.participants.has(socket.id)) {
      const participant = room.participants.get(socket.id);

      // Store the disconnect info for grace period
      const disconnectKey = `${odId}:${callId}`;

      // Clear any existing pending disconnection for this user
      if (pendingDisconnections.has(disconnectKey)) {
        clearTimeout(pendingDisconnections.get(disconnectKey));
      }

      // Set a grace period before actually removing the user
      const timeout = setTimeout(() => {
        pendingDisconnections.delete(disconnectKey);

        // Check if user has reconnected (socket ID would be different)
        const currentParticipant = Array.from(room.participants.values()).find(p => p.odId === odId);
        if (currentParticipant && currentParticipant.socketId !== socket.id) {
          // User has reconnected with a new socket, don't remove them
          addLog({
            type: 'info',
            message: `User ${odId} reconnected to room ${callId} within grace period`,
            roomId: callId,
            userId: odId,
          });
          return;
        }

        // User didn't reconnect, remove them from the room
        const duration = participant
          ? Math.floor((new Date().getTime() - participant.joinedAt.getTime()) / 1000)
          : 0;

        room.participants.delete(socket.id);

        // Set teacher not busy when removed after grace period
        setUserBusy(odId, false);

        // Notify remaining participants
        io.to(callId).emit('user-left', {
          odId,
          socketId: socket.id,
        });

        addLog({
          type: 'warning',
          message: `User ${odId} removed from room ${callId} after grace period (${duration}s in call)`,
          roomId: callId,
          userId: odId,
          socketId: socket.id,
        });

        if (room.participants.size === 0) {
          const roomDuration = Math.floor((new Date().getTime() - room.createdAt.getTime()) / 1000);
          rooms.delete(callId);

          addLog({
            type: 'call',
            message: `Call ended in room ${callId} due to disconnect (duration: ${roomDuration}s)`,
            roomId: callId,
          });
        }
      }, DISCONNECT_GRACE_PERIOD);

      pendingDisconnections.set(disconnectKey, timeout);

      addLog({
        type: 'info',
        message: `Grace period started for user ${odId} in room ${callId} (${DISCONNECT_GRACE_PERIOD / 1000}s)`,
        roomId: callId,
        userId: odId,
        socketId: socket.id,
      });
    }
  }
}

export function getRoomStats(): { totalRooms: number; totalParticipants: number } {
  let totalParticipants = 0;
  for (const room of rooms.values()) {
    totalParticipants += room.participants.size;
  }
  return {
    totalRooms: rooms.size,
    totalParticipants,
  };
}
