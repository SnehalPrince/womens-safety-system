import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { verifyToken } from './utils/auth.js';
import type { AuthTokenPayload } from './types/index.js';

let ioInstance: SocketIOServer | null = null;

export function initSocketIO(httpServer: HttpServer, corsOrigin?: string): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOrigin || '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Authentication middleware
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.headers?.authorization?.startsWith('Bearer ')
        ? socket.handshake.headers.authorization.substring(7)
        : null);

    if (!token) {
      return next(new Error('Authentication required for socket connection'));
    }

    try {
      const payload = verifyToken(token);
      socket.data.user = payload;
      next();
    } catch (err) {
      return next(new Error('Invalid socket authentication token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user: AuthTokenPayload = socket.data.user;

    // Join user room
    socket.join(`user:${user.userId}`);

    // Join admin room if role is admin
    if (user.role === 'admin') {
      socket.join('admins');
    }

    socket.on('disconnect', () => {
      // Clean disconnect
    });
  });

  ioInstance = io;
  return io;
}

export function getIO(): SocketIOServer | null {
  return ioInstance;
}

export function emitIncidentNew(payload: { incident: any; user: any; location?: any }): void {
  if (!ioInstance) return;
  ioInstance.to('admins').emit('incident:new', payload);
  if (payload.incident?.user_id) {
    ioInstance.to(`user:${payload.incident.user_id}`).emit('incident:new', payload);
  }
}

export function emitIncidentLocation(incidentId: number, location: any, userId: number): void {
  if (!ioInstance) return;
  const payload = { incidentId, location };
  ioInstance.to('admins').emit('incident:location', payload);
  ioInstance.to(`user:${userId}`).emit('incident:location', payload);
}

export function emitIncidentStatus(
  incidentId: number,
  status: string,
  userId: number,
  extra?: { resolvedAt?: any; acknowledgedBy?: any; notes?: any }
): void {
  if (!ioInstance) return;
  const payload = { incidentId, status, ...extra };
  ioInstance.to('admins').emit('incident:status', payload);
  ioInstance.to(`user:${userId}`).emit('incident:status', payload);
}

export function emitMessageNew(incidentId: number, message: any, userId: number): void {
  if (!ioInstance) return;
  const payload = { incidentId, message };
  ioInstance.to('admins').emit('message:new', payload);
  ioInstance.to(`user:${userId}`).emit('message:new', payload);
}
