// Persistència dels tornejos. SQLite en local i PostgreSQL (Neon) als desplegaments.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';

let connection;
let initialized;

function database() {
  if (connection) return connection;
  if (process.env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    connection = {
      async query(sql, args = []) {
        let index = 0;
        const converted = sql.replace(/\?/g, () => `$${++index}`);
        return (await pool.query(converted, args)).rows;
      },
    };
  } else {
    if (process.env.VERCEL) throw new Error('Falta DATABASE_URL al desplegament.');
    const file = process.env.SQLITE_PATH || '.data/appayo.sqlite';
    mkdirSync(dirname(file), { recursive: true });
    const sqlite = new DatabaseSync(file);
    sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    connection = {
      async query(sql, args = []) {
        const stmt = sqlite.prepare(sql);
        return /^\s*SELECT\b/i.test(sql) ? stmt.all(...args) : (stmt.run(...args), []);
      },
    };
  }
  return connection;
}

export async function db() {
  const conn = database();
  if (!initialized) initialized = (async () => {
    await conn.query(`CREATE TABLE IF NOT EXISTS tournaments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      data TEXT NOT NULL,
      revealed INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS tournament_sessions (
      token_hash TEXT PRIMARY KEY,
      tournament_id TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS tournament_tables (
      token_hash TEXT PRIMARY KEY,
      tournament_id TEXT NOT NULL,
      game_index INTEGER NOT NULL,
      table_index INTEGER NOT NULL,
      rounds TEXT NOT NULL DEFAULT '[]',
      updated_at BIGINT NOT NULL DEFAULT 0,
      UNIQUE(tournament_id, game_index, table_index)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS shared_games (
      id UUID PRIMARY KEY,
      data JSONB NOT NULL,
      write_token_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`);
  })();
  await initialized;
  return conn;
}
