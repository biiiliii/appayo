import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOTAL, PAPAYOO_POINTS, resolveRound, clampPoints, maxPointsFor,
  totals, standings, createGame, validateSetup,
} from '../logic.js';

test('constants', () => {
  assert.equal(TOTAL, 250);
  assert.equal(PAPAYOO_POINTS, 40);
});

test('round with one missing player gets the remainder automatically', () => {
  const r = resolveRound({ papayoo: 0, points: [100, 50, null, 20] });
  assert.equal(r.valid, true);
  assert.equal(r.auto, 2);
  assert.deepEqual(r.points, [100, 50, 80, 20]);
  assert.deepEqual(r.errors, []);
});

test('round is incomplete while two or more players are missing', () => {
  const r = resolveRound({ papayoo: 0, points: [100, null, null, 20] });
  assert.equal(r.valid, false);
  assert.equal(r.auto, null);
  assert.equal(r.remaining, 130);
  assert.deepEqual(r.errors, []);
});

test('papayoo must be assigned', () => {
  const r = resolveRound({ papayoo: null, points: [100, 50, 80, 20] });
  assert.equal(r.valid, false);
  assert.ok(r.errors.includes('papayoo-missing'));
});

test('papayoo holder must have at least 40 points', () => {
  const r = resolveRound({ papayoo: 3, points: [100, 50, 80, 20] });
  assert.equal(r.valid, false);
  assert.ok(r.errors.includes('papayoo-too-low'));
});

test('auto-assigned papayoo holder below 40 is an error', () => {
  const r = resolveRound({ papayoo: 2, points: [120, 100, null, 20] });
  assert.equal(r.valid, false);
  assert.equal(r.points[2], 10);
  assert.ok(r.errors.includes('papayoo-too-low'));
});

test('sum above 250 gives a negative remainder error', () => {
  const r = resolveRound({ papayoo: 0, points: [200, 50, null, 20] });
  assert.equal(r.valid, false);
  assert.ok(r.errors.includes('over-total'));
});

test('all entered must sum to 250', () => {
  const bad = resolveRound({ papayoo: 0, points: [100, 50, 80, 10] });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.includes('sum-mismatch'));
  const good = resolveRound({ papayoo: 0, points: [100, 50, 80, 20] });
  assert.equal(good.valid, true);
  assert.equal(good.auto, null);
});

test('negative points are rejected', () => {
  const r = resolveRound({ papayoo: 0, points: [100, -5, null, 20] });
  assert.equal(r.valid, false);
  assert.ok(r.errors.includes('negative'));
});

test('clampPoints never returns negatives and respects the maximum', () => {
  assert.equal(clampPoints(-3, false), 0);
  assert.equal(clampPoints(300, false), 210);
  assert.equal(clampPoints(300, true), 250);
  assert.equal(clampPoints(10, true), 40);
  assert.equal(clampPoints('abc', false), 0);
  assert.equal(clampPoints(12.7, false), 12);
});

test('maxPointsFor', () => {
  assert.equal(maxPointsFor(true), 250);
  assert.equal(maxPointsFor(false), 210);
});

test('totals and standings (lowest wins)', () => {
  const rounds = [
    { papayoo: 0, points: [100, 50, 80, 20] },
    { papayoo: 1, points: [10, 140, 50, 50] },
  ];
  assert.deepEqual(totals(rounds, 4), [110, 190, 130, 70]);
  const s = standings(['A', 'B', 'C', 'D'], rounds);
  assert.deepEqual(s.map(x => x.name), ['D', 'A', 'C', 'B']);
  assert.deepEqual(s.map(x => x.rank), [1, 2, 3, 4]);
});

test('standings share rank on ties', () => {
  const s = standings(['A', 'B', 'C'], [{ papayoo: 0, points: [100, 100, 50] }]);
  assert.deepEqual(s.map(x => [x.name, x.rank]), [['C', 1], ['A', 2], ['B', 2]]);
});

test('validateSetup requires 3..8 non-empty distinct names', () => {
  assert.deepEqual(validateSetup(['A', 'B']), ['too-few']);
  assert.deepEqual(validateSetup(['A', 'B', '']), ['empty-name']);
  assert.deepEqual(validateSetup(['A', 'B', 'A']), ['duplicate-name']);
  assert.deepEqual(validateSetup(['A', 'B', 'C']), []);
  assert.deepEqual(validateSetup('ABCDEFGHI'.split('')), ['too-many']);
});

test('createGame', () => {
  const g = createGame(['A', 'B', 'C'], 5);
  assert.deepEqual(g.players, ['A', 'B', 'C']);
  assert.equal(g.roundsPlanned, 5);
  assert.deepEqual(g.rounds, []);
});
