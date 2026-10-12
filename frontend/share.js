// Compartir una partida: les dades viuen al servidor i l'enllaç només porta un UUID.
// Els enllaços antics amb #p= continuen sent llegibles.
import { TOTAL, PAPAYOO_POINTS, MIN_PLAYERS, MAX_PLAYERS, standings } from './logic.js';

const VERSION = 1;

export const toBase64Url = (bytes) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function fromBase64Url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** La partida, compactada: [papayoo, punts...] per ronda. Si és d'un torneig, porta de quina taula és. */
export function encodeGame(game) {
  const payload = {
    v: VERSION,
    c: game.createdAt,
    e: game.endedAt ?? game.createdAt,
    p: game.players,
    r: game.rounds.map(r => [r.papayoo, ...r.points]),
  };
  if (game.tour) payload.t = [game.tour.id, game.tour.game, game.tour.table, game.tour.name ?? ''];
  return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

/** L'etiqueta de torneig d'una partida: [id, partida, taula, nom del torneig]. */
export function readTour(t) {
  if (!Array.isArray(t) || t.length !== 4) return null;
  const [id, game, table, name] = t;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,16}$/.test(id)) return null;
  if (!isInt(game) || game < 0 || game > 19 || !isInt(table) || table < 0 || table > 49) return null;
  if (typeof name !== 'string' || name.length > 60) return null;
  return { id, name, game, table };
}

/** Valida i copia la partida que es desa al servidor, sense camps locals ni secrets. */
export function normalizeSharedGame(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { players, rounds, createdAt, endedAt, roundsPlanned, tour } = value;
  if (!Array.isArray(players) || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS
      || !players.every(n => typeof n === 'string' && n.trim() && n.length <= 40)) return null;
  if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(endedAt)) return null;
  if (!Array.isArray(rounds) || !rounds.length || !rounds.every(r =>
    r && Number.isInteger(r.papayoo) && r.papayoo >= 0 && r.papayoo < players.length
    && Array.isArray(r.points) && r.points.length === players.length
    && r.points.every(p => Number.isInteger(p) && p >= 0 && p <= TOTAL)
    && r.points[r.papayoo] >= PAPAYOO_POINTS
    && r.points.reduce((sum, p) => sum + p, 0) === TOTAL)) return null;
  if (roundsPlanned !== undefined && roundsPlanned !== null
      && (!Number.isInteger(roundsPlanned) || roundsPlanned < 1)) return null;
  const clean = {
    players: players.slice(),
    rounds: rounds.map(r => ({ papayoo: r.papayoo, points: r.points.slice() })),
    createdAt, endedAt,
  };
  if (roundsPlanned !== undefined) clean.roundsPlanned = roundsPlanned;
  if (tour !== undefined) {
    const checked = readTour([tour?.id, tour?.game, tour?.table, tour?.name ?? '']);
    if (!checked) return null;
    clean.tour = checked;
  }
  return clean;
}

const fail = (error) => ({ ok: false, error });
const isInt = (v) => Number.isInteger(v);

// Els enllaços antics no comprovaven que qui tenia el Papayoo en tingués els 40 punts. Si només un
// jugador els pot tenir, la marca passa a ell; si no, l'enllaç es continua obrint tal com va arribar.
function legacyPapayoo(papayoo, points) {
  if (points[papayoo] >= PAPAYOO_POINTS) return papayoo;
  const candidates = points.flatMap((p, i) => (p >= PAPAYOO_POINTS ? [i] : []));
  return candidates.length === 1 ? candidates[0] : papayoo;
}

/**
 * Llegeix una partida d'un enllaç, d'un missatge sencer enganxat o del tros codificat tot sol.
 * @returns {{ok: true, game: object} | {ok: false, error: 'bad-link'|'bad-version'|'bad-data'}}
 */
export function decodeShared(text) {
  const raw = String(text ?? '').trim();
  const inLink = raw.match(/[#?&]p=([A-Za-z0-9_-]+)/);
  const payload = inLink ? inLink[1] : (/^[A-Za-z0-9_-]+$/.test(raw) ? raw : null);
  if (!payload) return fail('bad-link');

  let data;
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(payload)));
  } catch { return fail('bad-link'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('bad-link');
  if (data.v !== VERSION) return fail('bad-version');

  const players = data.p;
  if (!Array.isArray(players) || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) return fail('bad-data');
  if (!players.every(n => typeof n === 'string' && n.trim() && n.length <= 40)) return fail('bad-data');
  if (!isInt(data.c) || !isInt(data.e)) return fail('bad-data');

  const n = players.length;
  if (!Array.isArray(data.r) || !data.r.length) return fail('bad-data');
  const rounds = [];
  for (const row of data.r) {
    if (!Array.isArray(row) || row.length !== n + 1 || !row.every(isInt)) return fail('bad-data');
    const [papayoo, ...points] = row;
    if (papayoo < 0 || papayoo >= n) return fail('bad-data');
    if (points.some(p => p < 0 || p > TOTAL)) return fail('bad-data');
    if (points.reduce((a, p) => a + p, 0) !== TOTAL) return fail('bad-data');
    rounds.push({ papayoo: legacyPapayoo(papayoo, points), points });
  }

  const game = { players: players.slice(), rounds, createdAt: data.c, endedAt: data.e };
  if (data.t !== undefined) {
    const tour = readTour(data.t);
    if (!tour) return fail('bad-data');
    game.tour = tour;
  }
  return { ok: true, game };
}

/** Enllaç curt d'una partida desada al servidor. */
export function shareLink(id, base) {
  return `${new URL(base).origin}/shared/${encodeURIComponent(id)}`;
}

/** Enllaç antic amb les dades dins del fragment, per conservar-ne la compatibilitat. */
export function legacyShareLink(game, base) {
  const url = new URL(base);
  url.hash = '';
  url.search = '';
  return `${url.href.replace(/[?#]$/, '')}#p=${encodeGame(game)}`;
}

const fmtDate = (ts) => new Date(ts).toLocaleDateString('ca', { day: 'numeric', month: 'long', year: 'numeric' });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** El missatge que s'envia: data, qui guanya, la classificació i l'enllaç. */
export function shareMessage(game, url) {
  const rows = standings(game.players, game.rounds);
  const winners = rows.filter(r => r.rank === 1);
  const names = winners.map(r => r.name);
  const who = names.length > 1
    ? `Empaten ${names.slice(0, -1).join(', ')} i ${names[names.length - 1]} amb ${rows[0].total} punts.`
    : `Guanya ${names[0]} amb ${rows[0].total} punts.`;

  return [
    `Papayoo, ${fmtDate(game.endedAt ?? game.createdAt)} (${plural(game.rounds.length, 'ronda', 'rondes')})`,
    who,
    '',
    ...rows.map(r => `${r.rank}. ${r.name} ${r.total}`),
    '',
    `Mira-la sencera: ${url}`,
  ].join('\n');
}

/** Dues partides amb la mateixa clau són la mateixa: serveix per no desar-la dos cops. */
export const gameKey = (game) => `${game.createdAt}|${game.players.join('|')}`;
