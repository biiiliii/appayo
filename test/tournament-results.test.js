import test from 'node:test';
import assert from 'node:assert/strict';
import { encountersByTurn } from '../frontend/tournament-results.js';

test('els enfrontaments inclouen totes les taules en ordre de partida, torn i taula', () => {
  const data = {
    schedule: [[[], [], []], [[]]],
    tables: [
      { game: 1, wave: 0, table: 0 },
      { game: 0, wave: 1, table: 2 },
      { game: 0, wave: 0, table: 1 },
      { game: 0, wave: 0, table: 0 },
    ],
    results: {
      '0-0': { players: ['A'], rounds: [{ points: [250] }] },
      '0-1': { players: ['B'], rounds: [{ points: [250] }] },
      '0-2': { players: ['C'], rounds: [{ points: [250] }] },
      '1-0': { players: ['D'], rounds: [{ points: [250] }] },
    },
  };
  const games = encountersByTurn(data);
  assert.deepEqual(games.map(item => item.game), [0, 1]);
  assert.deepEqual(games[0].waves.map(item => item.wave), [0, 1]);
  assert.deepEqual(games[0].waves[0].tables.map(item => item.table), [0, 1]);
  assert.deepEqual(games[0].waves[1].tables.map(item => item.table), [2]);
  assert.equal(games[0].waves[1].tables[0].result.players[0], 'C');
  assert.equal(games[1].waves[0].tables[0].result.players[0], 'D');
  assert.equal(data.tables[0].game, 1);
});
