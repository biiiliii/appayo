// Progrés del torneig segons la taula menys avançada del torn en curs.
export function tournamentProgress(data) {
  const waves = data.schedule.map(game => Math.ceil(game.length / data.simultaneousTables));
  const total = waves.reduce((sum, count) => sum + count, 0) * data.rounds;
  const hasMultipleWaves = waves.some(count => count > 1);
  if (!data.currentWave) return {
    game: waves.length, wave: waves.at(-1), waves: waves.at(-1), round: data.rounds,
    completed: total, total, hasMultipleWaves,
  };

  const { game, wave } = data.currentWave;
  const roundsPlayed = Math.min(...data.tables
    .filter(table => table.game === game && table.wave === wave)
    .map(table => table.rounds));
  const previousWaves = waves.slice(0, game).reduce((sum, count) => sum + count, 0);
  return {
    game: game + 1, wave: wave + 1, waves: waves[game],
    round: Math.min(roundsPlayed + 1, data.rounds),
    completed: (previousWaves + wave) * data.rounds + roundsPlayed,
    total, hasMultipleWaves,
  };
}

/** El torn actual i, si ja hi ha una taula acabada, el torn següent. */
export function visibleTournamentWaves(data) {
  if (!data.currentWave) return [];
  const { game, wave } = data.currentWave;
  const visible = [{ game, wave }];
  const currentTables = data.tables.filter(table => table.game === game && table.wave === wave);
  if (!currentTables.some(table => table.finished)) return visible;

  const wavesInGame = Math.ceil(data.schedule[game].length / data.simultaneousTables);
  if (wave + 1 < wavesInGame) visible.push({ game, wave: wave + 1 });
  else if (game + 1 < data.schedule.length) visible.push({ game: game + 1, wave: 0 });
  return visible;
}
