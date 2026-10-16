/** Taules jugades, agrupades per partida i torn en l'ordre del sorteig. */
export function encountersByTurn(data) {
  return data.schedule.map((_, game) => {
    const tables = data.tables.filter(table => table.game === game)
      .sort((a, b) => a.wave - b.wave || a.table - b.table);
    const waves = [...new Set(tables.map(table => table.wave))].map(wave => ({
      wave,
      tables: tables.filter(table => table.wave === wave).map(table => ({
        ...table,
        result: data.results?.[`${game}-${table.table}`] ?? null,
      })),
    }));
    return { game, waves };
  });
}
