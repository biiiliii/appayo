// Pantalles del torneig. Les dades del sorteig i dels resultats les decideix el servidor.
import { resolveRound } from './logic.js';
import { brand, navigation } from './brand.js';
import { tournamentPaths, tournamentRoute, legacyTournamentPath } from './routes.js';

const root = document.getElementById('app');
const sessionsKey = 'appayo:tournament-sessions';
const localKey = token => `appayo:table:${token}`;
const join = names => names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} i ${names.at(-1)}`;
const label = (g, t) => `Partida ${g + 1}, taula ${t + 1}`;
const fmt = n => String(Math.round(n * 10) / 10).replace('.', ',');
const parseNames = text => String(text).split(/[\n,;]/)
  .map(line => line.replace(/^\s*(?:\d+\s*[.)-]\s*|[-*•·]\s*)/, '').trim().replace(/\s+/g, ' '))
  .filter(Boolean);
function stored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
const sessions = stored(sessionsKey, {});
const state = { data: null, mode: null, id: null, token: null, error: '', message: '', editing: null, draft: null };

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name.startsWith('on')) el.addEventListener(name.slice(2), value);
    else if (name === 'class') el.className = value;
    else if (name === 'value') el.value = value;
    else if (name === 'checked') el.checked = value;
    else el.setAttribute(name, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined) el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return el;
}

function section(title, ...children) { return h('section', { class: 'section' }, h('h2', { class: 'section-title' }, title), ...children); }
function header() { return h('div', {}, h('header', { class: 'masthead' }, h('h1', { class: 'wordmark' }, h('a', { href: '/', 'aria-label': 'APPayo · Inici' }, brand()))), navigation('tournament')); }
function notice() { return state.error ? h('p', { class: 'tour-error', role: 'alert' }, state.error) : state.message ? h('p', { class: 'tour-ok', role: 'status' }, state.message) : null; }
function setMessage(message = '', error = '') { state.message = message; state.error = error; render(); }

async function api(path, options = {}) {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'No s’ha pogut contactar amb el servidor.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function saveSession(id, token, name) {
  sessions[id] = { token, name };
  localStorage.setItem(sessionsKey, JSON.stringify(sessions));
}

async function open(mode, value) {
  state.mode = mode;
  state.id = mode === 'table' ? null : value;
  state.token = mode === 'table' ? value : null;
  state.data = null;
  state.error = '';
  state.message = '';
  render();
  await refresh();
}

async function refresh() {
  const routeKey = `${state.mode}:${state.id ?? state.token}`;
  const sameRoute = () => routeKey === `${state.mode}:${state.id ?? state.token}`;
  try {
    if (state.mode === 'admin') {
      const session = sessions[state.id];
      if (!session) { state.mode = 'login'; render(); return; }
      const data = await api(`/tournaments/${state.id}`, { headers: { Authorization: `Bearer ${session.token}` } });
      if (!sameRoute()) return;
      if (!state.error && state.data && JSON.stringify(data) === JSON.stringify(state.data)) return;
      state.data = data;
    } else if (state.mode === 'view') {
      const data = await api(`/tournaments/${state.id}/status`);
      if (!sameRoute()) return;
      if (!state.error && state.data && JSON.stringify(data) === JSON.stringify(state.data)) return;
      state.data = data;
    } else if (state.mode === 'table') {
      const remote = await api(`/tables/${state.token}`);
      if (!sameRoute()) return;
      const local = stored(localKey(state.token), null);
      state.data = { ...remote, rounds: local?.dirty ? local.rounds : remote.rounds };
      localStorage.setItem(localKey(state.token), JSON.stringify({
        ...local, table: remote, rounds: state.data.rounds,
        dirty: Boolean(local?.dirty), version: local?.version ?? 0,
      }));
      state.error = '';
      if (local?.dirty) await syncRounds();
    }
    if (state.mode !== 'table') state.error = '';
  } catch (err) {
    if (!sameRoute()) return;
    if (state.mode === 'admin' && err.status === 401) {
      delete sessions[state.id];
      localStorage.setItem(sessionsKey, JSON.stringify(sessions));
      state.mode = 'login';
      state.error = '';
      render();
      return;
    }
    if (state.mode === 'table') {
      const local = stored(localKey(state.token), null);
      if (local?.table) state.data = { ...local.table, rounds: local.rounds };
    }
    state.error = state.mode === 'table' && state.data
      ? 'Sense connexió. Pots continuar apuntant rondes; s’enviaran quan torni la connexió.' : err.message;
  }
  if (!sameRoute()) return;
  render();
}

const syncTasks = new Map();
function syncRounds() {
  const tableToken = state.token;
  if (!tableToken) return Promise.resolve();
  if (syncTasks.has(tableToken)) return syncTasks.get(tableToken);
  const task = (async () => {
    for (;;) {
      const local = stored(localKey(tableToken), null);
      if (!local?.dirty) return;
      try {
        await api(`/tables/${tableToken}/rounds`, { method: 'PUT', body: JSON.stringify({ rounds: local.rounds }) });
        const latest = stored(localKey(tableToken), null);
        if (latest?.version !== local.version) continue;
        localStorage.setItem(localKey(tableToken), JSON.stringify({ ...local, dirty: false }));
        if (state.token === tableToken) { state.message = 'Rondes desades al servidor.'; state.error = ''; }
      } catch (err) {
        if (state.token === tableToken) {
          state.message = '';
          state.error = err.status ? err.message : 'Sense connexió. Les rondes són en aquest mòbil i es tornaran a enviar.';
        }
        return;
      }
    }
  })();
  syncTasks.set(tableToken, task);
  task.finally(() => syncTasks.delete(tableToken));
  return task;
}

function createForm() {
  const form = h('form', { class: 'tour-form', onsubmit: async event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    try {
      const data = await api('/tournaments', { method: 'POST', body: JSON.stringify({
        name: String(values.get('name')).trim(),
        players: parseNames(values.get('players')),
        games: Number(values.get('games')), rounds: Number(values.get('rounds')),
        password: String(values.get('password')),
      }) });
      saveSession(data.id, data.token, String(values.get('name')) || 'Torneig de Papayoo');
      location.assign(tournamentPaths.admin(data.id));
    } catch (err) { setMessage('', err.message); }
  } },
  h('label', {}, 'Nom del torneig', h('input', { name: 'name', maxlength: '60', required: true, placeholder: 'Torneig de Papayoo' })),
  h('label', {}, 'Jugadors, un per línia', h('textarea', { name: 'players', required: true, placeholder: 'Núria Puig\nJoan Roca\nMercè Vila' })),
  h('div', { class: 'tour-row' },
    h('label', {}, 'Partides', h('select', { name: 'games' }, [1, 2, 3, 4, 5].map(n => h('option', { value: String(n), ...(n === 3 ? { selected: true } : {}) }, String(n))))),
    h('label', {}, 'Rondes per partida', h('select', { name: 'rounds' }, [3, 4, 5, 6, 8, 10].map(n => h('option', { value: String(n), ...(n === 5 ? { selected: true } : {}) }, String(n))))),
  ),
  h('label', {}, 'Contrasenya de l’organitzador (mínim 12 caràcters)', h('input', { name: 'password', type: 'password', minlength: '12', required: true, autocomplete: 'new-password' })),
  h('button', { class: 'btn block', type: 'submit' }, 'Crea el torneig'));
  return form;
}

function landing() {
  const known = Object.entries(sessions);
  return h('div', {}, header(), section('Organitza un torneig',
    h('p', { class: 'lede' }, 'El sorteig i els resultats es guarden al servidor. Tria una contrasenya per gestionar-lo.'),
    h('a', { class: 'btn block', href: tournamentPaths.new }, 'Crea un torneig')),
    section('Torna a un torneig',
      ...known.map(([id, item]) => h('p', {}, h('a', { href: tournamentPaths.admin(id) }, item.name || id))),
      h('form', { class: 'tour-form', onsubmit: event => { event.preventDefault(); location.assign(tournamentPaths.admin(event.currentTarget.elements.id.value.trim())); } },
        h('label', {}, 'Identificador del torneig', h('input', { name: 'id', required: true })),
        h('button', { class: 'btn outline', type: 'submit' }, 'Obre el torneig'))));
}

function newTournament() {
  return h('div', {}, header(), section('Organitza un torneig',
    h('p', { class: 'lede' }, 'El sorteig i els resultats es guarden al servidor. Tria una contrasenya per gestionar-lo.'),
    notice(), createForm()));
}

function login() {
  return h('div', {}, header(), section('Entra com a organitzador',
    h('p', {}, `Torneig ${state.id}`), notice(),
    h('form', { class: 'tour-form', onsubmit: async event => {
      event.preventDefault();
      try {
        const data = await api(`/tournaments/${state.id}/login`, { method: 'POST', body: JSON.stringify({ password: event.currentTarget.elements.password.value }) });
        saveSession(state.id, data.token, state.id);
        await open('admin', state.id);
      } catch (err) { setMessage('', err.message); }
    } }, h('label', {}, 'Contrasenya', h('input', { name: 'password', type: 'password', required: true })),
    h('button', { class: 'btn block', type: 'submit' }, 'Entra'))));
}

async function share(url, title) {
  try {
    if (navigator.share) await navigator.share({ title, url });
    else { await navigator.clipboard.writeText(url); setMessage('Enllaç copiat.'); }
  } catch { /* L’usuari ha tancat el menú de compartir. */ }
}

function standings(data) {
  if (!data.revealed) return null;
  const podium = section('Podi',
    h('div', { class: 'tour-podium' }, (data.podium ?? []).map(p => h('div', { class: `tour-place place-${p.rank}` },
      h('span', {}, `${p.rank}.`), h('strong', {}, p.name), h('small', {}, `${fmt(p.total)} punts`)))));
  if (!data.standings) return podium;
  return h('div', {}, podium, section('Classificació',
    h('div', { class: 'tour-results' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Posició'), h('th', {}, 'Jugador'), h('th', {}, 'Punts'))),
      h('tbody', {}, data.standings.map(p => h('tr', {},
        h('td', {}, p.rank ? `${p.rank}.` : '—'), h('td', {}, p.name), h('td', {}, p.played ? fmt(p.total) : '—')))))),
    data.awards?.length ? h('div', {}, h('h3', {}, 'Diplomes'), ...data.awards.map(a => h('p', {}, `${a.title}: ${join(a.names)}`))) : null));
}

function status(data, admin) {
  return h('div', {}, header(),
    h('section', { class: 'winner' }, h('p', { class: 'lead' }, 'Torneig'), h('p', { class: 'name' }, data.name || 'Torneig de Papayoo'),
      h('p', { class: 'sub' }, `${data.progress.received} de ${data.progress.total} taules han acabat.`)),
    notice(),
    admin ? section('Pantalla per projectar', h('p', { class: 'note' }, 'Mostra el progrés sense els resultats fins que els revelis.'),
      h('p', { class: 'note' }, `Identificador: ${data.id}. Amb aquest identificador i la contrasenya pots entrar des d’un altre dispositiu.`),
      h('button', { class: 'btn outline', onclick: () => share(`${location.origin}${tournamentPaths.spectate(data.id)}`, data.name) }, 'Comparteix la pantalla pública'),
      h('div', { class: 'actions' }, data.revealStep < 4 ? h('button', {
        class: 'btn', ...(data.progress.received < data.progress.total ? { disabled: true } : {}), onclick: async () => {
        try {
          await api(`/tournaments/${data.id}/reveal`, { method: 'PUT', headers: { Authorization: `Bearer ${sessions[data.id].token}` }, body: JSON.stringify({ step: data.revealStep + 1 }) });
          await refresh();
        } catch (err) { setMessage('', err.message); }
      } }, ['','Mostra el tercer lloc','Mostra el segon lloc','Mostra el primer lloc','Mostra la classificació'][data.revealStep + 1]) : null,
      data.revealed ? h('button', { class: 'btn outline', onclick: async () => {
        try {
          await api(`/tournaments/${data.id}/reveal`, { method: 'PUT', headers: { Authorization: `Bearer ${sessions[data.id].token}` }, body: JSON.stringify({ step: 0 }) });
          await refresh();
        } catch (err) { setMessage('', err.message); }
      } }, 'Amaga els resultats') : null)) : null,
    ...data.schedule.map((game, gi) => section(`Partida ${gi + 1}`,
      h('p', { class: 'note' }, `${data.tables.filter(t => t.game === gi && t.finished).length} de ${game.length} taules acabades.`),
      ...game.map((seats, ti) => {
        const current = data.tables.find(t => t.game === gi && t.table === ti);
        const url = admin ? `${location.origin}${tournamentPaths.table(data.links[gi][ti])}` : null;
        return h('div', { class: 'tour-card' },
          h('div', { class: 'tour-row' }, h('strong', {}, `Taula ${ti + 1}`),
            h('span', { class: current?.finished ? 'tour-ok' : '' }, current?.finished ? 'Acabada' : `${current?.rounds ?? 0} de ${data.rounds} rondes`)),
          admin ? h('p', {}, join(seats.map(i => data.players[i]))) : null,
          admin ? h('button', { class: 'btn outline small', onclick: () => share(url, label(gi, ti)) }, 'Envia a la taula') : null,
        );
      }))),
    standings(data));
}

function emptyDraft(size) { return { papayoo: null, points: Array(size).fill(null) }; }

function table() {
  const t = state.data;
  const count = t.rounds.length;
  const done = count >= t.roundsPlanned;
  if (!state.draft || state.draft.points.length !== t.players.length) state.draft = emptyDraft(t.players.length);
  const draft = state.draft;
  const resolved = resolveRound(draft);
  const form = h('form', { class: 'tour-form', onsubmit: async event => {
    event.preventDefault();
    const checked = resolveRound(state.draft);
    if (!checked.valid || !state.draft.points.every(p => p === null || (Number.isInteger(p) && p >= 0 && p <= 250))) {
      setMessage('', checked.errors.includes('papayoo-points')
        ? 'Qui s’ha endut el Papayoo ha de tenir almenys 40 punts.'
        : 'Revisa els punts: la suma ha de ser 250 i cal marcar el Papayoo.'); return;
    }
    const row = { papayoo: checked.papayoo, points: checked.points };
    const rounds = t.rounds.slice();
    if (state.editing === null) rounds.push(row); else rounds[state.editing] = row;
    t.rounds = rounds;
    const old = stored(localKey(state.token), null);
    localStorage.setItem(localKey(state.token), JSON.stringify({
      ...old, table: old?.table ?? { ...t, rounds: [] }, rounds,
      dirty: true, version: (old?.version ?? 0) + 1,
    }));
    state.editing = null; state.draft = emptyDraft(t.players.length);
    state.message = 'Ronda guardada en aquest mòbil.'; state.error = '';
    render(); await syncRounds(); render();
  } },
    h('label', {}, 'Qui s’ha endut el Papayoo?', h('select', { id: 'table-papayoo', onchange: e => { draft.papayoo = e.target.value === '' ? null : Number(e.target.value); } },
      h('option', { value: '' }, 'Tria un jugador'),
      t.players.map((p, i) => h('option', { value: String(i), ...(resolved.papayoo === i ? { selected: true } : {}) }, p)))),
    h('div', { class: 'points-grid' }, t.players.flatMap((p, i) => [h('label', { for: `points-${i}` }, p),
      h('input', { id: `points-${i}`, type: 'number', inputmode: 'numeric', min: '0', max: '250', value: draft.points[i] ?? '',
        oninput: e => {
          draft.points[i] = e.target.value === '' ? null : Number(e.target.value);
          document.getElementById('table-papayoo').value = String(resolveRound(draft).papayoo ?? '');
        } })])),
    h('p', { class: 'note' }, `Total: ${resolved.points.reduce((sum, p) => sum + (p ?? 0), 0)} de 250.`),
    h('button', { class: 'btn block', type: 'submit' }, state.editing === null ? 'Desa la ronda' : 'Desa la correcció'));
  return h('div', {}, header(),
    h('section', { class: 'winner' }, h('p', { class: 'lead' }, t.tournamentName || 'Torneig de Papayoo'),
      h('p', { class: 'name' }, label(t.game, t.table)), h('p', { class: 'sub' }, `${count} de ${t.roundsPlanned} rondes desades.`)),
    notice(), section('Jugadors', h('p', {}, join(t.players))),
    count ? section('Rondes desades', h('ul', { class: 'tour-score' }, t.rounds.map((r, i) => h('li', {},
      h('span', {}, `Ronda ${i + 1}: ${r.points.join(' · ')}`),
      h('button', { class: 'btn quiet small', onclick: () => { state.editing = i; state.draft = { papayoo: r.papayoo, points: r.points.slice() }; render(); } }, 'Corregeix'))))) : null,
    (!done || state.editing !== null) ? section(state.editing === null ? `Ronda ${count + 1}` : `Corregeix la ronda ${state.editing + 1}`, form) : null,
    done ? section('Partida acabada', h('p', {}, 'El resultat ja s’ha enviat. La classificació del torneig sortirà quan l’organitzador la mostri.'),
      h('a', { class: 'btn outline', href: tournamentPaths.spectate(t.tournamentId) }, 'Segueix el torneig')) : null);
}

function render() {
  const titles = {
    list: 'Tornejos',
    new: 'Crea un torneig',
    admin: 'Gestiona el torneig',
    login: 'Accés al torneig',
    view: 'Segueix el torneig',
    table: 'Taula del torneig',
    missing: 'Pàgina no trobada',
  };
  document.title = `${titles[state.mode] ?? 'Tornejos'} | APPayoo`;
  let content;
  if (state.mode === 'list') content = landing();
  else if (state.mode === 'new') content = newTournament();
  else if (state.mode === 'missing') content = h('div', {}, header(), section('Pàgina no trobada', h('a', { href: tournamentPaths.list }, 'Torna als tornejos')));
  else if (state.mode === 'login') content = login();
  else if (!state.data) content = h('div', {}, header(), section('Carregant', notice(), h('p', {}, 'Carregant el torneig…')));
  else if (state.mode === 'table') content = table();
  else content = status(state.data, state.mode === 'admin');
  root.replaceChildren(content);
}

function route() {
  const legacy = legacyTournamentPath(location.hash);
  if (legacy) history.replaceState(null, '', legacy);
  const target = tournamentRoute(location.pathname);
  if (['admin', 'view', 'table'].includes(target.mode)) open(target.mode, target.value);
  else { state.mode = target.mode; state.data = null; render(); }
}

window.addEventListener('hashchange', route);
window.addEventListener('popstate', route);
window.addEventListener('online', () => { if (state.mode === 'table') syncRounds().then(render); else if (['admin', 'view'].includes(state.mode)) refresh(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && ['admin', 'view', 'table'].includes(state.mode)) refresh(); });
setInterval(() => { if (!document.hidden && state.mode === 'table') syncRounds(); }, 5000);
setInterval(() => { if (!document.hidden && state.mode === 'admin') refresh(); }, 5000);
setInterval(() => { if (!document.hidden && state.mode === 'view') refresh(); }, 15000);
route();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
