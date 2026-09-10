// Lògica pura del comptador de punts del Papayoo. Sense DOM: es prova amb `node --test`.

export const TOTAL = 250;
export const PAPAYOO_POINTS = 40;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const MAX_PAYOO = TOTAL - PAPAYOO_POINTS; // 210: màxim per a qui no té el Papayoo

export function maxPointsFor(isPapayoo) {
  return isPapayoo ? TOTAL : MAX_PAYOO;
}

/** Converteix qualsevol entrada en un enter dins de [mín, màx] del jugador. Mai negatiu. */
export function clampPoints(value, isPapayoo) {
  let n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) n = 0;
  const min = isPapayoo ? PAPAYOO_POINTS : 0;
  return Math.max(min, Math.min(maxPointsFor(isPapayoo), n));
}

/**
 * Resol una ronda a mig introduir.
 * @param {{papayoo: number|null, points: (number|null)[]}} input  null = punts no introduïts
 * @returns {{valid: boolean, points: (number|null)[], auto: number|null, remaining: number, errors: string[]}}
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
  } else if (remaining < 0) {
    errors.push('over-total');
  }

  if (papayoo === null || papayoo === undefined) {
    errors.push('papayoo-missing');
  } else if (resolved[papayoo] !== null && resolved[papayoo] !== undefined
             && resolved[papayoo] < PAPAYOO_POINTS) {
    errors.push('papayoo-too-low');
  }

  const unique = [...new Set(errors)];
  return {
    valid: unique.length === 0 && missing.length <= 1,
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

export function validateSetup(names) {
  const errors = [];
  if (names.length < MIN_PLAYERS) errors.push('too-few');
  if (names.length > MAX_PLAYERS) errors.push('too-many');
  const trimmed = names.map(n => (n ?? '').trim());
  if (trimmed.some(n => n === '')) errors.push('empty-name');
  if (new Set(trimmed.map(n => n.toLowerCase())).size !== trimmed.length) errors.push('duplicate-name');
  return errors;
}

export function createGame(players, roundsPlanned) {
  return {
    players: players.map(n => n.trim()),
    roundsPlanned: roundsPlanned || null,
    rounds: [],
    createdAt: Date.now(),
  };
}
