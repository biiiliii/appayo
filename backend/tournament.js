// Torneig: sorteig de taules, enllaços per a cada taula i classificació. Sense DOM: es prova amb `node --test`.
// El Papayoo es juga de 3 a 8: cap taula ni cap torneig pot tenir-ne menys.
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
const toBase64Url = bytes => Buffer.from(bytes).toString('base64url');
const fromBase64Url = value => new Uint8Array(Buffer.from(value, 'base64url'));

function standings(players, rounds) {
  const totals = players.map((_, i) => rounds.reduce((sum, r) => sum + r.points[i], 0));
  const rows = players.map((name, index) => ({ name, index, total: totals[index] }));
  rows.sort((a, b) => a.total - b.total || a.index - b.index);
  rows.forEach((row, i) => { row.rank = i && row.total === rows[i - 1].total ? rows[i - 1].rank : i + 1; });
  return rows;
}

export const MAX_TOURNAMENT_PLAYERS = 120;
export const MAX_GAMES = 10;
export const MAX_ROUNDS = 20;
const NAME_MAX = 40;
const VERSION = 1;
// Mida de taula de referència: si n'hi ha de diferents, els punts es passen a l'equivalent d'una de 5.
const REF_SIZE = 5;

// ---------- Utilitats ----------

/** Nombres aleatoris repetibles (mulberry32): mateixa llavor, mateix sorteig. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sum = (list) => list.reduce((a, b) => a + b, 0);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** "A", "A i B", "A, B i C" */
export const joinNames = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} i ${names[names.length - 1]}` : names[0] ?? '');
export const tournamentTitle = (t) => t.name || 'Torneig de Papayoo';
export const tableLabel = (game, table) => `Partida ${game + 1}, taula ${table + 1}`;
export const resultKey = (game, table) => `${game}-${table}`;

/** Punts amb un decimal com a màxim, a la catalana: 81,6. */
export function fmtPoints(x) {
  return String(Math.round(x * 10) / 10).replace('.', ',');
}

// ---------- Taules ----------

/** Taules tan properes com sigui possible a la mida ideal, sempre de tres a vuit jugadors. */
export function tableSizes(n, idealPlayers = REF_SIZE) {
  const count = Math.max(1, Math.min(Math.floor(n / MIN_PLAYERS),
    Math.max(Math.ceil(n / MAX_PLAYERS), Math.round(n / idealPlayers))));
  const base = Math.floor(n / count);
  const extra = n % count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Quantes vegades de més s'han trobat dues persones a la mateixa taula. 0 = cap parella repetida. */
export function countRepeats(schedule) {
  const seen = new Map();
  let repeats = 0;
  for (const game of schedule) {
    for (const table of game) {
      for (let i = 0; i < table.length; i++) {
        for (let j = i + 1; j < table.length; j++) {
          const a = Math.min(table[i], table[j]);
          const b = Math.max(table[i], table[j]);
          const key = a * 1000 + b;
          const c = (seen.get(key) ?? 0) + 1;
          seen.set(key, c);
          if (c > 1) repeats++;
        }
      }
    }
  }
  return repeats;
}

/**
 * Reparteix els jugadors d'una partida en taules de les mides donades, mirant que no repeteixin
 * company. `met[a][b]` diu quantes vegades ja s'han trobat. Comença a l'atzar i va canviant
 * jugadors de taula de dos en dos mentre millori.
 */
function drawGame(n, sizes, met, random) {
  const order = shuffle(Array.from({ length: n }, (_, i) => i), random);
  const tables = [];
  let at = 0;
  for (const size of sizes) { tables.push(order.slice(at, at + size)); at += size; }
  const where = new Array(n);
  tables.forEach((t, ti) => t.forEach(p => { where[p] = ti; }));

  // Quant li costa a `p` seure amb els de la taula `ti` (sense comptar `skip`).
  const cost = (p, ti, skip) => {
    let c = 0;
    for (const q of tables[ti]) if (q !== p && q !== skip) c += met[p][q];
    return c;
  };

  let improved = true;
  let passes = 0;
  while (improved && passes++ < 50) {
    improved = false;
    for (const a of shuffle(order, random)) {
      for (let b = 0; b < n; b++) {
        const ta = where[a];
        const tb = where[b];
        if (ta === tb) continue;
        const delta = cost(b, ta, a) - cost(a, ta, a) + cost(a, tb, b) - cost(b, tb, b);
        if (delta < 0) {
          tables[ta][tables[ta].indexOf(a)] = b;
          tables[tb][tables[tb].indexOf(b)] = a;
          where[a] = tb;
          where[b] = ta;
          improved = true;
        }
      }
    }
  }
  return tables;
}

/**
 * El sorteig sencer: per a cada partida, a quina taula seu cada jugador (pels seus índexs).
 * Prova unes quantes vegades i es queda amb el que repeteix menys parelles.
 * @returns {number[][][]}  schedule[partida][taula] = [jugadors]
 */
export function makeSchedule(n, games, random = Math.random, idealPlayers = REF_SIZE) {
  const sizes = tableSizes(n, idealPlayers);
  if (sizes.length === 1) return Array.from({ length: games }, () =>
    [shuffle(Array.from({ length: n }, (_, i) => i), random)]);

  let best = null;
  let bestRepeats = Infinity;
  for (let attempt = 0; attempt < 40 && bestRepeats > 0; attempt++) {
    const met = Array.from({ length: n }, () => new Array(n).fill(0));
    const schedule = [];
    for (let g = 0; g < games; g++) {
      // Dins de cada partida, unes quantes sortides i la millor.
      let gameBest = null;
      let gameCost = Infinity;
      for (let k = 0; k < 6 && gameCost > 0; k++) {
        const tables = drawGame(n, sizes, met, random);
        const c = sum(tables.map(t => {
          let s = 0;
          for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) s += met[t[i]][t[j]];
          return s;
        }));
        if (c < gameCost) { gameCost = c; gameBest = tables; }
      }
      for (const t of gameBest) for (const p of t) for (const q of t) if (p !== q) met[p][q] += 1;
      schedule.push(gameBest.map(t => t.slice()));
    }
    const repeats = countRepeats(schedule);
    if (repeats < bestRepeats) { bestRepeats = repeats; best = schedule; }
  }
  // L'ordre dels seients també forma part del sorteig i es desa amb el torneig.
  return best.map(game => game.map(table => shuffle(table, random)));
}

// ---------- Inscrits ----------

/** Un nom per línia (o separats per comes), tal com es copien d'un WhatsApp: treu números i guions de llista. */
export function parseNames(text) {
  return String(text ?? '')
    .split(/[\n,;]/)
    .map(line => line.replace(/^\s*(?:\d+\s*[.)-]\s*|[-*•·]\s*)/, '').trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

export function validateTournament(players) {
  const errors = [];
  if (players.length < MIN_PLAYERS) errors.push('too-few');
  if (players.length > MAX_TOURNAMENT_PLAYERS) errors.push('too-many');
  if (players.some(p => p.length > NAME_MAX)) errors.push('name-too-long');
  if (new Set(players.map(p => p.toLowerCase())).size !== players.length) errors.push('duplicate-name');
  return errors;
}

/** Els noms que surten més d'un cop (sense distingir majúscules), un sol cop i tal com s'han escrit la primera vegada. */
export function repeatedNames(players) {
  const keys = players.map(p => p.toLowerCase());
  return players.filter((_, i) => keys.indexOf(keys[i]) === i && keys.lastIndexOf(keys[i]) !== i);
}

export function createTournament({ name, players, games, rounds, schedule, simultaneousTables, weightUnevenTables = true,
  playersPerTable = REF_SIZE }) {
  const id = Array.from({ length: 8 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 36)]).join('');
  return {
    id,
    name: (name ?? '').trim(),
    createdAt: Date.now(),
    players: players.slice(),
    games,
    rounds,
    schedule,
    playersPerTable,
    simultaneousTables: simultaneousTables ?? Math.max(...schedule.map(game => game.length)),
    weightUnevenTables,
    results: {},
  };
}

export const tableNames = (t, game, table) => t.schedule[game][table].map(i => t.players[i]);

// Taules que juguen alhora; els tornejos antics sense el valor feien jugar totes les taules juntes.
const waveSize = t => Math.max(1, t.simultaneousTables ?? Math.max(...t.schedule.map(game => game.length)));

/** Torn d'una taula dins d'una partida, començant per zero. */
export const tableWave = (t, table) => Math.floor(table / waveSize(t));

/** Quants torns té una partida. */
export const gameWaves = (t, game) => Math.ceil(t.schedule[game].length / waveSize(t));

/** Primer torn amb alguna taula pendent; les partides i els torns avancen en ordre. */
export function activeWave(t, finishedKeys) {
  for (let game = 0; game < t.schedule.length; game++) {
    for (let wave = 0; wave < gameWaves(t, game); wave++) {
      if (t.schedule[game].some((_, table) => tableWave(t, table) === wave && !finishedKeys.has(resultKey(game, table))))
        return { game, wave };
    }
  }
  return null;
}

// ---------- Enllaç per a cada taula ----------

export function encodeInvite(t, game, table) {
  const payload = { v: VERSION, i: t.id, n: t.name, g: game, k: table, p: tableNames(t, game, table), r: t.rounds };
  return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

const fail = (error) => ({ ok: false, error });
const isInt = (v) => Number.isInteger(v);

/**
 * Llegeix la invitació d'una taula d'un enllaç, d'un missatge enganxat o del tros codificat.
 * @returns {{ok: true, invite: object} | {ok: false, error: 'bad-link'|'bad-version'|'bad-data'}}
 */
export function decodeInvite(text) {
  const raw = String(text ?? '').trim();
  const inLink = raw.match(/[#?&]t=([A-Za-z0-9_-]+)/);
  const payload = inLink ? inLink[1] : (/^[A-Za-z0-9_-]+$/.test(raw) ? raw : null);
  if (!payload) return fail('bad-link');

  let d;
  try {
    d = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(payload)));
  } catch { return fail('bad-link'); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return fail('bad-link');
  if (d.v !== VERSION) return fail('bad-version');

  if (typeof d.i !== 'string' || !/^[a-z0-9]{1,16}$/.test(d.i)) return fail('bad-data');
  if (typeof d.n !== 'string' || d.n.length > 60) return fail('bad-data');
  if (!isInt(d.g) || d.g < 0 || d.g >= MAX_GAMES || !isInt(d.k) || d.k < 0 || d.k > 49) return fail('bad-data');
  if (!isInt(d.r) || d.r < 1 || d.r > MAX_ROUNDS) return fail('bad-data');
  const p = d.p;
  if (!Array.isArray(p) || p.length < MIN_PLAYERS || p.length > MAX_PLAYERS) return fail('bad-data');
  if (!p.every(n => typeof n === 'string' && n.trim() && n.length <= NAME_MAX)) return fail('bad-data');

  return { ok: true, invite: { id: d.i, name: d.n, game: d.g, table: d.k, players: p.slice(), rounds: d.r } };
}

function linkWith(base, key, payload) {
  const url = new URL(base);
  url.hash = '';
  url.search = '';
  return `${url.href.replace(/[?#]$/, '')}#${key}=${payload}`;
}

export const inviteLink = (t, game, table, base) => linkWith(base, 't', encodeInvite(t, game, table));

/** El missatge per enviar a una taula: qui hi juga i l'enllaç per apuntar-hi els punts. */
export function inviteMessage(t, game, table, url) {
  return [
    `${tournamentTitle(t)}: ${tableLabel(game, table).toLowerCase()}`,
    `Jugueu ${joinNames(tableNames(t, game, table))} (${plural(t.rounds, 'ronda', 'rondes')}).`,
    '',
    `Obriu l'enllaç per apuntar-hi els punts: ${url}`,
  ].join('\n');
}

// ---------- Resultats de les taules ----------

/** El que es desa al torneig quan arriba el resultat d'una taula. */
export function tableResult(game) {
  return {
    players: game.players.slice(),
    rounds: game.rounds.map(r => ({ papayoo: r.papayoo, points: r.points.slice() })),
    createdAt: game.createdAt ?? null,
    receivedAt: Date.now(),
  };
}

/**
 * Comprova si una partida rebuda és d'una taula d'aquest torneig.
 * @returns {{ok: true, key: string, replaces: boolean} | {ok: false, error: 'no-tour'|'other-tournament'|'bad-table'|'other-players'}}
 */
export function acceptResult(t, game) {
  const tour = game.tour;
  if (!tour) return fail('no-tour');
  if (tour.id !== t.id) return fail('other-tournament');
  const seats = t.schedule[tour.game]?.[tour.table];
  if (!seats) return fail('bad-table');
  const expected = seats.map(i => t.players[i]);
  if (expected.length !== game.players.length || expected.some((n, i) => n !== game.players[i])) return fail('other-players');
  const key = resultKey(tour.game, tour.table);
  return { ok: true, key, replaces: key in t.results };
}

/** El missatge que una taula envia a l'organitzador en acabar. */
export function resultMessage(game, url) {
  const rows = standings(game.players, game.rounds);
  const winners = rows.filter(r => r.rank === 1).map(r => r.name);
  const who = winners.length > 1
    ? `Empaten ${joinNames(winners)} amb ${rows[0].total} punts.`
    : `Guanya ${winners[0]} amb ${rows[0].total} punts.`;
  const t = game.tour;
  return [
    `${t.name || 'Torneig de Papayoo'}: ${tableLabel(t.game, t.table).toLowerCase()} (${plural(game.rounds.length, 'ronda', 'rondes')})`,
    who,
    '',
    ...rows.map(r => `${r.rank}. ${r.name} ${r.total}`),
    '',
    `Per a l'organitzador, per afegir-ho al torneig: ${url}`,
  ].join('\n');
}

export function progress(t) {
  const total = sum(t.schedule.map(g => g.length));
  let received = 0;
  t.schedule.forEach((g, gi) => g.forEach((_, ti) => { if (t.results[resultKey(gi, ti)]) received++; }));
  return { received, total };
}

// ---------- Classificació ----------

/** Hi ha taules de mides diferents? Llavors els punts s'igualen a una taula de 5. */
export function needsScaling(t) {
  return t.weightUnevenTables !== false && new Set(t.schedule.flat().map(table => table.length)).size > 1;
}

/** Mida de taula més habitual; en cas d'empat es conserva la referència més gran. */
export function referenceTableSize(t) {
  const counts = new Map();
  for (const table of t.schedule.flat()) counts.set(table.length, (counts.get(table.length) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? REF_SIZE;
}

/**
 * La classificació del torneig, com el full "Resum" de l'Excel. Els punts de les taules de mida
 * diferent es passen a l'equivalent de la mida més habitual (×mida/referència). Per no perdre exactitud es compta
 * en "unitats" (punts × mida) i només es divideix en acabar.
 * Qui encara no té cap resultat va al final, sense posició.
 */
export function tournamentStandings(t) {
  const scale = needsScaling(t);
  const divisor = scale ? referenceTableSize(t) : REF_SIZE;
  const rows = t.players.map((name, index) => ({
    name, index, games: new Array(t.games).fill(null),
    units: 0, played: 0, zeros: 0, papayoos: 0, worstUnits: 0,
  }));

  t.schedule.forEach((game, gi) => game.forEach((seats, ti) => {
    const res = t.results[resultKey(gi, ti)];
    if (!res) return;
    const mult = scale ? seats.length : divisor;
    seats.forEach((p, s) => {
      const row = rows[p];
      const mine = res.rounds.map(r => r.points[s]);
      const raw = sum(mine);
      row.games[gi] = { raw, points: (raw * mult) / divisor, table: ti };
      row.units += raw * mult;
      row.played += 1;
      row.zeros += mine.filter(x => x === 0).length;
      row.papayoos += res.rounds.filter(r => r.papayoo === s).length;
      row.worstUnits = Math.max(row.worstUnits, ...mine.map(x => x * mult));
    });
  }));

  for (const r of rows) {
    r.total = r.units / divisor;
    r.worst = r.worstUnits / divisor;
  }
  rows.sort((a, b) => (b.played > 0) - (a.played > 0) || a.units - b.units || a.index - b.index);
  let rank = null;
  rows.forEach((row, i) => {
    if (!row.played) { row.rank = null; return; }
    if (i === 0 || row.units !== rows[i - 1].units) rank = i + 1;
    row.rank = rank;
  });
  return rows;
}

/**
 * Els diplomes de l'Excel. En cas d'empat, el guanyen tots els empatats.
 * Els de rondes a 0 i Papayoos no es donen si ningú en té cap.
 */
export function awards(rows) {
  const played = rows.filter(r => r.played > 0);
  if (!played.length) return [];
  const pick = (key, title, detail, get, best, unit) => {
    const value = best(...played.map(get));
    return { key, title, detail, unit, names: played.filter(r => get(r) === value).map(r => r.name), value };
  };
  const list = [
    pick('champion', 'Campió/ona', 'menys punts', r => r.total, Math.min, 'punts'),
    pick('spoon', 'Cullera de fusta', 'més punts', r => r.total, Math.max, 'punts'),
    pick('zeros', 'Més rondes a 0', 'rondes sense cap punt', r => r.zeros, Math.max, 'rondes'),
    pick('papayoo', 'Més Papayoos', 'qui se l\'ha endut més vegades', r => r.papayoos, Math.max, 'Papayoos'),
    pick('record', 'Rècord en una ronda', 'més punts en una sola ronda', r => r.worst, Math.max, 'punts'),
  ];
  return list.filter(a => !((a.key === 'zeros' || a.key === 'papayoo') && a.value === 0));
}

/** Set premis de la presentació, sempre en el mateix ordre i amb tots els empats. */
export function presentationAwards(rows) {
  const played = rows.filter(row => row.played > 0);
  if (!played.length) return [];
  const ordinal = rank => ({ 1: 'primer', 2: 'segon', 3: 'tercer', 4: 'quart' })[rank] ?? `${rank}è`;
  const reference = tied => `el ${ordinal(tied[0].rank)} lloc (${joinNames(tied.map(row => row.name))})`;
  const maximum = (key, title, description, read, format, nobody) => {
    const value = Math.max(...played.map(read));
    if (nobody && value === 0) return { key, title, description: 'Aquesta vegada el premi queda desert.',
      names: [], value, difference: null, statistic: nobody };
    const next = Math.max(...played.map(read).filter(other => other < value));
    const difference = Number.isFinite(next) ? value - next : null;
    const nextRows = difference === null ? [] : played.filter(row => read(row) === next);
    return { key, title, description, names: played.filter(row => read(row) === value).map(row => row.name),
      value, difference, statistic: format(value, difference, nextRows) };
  };
  const position = (rank, title) => {
    const winners = played.filter(row => row.rank === rank);
    if (!winners.length) return { key: `place-${rank}`, title,
      description: 'Un empat en una posició anterior deixa aquest lloc vacant.', names: [], statistic: 'Sense adjudicar' };
    const value = winners[0].total;
    const next = Math.min(...played.map(row => row.total).filter(total => total > value));
    const difference = Number.isFinite(next) ? next - value : null;
    const nextRows = difference === null ? [] : played.filter(row => row.total === next);
    return { key: `place-${rank}`, title, description: rank === 1 ? 'El torneig ja té guanyador!' : 'Un lloc ben merescut al podi.',
      names: winners.map(row => row.name), value, difference,
      statistic: `${fmtPoints(value)} punts${difference === null ? '' : ` · ${fmtPoints(difference)} menys que ${reference(nextRows)}`}` };
  };
  return [
    maximum('spoon', 'Major puntuació', 'Algú havia d’endur-se tots aquests punts.', row => row.total,
      (value, difference, nextRows) => `${fmtPoints(value)} punts${difference === null ? '' : ` · ${fmtPoints(difference)} més que ${reference(nextRows)}`}`),
    maximum('papayoo', 'Més Papayoos menjats', 'Potser no ha entès que restaven 40 punts!', row => row.papayoos,
      value => `${value} ${value === 1 ? 'Papayoo' : 'Papayoos'}`, 'Ningú s’ha endut cap Papayoo'),
    maximum('record', 'Més punts en una ronda', 'Una sola ronda que costarà d’oblidar.', row => row.worst,
      value => `${fmtPoints(value)} punts en una ronda`),
    maximum('zeros', 'Més rondes a zero', 'Perfeccionisme, suborn a la resta, o molta sort. No ho sabrem mai.', row => row.zeros,
      value => `${value} ${value === 1 ? 'ronda' : 'rondes'} a zero`, 'Ningú ha fet cap ronda a zero'),
    position(3, 'Tercer lloc'), position(2, 'Segon lloc'), position(1, 'Primer lloc'),
  ];
}

export const fmtAward = (a) => (a.unit === 'punts' ? `${fmtPoints(a.value)} punts` : plural(a.value, a.unit === 'rondes' ? 'ronda' : 'Papayoo', a.unit));

/** La classificació en text, per enviar-la pel WhatsApp. */
export function standingsMessage(t, rows) {
  const { received, total } = progress(t);
  const done = received === total;
  return [
    `${tournamentTitle(t)}: classificació ${done ? 'final' : `(${received} de ${total} taules)`}`,
    'Guanya qui té menys punts.',
    '',
    ...rows.filter(r => r.played).map(r => `${r.rank}. ${r.name} ${fmtPoints(r.total)}`),
    '',
    ...awards(rows).map(a => `${a.title}: ${joinNames(a.names)} (${fmtAward(a)})`),
  ].join('\n').trimEnd();
}
