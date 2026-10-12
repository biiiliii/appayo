import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeGame, decodeShared, normalizeSharedGame, shareLink, legacyShareLink, shareMessage, gameKey } from '../frontend/share.js';

const game = () => ({
  players: ['Núria', 'Mercè', 'Joan'],
  rounds: [
    { papayoo: 0, points: [100, 100, 50] },
    { papayoo: 2, points: [80, 20, 150] },
  ],
  createdAt: 1789063200000,
  endedAt: 1789070400000,
});

test('a game survives the trip to a link and back, accents included', () => {
  const back = decodeShared(encodeGame(game()));
  assert.equal(back.ok, true);
  assert.deepEqual(back.game, game());
});

test('the encoded payload is safe inside a URL', () => {
  assert.match(encodeGame(game()), /^[A-Za-z0-9_-]+$/);
});

test('a whole shared message is accepted, not only the bare payload', () => {
  const payload = encodeGame(game());
  const message = `Papayoo, 3 rondes\n\nMira-la sencera: https://appayo.vercel.app/#p=${payload}`;
  assert.deepEqual(decodeShared(message).game, game());
  assert.deepEqual(decodeShared(`https://appayo.vercel.app/#p=${payload}`).game, game());
  assert.deepEqual(decodeShared(`  ${payload}  `).game, game());
});

test('a truncated link is rejected instead of half-read', () => {
  const cut = encodeGame(game()).slice(0, 40);
  const r = decodeShared(cut);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'bad-link');
});

test('empty or nonsense text is rejected', () => {
  for (const text of ['', '   ', 'hola què tal', 'https://appayo.vercel.app/']) {
    assert.equal(decodeShared(text).ok, false, text);
  }
});

test('a link from a newer version of the app says so', () => {
  const payload = encodeGame(game());
  const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  json.v = 99;
  const newer = Buffer.from(JSON.stringify(json), 'utf8').toString('base64url');
  assert.deepEqual(decodeShared(newer), { ok: false, error: 'bad-version' });
});

test('tampered data is rejected: rounds that do not add up to 250', () => {
  const g = game();
  g.rounds[0].points = [100, 100, 49];
  const r = decodeShared(encodeGame(g));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'bad-data');
});

test('un enllaç antic amb el Papayoo a qui té menys de 40 punts s’obre igualment', () => {
  // L'app anterior no ho comprovava: aquests enllaços ja corren pel WhatsApp.
  const g = game();
  g.rounds[0] = { papayoo: 1, points: [250, 0, 0] };
  const moved = decodeShared(encodeGame(g));
  assert.equal(moved.ok, true);
  assert.deepEqual(moved.game.rounds[0], { papayoo: 0, points: [250, 0, 0] }, 'només el primer pot tenir-lo');

  g.rounds[0] = { papayoo: 2, points: [125, 125, 0] };
  const kept = decodeShared(encodeGame(g));
  assert.equal(kept.ok, true);
  assert.deepEqual(kept.game.rounds[0], { papayoo: 2, points: [125, 125, 0] }, 'si és dubtós, es mostra com va arribar');
});

test('tampered data is rejected: too few players, or a papayoo nobody holds', () => {
  const few = { ...game(), players: ['Joan', 'Anna'], rounds: [{ papayoo: 0, points: [150, 100] }] };
  assert.equal(decodeShared(encodeGame(few)).error, 'bad-data');

  const g = game();
  g.rounds[1].papayoo = 7;
  assert.equal(decodeShared(encodeGame(g)).error, 'bad-data');
});

test('a game with no rounds is not worth sharing', () => {
  const empty = { ...game(), rounds: [] };
  assert.equal(decodeShared(encodeGame(empty)).error, 'bad-data');
});

test('the short link points to the shared game', () => {
  const id = 'e66b25e9-a5e5-4b1b-91ee-8dd91ade1c67';
  assert.equal(shareLink(id, 'https://appayo.vercel.app/partida?x=1#p=old'),
    `https://appayo.vercel.app/shared/${id}`);
});

test('the legacy link can still be opened', () => {
  const url = legacyShareLink(game(), 'https://appayo.vercel.app/partida?x=1#p=old');
  assert.equal(url, `https://appayo.vercel.app/partida#p=${encodeGame(game())}`);
  assert.deepEqual(decodeShared(url).game, game());
});

test('the server snapshot validates rounds and copies the data', () => {
  const original = game();
  const snapshot = normalizeSharedGame({ ...original, roundsPlanned: 4 });
  assert.deepEqual(snapshot.rounds, original.rounds);
  original.rounds[0].points[0] = 250;
  assert.equal(snapshot.rounds[0].points[0], 100);
  assert.equal(normalizeSharedGame(original), null);
});

test('the message tells who won, the standings and where to see it all', () => {
  const url = 'https://appayo.vercel.app/#p=xyz';
  const text = shareMessage(game(), url);
  const lines = text.split('\n');

  assert.match(lines[0], /^Papayoo, .*2026 \(2 rondes\)$/);
  assert.equal(lines[1], 'Guanya Mercè amb 120 punts.');
  assert.ok(text.includes('1. Mercè 120\n2. Núria 180\n3. Joan 200'), text);
  assert.ok(text.endsWith(`Mira-la sencera: ${url}`), text);
});

test('a message about a single round says one round, not 1 rondes', () => {
  const g = { ...game(), rounds: [{ papayoo: 0, points: [100, 100, 50] }] };
  assert.match(shareMessage(g, 'x').split('\n')[0], /\(1 ronda\)$/);
});

test('a tie at the top is worded as a tie', () => {
  const g = { ...game(), rounds: [{ papayoo: 0, points: [100, 75, 75] }] };
  const lines = shareMessage(g, 'x').split('\n');
  assert.equal(lines[1], 'Empaten Mercè i Joan amb 75 punts.');
  assert.ok(lines.includes('1. Mercè 75'), lines.join('|'));
  assert.ok(lines.includes('1. Joan 75'), lines.join('|'));
  assert.ok(lines.includes('3. Núria 100'), lines.join('|'));
});

test('a game received twice is recognised as the same game', () => {
  const mine = { ...game(), id: '1757523600000-ab12c' };
  assert.equal(gameKey(decodeShared(encodeGame(mine)).game), gameKey(mine));
  assert.notEqual(gameKey({ ...game(), createdAt: 1 }), gameKey(game()));
  assert.notEqual(gameKey({ ...game(), players: ['Joan', 'Mercè', 'Núria'] }), gameKey(game()));
});
