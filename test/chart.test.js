import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cumulative, seriesColor } from '../frontend/chart.js';

test('cumulative starts at 0 and accumulates each round per player', () => {
  const rounds = [
    { papayoo: 0, points: [100, 50, 100] },
    { papayoo: 1, points: [10, 140, 100] },
  ];
  assert.deepEqual(cumulative(['A', 'B', 'C'], rounds), [[0, 100, 110], [0, 50, 190], [0, 100, 200]]);
});

test('series colors are assigned in a fixed order by player index', () => {
  assert.equal(seriesColor(0), '#2a78d6');
  assert.equal(seriesColor(7), '#e34948');
  assert.equal(seriesColor(8), seriesColor(0));
});
