import { Server, Socket } from 'socket.io';
import admin from 'firebase-admin';
import { verifySocketToken } from '../middleware/auth.middleware';
import { getIceServerConfig } from '../services/turn-credential.service';

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
}

interface RoomState {
  participants: Map<string, RoomParticipant>;
  createdAt: Date;
}

const rooms = new Map<string, RoomState>();

export function setupSocketHandlers(io: Server): void {
  io.use(async (socket, next) => {
    // Temporarily allow non-auth users
    const user = await verifySocketToken(socket);
    socket.data.user = user; // Can be null for non-auth users
    next();
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as admin.auth.DecodedIdToken | null;
    const userId = user ? user.uid : `guest-${socket.id}`;
    console.log(`User connected: ${userId} (socket: ${socket.id})`);

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

    socket.on('get-ice-config', (callback: (config: ReturnType<typeof getIceServerConfig>) => void) => {
      const iceConfig = getIceServerConfig(userId);
      callback(iceConfig);
    });

    socket.on('disconnect', () => {
      handleDisconnect(io, socket, userId);
    });
  });
}

function handleJoinRoom(io: Server, socket: Socket, callId: string, odId: string): void {
  console.log(`User ${odId} joining room ${callId}`);

  let room = rooms.get(callId);
  if (!room) {
    room = {
      participants: new Map(),
      createdAt: new Date(),
    };
    rooms.set(callId, room);
  }

  const existingParticipant = Array.from(room.participants.values()).find(p => p.odId === odId);
  if (existingParticipant) {
    console.log(`User ${odId} already in room, updating socket ID`);
    room.participants.delete(existingParticipant.socketId);
  }

  room.participants.set(socket.id, {
    socketId: socket.id,
    odId,
    joinedAt: new Date(),
  });

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

  console.log(`Room ${callId} now has ${room.participants.size} participants`);
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
  console.log(`User ${odId} leaving room ${callId}`);

  const room = rooms.get(callId);
  if (room) {
    room.participants.delete(socket.id);
    socket.leave(callId);

    socket.to(callId).emit('user-left', {
      odId,
      socketId: socket.id,
    });

    if (room.participants.size === 0) {
      rooms.delete(callId);
      console.log(`Room ${callId} deleted (empty)`);
    }
  }
}

function handleDisconnect(io: Server, socket: Socket, odId: string): void {
  console.log(`User ${odId} disconnected (socket: ${socket.id})`);

  for (const [callId, room] of rooms.entries()) {
    if (room.participants.has(socket.id)) {
      room.participants.delete(socket.id);

      socket.to(callId).emit('user-left', {
        odId,
        socketId: socket.id,
      });

      if (room.participants.size === 0) {
        rooms.delete(callId);
        console.log(`Room ${callId} deleted (empty after disconnect)`);
      }
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
