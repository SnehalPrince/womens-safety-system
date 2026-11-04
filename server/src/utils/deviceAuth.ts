import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export function verifyDeviceApiKey(apiKeyFromHeader: string | undefined): boolean {
  const configuredKey = process.env.DEVICE_API_KEY;
  if (!configuredKey || !apiKeyFromHeader) {
    return false;
  }

  // Hash both with sha256 to guarantee identical buffer lengths for timingSafeEqual
  const keyHash = crypto.createHash('sha256').update(configuredKey).digest();
  const headerHash = crypto.createHash('sha256').update(apiKeyFromHeader).digest();

  return crypto.timingSafeEqual(keyHash, headerHash);
}

export function deviceAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'];

  if (typeof apiKey !== 'string' || !verifyDeviceApiKey(apiKey)) {
    res.status(401).json({ error: 'Unauthorized device: invalid or missing API key' });
    return;
  }

  next();
}
