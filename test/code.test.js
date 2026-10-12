import test from 'node:test';
import assert from 'node:assert/strict';
import { CODE_LETTERS, tournamentCode, reserveTournamentCode } from '../backend/code.js';

test('els codis de torneig només fan servir les consonants de matrícula', () => {
  assert.match(tournamentCode(5), /^[BCDFGHJKLMNPRSTVWXYZ]{5}$/);
  assert.equal(CODE_LETTERS.includes('Q'), false);
  assert.equal(CODE_LETTERS.includes('Ñ'), false);
  assert.equal(/[AEIOU]/.test(CODE_LETTERS), false);
});

test('després de cinc col·lisions es prova un codi de sis lletres', async () => {
  const lengths = [];
  const code = await reserveTournamentCode(async candidate => {
    lengths.push(candidate.length);
    return candidate.length === 6;
  }, length => 'B'.repeat(length));
  assert.equal(code, 'BBBBBB');
  assert.deepEqual(lengths, [5, 5, 5, 5, 5, 6]);
});
