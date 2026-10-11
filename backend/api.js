// API del torneig: el servidor és l'única font dels sortejos, rondes i resultats.
import { randomBytes, randomUUID, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';
import { PAPAYOO_POINTS } from '../frontend/logic.js';
import { normalizeSharedGame } from '../frontend/share.js';
import {
  validateTournament, makeSchedule, createTournament, tableNames,
  progress, tournamentStandings, awards,
} from './tournament.js';

const token = () => randomBytes(24).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');
const reply = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' },
});
const error = (message, status = 400) => reply({ error: message }, status);

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

function passwordMatches(password, stored) {
  const [salt, hex] = stored.split(':');
  if (!salt || !hex) return false;
  const wanted = Buffer.from(hex, 'hex');
  const actual = scryptSync(password, salt, wanted.length);
  return timingSafeEqual(wanted, actual);
}

async function readBody(request) {
  if (Number(request.headers.get('content-length')) > 100_000) throw new Error('La petició és massa gran.');
  const body = await request.text();
  if (body.length > 100_000) throw new Error('La petició és massa gran.');
  return JSON.parse(body);
}

async function tournament(conn, id) {
  return (await conn.query('SELECT * FROM tournaments WHERE id = ?', [id]))[0] ?? null;
}

async function authorize(conn, request, id) {
  const bearer = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32})$/)?.[1];
  if (!bearer) return false;
  const row = (await conn.query('SELECT tournament_id, expires_at FROM tournament_sessions WHERE token_hash = ?', [digest(bearer)]))[0];
  return row?.tournament_id === id && Number(row.expires_at) > Date.now();
}

async function issueSession(conn, id) {
  const value = token();
  await conn.query('INSERT INTO tournament_sessions (token_hash, tournament_id, expires_at) VALUES (?, ?, ?)',
    [digest(value), id, Date.now() + 30 * 24 * 3600_000]);
  return value;
}

function validateRound(round, size) {
  return round && Number.isInteger(round.papayoo) && round.papayoo >= 0 && round.papayoo < size
    && Array.isArray(round.points) && round.points.length === size
    && round.points.every(p => Number.isInteger(p) && p >= 0 && p <= 250)
    && round.points[round.papayoo] >= PAPAYOO_POINTS
    && round.points.reduce((a, b) => a + b, 0) === 250;
}

async function rowsFor(conn, id) {
  return conn.query('SELECT game_index, table_index, rounds, updated_at FROM tournament_tables WHERE tournament_id = ?', [id]);
}

function snapshot(row, tableRows, { includeSecrets = false, includeScores = false } = {}) {
  const t = JSON.parse(row.data);
  const results = {};
  const tables = tableRows.map(item => {
    const rounds = JSON.parse(item.rounds);
    const finished = rounds.length === t.rounds;
    if (finished) results[`${item.game_index}-${item.table_index}`] = {
      players: tableNames(t, item.game_index, item.table_index), rounds,
      receivedAt: Number(item.updated_at),
    };
    return { game: item.game_index, table: item.table_index, rounds: rounds.length, finished };
  });
  const revealStep = Number(row.revealed);
  const view = {
    id: t.id, name: t.name, createdAt: t.createdAt, games: t.games,
    rounds: t.rounds, players: t.players, schedule: t.schedule,
    revealed: revealStep > 0, revealStep, tables,
    progress: progress({ ...t, results }),
  };
  if (includeSecrets) view.links = t.links;
  if (includeScores) {
    const ranking = tournamentStandings({ ...t, results });
    const podium = ranking.filter(p => p.played).slice(0, 3);
    const firstVisible = Math.max(0, 3 - revealStep);
    view.podium = podium.slice(firstVisible).map(p => ({ rank: p.rank, name: p.name, total: p.total }));
    if (revealStep >= 4) {
      view.results = results;
      view.standings = ranking;
      view.awards = awards(ranking);
    }
  }
  return view;
}

async function create(conn, request) {
  const body = await readBody(request);
  const { name, players, games, rounds, password } = body ?? {};
  if (!Array.isArray(players) || !players.every(p => typeof p === 'string')) return error('La llista de jugadors no és vàlida.');
  const clean = players.map(p => p.trim());
  if (clean.some(p => !p) || validateTournament(clean).length) return error('Els jugadors no són vàlids.');
  if (typeof name !== 'string' || name.length > 60) return error('El nom del torneig no és vàlid.');
  if (!Number.isInteger(games) || games < 1 || games > 10 || !Number.isInteger(rounds) || rounds < 1 || rounds > 20)
    return error('El format del torneig no és vàlid.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 200)
    return error('La contrasenya ha de tenir entre 12 i 200 caràcters.');
  const t = createTournament({ name, players: clean, games, rounds, schedule: makeSchedule(clean.length, games) });
  t.id = randomBytes(9).toString('base64url');
  t.links = t.schedule.map(game => game.map(() => token()));
  await conn.query('INSERT INTO tournaments (id, name, password_hash, data, revealed, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    [t.id, t.name, hashPassword(password), JSON.stringify(t), t.createdAt]);
  for (let gi = 0; gi < t.schedule.length; gi++) {
    for (let ti = 0; ti < t.schedule[gi].length; ti++) {
      await conn.query('INSERT INTO tournament_tables (token_hash, tournament_id, game_index, table_index) VALUES (?, ?, ?, ?)',
        [digest(t.links[gi][ti]), t.id, gi, ti]);
    }
  }
  return reply({ id: t.id, token: await issueSession(conn, t.id) }, 201);
}

async function tableByToken(conn, value) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(value)) return null;
  return (await conn.query('SELECT * FROM tournament_tables WHERE token_hash = ?', [digest(value)]))[0] ?? null;
}

async function sharedGameRoute(conn, request, parts) {
  if (request.method === 'POST' && parts.length === 1) {
    const game = normalizeSharedGame((await readBody(request))?.game);
    if (!game) return error('Les dades de la partida no són vàlides.');
    const id = randomUUID();
    const writeToken = token();
    const now = new Date().toISOString();
    await conn.query('INSERT INTO shared_games (id, data, write_token_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, JSON.stringify(game), digest(writeToken), now, now]);
    return reply({ id, writeToken }, 201);
  }
  if (parts.length !== 2 || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(parts[1]))
    return error('Enllaç de partida no vàlid.', 404);
  const id = parts[1];
  const row = (await conn.query('SELECT data, write_token_hash FROM shared_games WHERE id = ?', [id]))[0];
  if (!row) return error('Aquesta partida compartida no existeix.', 404);
  if (request.method === 'GET') {
    const game = normalizeSharedGame(typeof row.data === 'string' ? JSON.parse(row.data) : row.data);
    if (!game) return error('Les dades de la partida no són vàlides.', 500);
    return reply({ id, game });
  }
  if (request.method === 'PUT') {
    const bearer = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32})$/)?.[1];
    if (!bearer || !timingSafeEqual(Buffer.from(digest(bearer), 'hex'), Buffer.from(row.write_token_hash, 'hex')))
      return error('No pots actualitzar aquesta partida compartida.', 401);
    const game = normalizeSharedGame((await readBody(request))?.game);
    if (!game) return error('Les dades de la partida no són vàlides.');
    await conn.query('UPDATE shared_games SET data = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(game), new Date().toISOString(), id]);
    return reply({ id });
  }
  return error('Ruta no trobada.', 404);
}

export async function handleApi(request, route = new URL(request.url).pathname) {
  try {
    const conn = await db();
    const path = route.replace(/^\/api\/v1\/?/, '/').replace(/\/$/, '') || '/';
    const parts = path.split('/').filter(Boolean);
    if (parts[0] === 'shared-games') return sharedGameRoute(conn, request, parts);
    if (request.method === 'POST' && path === '/tournaments') return create(conn, request);
    if (parts[0] === 'tournaments' && /^[A-Za-z0-9_-]{12}$/.test(parts[1] ?? '')) {
      const id = parts[1];
      const row = await tournament(conn, id);
      if (!row) return error('Aquest torneig no existeix.', 404);
      if (request.method === 'POST' && parts[2] === 'login' && parts.length === 3) {
        const body = await readBody(request);
        if (typeof body?.password !== 'string' || !passwordMatches(body.password, row.password_hash))
          return error('Contrasenya incorrecta.', 401);
        return reply({ id, token: await issueSession(conn, id) });
      }
      if (request.method === 'GET' && parts[2] === 'status' && parts.length === 3)
        return reply(snapshot(row, await rowsFor(conn, id), { includeScores: Number(row.revealed) > 0 }));
      if (!await authorize(conn, request, id)) return error('Cal identificar-se com a organitzador.', 401);
      if (request.method === 'GET' && parts.length === 2)
        return reply(snapshot(row, await rowsFor(conn, id), { includeSecrets: true, includeScores: Number(row.revealed) > 0 }));
      if (request.method === 'PUT' && parts[2] === 'reveal' && parts.length === 3) {
        const body = await readBody(request);
        if (!Number.isInteger(body?.step) || body.step < 0 || body.step > 4) return error('L’etapa de la classificació no és vàlida.');
        if (body.step > 0) {
          const current = snapshot(row, await rowsFor(conn, id));
          if (current.progress.received !== current.progress.total) return error('Encara falten taules per acabar.');
        }
        await conn.query('UPDATE tournaments SET revealed = ? WHERE id = ?', [body.step, id]);
        return reply({ revealStep: body.step });
      }
    }
    if (parts[0] === 'tables' && parts.length >= 2) {
      const item = await tableByToken(conn, parts[1]);
      if (!item) return error('Aquest enllaç de taula no és vàlid.', 404);
      const row = await tournament(conn, item.tournament_id);
      const t = JSON.parse(row.data);
      const table = {
        tournamentId: t.id, tournamentName: t.name, game: item.game_index, table: item.table_index,
        players: tableNames(t, item.game_index, item.table_index), roundsPlanned: t.rounds,
        rounds: JSON.parse(item.rounds), revealed: Boolean(row.revealed),
      };
      if (request.method === 'GET' && parts.length === 2) return reply(table);
      if (request.method === 'PUT' && parts[2] === 'rounds' && parts.length === 3) {
        const body = await readBody(request);
        const rounds = body?.rounds;
        if (!Array.isArray(rounds) || rounds.length > t.rounds || !rounds.every(r => validateRound(r, table.players.length)))
          return error('Les rondes no són vàlides.');
        await conn.query('UPDATE tournament_tables SET rounds = ?, updated_at = ? WHERE token_hash = ?',
          [JSON.stringify(rounds), Date.now(), item.token_hash]);
        return reply({ saved: rounds.length, finished: rounds.length === t.rounds });
      }
    }
    return error('Ruta no trobada.', 404);
  } catch (err) {
    if (err instanceof SyntaxError) return error('El format de la petició no és vàlid.');
    if (err.message === 'La petició és massa gran.') return error(err.message, 413);
    console.error(err);
    return error('No s’ha pogut completar la petició.', 500);
  }
}
