import {
  TOTAL, PAPAYOO_POINTS, MIN_PLAYERS, MAX_PLAYERS,
  resolveRound, clampPoints, standings, validateSetup, createGame, normalizeNames,
} from './logic.js';
import { renderChart, seriesColor } from './chart.js';
import { symbolEl } from './symbols.js';
import { brand, navigation } from './brand.js';
import { canStoreLocally } from './storage.js';
import { decodeShared, normalizeSharedGame, shareLink, legacyShareLink, shareMessage, gameKey } from './share.js';
import {
  tournamentStandings, awards, fmtAward, standingsMessage, fmtPoints, joinNames, tournamentTitle, needsScaling, progress,
} from './legacy-tournament.js';
const STORAGE_KEY = 'appayo:v1';
const SHARED_KEY = 'appayo:shared:v1';
const HISTORY_PAGE_SIZE = 10;
const root = document.getElementById('app');
const localStorageAvailable = canStoreLocally();
const placeholderNames = names => names.map((name, i) => name === `Jugador ${i + 1}` ? '' : name);

const ERROR_TEXT = {
  'papayoo-missing': 'Cal dir qui s\'ha endut el Papayoo.',
  'papayoo-points': `Qui s’ha endut el Papayoo ha de tenir almenys ${PAPAYOO_POINTS} punts.`,
  'over-total': `La suma passa de ${TOTAL}.`,
  'sum-mismatch': `La suma ha de ser exactament ${TOTAL}.`,
  'negative': 'No hi pot haver punts negatius.',
  'too-few': `Calen com a mínim ${MIN_PLAYERS} jugadors.`,
  'too-many': `Com a màxim ${MAX_PLAYERS} jugadors.`,
  'duplicate-name': 'Hi ha dos jugadors amb el mateix nom.',
};

const SHARE_ERROR_TEXT = {
  'bad-link': 'L\'enllaç no és sencer. Sovint es talla en copiar-lo: demana que te\'l tornin a enviar i obre\'l tocant-hi a sobre.',
  'bad-version': 'L\'enllaç ve d\'una versió més nova de l\'APPayo. Torna a carregar la pàgina i prova-ho un altre cop.',
  'bad-data': 'Els punts d\'aquesta partida no quadren, així que no es pot mostrar.',
};

// ---------- Estat ----------
const state = Object.assign({
  screen: 'setup',
  setup: { names: ['', '', ''], roundsPlanned: 'players' },
  game: null,
  draft: null,
  games: [],      // partides acabades, la més recent primer
  historyPage: 1,
  viewing: null,  // id de la partida de l'historial que s'està mirant
  gameTab: 'overview',
  edit: null,     // ronda que s'està arreglant: { gameId (null = la partida en curs), round, draft, back }
}, load() ?? {});
let repairedSavedState = false;
if (Array.isArray(state.setup?.names)) {
  const names = placeholderNames(state.setup.names);
  if (names.some((name, i) => name !== state.setup.names[i])) {
    state.setup.names = names;
    repairedSavedState = true;
  }
}
if (state.game && !state.game.id) {
  state.game.id = `g-${state.game.createdAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  repairedSavedState = true;
}
for (const game of [state.game, ...(state.games ?? [])].filter(Boolean)) {
  for (const round of game.rounds ?? []) {
    if (!Array.isArray(round.points) || round.points[round.papayoo] >= PAPAYOO_POINTS
        || !round.points.every(points => Number.isInteger(points) && points >= 0)
        || round.points.reduce((sum, points) => sum + points, 0) !== TOTAL) continue;
    const candidates = round.points.flatMap((points, i) => points >= PAPAYOO_POINTS ? [i] : []);
    if (candidates.length !== 1) continue;
    round.papayoo = candidates[0];
    repairedSavedState = true;
  }
}
if (repairedSavedState) save();

// Partida rebuda per un enllaç: només viu mentre es mira, no es desa fins que es diu.
let incoming = null;
let incomingError = null;
let serverSharedId = null;
let serverSharedTab = 'overview';
let serverSharedGame = null;
let serverSharedError = null;
let serverSharedLoading = false;
const sharing = new Set();
let oldTournamentsExpanded = false;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* sense espai: ignora */ }
}
function emptyDraft(n) {
  return { papayoo: null, points: new Array(n).fill(null) };
}
function setState(fn) {
  fn(state);
  save();
  render();
}
function archiveCurrentGame(st) {
  const g = st.game;
  if (g && g.rounds.length) {
    st.games.unshift({ ...g, endedAt: Date.now() });
    st.games = st.games.slice(0, 100);
  }
  // Les d'un torneig no canvien els noms de l'inici: són els de la taula que ha tocat.
  if (g && !g.tour) {
    st.setup.names = placeholderNames(g.players);
    if (st.setup.roundMode === 'players' && g.roundsPlanned === g.players.length) {
      st.setup.roundsPlanned = 'players';
    } else {
      st.setup.roundsPlanned = g.roundsPlanned;
      st.setup.roundMode = g.roundsPlanned === null ? 'unlimited' : 'custom';
      if (g.roundsPlanned !== null) st.setup.customRounds = String(g.roundsPlanned);
    }
  }
  st.game = null;
  st.draft = null;
}

function confirmGameAction({ title, message, action, danger = false }) {
  return new Promise(resolve => {
    const dialog = h('dialog', { class: 'game-dialog', 'aria-labelledby': 'game-dialog-title', 'aria-describedby': 'game-dialog-message' },
      h('h2', { id: 'game-dialog-title' }, title),
      h('p', { id: 'game-dialog-message' }, message),
      h('div', { class: 'game-dialog-actions' },
        h('button', { class: 'btn outline', type: 'button', autofocus: true, onclick: () => dialog.close('cancel') }, 'Torna enrere'),
        h('button', { class: danger ? 'btn confirm-danger' : 'btn', type: 'button', onclick: () => dialog.close('confirm') }, action),
      ),
    );
    dialog.addEventListener('close', () => {
      const confirmed = dialog.returnValue === 'confirm';
      dialog.remove();
      resolve(confirmed);
    }, { once: true });
    // iOS anteriors a la 15.4 no tenen <dialog>: s'hi fa servir la confirmació del sistema.
    if (typeof dialog.showModal !== 'function') { resolve(confirm(`${title}\n\n${message}`)); return; }
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** Obre un diàleg informatiu; sense <dialog> (iOS < 15.4) es fa servir `fallback`. */
function showDialog(dialog, fallback) {
  if (typeof dialog.showModal !== 'function') { fallback(); return; }
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

async function finishCurrentGame() {
  const game = state.game;
  if (!game) return;
  const hasRounds = game.rounds.length > 0;
  const confirmed = await confirmGameAction(hasRounds ? {
    title: 'Finalitzar la partida?',
    message: `Es desarà a l’historial amb ${fmtRounds(game.rounds.length)} i tot seguit en veuràs els resultats.`,
    action: 'Finalitza la partida',
  } : {
    title: 'Eliminar la partida?',
    message: 'Encara no hi ha cap ronda jugada. La partida s’eliminarà i no apareixerà a l’historial.',
    action: 'Elimina la partida', danger: true,
  });
  if (!confirmed || state.game !== game) return;
  if (hasRounds) archiveAndShowCurrentGame();
  else { setState(archiveCurrentGame); go('setup'); }
}

function archiveAndShowCurrentGame() {
  const id = state.game.id;
  setState(archiveCurrentGame);
  go('detail', { viewing: id, gameTab: 'overview' });
}

// ---------- Utilitats DOM ----------
function h(tag, attrs, ...children) {
  attrs = attrs || {};
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'type' && k !== 'value' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const dot = (i, size) => symbolEl(i, seriesColor(i), size);
const pcard = (lg) => h('span', { class: `pcard${lg ? ' lg' : ''}`, 'aria-label': 'Papayoo' }, '7');
const fmtDate = (ts) => new Date(ts).toLocaleDateString('ca', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtShortDate = (ts) => {
  const date = new Date(ts);
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
};
const fmtRounds = (n) => `${n} ${n === 1 ? 'ronda' : 'rondes'}`;

// ---------- Compartir ----------
let toastTimer = null;
function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = h('p', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3000);
}

const clearHash = () => history.replaceState(null, '', location.pathname + location.search);

function sharedLinks() {
  try { return JSON.parse(localStorage.getItem(SHARED_KEY) || '{}') || {}; }
  catch { return {}; }
}

async function shareGame(g, { copyOnly = false } = {}) {
  const key = g.id || gameKey(g);
  if (sharing.has(key)) return;
  const snapshot = normalizeSharedGame({
    players: g.players, rounds: g.rounds, roundsPlanned: g.roundsPlanned,
    createdAt: g.createdAt, endedAt: g.endedAt ?? Date.now(), ...(g.tour ? { tour: g.tour } : {}),
  });
  if (!snapshot) {
    // Partides d'abans, quan no es comprovava que qui tenia el Papayoo en tingués els 40 punts.
    const bad = g.rounds.findIndex(r => !(r.points[r.papayoo] >= PAPAYOO_POINTS));
    const saved = state.games.some(x => x.id === g.id);
    if (bad < 0 || (!saved && g !== state.game)) { toast('Aquesta partida encara no es pot compartir.'); return; }
    const fix = await confirmGameAction({
      title: `Cal arreglar la ronda ${bad + 1}`,
      message: `Hi consta que el Papayoo se l’ha endut algú amb menys de ${PAPAYOO_POINTS} punts. Arregla-la i després la podràs compartir.`,
      action: 'Arregla la ronda',
    });
    if (fix) startEdit(saved ? g.id : null, bad, saved ? 'detail' : 'game', 'rounds');
    return;
  }
  const origin = `${location.origin}/`;
  // Sense connexió, l'enllaç antic porta tota la partida a dins i s'obre igual.
  if (navigator.onLine === false) { await sendShare(snapshot, legacyShareLink(snapshot, origin), copyOnly); return; }
  const known = sharedLinks()[key];
  if (known?.id && known?.writeToken) {
    // El menú de compartir només s'obre just després del toc: s'envia ja i la còpia del servidor s'actualitza alhora.
    updateSharedCopy(key, known, snapshot);
    await sendShare(snapshot, shareLink(known.id, origin), copyOnly);
    return;
  }
  sharing.add(key);
  render();
  let link;
  try {
    const saved = await api('/api/v1/shared-games', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game: snapshot }),
    });
    localStorage.setItem(SHARED_KEY, JSON.stringify({ ...sharedLinks(), [key]: saved }));
    link = shareLink(saved.id, origin);
  } catch (err) {
    if (!err.offline && !(err.status >= 500)) { toast(err.message); return; }
    link = legacyShareLink(snapshot, origin);
  } finally {
    sharing.delete(key);
    render();
  }
  // Si el servidor ha trigat, el navegador ja no obre el menú de compartir sense un toc nou.
  if (copyOnly || navigator.userActivation?.isActive !== false) await sendShare(snapshot, link, copyOnly);
  else offerShare(shareMessage(snapshot, link));
}

/** Les crides a l'API, amb un temps màxim i errors en català encara que no hi hagi connexió. */
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, { ...options, signal: AbortSignal.timeout?.(10000) });
  } catch {
    throw Object.assign(new Error('No hi ha connexió amb el servidor. Torna-ho a provar.'), { offline: true });
  }
  const body = (response.headers.get('content-type') ?? '').includes('application/json')
    ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    throw Object.assign(new Error(body?.error || 'El servidor no ha pogut respondre. Torna-ho a provar.'), { status: response.status });
  }
  return body;
}

async function updateSharedCopy(key, known, snapshot) {
  try {
    await api(`/api/v1/shared-games/${known.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${known.writeToken}` },
      body: JSON.stringify({ game: snapshot }),
    });
  } catch (err) {
    if (err.status !== 401 && err.status !== 404) return;
    // Aquest enllaç ja no es pot actualitzar: el pròxim cop se'n farà un de nou.
    const links = sharedLinks();
    delete links[key];
    localStorage.setItem(SHARED_KEY, JSON.stringify(links));
    toast('Aquest enllaç ja no es pot actualitzar. Torna a compartir la partida per tenir-ne un de nou.');
  }
}

async function sendShare(snapshot, link, copyOnly) {
  const message = shareMessage(snapshot, link);
  await (copyOnly ? copyShareText(message) : shareText(message));
}

/** El menú de compartir del mòbil (WhatsApp...), o copiar el text si no n'hi ha. */
async function shareText(text) {
  if (navigator.share) {
    try { await navigator.share({ text }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  await copyShareText(text);
}

async function copyShareText(text) {
  try {
    // Sense un toc recent, alguns navegadors no responen mai: llavors es mostra el text per copiar-lo.
    await Promise.race([navigator.clipboard.writeText(text), new Promise((_, reject) => setTimeout(reject, 2000))]);
    toast('Enllaç copiat');
  } catch { showShareText(text); }
}

/** El servidor ha trigat: un toc nou obre el menú de compartir. */
function offerShare(text) {
  const dialog = h('dialog', { class: 'game-dialog' },
    h('h2', null, 'La partida ja es pot enviar'),
    h('p', null, 'Toca el botó per triar a qui l’envies.'),
    h('div', { class: 'game-dialog-actions' },
      h('button', { class: 'btn outline', type: 'button', onclick: () => dialog.close() }, 'Tanca'),
      h('button', { class: 'btn', type: 'button', onclick: () => { dialog.close(); shareText(text); } }, 'Comparteix')),
  );
  showDialog(dialog, () => shareText(text));
}

function showShareText(text) {
  const dialog = h('dialog', { class: 'game-dialog' },
    h('h2', null, 'Comparteix la partida'),
    h('p', null, 'Copia el missatge per enviar-lo.'),
    h('textarea', { class: 'paste', rows: 8, readonly: true }, text),
    h('div', { class: 'game-dialog-actions' },
      h('button', { class: 'btn outline', type: 'button', onclick: () => dialog.close() }, 'Tanca'),
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        try { await navigator.clipboard.writeText(text); toast('Enllaç copiat'); dialog.close(); }
        catch { toast('Selecciona el text per copiar-lo.'); }
      } }, 'Copia el missatge')),
  );
  showDialog(dialog, () => window.prompt('Copia el missatge per enviar-lo:', text));
}

const shareButton = (g) => {
  const busy = sharing.has(g.id || gameKey(g));
  return h('button', { class: 'btn outline', type: 'button', disabled: busy, 'aria-busy': busy ? 'true' : null,
    onclick: () => shareGame(g) }, busy ? [h('span', { class: 'share-spinner', 'aria-hidden': 'true' }), ' Desant…'] : 'Comparteix la partida');
};

/** Llegeix una partida compartida (#p=...) de l'adreça. */
function readHash() {
  return readLink(location.hash);
}
function readLink(text) {
  if (/[#&?]t=/.test(text)) return 'oldInvite';
  if (/[#&?]p=/.test(text)) {
    const read = decodeShared(text);
    incoming = read.ok ? read.game : null;
    incomingError = read.ok ? null : read.error;
    return 'shared';
  }
  return null;
}

function saveIncoming(g) {
  const entry = {
    players: g.players,
    rounds: g.rounds,
    roundsPlanned: g.rounds.length,
    createdAt: g.createdAt,
    endedAt: g.endedAt,
    id: `${g.createdAt}-${Math.random().toString(36).slice(2, 7)}`,
    shared: true,
  };
  clearHash();
  incoming = null;
  setState(st => {
    st.games.push(entry);
    st.games.sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt));
    st.games = st.games.slice(0, 100);
    st.viewing = entry.id;
    st.gameTab = 'overview';
    st.screen = 'detail';
  });
  history.replaceState(null, '', `/game/${encodeURIComponent(entry.id)}`);
  window.scrollTo(0, 0);
  toast('Partida desada');
}

function leaveShared() {
  clearHash();
  incoming = null;
  incomingError = null;
  go(state.game ? 'game' : 'setup');
}

function render() {
  const active = document.activeElement;
  const focusId = active && active.id ? active.id : null;
  const screens = {
    setup: renderSetup, game: renderGame, history: renderHistory, detail: renderDetail, shared: renderShared,
    serverShared: renderServerShared, edit: renderEdit, oldInvite: renderOldInvite, oldTournament: renderOldTournament,
  };
  const fn = !localStorageAvailable && !['shared', 'serverShared'].includes(state.screen)
    ? renderStorageUnavailable
    : (state.screen === 'game' && !state.game) ? renderSetup : (screens[state.screen] || renderSetup);
  const titles = {
    setup: "APPayoo - L'app per contar els punts de Papayoo!",
    game: 'Partida | APPayoo',
    history: 'Historial | APPayoo',
    detail: 'Partida | APPayoo',
    shared: 'Partida compartida | APPayoo',
    serverShared: 'Partida compartida | APPayoo',
    edit: 'Correcció de ronda | APPayoo',
    oldInvite: 'Torneig antic | APPayoo',
    oldTournament: 'Torneig antic | APPayoo',
  };
  document.title = fn === renderStorageUnavailable ? 'Obre APPayoo al navegador'
    : fn === renderSetup ? titles.setup : titles[state.screen];
  root.replaceChildren(fn());
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus({ preventScroll: true });
      if (typeof el.setSelectionRange === 'function' && el.type === 'text') {
        delete el.dataset.justFocused;
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }
}
function renderStorageUnavailable() {
  return h('div', null, masthead(), section('Obre APPayoo al navegador', null,
    h('p', { class: 'lede' }, 'Obre aquesta pàgina des del navegador del mòbil per crear partides o consultar l’historial de partides d’aquest dispositiu.')));
}
function go(screen, extra) {
  const viewing = extra?.viewing ?? state.viewing;
  const editing = extra?.edit ?? state.edit;
  const tab = extra?.gameTab ?? 'overview';
  const historyPage = Math.min(Math.max(1, Number(extra?.historyPage ?? state.historyPage) || 1),
    Math.max(1, Math.ceil(state.games.length / HISTORY_PAGE_SIZE)));
  let path = '/';
  if (screen === 'shared') path = incoming
    ? `/${new URL(legacyShareLink(incoming, `${location.origin}/`)).hash}`
    : `${location.pathname}${location.hash}`;
  else if (screen === 'serverShared') path = `/shared/${encodeURIComponent(extra?.serverSharedId ?? serverSharedId)}${(extra?.serverSharedTab ?? 'overview') === 'rounds' ? '/rounds' : ''}`;
  else if (screen === 'game' && state.game) path = gamePath(state.game.id, tab);
  else if (screen === 'edit') path = `/game/${encodeURIComponent(editing?.gameId || state.game?.id)}/edit`;
  else if (screen === 'detail' && viewing) path = gamePath(viewing, tab);
  else if (screen === 'history') path = `/history${historyPage > 1 ? `?page=${historyPage}` : ''}`;
  else if (screen === 'oldTournament') path = '/history';
  if (`${location.pathname}${location.search}${location.hash}` !== path) history.pushState(null, '', path);
  if (screen === 'serverShared') serverSharedTab = extra?.serverSharedTab ?? 'overview';
  setState(st => {
    st.screen = screen;
    Object.assign(st, extra || {});
    if (screen === 'game' || screen === 'detail') st.gameTab = tab;
    if (screen === 'history') st.historyPage = historyPage;
  });
  if (screen === 'serverShared') {
    const id = extra?.serverSharedId ?? serverSharedId;
    if (id !== serverSharedId || (!serverSharedGame && !serverSharedLoading)) loadServerShared(id);
  }
  window.scrollTo(0, 0);
}

function gamePath(id, tab = 'overview') {
  return `/game/${encodeURIComponent(id)}${tab === 'overview' ? '' : `/${tab === 'points' ? 'points' : 'rounds'}`}`;
}

function gameNavigation(g, archived, finished, options = {}) {
  const tabs = [['overview', archived || finished ? 'Com ha anat' : 'Com anem']];
  if ((!archived && !finished) || options.editing) tabs.push(['points', 'Entrar punts']);
  if (g.rounds.length) tabs.push(['rounds', 'Ronda a ronda']);
  return h('nav', { class: `main-tabs game-tabs${tabs.length === 3 ? ' three' : ''}`, 'aria-label': 'Seccions de la partida' },
    ...tabs.map(([tab, label]) =>
      h('a', {
        href: options.editing && tab === 'points' ? `/game/${encodeURIComponent(g.id)}/edit` : gamePath(g.id, tab),
        'aria-current': (options.editing ? tab === 'points' : state.gameTab === tab) ? 'page' : null,
        onclick: event => {
          if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          if (options.onNavigate) { options.onNavigate(tab); return; }
          go(archived ? 'detail' : 'game', { gameTab: tab, ...(archived ? { viewing: g.id } : {}) });
        },
      }, label)),
  );
}

function masthead(context, subnav = undefined, onHome = () => go('setup'), headerAction = null) {
  const active = ['history', 'detail'].includes(state.screen) || (state.screen === 'edit' && state.edit?.gameId) ? 'history' : 'new';
  return h('div', {},
    h('header', { class: `masthead${headerAction ? ' with-action' : ''}` },
      h('h1', { class: 'wordmark' }, h('button', { type: 'button', 'aria-label': 'APPayo · Inici', onclick: onHome }, brand())),
      context ? h('div', { class: 'context' }, context) : null,
      headerAction,
    ),
    subnav === undefined ? navigation(active) : subnav,
  );
}
function section(title, sub, ...children) {
  return h('section', { class: 'section' },
    h('h2', { class: 'section-title' }, title, sub ? h('small', null, sub) : null),
    ...children,
  );
}

// ---------- Inici ----------
function renderSetup() {
  const s = state.setup;
  const errorBox = h('p', { class: 'error', hidden: true });

  const roster = h('ul', { class: 'roster' }, s.names.map((name, i) => h('li', null,
    dot(i, 20),
    h('input', {
      class: 'text', type: 'text', id: `name-${i}`, value: name,
      placeholder: `Jugador ${i + 1}`, autocomplete: 'off', autocapitalize: 'words', maxlength: 20,
      enterkeyhint: 'next',
      oninput: (e) => { s.names[i] = e.target.value; save(); },
      onkeydown: (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const next = document.getElementById(`name-${i + 1}`);
        if (next) next.focus(); else e.target.blur();
      },
    }),
    h('button', {
      class: 'remove', type: 'button', 'aria-label': `Treu el jugador ${i + 1}`,
      disabled: s.names.length <= MIN_PLAYERS,
      onclick: () => setState(st => { st.setup.names.splice(i, 1); }),
    }, '×'),
  )));

  const roundMode = s.roundMode ?? (s.roundsPlanned === 'players' ? 'players' : s.roundsPlanned === null ? 'unlimited' : 'custom');
  const customRounds = s.customRounds ?? String(Number.isInteger(s.roundsPlanned) ? s.roundsPlanned : s.names.length);
  const validRounds = value => value !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 1;
  const selectRoundMode = mode => setState(st => {
    st.setup.roundMode = mode;
    if (mode === 'players') st.setup.roundsPlanned = 'players';
    else if (mode === 'unlimited') st.setup.roundsPlanned = null;
    else {
      const value = st.setup.customRounds ?? customRounds;
      st.setup.customRounds = value;
      st.setup.roundsPlanned = validRounds(value) ? Number(value) : null;
    }
  });
  const roundChoice = (mode, label, extra = null) => h('div', { class: `round-option${roundMode === mode ? ' is-selected' : ''}`,
    onclick: event => { if (event.target === event.currentTarget) selectRoundMode(mode); },
  },
    h('input', { type: 'radio', name: 'round-mode', id: `round-${mode}`, checked: roundMode === mode,
      onchange: () => selectRoundMode(mode) }),
    h('label', { for: `round-${mode}` }, label), extra);
  const rounds = h('div', { class: 'round-options', role: 'radiogroup', 'aria-label': 'Nombre de rondes' },
    roundChoice('players', `Tantes com jugadors (${s.names.length})`),
    roundChoice('unlimited', 'Sense límit'),
    roundChoice('custom', 'Personalitzat:', h('input', {
      type: 'number', id: 'custom-rounds', min: '1', step: '1', inputmode: 'numeric',
      value: customRounds, 'aria-label': 'Nombre de rondes personalitzat',
      onfocus: () => { if (state.setup.roundMode !== 'custom') selectRoundMode('custom'); },
      oninput: event => {
        const value = event.target.value;
        s.customRounds = value;
        s.roundMode = 'custom';
        s.roundsPlanned = validRounds(value) ? Number(value) : null;
        document.getElementById('round-custom').checked = true;
        for (const option of document.querySelectorAll('.round-option')) option.classList.toggle('is-selected', option.contains(event.target));
        save();
      },
    })),
  );

  const resume = state.game ? h('section', { class: 'section resume-card' },
    h('h2', { class: 'section-title' }, 'Partida en curs'),
    h('p', { class: 'lede' }, `${state.game.players.join(', ')}. ${state.game.rounds.length === 1 ? 'Una ronda jugada' : `${state.game.rounds.length} rondes jugades`}.`),
    h('div', { class: 'resume-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => go('game') }, 'Continua la partida'),
      h('button', { class: state.game.rounds.length ? 'btn outline' : 'btn outline danger', type: 'button', onclick: finishCurrentGame },
        state.game.rounds.length ? 'Finalitza la partida' : 'Elimina la partida'),
    ),
  ) : null;

  return h('div', { class: 'setup-page' },
    masthead(),
    resume,
    section('Qui juga?', `de ${MIN_PLAYERS} a ${MAX_PLAYERS}`,
      h('div', { class: 'setup-inset' }, roster,
        h('div', { class: 'actions end' },
          h('button', {
            class: 'btn outline small', type: 'button', disabled: s.names.length >= MAX_PLAYERS,
            onclick: () => setState(st => { st.setup.names.push(''); }),
          }, 'Afegeix un jugador'),
        ),
      ),
    ),
    section('Quantes rondes?', null,
      h('div', { class: 'setup-inset' }, rounds,
        h('p', { class: 'note' }, 'En acabar sempre en podreu afegir més.'),
      ),
    ),
    h('section', { class: 'section' },
      errorBox,
      h('button', {
        class: 'btn block', type: 'button',
        onclick: async () => {
          const errors = validateSetup(s.names);
          if (errors.length) { errorBox.textContent = ERROR_TEXT[errors[0]]; errorBox.hidden = false; return; }
          if (s.roundMode === 'custom' && !validRounds(s.customRounds ?? '')) {
            errorBox.textContent = 'Introdueix un nombre de rondes d’1 o més.';
            errorBox.hidden = false;
            document.getElementById('custom-rounds').focus();
            return;
          }
          const names = s.names.slice();
          const roundsPlanned = s.roundsPlanned;
          const roundMode = s.roundMode;
          const customRounds = s.customRounds;
          const previousGame = state.game;
          if (previousGame) {
            const hasRounds = previousGame.rounds.length > 0;
            const confirmed = await confirmGameAction(hasRounds ? {
              title: 'Començar una altra partida?',
              message: `La partida oberta es finalitzarà i es desarà a l’historial amb ${fmtRounds(previousGame.rounds.length)}. Després començarà la partida nova.`,
              action: 'Finalitza i comença',
            } : {
              title: 'Començar una altra partida?',
              message: 'La partida oberta no té cap ronda: s’eliminarà i començarà la partida nova.',
              action: 'Elimina i comença', danger: true,
            });
            if (!confirmed || state.game !== previousGame) return;
          }
          setState(st => {
            if (st.game) archiveCurrentGame(st);
            st.setup.names = names;
            st.setup.roundsPlanned = roundsPlanned;
            st.setup.roundMode = roundMode;
            st.setup.customRounds = customRounds;
            st.game = createGame(names, roundsPlanned);
            st.draft = emptyDraft(st.game.players.length);
            st.gameTab = 'overview';
            st.screen = 'game';
          });
          history.pushState(null, '', gamePath(state.game.id));
          window.scrollTo(0, 0);
        },
      }, state.game ? 'Comença una altra partida' : 'Comença la partida'),
    ),
  );
}

// ---------- Partida ----------
function renderGame() {
  const g = state.game;
  const n = g.players.length;
  if (!state.draft || state.draft.points.length !== n) state.draft = emptyDraft(n);
  const finished = g.roundsPlanned !== null && g.rounds.length >= g.roundsPlanned;
  const tab = finished && state.gameTab === 'points' ? 'overview' : state.gameTab;
  const progressActions = tab === 'overview' && !finished && g.rounds.length > 0;

  return h('div', null,
    masthead(finished ? 'Partida acabada' : null, gameNavigation(g, false, finished)),
    tab === 'overview' && finished ? renderWinner(g) : null,
    tab === 'overview' ? renderStandings(g, finished) : null,
    tab === 'points' && !finished ? newRoundEntry(g) : null,
    tab === 'rounds' && g.rounds.length
      ? roundsSection(g, ri => startEdit(null, ri, 'game', tab)) : null,
    tab === 'rounds' && g.rounds.length
      ? section('Com ha anat', 'acumulat, menys és millor', renderChart(g.players, g.rounds), legend(g.players)) : null,
    tab !== 'points' ? h('div', { class: `actions center${progressActions ? ' game-progress-actions' : ''}` },
      !finished ? h('button', { class: 'btn', type: 'button', onclick: () => go('game', { gameTab: 'points' }) },
        g.rounds.length ? `Entrar punts Ronda ${g.rounds.length + 1}` : 'Entrar punts') : null,
      finished ? h('button', { class: 'btn outline', type: 'button', onclick: () => { setState(st => { st.game.roundsPlanned += 1; }); go('game', { gameTab: 'points' }); } }, 'Juga una ronda més') : null,
      finished ? h('button', { class: 'btn', type: 'button', onclick: archiveAndShowCurrentGame }, 'Desa la partida a l\'historial') : null,
      finished ? shareButton(g) : null,
      g.rounds.length && !finished ? h('button', {
        class: 'btn quiet', type: 'button',
        onclick: () => startEdit(null, g.rounds.length - 1, 'game', tab),
      }, 'Edita l’última ronda') : null,
      finished ? null : h('button', {
        class: g.rounds.length ? 'btn outline' : 'btn quiet', type: 'button',
        onclick: finishCurrentGame,
      }, g.rounds.length ? 'Finalitza la partida' : 'Cancel·la la partida'),
    ) : null,
  );
}

function renderWinner(g) {
  const rows = standings(g.players, g.rounds);
  const winners = rows.filter(r => r.rank === 1).map(r => r.name);
  const runnerUp = rows.find(r => r.rank > 1);
  return h('section', { class: 'winner' },
    h('p', { class: 'lead' }, winners.length > 1 ? 'Empat al capdavant' : `Després de ${g.rounds.length} rondes, guanya`),
    h('p', { class: 'name' }, winners.join(' i ')),
    h('p', { class: 'sub' }, `${rows[0].total} punts`, runnerUp ? `, ${runnerUp.total - rows[0].total} menys que ${runnerUp.name}.` : '.'),
  );
}

function renderStandings(g, finished) {
  const rows = standings(g.players, g.rounds);
  const last = g.rounds[g.rounds.length - 1];
  const title = finished ? 'Com ha quedat' : h('span', { class: 'standings-title' },
    'Com anem?',
    h('span', { class: 'round-counter' }, 'Ronda ', h('b', null, g.rounds.length + 1), g.roundsPlanned ? ` de ${g.roundsPlanned}` : ''),
  );
  return section(title, g.rounds.length ? 'menys punts guanya' : null,
    h('ol', { class: 'ledger' }, rows.map(r => h('li', { class: r.rank === 1 && g.rounds.length ? 'first' : null },
      h('span', { class: 'pos' }, g.rounds.length ? `${r.rank}.` : ''),
      h('span', { class: 'who' }, dot(r.index, 18), h('span', null, r.name), last && last.papayoo === r.index ? pcard() : null),
      h('span', { class: 'score' }, r.total, last ? h('span', { class: 'last' }, `+${last.points[r.index]}`) : null),
    ))),
  );
}

/**
 * Formulari per posar els punts d'una ronda.
 * @param opts.pick  on viu l'esborrany dins de l'estat (la ronda nova o la que s'arregla)
 */
function renderRoundEntry(g, opts) {
  const { pick, title, submitLabel, onSubmit, note, extra } = opts;
  const d = pick(state);
  const res = resolveRound(d);
  const missing = d.points.filter(p => p === null).length;
  const autoBad = res.auto !== null && res.errors.includes('over-total');

  const setPoints = (i, value) => setState(st => {
    pick(st).points[i] = value === null ? null : clampPoints(value);
  });
  // Els que no s'han tocat mostren el que els toca quan es pot completar la ronda.
  const displayValue = (i) => (d.points[i] !== null ? d.points[i] : res.points[i]);
  const bump = (i, delta) => setPoints(i, clampPoints((displayValue(i) ?? 0) + delta));

  const holder = h('div', { class: 'holder', role: 'group', 'aria-label': 'Qui té el Papayoo' },
    g.players.map((name, i) => h('button', {
      type: 'button', 'aria-pressed': String(res.papayoo === i),
      onclick: () => setState(st => { pick(st).papayoo = i; }),
    }, pcard(), name)),
  );

  const rows = g.players.map((name, i) => {
    const isPap = res.papayoo === i;
    const isAuto = res.auto === i;
    const value = displayValue(i);
    const isCalc = d.points[i] === null && value !== null;
    const min = 0;
    const max = TOTAL;
    return h('li', null,
      h('div', { class: 'who' },
        dot(i, 18),
        h('span', { class: 'name' }, name),
        isPap ? pcard() : null,
        isAuto ? h('span', { class: `tag rest${autoBad ? ' bad' : ''}` }, 'la resta') : null,
        d.points[i] !== null ? h('button', { class: 'clear', type: 'button', 'aria-label': `Esborra els punts de ${name}`, onclick: () => setPoints(i, null) }, '×') : null,
      ),
      h('div', { class: 'stepper' },
        h('button', { class: 'step', type: 'button', 'aria-label': `Resta 1 a ${name}`, disabled: value !== null && value <= min, onclick: () => bump(i, -1) }, '−1'),
        h('input', {
          class: `points${isCalc ? ' is-auto' : ''}${isAuto && autoBad ? ' bad' : ''}`,
          type: 'text', inputmode: 'numeric', pattern: '[0-9]*', id: `points-${i}`,
          autocomplete: 'off', enterkeyhint: 'next',
          value: value === null ? '' : String(value),
          'aria-label': `Punts de ${name}`,
          // En entrar al camp se selecciona tot: escriure substitueix el valor (també el calculat).
          onfocus: (e) => {
            e.target.select();
            e.target.dataset.justFocused = '1';
            setTimeout(() => { delete e.target.dataset.justFocused; }, 400);
          },
          onmouseup: (e) => { if (e.target.dataset.justFocused) e.preventDefault(); },
          oninput: (e) => {
            const digits = e.target.value.replace(/\D/g, '');
            setPoints(i, digits === '' ? null : Number(digits));
          },
          onkeydown: (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const next = document.getElementById(`points-${i + 1}`);
            if (next) next.focus(); else e.target.blur();
          },
        }),
        h('button', { class: 'step', type: 'button', 'aria-label': `Suma 1 a ${name}`, disabled: value !== null && value >= max, onclick: () => bump(i, 1) }, '+1'),
      ),
      h('div', { class: 'quick' }, [-10, -5, 0, 5, 10].map(delta => h('button', {
        type: 'button',
        'aria-label': delta === 0 ? `Assigna 0 punts a ${name}` : `${delta > 0 ? 'Suma' : 'Resta'} ${Math.abs(delta)} a ${name}`,
        disabled: delta !== 0 && value !== null && (delta < 0 ? value + delta < min : value + delta > max),
        onclick: () => delta === 0 ? setPoints(i, 0) : bump(i, delta),
      }, delta === 0 ? '0' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`))),
    );
  });

  const sumEntered = res.valid ? TOTAL : d.points.reduce((a, p) => a + (p ?? 0), 0);
  let stateText, stateClass = '';
  if (res.valid) { stateText = 'Tot quadra'; stateClass = 'ok'; }
  else if (res.errors.includes('papayoo-points')) { stateText = 'El Papayoo val 40 punts'; stateClass = 'bad'; }
  else if (res.remaining < 0) { stateText = `Sobren ${-res.remaining} punts`; stateClass = 'bad'; }
  else if (missing > 1) stateText = `Queden ${res.remaining} punts per a ${missing} jugadors`;
  else stateText = `Queden ${res.remaining} punts`;
  const firstError = res.errors.find(e => e !== 'papayoo-missing') ?? (missing <= 1 ? res.errors[0] : null);

  return h('section', { class: 'section', id: 'round-entry' },
    h('h2', { class: 'section-title' }, title),
    note ? h('p', { class: 'note edit-note' }, note) : null,
    h('p', { class: 'lede' }, 'Qui s\'ha endut el Papayoo?'),
    holder,
    d.papayoo === null && res.papayoo !== null
      ? h('p', { class: 'note' }, `Papayoo assignat automàticament a ${g.players[res.papayoo]}.`)
      : d.papayoo === null ? h('p', { class: 'note' }, `Sempre se l'endú algú. Els seus ${PAPAYOO_POINTS} punts ja van dins del total del jugador.`) : null,
    h('ul', { class: 'entry' }, rows),
    h('div', { class: 'tally' },
      h('span', { class: `state ${stateClass}` }, stateText),
      h('span', { class: `sum ${stateClass}` }, sumEntered, h('small', null, ` / ${TOTAL}`)),
    ),
    firstError ? h('p', { class: 'error', style: { margin: '0 0 12px' } }, ERROR_TEXT[firstError]) : null,
    h('button', {
      class: 'btn block', type: 'button', disabled: !res.valid,
      onclick: () => {
        const draft = pick(state);
        const final = resolveRound(draft);
        if (!final.valid) return;
        onSubmit({ papayoo: final.papayoo, points: final.points.slice() });
        window.scrollTo(0, 0);
      },
    }, submitLabel),
    extra ?? null,
  );
}

function newRoundEntry(g) {
  const n = g.players.length;
  return renderRoundEntry(g, {
    pick: st => st.draft,
    title: `Ronda ${g.rounds.length + 1}`,
    submitLabel: 'Desa la ronda',
    onSubmit: (round) => {
      setState(st => {
        st.game.rounds.push(round);
        st.draft = emptyDraft(n);
      });
      go('game', { gameTab: 'overview' });
    },
  });
}

function legend(players) {
  return h('ul', { class: 'legend' }, players.map((p, i) => h('li', null, dot(i), p)));
}

/** @param onEdit  si hi és, clicar una ronda n'obre l'edició */
function roundsSection(g, onEdit) {
  return section('Ronda a ronda', onEdit ? 'Toca una ronda per arreglar-la' : null, renderRoundsTable(g, onEdit));
}

function renderRoundsTable(g, onEdit) {
  const tot = standings(g.players, g.rounds).sort((a, b) => a.index - b.index).map(r => r.total);
  return h('div', null,
    h('div', { class: 'scroll-x' },
      h('table', { class: 'rounds' },
        h('thead', null, h('tr', null, h('th', null, 'Ronda'), g.players.map((p, i) => h('th', { title: p }, h('span', { class: 'th-name' }, dot(i, 13), p))))),
        h('tbody', null, g.rounds.map((r, ri) => h('tr', onEdit ? { class: 'editable', onclick: () => onEdit(ri) } : null,
          h('td', null, onEdit
            ? h('button', { class: 'fix', type: 'button', 'aria-label': `Arregla la ronda ${ri + 1}` }, ri + 1, h('span', { 'aria-hidden': 'true' }, ' ›'))
            : ri + 1),
          r.points.map((p, i) => h('td', { class: r.papayoo === i ? 'pap' : null },
            r.papayoo === i ? h('span', { class: 'round-score' }, p, pcard()) : p)),
        ))),
        h('tfoot', null, h('tr', null, h('td', null, 'Total'), tot.map(t => h('td', null, t)))),
      ),
    ),
  );
}

// ---------- Partides anteriors ----------
function historyIcon(kind) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (kind === 'share') {
    for (const [cx, cy] of [[18, 5], [6, 12], [18, 19]]) {
      const circle = document.createElementNS(namespace, 'circle');
      circle.setAttribute('cx', cx);
      circle.setAttribute('cy', cy);
      circle.setAttribute('r', '2.5');
      svg.append(circle);
    }
  }
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', kind === 'share'
    ? 'M8.2 10.8 15.8 6.2M8.2 13.2l7.6 4.6'
    : 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6');
  svg.append(path);
  return svg;
}

async function deleteHistoryGame(g) {
  const confirmed = await confirmGameAction({
    title: 'Esborrar de l’historial?',
    message: 'Aquesta partida s’esborrarà d’aquest dispositiu i no es podrà recuperar. Si l’has compartida, l’enllaç continuarà funcionant.',
    action: 'Esborra de l’historial', danger: true,
  });
  if (!confirmed || !state.games.some(x => x.id === g.id)) return;
  setState(st => { st.games = st.games.filter(x => x.id !== g.id); st.viewing = null; });
  go('history');
}

async function deleteOldTournament(t) {
  const confirmed = await confirmGameAction({
    title: 'Esborrar el torneig antic?',
    message: `«${tournamentTitle(t)}» s’esborrarà d’aquest dispositiu i no es podrà recuperar.`,
    action: 'Esborra el torneig', danger: true,
  });
  if (!confirmed || !state.tournaments?.some(x => x.id === t.id)) return;
  setState(st => {
    st.tournaments = st.tournaments.filter(x => x.id !== t.id);
    if (st.oldTid === t.id) st.oldTid = null;
  });
}

function renderHistory() {
  const pages = Math.max(1, Math.ceil(state.games.length / HISTORY_PAGE_SIZE));
  const page = Math.min(Math.max(1, state.historyPage || 1), pages);
  const list = state.games.length
    ? h('ul', { class: 'games' }, state.games.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE).map(g => {
      const rows = standings(g.players, g.rounds);
      const busy = sharing.has(g.id || gameKey(g));
      return h('li', { class: 'history-card' },
        h('button', { class: 'history-open', type: 'button', onclick: () => go('detail', { viewing: g.id }),
          'aria-label': `Obre la partida del ${fmtShortDate(g.endedAt)}` },
        h('span', { class: 'history-players' }, rows.map(r => h('span', { class: `history-player${r.rank === 1 ? ' first' : ''}` },
          r.rank === 1 ? h('span', { class: 'sr-only' }, 'Guanyador: ') : null,
          h('span', { class: 'history-name' }, r.name),
          h('span', { class: 'history-points' }, ` · ${r.total} punts`),
        ))),
        ),
        h('span', { class: 'history-meta' },
          h('span', { class: 'history-date' }, fmtShortDate(g.endedAt)),
          h('span', null, fmtRounds(g.rounds.length)),
        ),
        h('span', { class: 'history-actions' },
          h('button', { class: 'history-action', type: 'button', disabled: busy, 'aria-busy': busy ? 'true' : null,
            'aria-label': busy ? 'Copiant la partida…' : 'Copia l’enllaç de la partida', title: 'Copia l’enllaç de la partida',
            onclick: () => shareGame(g, { copyOnly: true }) },
          busy ? h('span', { class: 'share-spinner', 'aria-hidden': 'true' }) : historyIcon('share')),
          h('button', { class: 'history-action danger', type: 'button',
            'aria-label': 'Esborra la partida de l’historial', title: 'Esborra la partida de l’historial',
            onclick: () => deleteHistoryGame(g) }, historyIcon('trash')),
        ),
      );
    }))
    : h('p', { class: 'empty' }, 'Encara no hi ha cap partida acabada. Quan n\'acabeu una, la trobareu aquí.');

  return h('div', null,
    masthead(),
    state.game ? h('div', { class: 'actions' }, h('button', { class: 'btn outline small', type: 'button', onclick: () => go('game') }, 'Torna a la partida')) : null,
    section('Partides anteriors', state.games.length ? `Total: ${state.games.length}` : null, list,
      pages > 1 ? h('nav', { class: 'history-pagination', 'aria-label': 'Pàgines de l’historial' },
        h('button', { class: 'btn outline small', type: 'button', disabled: page === 1,
          onclick: () => go('history', { historyPage: page - 1 }) }, '← Anterior'),
        h('span', { class: 'history-page-label', 'aria-live': 'polite' }, `Pàgina ${page} de ${pages}`),
        h('button', { class: 'btn outline small', type: 'button', disabled: page === pages,
          onclick: () => go('history', { historyPage: page + 1 }) }, 'Següent →'),
      ) : null,
      state.games.length ? h('div', { class: 'actions history-footer' },
        pasteLink(),
        h('button', {
          class: 'btn quiet danger', type: 'button',
          onclick: async () => {
            const count = state.games.length;
            const confirmed = await confirmGameAction({
              title: 'Esborrar tot l’historial?',
              message: `${count === 1 ? 'La partida desada s’esborrarà' : `Les ${count} partides desades s’esborraran`} d’aquest dispositiu i no es podran recuperar. Els enllaços compartits continuaran funcionant.`,
              action: 'Esborra tot l’historial', danger: true,
            });
            if (!confirmed || !state.games.length) return;
            history.replaceState(null, '', '/history');
            setState(st => { st.games = []; st.viewing = null; st.historyPage = 1; });
            toast('Historial esborrat');
          },
        }, 'Esborra tot l\'historial')) : null,
    ),
    state.games.length ? null : h('div', { class: 'paste-entry' }, pasteLink()),
    state.tournaments?.length ? h('details', {
      class: 'old-tournaments', open: oldTournamentsExpanded,
      ontoggle: (event) => { oldTournamentsExpanded = event.currentTarget.open; },
    },
      h('summary', null, 'Tornejos de la versió anterior'),
      h('ul', { class: 'games' }, state.tournaments.map(t => {
        const p = progress(t);
        return h('li', { class: 'history-card' },
          h('button', { class: 'history-open', type: 'button', onclick: () => go('oldTournament', { oldTid: t.id }) },
            h('span', { class: 'history-players' },
              h('span', { class: 'history-player first' }, h('span', { class: 'history-name' }, tournamentTitle(t))),
              h('span', { class: 'history-player' }, `${t.players.length} jugadors · ${p.received} de ${p.total} taules rebudes`))),
          h('span', { class: 'history-meta' }, h('span', { class: 'history-date' }, fmtShortDate(t.createdAt))),
          h('span', { class: 'history-actions' },
            h('button', { class: 'history-action danger', type: 'button',
              'aria-label': `Esborra el torneig ${tournamentTitle(t)}`, title: 'Esborra el torneig',
              onclick: () => deleteOldTournament(t) }, historyIcon('trash'))));
      })),
    ) : null,
  );
}

// ---------- Tornejos de la versió anterior (sense servidor): només per consultar ----------
function renderOldTournament() {
  const t = state.tournaments?.find(x => x.id === state.oldTid);
  if (!t) return renderHistory();
  const rows = tournamentStandings(t);
  const p = progress(t);
  const done = p.received === p.total;
  const list = awards(rows);
  const champion = list.find(a => a.key === 'champion');
  return h('div', null,
    masthead(null, h('hr', { class: 'header-rule' }), undefined,
      h('button', { class: 'crumb', type: 'button', onclick: () => go('history') }, '← Torna a l’historial')),
    champion ? h('section', { class: 'winner' },
      h('p', { class: 'lead' }, done ? `${tournamentTitle(t)}: guanya` : `${tournamentTitle(t)}: anava davant`),
      h('p', { class: 'name' }, joinNames(champion.names)),
      h('p', { class: 'sub' }, `${fmtPoints(champion.value)} punts. ${done ? 'Van arribar tots els resultats.' : `Van arribar ${p.received} de ${p.total} resultats.`}`),
    ) : section(tournamentTitle(t), null, h('p', { class: 'note' }, 'No hi va arribar cap resultat.')),
    p.received ? section('Classificació', 'menys punts guanya',
      h('div', { class: 'scroll-x' }, h('table', { class: 'rounds tstand' },
        h('thead', null, h('tr', null,
          h('th', null, ''),
          h('th', { class: 'name' }, 'Jugador'),
          Array.from({ length: t.games }, (_, g) => h('th', { title: `Partida ${g + 1}` }, `P${g + 1}`)),
          h('th', null, 'Total'),
        )),
        h('tbody', null, rows.map(r => h('tr', { class: r.rank === 1 ? 'first' : null },
          h('td', null, r.rank ? `${r.rank}.` : ''),
          h('td', { class: 'name' }, r.name),
          r.games.map(x => h('td', null, x ? fmtPoints(x.points) : '–')),
          h('td', { class: 'total' }, r.played ? fmtPoints(r.total) : '–'),
        ))),
      )),
      needsScaling(t) ? h('p', { class: 'note' }, 'Hi havia taules de mides diferents: els punts de cada taula es van passar al que serien en una taula de 5.') : null,
    ) : null,
    list.length ? section('Diplomes', null,
      h('ul', { class: 'diplomas' }, list.map(a => h('li', null,
        h('div', { class: 'dtitle' }, h('b', null, a.title), h('small', null, a.detail)),
        h('div', { class: 'dwho' }, h('span', null, joinNames(a.names)), h('small', null, fmtAward(a))),
      ))),
    ) : null,
    p.received ? h('div', { class: 'actions center' },
      h('button', { class: 'btn', type: 'button', onclick: () => shareText(standingsMessage(t, rows)) }, 'Comparteix la classificació')) : null,
  );
}

/** Enllaç d'invitació (#t=) del mode torneig anterior: ja no es pot jugar així. */
function renderOldInvite() {
  const leave = () => { clearHash(); go(state.game ? 'game' : 'setup'); };
  return h('div', null,
    masthead(),
    section('Enllaç d’un torneig antic', null,
      h('p', { class: 'lede' }, 'Aquest enllaç és d’una taula d’un torneig fet amb la versió anterior de l’app. Ara els tornejos funcionen d’una altra manera: demana a qui l’organitza l’enllaç nou de la teva taula.'),
      h('button', { class: 'btn block', type: 'button', onclick: leave }, state.game ? 'Torna a la partida' : 'Ves a l’inici'),
    ),
  );
}

/** Per a qui rep l'enllaç al navegador en lloc de l'app: enganxar-lo aquí per desar la partida. */
function pasteLink() {
  return h('button', { class: 'paste-link', type: 'button', onclick: openPasteDialog }, 'T\'han enviat una partida?');
}

function openPasteDialog() {
  const field = h('textarea', {
    class: 'paste', rows: 3, autofocus: true, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    placeholder: 'Enganxa aquí el missatge o l\'enllaç',
    'aria-label': 'Enllaç de la partida',
  });
  const error = h('p', { class: 'error', role: 'alert', hidden: true });
  const dialog = h('dialog', { class: 'game-dialog', 'aria-labelledby': 'paste-dialog-title' },
    h('h2', { id: 'paste-dialog-title' }, 'T\'han enviat una partida?'),
    field,
    error,
    h('div', { class: 'game-dialog-actions' },
      h('button', { class: 'btn outline', type: 'button', onclick: () => dialog.close() }, 'Deixa-ho estar'),
      h('button', { class: 'btn', type: 'button', onclick: () => openPasted(field.value, dialog, error) }, 'Obre l\'enllaç')),
  );
  showDialog(dialog, () => {
    const pasted = window.prompt('Enganxa aquí el missatge o l\'enllaç:');
    if (pasted !== null) openPasted(pasted, null, null);
  });
}

function openPasted(text, dialog, error) {
  const server = text.match(/\/shared\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/i);
  const read = server ? null : decodeShared(text);
  if (read && !read.ok) {
    if (error) {
      error.textContent = SHARE_ERROR_TEXT[read.error] ?? SHARE_ERROR_TEXT['bad-link'];
      error.hidden = false;
    } else toast(SHARE_ERROR_TEXT[read.error] ?? SHARE_ERROR_TEXT['bad-link']);
    return;
  }
  dialog?.close();
  if (server) go('serverShared', { serverSharedId: server[1] });
  else { readLink(text); go('shared'); }
}

/** Una partida compartida de dalt a baix; a l'historial els detalls tenen pestanya pròpia. */
function gameReport(g, lead, onEdit, showDetails = true) {
  const rows = standings(g.players, g.rounds);
  const winners = rows.filter(r => r.rank === 1).map(r => r.name);
  return [
    h('section', { class: 'winner' },
      h('p', { class: 'lead' }, lead),
      h('p', { class: 'name' }, winners.join(' i ')),
      h('p', { class: 'sub' }, `${rows[0].total} punts. ${winners.length > 1 ? 'Empat al capdavant.' : ''}`),
    ),
    section('Com va quedar', 'menys punts guanya',
      h('ol', { class: 'ledger' }, rows.map(r => h('li', { class: r.rank === 1 ? 'first' : null },
        h('span', { class: 'pos' }, `${r.rank}.`),
        h('span', { class: 'who' }, dot(r.index, 18), h('span', null, r.name)),
        h('span', { class: 'score' }, r.total),
      ))),
    ),
    showDetails ? section('Com va anar', 'acumulat, menys és millor', renderChart(g.players, g.rounds), legend(g.players)) : null,
    showDetails ? roundsSection(g, onEdit) : null,
  ];
}

function renderDetail() {
  const g = state.games.find(x => x.id === state.viewing);
  if (!g) return renderHistory();
  return h('div', null,
    masthead(null, gameNavigation(g, true, true), undefined,
      h('button', { class: 'crumb', type: 'button', onclick: () => go('history') }, '← Torna a l’historial')),
    state.gameTab === 'rounds'
      ? [
        roundsSection(g, ri => startEdit(g.id, ri, 'detail', 'rounds')),
        section('Com va anar', 'acumulat, menys és millor', renderChart(g.players, g.rounds), legend(g.players)),
      ]
      : gameReport(g, `${fmtDate(g.endedAt)}, ${fmtRounds(g.rounds.length)}`, null, false),
    h('div', { class: 'actions center' },
      shareButton(g),
      h('button', { class: 'btn quiet danger', type: 'button', onclick: () => deleteHistoryGame(g) }, 'Esborra de l’historial'),
    ),
  );
}

// ---------- Arreglar una ronda ----------
const editTarget = (st) => (st.edit?.gameId ? st.games.find(x => x.id === st.edit.gameId) : st.game);

function startEdit(gameId, round, back, backTab = 'overview') {
  const g = gameId ? state.games.find(x => x.id === gameId) : state.game;
  const r = g.rounds[round];
  go('edit', { edit: { gameId, round, back, backTab, draft: { papayoo: r.papayoo, points: r.points.slice() } } });
}

function leaveEdit() {
  const back = state.edit?.back ?? 'game';
  const gameTab = state.edit?.backTab ?? 'overview';
  go(back, { edit: null, gameTab });
}

function renderEdit() {
  const e = state.edit;
  const g = e && editTarget(state);
  if (!g || !g.rounds[e.round]) { state.screen = state.game ? 'game' : 'setup'; state.edit = null; return (state.game ? renderGame : renderSetup)(); }
  const original = g.rounds[e.round];
  const changed = e.draft.papayoo !== original.papayoo || e.draft.points.some((p, i) => p !== original.points[i]);
  const canLeave = () => !changed || confirm('Vols deixar-ho estar? Els canvis d\'aquesta ronda no es desaran.');
  const cancel = () => {
    if (!canLeave()) return;
    leaveEdit();
  };
  const navigate = tab => {
    if (tab === 'points' || !canLeave()) return;
    go(e.gameId ? 'detail' : 'game', { edit: null, gameTab: tab, ...(e.gameId ? { viewing: g.id } : {}) });
  };
  const finished = Boolean(e.gameId) || (g.roundsPlanned !== null && g.rounds.length >= g.roundsPlanned);

  return h('div', null,
    masthead(null, gameNavigation(g, Boolean(e.gameId), finished, { editing: true, onNavigate: navigate }),
      () => { if (canLeave()) go('setup', { edit: null }); }),
    renderRoundEntry(g, {
      pick: st => st.edit.draft,
      title: [h('span', null, `Edita la ronda ${e.round + 1}`), h('button', { class: 'crumb', type: 'button', onclick: cancel }, '← Torna')],
      note: 'Canvia el que estigui malament. Si treus punts a algú, toca la × d\'un altre jugador perquè es quedi la resta.',
      submitLabel: 'Desa els canvis',
      onSubmit: (round) => {
        setState(st => { editTarget(st).rounds[st.edit.round] = round; });
        leaveEdit();
        toast(`Ronda ${e.round + 1} arreglada`);
      },
      extra: h('div', { class: 'actions center' },
        h('button', { class: 'btn quiet', type: 'button', onclick: cancel }, 'Deixa-ho estar'),
        // Com l'antic «Desfés l'última ronda»: per si s'ha desat una ronda que no tocava.
        !e.gameId && e.round === g.rounds.length - 1 ? h('button', {
          class: 'btn quiet danger', type: 'button',
          onclick: async () => {
            const confirmed = await confirmGameAction({
              title: `Esborrar la ronda ${e.round + 1}?`,
              message: 'Se’n treuen tots els punts, com si no s’hagués jugat.',
              action: 'Esborra la ronda', danger: true,
            });
            if (!confirmed || state.edit !== e) return;
            setState(st => { st.game.rounds.pop(); });
            go('game', { edit: null, gameTab: 'overview' });
            toast(`Ronda ${e.round + 1} esborrada`);
          },
        }, 'Esborra aquesta ronda') : null),
    }),
  );
}

// ---------- Partida rebuda per un enllaç ----------
function renderShared() {
  const back = h('button', { class: 'crumb', type: 'button', onclick: leaveShared }, state.game ? 'Torna a la partida' : 'Inici');

  if (incomingError) {
    return h('div', null,
      masthead(back),
      section('No s\'ha pogut obrir la partida', null,
        h('p', { class: 'lede' }, SHARE_ERROR_TEXT[incomingError] ?? SHARE_ERROR_TEXT['bad-link']),
        h('button', { class: 'btn block', type: 'button', onclick: leaveShared }, state.game ? 'Torna a la partida' : 'Ves a l\'inici'),
      ),
    );
  }
  const g = incoming;
  if (!g) return renderSetup();
  return h('div', null,
    masthead(back),
    h('p', { class: 'received' }, g.tour
      ? `Resultat de la taula ${g.tour.table + 1} (partida ${g.tour.game + 1}) d’un torneig de la versió anterior`
      : 'T\'han enviat aquesta partida'),
    gameReport(g, `${fmtDate(g.endedAt)}, ${fmtRounds(g.rounds.length)}`),
    h('div', { class: 'actions center' }, receivedActions(g)),
  );
}

/** Desar una partida rebuda, o posar-ne al dia la còpia si qui l'envia hi ha arreglat o afegit rondes. */
function receivedActions(g) {
  if (!localStorageAvailable) return null;
  const copy = state.games.find(x => gameKey(x) === gameKey(g));
  if (!copy) return h('button', { class: 'btn', type: 'button', onclick: () => saveIncoming(g) }, 'Desa-la a les meves partides');
  if (JSON.stringify(copy.rounds) === JSON.stringify(g.rounds)) return h('p', { class: 'note' }, 'Aquesta partida ja la tens desada.');
  return h('button', {
    class: 'btn', type: 'button',
    onclick: () => {
      setState(st => {
        const saved = st.games.find(x => x.id === copy.id);
        saved.rounds = g.rounds.map(r => ({ papayoo: r.papayoo, points: r.points.slice() }));
        saved.endedAt = g.endedAt;
      });
      toast('Còpia actualitzada');
    },
  }, 'Actualitza la meva còpia');
}

async function loadServerShared(id) {
  serverSharedId = id;
  serverSharedGame = null;
  serverSharedError = null;
  serverSharedLoading = true;
  if (state.screen === 'serverShared') render();
  try {
    const body = await api(`/api/v1/shared-games/${encodeURIComponent(id)}`, { cache: 'no-store' });
    const game = normalizeSharedGame(body?.game);
    if (!game) throw new Error('Les dades de la partida no són vàlides.');
    if (serverSharedId === id) serverSharedGame = game;
  } catch (err) {
    if (serverSharedId === id) {
      serverSharedError = err.offline ? 'No hi ha connexió. Comprova-la i torna-ho a provar.' : err.message;
    }
  } finally {
    if (serverSharedId === id) {
      serverSharedLoading = false;
      if (state.screen === 'serverShared') render();
    }
  }
}

function serverSharedNavigation(g) {
  const tabs = [['overview', 'Com ha anat'], ['rounds', 'Ronda a ronda']];
  return h('nav', { class: 'main-tabs game-tabs', 'aria-label': 'Seccions de la partida' },
    ...tabs.map(([tab, label]) => h('a', {
      href: `/shared/${encodeURIComponent(serverSharedId)}${tab === 'rounds' ? '/rounds' : ''}`,
      'aria-current': serverSharedTab === tab ? 'page' : null,
      onclick: event => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        go('serverShared', { serverSharedId, serverSharedTab: tab });
      },
    }, label)),
  );
}

function renderServerShared() {
  const g = serverSharedGame;
  const home = h('button', { class: 'crumb', type: 'button', onclick: () => go(state.game ? 'game' : 'setup') },
    state.game ? '← Torna a la partida' : '← Inici');
  if (serverSharedLoading || !g) return h('div', null,
    masthead(null, undefined, undefined, home),
    section(serverSharedLoading ? 'Carregant la partida…' : 'No s’ha pogut obrir la partida', null,
      serverSharedError ? h('p', { class: 'lede' }, serverSharedError) : null,
      !serverSharedLoading ? h('button', { class: 'btn', type: 'button', onclick: () => loadServerShared(serverSharedId) }, 'Torna-ho a provar') : null),
  );
  return h('div', null,
    masthead(null, serverSharedNavigation(g), undefined, home),
    h('p', { class: 'received' }, 'T’han enviat aquesta partida'),
    serverSharedTab === 'rounds'
      ? [roundsSection(g), section('Com va anar', 'acumulat, menys és millor', renderChart(g.players, g.rounds), legend(g.players))]
      : gameReport(g, `${fmtDate(g.endedAt)}, ${fmtRounds(g.rounds.length)}`, null, false),
    h('div', { class: 'actions center' }, receivedActions(g)),
  );
}

// ---------- Arrencada ----------
function screenFromPath() {
  const shared = location.pathname.match(/^\/shared\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:\/(rounds))?$/i);
  if (shared) {
    serverSharedTab = shared[2] || 'overview';
    if (serverSharedId !== shared[1] || (!serverSharedGame && !serverSharedLoading)) loadServerShared(shared[1]);
    return 'serverShared';
  }
  if (location.pathname === '/history') {
    const raw = new URLSearchParams(location.search).get('page');
    const requested = raw && /^[1-9]\d*$/.test(raw) ? Number(raw) : 1;
    state.historyPage = Math.min(requested, Math.max(1, Math.ceil(state.games.length / HISTORY_PAGE_SIZE)));
    const canonical = `/history${state.historyPage > 1 ? `?page=${state.historyPage}` : ''}`;
    if (`${location.pathname}${location.search}` !== canonical) history.replaceState(null, '', canonical);
    return 'history';
  }
  if (location.pathname === '/game') {
    if (state.game) {
      state.gameTab = 'overview';
      history.replaceState(null, '', gamePath(state.game.id));
      return 'game';
    }
    history.replaceState(null, '', '/');
    return 'setup';
  }
  if (location.pathname === '/game/edit') {
    history.replaceState(null, '', state.game ? `/game/${encodeURIComponent(state.game.id)}/edit` : '/');
    return screenFromPath();
  }
  const legacy = location.pathname.match(/^\/history\/([^/]+)(?:\/(edit))?$/);
  if (legacy) {
    let id;
    try { id = decodeURIComponent(legacy[1]); } catch { id = null; }
    history.replaceState(null, '', id && state.games.some(g => g.id === id)
      ? `/game/${encodeURIComponent(id)}${legacy[2] ? '/edit' : ''}` : '/history');
    return screenFromPath();
  }
  const route = location.pathname.match(/^\/game\/([^/]+)(?:\/(points|rounds|edit))?$/);
  if (route) {
    let id;
    try { id = decodeURIComponent(route[1]); } catch { id = null; }
    const active = state.game?.id === id;
    const archived = state.games.find(g => g.id === id);
    if (active || archived) {
      const part = route[2];
      if (part === 'edit') {
        if (state.edit && (state.edit.gameId || state.game?.id) === id) {
          state.viewing = archived ? id : null;
          return 'edit';
        }
        history.replaceState(null, '', gamePath(id));
        return screenFromPath();
      }
      const gameTab = part || 'overview';
      if ((gameTab === 'points' && (archived || (active && state.game.roundsPlanned !== null && state.game.rounds.length >= state.game.roundsPlanned)))
        || (gameTab === 'rounds' && !(active ? state.game.rounds.length : archived.rounds.length))) {
        history.replaceState(null, '', gamePath(id));
        return screenFromPath();
      }
      state.gameTab = gameTab;
      state.viewing = archived ? id : null;
      return archived ? 'detail' : 'game';
    }
    history.replaceState(null, '', '/history');
    return 'history';
  }
  return null;
}

{
  const screen = readHash();
  if (screen) state.screen = screen;
  else {
    // L'app instal·lada sempre s'obre a «/»: si s'havia tancat enmig d'una partida o d'una correcció, s'hi torna.
    if (location.pathname === '/' && !location.search) {
      const editing = state.edit && (state.edit.gameId ? state.games.some(g => g.id === state.edit.gameId) : state.game);
      if (state.screen === 'edit' && editing) {
        history.replaceState(null, '', `/game/${encodeURIComponent(state.edit.gameId || state.game.id)}/edit`);
      } else if (state.screen === 'game' && state.game) {
        history.replaceState(null, '', gamePath(state.game.id, state.gameTab));
      }
    }
    state.screen = screenFromPath() || 'setup';
  }
}
render();

window.addEventListener('popstate', () => {
  const screen = readHash();
  state.screen = screen || screenFromPath() || 'setup';
  save();
  render();
});

// Si toquen un altre enllaç amb l'app oberta, l'adreça canvia sense recarregar.
window.addEventListener('hashchange', () => {
  const screen = readHash();
  if (screen) go(screen);
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
