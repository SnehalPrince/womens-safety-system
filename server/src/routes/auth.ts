import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query } from '../db/index.js';
import { hashPassword, comparePassword, signToken, authenticate, type AuthenticatedRequest } from '../utils/auth.js';

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().min(2).max(100),
  phone: z.string().min(5).max(20),
  password: z.string().min(6).max(100),
});

const loginSchema = z.object({
  phone: z.string().min(3),
  password: z.string().min(1),
});

authRouter.post('/register', async (req: Request, res: Response): Promise<void> => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    return;
  }

  const { name, phone, password } = parsed.data;

  const existing = await query('SELECT id FROM users WHERE phone = $1', [phone]);
  if (existing.rows.length > 0) {
    res.status(409).json({ error: 'Phone number already registered' });
    return;
  }

  const pwdHash = await hashPassword(password);
  const insertRes = await query(
    `INSERT INTO users (name, phone, password_hash, role) 
     VALUES ($1, $2, $3, 'user') 
     RETURNING id, name, phone, role, created_at`,
    [name, phone, pwdHash]
  );

  const user = insertRes.rows[0];
  const token = signToken({
    userId: user.id,
    role: user.role,
    phone: user.phone,
  });

  res.status(201).json({ token, user });
});

authRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    return;
  }

  const { phone, password } = parsed.data;

  const userRes = await query('SELECT * FROM users WHERE phone = $1', [phone]);
  if (userRes.rows.length === 0) {
    res.status(401).json({ error: 'Invalid phone or password' });
    return;
  }

  const user = userRes.rows[0];
  const isMatch = await comparePassword(password, user.password_hash);
  if (!isMatch) {
    res.status(401).json({ error: 'Invalid phone or password' });
    return;
  }

  const token = signToken({
    userId: user.id,
    role: user.role,
    phone: user.phone,
  });

  res.status(200).json({
    token,
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      created_at: user.created_at,
    },
  });
});

authRouter.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;

  const userRes = await query('SELECT id, name, phone, role, created_at FROM users WHERE id = $1', [userId]);
  if (userRes.rows.length === 0) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const user = userRes.rows[0];

  const deviceRes = await query(
    'SELECT device_id, sim_number, last_seen_at, paired_at FROM devices WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  const pairedDevice = deviceRes.rows[0] || null;

  const contactsRes = await query(
    'SELECT id, name, phone, relation, priority FROM contacts WHERE user_id = $1 ORDER BY priority ASC, id ASC',
    [userId]
  );

  res.status(200).json({
    user,
    pairedDevice,
    contacts: contactsRes.rows,
  });
});
