import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'appayo-api-'));
process.env.SQLITE_PATH = join(dir, 'test.sqlite');
const { handleApi } = await import('../backend/api.js');

async function call(path, method = 'GET', body, token) {
  const response = await handleApi(new Request(`http://localhost/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { status: response.status, data: await response.json() };
}

test('el torneig queda guardat i la classificació no surt abans de revelar-la', async () => {
  const players = ['Anna', 'Berta', 'Carles', 'David'];
  const created = await call('/tournaments', 'POST', { name: 'Prova', players, games: 1, rounds: 2, password: 'contrasenya123' });
  assert.equal(created.status, 201);
  const { id, token } = created.data;
  assert.equal((await call(`/tournaments/${id}`)).status, 401);
  const admin = await call(`/tournaments/${id}`, 'GET', undefined, token);
  assert.equal(admin.status, 200);
  const tableToken = admin.data.links[0][0];
  assert.equal((await call(`/tables/${tableToken}`)).data.players.length, 4);
  assert.equal((await call(`/tournaments/${id}/reveal`, 'PUT', { step: 1 }, token)).status, 400);
  assert.equal((await call(`/tables/${tableToken}/rounds`, 'PUT', { rounds: [{ papayoo: 0, points: [1, 2, 3, 4] }] })).status, 400);
  assert.equal((await call(`/tables/${tableToken}/rounds`, 'PUT', { rounds: [{ papayoo: 0, points: [0, 250, 0, 0] }] })).status, 400);
  const rounds = [
    { papayoo: 0, points: [40, 40, 40, 130] },
    { papayoo: 1, points: [20, 40, 90, 100] },
  ];
  assert.equal((await call(`/tables/${tableToken}/rounds`, 'PUT', { rounds: rounds.slice(0, 1) })).status, 200);
  const inProgress = (await call(`/tournaments/${id}/status`)).data;
  assert.equal(inProgress.progress.received, 0);
  assert.equal(inProgress.tables[0].rounds, 1);
  assert.equal((await call(`/tables/${tableToken}/rounds`, 'PUT', { rounds })).status, 200);
  const hidden = (await call(`/tournaments/${id}/status`)).data;
  assert.equal(hidden.progress.received, 1);
  assert.equal(hidden.revealed, false);
  assert.equal('standings' in hidden, false);
  assert.equal('results' in hidden, false);
  assert.equal('links' in hidden, false);
  assert.equal((await call(`/tournaments/${id}/login`, 'POST', { password: 'incorrecta' })).status, 401);
  assert.equal((await call(`/tournaments/${id}/login`, 'POST', { password: 'contrasenya123' })).status, 200);
  assert.equal((await call(`/tournaments/${id}/reveal`, 'PUT', { step: 1 }, token)).status, 200);
  const partial = (await call(`/tournaments/${id}/status`)).data;
  assert.equal(partial.podium.length, 1);
  assert.equal('standings' in partial, false);
  for (const step of [2, 3, 4]) assert.equal((await call(`/tournaments/${id}/reveal`, 'PUT', { step }, token)).status, 200);
  const shown = (await call(`/tournaments/${id}/status`)).data;
  assert.equal(shown.revealStep, 4);
  assert.equal(shown.standings[0].name, 'Anna');
  assert.equal(shown.results['0-0'].rounds.length, 2);
});

test('una partida compartida conserva l’enllaç en actualitzar-se i només el propietari la pot modificar', async () => {
  const game = {
    players: ['Anna', 'Berta', 'Carles'],
    rounds: [{ papayoo: 0, points: [100, 100, 50] }],
    createdAt: 1789063200000, endedAt: 1789070400000, roundsPlanned: 3,
  };
  assert.equal((await call('/shared-games', 'POST', { game: { ...game, rounds: [] } })).status, 400);
  const created = await call('/shared-games', 'POST', { game });
  assert.equal(created.status, 201);
  const { id, writeToken } = created.data;
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(writeToken.length, 32);
  const publicRead = await call(`/shared-games/${id}`);
  assert.deepEqual(publicRead.data.game, game);
  assert.equal('writeToken' in publicRead.data, false);
  assert.equal((await call(`/shared-games/${id}`, 'PUT', { game })).status, 401);
  assert.equal((await call(`/shared-games/${id}`, 'PUT', { game }, 'x'.repeat(32))).status, 401);
  const updated = { ...game, rounds: [...game.rounds, { papayoo: 2, points: [80, 70, 100] }] };
  assert.equal((await call(`/shared-games/${id}`, 'PUT', { game: updated }, writeToken)).status, 200);
  assert.deepEqual((await call(`/shared-games/${id}`)).data.game, updated);
  assert.equal((await call(`/shared-games/${id}`, 'DELETE', undefined, writeToken)).status, 404);
  assert.deepEqual((await call(`/shared-games/${id}`)).data.game, updated);
  assert.equal((await call('/shared-games/00000000-0000-0000-0000-000000000000')).status, 404);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
