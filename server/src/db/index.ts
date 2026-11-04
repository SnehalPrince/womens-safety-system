import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { newDb } from 'pg-mem';
import { hashPassword } from '../utils/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface DatabaseAdapter {
  query: <T = any>(text: string, params?: any[]) => Promise<QueryResult<T>>;
  isMemory: boolean;
  close: () => Promise<void>;
}

let dbInstance: DatabaseAdapter | null = null;

export async function getDb(): Promise<DatabaseAdapter> {
  if (dbInstance) {
    return dbInstance;
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl && databaseUrl.trim().length > 0) {
    const isProduction = process.env.NODE_ENV === 'production';
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      ssl: isProduction ? { rejectUnauthorized: false } : undefined,
    });

    dbInstance = {
      query: async (text: string, params?: any[]) => {
        const res = await pool.query(text, params);
        return { rows: res.rows, rowCount: res.rowCount ?? 0 };
      },
      isMemory: false,
      close: async () => {
        await pool.end();
        dbInstance = null;
      },
    };
  } else {
    // In-memory zero-setup fallback
    const mem = newDb();
    const pgAdapter = mem.adapters.createPg();
    const pool = new pgAdapter.Pool();

    dbInstance = {
      query: async (text: string, params?: any[]) => {
        const res = await pool.query(text, params);
        return { rows: res.rows, rowCount: res.rowCount ?? 0 };
      },
      isMemory: true,
      close: async () => {
        await pool.end();
        dbInstance = null;
      },
    };
  }

  return dbInstance;
}

export async function query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  const db = await getDb();
  return db.query<T>(text, params);
}

export async function initDb(): Promise<void> {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  // Split and execute statements
  const statements = schemaSql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await query(statement);
  }

  // Seed default admin if ADMIN_EMAIL and ADMIN_PASSWORD are provided
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@safety.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'AdminSecurePassword123!';

  const existing = await query('SELECT id FROM users WHERE phone = $1', [adminEmail]);
  if (existing.rows.length === 0) {
    const pwdHash = await hashPassword(adminPassword);
    await query(
      'INSERT INTO users (name, phone, password_hash, role) VALUES ($1, $2, $3, $4)',
      ['System Administrator', adminEmail, pwdHash, 'admin']
    );
  }
}
