import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { authRouter } from './routes/auth.js';
import { contactsRouter } from './routes/contacts.js';
import { devicesRouter } from './routes/devices.js';
import { incidentsRouter } from './routes/incidents.js';
import { adminRouter } from './routes/admin.js';
import { deviceRouter } from './routes/device.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(): express.Application {
  const app = express();

  // Helmet with customized CSP for Leaflet tiles (OpenStreetMap) and WebSockets
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: ["'self'", 'ws:', 'wss:', 'https://*.tile.openstreetmap.org'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org', 'https://unpkg.com/leaflet@1.9.4/'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com/leaflet@1.9.4/'],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          workerSrc: ["'self'", 'blob:'],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  // CORS configuration
  const corsOrigin = process.env.CORS_ORIGIN;
  app.use(
    cors({
      origin: corsOrigin ? corsOrigin.split(',') : true,
      credentials: true,
    })
  );

  app.use(express.json());

  // Rate limiters (skip rate limiting during automated tests)
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest,
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest,
    message: { error: 'Too many authentication attempts. Please try again later.' },
  });

  const deviceLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120, // Accommodates 5-second polling and location updates
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest,
  });

  app.use('/api', globalLimiter);
  app.use('/api/auth', authLimiter);
  app.use('/api/device', deviceLimiter);
  app.use('/api/location', deviceLimiter);

  // Health check endpoint
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // REST API routes
  app.use('/api/auth', authRouter);
  app.use('/api/contacts', contactsRouter);
  app.use('/api/devices', devicesRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', incidentsRouter); // /api/sos, /api/incidents/*
  app.use('/api', deviceRouter);    // /api/location, /api/device/:deviceId/command

  // Static files from built web client
  const clientDistPath = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(clientDistPath)) {
    app.use(express.static(clientDistPath));

    // Client-side SPA routing fallback
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.join(clientDistPath, 'index.html'));
    });
  }

  return app;
}
