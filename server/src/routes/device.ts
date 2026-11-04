import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query } from '../db/index.js';
import { deviceAuthMiddleware } from '../utils/deviceAuth.js';
import { consumeNextCommand } from '../services/commandQueue.js';
import { emitIncidentNew, emitIncidentLocation, emitIncidentStatus } from '../socket.js';

export const deviceRouter = Router();

// Apply device authentication to all hardware endpoints
deviceRouter.use(deviceAuthMiddleware);

const locationPayloadSchema = z.object({
  deviceId: z.string().min(1),
  event: z.enum(['sos_start', 'sos_update', 'sos_cancel']),
  lat: z.number(),
  lng: z.number(),
  fix: z.boolean(),
  accuracy: z.number().optional(),
});

// POST /api/location (Band to server)
deviceRouter.post('/location', async (req: Request, res: Response): Promise<void> => {
  const parseResult = locationPayloadSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'Invalid location payload', details: parseResult.error.errors });
    return;
  }

  const { deviceId, event, lat, lng, fix, accuracy } = parseResult.data;

  // 1. Find device and paired user
  const deviceRes = await query(
    'SELECT device_id, user_id FROM devices WHERE device_id = $1',
    [deviceId]
  );

  if (deviceRes.rows.length === 0) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }

  const { user_id: userId } = deviceRes.rows[0];

  // Update last seen timestamp on device
  await query('UPDATE devices SET last_seen_at = CURRENT_TIMESTAMP WHERE device_id = $1', [deviceId]);

  if (event === 'sos_start') {
    // Check if an open incident already exists for this user
    const incidentRes = await query(
      `SELECT * FROM incidents 
       WHERE user_id = $1 AND status IN ('open', 'acknowledged') 
       ORDER BY started_at DESC LIMIT 1`,
      [userId]
    );

    let incident = incidentRes.rows[0];
    let isNewIncident = false;

    if (!incident) {
      const newInc = await query(
        `INSERT INTO incidents (user_id, status, source) 
         VALUES ($1, 'open', 'band') 
         RETURNING *`,
        [userId]
      );
      incident = newInc.rows[0];
      isNewIncident = true;
    }

    let locationPoint = null;
    if (fix) {
      const locRes = await query(
        `INSERT INTO locations (incident_id, lat, lng, accuracy, source) 
         VALUES ($1, $2, $3, $4, 'band') 
         RETURNING *`,
        [incident.id, lat, lng, accuracy ?? null]
      );
      locationPoint = locRes.rows[0];
    }

    // Fetch user details for notification
    const userRes = await query('SELECT id, name, phone FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0];

    if (isNewIncident) {
      emitIncidentNew({
        incident,
        user,
        location: locationPoint,
      });
    } else if (locationPoint) {
      emitIncidentLocation(incident.id, locationPoint, userId);
    }
  } else if (event === 'sos_update') {
    // Append location to open incident
    const openIncidentRes = await query(
      `SELECT id FROM incidents 
       WHERE user_id = $1 AND status IN ('open', 'acknowledged') 
       ORDER BY started_at DESC LIMIT 1`,
      [userId]
    );

    if (openIncidentRes.rows.length > 0 && fix) {
      const incidentId = openIncidentRes.rows[0].id;
      const locRes = await query(
        `INSERT INTO locations (incident_id, lat, lng, accuracy, source) 
         VALUES ($1, $2, $3, $4, 'band') 
         RETURNING *`,
        [incidentId, lat, lng, accuracy ?? null]
      );
      emitIncidentLocation(incidentId, locRes.rows[0], userId);
    }
  } else if (event === 'sos_cancel') {
    // Mark open incident as cancelled
    const openIncidentRes = await query(
      `SELECT id FROM incidents 
       WHERE user_id = $1 AND status IN ('open', 'acknowledged') 
       ORDER BY started_at DESC LIMIT 1`,
      [userId]
    );

    if (openIncidentRes.rows.length > 0) {
      const incidentId = openIncidentRes.rows[0].id;
      await query(
        `UPDATE incidents 
         SET status = 'cancelled', resolved_at = CURRENT_TIMESTAMP, notes = 'Cancelled from hardware band' 
         WHERE id = $1`,
        [incidentId]
      );
      emitIncidentStatus(incidentId, 'cancelled', userId, { notes: 'Cancelled from hardware band' });
    }
  }

  // Fast response for band timeout (<3s)
  res.status(200).json({ ok: true });
});

// GET /api/device/:deviceId/command (Band polling every 5s)
// MUST return EXACTLY ONE of: {"command":"sos"} | {"command":"stop"} | {"command":"none"}
// Without any other fields or text containing those words
deviceRouter.get('/device/:deviceId/command', async (req: Request, res: Response): Promise<void> => {
  const { deviceId } = req.params;

  const deviceRes = await query('SELECT device_id FROM devices WHERE device_id = $1', [deviceId]);
  if (deviceRes.rows.length === 0) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }

  // Update last seen
  await query('UPDATE devices SET last_seen_at = CURRENT_TIMESTAMP WHERE device_id = $1', [deviceId]);

  const command = await consumeNextCommand(deviceId);

  // Return exactly the expected JSON format
  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(JSON.stringify({ command }));
});
