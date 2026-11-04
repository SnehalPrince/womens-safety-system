import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../db/index.js';
import { authenticate, type AuthenticatedRequest } from '../utils/auth.js';
import { enqueueCommand } from '../services/commandQueue.js';
import { emitIncidentNew, emitIncidentLocation, emitIncidentStatus, emitMessageNew } from '../socket.js';

export const incidentsRouter = Router();

const sosTriggerSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number().optional(),
});

const locationUpdateSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number().optional(),
});

const messageSchema = z.object({
  body: z.string().min(1).max(2000),
});

// POST /api/sos (Trigger SOS from Web App)
incidentsRouter.post('/sos', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const parsed = sosTriggerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    return;
  }

  const { lat, lng, accuracy } = parsed.data;

  // Check if user already has an active incident
  const incidentRes = await query(
    `SELECT * FROM incidents 
     WHERE user_id = $1 AND status IN ('open', 'acknowledged') 
     ORDER BY started_at DESC LIMIT 1`,
    [userId]
  );

  let incident = incidentRes.rows[0];
  let isNew = false;

  if (!incident) {
    const newInc = await query(
      `INSERT INTO incidents (user_id, status, source) 
       VALUES ($1, 'open', 'app') 
       RETURNING *`,
      [userId]
    );
    incident = newInc.rows[0];
    isNew = true;
  }

  // Insert location point
  const locRes = await query(
    `INSERT INTO locations (incident_id, lat, lng, accuracy, source) 
     VALUES ($1, $2, $3, $4, 'app') 
     RETURNING *`,
    [incident.id, lat, lng, accuracy ?? null]
  );
  const location = locRes.rows[0];

  // Fetch user info for admin alert and hardware dispatch
  const userRes = await query('SELECT id, name, phone FROM users WHERE id = $1', [userId]);
  const user = userRes.rows[0];

  // Fetch emergency contact for this victim (priority #1)
  const contactRes = await query(
    'SELECT phone FROM contacts WHERE user_id = $1 ORDER BY priority ASC, id ASC LIMIT 1',
    [userId]
  );
  const targetPhone = contactRes.rows.length > 0 ? contactRes.rows[0].phone : user.phone;

  // Enqueue SOS command to shared hardware band-001 and all registered bands
  const devicesRes = await query('SELECT device_id FROM devices');
  const targetDevices = devicesRes.rows.length > 0 ? devicesRes.rows : [{ device_id: 'band-001' }];

  for (const dev of targetDevices) {
    await enqueueCommand(dev.device_id, 'sos', {
      victimName: user.name,
      victimPhone: user.phone,
      targetPhone: targetPhone,
      lat: location.lat,
      lng: location.lng,
    });
  }

  if (isNew) {
    emitIncidentNew({
      incident,
      user,
      location,
    });
  } else {
    emitIncidentLocation(incident.id, location, userId);
  }

  res.status(201).json({ incident, location });
});

// GET /api/incidents/active
incidentsRouter.get('/incidents/active', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;

  const incidentRes = await query(
    `SELECT * FROM incidents 
     WHERE user_id = $1 AND status IN ('open', 'acknowledged') 
     ORDER BY started_at DESC LIMIT 1`,
    [userId]
  );

  if (incidentRes.rows.length === 0) {
    res.status(200).json({ active: false, incident: null });
    return;
  }

  const incident = incidentRes.rows[0];

  // Fetch locations
  const locRes = await query(
    `SELECT id, lat, lng, accuracy, source, recorded_at 
     FROM locations 
     WHERE incident_id = $1 
     ORDER BY recorded_at ASC`,
    [incident.id]
  );

  // Fetch messages
  const msgRes = await query(
    `SELECT id, incident_id, sender, body, created_at 
     FROM messages 
     WHERE incident_id = $1 
     ORDER BY created_at ASC`,
    [incident.id]
  );

  res.status(200).json({
    active: true,
    incident,
    locations: locRes.rows,
    messages: msgRes.rows,
  });
});

// POST /api/incidents/:id/location
incidentsRouter.post('/incidents/:id/location', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const incidentId = Number.parseInt(req.params.id, 10);

  const parsed = locationUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    return;
  }

  // Verify incident belongs to user and is active
  const incRes = await query(
    `SELECT id FROM incidents 
     WHERE id = $1 AND user_id = $2 AND status IN ('open', 'acknowledged')`,
    [incidentId, userId]
  );

  if (incRes.rows.length === 0) {
    res.status(404).json({ error: 'Active incident not found' });
    return;
  }

  const { lat, lng, accuracy } = parsed.data;
  const locRes = await query(
    `INSERT INTO locations (incident_id, lat, lng, accuracy, source) 
     VALUES ($1, $2, $3, $4, 'app') 
     RETURNING *`,
    [incidentId, lat, lng, accuracy ?? null]
  );

  const location = locRes.rows[0];
  emitIncidentLocation(incidentId, location, userId);

  res.status(201).json(location);
});

// POST /api/incidents/:id/resolve (User: "I'm safe")
incidentsRouter.post('/incidents/:id/resolve', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const incidentId = Number.parseInt(req.params.id, 10);

  const incRes = await query(
    'SELECT * FROM incidents WHERE id = $1 AND user_id = $2',
    [incidentId, userId]
  );

  if (incRes.rows.length === 0) {
    res.status(404).json({ error: 'Incident not found' });
    return;
  }

  const updatedRes = await query(
    `UPDATE incidents 
     SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, notes = 'Resolved by victim: I am safe' 
     WHERE id = $1 
     RETURNING *`,
    [incidentId]
  );

  const incident = updatedRes.rows[0];

  // Enqueue STOP command to paired hardware band
  const deviceRes = await query('SELECT device_id FROM devices WHERE user_id = $1', [userId]);
  if (deviceRes.rows.length > 0) {
    for (const dev of deviceRes.rows) {
      await enqueueCommand(dev.device_id, 'stop');
    }
  }

  emitIncidentStatus(incidentId, 'resolved', userId, {
    resolvedAt: incident.resolved_at,
    notes: incident.notes,
  });

  res.status(200).json(incident);
});

// POST /api/incidents/:id/messages (Victim sending message in active incident)
incidentsRouter.post('/incidents/:id/messages', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const incidentId = Number.parseInt(req.params.id, 10);

  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    return;
  }

  const incRes = await query('SELECT id FROM incidents WHERE id = $1 AND user_id = $2', [incidentId, userId]);
  if (incRes.rows.length === 0) {
    res.status(404).json({ error: 'Incident not found' });
    return;
  }

  const insertRes = await query(
    `INSERT INTO messages (incident_id, sender, body) 
     VALUES ($1, 'user', $2) 
     RETURNING *`,
    [incidentId, parsed.data.body]
  );

  const message = insertRes.rows[0];
  emitMessageNew(incidentId, message, userId);

  res.status(201).json(message);
});
