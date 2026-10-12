// Persistència dels tornejos. SQLite en local i PostgreSQL (Neon) als desplegaments.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions/db-connections';

let connection;
let initialized;

// pg ja tracta `sslmode=require` com a verify-full, però avisa que a la v9 deixarà de verificar el
// certificat. Ho fem explícit: es continua verificant i no surt l'avís a cada arrencada.
function postgresUrl(value) {
  try {
    const url = new URL(value);
    if (url.searchParams.get('sslmode') === 'require') url.searchParams.set('sslmode', 'verify-full');
    return url.href;
  } catch {
    return value;
  }
}

function database() {
  if (connection) return connection;
  if (process.env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: postgresUrl(process.env.DATABASE_URL), max: 3 });
    // Neon tanca les connexions inactives. Sense aquest gestor, l'error d'un client inactiu atura el procés.
    pool.on('error', err => console.error('Connexió inactiva de PostgreSQL tancada:', err.message));
    // A Vercel, allarga la instància fins que el pool tanca les connexions inactives.
    attachDatabasePool(pool);
    const queryWith = async (client, sql, args = []) => {
      let index = 0;
      const converted = sql.replace(/\?/g, () => `$${++index}`);
      return (await client.query(converted, args)).rows;
    };
    connection = {
      query(sql, args = []) { return queryWith(pool, sql, args); },
      async transaction(work) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await work({ query: (sql, args = []) => queryWith(client, sql, args) });
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      },
    };
  } else {
    if (process.env.VERCEL) throw new Error('Falta DATABASE_URL al desplegament.');
    // Només en local: així a Vercel no es carrega node:sqlite (ni surt l'avís d'experimental).
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const file = process.env.SQLITE_PATH || '.data/appayo.sqlite';
    mkdirSync(dirname(file), { recursive: true });
    const sqlite = new DatabaseSync(file);
    sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    let transactionTail = Promise.resolve();
    const query = async (sql, args = []) => {
      const stmt = sqlite.prepare(sql);
      return /^\s*SELECT\b|\bRETURNING\b/i.test(sql) ? stmt.all(...args) : (stmt.run(...args), []);
    };
    connection = {
      query,
      async transaction(work) {
        const previous = transactionTail;
        let release;
        transactionTail = new Promise(resolve => { release = resolve; });
        await previous;
        try {
          sqlite.exec('BEGIN IMMEDIATE');
          try {
            const result = await work({ query });
            sqlite.exec('COMMIT');
            return result;
          } catch (err) {
            sqlite.exec('ROLLBACK');
            throw err;
          }
        } finally {
          release();
        }
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
  })().catch(err => {
    // Si falla (per exemple, mentre Neon es desperta), la petició següent ho torna a provar.
    initialized = null;
    throw err;
  });
  await initialized;
  return conn;
}
