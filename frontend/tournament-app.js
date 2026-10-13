// Pantalles del torneig. Les dades del sorteig i dels resultats les decideix el servidor.
import { TOTAL, PAPAYOO_POINTS, clampPoints, resolveRound } from './logic.js';
import { brand, navigation } from './brand.js';
import { tournamentPaths, tournamentRoute, legacyTournamentPath, normalizedTournamentId, canonicalTournamentRoute } from './routes.js';
import { tournamentProgress, visibleTournamentWaves, suggestedTableCount } from './tournament-progress.js';

const root = document.getElementById('app');
const sessionsKey = 'appayo:tournament-sessions';
const draftKey = id => `appayo:tournament-config:${id}`;
const localKey = token => `appayo:table:${token}`;
const closedScoresMessage = 'Les puntuacions estan tancades perquè ja han començat els resultats.';
const conflictMessage = 'Des d’un altre mòbil s’han desat rondes d’aquesta taula. Ara veus les del servidor: revisa-les.';
const offlineMessage = 'No hi ha connexió. Torna-ho a provar.';
const join = names => names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} i ${names.at(-1)}`;
const fmt = n => String(Math.round(n * 10) / 10).replace('.', ',');
const sameRounds = (a, b) => JSON.stringify((a ?? []).map(round => [round.papayoo, round.points]))
  === JSON.stringify((b ?? []).map(round => [round.papayoo, round.points]));
const parseNames = text => String(text).split(/[\n,;]/)
  .map(line => line.replace(/^\s*(?:\d+\s*[.)-]\s*|[-*•·]\s*)/, '').trim().replace(/\s+/g, ' '))
  .filter(Boolean);
function stored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function tournamentDraft(id) {
  try {
    const draft = JSON.parse(sessionStorage.getItem(draftKey(id)));
    return draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : null;
  } catch { return null; }
}
// Les sessions es tornen a llegir abans de cada canvi: una altra pestanya pot haver-hi afegit un torneig.
function readSessions() {
  const value = stored(sessionsKey, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
const session = id => readSessions()[id] ?? null;
function changeSession(id, change) {
  const all = readSessions();
  const next = change(all[id] ?? null);
  if (!next) return;
  all[id] = next;
  try { localStorage.setItem(sessionsKey, JSON.stringify(all)); } catch { /* Sense localStorage es tornarà a demanar la contrasenya. */ }
}
const organizerModes = ['admin', 'configure', 'results', 'results_table'];
const publicModes = ['view', 'public_table'];
const state = { data: null, mode: null, id: null, token: null, error: '', message: '', editing: null, draft: null,
  roundDrafts: {}, nameEditing: false, nameSaving: false };

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

function section(title, ...children) { return h('section', { class: 'section' }, title ? h('h2', { class: 'section-title' }, title) : null, ...children); }
const tournamentIntro = 'Els tornejos permeten encreuar jugadors en diverses partides i monitoritzar les puntuacions. Recomanem generar els tornejos en una pantalla d’ordinador.';
function header(backHref = null) { return h('div', {}, h('header', { class: `masthead${backHref ? ' with-action' : ''}` },
  h('h1', { class: 'wordmark' }, h('a', { href: '/', 'aria-label': 'APPayo · Inici' }, brand())),
  backHref ? h('a', { class: 'crumb', href: backHref }, '← Torna') : null), navigation('tournament')); }
function spectateHeader(data) {
  return h('div', {},
    h('header', { class: 'tour-spectate-header' },
      h('h1', { class: 'wordmark' }, h('a', { href: '/', 'aria-label': 'APPayo · Inici' }, brand())),
      h('a', { class: 'tour-spectate-back', href: '/' }, '← Tornar a l’inici')),
    data?.name ? h('h2', { class: 'tour-spectate-name' }, data.name) : null);
}
function pencilIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '19');
  svg.setAttribute('height', '19');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M15 5l4 4M4 20l4.5-1 11-11a2.12 2.12 0 0 0-3-3l-11 11L4 20Z');
  svg.append(path);
  return svg;
}
function tournamentHeader(data, showSteps = true) {
  const active = data.phase === 'configuring' ? 0 : data.phase === 'results_shown' ? 2 : 1;
  const title = h('h2', { class: 'tour-header-title' }, data.name);
  const edit = h('button', { class: 'tour-name-edit', type: 'button', 'aria-label': 'Edita el nom del torneig', title: 'Edita el nom del torneig' }, pencilIcon());
  const nameRow = h('div', { class: 'tour-title-row' }, title, edit);
  const nameError = h('p', { class: 'tour-name-error', role: 'alert' });
  nameError.hidden = true;
  edit.addEventListener('click', () => {
    if (state.nameSaving) return;
    state.nameEditing = true;
    nameError.hidden = true;
    let cancelled = false;
    const input = h('input', { class: 'tour-name-input', type: 'text', maxlength: '60', value: data.name,
      'aria-label': 'Nom del torneig', onkeydown: event => {
        if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
        if (event.key === 'Escape') { event.preventDefault(); cancelled = true; input.blur(); }
      }, onblur: async () => {
        state.nameEditing = false;
        const name = input.value.trim();
        if (cancelled || name === data.name) { nameRow.replaceChildren(title, edit); return; }
        if (!name) {
          nameError.textContent = 'El nom del torneig no pot quedar buit.';
          nameError.hidden = false;
          nameRow.replaceChildren(title, edit);
          return;
        }
        state.nameSaving = true;
        input.disabled = true;
        try {
          const result = await api(`/tournaments/${data.id}/name`, {
            method: 'PUT', headers: { Authorization: `Bearer ${session(data.id)?.token}` }, body: JSON.stringify({ name }),
          });
          data.name = result.name;
          title.textContent = result.name;
          if (state.id === data.id && state.data) state.data.name = result.name;
          updateSessionName(data.id, result.name);
          nameError.hidden = true;
        } catch (err) {
          if (err.status === 401 && state.id === data.id) {
            forgetExpiredToken(data.id);
            requestOrganizerPassword(data.id);
          } else {
            nameError.textContent = err.message;
            nameError.hidden = false;
          }
        } finally {
          state.nameSaving = false;
          nameRow.replaceChildren(title, edit);
        }
      } });
    nameRow.replaceChildren(input);
    input.focus();
    input.select();
  });
  return h('header', { class: 'tour-topbar' },
    h('h1', { class: 'wordmark' }, h('a', { href: '/', 'aria-label': 'APPayo · Inici' }, brand())),
    h('div', { class: 'tour-header-center' },
      nameRow, nameError,
      showSteps ? h('ol', { class: 'tour-steps', 'aria-label': 'Etapes del torneig' },
        ['Configuració', 'Partides', 'Resultats'].map((label, i) => h('li', {
          class: i === active ? 'current' : i < active ? 'done' : '',
          ...(i === active ? { 'aria-current': 'step' } : {}),
        }, label))) : null),
    h('div', { class: 'tour-code' }, h('span', {}, 'Codi del torneig:'), h('strong', {}, data.id)));
}
function notice() {
  return state.error ? h('p', { class: 'tour-error tour-notice', role: 'alert' }, state.error)
    : state.message ? h('p', { class: 'tour-ok tour-notice', role: 'status' }, state.message) : null;
}
function setMessage(message = '', error = '') { state.message = message; state.error = error; render(); }
let toastTimer = null;
function toast(message) {
  document.querySelector('.toast')?.remove();
  const element = h('p', { class: 'toast', role: 'status' }, message);
  document.body.append(element);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.remove(), 3000);
}

// Errors sempre en català: sense xarxa (err.offline) o amb l'estat i el cos de la resposta (err.status, err.body).
async function api(path, options = {}) {
  let response;
  let data = null;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
      cache: 'no-store',
      ...(typeof globalThis.AbortSignal?.timeout === 'function' ? { signal: AbortSignal.timeout(10_000) } : {}),
    });
    if (/[/+]json\b/i.test(response.headers.get('content-type') ?? '')) data = await response.json().catch(() => null);
  } catch {
    const error = new Error(offlineMessage);
    error.offline = true;
    throw error;
  }
  if (!response.ok || data === null) {
    const error = new Error(data?.error || `No s’ha pogut contactar amb el servidor (error ${response.status}).`);
    error.status = response.status;
    error.body = data;
    throw error;
  }
  return data;
}

function saveSession(id, token, name) { changeSession(id, () => ({ token, name, usedAt: Date.now() })); }
function updateSessionName(id, name) { changeSession(id, item => item && item.name !== name ? { ...item, name } : null); }
function forgetExpiredToken(id) { changeSession(id, item => item ? { ...item, token: null } : null); }

function requestOrganizerPassword(id) {
  const returnPath = location.pathname;
  history.replaceState(null, '', tournamentPaths.list);
  state.mode = 'list';
  state.id = null;
  state.data = null;
  state.error = '';
  render();
  manageTournamentDialog({ initialId: id, returnPath });
}

async function open(mode, value) {
  state.mode = mode;
  state.id = mode === 'table' ? null : value;
  state.token = mode === 'table' ? value : null;
  state.data = null;
  state.error = '';
  state.message = '';
  state.editing = null;
  state.draft = null;
  state.roundDrafts = {};
  state.nameEditing = false;
  state.nameSaving = false;
  render();
  await refresh();
}

async function refresh() {
  const routeKey = `${state.mode}:${state.id ?? state.token}`;
  const sameRoute = () => routeKey === `${state.mode}:${state.id ?? state.token}`;
  const previous = { data: state.data, error: state.error };
  try {
    if (organizerModes.includes(state.mode)) {
      if (state.nameEditing || state.nameSaving) return;
      const token = session(state.id)?.token;
      if (!token) { requestOrganizerPassword(state.id); return; }
      const data = await api(`/tournaments/${state.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!sameRoute()) return;
      if (state.nameEditing || state.nameSaving) return;
      updateSessionName(state.id, data.name);
      const targetMode = data.phase === 'configuring' ? 'configure'
        : data.revealStep >= 9 ? 'results_table' : data.revealStep > 0 ? 'results' : 'admin';
      if (state.mode !== targetMode) {
        const destination = targetMode === 'configure' ? tournamentPaths.configure(state.id)
          : targetMode === 'results_table' ? tournamentPaths.resultsTable(state.id)
            : targetMode === 'results' ? tournamentPaths.results(state.id) : tournamentPaths.admin(state.id);
        location.replace(destination); return;
      }
      if (!state.error && state.data && JSON.stringify(data) === JSON.stringify(state.data)) return;
      state.data = data;
    } else if (publicModes.includes(state.mode)) {
      const data = await api(`/tournaments/${state.id}/status`);
      if (!sameRoute()) return;
      if (state.mode === 'view' && data.revealStep >= 9) {
        location.replace(tournamentPaths.spectateTable(state.id)); return;
      }
      if (state.mode === 'public_table' && data.revealStep < 9) {
        location.replace(tournamentPaths.spectate(state.id)); return;
      }
      if (!state.error && state.data && JSON.stringify(data) === JSON.stringify(state.data)) return;
      state.data = data;
    } else if (state.mode === 'table') {
      const remote = await api(`/tables/${state.token}`);
      if (!sameRoute()) return;
      const local = stored(localKey(state.token), null);
      const pending = Boolean(local?.dirty) && !remote.revealed;
      // Una resposta que va sortir abans d'un desament ja confirmat és antiga: es conserven les rondes locals.
      const outdated = !pending && !remote.revealed && Number.isFinite(local?.base) && remote.version < local.base;
      const keepLocal = pending || outdated;
      if (remote.revealed && !state.data?.revealed) {
        state.editing = null;
        state.draft = null;
        state.roundDrafts = {};
      }
      const data = { ...remote, rounds: keepLocal ? local.rounds : remote.rounds };
      const changed = Boolean(state.error) || !state.data || JSON.stringify(data) !== JSON.stringify(state.data);
      state.data = data;
      localStorage.setItem(localKey(state.token), JSON.stringify({
        ...local, table: remote, rounds: data.rounds,
        dirty: pending, version: local?.version ?? 0,
        base: keepLocal ? (local.base ?? remote.version) : remote.version,
      }));
      state.error = '';
      if (pending) await syncRounds();
      // Sense canvis no es torna a dibuixar: el camp que s'està corregint no perd el focus.
      if (!changed) return;
    }
    if (state.mode !== 'table') state.error = '';
  } catch (err) {
    if (!sameRoute()) return;
    if (organizerModes.includes(state.mode) && err.status === 401) {
      forgetExpiredToken(state.id);
      requestOrganizerPassword(state.id);
      return;
    }
    if (state.mode === 'table' && !state.data) {
      const local = stored(localKey(state.token), null);
      if (local?.table) state.data = { ...local.table, rounds: local.rounds };
    }
    state.error = state.mode === 'table' && state.data && (err.offline || err.status >= 500)
      ? state.data.revealed ? 'Sense connexió. Les puntuacions del torneig continuen tancades.'
        : 'Sense connexió. Pots continuar apuntant rondes; s’enviaran quan torni la connexió.' : err.message;
    if (state.mode === 'table' && previous.data && state.data === previous.data && state.error === previous.error) return;
  }
  if (!sameRoute()) return;
  render();
}

// Mostra l'avís de la taula. Si algú escriu al formulari, només se substitueix l'avís perquè no es tanqui el teclat.
function updateTableNotice() {
  if (state.mode !== 'table' || !state.data) return;
  const focused = document.activeElement;
  if (focused?.closest?.('#tour-round-panel form')) {
    const current = root.querySelector('.tour-notice');
    const next = notice();
    if (current && next) current.replaceWith(next);
    else if (current) current.remove();
    else if (next) root.querySelector('.tour-table-heading')?.after(next);
    return;
  }
  const focusedId = focused?.id;
  render();
  if (focusedId) document.getElementById(focusedId)?.focus();
}

// Envia les rondes amb la versió del servidor en què es basen (`base`). Si un altre mòbil ha desat abans, mana el servidor.
const syncTasks = new Map();
function syncRounds() {
  const tableToken = state.token;
  if (!tableToken) return Promise.resolve();
  if (syncTasks.has(tableToken)) return syncTasks.get(tableToken);
  const here = () => state.mode === 'table' && state.token === tableToken && state.data;
  let rebased = false;
  const task = (async () => {
    for (;;) {
      const local = stored(localKey(tableToken), null);
      if (!local?.dirty) return;
      // `sent` guarda els enviaments sense resposta: si el servidor en té un, el conflicte és d'aquest mateix mòbil.
      const sent = Array.isArray(local.sent) ? local.sent : [];
      localStorage.setItem(localKey(tableToken), JSON.stringify({
        ...local, sent: sent.length && sameRounds(sent.at(-1), local.rounds) ? sent : [...sent, local.rounds].slice(-10),
      }));
      try {
        const result = await api(`/tables/${tableToken}/rounds`, { method: 'PUT',
          body: JSON.stringify({ rounds: local.rounds, base: local.base }) });
        const latest = stored(localKey(tableToken), null) ?? local;
        const newer = latest.version !== local.version;
        localStorage.setItem(localKey(tableToken), JSON.stringify({
          ...latest, base: result.version, dirty: newer && latest.dirty, sent: [],
        }));
        if (newer) continue;
        if (here()) {
          state.data.version = result.version;
          state.message = '';
          state.error = '';
          toast('Ronda desada');
          updateTableNotice();
        }
      } catch (err) {
        if (err.status === 409 && err.body?.conflict && Array.isArray(err.body.rounds)) {
          const latest = stored(localKey(tableToken), null) ?? local;
          const same = sameRounds(latest.rounds, err.body.rounds);
          if (!same && !rebased && Array.isArray(latest.sent) && latest.sent.some(rounds => sameRounds(rounds, err.body.rounds))) {
            // El servidor té el que aquest mòbil havia enviat: les rondes noves s'hi basen i es tornen a enviar.
            rebased = true;
            localStorage.setItem(localKey(tableToken), JSON.stringify({ ...latest, base: err.body.version }));
            continue;
          }
          localStorage.setItem(localKey(tableToken), JSON.stringify({
            ...latest, rounds: err.body.rounds, base: err.body.version, dirty: false, sent: [],
          }));
          if (!here()) return;
          state.data = { ...state.data, rounds: err.body.rounds, version: err.body.version };
          state.message = '';
          if (same) { state.error = ''; updateTableNotice(); return; }
          state.editing = null;
          state.draft = null;
          state.roundDrafts = {};
          state.error = conflictMessage;
          render();
          return;
        }
        if (err.status === 409 && err.message === closedScoresMessage) {
          if (here()) await refresh();
          return;
        }
        if (here()) {
          state.message = '';
          state.error = err.status && err.status < 500 ? err.message
            : 'Sense connexió. Les rondes són en aquest mòbil i es tornaran a enviar.';
          updateTableNotice();
        }
        return;
      }
    }
  })();
  syncTasks.set(tableToken, task);
  task.finally(() => syncTasks.delete(tableToken));
  return task;
}

// Diàleg de confirmació per als passos que no es poden desfer.
function confirmDialog({ title, text, confirm, onConfirm }) {
  const accept = h('button', { class: 'btn', type: 'button', onclick: async () => {
    accept.disabled = true;
    cancel.disabled = true;
    try { await onConfirm(); } finally { if (dialog.open) dialog.close(); }
  } }, confirm);
  const cancel = h('button', { class: 'btn outline', type: 'button', autofocus: true, onclick: () => dialog.close() }, 'Torna enrere');
  const dialog = h('dialog', { class: 'game-dialog', 'aria-labelledby': 'tour-confirm-title', 'aria-describedby': 'tour-confirm-text' },
    h('h2', { id: 'tour-confirm-title' }, title),
    h('p', { id: 'tour-confirm-text' }, text),
    h('div', { class: 'game-dialog-actions' }, cancel, accept));
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

function newTournamentForm() {
  const error = h('p', { class: 'tour-error', role: 'alert' });
  error.hidden = true;
  const submit = h('button', { class: 'btn block', type: 'submit' }, 'Següent');
  return h('form', { class: 'tour-form', onsubmit: async event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    submit.disabled = true;
    error.hidden = true;
    try {
      const data = await api('/tournaments', { method: 'POST', body: JSON.stringify({
        name: String(values.get('name')).trim(),
        password: String(values.get('password')),
      }) });
      saveSession(data.id, data.token, String(values.get('name')).trim());
      location.assign(tournamentPaths.configure(data.id));
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      submit.disabled = false;
    }
  } },
  h('label', {}, 'Nom del torneig', h('input', { name: 'name', maxlength: '60', required: true, placeholder: 'Torneig de Papayoo' })),
  h('label', {}, 'Contrasenya de l’organitzador', h('input', { name: 'password', type: 'password', required: true, minlength: '4',
    autocomplete: 'new-password', 'aria-describedby': 'tour-password-hint' })),
  h('p', { class: 'tour-field-hint', id: 'tour-password-hint' },
    'Almenys 4 caràcters. La necessitaràs per gestionar el torneig des d’un altre ordinador o mòbil.'),
  error,
  submit);
}

function configureForm() {
  const id = state.id;
  const draft = tournamentDraft(id);
  const error = h('p', { class: 'tour-error', role: 'alert' });
  error.hidden = true;
  const submit = h('button', { class: 'btn tour-start-button', type: 'submit' }, 'Inicia el torneig!');
  const playersInput = h('textarea', { name: 'players', required: true, placeholder: 'Núria Puig\nJoan Roca\nMercè Vila' }, draft?.players ?? '');
  const playersPerTableInput = h('input', { name: 'playersPerTable', type: 'number', inputmode: 'numeric', min: '3', max: '8', step: '1',
    value: draft?.playersPerTable ?? '5', required: true });
  const suggestedTables = count => suggestedTableCount(count, playersPerTableInput.value);
  const simultaneousInput = h('input', { name: 'simultaneousTables', type: 'number', inputmode: 'numeric', min: '1', max: '120', step: '1',
    value: draft?.simultaneousTables ?? suggestedTables(parseNames(playersInput.value).length), required: true });
  let simultaneousEdited = draft?.simultaneousEdited ?? (draft?.simultaneousTables !== undefined);
  const playerCount = h('span', { class: 'tour-player-count' });
  const tableSummary = h('span', { class: 'tour-table-summary' });
  const updatePlayerCount = () => {
    const count = parseNames(playersInput.value).length;
    playerCount.textContent = `Jugadors: ${count}`;
    if (count >= 3) {
      const tables = suggestedTables(count);
      const smallSize = Math.floor(count / tables);
      const largeTables = count % tables;
      const smallTables = tables - largeTables;
      tableSummary.textContent = [
        largeTables ? `${largeTables} ${largeTables === 1 ? 'taula' : 'taules'} de ${smallSize + 1}` : null,
        smallTables ? `${smallTables} ${smallTables === 1 ? 'taula' : 'taules'} de ${smallSize}` : null,
      ].filter(Boolean).join(', ');
    } else tableSummary.textContent = count ? 'Calen almenys 3 jugadors.' : '';
    submit.disabled = count < 3;
  };
  const form = h('form', { class: 'tour-form tour-config-form', oninput: event => {
    if (event.target === simultaneousInput) simultaneousEdited = true;
    if ((event.target === playersInput || event.target === playersPerTableInput) && !simultaneousEdited)
      simultaneousInput.value = String(suggestedTables(parseNames(playersInput.value).length));
    updatePlayerCount();
    const values = new FormData(event.currentTarget);
    try {
      sessionStorage.setItem(draftKey(id), JSON.stringify({
        players: String(values.get('players')),
        games: String(values.get('games')),
        rounds: String(values.get('rounds')),
        playersPerTable: String(values.get('playersPerTable')),
        simultaneousTables: String(values.get('simultaneousTables')),
        simultaneousEdited,
        weightUnevenTables: values.has('weightUnevenTables'),
      }));
    } catch { /* El formulari continua disponible fins que es pugui enviar. */ }
  }, onsubmit: event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    confirmDialog({ title: 'Inicia el torneig?', text: 'Es generarà el sorteig i començaran les partides.',
      confirm: 'Inicia el torneig!', onConfirm: async () => {
        submit.disabled = true;
        error.hidden = true;
        try {
          await api(`/tournaments/${id}/configure`, { method: 'PUT', headers: { Authorization: `Bearer ${session(id)?.token}` }, body: JSON.stringify({
            players: parseNames(values.get('players')),
            games: Number(values.get('games')),
            rounds: Number(values.get('rounds')),
            playersPerTable: Number(values.get('playersPerTable')),
            simultaneousTables: Number(values.get('simultaneousTables')),
            weightUnevenTables: values.has('weightUnevenTables'),
          }) });
          sessionStorage.removeItem(draftKey(id));
          location.assign(tournamentPaths.admin(id));
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
          updatePlayerCount();
        }
      } });
  } },
  h('div', { class: 'tour-row tour-config-options' },
    h('label', {}, 'Partides:', h('input', { name: 'games', type: 'number', inputmode: 'numeric', min: '1', max: '10', step: '1', value: draft?.games ?? '3', required: true })),
    h('label', {}, 'Rondes per partida:', h('input', { name: 'rounds', type: 'number', inputmode: 'numeric', min: '1', max: '20', step: '1', value: draft?.rounds ?? '5', required: true })),
    h('label', {}, 'Jugadors per taula:', playersPerTableInput),
    h('label', {}, 'Taules simultànies:', simultaneousInput),
    h('div', { class: 'tour-weight-setting' },
      h('span', {}, 'Ponderar taules irregulars'),
      h('span', { class: 'tour-help' },
        h('button', { class: 'tour-help-trigger', type: 'button', 'aria-label': 'Què vol dir ponderar taules irregulars?', 'aria-describedby': 'tour-weight-help' }, '?'),
        h('span', { class: 'tour-help-text', id: 'tour-weight-help', role: 'tooltip' },
          'Si una taula té menys jugadors que la resta, els punts obtinguts es ponderen per no perjudicar els jugadors.')),
      h('label', { class: 'tour-weight-switch' },
        h('input', { type: 'checkbox', name: 'weightUnevenTables', 'aria-label': 'Ponderar taules irregulars',
          checked: draft?.weightUnevenTables !== false }),
        h('span', { class: 'tour-weight-track', 'aria-hidden': 'true' }))),
  ),
  h('hr', { class: 'tour-config-divider' }),
  h('label', {}, 'Jugadors, un per línia', playersInput),
  error, h('div', { class: 'tour-config-footer' },
    h('div', { class: 'tour-config-summary' }, playerCount, tableSummary), submit));
  updatePlayerCount();
  return form;
}

function manageTournamentDialog({ initialId = '', returnPath = null } = {}) {
  const recent = Object.entries(readSessions()).filter(([id, item]) => /^[A-Za-z0-9_-]{5,}$/.test(id) && item && typeof item === 'object')
    .sort(([, a], [, b]) => (b.usedAt ?? 0) - (a.usedAt ?? 0));
  const error = h('p', { class: 'tour-error', role: 'alert' });
  error.hidden = true;
  const recentError = h('p', { class: 'tour-error', role: 'alert' });
  recentError.hidden = true;
  const idInput = h('input', { name: 'id', placeholder: 'Codi del torneig', 'aria-label': 'Codi del torneig', required: true,
    minlength: '5', pattern: '[A-Za-z0-9_-]{5,}', autocomplete: 'off', value: initialId });
  const passwordInput = h('input', { name: 'password', type: 'password', required: true, autocomplete: 'current-password' });
  const submit = h('button', { class: 'btn', type: 'submit' }, 'Entra a gestionar');
  const form = h('form', { class: 'tour-form', onsubmit: async event => {
    event.preventDefault();
    const id = normalizedTournamentId(idInput.value);
    submit.disabled = true;
    error.hidden = true;
    try {
      const data = await api(`/tournaments/${id}/login`, {
        method: 'POST', body: JSON.stringify({ password: passwordInput.value }),
      });
      saveSession(data.id, data.token, data.name || id);
      dialog.close();
      location.assign(id === initialId && returnPath ? returnPath : tournamentPaths.admin(data.id));
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      submit.disabled = false;
    }
  } }, idInput,
  h('label', {}, 'Contrasenya de l’organitzador', passwordInput), error,
  h('div', { class: 'game-dialog-actions' },
    h('button', { class: 'btn outline', type: 'button', onclick: () => dialog.close() }, 'Cancel·la'), submit));
  const recentTab = h('button', { type: 'button', role: 'tab', id: 'tour-tab-recent', 'aria-controls': 'tour-panel-recent' }, 'Recents');
  const otherTab = h('button', { type: 'button', role: 'tab', id: 'tour-tab-other', 'aria-controls': 'tour-panel-other' }, 'Un altre');
  const recentPanel = h('div', { id: 'tour-panel-recent', role: 'tabpanel', 'aria-labelledby': 'tour-tab-recent' },
    recent.length ? h('ul', { class: 'tour-recent-list' }, recent.map(([id, item]) => h('li', {},
      h('button', { type: 'button', class: 'tour-recent-item', onclick: async event => {
        if (!item.token) {
          idInput.value = id;
          selectTab('other');
          passwordInput.focus();
          return;
        }
        const button = event.currentTarget;
        button.disabled = true;
        recentError.hidden = true;
        try {
          const data = await api(`/tournaments/${id}`, { headers: { Authorization: `Bearer ${item.token}` } });
          saveSession(id, item.token, data.name || item.name || id);
          dialog.close();
          location.assign(tournamentPaths.admin(id));
        } catch (err) {
          if (err.status === 401) {
            forgetExpiredToken(id);
            item.token = null;
            idInput.value = id;
            selectTab('other');
            passwordInput.focus();
          } else {
            recentError.textContent = err.message;
            recentError.hidden = false;
          }
          button.disabled = false;
        }
      } }, h('span', { class: 'tour-recent-name' }, item.name || id), h('code', {}, id),
      h('span', { class: 'tour-recent-arrow', 'aria-hidden': 'true' }, '→')))))
      : h('p', { class: 'tour-recent-empty' }, 'Encara no hi ha tornejos recents en aquest ordinador.'),
    recentError,
    h('button', { type: 'button', class: 'tour-other-link', onclick: () => selectTab('other') }, 'Entra amb un altre codi'));
  const otherPanel = h('div', { id: 'tour-panel-other', role: 'tabpanel', 'aria-labelledby': 'tour-tab-other' }, form);
  function selectTab(tab) {
    const isRecent = tab === 'recent';
    recentTab.setAttribute('aria-selected', String(isRecent));
    otherTab.setAttribute('aria-selected', String(!isRecent));
    recentTab.tabIndex = isRecent ? 0 : -1;
    otherTab.tabIndex = isRecent ? -1 : 0;
    recentPanel.hidden = !isRecent;
    otherPanel.hidden = isRecent;
    error.hidden = true;
    recentError.hidden = true;
  }
  recentTab.addEventListener('click', () => selectTab('recent'));
  otherTab.addEventListener('click', () => { selectTab('other'); idInput.focus(); });
  const tabs = h('div', { class: 'tour-dialog-tabs', role: 'tablist', 'aria-label': 'Com vols gestionar el torneig?' }, recentTab, otherTab);
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tab = event.key === 'ArrowLeft' || event.key === 'Home' ? 'recent' : 'other';
    selectTab(tab);
    (tab === 'recent' ? recentTab : otherTab).focus();
  });
  const dialog = h('dialog', { class: 'game-dialog tour-dialog', 'aria-labelledby': 'tour-dialog-title' },
    h('h2', { id: 'tour-dialog-title' }, 'Gestiona un torneig existent'), tabs, recentPanel, otherPanel);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  selectTab(initialId || !recent.length ? 'other' : 'recent');
  dialog.showModal();
  if (initialId || !recent.length) idInput.focus(); else recentTab.focus();
}

function landing() {
  const followError = h('p', { class: 'tour-error', role: 'alert' });
  followError.hidden = true;
  const followButton = h('button', { class: 'btn outline', type: 'submit' }, 'Segueix el torneig');
  return h('div', { class: 'tour-landing' }, header(), section(null,
    h('p', { class: 'lede' }, tournamentIntro),
    h('div', { class: 'tour-landing-actions' },
      h('a', { class: 'btn tour-create', href: tournamentPaths.new }, 'Crea un torneig'),
      h('button', { class: 'btn outline', type: 'button', onclick: () => manageTournamentDialog() }, 'Gestiona un torneig existent'))),
    section('Segueix un torneig',
      h('p', { class: 'lede' }, 'Entra el codi d’un torneig per seguir-ne l’estat.'),
      h('form', { class: 'tour-form', onsubmit: async event => {
        event.preventDefault();
        const id = normalizedTournamentId(new FormData(event.currentTarget).get('id'));
        followButton.disabled = true;
        followError.hidden = true;
        try {
          await api(`/tournaments/${id}/status`);
          location.assign(tournamentPaths.spectate(id));
        } catch (err) {
          followError.textContent = err.message;
          followError.hidden = false;
          followButton.disabled = false;
        }
      } },
      h('input', { name: 'id', placeholder: 'Codi del torneig', 'aria-label': 'Codi del torneig', required: true,
        minlength: '5', pattern: '[A-Za-z0-9_-]{5,}', autocomplete: 'off' }),
      followError, followButton)));
}

function newTournament() {
  return h('div', {}, header(tournamentPaths.list), section('Organitza un torneig', newTournamentForm()));
}

function spectateCard(id, title = 'Segueix l’estat del torneig') {
  const spectate = tournamentPaths.spectate(id);
  return h('aside', { class: 'tour-spectate-card' },
    h('h2', {}, h('a', { href: spectate }, title)),
    h('a', { href: spectate, 'aria-label': 'Obre la pantalla pública del torneig' },
      h('img', { src: `/api/v1/tournaments/${id}/qr`, alt: `Codi QR per seguir el torneig ${id}`, width: '240', height: '240' })));
}

function configureTournament() {
  return h('div', {}, tournamentHeader(state.data),
    h('div', { class: 'tour-config-layout' },
      section(null, notice(), configureForm()),
      spectateCard(state.id)));
}

async function share(url, title) {
  if (navigator.share) {
    try { await navigator.share({ title, url }); return; } catch (err) {
      if (err?.name === 'AbortError') return; // L’usuari ha tancat el menú de compartir.
    }
  }
  try { await navigator.clipboard.writeText(url); toast('Enllaç copiat.'); }
  catch { window.prompt('Copia l’enllaç de la taula:', url); }
}

let revealBusy = false;
async function changeReveal(next) {
  if (revealBusy || !Number.isInteger(next) || next < 1 || next > 9) return;
  revealBusy = true;
  const id = state.id;
  try {
    await api(`/tournaments/${id}/reveal`, { method: 'PUT',
      headers: { Authorization: `Bearer ${session(id)?.token}` }, body: JSON.stringify({ step: next }) });
    const target = next === 9 ? tournamentPaths.resultsTable(id) : tournamentPaths.results(id);
    if (location.pathname !== target) location.assign(target);
    else await refresh();
  } catch (err) { setMessage('', err.message); }
  finally { revealBusy = false; }
}

function revealNavigation(step) {
  return h('nav', { class: 'tour-reveal-nav', 'aria-label': 'Diapositives dels resultats' },
    h('button', { class: 'btn outline', type: 'button', ...(step === 1 ? { disabled: '' } : {}),
      onclick: () => changeReveal(step - 1) }, '← Anterior'),
    h('button', { class: 'btn', type: 'button', ...(step === 9 ? { disabled: '' } : {}),
      onclick: () => changeReveal(step + 1) }, step === 8 ? 'Mostra la taula final →' : 'Següent →'));
}

function resultsSlideshow(data, admin) {
  const intro = data.revealStep === 1;
  const award = data.award;
  const slide = h('section', { class: 'tour-reveal-slide' },
    h('h1', { class: 'tour-reveal-title' }, intro ? 'Ha arribat el moment dels premis' : award?.title ?? 'Resultats'),
    h('p', { class: 'tour-reveal-description' }, intro
      ? 'Set reconeixements i una classificació final. Descobrim-los plegats.' : award?.description ?? ''),
    intro ? null : h('div', { class: 'tour-award-label' },
      h('p', { class: 'tour-reveal-statistic' }, award?.statistic ?? ''),
      h('p', { class: 'tour-reveal-names' }, award?.names?.length
        ? `${award.names.length > 1 ? 'Empat: ' : ''}${join(award.names)}` : 'Sense guanyador')));
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) slide.classList.add('show-description', 'show-statistic', 'show-names');
  else for (const [delay, className] of [[2000, 'show-description'], [5000, 'show-statistic'], [9000, 'show-names']])
    setTimeout(() => { if (root.contains(slide)) slide.classList.add(className); }, delay);
  return h('div', { class: 'tour-reveal-page' }, admin ? tournamentHeader(data, false) : spectateHeader(data),
    notice(), slide, admin ? revealNavigation(data.revealStep) : null);
}

// Marques de text, amb la lletra de l'app: «1r», «2n», «3r» per al podi i «màx.» per al valor més alt de cada columna.
function badge(text, label, kind) {
  return h('span', { class: `tour-badge is-${kind}`, title: label },
    h('span', { 'aria-hidden': 'true' }, text), h('span', { class: 'sr-only' }, ` (${label})`));
}
const podium = { 1: ['1r', 'primer lloc'], 2: ['2n', 'segon lloc'], 3: ['3r', 'tercer lloc'] };
function withMarks(value, { rank = null, best = false, label = '' } = {}) {
  return h('span', { class: 'tour-marked' }, value,
    podium[rank] ? badge(...podium[rank], rank === 1 ? 'first' : 'podium') : null,
    best ? badge('màx.', label, 'max') : null);
}

function resultsTable(data, admin) {
  if (!data.standings) return h('div', {}, spectateHeader(data),
    h('section', { class: 'tour-waiting' }, h('h2', {}, 'La classificació encara no és pública'),
      h('p', {}, 'Quan l’organitzador la mostri, la veuràs aquí.')));
  const rows = data.standings.filter(row => row.played);
  const best = {
    highestTotal: Math.max(...rows.map(row => row.total)),
    papayoos: Math.max(...rows.map(row => row.papayoos)),
    zeros: Math.max(...rows.map(row => row.zeros)),
    worst: Math.max(...rows.map(row => row.worst)),
  };
  // Només es marca el màxim d'una categoria si algú hi té alguna cosa.
  const isBest = (key, value) => best[key] > 0 && value === best[key];
  const header = h('thead', {}, h('tr', {},
    h('th', {}, 'Nom'), h('th', {}, 'Puntuació'),
    admin ? [h('th', { title: 'Papayoos menjats' }, 'Papayoos ', h('span', { class: 'pcard', 'aria-label': 'set de Papayoo' }, '7')),
      h('th', {}, 'Rondes a zero'), h('th', {}, 'Màx. punts')] : null));
  const body = h('tbody', {}, rows.flatMap(row => {
    const rank = h('strong', { class: 'tour-results-rank' }, `${row.rank}.`);
    const name = h('td', {}, rank, row.name);
    const points = h('td', {}, withMarks(`${fmt(row.total)} punts`,
      { rank: row.rank, best: isBest('highestTotal', row.total), label: 'major puntuació' }));
    const papayoos = () => withMarks(row.papayoos, { best: isBest('papayoos', row.papayoos), label: 'més Papayoos' });
    const zeros = () => withMarks(row.zeros, { best: isBest('zeros', row.zeros), label: 'més rondes a zero' });
    const worst = () => withMarks(fmt(row.worst), { best: isBest('worst', row.worst), label: 'més punts en una ronda' });
    if (admin) return h('tr', {}, name, points, h('td', {}, papayoos()), h('td', {}, zeros()), h('td', {}, worst()));
    const games = row.games.flatMap((game, index) => game
      ? [h('li', {}, `Partida ${index + 1}: ${fmt(game.points)} punts · Taula ${game.table + 1}`)] : []);
    const detail = h('tr', { class: 'tour-results-detail' }, h('td', { colspan: '2' },
      h('div', { class: 'tour-results-detail-grid' },
        h('span', {}, 'Papayoos: ', papayoos()),
        h('span', {}, 'Rondes a zero: ', zeros()),
        h('span', {}, 'Màx. punts en una ronda: ', worst()),
        games.length ? h('div', { class: 'tour-results-games' },
          h('strong', {}, 'Puntuació per partida:'), h('ul', {}, games)) : null)));
    detail.hidden = true;
    const toggle = () => {
      detail.hidden = !detail.hidden;
      button.setAttribute('aria-expanded', String(!detail.hidden));
    };
    const button = h('button', { class: 'tour-results-player', type: 'button', 'aria-expanded': 'false',
      'aria-label': `Detalls de ${row.name}`, onclick: toggle }, row.name);
    name.replaceChildren(rank, button);
    return [h('tr', { class: 'tour-results-clickable', onclick: event => {
      if (event.target.closest('button')) return;
      toggle();
    } }, name, points), detail];
  }));
  return h('div', { class: 'tour-final-page' }, admin ? tournamentHeader(data, false) : spectateHeader(data),
    notice(), h('section', { class: 'tour-final-content' }, h('h1', {}, 'Classificació final'),
      admin ? null : h('p', { class: 'tour-final-hint' }, 'Toca un jugador per veure’n més detalls.'),
      h('div', { class: 'tour-results' }, h('table', {}, header, body))),
    admin ? revealNavigation(9) : null);
}

function status(data, admin) {
  if (data.phase === 'configuring') return h('div', {}, spectateHeader(data),
    h('section', { class: 'tour-waiting' },
      h('h2', {}, 'El torneig s’està configurant'),
      h('p', {}, 'Quan l’organitzador iniciï el torneig veuràs aquí l’estat de les partides.')));
  if (!admin && data.progress.received === data.progress.total && !data.revealed)
    return h('div', {}, spectateHeader(data),
      h('section', { class: 'tour-waiting' },
        h('h2', {}, 'Les partides han acabat'),
        h('p', {}, 'Aquí veuràs els resultats quan l’organitzador hagi anunciat la primera posició.')));
  if (!admin && data.revealStep >= 8) return resultsSlideshow(data, false);
  const progress = tournamentProgress(data);
  const allFinished = data.progress.received === data.progress.total;
  const visibleWaves = visibleTournamentWaves(data);
  const hasMultipleWaves = progress.hasMultipleWaves;
  const progressLabel = `Partida ${progress.game}/${data.games}${hasMultipleWaves ? ` — Torn ${progress.wave}/${progress.waves}` : ''} — Ronda ${progress.round}/${data.rounds}`;
  const progressFill = h('span', { class: 'tour-stage-fill', style: `width: ${100 * progress.completed / progress.total}%` });
  const visibleTables = data.schedule.flatMap((game, gi) => game.map((seats, ti) => ({ seats, ti, gi,
    current: data.tables.find(table => table.game === gi && table.table === ti) })))
    .filter(({ gi, current }) => visibleWaves.some(turn => turn.game === gi && turn.wave === current?.wave));
  const activeTables = visibleTables.filter(({ current }) => current.active);
  const waitingTables = visibleTables.filter(({ current }) => !current.active);
  const tableCard = ({ seats, ti, gi, current }) => {
    // Una taula acabada també obre la seva pàgina fins que comencen els resultats, per poder corregir rondes.
    const clickable = !admin && current.entryPath;
    const link = admin ? data.links?.[gi]?.[ti] : null;
    return h(clickable ? 'a' : 'article', {
    class: `tour-card${current.finished ? ' is-finished' : !current.active ? ' is-waiting' : ''}`,
    ...(clickable ? { href: current.entryPath } : {}),
  },
  h('div', { class: 'tour-card-head' },
    h('strong', {}, `Taula ${ti + 1}`),
    h('span', { class: 'tour-card-status' }, current.finished ? '✓ Acabada'
      : current.active ? `Ronda ${Math.min(current.rounds + 1, data.rounds)}/${data.rounds}` : 'En espera')),
  h('hr', { class: 'tour-card-divider' }),
  h('ul', { class: 'tour-card-players' }, seats.map(index => h('li', {}, data.players[index]))),
  link ? h('div', { class: 'tour-card-actions' },
    h('button', { class: 'btn outline small', type: 'button', 'aria-label': `Comparteix l’enllaç de la taula ${ti + 1}`,
      onclick: () => share(`${location.origin}${tournamentPaths.table(link)}`,
        `${data.name || 'Torneig de Papayoo'} · Partida ${gi + 1}, taula ${ti + 1}`) }, 'Comparteix l’enllaç')) : null);
  };
  const tableContent = h('div', { class: 'tour-playing-main' },
    visibleTables.length ? h('div', { class: 'tour-table-groups' },
      activeTables.length ? h('div', { class: 'tour-cards' }, activeTables.map(tableCard)) : null,
      waitingTables.length ? h('section', { class: 'tour-upcoming' },
        h('h3', { class: 'tour-upcoming-title' }, 'A continuació:'),
        h('div', { class: 'tour-cards' }, waitingTables.map(tableCard))) : null) : null,
    admin && allFinished ? h('div', { class: 'actions tour-results-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => confirmDialog({
        title: 'Comencen els resultats?', text: 'A partir d’ara cap taula podrà corregir rondes.',
        confirm: 'Mostra els resultats', onConfirm: () => changeReveal(1),
      }) }, 'Mostra els resultats')) : null);
  return h('div', {}, admin ? tournamentHeader(data) : spectateHeader(data),
    h('section', { class: 'tour-stage-progress' },
      h('h2', { class: 'tour-stage-title' }, progressLabel),
      h('div', { class: `tour-stage-meter${data.phase === 'playing' ? ' is-playing' : ''}`, role: 'progressbar', 'aria-label': 'Progrés del torneig',
        'aria-valuemin': '0', 'aria-valuemax': String(progress.total), 'aria-valuenow': String(progress.completed) }, progressFill)),
    !admin && visibleTables.some(({ current }) => current.entryPath)
      ? h('p', { class: 'tour-spectate-instruction' }, 'Toca la teva taula per apuntar-ne els punts') : null,
    notice(),
    admin && !allFinished ? h('div', { class: 'tour-config-layout tour-playing-layout' }, tableContent,
      spectateCard(data.id, 'Entra la puntuació')) : tableContent);
}

function emptyDraft(size) { return { papayoo: null, points: Array(size).fill(null) }; }

function table() {
  const t = state.data;
  const locked = Boolean(t.revealed);
  const count = t.rounds.length;
  const done = count >= t.roundsPlanned;
  const waiting = t.active === false && count === 0;
  if (done && state.editing === null) { state.editing = count - 1; state.draft = null; }
  if (state.editing !== null && state.editing >= count) { state.editing = done ? count - 1 : null; state.draft = null; }
  const draftKey = index => index === null ? 'current' : `round-${index}`;
  const draftFor = index => index === null ? emptyDraft(t.players.length) : {
    papayoo: t.rounds[index].papayoo, points: t.rounds[index].points.slice(),
  };
  if (!state.draft || state.draft.points.length !== t.players.length)
    state.draft = state.roundDrafts[draftKey(state.editing)] ?? draftFor(state.editing);
  function selectRound(index) {
    if (index === state.editing) return;
    state.roundDrafts[draftKey(state.editing)] = state.draft;
    state.editing = index;
    state.draft = state.roundDrafts[draftKey(index)] ?? draftFor(index);
    state.message = '';
    render();
  }
  const tabs = Array.from({ length: t.roundsPlanned }, (_, index) => index);
  const enabledTabs = tabs.filter(index => !waiting && index <= count);
  const selectedTab = waiting ? -1 : state.editing === null ? count : state.editing;
  const tablist = h('div', { class: 'tour-round-tabs', role: 'tablist', 'aria-label': 'Rondes de la taula' },
    tabs.map(index => h('button', { id: `tour-round-tab-${index}`, type: 'button', role: 'tab',
      'aria-selected': String(index === selectedTab),
      ...(!waiting ? { 'aria-controls': 'tour-round-panel' } : {}),
      tabindex: index === selectedTab ? '0' : '-1',
      ...(waiting || index > count ? { disabled: '' } : {}),
      onclick: () => selectRound(index === count ? null : index),
    }, `Ronda ${index + 1}`)));
  tablist.addEventListener('keydown', event => {
    if (!enabledTabs.length) return;
    const current = enabledTabs.indexOf(selectedTab);
    const next = event.key === 'ArrowRight' ? (current + 1) % enabledTabs.length
      : event.key === 'ArrowLeft' ? (current - 1 + enabledTabs.length) % enabledTabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? enabledTabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    selectRound(enabledTabs[next] === count ? null : enabledTabs[next]);
    document.getElementById(`tour-round-tab-${enabledTabs[next]}`)?.focus();
  });
  const draft = state.draft;
  const pointInputs = [];
  const papayooSelect = h('select', { id: 'table-papayoo', onchange: event => {
    draft.papayoo = event.target.value === '' ? null : Number(event.target.value);
    updateRoundForm();
  } },
  h('option', { value: '' }, 'Tria un jugador'),
  t.players.map((player, index) => h('option', { value: String(index) }, player)));
  const tally = h('p', { class: 'note tour-round-tally', role: 'status' });
  const validation = h('p', { class: 'tour-error tour-round-error', role: 'alert' });
  const submit = h('button', { class: 'btn block', type: 'submit' }, state.editing === null ? 'Desa la ronda' : 'Desa la correcció');
  function updateRoundForm() {
    const result = resolveRound(draft);
    pointInputs.forEach((input, index) => {
      const calculated = draft.points[index] === null && result.points[index] !== null;
      input.value = draft.points[index] ?? result.points[index] ?? '';
      input.disabled = locked || calculated;
      input.classList.toggle('is-auto', calculated);
      input.classList.toggle('bad', calculated && result.points[index] < 0);
    });
    papayooSelect.value = String(result.papayoo ?? '');
    papayooSelect.disabled = locked;
    const missing = draft.points.filter(points => points === null).length;
    const entered = draft.points.reduce((sum, points) => sum + (points ?? 0), 0);
    let detail = 'Tot quadra';
    if (result.errors.includes('papayoo-points')) detail = `El Papayoo val ${PAPAYOO_POINTS} punts`;
    else if (result.remaining < 0) detail = `Sobren ${-result.remaining} punts`;
    else if (!result.valid && result.remaining > 0 && missing > 1)
      detail = `Queden ${result.remaining} punts per a ${missing} jugadors`;
    else if (!result.valid && result.remaining > 0) detail = `Queden ${result.remaining} punts`;
    else if (!result.valid && result.errors.includes('papayoo-missing')) detail = 'Falta indicar el Papayoo';
    tally.textContent = `Total: ${result.valid ? TOTAL : entered} de ${TOTAL}. ${detail}.`;
    validation.textContent = result.errors.includes('papayoo-points')
      ? `Qui s’ha endut el Papayoo ha de tenir almenys ${PAPAYOO_POINTS} punts.`
      : result.errors.includes('over-total') || result.errors.includes('sum-mismatch')
        ? `La suma ha de ser exactament ${TOTAL} punts.`
        : result.errors.includes('papayoo-missing') && missing <= 1
          ? 'Cal indicar qui s’ha endut el Papayoo.' : '';
    validation.hidden = !validation.textContent;
    const saved = state.editing === null ? null : t.rounds[state.editing];
    const unchanged = saved && result.papayoo === saved.papayoo
      && result.points.every((points, index) => points === saved.points[index]);
    submit.disabled = locked || !result.valid || !draft.points.every(points => points === null
      || (Number.isInteger(points) && points >= 0 && points <= TOTAL)) || Boolean(unchanged);
  }
  const form = h('form', { class: 'tour-form', onsubmit: async event => {
    event.preventDefault();
    if (locked) return;
    const checked = resolveRound(state.draft);
    if (!checked.valid || !state.draft.points.every(p => p === null || (Number.isInteger(p) && p >= 0 && p <= TOTAL))) {
      setMessage('', checked.errors.includes('papayoo-points')
        ? `Qui s’ha endut el Papayoo ha de tenir almenys ${PAPAYOO_POINTS} punts.`
        : `Revisa els punts: la suma ha de ser ${TOTAL} i cal marcar el Papayoo.`); return;
    }
    const previous = state.editing === null ? null : t.rounds[state.editing];
    if (previous && checked.papayoo === previous.papayoo
      && checked.points.every((points, index) => points === previous.points[index])) return;
    const row = { papayoo: checked.papayoo, points: checked.points };
    const rounds = t.rounds.slice();
    const savedIndex = state.editing;
    if (savedIndex === null) rounds.push(row); else rounds[savedIndex] = row;
    t.rounds = rounds;
    const old = stored(localKey(state.token), null);
    localStorage.setItem(localKey(state.token), JSON.stringify({
      ...old, table: old?.table ?? { ...t, rounds: [] }, rounds,
      dirty: true, version: (old?.version ?? 0) + 1, base: old?.base ?? t.version,
    }));
    delete state.roundDrafts[draftKey(savedIndex)];
    const nextIndex = savedIndex === null ? rounds.length : savedIndex + 1;
    state.editing = nextIndex >= t.roundsPlanned ? (savedIndex ?? rounds.length - 1)
      : nextIndex === rounds.length ? null : nextIndex;
    state.draft = state.roundDrafts[draftKey(state.editing)] ?? draftFor(state.editing);
    state.message = ''; state.error = '';
    render();
    document.getElementById(`tour-round-tab-${state.editing ?? rounds.length}`)?.focus();
    // syncRounds actualitza l'avís o, si hi ha conflicte, torna a dibuixar la taula.
    await syncRounds();
  } },
    h('label', { class: 'tour-papayoo-label' }, h('span', {}, 'Qui s’ha endut el Papayoo?'),
      papayooSelect),
    h('hr', { class: 'tour-points-divider' }),
    h('div', { class: 'points-grid' }, t.players.flatMap((p, i) => [h('label', { for: `points-${i}` }, p),
      pointInputs[i] = h('input', { id: `points-${i}`, type: 'number', inputmode: 'numeric', min: '0', max: String(TOTAL),
        oninput: e => {
          draft.points[i] = e.target.value === '' ? null : clampPoints(e.target.value);
          updateRoundForm();
        } })])),
    tally, validation, submit);
  updateRoundForm();
  return h('div', {}, spectateHeader({ name: t.tournamentName || 'Torneig de Papayoo' }),
    h('div', { class: 'tour-table-heading' },
      h('p', { class: 'tour-table-context' }, `Partida ${t.game + 1}${t.waves > 1 ? ` — Torn ${t.wave + 1}` : ''} — Taula ${t.table + 1}`),
      h('p', { class: 'tour-table-rounds' }, `${count} de ${t.roundsPlanned} rondes desades.`),
      done || locked ? h('a', { class: 'btn outline tour-table-return', href: tournamentPaths.spectate(t.tournamentId) },
        'Tornar al llistat de taules') : null),
    notice(), locked ? h('p', { class: 'tour-ok', role: 'status' }, closedScoresMessage) : null,
    section(null, h('p', {}, h('strong', {}, 'Jugadors: '), join(t.players))),
    waiting ? section('Encara no és el torn d’aquesta taula',
      h('p', {}, `${t.wave > 0 ? `Aquesta taula jugarà al torn ${t.wave + 1}, quan acabin les taules del torn anterior.`
        : t.game > 0 ? `Aquesta taula jugarà quan s’acabi la partida ${t.game}.` : 'Aquesta taula encara no pot començar.'
      } La pantalla s’actualitzarà automàticament.`)) : null,
    section(null, tablist, !waiting ? h('div', { id: 'tour-round-panel', class: 'tour-round-panel', role: 'tabpanel',
      'aria-labelledby': `tour-round-tab-${selectedTab}` }, form) : null));
}

function render() {
  const titles = {
    list: 'Tornejos',
    new: 'Nou torneig',
    configure: 'Configura el torneig',
    admin: 'Gestiona el torneig',
    results: 'Resultats del torneig',
    results_table: 'Classificació final',
    view: 'Segueix el torneig',
    public_table: 'Classificació final',
    table: 'Taula del torneig',
    missing: 'Pàgina no trobada',
  };
  document.title = `${titles[state.mode] ?? 'Tornejos'} | APPayoo`;
  root.classList.toggle('tour-desktop', organizerModes.includes(state.mode));
  let content;
  if (state.mode === 'list') content = landing();
  else if (state.mode === 'new') content = newTournament();
  else if (state.mode === 'configure' && state.data) content = configureTournament();
  else if (state.mode === 'missing') content = h('div', {}, header(), section('Pàgina no trobada', h('a', { href: tournamentPaths.list }, 'Torna als tornejos')));
  else if (!state.data) content = h('div', {}, [...publicModes, 'table'].includes(state.mode) ? spectateHeader(null) : header(),
    state.error ? section('No s’ha pogut obrir el torneig',
      h('p', { class: 'tour-error', role: 'alert' }, state.error),
      h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: event => {
        event.currentTarget.disabled = true;
        event.currentTarget.textContent = 'Carregant…';
        refresh();
      } }, 'Torna-ho a provar')))
      : section('Carregant', h('p', {}, 'Carregant el torneig…')));
  else if (state.mode === 'table') content = table();
  else if (state.mode === 'results') content = resultsSlideshow(state.data, true);
  else if (state.mode === 'results_table') content = resultsTable(state.data, true);
  else if (state.mode === 'public_table') content = resultsTable(state.data, false);
  else content = status(state.data, state.mode === 'admin');
  root.replaceChildren(content);
}

function route() {
  const legacy = legacyTournamentPath(location.hash);
  if (legacy) history.replaceState(null, '', legacy);
  // Un codi escrit en minúscules s'obre igualment, però amb l'adreça canònica en majúscules.
  const target = canonicalTournamentRoute(tournamentRoute(location.pathname));
  if (target.path) history.replaceState(null, '', target.path);
  if ([...organizerModes, ...publicModes, 'table'].includes(target.mode)) open(target.mode, target.value);
  else { state.mode = target.mode; state.data = null; render(); }
}

window.addEventListener('hashchange', route);
window.addEventListener('popstate', route);
const needsLiveRefresh = () => state.mode === 'configure' || state.mode === 'admin' || state.mode === 'view'
  || (state.mode === 'table' && !state.data?.revealed);
window.addEventListener('online', () => { if (needsLiveRefresh()) refresh(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && needsLiveRefresh()) refresh(); });
// Només es consulta el servidor mentre la taula espera el torn; si no, es reenvien les rondes pendents.
// Una taula acabada (active: false) no es redibuixa: el camp que s'està corregint no perd el focus.
setInterval(() => { if (!document.hidden && state.mode === 'table' && !state.data?.revealed) {
  if (state.data?.active === false && !state.data.rounds.length) refresh(); else syncRounds();
} }, 5000);
setInterval(() => { if (!document.hidden && state.mode === 'admin') refresh(); }, 5000);
setInterval(() => { if (!document.hidden && state.mode === 'view') refresh(); }, 30000);
route();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
