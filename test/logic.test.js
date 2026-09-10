import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOTAL, PAPAYOO_POINTS, resolveRound, clampPoints,
  totals, standings, createGame, validateSetup, normalizeNames,
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

test('papayoo is only an indicator: any points are fine for the holder', () => {
  const r = resolveRound({ papayoo: 3, points: [100, 50, 80, 20] });
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
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

test('clampPoints never returns negatives and caps at 250', () => {
  assert.equal(clampPoints(-3), 0);
  assert.equal(clampPoints(300), 250);
  assert.equal(clampPoints('abc'), 0);
  assert.equal(clampPoints(12.7), 12);
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

test('validateSetup requires 3..8 distinct names; empty names are allowed', () => {
  assert.deepEqual(validateSetup(['A', 'B']), ['too-few']);
  assert.deepEqual(validateSetup(['A', 'B', '']), []);
  assert.deepEqual(validateSetup(['A', 'B', 'A']), ['duplicate-name']);
  assert.deepEqual(validateSetup(['Jugador 3', 'B', '']), ['duplicate-name']);
  assert.deepEqual(validateSetup(['A', 'B', 'C']), []);
  assert.deepEqual(validateSetup('ABCDEFGHI'.split('')), ['too-many']);
});

test('normalizeNames fills empty names with Jugador N', () => {
  assert.deepEqual(normalizeNames([' Anna ', '', '  ']), ['Anna', 'Jugador 2', 'Jugador 3']);
});

test('createGame', () => {
  const g = createGame(['A', '', 'C'], 5);
  assert.deepEqual(g.players, ['A', 'Jugador 2', 'C']);
  assert.equal(g.roundsPlanned, 5);
  assert.deepEqual(g.rounds, []);
  assert.equal(createGame(['A', 'B', 'C', 'D'], 'players').roundsPlanned, 4);
  assert.equal(createGame(['A', 'B', 'C'], null).roundsPlanned, null);
});
