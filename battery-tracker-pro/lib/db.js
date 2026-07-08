import { neon } from '@neondatabase/serverless';

let _sql = null;

export function getDb() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set. Add it in your Vercel project settings.');
    }
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

export async function initSchema() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS properties (
      id        SERIAL PRIMARY KEY,
      name      TEXT NOT NULL,
      code      TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      username    TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role        TEXT NOT NULL CHECK (role IN ('developer','supervisor','technician')),
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (property_id, username)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS batteries (
      id           SERIAL PRIMARY KEY,
      property_id  INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      current_percent INTEGER NOT NULL DEFAULT 100,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (property_id, name)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS readings (
      id             SERIAL PRIMARY KEY,
      battery_id     INTEGER NOT NULL REFERENCES batteries(id) ON DELETE CASCADE,
      property_id    INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      percent        INTEGER NOT NULL CHECK (percent BETWEEN 0 AND 100),
      reading_time   TEXT NOT NULL,
      is_replacement BOOLEAN NOT NULL DEFAULT FALSE,
      technician     TEXT NOT NULL DEFAULT 'Unknown',
      created_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS stock (
      property_id INTEGER PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
      count       INTEGER NOT NULL DEFAULT 0
    )
  `;
}
