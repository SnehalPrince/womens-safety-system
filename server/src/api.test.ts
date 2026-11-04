import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import { initDb, query, getDb } from './db/index.js';
import { enqueueCommand } from './services/commandQueue.js';

describe('Server API & Hardware Contract Tests', () => {
  let app: ReturnType<typeof createApp>;
  const DEVICE_KEY = 'test_secret_device_api_key_123';

  beforeEach(async () => {
    process.env.DATABASE_URL = '';
    process.env.DEVICE_API_KEY = DEVICE_KEY;
    process.env.JWT_SECRET = 'test_jwt_secret_xyz';
    process.env.ADMIN_EMAIL = 'admin@test.local';
    process.env.ADMIN_PASSWORD = 'AdminPassword123!';

    const db = await getDb();
    await db.close();
    await initDb();
    app = createApp();
  });

  describe('Hardware Contract & Authentication', () => {
    it('rejects device requests without or with invalid x-api-key', async () => {
      // Missing header
      const res1 = await request(app)
        .post('/api/location')
        .send({
          deviceId: 'band-001',
          event: 'sos_start',
          lat: 28.6139,
          lng: 77.2090,
          fix: true,
        });
      expect(res1.status).toBe(401);

      // Wrong key
      const res2 = await request(app)
        .post('/api/location')
        .set('x-api-key', 'wrong_key')
        .send({
          deviceId: 'band-001',
          event: 'sos_start',
          lat: 28.6139,
          lng: 77.2090,
          fix: true,
        });
      expect(res2.status).toBe(401);
    });

    it('returns 404 for unknown device', async () => {
      const res = await request(app)
        .post('/api/location')
        .set('x-api-key', DEVICE_KEY)
        .send({
          deviceId: 'unknown-device',
          event: 'sos_start',
          lat: 28.6139,
          lng: 77.2090,
          fix: true,
        });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Device not found' });
    });

    it('handles sos_start, creates incident and returns exact {"ok":true}', async () => {
      // 1. Create user and pair device
      const userRes = await query(
        "INSERT INTO users (name, phone, password_hash, role) VALUES ('Victim', '9876543210', 'hash', 'user') RETURNING id"
      );
      const userId = userRes.rows[0].id;
      await query("INSERT INTO devices (device_id, user_id) VALUES ('band-001', $1)", [userId]);

      // 2. Band triggers sos_start
      const res = await request(app)
        .post('/api/location')
        .set('x-api-key', DEVICE_KEY)
        .send({
          deviceId: 'band-001',
          event: 'sos_start',
          lat: 28.6139,
          lng: 77.2090,
          fix: true,
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });

      // Verify incident in database
      const incRes = await query('SELECT * FROM incidents WHERE user_id = $1 AND status = \'open\'', [userId]);
      expect(incRes.rows.length).toBe(1);
      expect(incRes.rows[0].source).toBe('band');

      // Verify location point in database
      const locRes = await query('SELECT * FROM locations WHERE incident_id = $1', [incRes.rows[0].id]);
      expect(locRes.rows.length).toBe(1);
      expect(locRes.rows[0].lat).toBeCloseTo(28.6139);
      expect(locRes.rows[0].lng).toBeCloseTo(77.2090);
    });

    it('atomic command consumption returns exact body once then {"command":"none"}', async () => {
      // Pair device
      const userRes = await query(
        "INSERT INTO users (name, phone, password_hash, role) VALUES ('Victim', '9876543210', 'hash', 'user') RETURNING id"
      );
      const userId = userRes.rows[0].id;
      await query("INSERT INTO devices (device_id, user_id) VALUES ('band-001', $1)", [userId]);

      // Queue an 'sos' command
      await enqueueCommand('band-001', 'sos');

      // 1st Poll: Consumes 'sos'
      const poll1 = await request(app)
        .get('/api/device/band-001/command')
        .set('x-api-key', DEVICE_KEY);

      expect(poll1.status).toBe(200);
      expect(poll1.text).toBe(JSON.stringify({ command: 'sos' }));

      // 2nd Poll: Command consumed, returns 'none'
      const poll2 = await request(app)
        .get('/api/device/band-001/command')
        .set('x-api-key', DEVICE_KEY);

      expect(poll2.status).toBe(200);
      expect(poll2.text).toBe(JSON.stringify({ command: 'none' }));

      // Queue a 'stop' command
      await enqueueCommand('band-001', 'stop');

      // 3rd Poll: Consumes 'stop'
      const poll3 = await request(app)
        .get('/api/device/band-001/command')
        .set('x-api-key', DEVICE_KEY);

      expect(poll3.status).toBe(200);
      expect(poll3.text).toBe(JSON.stringify({ command: 'stop' }));
    });
  });

  describe('User and Admin REST APIs & Role Checks', () => {
    it('registers a new user and denies admin endpoints', async () => {
      // 1. Register regular user
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Jane Doe',
          phone: '9876543210',
          password: 'Password123!',
        });

      expect(regRes.status).toBe(201);
      expect(regRes.body.token).toBeDefined();
      expect(regRes.body.user.role).toBe('user');
      const userToken = regRes.body.token;

      // 2. Attempt to access admin incident endpoint with user token -> 403 Forbidden
      const adminRes = await request(app)
        .get('/api/admin/incidents')
        .set('Authorization', `Bearer ${userToken}`);

      expect(adminRes.status).toBe(403);
      expect(adminRes.body.error).toContain('Admin access required');

      // 3. Login as Admin
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          phone: 'admin@test.local',
          password: 'AdminPassword123!',
        });

      expect(loginRes.status).toBe(200);
      const adminToken = loginRes.body.token;

      // 4. Admin accesses admin endpoint successfully
      const adminOkRes = await request(app)
        .get('/api/admin/incidents')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(adminOkRes.status).toBe(200);
      expect(Array.isArray(adminOkRes.body)).toBe(true);
    });

    it('enforces maximum 5 emergency contacts per user', async () => {
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Jane Doe',
          phone: '9876543210',
          password: 'Password123!',
        });
      const userToken = regRes.body.token;

      // Add 5 contacts
      for (let i = 1; i <= 5; i++) {
        const res = await request(app)
          .post('/api/contacts')
          .set('Authorization', `Bearer ${userToken}`)
          .send({
            name: `Contact ${i}`,
            phone: `900000000${i}`,
            relation: 'Family',
            priority: i,
          });
        expect(res.status).toBe(201);
      }

      // 6th contact should fail
      const sixthRes = await request(app)
        .post('/api/contacts')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Contact 6',
          phone: '9000000006',
          relation: 'Friend',
          priority: 5,
        });

      expect(sixthRes.status).toBe(400);
      expect(sixthRes.body.error).toContain('Maximum of 5');
    });

    it('user SOS trigger enqueues sos command to paired band', async () => {
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Jane Doe',
          phone: '9876543210',
          password: 'Password123!',
        });
      const userToken = regRes.body.token;

      // Pair band
      await request(app)
        .post('/api/devices/pair')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ deviceId: 'band-001' });

      // Trigger SOS from app
      const sosRes = await request(app)
        .post('/api/sos')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          lat: 28.6139,
          lng: 77.2090,
          accuracy: 10,
        });

      expect(sosRes.status).toBe(201);
      expect(sosRes.body.incident.status).toBe('open');

      // Check band gets "sos" command
      const pollRes = await request(app)
        .get('/api/device/band-001/command')
        .set('x-api-key', DEVICE_KEY);

      expect(pollRes.body.command).toBe('sos');
      expect(pollRes.body.victimName).toBe('Jane Doe');

      // User resolves SOS ("I am safe")
      const resolveRes = await request(app)
        .post(`/api/incidents/${sosRes.body.incident.id}/resolve`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(resolveRes.status).toBe(200);
      expect(resolveRes.body.status).toBe('resolved');

      // Check band gets "stop" command
      const stopPollRes = await request(app)
        .get('/api/device/band-001/command')
        .set('x-api-key', DEVICE_KEY);

      expect(stopPollRes.text).toBe(JSON.stringify({ command: 'stop' }));
    });
  });
});
