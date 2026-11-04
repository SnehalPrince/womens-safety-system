import { describe, it, expect, beforeEach } from 'vitest';
import { initDb, query, getDb } from './index.js';
import { runRetentionCleanup } from '../jobs/retention.js';
import { comparePassword } from '../utils/auth.js';

describe('Database layer and Retention', () => {
  beforeEach(async () => {
    // Ensure clean in-memory database
    process.env.DATABASE_URL = '';
    process.env.ADMIN_EMAIL = 'testadmin@safety.local';
    process.env.ADMIN_PASSWORD = 'TestPassword123!';
    process.env.RETENTION_DAYS = '30';
    
    // Close existing to recreate fresh in-memory db
    const db = await getDb();
    await db.close();
    await initDb();
  });

  it('initializes tables and creates seed admin', async () => {
    const adminRes = await query('SELECT * FROM users WHERE phone = $1', ['testadmin@safety.local']);
    expect(adminRes.rows.length).toBe(1);
    expect(adminRes.rows[0].role).toBe('admin');
    
    const isPasswordValid = await comparePassword('TestPassword123!', adminRes.rows[0].password_hash);
    expect(isPasswordValid).toBe(true);
  });

  it('runs retention cleanup on old resolved incidents and locations', async () => {
    // Insert a test user
    const userRes = await query(
      "INSERT INTO users (name, phone, password_hash, role) VALUES ('Victim', '9999999999', 'hash', 'user') RETURNING id"
    );
    const userId = userRes.rows[0].id;

    // Insert an old resolved incident (> 30 days old)
    const oldIncident = await query(
      `INSERT INTO incidents (user_id, status, source, started_at, resolved_at) 
       VALUES ($1, 'resolved', 'band', NOW() - INTERVAL '35 days', NOW() - INTERVAL '35 days') 
       RETURNING id`,
      [userId]
    );
    const oldId = oldIncident.rows[0].id;

    // Insert location for old incident
    await query(
      `INSERT INTO locations (incident_id, lat, lng, source, recorded_at) 
       VALUES ($1, 28.6139, 77.2090, 'band', NOW() - INTERVAL '35 days')`,
      [oldId]
    );

    // Insert a recent open incident
    const recentIncident = await query(
      `INSERT INTO incidents (user_id, status, source, started_at) 
       VALUES ($1, 'open', 'app', NOW() - INTERVAL '1 day') 
       RETURNING id`,
      [userId]
    );
    const recentId = recentIncident.rows[0].id;

    await query(
      `INSERT INTO locations (incident_id, lat, lng, source, recorded_at) 
       VALUES ($1, 28.6140, 77.2091, 'app', NOW() - INTERVAL '1 day')`,
      [recentId]
    );

    // Run cleanup
    const result = await runRetentionCleanup();
    expect(result.deletedIncidents).toBe(1);
    expect(result.deletedLocations).toBe(1);

    // Verify recent incident is still intact
    const remaining = await query('SELECT id FROM incidents WHERE id = $1', [recentId]);
    expect(remaining.rows.length).toBe(1);

    // Verify old incident is gone
    const oldCheck = await query('SELECT id FROM incidents WHERE id = $1', [oldId]);
    expect(oldCheck.rows.length).toBe(0);
  });
});
