import http from 'node:http';
import dotenv from 'dotenv';
import { createApp } from './app.js';
import { initSocketIO } from './socket.js';
import { initDb } from './db/index.js';
import { startRetentionJob, stopRetentionJob } from './jobs/retention.js';

dotenv.config();

const port = Number.parseInt(process.env.PORT || '3000', 10);

async function bootstrap() {
  try {
    // 1. Initialize database (Postgres or pg-mem zero-setup fallback) and seed admin
    await initDb();
    console.log('[DB] Database initialized successfully');

    // 2. Start retention cleanup job
    startRetentionJob();
    console.log('[RETENTION] Privacy retention job scheduled');

    // 3. Create Express app and HTTP server
    const app = createApp();
    const server = http.createServer(app);

    // 4. Initialize Socket.IO
    initSocketIO(server, process.env.CORS_ORIGIN);
    console.log('[SOCKET] Socket.IO server initialized');

    // 5. Start listening
    server.listen(port, () => {
      console.log(`[SERVER] Personal Safety System server listening on port ${port}`);
    });

    // Graceful shutdown
    const shutdown = () => {
      console.log('[SERVER] Shutting down gracefully...');
      stopRetentionJob();
      server.close(() => {
        console.log('[SERVER] Closed all connections.');
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('[FATAL] Failed to bootstrap server:', err);
    process.exit(1);
  }
}

bootstrap();
