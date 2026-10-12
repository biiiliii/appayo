// Camins públics del torneig. Els identificadors no es posen a la query ni al fragment.
const safe = /^[A-Za-z0-9_-]+$/;

export const tournamentPaths = {
  list: '/tournaments',
  new: '/tournaments/new',
  configure: id => `/tournaments/${id}/configure`,
  admin: id => `/tournaments/${id}`,
  results: id => `/tournaments/${id}/results`,
  resultsTable: id => `/tournaments/${id}/table`,
  spectate: id => `/tournaments/spectate/${id}`,
  spectateTable: id => `/tournaments/spectate/${id}/table`,
  table: token => `/tournaments/table/${token}`,
};

export function tournamentRoute(pathname) {
  const path = pathname.replace(/\/$/, '') || '/';
  if (path === '/tournaments' || path === '/tournament.html') return { mode: 'list' };
  if (path === '/tournaments/new') return { mode: 'new' };
  const configure = path.match(/^\/tournaments\/([^/]+)\/configure$/);
  if (configure && safe.test(configure[1])) return { mode: 'configure', value: configure[1] };
  const publicTable = path.match(/^\/tournaments\/spectate\/([^/]+)\/table$/);
  if (publicTable && safe.test(publicTable[1])) return { mode: 'public_table', value: publicTable[1] };
  const results = path.match(/^\/tournaments\/([^/]+)\/(results|table)$/);
  if (results && safe.test(results[1])) return { mode: results[2] === 'results' ? 'results' : 'results_table', value: results[1] };
  const match = path.match(/^\/tournaments\/(spectate|table)\/([^/]+)$/);
  if (match && safe.test(match[2])) return { mode: match[1] === 'spectate' ? 'view' : 'table', value: match[2] };
  const admin = path.match(/^\/tournaments\/([^/]+)$/);
  if (admin && safe.test(admin[1])) return { mode: 'admin', value: admin[1] };
  return { mode: 'missing' };
}

export function legacyTournamentPath(hash) {
  const match = hash.match(/^#(admin|view|table)=([A-Za-z0-9_-]+)$/);
  if (!match) return null;
  return match[1] === 'admin' ? tournamentPaths.admin(match[2])
    : match[1] === 'view' ? tournamentPaths.spectate(match[2])
      : tournamentPaths.table(match[2]);
}
