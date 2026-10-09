import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tableSizes, makeSchedule, countRepeats, seededRandom, parseNames, validateTournament,
  createTournament, encodeInvite, decodeInvite, inviteLink, inviteMessage, resultMessage,
  tableResult, acceptResult, tournamentStandings, needsScaling, awards, standingsMessage, fmtPoints, progress,
} from '../tournament.js';
import { encodeGame, decodeShared } from '../share.js';

const names = (n) => Array.from({ length: n }, (_, i) => `Jugador ${i + 1}`);
const sum = (a) => a.reduce((x, y) => x + y, 0);

// ---------- Mida de les taules ----------

test('30 players make six tables of five, as in the spreadsheet', () => {
  assert.deepEqual(tableSizes(30), [5, 5, 5, 5, 5, 5]);
});

test('tables stay between 4 and 6 and differ by one at most', () => {
  for (let n = 8; n <= 80; n++) {
    const sizes = tableSizes(n);
    assert.equal(sum(sizes), n, `n=${n}`);
    assert.ok(Math.min(...sizes) >= 4 && Math.max(...sizes) <= 6, `n=${n}: ${sizes}`);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `n=${n}: ${sizes}`);
  }
});

test('few players play at a single table', () => {
  assert.deepEqual(tableSizes(3), [3]);
  assert.deepEqual(tableSizes(7), [7]);
});

// ---------- Sorteig ----------

test('every player sits at exactly one table in every game', () => {
  const s = makeSchedule(28, 3, seededRandom(1));
  assert.equal(s.length, 3);
  for (const game of s) {
    const seats = game.flat().sort((a, b) => a - b);
    assert.deepEqual(seats, Array.from({ length: 28 }, (_, i) => i));
    assert.deepEqual(game.map(t => t.length).sort(), tableSizes(28).slice().sort());
  }
});

test('with 30 players nobody shares a table twice over three games', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const s = makeSchedule(30, 3, seededRandom(seed));
    assert.equal(countRepeats(s), 0, `seed ${seed}`);
  }
});

test('with 40 players nobody shares a table twice either', () => {
  assert.equal(countRepeats(makeSchedule(40, 3, seededRandom(7))), 0);
});

test('when repeats cannot be avoided they are kept low and counted', () => {
  // 10 jugadors en dues taules de 5: a la segona partida, per força, n'hi ha que repeteixen.
  const s = makeSchedule(10, 2, seededRandom(3));
  // El millor possible és partir cada taula 3 + 2: 4 parelles repetides per taula.
  assert.equal(countRepeats(s), 8);
});

test('the same seed gives the same draw', () => {
  assert.deepEqual(makeSchedule(30, 3, seededRandom(42)), makeSchedule(30, 3, seededRandom(42)));
});

test('countRepeats counts each extra meeting of a pair', () => {
  const s = [[[0, 1, 2]], [[0, 1, 2]]];
  assert.equal(countRepeats(s), 3);
  assert.equal(countRepeats([[[0, 1], [2, 3]], [[0, 2], [1, 3]]]), 0);
});

// ---------- Noms i validació ----------

test('names are read one per line, trimmed, blank lines skipped, list markers removed', () => {
  assert.deepEqual(parseNames(' Núria \n\n2. Mercè\n- Joan\n3) Pep\n• Anna\n'), ['Núria', 'Mercè', 'Joan', 'Pep', 'Anna']);
});

test('a tournament needs at least three players and unique names', () => {
  assert.deepEqual(validateTournament(['A', 'B']), ['too-few']);
  assert.deepEqual(validateTournament(['A', 'B', 'a']), ['duplicate-name']);
  assert.deepEqual(validateTournament(names(30)), []);
  assert.deepEqual(validateTournament(names(121)), ['too-many']);
  assert.deepEqual(validateTournament(['A', 'B', 'x'.repeat(41)]), ['name-too-long']);
});

// ---------- Torneig ----------

const fixedTournament = () => ({
  id: 'abc123',
  name: 'Torneig de tardor',
  createdAt: 1791547200000,
  players: ['Núria', 'Mercè', 'Joan', 'Pep', 'Anna', 'Rosa', 'Lluís', 'Marta', 'Jordi'],
  games: 2,
  rounds: 2,
  // Partida 1: taula de 5 i taula de 4. Partida 2: també.
  schedule: [
    [[0, 1, 2, 3, 4], [5, 6, 7, 8]],
    [[0, 5, 6, 1, 2], [3, 4, 7, 8]],
  ],
  results: {},
});

test('createTournament keeps the names, the format and a draw for every game', () => {
  const t = createTournament({ name: '  ', players: names(30), games: 3, rounds: 5, schedule: makeSchedule(30, 3, seededRandom(1)) });
  assert.equal(t.players.length, 30);
  assert.equal(t.games, 3);
  assert.equal(t.rounds, 5);
  assert.equal(t.schedule.length, 3);
  assert.equal(t.name, '');
  assert.match(t.id, /^[a-z0-9]{8}$/);
  assert.deepEqual(t.results, {});
});

test('an invitation carries the tournament, game, table, names and rounds', () => {
  const t = fixedTournament();
  const inv = decodeInvite(encodeInvite(t, 1, 0));
  assert.equal(inv.ok, true);
  assert.deepEqual(inv.invite, { id: 'abc123', name: 'Torneig de tardor', game: 1, table: 0, players: ['Núria', 'Rosa', 'Lluís', 'Mercè', 'Joan'], rounds: 2 });
});

test('an invitation is read from a link, a pasted message or the bare payload', () => {
  const t = fixedTournament();
  const link = inviteLink(t, 0, 1, 'https://appayo.vercel.app/?x=1#old');
  assert.match(link, /^https:\/\/appayo\.vercel\.app\/#t=[A-Za-z0-9_-]+$/);
  assert.equal(decodeInvite(link).ok, true);
  assert.equal(decodeInvite(inviteMessage(t, 0, 1, link)).ok, true);
  assert.equal(decodeInvite('hola').ok, false);
  assert.equal(decodeInvite(link.slice(0, 50)).error, 'bad-link');
});

test('an invitation with nonsense inside is rejected', () => {
  const bad = Buffer.from(JSON.stringify({ v: 1, i: 'abc', n: '', g: 0, k: 0, p: ['A'], r: 5 })).toString('base64url');
  assert.equal(decodeInvite(`#t=${bad}`).error, 'bad-data');
  const newer = Buffer.from(JSON.stringify({ v: 9 })).toString('base64url');
  assert.equal(decodeInvite(`#t=${newer}`).error, 'bad-version');
});

test('the invitation message names the table and who plays', () => {
  const t = fixedTournament();
  const msg = inviteMessage(t, 1, 1, 'https://x/#t=1');
  assert.match(msg, /Torneig de tardor/);
  assert.match(msg, /^Torneig de tardor: partida 2, taula 2$/m);
  assert.match(msg, /Pep, Anna, Marta i Jordi/);
  assert.match(msg, /2 rondes/);
  assert.match(msg, /https:\/\/x\/#t=1$/);
});

// ---------- Resultats ----------

const table0 = () => ({
  players: ['Núria', 'Mercè', 'Joan', 'Pep', 'Anna'],
  rounds: [
    { papayoo: 0, points: [100, 50, 0, 50, 50] },
    { papayoo: 1, points: [0, 90, 60, 50, 50] },
  ],
  createdAt: 1791550000000,
  endedAt: 1791553600000,
  tour: { id: 'abc123', name: 'Torneig de tardor', game: 0, table: 0 },
});

test('a table result travels in the usual share link and keeps its tournament tag', () => {
  const back = decodeShared(encodeGame(table0()));
  assert.equal(back.ok, true);
  assert.deepEqual(back.game.tour, { id: 'abc123', name: 'Torneig de tardor', game: 0, table: 0 });
  // Una partida normal no porta etiqueta.
  const plain = { ...table0() };
  delete plain.tour;
  assert.equal(decodeShared(encodeGame(plain)).game.tour, undefined);
});

test('acceptResult checks the result belongs to this tournament and table', () => {
  const t = fixedTournament();
  assert.deepEqual(acceptResult(t, table0()), { ok: true, key: '0-0', replaces: false });
  assert.equal(acceptResult({ ...t, id: 'zzz' }, table0()).error, 'other-tournament');
  assert.equal(acceptResult(t, { ...table0(), tour: { ...table0().tour, table: 5 } }).error, 'bad-table');
  assert.equal(acceptResult(t, { ...table0(), players: ['A', 'B', 'C', 'D', 'E'] }).error, 'other-players');
  t.results['0-0'] = tableResult(table0());
  assert.equal(acceptResult(t, table0()).replaces, true);
});

test('the result message says which table it is and who won it', () => {
  const msg = resultMessage(table0(), 'https://x/#p=1');
  assert.match(msg, /^Torneig de tardor: partida 1, taula 1 \(2 rondes\)$/m);
  assert.match(msg, /Guanya Joan amb 60 punts/);
  assert.match(msg, /https:\/\/x\/#p=1$/);
});

// ---------- Classificació ----------

const withResults = () => {
  const t = fixedTournament();
  // Partida 1, taula 1 (5 jugadors): Núria 100, Mercè 140, Joan 60, Pep 100, Anna 100.
  t.results['0-0'] = tableResult(table0());
  // Partida 1, taula 2 (4 jugadors): Rosa, Lluís, Marta, Jordi.
  t.results['0-1'] = tableResult({
    players: ['Rosa', 'Lluís', 'Marta', 'Jordi'],
    rounds: [{ papayoo: 0, points: [100, 100, 50, 0] }, { papayoo: 3, points: [0, 100, 50, 100] }],
  });
  return t;
};

test('points at a table of four are scaled to a table of five when sizes differ', () => {
  const rows = tournamentStandings(withResults());
  const by = Object.fromEntries(rows.map(r => [r.name, r]));
  // Taula de 4: es multiplica per 4/5.
  assert.equal(by.Rosa.total, 100 * 4 / 5);
  assert.equal(by.Lluís.total, 200 * 4 / 5);
  assert.equal(by.Jordi.games[0].raw, 100);
  assert.equal(by.Jordi.games[0].points, 80);
  // Taula de 5: igual.
  assert.equal(by.Joan.total, 60);
  assert.equal(by.Mercè.total, 140);
  assert.equal(by.Mercè.games[1], null);
});

test('when every table has the same size points are not scaled', () => {
  const t = createTournament({ name: '', players: names(10), games: 1, rounds: 1, schedule: [[[0, 1, 2, 3, 4], [5, 6, 7, 8, 9]]] });
  t.results['0-0'] = tableResult({ players: names(5), rounds: [{ papayoo: 0, points: [250, 0, 0, 0, 0] }] });
  const rows = tournamentStandings(t);
  assert.equal(rows.find(r => r.name === 'Jugador 1').total, 250);
  assert.equal(needsScaling(t), false);
  assert.equal(needsScaling(fixedTournament()), true);
});

test('standings sort by fewest points, ties share the place, and count what is missing', () => {
  const rows = tournamentStandings(withResults());
  assert.deepEqual(rows.map(r => r.name).slice(0, 4), ['Joan', 'Rosa', 'Marta', 'Jordi']);
  assert.deepEqual(rows.map(r => r.rank).slice(0, 5), [1, 2, 2, 2, 5]);
  assert.equal(rows[0].played, 1);
});

test('standings also count rounds at zero, Papayoos and the worst single round', () => {
  const by = Object.fromEntries(tournamentStandings(withResults()).map(r => [r.name, r]));
  assert.equal(by.Núria.zeros, 1);
  assert.equal(by.Núria.papayoos, 1);
  assert.equal(by.Joan.zeros, 1);
  assert.equal(by.Joan.papayoos, 0);
  assert.equal(by.Núria.worst, 100);
  assert.equal(by.Lluís.worst, 80); // 100 escalat a 4/5
});

test('awards go to everyone tied, like the spreadsheet', () => {
  const a = awards(tournamentStandings(withResults()));
  const get = (k) => a.find(x => x.key === k);
  assert.deepEqual(get('champion').names, ['Joan']);
  assert.equal(get('champion').value, 60);
  assert.deepEqual(get('spoon').names, ['Lluís']);
  assert.equal(get('spoon').value, 160);
  assert.deepEqual(get('zeros').names.sort(), ['Joan', 'Jordi', 'Núria', 'Rosa']);
  assert.equal(get('zeros').value, 1);
  assert.deepEqual(get('papayoo').names.sort(), ['Jordi', 'Mercè', 'Núria', 'Rosa']);
  // Rosa, Lluís i Jordi van fer 100 en una ronda, però a taula de 4: compten 80.
  assert.deepEqual(get('record').names, ['Núria']);
  assert.equal(get('record').value, 100);
});

test('no awards before any table has sent its result, and nobody has a place yet', () => {
  const rows = tournamentStandings(fixedTournament());
  assert.deepEqual(awards(rows), []);
  assert.ok(rows.every(r => r.rank === null && r.played === 0));
});

test('players still waiting for every result go after those who have one', () => {
  const t = fixedTournament();
  t.results['0-1'] = tableResult({
    players: ['Rosa', 'Lluís', 'Marta', 'Jordi'],
    rounds: [{ papayoo: 0, points: [100, 100, 50, 0] }],
  });
  const rows = tournamentStandings(t);
  assert.deepEqual(rows.slice(0, 4).map(r => r.name), ['Jordi', 'Marta', 'Rosa', 'Lluís']);
  assert.equal(rows[4].rank, null);
});

test('progress counts received tables', () => {
  assert.deepEqual(progress(withResults()), { received: 2, total: 4 });
});

test('points are written the Catalan way, with one decimal at most', () => {
  assert.equal(fmtPoints(80), '80');
  assert.equal(fmtPoints(81.6), '81,6');
  assert.equal(fmtPoints(81.66666), '81,7');
});

test('the standings message lists places and awards', () => {
  const t = withResults();
  const msg = standingsMessage(t, tournamentStandings(t));
  assert.match(msg, /Torneig de tardor/);
  assert.match(msg, /2 de 4 taules/);
  assert.match(msg, /^1\. Joan 60$/m);
  assert.match(msg, /^2\. Marta 80$/m);
  assert.match(msg, /Campió\/ona: Joan/);
  assert.match(msg, /Cullera de fusta: Lluís/);
});
