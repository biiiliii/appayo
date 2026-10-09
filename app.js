import {
  TOTAL, PAPAYOO_POINTS, MIN_PLAYERS, MAX_PLAYERS,
  resolveRound, clampPoints, standings, validateSetup, createGame, normalizeNames,
} from './logic.js';
import { renderChart, seriesColor } from './chart.js';
import { symbolEl } from './symbols.js';
import { decodeShared, shareLink, shareMessage, gameKey } from './share.js';
import {
  MAX_TOURNAMENT_PLAYERS, tableSizes, makeSchedule, countRepeats, parseNames, validateTournament, createTournament,
  tableNames, decodeInvite, inviteLink, inviteMessage, resultMessage, tableResult, acceptResult, resultKey,
  progress, needsScaling, tournamentStandings, awards, fmtAward, standingsMessage, fmtPoints, joinNames,
  tournamentTitle, tableLabel,
} from './tournament.js';

const STORAGE_KEY = 'appayo:v1';
const root = document.getElementById('app');

const ERROR_TEXT = {
  'papayoo-missing': 'Cal dir qui s\'ha endut el Papayoo.',
  'over-total': `La suma passa de ${TOTAL}.`,
  'sum-mismatch': `La suma ha de ser exactament ${TOTAL}.`,
  'negative': 'No hi pot haver punts negatius.',
  'too-few': `Calen com a mínim ${MIN_PLAYERS} jugadors.`,
  'too-many': `Com a màxim ${MAX_PLAYERS} jugadors.`,
  'duplicate-name': 'Hi ha dos jugadors amb el mateix nom.',
};

const SHARE_ERROR_TEXT = {
  'bad-link': 'L\'enllaç no és sencer. Sovint es talla en copiar-lo: demana que te\'l tornin a enviar i obre\'l tocant-hi a sobre.',
  'bad-version': 'L\'enllaç ve d\'una versió més nova de l\'Appayo. Torna a carregar la pàgina i prova-ho un altre cop.',
  'bad-data': 'Els punts d\'aquesta partida no quadren, així que no es pot mostrar.',
};

// ---------- Estat ----------
const state = Object.assign({
  screen: 'setup',
  setup: { names: ['', '', ''], roundsPlanned: 'players' },
  game: null,
  draft: null,
  games: [],      // partides acabades, la més recent primer
  viewing: null,  // id de la partida de l'historial que s'està mirant
  edit: null,     // ronda que s'està arreglant: { gameId (null = la partida en curs), round, draft, back }
  tsetup: { name: '', text: '', games: 3, rounds: 5, draw: null }, // torneig a punt de començar
  tournaments: [], // tornejos que organitza aquest mòbil, el més recent primer
  tid: null,       // torneig obert
  tview: null,     // resultat d'una taula que s'està mirant: { game, table }
}, load() ?? {});

// Partida rebuda per un enllaç: només viu mentre es mira, no es desa fins que es diu.
let incoming = null;
let incomingError = null;
let pasting = false;
let pasteError = null;
let pasteText = '';
// Invitació d'una taula del torneig rebuda per un enllaç (#t=...).
let invite = null;
let inviteError = null;

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
    st.games.unshift({ ...g, id: `${g.createdAt}-${Math.random().toString(36).slice(2, 7)}`, endedAt: Date.now() });
    st.games = st.games.slice(0, 100);
  }
  // Les d'un torneig no canvien els noms de l'inici: són els de la taula que ha tocat.
  if (g && !g.tour) { st.setup.names = g.players.slice(); st.setup.roundsPlanned = g.roundsPlanned; }
  st.game = null;
  st.draft = null;
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

function shareGame(g) {
  const snapshot = { players: g.players, rounds: g.rounds, createdAt: g.createdAt, endedAt: g.endedAt ?? Date.now(), tour: g.tour };
  const link = shareLink(snapshot, location.href);
  shareText(g.tour ? resultMessage(snapshot, link) : shareMessage(snapshot, link));
}

/** El menú de compartir del mòbil (WhatsApp...), o copiar el text si no n'hi ha. */
function shareText(text) {
  if (navigator.share) {
    // Si tanquen el menú de compartir no cal dir-los res.
    navigator.share({ text }).catch(() => {});
    return;
  }
  const copied = navigator.clipboard?.writeText(text);
  if (copied) copied.then(() => toast('Enllaç copiat'), () => toast('No s\'ha pogut copiar l\'enllaç'));
  else toast('Aquest navegador no pot compartir la partida');
}

const shareButton = (g) => (g.tour
  ? h('button', { class: 'btn', type: 'button', onclick: () => shareGame(g) }, 'Envia el resultat a l\'organitzador')
  : h('button', { class: 'btn outline', type: 'button', onclick: () => shareGame(g) }, 'Comparteix la partida'));

/** Llegeix una partida (#p=...) o una invitació de torneig (#t=...) de l'adreça. Retorna la pantalla, o null. */
function readHash() {
  return readLink(location.hash);
}
function readLink(text) {
  if (/[#&?]t=/.test(text)) {
    const read = decodeInvite(text);
    invite = read.ok ? read.invite : null;
    inviteError = read.ok ? null : read.error;
    return 'invite';
  }
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
    st.screen = 'detail';
  });
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
    setup: renderSetup, game: renderGame, history: renderHistory, detail: renderDetail, shared: renderShared, edit: renderEdit,
    tsetup: renderTSetup, tdraw: renderTDraw, tournament: renderTournament, tstandings: renderTStandings, tresult: renderTResult, invite: renderInvite,
  };
  const fn = (state.screen === 'game' && !state.game) ? renderSetup : (screens[state.screen] || renderSetup);
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
function go(screen, extra) {
  setState(st => { st.screen = screen; Object.assign(st, extra || {}); });
  window.scrollTo(0, 0);
}

function masthead(context) {
  return h('header', { class: 'masthead' },
    h('h1', { class: 'wordmark' }, h('button', { type: 'button', onclick: () => go(state.game ? 'game' : 'setup') }, 'Appayo')),
    h('div', { class: 'context' }, context),
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

  const roundOptions = ['players', 3, 4, 5, 6, 8, 10, null];
  const roundLabel = (n) => n === 'players' ? `Tantes com jugadors (${s.names.length})` : n === null ? 'Sense límit' : n;
  const rounds = h('div', { class: 'choices' }, roundOptions.map(n => h('button', {
    class: 'choice', type: 'button', 'aria-pressed': String(s.roundsPlanned === n),
    onclick: () => setState(st => { st.setup.roundsPlanned = n; }),
  }, roundLabel(n))));

  const resume = state.game ? section('Partida en curs', null,
    h('p', { class: 'lede' }, `${state.game.players.join(', ')}. ${state.game.rounds.length === 1 ? 'Una ronda jugada' : `${state.game.rounds.length} rondes jugades`}.`),
    h('button', { class: 'btn block', type: 'button', onclick: () => go('game') }, 'Continua la partida'),
  ) : null;

  return h('div', null,
    masthead(h('button', { class: 'crumb', type: 'button', onclick: () => go('history') },
      state.games.length ? `Partides anteriors (${state.games.length})` : 'Partides anteriors')),
    resume,
    section('Qui juga?', `de ${MIN_PLAYERS} a ${MAX_PLAYERS}`,
      h('p', { class: 'lede' }, 'Escriu els noms si vols. Si no, seran Jugador 1, 2, 3...'),
      roster,
      h('div', { class: 'actions end' },
        h('button', {
          class: 'btn outline small', type: 'button', disabled: s.names.length >= MAX_PLAYERS,
          onclick: () => setState(st => { st.setup.names.push(''); }),
        }, 'Afegeix un jugador'),
      ),
    ),
    section('Quantes rondes?', null,
      rounds,
      h('p', { class: 'note' }, 'Normalment es juga una ronda per jugador. En acabar sempre en podreu afegir més.'),
    ),
    h('section', { class: 'section' },
      errorBox,
      h('button', {
        class: 'btn block', type: 'button',
        onclick: () => {
          const errors = validateSetup(s.names);
          if (errors.length) { errorBox.textContent = ERROR_TEXT[errors[0]]; errorBox.hidden = false; return; }
          if (state.game && state.game.rounds.length
              && !confirm('Hi ha una partida en curs. Es desarà a l\'historial i en començarà una de nova.')) return;
          setState(st => {
            if (st.game) archiveCurrentGame(st);
            st.game = createGame(s.names, s.roundsPlanned);
            st.draft = emptyDraft(st.game.players.length);
            st.screen = 'game';
          });
          window.scrollTo(0, 0);
        },
      }, state.game ? 'Comença una altra partida' : 'Comença la partida'),
    ),
    renderTournamentList(),
  );
}

// ---------- Partida ----------
function renderGame() {
  const g = state.game;
  const n = g.players.length;
  if (!state.draft || state.draft.points.length !== n) state.draft = emptyDraft(n);
  const roundNo = g.rounds.length + 1;
  const finished = g.roundsPlanned !== null && g.rounds.length >= g.roundsPlanned;
  const context = finished
    ? 'Partida acabada'
    : g.roundsPlanned ? h('span', null, 'Ronda ', h('b', null, roundNo), ` de ${g.roundsPlanned}`) : h('span', null, 'Ronda ', h('b', null, roundNo));

  return h('div', null,
    masthead(context),
    g.tour ? tourBanner(g.tour) : null,
    finished ? renderWinner(g) : null,
    renderStandings(g, finished),
    finished ? null : newRoundEntry(g),
    g.rounds.length >= 1 ? section('Com ha anat', 'acumulat, menys és millor', renderChart(g.players, g.rounds), legend(g.players)) : null,
    g.rounds.length ? section('Ronda a ronda', null, renderRoundsTable(g, ri => startEdit(null, ri, 'game'))) : null,
    h('div', { class: 'actions center' },
      finished && g.tour ? tourGameActions(g) : null,
      finished && !g.tour ? h('button', { class: 'btn outline', type: 'button', onclick: () => setState(st => { st.game.roundsPlanned += 1; }) }, 'Juga una ronda més') : null,
      finished ? h('button', { class: g.tour ? 'btn outline' : 'btn', type: 'button', onclick: () => { setState(archiveCurrentGame); go('setup'); } }, 'Desa la partida a l\'historial') : null,
      finished && !g.tour ? shareButton(g) : null,
      g.rounds.length ? h('button', {
        class: 'btn quiet', type: 'button',
        onclick: () => {
          if (!confirm(`Vols desfer la ronda ${g.rounds.length}? Els seus punts tornaran al formulari.`)) return;
          setState(st => {
            const last = st.game.rounds.pop();
            st.draft = { papayoo: last.papayoo, points: last.points.slice() };
          });
        },
      }, 'Desfés l\'última ronda') : null,
      finished ? null : h('button', {
        class: 'btn quiet', type: 'button',
        onclick: () => {
          if (g.rounds.length && !confirm('Vols acabar aquí? La partida es desarà a l\'historial tal com està.')) return;
          setState(archiveCurrentGame);
          go('setup');
        },
      }, g.rounds.length ? 'Acaba la partida' : 'Cancel·la la partida'),
    ),
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
  return section(finished ? 'Com ha quedat' : 'Com anem?', g.rounds.length ? 'menys punts guanya' : null,
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
  // Els que no s'han tocat mostren el que els toca: la resta, o 0 si ja estan repartits els 250.
  const displayValue = (i) => (d.points[i] !== null ? d.points[i] : res.points[i]);
  const bump = (i, delta) => setPoints(i, clampPoints((displayValue(i) ?? 0) + delta));

  const holder = h('div', { class: 'holder', role: 'group', 'aria-label': 'Qui té el Papayoo' },
    g.players.map((name, i) => h('button', {
      type: 'button', 'aria-pressed': String(d.papayoo === i),
      onclick: () => setState(st => { pick(st).papayoo = i; }),
    }, pcard(), name)),
  );

  const rows = g.players.map((name, i) => {
    const isPap = d.papayoo === i;
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
          placeholder: '0',
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
      h('div', { class: 'quick' }, [-10, -5, 5, 10].map(delta => h('button', {
        type: 'button', 'aria-label': `${delta > 0 ? 'Suma' : 'Resta'} ${Math.abs(delta)} a ${name}`,
        disabled: value !== null && (delta < 0 ? value + delta < min : value + delta > max),
        onclick: () => bump(i, delta),
      }, `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`))),
    );
  });

  const sumEntered = res.valid ? TOTAL : d.points.reduce((a, p) => a + (p ?? 0), 0);
  let stateText, stateClass = '';
  if (res.valid) { stateText = 'Tot quadra'; stateClass = 'ok'; }
  else if (res.remaining < 0) { stateText = `Sobren ${-res.remaining} punts`; stateClass = 'bad'; }
  else if (missing > 1) stateText = `Queden ${res.remaining} punts per a ${missing} jugadors`;
  else stateText = `Queden ${res.remaining} punts`;
  const firstError = res.errors.find(e => e !== 'papayoo-missing') ?? (missing <= 1 ? res.errors[0] : null);

  return h('section', { class: 'section', id: 'round-entry' },
    h('h2', { class: 'section-title' }, title),
    note ? h('p', { class: 'note edit-note' }, note) : null,
    h('p', { class: 'lede' }, 'Qui s\'ha endut el Papayoo?'),
    holder,
    d.papayoo === null ? h('p', { class: 'note' }, `Sempre se l'endú algú. Només és per recordar-ho: els seus ${PAPAYOO_POINTS} punts ja van dins del total del jugador.`) : null,
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
        onSubmit({ papayoo: draft.papayoo, points: final.points.slice() });
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
    onSubmit: (round) => setState(st => {
      st.game.rounds.push(round);
      st.draft = emptyDraft(n);
    }),
  });
}

function legend(players) {
  return h('ul', { class: 'legend' }, players.map((p, i) => h('li', null, dot(i), p)));
}

/** @param onEdit  si hi és, tocar una ronda l'obre per arreglar-la */
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
          r.points.map((p, i) => h('td', { class: r.papayoo === i ? 'pap' : null }, p)),
        ))),
        h('tfoot', null, h('tr', null, h('td', null, 'Total'), tot.map(t => h('td', null, t)))),
      ),
    ),
    h('p', { class: 'note legend-note' }, pcard(), 'En color: qui tenia el Papayoo aquella ronda.'),
    onEdit ? h('p', { class: 'note' }, 'Si hi ha algun error, toca la ronda per arreglar-la.') : null,
  );
}

// ---------- Partides anteriors ----------
function renderHistory() {
  const list = state.games.length
    ? h('ul', { class: 'games' }, state.games.map(g => {
      const rows = standings(g.players, g.rounds);
      const winners = rows.filter(r => r.rank === 1).map(r => r.name);
      return h('li', null, h('button', { type: 'button', onclick: () => go('detail', { viewing: g.id }) },
        h('span', { class: 'when' }, `${fmtDate(g.endedAt)}, ${g.rounds.length} ${g.rounds.length === 1 ? 'ronda' : 'rondes'}`),
        h('span', { class: 'who' }, g.players.join(', ')),
        h('span', { class: 'won' }, winners.join(' i '), h('small', null, `${rows[0].total} punts`)),
      ));
    }))
    : h('p', { class: 'empty' }, 'Encara no hi ha cap partida acabada. Quan n\'acabeu una, la trobareu aquí.');

  return h('div', null,
    masthead(h('button', { class: 'crumb', type: 'button', onclick: () => go(state.game ? 'game' : 'setup') }, state.game ? 'Torna a la partida' : 'Inici')),
    section('Partides anteriors', state.games.length ? `${state.games.length}` : null, list,
      state.games.length ? h('div', { class: 'actions end' }, h('button', {
        class: 'btn quiet danger', type: 'button',
        onclick: () => {
          if (!confirm(`Vols esborrar ${state.games.length === 1 ? 'la partida' : `les ${state.games.length} partides`} de l'historial? Només s'esborren d'aquest mòbil, i no es poden recuperar.`)) return;
          setState(st => { st.games = []; st.viewing = null; });
          toast('Historial esborrat');
        },
      }, 'Esborra tot l\'historial')) : null,
      state.games.length ? h('p', { class: 'note' }, 'Per esborrar-ne només una, obre-la i baixa fins al final.') : null,
    ),
    section('T\'han enviat una partida?', null, renderPaste()),
  );
}

/** Per a qui rep l'enllaç i no se li obre l'app (als iPhone passa): copiar-lo i enganxar-lo aquí. */
function renderPaste(note = 'Copia el missatge o l\'enllaç del WhatsApp i enganxa\'l aquí per veure la partida.') {
  if (!pasting) {
    return h('div', null,
      h('button', {
        class: 'btn outline block', type: 'button',
        onclick: () => { pasting = true; pasteError = null; render(); },
      }, 'Enganxa l\'enllaç que t\'han enviat'),
      h('p', { class: 'note' }, note),
    );
  }
  return h('div', null,
    h('textarea', {
      class: 'paste', id: 'paste-field', rows: 3, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      placeholder: 'Enganxa aquí el missatge o l\'enllaç',
      'aria-label': 'Enllaç de la partida',
      oninput: (e) => { pasteText = e.target.value; },
    }, pasteText),
    pasteError ? h('p', { class: 'error' }, SHARE_ERROR_TEXT[pasteError] ?? SHARE_ERROR_TEXT['bad-link']) : null,
    h('div', { class: 'actions end' },
      h('button', {
        class: 'btn quiet', type: 'button',
        onclick: () => { pasting = false; pasteError = null; pasteText = ''; render(); },
      }, 'Deixa-ho estar'),
      h('button', { class: 'btn', type: 'button', onclick: openPasted }, 'Obre l\'enllaç'),
    ),
  );
}

function openPasted() {
  const isInvite = /[#&?]t=/.test(pasteText);
  const read = isInvite ? decodeInvite(pasteText) : decodeShared(pasteText);
  if (!read.ok) { pasteError = read.error; render(); return; }
  readLink(pasteText);
  pasting = false;
  pasteError = null;
  pasteText = '';
  go(isInvite ? 'invite' : 'shared');
}

/** Una partida acabada de dalt a baix: guanyador, classificació, gràfica i taula. */
function gameReport(g, lead, onEdit) {
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
    section('Com va anar', 'acumulat, menys és millor', renderChart(g.players, g.rounds), legend(g.players)),
    section('Ronda a ronda', null, renderRoundsTable(g, onEdit)),
  ];
}

function renderDetail() {
  const g = state.games.find(x => x.id === state.viewing);
  if (!g) return renderHistory();
  return h('div', null,
    masthead(h('button', { class: 'crumb', type: 'button', onclick: () => go('history') }, 'Partides anteriors')),
    g.tour ? tourBanner(g.tour) : null,
    gameReport(g, `${fmtDate(g.endedAt)}, ${fmtRounds(g.rounds.length)}`, ri => startEdit(g.id, ri, 'detail')),
    h('div', { class: 'actions center' },
      g.tour ? tourGameActions(g) : shareButton(g),
      h('button', {
        class: 'btn quiet danger', type: 'button',
        onclick: () => {
          if (!confirm('Vols esborrar aquesta partida? Només s\'esborra d\'aquest mòbil.')) return;
          setState(st => { st.games = st.games.filter(x => x.id !== g.id); st.viewing = null; });
          go('history');
        },
      }, 'Esborra aquesta partida'),
    ),
  );
}

// ---------- Arreglar una ronda ----------
const editTarget = (st) => (st.edit?.gameId ? st.games.find(x => x.id === st.edit.gameId) : st.game);

function startEdit(gameId, round, back) {
  const g = gameId ? state.games.find(x => x.id === gameId) : state.game;
  const r = g.rounds[round];
  go('edit', { edit: { gameId, round, back, draft: { papayoo: r.papayoo, points: r.points.slice() } } });
}

function leaveEdit() {
  const back = state.edit?.back ?? 'game';
  go(back, { edit: null });
}

function renderEdit() {
  const e = state.edit;
  const g = e && editTarget(state);
  if (!g || !g.rounds[e.round]) { state.screen = state.game ? 'game' : 'setup'; state.edit = null; return (state.game ? renderGame : renderSetup)(); }
  const original = g.rounds[e.round];
  const changed = e.draft.papayoo !== original.papayoo || e.draft.points.some((p, i) => p !== original.points[i]);
  const cancel = () => {
    if (changed && !confirm('Vols deixar-ho estar? Els canvis d\'aquesta ronda no es desaran.')) return;
    leaveEdit();
  };

  return h('div', null,
    masthead(h('button', { class: 'crumb', type: 'button', onclick: cancel }, e.gameId ? 'Torna a la partida desada' : 'Torna a la partida')),
    renderRoundEntry(g, {
      pick: st => st.edit.draft,
      title: `Arreglant la ronda ${e.round + 1}`,
      note: 'Canvia el que estigui malament. Si treus punts a algú, toca la × d\'un altre jugador perquè es quedi la resta.',
      submitLabel: 'Desa els canvis',
      onSubmit: (round) => {
        setState(st => { editTarget(st).rounds[st.edit.round] = round; });
        leaveEdit();
        toast(`Ronda ${e.round + 1} arreglada`);
      },
      extra: h('div', { class: 'actions center' }, h('button', { class: 'btn quiet', type: 'button', onclick: cancel }, 'Deixa-ho estar')),
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
  if (g.tour) return renderSharedResult(g, back);
  const already = state.games.some(x => gameKey(x) === gameKey(g));

  return h('div', null,
    masthead(back),
    h('p', { class: 'received' }, 'T\'han enviat aquesta partida'),
    gameReport(g, `${fmtDate(g.endedAt)}, ${fmtRounds(g.rounds.length)}`),
    h('div', { class: 'actions center' },
      already
        ? h('p', { class: 'note' }, 'Aquesta partida ja la tens desada.')
        : h('button', { class: 'btn', type: 'button', onclick: () => saveIncoming(g) }, 'Desa-la a les meves partides'),
    ),
  );
}

// ---------- Torneig ----------
const T_ERROR_TEXT = {
  'too-few': `Calen com a mínim ${MIN_PLAYERS} jugadors.`,
  'too-many': `Com a màxim ${MAX_TOURNAMENT_PLAYERS} jugadors.`,
  'name-too-long': 'Hi ha un nom molt llarg. Potser hi falta un salt de línia: cada jugador ha d\'anar en una línia.',
  'duplicate-name': 'Hi ha noms repetits',
};
const RESULT_ERROR_TEXT = {
  'other-tournament': 'Aquest resultat és d\'un altre torneig.',
  'bad-table': 'Aquesta taula no és al torneig. Potser és d\'un sorteig anterior que es va tornar a fer.',
  'other-players': 'Els jugadors d\'aquest resultat no són els que toquen a aquesta taula. Potser és d\'un sorteig anterior.',
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const findTournament = (id) => state.tournaments.find(t => t.id === id) ?? null;
const currentTournament = () => findTournament(state.tid);
const sameTable = (a, b) => a && b && a.id === b.id && a.game === b.game && a.table === b.table;
const inviteFor = (t, game, table) => ({ id: t.id, name: t.name, game, table, players: tableNames(t, game, table), rounds: t.rounds });

/** "6 taules de 5", "4 taules de 5 i 2 de 4" */
function sizesText(n) {
  const sizes = tableSizes(n);
  if (sizes.length === 1) return `una sola taula de ${n}`;
  const counts = new Map();
  for (const size of sizes) counts.set(size, (counts.get(size) ?? 0) + 1);
  const parts = [...counts].sort((a, b) => b[0] - a[0])
    .map(([size, c], i) => (i === 0 ? `${plural(c, 'taula', 'taules')} de ${size}` : `${c} de ${size}`));
  return joinNames(parts);
}

/** De quin torneig i taula és la partida que es mira. */
function tourBanner(tour) {
  return h('p', { class: 'received' }, `${tour.name || 'Torneig de Papayoo'}: ${tableLabel(tour.game, tour.table).toLowerCase()}`);
}

function renderTournamentList() {
  const list = state.tournaments.length ? h('ul', { class: 'games' }, state.tournaments.map(t => {
    const p = progress(t);
    const done = p.received === p.total;
    return h('li', null, h('button', { type: 'button', onclick: () => go('tournament', { tid: t.id }) },
      h('span', { class: 'when' }, `${fmtDate(t.createdAt)}, ${t.players.length} jugadors`),
      h('span', { class: 'who' }, tournamentTitle(t)),
      h('span', { class: 'won' }, done ? 'Acabat' : `${p.received} de ${p.total}`, h('small', null, done ? 'totes les taules' : 'taules rebudes')),
    ));
  })) : h('p', { class: 'lede' }, 'Per jugar a moltes taules alhora. L\'app fa les taules, cada taula apunta els seus punts al seu mòbil i aquí es veu la classificació de tothom.');
  return section('Tornejos', null,
    list,
    h('div', { class: 'actions' }, h('button', { class: 'btn outline block', type: 'button', onclick: () => go('tsetup') }, 'Organitza un torneig')),
  );
}

// ---- Preparar el torneig: inscrits i format ----
function renderTSetup() {
  const s = state.tsetup;
  const errorBox = h('p', { class: 'error', hidden: true });
  const count = h('p', { class: 'note', 'aria-live': 'polite' });
  const updateCount = () => {
    const n = parseNames(s.text).length;
    count.textContent = n === 0 ? 'Encara no hi ha cap nom.'
      : n < MIN_PLAYERS ? `${plural(n, 'jugador', 'jugadors')}.`
        : `${n} jugadors: ${sizesText(n)}.`;
  };
  updateCount();

  const choices = (options, current, set, label) => h('div', { class: 'choices' }, options.map(n => h('button', {
    class: 'choice', type: 'button', 'aria-pressed': String(current === n),
    onclick: () => setState(st => set(st.tsetup, n)),
  }, label ? label(n) : n)));

  const draw = () => {
    const players = parseNames(s.text);
    const errors = validateTournament(players);
    if (errors.length) {
      let message = T_ERROR_TEXT[errors[0]];
      if (errors[0] === 'duplicate-name') {
        const first = new Map();
        const dups = new Set();
        for (const p of players) { const k = p.toLowerCase(); if (first.has(k)) dups.add(first.get(k)); else first.set(k, p); }
        message = `${message}: ${joinNames([...dups])}. Afegeix-hi el cognom o una inicial.`;
      }
      errorBox.textContent = message;
      errorBox.hidden = false;
      return;
    }
    setState(st => {
      st.tsetup.draw = { players, schedule: makeSchedule(players.length, s.games), games: s.games, rounds: s.rounds, name: s.name.trim() };
      st.screen = 'tdraw';
    });
    window.scrollTo(0, 0);
  };

  return h('div', null,
    masthead(h('button', { class: 'crumb', type: 'button', onclick: () => go('setup') }, 'Inici')),
    section('Qui juga al torneig?', null,
      h('p', { class: 'lede' }, 'Escriu o enganxa els noms, un per línia. Es poden copiar d\'una llista del WhatsApp.'),
      h('textarea', {
        class: 'paste names', id: 'tnames', rows: 10, autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false',
        placeholder: 'Núria Puig\nMercè Vila\nJoan Roca\n…',
        'aria-label': 'Noms dels jugadors, un per línia',
        oninput: (e) => { s.text = e.target.value; save(); updateCount(); errorBox.hidden = true; },
      }, s.text),
      count,
    ),
    section('Nom del torneig', 'si vols',
      h('div', { class: 'field' }, h('input', {
        class: 'text', type: 'text', id: 'tname', value: s.name, maxlength: 60, autocomplete: 'off', autocapitalize: 'sentences',
        placeholder: 'Torneig de Papayoo', 'aria-label': 'Nom del torneig',
        oninput: (e) => { s.name = e.target.value; save(); },
      })),
    ),
    section('Quantes partides?', null,
      choices([1, 2, 3, 4, 5], s.games, (ts, n) => { ts.games = n; }),
      h('p', { class: 'note' }, 'A cada partida les taules canvien, perquè tothom jugui amb gent diferent.'),
    ),
    section('Quantes rondes a cada partida?', null,
      choices([3, 4, 5, 6, 8, 10], s.rounds, (ts, n) => { ts.rounds = n; }),
    ),
    h('section', { class: 'section' },
      errorBox,
      h('button', { class: 'btn block', type: 'button', onclick: draw }, 'Fes el sorteig'),
    ),
  );
}

// ---- El sorteig, abans de començar ----
function renderTDraw() {
  const d = state.tsetup.draw;
  if (!d) return renderTSetup();
  const repeats = countRepeats(d.schedule);
  const redraw = () => setState(st => { st.tsetup.draw.schedule = makeSchedule(d.players.length, d.games); });
  const start = () => {
    const t = createTournament(d);
    setState(st => {
      st.tournaments.unshift(t);
      st.tid = t.id;
      st.tsetup = { name: '', text: '', games: d.games, rounds: d.rounds, draw: null };
      st.screen = 'tournament';
    });
    window.scrollTo(0, 0);
  };
  const actions = () => h('div', { class: 'actions center' },
    h('button', { class: 'btn outline', type: 'button', onclick: redraw }, 'Torna a sortejar'),
    h('button', { class: 'btn', type: 'button', onclick: start }, 'Comença el torneig'),
  );

  return h('div', null,
    masthead(h('button', { class: 'crumb', type: 'button', onclick: () => go('tsetup') }, 'Canvia els jugadors')),
    h('section', { class: 'winner' },
      h('p', { class: 'lead' }, `${d.players.length} jugadors, ${plural(d.games, 'partida', 'partides')} de ${plural(d.rounds, 'ronda', 'rondes')}`),
      h('p', { class: 'name' }, d.name || 'Torneig de Papayoo'),
      h('p', { class: 'sub' }, repeats === 0
        ? (d.games > 1 ? 'Ningú no repeteix company de taula.' : `Es juga a ${sizesText(d.players.length)}.`)
        : `${repeats === 1 ? 'Una parella torna' : `${repeats} parelles tornen`} a coincidir a la mateixa taula. Amb tan pocs jugadors no es pot evitar del tot.`),
    ),
    actions(),
    d.schedule.map((game, gi) => section(`Partida ${gi + 1}`, null,
      h('ol', { class: 'tables' }, game.map((seats, ti) => h('li', null,
        h('div', { class: 'thead' }, h('b', null, `Taula ${ti + 1}`), h('span', { class: 'tstatus' }, `${seats.length} jugadors`)),
        h('p', { class: 'tnames' }, joinNames(seats.map(i => d.players[i]))),
      ))),
    )),
    actions(),
  );
}

// ---- El torneig en marxa (mòbil de l'organitzador) ----
function sendInvite(t, game, table) {
  shareText(inviteMessage(t, game, table, inviteLink(t, game, table, location.href)));
  setState(st => {
    const tt = findTournament(t.id);
    tt.sent = { ...(tt.sent ?? {}), [resultKey(game, table)]: true };
  });
}

function tableRow(t, gi, ti) {
  const key = resultKey(gi, ti);
  const res = t.results[key];
  let status;
  if (res) {
    const winners = standings(res.players, res.rounds).filter(r => r.rank === 1).map(r => r.name);
    const short = res.rounds.length < t.rounds ? ` (${res.rounds.length} de ${t.rounds} rondes)` : '';
    status = h('span', { class: 'tstatus ok' }, `Guanya ${joinNames(winners)}${short}`);
  } else {
    status = h('span', { class: 'tstatus' }, t.sent?.[key] ? 'Enviada, pendent' : 'Pendent');
  }
  return h('li', null,
    h('div', { class: 'thead' }, h('b', null, `Taula ${ti + 1}`), status),
    h('p', { class: 'tnames' }, joinNames(tableNames(t, gi, ti))),
    h('div', { class: 'tactions' }, res
      ? h('button', { class: 'btn outline small', type: 'button', onclick: () => go('tresult', { tview: { game: gi, table: ti } }) }, 'Mira el resultat')
      : [
        h('button', { class: t.sent?.[key] ? 'btn quiet small' : 'btn outline small', type: 'button', onclick: () => sendInvite(t, gi, ti) }, t.sent?.[key] ? 'Torna a enviar' : 'Envia a la taula'),
        h('button', { class: 'btn quiet small', type: 'button', onclick: () => startTourGame(inviteFor(t, gi, ti)) }, 'Apunta-la aquí'),
      ]),
  );
}

function renderTournament() {
  const t = currentTournament();
  if (!t) return renderSetup();
  const p = progress(t);
  const rows = tournamentStandings(t);
  const top = rows.filter(r => r.played).slice(0, 3);
  const done = p.received === p.total;

  return h('div', null,
    masthead(h('button', { class: 'crumb', type: 'button', onclick: () => go('setup') }, 'Inici')),
    h('section', { class: 'winner' },
      h('p', { class: 'lead' }, `${fmtDate(t.createdAt)}, ${t.players.length} jugadors`),
      h('p', { class: 'name' }, tournamentTitle(t)),
      h('p', { class: 'sub' }, `${plural(t.games, 'partida', 'partides')} de ${plural(t.rounds, 'ronda', 'rondes')}. ${done ? 'Han arribat tots els resultats.' : `Resultats rebuts: ${p.received} de ${p.total} taules.`}`),
    ),
    section(done ? 'Com ha quedat' : 'Com anem?', top.length ? 'menys punts guanya' : null,
      top.length
        ? [
          h('ol', { class: 'ledger' }, top.map(r => h('li', { class: r.rank === 1 ? 'first' : null },
            h('span', { class: 'pos' }, `${r.rank}.`),
            h('span', { class: 'who' }, h('span', null, r.name)),
            h('span', { class: 'score' }, fmtPoints(r.total)),
          ))),
          h('button', { class: 'btn outline block', type: 'button', onclick: () => go('tstandings') }, 'Classificació sencera i diplomes'),
        ]
        : h('p', { class: 'note' }, 'Envia l\'enllaç a cada taula. Quan arribi el primer resultat, aquí es veurà qui va davant.'),
    ),
    t.schedule.map((game, gi) => {
      const got = game.filter((_, ti) => t.results[resultKey(gi, ti)]).length;
      return section(`Partida ${gi + 1}`, `${got} de ${game.length} rebudes`,
        h('ol', { class: 'tables' }, game.map((_, ti) => tableRow(t, gi, ti))),
      );
    }),
    section('T\'ha arribat un resultat?', null, renderPaste('Si una taula t\'envia el resultat i en tocar l\'enllaç no se t\'obre l\'app (als iPhone passa), copia el missatge del WhatsApp i enganxa\'l aquí.')),
    h('div', { class: 'actions center' }, h('button', {
      class: 'btn quiet danger', type: 'button',
      onclick: () => {
        if (!confirm(`Vols esborrar el torneig "${tournamentTitle(t)}"? S'esborren el sorteig i tots els resultats, i no es poden recuperar.`)) return;
        setState(st => { st.tournaments = st.tournaments.filter(x => x.id !== t.id); st.tid = null; });
        go('setup');
      },
    }, 'Esborra el torneig')),
  );
}

/** Afegeix al torneig el resultat d'una taula. Qui crida ja ha preguntat si substitueix un altre. */
function addResult(tid, g, fromCurrent) {
  setState(st => {
    const t = st.tournaments.find(x => x.id === tid);
    t.results[resultKey(g.tour.game, g.tour.table)] = tableResult(g);
    if (fromCurrent) archiveCurrentGame(st);
    st.tid = tid;
    st.screen = 'tournament';
  });
  window.scrollTo(0, 0);
  toast(`${tableLabel(g.tour.game, g.tour.table)}: resultat afegit`);
}

const REPLACE_TEXT = 'Aquesta taula ja tenia un resultat. Vols posar aquest en lloc seu?';

/** En acabar una partida de torneig: afegir-la (si el torneig és en aquest mòbil) o enviar-la a l'organitzador. */
function tourGameActions(g) {
  const t = findTournament(g.tour.id);
  const check = t && acceptResult(t, g);
  if (!check?.ok) return shareButton(g);
  const fromCurrent = g === state.game;
  return h('button', {
    class: 'btn', type: 'button',
    onclick: () => {
      if (check.replaces && !confirm(REPLACE_TEXT)) return;
      addResult(t.id, g, fromCurrent);
    },
  }, check.replaces ? 'Torna a afegir-la al torneig' : 'Afegeix-la al torneig');
}

/** El resultat d'una taula, rebut per un enllaç. */
function renderSharedResult(g, back) {
  const t = findTournament(g.tour.id);
  const check = t ? acceptResult(t, g) : null;
  let action;
  if (!t) {
    action = h('p', { class: 'note' }, 'Aquest resultat és d\'un torneig que no és en aquest mòbil. Si l\'organitzes tu i l\'enllaç s\'ha obert al navegador i no a l\'app, copia el missatge i enganxa\'l a l\'app, a la pantalla del torneig.');
  } else if (!check.ok) {
    action = h('p', { class: 'error' }, RESULT_ERROR_TEXT[check.error]);
  } else {
    action = h('button', {
      class: 'btn', type: 'button',
      onclick: () => {
        if (check.replaces && !confirm(REPLACE_TEXT)) return;
        clearHash();
        incoming = null;
        addResult(t.id, g, false);
      },
    }, check.replaces ? 'Substitueix el resultat que hi havia' : 'Afegeix-lo al torneig');
  }
  return h('div', null,
    masthead(back),
    tourBanner(g.tour),
    gameReport(g, `Resultat de la taula, ${fmtRounds(g.rounds.length)}`),
    h('div', { class: 'actions center' },
      t && g.rounds.length < t.rounds ? h('p', { class: 'note' }, `Només hi ha ${fmtRounds(g.rounds.length)} de ${t.rounds}.`) : null,
      action,
    ),
  );
}

function renderTResult() {
  const t = currentTournament();
  const v = state.tview;
  const res = t && v && t.results[resultKey(v.game, v.table)];
  if (!res) return t ? renderTournament() : renderSetup();
  return h('div', null,
    masthead(h('button', { class: 'crumb', type: 'button', onclick: () => go('tournament') }, 'Torna al torneig')),
    tourBanner({ name: t.name, game: v.game, table: v.table }),
    gameReport({ players: res.players, rounds: res.rounds }, `Rebut el ${fmtDate(res.receivedAt)}, ${fmtRounds(res.rounds.length)}`),
    h('div', { class: 'actions center' }, h('button', {
      class: 'btn quiet danger', type: 'button',
      onclick: () => {
        if (!confirm('Vols treure aquest resultat del torneig? La taula el pot tornar a enviar.')) return;
        setState(st => { delete findTournament(t.id).results[resultKey(v.game, v.table)]; st.tview = null; });
        go('tournament');
      },
    }, 'Treu aquest resultat')),
  );
}

function standingsTable(t, rows) {
  return h('div', { class: 'scroll-x' }, h('table', { class: 'rounds tstand' },
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
  ));
}

function renderTStandings() {
  const t = currentTournament();
  if (!t) return renderSetup();
  const rows = tournamentStandings(t);
  const p = progress(t);
  const done = p.received === p.total;
  const list = awards(rows);
  const champion = list.find(a => a.key === 'champion');
  const diplomas = list.length ? section('Diplomes', done ? null : 'de moment',
    h('ul', { class: 'diplomas' }, list.map(a => h('li', null,
      h('div', { class: 'dtitle' }, h('b', null, a.title), h('small', null, a.detail)),
      h('div', { class: 'dwho' }, h('span', null, joinNames(a.names)), h('small', null, fmtAward(a))),
    ))),
    h('p', { class: 'note' }, 'Si hi ha empat, el diploma és per a tots els empatats.'),
  ) : null;
  const table = section('Classificació', 'menys punts guanya',
    p.received ? standingsTable(t, rows) : h('p', { class: 'note' }, 'Encara no ha arribat cap resultat.'),
    p.received ? h('p', { class: 'note' }, `P1, P2…: els punts de cada partida.${needsScaling(t) ? ' Hi ha taules de mides diferents, així que els punts de cada taula es passen al que serien en una taula de 5 perquè sigui just. Per això hi pot haver decimals.' : ''}`) : null,
  );


  return h('div', null,
    masthead(h('button', { class: 'crumb', type: 'button', onclick: () => go('tournament') }, 'Torna al torneig')),
    champion ? h('section', { class: 'winner' },
      h('p', { class: 'lead' }, done ? `${tournamentTitle(t)}: guanya` : (champion.names.length > 1 ? 'Ara mateix van davant' : 'Ara mateix va davant')),
      h('p', { class: 'name' }, joinNames(champion.names)),
      h('p', { class: 'sub' }, `${fmtPoints(champion.value)} punts. ${done ? 'Han arribat tots els resultats.' : `Falten ${plural(p.total - p.received, 'taula', 'taules')} per enviar el resultat.`}`),
    ) : null,
    // Mentre es juga interessa més la classificació; al final, els diplomes.
    ...(done ? [diplomas, table] : [table, diplomas]),
    p.received ? h('div', { class: 'actions center' },
      h('button', { class: 'btn', type: 'button', onclick: () => shareText(standingsMessage(t, rows)) }, 'Comparteix la classificació'),
    ) : null,
  );
}

// ---- La invitació d'una taula (mòbil de la taula) ----
function startTourGame(inv) {
  const g = state.game;
  clearHash();
  invite = null;
  inviteError = null;
  if (g && sameTable(g.tour, inv)) { go('game'); return; }
  if (g && g.rounds.length && !confirm('En aquest mòbil hi ha una partida a mitges. Es desarà a l\'historial tal com està i començarà la del torneig.')) {
    go(state.game ? 'game' : 'setup');
    return;
  }
  setState(st => {
    if (st.game) archiveCurrentGame(st);
    st.game = { ...createGame(inv.players, inv.rounds), tour: { id: inv.id, name: inv.name, game: inv.game, table: inv.table } };
    st.draft = emptyDraft(inv.players.length);
    st.screen = 'game';
  });
  window.scrollTo(0, 0);
}

function leaveInvite() {
  clearHash();
  invite = null;
  inviteError = null;
  go(state.game ? 'game' : 'setup');
}

function renderInvite() {
  const back = h('button', { class: 'crumb', type: 'button', onclick: leaveInvite }, state.game ? 'Torna a la partida' : 'Inici');
  if (inviteError) {
    return h('div', null,
      masthead(back),
      section('No s\'ha pogut obrir l\'enllaç de la taula', null,
        h('p', { class: 'lede' }, SHARE_ERROR_TEXT[inviteError] ?? SHARE_ERROR_TEXT['bad-link']),
        h('button', { class: 'btn block', type: 'button', onclick: leaveInvite }, state.game ? 'Torna a la partida' : 'Ves a l\'inici'),
      ),
    );
  }
  const inv = invite;
  if (!inv) return renderSetup();
  const playing = state.game && sameTable(state.game.tour, inv);

  return h('div', null,
    masthead(back),
    h('section', { class: 'winner' },
      h('p', { class: 'lead' }, `${inv.name || 'Torneig de Papayoo'}, partida ${inv.game + 1}`),
      h('p', { class: 'name' }, `Taula ${inv.table + 1}`),
      h('p', { class: 'sub' }, `${fmtRounds(inv.rounds)}. Guanya qui fa menys punts.`),
    ),
    section('Qui hi juga', null,
      h('ul', { class: 'seats' }, inv.players.map((name, i) => h('li', null, dot(i, 20), name))),
    ),
    h('section', { class: 'section' },
      playing ? h('p', { class: 'note', style: { margin: '0 0 12px' } }, 'Aquesta partida ja l\'esteu jugant en aquest mòbil.') : null,
      h('button', { class: 'btn block', type: 'button', onclick: () => startTourGame(inv) }, playing ? 'Continua la partida' : 'Comença la partida'),
      h('p', { class: 'note' }, 'Apunteu els punts com sempre. En acabar, envieu el resultat a l\'organitzador amb el botó que sortirà.'),
    ),
  );
}

// ---------- Arrencada ----------
{
  const screen = readHash();
  if (screen) state.screen = screen;
}
render();

// Si toquen un altre enllaç amb l'app oberta, l'adreça canvia sense recarregar.
window.addEventListener('hashchange', () => {
  const screen = readHash();
  if (screen) go(screen);
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
