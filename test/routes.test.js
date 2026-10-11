import test from 'node:test';
import assert from 'node:assert/strict';
import { tournamentRoute, tournamentPaths, legacyTournamentPath } from '../frontend/routes.js';

test('els camins nets identifiquen les pantalles del torneig', () => {
  assert.deepEqual(tournamentRoute('/tournaments'), { mode: 'list' });
  assert.deepEqual(tournamentRoute('/tournaments/new'), { mode: 'new' });
  assert.deepEqual(tournamentRoute('/tournaments/abc123'), { mode: 'admin', value: 'abc123' });
  assert.deepEqual(tournamentRoute('/tournaments/spectate/abc123'), { mode: 'view', value: 'abc123' });
  assert.deepEqual(tournamentRoute('/tournaments/table/token_1'), { mode: 'table', value: 'token_1' });
  assert.equal(tournamentRoute('/tournaments/table/a/b').mode, 'missing');
});

test('els enllaços antics del torneig es converteixen al camí nou', () => {
  assert.equal(legacyTournamentPath('#admin=abc123'), tournamentPaths.admin('abc123'));
  assert.equal(legacyTournamentPath('#view=abc123'), tournamentPaths.spectate('abc123'));
  assert.equal(legacyTournamentPath('#table=token_1'), tournamentPaths.table('token_1'));
  assert.equal(legacyTournamentPath('#t=antic'), null);
});
