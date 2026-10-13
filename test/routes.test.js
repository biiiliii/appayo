import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tournamentRoute, tournamentPaths, legacyTournamentPath, normalizedTournamentId, canonicalTournamentRoute,
} from '../frontend/routes.js';

test('els camins nets identifiquen les pantalles del torneig', () => {
  assert.deepEqual(tournamentRoute('/tournaments'), { mode: 'list' });
  assert.deepEqual(tournamentRoute('/tournaments/new'), { mode: 'new' });
  assert.deepEqual(tournamentRoute('/tournaments/BCDFG/configure'), { mode: 'configure', value: 'BCDFG' });
  assert.deepEqual(tournamentRoute('/tournaments/abc123'), { mode: 'admin', value: 'abc123' });
  assert.deepEqual(tournamentRoute('/tournaments/abc123/results'), { mode: 'results', value: 'abc123' });
  assert.deepEqual(tournamentRoute('/tournaments/abc123/table'), { mode: 'results_table', value: 'abc123' });
  assert.deepEqual(tournamentRoute('/tournaments/spectate/abc123'), { mode: 'view', value: 'abc123' });
  assert.deepEqual(tournamentRoute('/tournaments/spectate/abc123/table'), { mode: 'public_table', value: 'abc123' });
  assert.deepEqual(tournamentRoute('/tournaments/table/token_1'), { mode: 'table', value: 'token_1' });
  assert.equal(tournamentRoute('/tournaments/table/a/b').mode, 'missing');
});

test('els enllaços antics del torneig es converteixen al camí nou', () => {
  assert.equal(legacyTournamentPath('#admin=abc123'), tournamentPaths.admin('abc123'));
  assert.equal(legacyTournamentPath('#view=abc123'), tournamentPaths.spectate('abc123'));
  assert.equal(legacyTournamentPath('#table=token_1'), tournamentPaths.table('token_1'));
  assert.equal(legacyTournamentPath('#t=antic'), null);
});

test('els codis de torneig en minúscules passen a majúscules', () => {
  assert.equal(normalizedTournamentId(' bcdfg '), 'BCDFG');
  assert.equal(normalizedTournamentId('BcDfGh'), 'BCDFGH');
  assert.equal(normalizedTournamentId('abc123'), 'abc123');
  assert.equal(normalizedTournamentId('bcdf'), 'bcdf');
});

test('les adreces amb el codi en minúscules es canvien pel camí canònic', () => {
  assert.deepEqual(canonicalTournamentRoute(tournamentRoute('/tournaments/bcdfg')),
    { mode: 'admin', value: 'BCDFG', path: '/tournaments/BCDFG' });
  assert.equal(canonicalTournamentRoute(tournamentRoute('/tournaments/bcdfg/configure')).path, '/tournaments/BCDFG/configure');
  assert.equal(canonicalTournamentRoute(tournamentRoute('/tournaments/bcdfg/results')).path, '/tournaments/BCDFG/results');
  assert.equal(canonicalTournamentRoute(tournamentRoute('/tournaments/bcdfg/table')).path, '/tournaments/BCDFG/table');
  assert.equal(canonicalTournamentRoute(tournamentRoute('/tournaments/spectate/bcdfg')).path, '/tournaments/spectate/BCDFG');
  assert.equal(canonicalTournamentRoute(tournamentRoute('/tournaments/spectate/bcdfg/table')).path,
    '/tournaments/spectate/BCDFG/table');
  assert.equal(canonicalTournamentRoute(tournamentRoute('/tournaments/BCDFG')).path, null);
  assert.equal(canonicalTournamentRoute(tournamentRoute('/tournaments')).path, null);
});

test('els tokens de taula conserven majúscules i minúscules', () => {
  const route = canonicalTournamentRoute(tournamentRoute('/tournaments/table/bcdfgh'));
  assert.deepEqual(route, { mode: 'table', value: 'bcdfgh', path: null });
});
