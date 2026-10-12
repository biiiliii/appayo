// Lògica pura del comptador de punts del Papayoo. Sense DOM: es prova amb `node --test`.

export const TOTAL = 250;
export const PAPAYOO_POINTS = 40;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

/** Converteix qualsevol entrada en un enter dins de [0, 250]. Mai negatiu. */
export function clampPoints(value) {
  let n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) n = 0;
  return Math.max(0, Math.min(TOTAL, n));
}

/**
 * Resol una ronda a mig introduir. Els 40 punts del Papayoo ja van dins del total
 * del jugador que se l'ha endut. Si només un jugador pot tenir-lo, es marca automàticament.
 * Qui es deixa en blanc fa 0 un cop ja s'han repartit els 250 punts; si només en queda un, rep la resta.
 * @param {{papayoo: number|null, points: (number|null)[]}} input  null = punts no introduïts
 * @returns {{valid: boolean, papayoo: number|null, points: (number|null)[], auto: number|null, remaining: number, errors: string[]}}
 */
export function resolveRound({ papayoo, points }) {
  const errors = [];
  const resolved = points.slice();
  const missing = [];
  let sum = 0;

  points.forEach((p, i) => {
    if (p === null || p === undefined) missing.push(i);
    else {
      if (p < 0) errors.push('negative');
      sum += p;
    }
  });

  const remaining = TOTAL - sum;
  let auto = null;

  if (missing.length === 1) {
    auto = missing[0];
    resolved[auto] = remaining;
    if (remaining < 0) errors.push('over-total');
  } else if (missing.length === 0) {
    if (sum !== TOTAL) errors.push('sum-mismatch');
  } else if (remaining === 0) {
    for (const i of missing) resolved[i] = 0;
  } else if (remaining < 0) {
    errors.push('over-total');
  }

  // Completa també quan l'últim jugador rep la resta: `remaining` es calcula abans d'omplir-lo.
  const complete = errors.length === 0 && resolved.every(p => p !== null && p !== undefined)
    && resolved.reduce((a, p) => a + p, 0) === TOTAL;
  const candidates = complete ? resolved.flatMap((p, i) => p >= PAPAYOO_POINTS ? [i] : []) : [];
  const selected = papayoo === null || papayoo === undefined
    ? (candidates.length === 1 ? candidates[0] : null)
    : papayoo;
  if (!Number.isInteger(selected) || selected < 0 || selected >= points.length) errors.push('papayoo-missing');
  // Mentre encara s'escriuen els punts (1, 10, 100...) no es marca l'error dels 40 punts.
  else if (complete && resolved[selected] < PAPAYOO_POINTS) errors.push('papayoo-points');

  const unique = [...new Set(errors)];
  return {
    valid: unique.length === 0 && (missing.length <= 1 || remaining === 0),
    papayoo: selected,
    points: resolved,
    auto,
    remaining,
    errors: unique,
  };
}

export function totals(rounds, playerCount) {
  const t = new Array(playerCount).fill(0);
  for (const r of rounds) r.points.forEach((p, i) => { t[i] += p; });
  return t;
}

/** Classificació: menys punts primer. Els empats comparteixen posició. */
export function standings(players, rounds) {
  const t = totals(rounds, players.length);
  const rows = players.map((name, index) => ({ name, index, total: t[index] }));
  rows.sort((a, b) => a.total - b.total || a.index - b.index);
  let rank = 0;
  rows.forEach((row, i) => {
    if (i === 0 || row.total !== rows[i - 1].total) rank = i + 1;
    row.rank = rank;
  });
  return rows;
}

/** Noms nets; un nom buit passa a ser "Jugador N". */
export function normalizeNames(names) {
  return names.map((n, i) => ((n ?? '').trim() || `Jugador ${i + 1}`));
}

export function validateSetup(names) {
  const errors = [];
  if (names.length < MIN_PLAYERS) errors.push('too-few');
  if (names.length > MAX_PLAYERS) errors.push('too-many');
  const clean = normalizeNames(names);
  if (new Set(clean.map(n => n.toLowerCase())).size !== clean.length) errors.push('duplicate-name');
  return errors;
}

/** @param roundsPlanned  un nombre, null (sense límit) o 'players' (tantes rondes com jugadors) */
export function createGame(players, roundsPlanned) {
  const names = normalizeNames(players);
  return {
    id: `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    players: names,
    roundsPlanned: roundsPlanned === 'players' ? names.length : (roundsPlanned || null),
    rounds: [],
    createdAt: Date.now(),
  };
}
