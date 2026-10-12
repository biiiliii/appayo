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

test('el torneig neix en configuració i conserva el codi en preparar les partides', async () => {
  const created = await call('/tournaments', 'POST', { name: 'Primavera', password: '1234' });
  assert.equal(created.status, 201);
  const { id, token } = created.data;
  assert.match(id, /^[BCDFGHJKLMNPRSTVWXYZ]{5}$/);
  const pending = await call(`/tournaments/${id}`, 'GET', undefined, token);
  assert.equal(pending.data.phase, 'configuring');
  assert.equal(pending.data.name, 'Primavera');
  assert.equal('schedule' in pending.data, false);
  assert.equal((await call(`/tournaments/${id}/status`)).data.phase, 'configuring');
  assert.equal((await call(`/tournaments/${id}/configure`, 'PUT', { players: ['Anna', 'Biel', 'Carla'], games: 2, rounds: 3 })).status, 401);
  assert.equal((await call(`/tournaments/${id}/configure`, 'PUT', { players: ['Anna'], games: 2, rounds: 3 }, token)).status, 400);
  assert.equal((await call(`/tournaments/${id}/configure`, 'PUT', { players: ['Anna', 'Biel', 'Carla'], games: 2, rounds: 3 }, token)).status, 200);
  const ready = await call(`/tournaments/${id}`, 'GET', undefined, token);
  assert.equal(ready.data.phase, 'playing');
  assert.equal(ready.data.schedule.length, 2);
  const table = (await call(`/tables/${ready.data.links[0][0]}`)).data;
  assert.equal(table.tournamentId, id);
  assert.deepEqual(table.players, ready.data.schedule[0][0].map(index => ready.data.players[index]));
  assert.deepEqual((await call(`/tournaments/${id}/status`)).data.schedule, ready.data.schedule);
  assert.equal((await call(`/tournaments/${id}/configure`, 'PUT', { players: ['Anna', 'Biel', 'Carla'], games: 1, rounds: 1 }, token)).status, 409);
});

test('el QR públic del torneig es pot consultar abans d’iniciar-lo', async () => {
  const { id } = (await call('/tournaments', 'POST', { name: 'QR públic', password: '1234' })).data;
  const response = await handleApi(new Request(`https://appayo.example/api/v1/tournaments/${id}/qr`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^image\/svg\+xml/);
  assert.match(await response.text(), /<svg[^>]*>.*<path/s);
  assert.equal((await call(`/tournaments/${id}/status`)).data.phase, 'configuring');
});

test('el QR de taula es genera sense sessió de gestió', async () => {
  const { id, token } = (await call('/tournaments', 'POST', { name: 'QR de taula', password: '1234' })).data;
  assert.equal((await call(`/tournaments/${id}/configure`, 'PUT', {
    players: ['Anna', 'Biel'], games: 1, rounds: 1,
  }, token)).status, 200);
  const ready = (await call(`/tournaments/${id}`, 'GET', undefined, token)).data;
  const tableToken = ready.links[0][0];
  const response = await handleApi(new Request(`https://appayo.example/api/v1/tables/${tableToken}/qr`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^image\/svg\+xml/);
  assert.match(await response.text(), /<svg[^>]*>.*<path/s);
  const missing = await handleApi(new Request(`https://appayo.example/api/v1/tables/${'x'.repeat(32)}/qr`));
  assert.equal(missing.status, 404);
});

test('un torneig de dos jugadors es pot iniciar', async () => {
  const { id, token } = (await call('/tournaments', 'POST', { name: 'Dues persones', password: '1234' })).data;
  assert.equal((await call(`/tournaments/${id}/configure`, 'PUT', { players: ['Anna', 'Biel'], games: 1, rounds: 2 }, token)).status, 200);
  const ready = (await call(`/tournaments/${id}`, 'GET', undefined, token)).data;
  assert.deepEqual(ready.schedule[0][0].slice().sort((a, b) => a - b), [0, 1]);
});

test('les taules només poden enviar rondes durant el seu torn', async () => {
  const { id, token } = (await call('/tournaments', 'POST', { name: 'Torns', password: '1234' })).data;
  const config = { players: Array.from({ length: 10 }, (_, i) => `Jugador ${i + 1}`), games: 2, rounds: 1,
    simultaneousTables: 1, weightUnevenTables: false };
  assert.equal((await call(`/tournaments/${id}/configure`, 'PUT', config, token)).status, 200);
  const admin = (await call(`/tournaments/${id}`, 'GET', undefined, token)).data;
  assert.equal(admin.simultaneousTables, 1);
  assert.equal(admin.weightUnevenTables, false);
  assert.deepEqual(admin.currentWave, { game: 0, wave: 0 });
  assert.deepEqual(admin.tables.map(t => [t.game, t.table, t.wave, t.active]),
    [[0, 0, 0, true], [0, 1, 1, false], [1, 0, 0, false], [1, 1, 1, false]]);
  const publicStatus = (await call(`/tournaments/${id}/status`)).data;
  assert.equal(publicStatus.tables[0].entryPath, `/tournaments/table/${admin.links[0][0]}`);
  assert.equal('entryPath' in publicStatus.tables[1], false);
  assert.equal('links' in publicStatus, false);
  const later = admin.links[0][1];
  const rounds = [{ papayoo: 0, points: [100, 50, 50, 50, 0] }];
  assert.equal((await call(`/tables/${later}`)).data.active, false);
  assert.equal((await call(`/tables/${later}/rounds`, 'PUT', { rounds })).status, 409);
  assert.equal((await call(`/tables/${admin.links[0][0]}/rounds`, 'PUT', { rounds })).status, 200);
  const nextStatus = (await call(`/tournaments/${id}/status`)).data;
  assert.deepEqual(nextStatus.currentWave, { game: 0, wave: 1 });
  assert.equal('entryPath' in nextStatus.tables[0], false);
  assert.equal(nextStatus.tables[1].entryPath, `/tournaments/table/${later}`);
  assert.equal((await call(`/tables/${later}`)).data.active, true);
  assert.equal((await call(`/tables/${later}/rounds`, 'PUT', { rounds })).status, 200);
  assert.deepEqual((await call(`/tournaments/${id}/status`)).data.currentWave, { game: 1, wave: 0 });
});

test('una taula acabada no té enllaç públic mentre les altres continuen jugant', async () => {
  const { id, token } = (await call('/tournaments', 'POST', { name: 'Taules simultànies', password: '1234' })).data;
  const config = { players: Array.from({ length: 10 }, (_, i) => `Jugador ${i + 1}`), games: 1, rounds: 1,
    simultaneousTables: 2 };
  assert.equal((await call(`/tournaments/${id}/configure`, 'PUT', config, token)).status, 200);
  const admin = (await call(`/tournaments/${id}`, 'GET', undefined, token)).data;
  const rounds = [{ papayoo: 0, points: [100, 50, 50, 50, 0] }];
  assert.equal((await call(`/tables/${admin.links[0][0]}/rounds`, 'PUT', { rounds })).status, 200);
  const publicStatus = (await call(`/tournaments/${id}/status`)).data;
  assert.deepEqual(publicStatus.currentWave, { game: 0, wave: 0 });
  assert.equal(publicStatus.tables[0].finished, true);
  assert.equal('entryPath' in publicStatus.tables[0], false);
  assert.equal(publicStatus.tables[1].entryPath, `/tournaments/table/${admin.links[0][1]}`);
});

test('la mida ideal dels grups es desa i afecta el sorteig', async () => {
  const { id, token } = (await call('/tournaments', 'POST', { name: 'Mida ideal', password: '1234' })).data;
  const config = { players: Array.from({ length: 10 }, (_, i) => `Jugador ${i + 1}`), games: 1, rounds: 1,
    playersPerTable: 4, simultaneousTables: 2, weightUnevenTables: true };
  assert.equal((await call(`/tournaments/${id}/configure`, 'PUT', { ...config, playersPerTable: 1 }, token)).status, 400);
  assert.equal((await call(`/tournaments/${id}/configure`, 'PUT', config, token)).status, 200);
  const ready = (await call(`/tournaments/${id}`, 'GET', undefined, token)).data;
  assert.equal(ready.playersPerTable, 4);
  assert.deepEqual(ready.schedule[0].map(table => table.length), [4, 3, 3]);
  assert.deepEqual(ready.tables.map(table => table.wave), [0, 0, 1]);
});

test('dues configuracions simultànies no creen taules duplicades', async () => {
  const { id, token } = (await call('/tournaments', 'POST', { name: 'Simultani', password: '1234' })).data;
  const body = { players: ['Anna', 'Biel', 'Carla', 'David'], games: 1, rounds: 2 };
  const responses = await Promise.all([
    call(`/tournaments/${id}/configure`, 'PUT', body, token),
    call(`/tournaments/${id}/configure`, 'PUT', body, token),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const ready = (await call(`/tournaments/${id}`, 'GET', undefined, token)).data;
  assert.equal(ready.tables.length, 1);
  assert.equal((await call(`/tables/${ready.links[0][0]}`)).status, 200);
});

test('un token fals o d’un altre torneig no autoritza cap acció de gestió', async () => {
  const owner = (await call('/tournaments', 'POST', { name: 'Protegit', password: 'clau-correcta' })).data;
  const another = (await call('/tournaments', 'POST', { name: 'Un altre', password: 'clau-altra' })).data;
  const forged = 'x'.repeat(32);
  const configuration = { players: ['Anna', 'Biel', 'Carla'], games: 1, rounds: 2 };

  assert.equal((await call(`/tournaments/${owner.id}`)).status, 401);
  assert.equal((await call(`/tournaments/${owner.id}`, 'GET', undefined, forged)).status, 401);
  assert.equal((await call(`/tournaments/${owner.id}`, 'GET', undefined, another.token)).status, 401);
  assert.equal((await call(`/tournaments/${owner.id}/configure`, 'PUT', configuration, forged)).status, 401);
  assert.equal((await call(`/tournaments/${owner.id}/configure`, 'PUT', configuration, another.token)).status, 401);
  assert.equal((await call(`/tournaments/${owner.id}/reveal`, 'PUT', { step: 0 }, forged)).status, 401);
  assert.equal((await call(`/tournaments/${owner.id}/login`, 'POST', { password: 'clau-altra' })).status, 401);
  assert.equal((await call(`/tournaments/${owner.id}/status`)).data.phase, 'configuring');
  assert.equal((await call(`/tournaments/${owner.id}`, 'GET', undefined, owner.token)).status, 200);
});

test('el canvi de nom requereix sessió i arriba a les pantalles públiques i a les taules', async () => {
  const { id, token } = (await call('/tournaments', 'POST', { name: 'Nom inicial', password: '1234' })).data;
  assert.equal((await call(`/tournaments/${id}/name`, 'PUT', { name: 'Fals' })).status, 401);
  assert.equal((await call(`/tournaments/${id}/name`, 'PUT', { name: '  ' }, token)).status, 400);
  assert.equal((await call(`/tournaments/${id}/name`, 'PUT', { name: 'A'.repeat(61) }, token)).status, 400);
  assert.equal((await call(`/tournaments/${id}/name`, 'PUT', { name: '  Nom nou  ' }, token)).data.name, 'Nom nou');
  assert.equal((await call(`/tournaments/${id}`, 'GET', undefined, token)).data.name, 'Nom nou');
  assert.equal((await call(`/tournaments/${id}/login`, 'POST', { password: '1234' })).data.name, 'Nom nou');
  await call(`/tournaments/${id}/configure`, 'PUT', { players: ['Anna', 'Biel', 'Carla'], games: 1, rounds: 2 }, token);
  const ready = (await call(`/tournaments/${id}`, 'GET', undefined, token)).data;
  assert.equal((await call(`/tournaments/${id}/name`, 'PUT', { name: 'Nom final' }, token)).status, 200);
  assert.equal((await call(`/tournaments/${id}/status`)).data.name, 'Nom final');
  assert.equal((await call(`/tables/${ready.links[0][0]}`)).data.tournamentName, 'Nom final');
});

test('el torneig queda guardat i la classificació no surt abans de revelar-la', async () => {
  const players = ['Anna', 'Berta', 'Carles', 'David'];
  const created = await call('/tournaments', 'POST', { name: 'Prova', players, games: 1, rounds: 2, password: '1234' });
  assert.equal(created.status, 201);
  const { id, token } = created.data;
  assert.equal((await call(`/tournaments/${id}`)).status, 401);
  const admin = await call(`/tournaments/${id}`, 'GET', undefined, token);
  assert.equal(admin.status, 200);
  const tableToken = admin.data.links[0][0];
  const tablePlayers = (await call(`/tables/${tableToken}`)).data.players;
  assert.equal(tablePlayers.length, 4);
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
  assert.equal(hidden.phase, 'playing');
  assert.equal('standings' in hidden, false);
  assert.equal('results' in hidden, false);
  assert.equal('links' in hidden, false);
  assert.equal((await call(`/tournaments/${id}/login`, 'POST', { password: 'incorrecta' })).status, 401);
  const login = await call(`/tournaments/${id}/login`, 'POST', { password: '1234' });
  assert.equal(login.status, 200);
  assert.equal(login.data.name, 'Prova');
  assert.equal((await call(`/tournaments/${id}/reveal`, 'PUT', { step: 1 }, token)).status, 200);
  const changedRounds = [
    { papayoo: 0, points: [50, 40, 40, 120] },
    rounds[1],
  ];
  assert.equal((await call(`/tables/${tableToken}/rounds`, 'PUT', { rounds: changedRounds })).status, 409);
  assert.equal((await call(`/tables/${tableToken}/rounds`, 'PUT', { rounds })).status, 409);
  assert.equal((await call(`/tournaments/${id}/reveal`, 'PUT', { step: 0 }, token)).status, 409);
  const closedTable = await call(`/tables/${tableToken}`);
  assert.equal(closedTable.data.revealed, true);
  assert.deepEqual(closedTable.data.rounds, rounds);
  assert.equal('award' in (await call(`/tournaments/${id}`, 'GET', undefined, token)).data, false);
  for (let step = 1; step <= 7; step++) {
    if (step > 1) assert.equal((await call(`/tournaments/${id}/reveal`, 'PUT', { step }, token)).status, 200);
    if (step > 1) assert.equal((await call(`/tournaments/${id}`, 'GET', undefined, token)).data.award.key,
      ['spoon', 'papayoo', 'record', 'zeros', 'place-3', 'place-2'][step - 2]);
    const pending = (await call(`/tournaments/${id}/status`)).data;
    assert.equal(pending.revealed, false);
    assert.equal(pending.revealStep, 0);
    assert.equal(pending.phase, 'playing');
    assert.equal('award' in pending, false);
    assert.equal('standings' in pending, false);
    assert.equal('results' in pending, false);
  }
  assert.equal((await call(`/tournaments/${id}/reveal`, 'PUT', { step: 8 }, token)).status, 200);
  const first = (await call(`/tournaments/${id}/status`)).data;
  assert.equal(first.revealed, true);
  assert.equal(first.phase, 'results_shown');
  assert.equal(first.award.key, 'place-1');
  assert.equal('standings' in first, false);
  assert.equal('results' in first, false);
  assert.equal((await call(`/tournaments/${id}/reveal`, 'PUT', { step: 9 }, token)).status, 200);
  const shown = (await call(`/tournaments/${id}/status`)).data;
  assert.equal(shown.revealStep, 9);
  assert.equal(shown.phase, 'results_shown');
  assert.equal(shown.standings[0].name, tablePlayers[0]);
  assert.equal(shown.standings[0].total, 60);
  assert.equal(shown.results['0-0'].rounds.length, 2);
  assert.equal(shown.awards.length, 7);
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
