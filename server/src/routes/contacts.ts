import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../db/index.js';
import { authenticate, type AuthenticatedRequest } from '../utils/auth.js';

export const contactsRouter = Router();
contactsRouter.use(authenticate);

const contactSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().min(5).max(20),
  relation: z.string().min(1).max(50),
  priority: z.number().int().min(1).max(5).default(1),
});

// GET /api/contacts
contactsRouter.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const result = await query(
    'SELECT id, name, phone, relation, priority, created_at FROM contacts WHERE user_id = $1 ORDER BY priority ASC, id ASC',
    [userId]
  );
  res.status(200).json(result.rows);
});

// POST /api/contacts (max 5 per user)
contactsRouter.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;

  const countRes = await query('SELECT COUNT(*) as total FROM contacts WHERE user_id = $1', [userId]);
  const count = Number.parseInt(countRes.rows[0].total, 10);
  if (count >= 5) {
    res.status(400).json({ error: 'Maximum of 5 emergency contacts allowed per user' });
    return;
  }

  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    return;
  }

  const { name, phone, relation, priority } = parsed.data;
  const insertRes = await query(
    `INSERT INTO contacts (user_id, name, phone, relation, priority) 
     VALUES ($1, $2, $3, $4, $5) 
     RETURNING id, name, phone, relation, priority, created_at`,
    [userId, name, phone, relation, priority]
  );

  res.status(201).json(insertRes.rows[0]);
});

// PUT /api/contacts/:id
contactsRouter.put('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const contactId = Number.parseInt(req.params.id, 10);

  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    return;
  }

  const { name, phone, relation, priority } = parsed.data;
  const updateRes = await query(
    `UPDATE contacts 
     SET name = $1, phone = $2, relation = $3, priority = $4 
     WHERE id = $5 AND user_id = $6 
     RETURNING id, name, phone, relation, priority, created_at`,
    [name, phone, relation, priority, contactId, userId]
  );

  if (updateRes.rows.length === 0) {
    res.status(404).json({ error: 'Contact not found' });
    return;
  }

  res.status(200).json(updateRes.rows[0]);
});

// DELETE /api/contacts/:id
contactsRouter.delete('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const contactId = Number.parseInt(req.params.id, 10);

  const deleteRes = await query(
    'DELETE FROM contacts WHERE id = $1 AND user_id = $2 RETURNING id',
    [contactId, userId]
  );

  if (deleteRes.rows.length === 0) {
    res.status(404).json({ error: 'Contact not found' });
    return;
  }

  res.status(200).json({ success: true, message: 'Contact deleted' });
});
