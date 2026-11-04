import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../db/index.js';
import { authenticate, requireAdmin, type AuthenticatedRequest } from '../utils/auth.js';
import { enqueueCommand } from '../services/commandQueue.js';
import { emitIncidentStatus, emitMessageNew } from '../socket.js';

export const adminRouter = Router();

// Apply auth and requireAdmin on all /api/admin/* endpoints
adminRouter.use(authenticate, requireAdmin);

const resolveSchema = z.object({
  notes: z.string().max(2000).optional(),
});

const messageSchema = z.object({
  body: z.string().min(1).max(2000),
});

// GET /api/admin/incidents?status=
adminRouter.get('/incidents', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { status } = req.query;

  let sql = `
    SELECT 
      i.id,
      i.user_id,
      i.status,
      i.source,
      i.started_at,
      i.acknowledged_by,
      i.resolved_at,
      i.notes,
      u.name as user_name,
      u.phone as user_phone
    FROM incidents i
    JOIN users u ON i.user_id = u.id
  `;

  const params: any[] = [];
  if (status && typeof status === 'string') {
    sql += ' WHERE i.status = $1';
    params.push(status);
  }

  sql += ' ORDER BY CASE WHEN i.status IN (\'open\', \'acknowledged\') THEN 0 ELSE 1 END, i.started_at DESC';

  const result = await query(sql, params);
  const incidents = result.rows;

  // Decorate each incident with its most recent location
  const incidentsWithLocation = await Promise.all(
    incidents.map(async (inc) => {
      const locRes = await query(
        'SELECT lat, lng, recorded_at FROM locations WHERE incident_id = $1 ORDER BY recorded_at DESC LIMIT 1',
        [inc.id]
      );
      const latestLoc = locRes.rows[0] || null;
      return {
        ...inc,
        last_lat: latestLoc?.lat ?? null,
        last_lng: latestLoc?.lng ?? null,
        last_location_at: latestLoc?.recorded_at ?? null,
      };
    })
  );

  res.status(200).json(incidentsWithLocation);
});

// GET /api/admin/incidents/:id (Full details with victim, contacts, locations, messages)
adminRouter.get('/incidents/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const incidentId = Number.parseInt(req.params.id, 10);

  const incRes = await query(
    `SELECT 
      i.*,
      u.name as user_name,
      u.phone as user_phone,
      u.created_at as user_created_at
     FROM incidents i
     JOIN users u ON i.user_id = u.id
     WHERE i.id = $1`,
    [incidentId]
  );

  if (incRes.rows.length === 0) {
    res.status(404).json({ error: 'Incident not found' });
    return;
  }

  const incident = incRes.rows[0];
  const userId = incident.user_id;

  // Emergency contacts ordered by priority
  const contactsRes = await query(
    'SELECT id, name, phone, relation, priority FROM contacts WHERE user_id = $1 ORDER BY priority ASC, id ASC',
    [userId]
  );

  // Paired devices
  const devicesRes = await query(
    'SELECT device_id, sim_number, last_seen_at, paired_at FROM devices WHERE user_id = $1',
    [userId]
  );

  // Breadcrumb locations
  const locationsRes = await query(
    `SELECT id, lat, lng, accuracy, source, recorded_at 
     FROM locations 
     WHERE incident_id = $1 
     ORDER BY recorded_at ASC`,
    [incidentId]
  );

  // Messages
  const messagesRes = await query(
    `SELECT id, incident_id, sender, body, created_at 
     FROM messages 
     WHERE incident_id = $1 
     ORDER BY created_at ASC`,
    [incidentId]
  );

  res.status(200).json({
    incident,
    victim: {
      id: userId,
      name: incident.user_name,
      phone: incident.user_phone,
      created_at: incident.user_created_at,
    },
    contacts: contactsRes.rows,
    devices: devicesRes.rows,
    locations: locationsRes.rows,
    messages: messagesRes.rows,
  });
});

// POST /api/admin/incidents/:id/acknowledge
adminRouter.post('/incidents/:id/acknowledge', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const adminId = req.user!.userId;
  const incidentId = Number.parseInt(req.params.id, 10);

  const incRes = await query('SELECT * FROM incidents WHERE id = $1', [incidentId]);
  if (incRes.rows.length === 0) {
    res.status(404).json({ error: 'Incident not found' });
    return;
  }

  const updatedRes = await query(
    `UPDATE incidents 
     SET status = 'acknowledged', acknowledged_by = $1 
     WHERE id = $2 
     RETURNING *`,
    [adminId, incidentId]
  );

  const incident = updatedRes.rows[0];
  emitIncidentStatus(incidentId, 'acknowledged', incident.user_id, {
    acknowledgedBy: adminId,
  });

  res.status(200).json(incident);
});

// POST /api/admin/incidents/:id/resolve
adminRouter.post('/incidents/:id/resolve', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const incidentId = Number.parseInt(req.params.id, 10);
  const parsed = resolveSchema.safeParse(req.body);
  const notes = parsed.success ? parsed.data.notes : undefined;

  const incRes = await query('SELECT * FROM incidents WHERE id = $1', [incidentId]);
  if (incRes.rows.length === 0) {
    res.status(404).json({ error: 'Incident not found' });
    return;
  }

  const prior = incRes.rows[0];
  const updatedRes = await query(
    `UPDATE incidents 
     SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, notes = COALESCE($1, notes) 
     WHERE id = $2 
     RETURNING *`,
    [notes ?? null, incidentId]
  );

  const incident = updatedRes.rows[0];

  // Enqueue STOP command to paired hardware band
  const deviceRes = await query('SELECT device_id FROM devices WHERE user_id = $1', [prior.user_id]);
  if (deviceRes.rows.length > 0) {
    for (const dev of deviceRes.rows) {
      await enqueueCommand(dev.device_id, 'stop');
    }
  }

  emitIncidentStatus(incidentId, 'resolved', prior.user_id, {
    resolvedAt: incident.resolved_at,
    notes: incident.notes,
  });

  res.status(200).json(incident);
});

// POST /api/admin/incidents/:id/messages (Admin sending message to victim)
adminRouter.post('/incidents/:id/messages', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const incidentId = Number.parseInt(req.params.id, 10);

  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    return;
  }

  const incRes = await query('SELECT user_id FROM incidents WHERE id = $1', [incidentId]);
  if (incRes.rows.length === 0) {
    res.status(404).json({ error: 'Incident not found' });
    return;
  }

  const userId = incRes.rows[0].user_id;

  const insertRes = await query(
    `INSERT INTO messages (incident_id, sender, body) 
     VALUES ($1, 'admin', $2) 
     RETURNING *`,
    [incidentId, parsed.data.body]
  );

  const message = insertRes.rows[0];
  emitMessageNew(incidentId, message, userId);

  res.status(201).json(message);
});

// GET /api/admin/users
adminRouter.get('/users', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const usersRes = await query(`
    SELECT 
      u.id, 
      u.name, 
      u.phone, 
      u.role, 
      u.created_at,
      d.device_id,
      d.sim_number,
      d.last_seen_at
    FROM users u
    LEFT JOIN devices d ON u.id = d.user_id
    ORDER BY u.created_at DESC
  `);

  res.status(200).json(usersRes.rows);
});
