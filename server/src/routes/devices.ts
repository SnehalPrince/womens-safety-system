import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../db/index.js';
import { authenticate, type AuthenticatedRequest } from '../utils/auth.js';

export const devicesRouter = Router();
devicesRouter.use(authenticate);

const pairSchema = z.object({
  deviceId: z.string().min(1).max(100),
  simNumber: z.string().max(50).optional(),
});

// POST /api/devices/pair
devicesRouter.post('/pair', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const parsed = pairSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    return;
  }

  const { deviceId, simNumber } = parsed.data;

  // Check if device already paired to another user
  const existing = await query('SELECT user_id FROM devices WHERE device_id = $1', [deviceId]);
  if (existing.rows.length > 0) {
    if (existing.rows[0].user_id !== userId) {
      res.status(409).json({ error: 'Device is already paired to another user' });
      return;
    }
    // Update existing pairing
    const updated = await query(
      'UPDATE devices SET sim_number = $1 WHERE device_id = $2 RETURNING *',
      [simNumber ?? null, deviceId]
    );
    res.status(200).json(updated.rows[0]);
    return;
  }

  // Insert device pairing
  const inserted = await query(
    'INSERT INTO devices (device_id, user_id, sim_number) VALUES ($1, $2, $3) RETURNING *',
    [deviceId, userId, simNumber ?? null]
  );

  res.status(201).json(inserted.rows[0]);
});

// DELETE /api/devices/:deviceId
devicesRouter.delete('/:deviceId', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { deviceId } = req.params;

  const deleted = await query(
    'DELETE FROM devices WHERE device_id = $1 AND user_id = $2 RETURNING device_id',
    [deviceId, userId]
  );

  if (deleted.rows.length === 0) {
    res.status(404).json({ error: 'Device pairing not found or not owned by user' });
    return;
  }

  res.status(200).json({ success: true, message: 'Device unpaired' });
});
