import test from 'node:test';
import assert from 'node:assert/strict';
import { tournamentProgress, visibleTournamentWaves, suggestedTableCount } from '../frontend/tournament-progress.js';

test('el progrés segueix la taula més endarrerida de cada torn', () => {
  const data = {
    schedule: [[[0], [1]], [[0], [1]], [[0], [1]]],
    simultaneousTables: 2, rounds: 5,
    currentWave: { game: 0, wave: 0 },
    tables: [
      { game: 0, wave: 0, rounds: 2 }, { game: 0, wave: 0, rounds: 4 },
      { game: 1, wave: 0, rounds: 0 }, { game: 1, wave: 0, rounds: 0 },
      { game: 2, wave: 0, rounds: 0 }, { game: 2, wave: 0, rounds: 0 },
    ],
  };
  assert.deepEqual(tournamentProgress(data), {
    game: 1, wave: 1, waves: 1, round: 3, completed: 2, total: 15, hasMultipleWaves: false,
  });
  data.currentWave = { game: 1, wave: 0 };
  assert.equal(tournamentProgress(data).completed, 5);
  data.currentWave = null;
  assert.deepEqual(tournamentProgress(data), {
    game: 3, wave: 1, waves: 1, round: 5, completed: 15, total: 15, hasMultipleWaves: false,
  });
});

test('el progrés suma partides amb quantitats diferents de torns', () => {
  const data = {
    schedule: [[[0], [1]], [[0]]], simultaneousTables: 1, rounds: 5,
    currentWave: { game: 0, wave: 1 },
    tables: [
      { game: 0, wave: 0, rounds: 5 }, { game: 0, wave: 1, rounds: 1 },
      { game: 1, wave: 0, rounds: 0 },
    ],
  };
  assert.deepEqual(tournamentProgress(data), {
    game: 1, wave: 2, waves: 2, round: 2, completed: 6, total: 15, hasMultipleWaves: true,
  });
  data.currentWave = { game: 1, wave: 0 };
  assert.equal(tournamentProgress(data).completed, 10);
});

test('només es mostra el torn següent quan acaba una taula del torn actual', () => {
  const data = {
    schedule: [[[0], [1]], [[0]]], simultaneousTables: 1,
    currentWave: { game: 0, wave: 0 },
    tables: [
      { game: 0, wave: 0, finished: false },
      { game: 0, wave: 1, finished: false },
      { game: 1, wave: 0, finished: false },
    ],
  };
  assert.deepEqual(visibleTournamentWaves(data), [{ game: 0, wave: 0 }]);
  data.tables[0].finished = true;
  assert.deepEqual(visibleTournamentWaves(data), [{ game: 0, wave: 0 }, { game: 0, wave: 1 }]);
  data.currentWave = { game: 0, wave: 1 };
  assert.deepEqual(visibleTournamentWaves(data), [{ game: 0, wave: 1 }]);
  data.tables[1].finished = true;
  assert.deepEqual(visibleTournamentWaves(data), [{ game: 0, wave: 1 }, { game: 1, wave: 0 }]);
  data.currentWave = { game: 1, wave: 0 };
  assert.deepEqual(visibleTournamentWaves(data), [{ game: 1, wave: 0 }]);
  data.currentWave = null;
  assert.deepEqual(visibleTournamentWaves(data), []);
});

test('les taules previstes tenen almenys 3 jugadors i com a màxim 8', () => {
  assert.equal(suggestedTableCount(3, 5), 1);
  assert.equal(suggestedTableCount(5, 3), 1);
  assert.equal(suggestedTableCount(6, 3), 2);
  assert.equal(suggestedTableCount(10, 5), 2);
  assert.equal(suggestedTableCount(17, 8), 3);
  assert.equal(suggestedTableCount(17, 3), 5);
  assert.equal(suggestedTableCount(2, 5), 1);
  assert.equal(suggestedTableCount(12, ''), 2);
  for (let players = 3; players <= 120; players++) {
    for (let size = 3; size <= 8; size++) {
      const tables = suggestedTableCount(players, size);
      assert.ok(Math.floor(players / tables) >= 3, `${players} jugadors, taules de ${size}`);
      assert.ok(Math.ceil(players / tables) <= 8, `${players} jugadors, taules de ${size}`);
    }
  }
});

test('el nombre de taules que proposa el formulari coincideix amb el sorteig del servidor', async () => {
  const { tableSizes } = await import('../backend/tournament.js');
  for (let players = 3; players <= 120; players++) {
    for (let ideal = 3; ideal <= 8; ideal++) {
      assert.equal(suggestedTableCount(players, ideal), tableSizes(players, ideal).length, `${players} jugadors, ${ideal} per taula`);
    }
  }
});
