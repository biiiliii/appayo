import {
  TOTAL, PAPAYOO_POINTS, MIN_PLAYERS, MAX_PLAYERS,
  resolveRound, clampPoints, maxPointsFor, standings, validateSetup, createGame,
} from './logic.js';
import { renderChart, seriesColor } from './chart.js';

const STORAGE_KEY = 'appayo:v1';
const root = document.getElementById('app');

const ERROR_TEXT = {
  'papayoo-missing': 'Cal dir qui té el Papayoo.',
  'papayoo-too-low': `Qui té el Papayoo ha de tenir com a mínim ${PAPAYOO_POINTS} punts.`,
  'over-total': `La suma passa de ${TOTAL}.`,
  'sum-mismatch': `La suma ha de ser exactament ${TOTAL}.`,
  'negative': 'No hi pot haver punts negatius.',
  'too-few': `Calen com a mínim ${MIN_PLAYERS} jugadors.`,
  'too-many': `Com a màxim ${MAX_PLAYERS} jugadors.`,
  'empty-name': 'Tots els jugadors han de tenir nom.',
  'duplicate-name': 'Hi ha dos jugadors amb el mateix nom.',
};

// ---------- Estat ----------
const state = Object.assign({
  screen: 'setup',
  setup: { names: ['', '', '', ''], roundsPlanned: 5 },
  game: null,
  draft: null,
  games: [],      // partides acabades, la més recent primer
  viewing: null,  // id de la partida de l'historial que s'està mirant
}, load() ?? {});

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
  if (g) { st.setup.names = g.players.slice(); st.setup.roundsPlanned = g.roundsPlanned; }
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
const dot = (i) => h('i', { class: 'dot', style: { background: seriesColor(i) } });
const pcard = (lg) => h('span', { class: `pcard${lg ? ' lg' : ''}`, 'aria-label': 'Papayoo' }, '7');
const fmtDate = (ts) => new Date(ts).toLocaleDateString('ca', { day: 'numeric', month: 'long', year: 'numeric' });

function render() {
  const active = document.activeElement;
  const focusId = active && active.id ? active.id : null;
  const screens = { setup: renderSetup, game: renderGame, history: renderHistory, detail: renderDetail };
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
    dot(i),
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

  const roundOptions = [3, 4, 5, 6, 8, 10, null];
  const rounds = h('div', { class: 'choices' }, roundOptions.map(n => h('button', {
    class: 'choice', type: 'button', 'aria-pressed': String(s.roundsPlanned === n),
    onclick: () => setState(st => { st.setup.roundsPlanned = n; }),
  }, n === null ? 'Sense límit' : n)));

  const resume = state.game ? section('Partida en curs', null,
    h('p', { class: 'lede' }, `${state.game.players.join(', ')}. ${state.game.rounds.length === 1 ? 'Una ronda jugada' : `${state.game.rounds.length} rondes jugades`}.`),
    h('button', { class: 'btn block', type: 'button', onclick: () => go('game') }, 'Continua la partida'),
  ) : null;

  return h('div', null,
    masthead(h('button', { class: 'crumb', type: 'button', onclick: () => go('history') },
      state.games.length ? `Partides anteriors (${state.games.length})` : 'Partides anteriors')),
    resume,
    section('Qui juga?', `de ${MIN_PLAYERS} a ${MAX_PLAYERS}`,
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
      h('p', { class: 'note' }, 'Les normes en recomanen 5. En acabar sempre en podreu afegir més.'),
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
    finished ? renderWinner(g) : null,
    renderStandings(g, finished),
    finished ? null : renderRoundEntry(g),
    g.rounds.length >= 1 ? section('Com ha anat', 'acumulat, menys és millor', renderChart(g.players, g.rounds), legend(g.players)) : null,
    g.rounds.length ? section('Ronda a ronda', null, renderRoundsTable(g)) : null,
    h('div', { class: 'actions center' },
      finished ? h('button', { class: 'btn outline', type: 'button', onclick: () => setState(st => { st.game.roundsPlanned += 1; }) }, 'Juga una ronda més') : null,
      finished ? h('button', { class: 'btn', type: 'button', onclick: () => { setState(archiveCurrentGame); go('setup'); } }, 'Desa la partida a l\'historial') : null,
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
  return section(finished ? 'Classificació final' : 'Classificació', g.rounds.length ? 'menys punts guanya' : null,
    h('ol', { class: 'ledger' }, rows.map(r => h('li', { class: r.rank === 1 && g.rounds.length ? 'first' : null },
      h('span', { class: 'pos' }, g.rounds.length ? `${r.rank}.` : ''),
      h('span', { class: 'who' }, dot(r.index), h('span', null, r.name), last && last.papayoo === r.index ? pcard() : null),
      h('span', { class: 'score' }, r.total, last ? h('span', { class: 'last' }, `+${last.points[r.index]}`) : null),
    ))),
  );
}

function renderRoundEntry(g) {
  const d = state.draft;
  const n = g.players.length;
  const res = resolveRound(d);
  const missing = d.points.filter(p => p === null).length;
  const autoBad = res.auto !== null && (res.errors.includes('over-total') || res.errors.includes('papayoo-too-low'));

  const setPoints = (i, value) => setState(st => {
    const isPap = st.draft.papayoo === i;
    st.draft.points[i] = value === null ? null : Math.max(0, Math.min(maxPointsFor(isPap), Math.trunc(value)));
  });
  const displayValue = (i) => (d.points[i] !== null ? d.points[i] : (res.auto === i ? res.points[i] : null));
  const bump = (i, delta) => {
    const isPap = d.papayoo === i;
    const base = displayValue(i) ?? (isPap ? PAPAYOO_POINTS : 0);
    setPoints(i, clampPoints(base + delta, isPap));
  };

  const holder = h('div', { class: 'holder', role: 'group', 'aria-label': 'Qui té el Papayoo' },
    g.players.map((name, i) => h('button', {
      type: 'button', 'aria-pressed': String(d.papayoo === i),
      onclick: () => setState(st => {
        st.draft.papayoo = i;
        if (st.draft.points[i] !== null && st.draft.points[i] < PAPAYOO_POINTS) st.draft.points[i] = PAPAYOO_POINTS;
      }),
    }, pcard(), name)),
  );

  const rows = g.players.map((name, i) => {
    const isPap = d.papayoo === i;
    const isAuto = res.auto === i;
    const value = displayValue(i);
    const min = isPap ? PAPAYOO_POINTS : 0;
    const max = maxPointsFor(isPap);
    return h('li', null,
      h('div', { class: 'who' },
        dot(i),
        h('span', { class: 'name' }, name),
        isPap ? pcard() : null,
        isAuto ? h('span', { class: `tag rest${autoBad ? ' bad' : ''}` }, 'la resta') : null,
        d.points[i] !== null ? h('button', { class: 'clear', type: 'button', 'aria-label': `Esborra els punts de ${name}`, onclick: () => setPoints(i, null) }, '×') : null,
      ),
      h('div', { class: 'stepper' },
        h('button', { class: 'step', type: 'button', 'aria-label': `Resta 1 a ${name}`, disabled: value !== null && value <= min, onclick: () => bump(i, -1) }, '−'),
        h('input', {
          class: `points${isAuto ? ' is-auto' : ''}${isAuto && autoBad ? ' bad' : ''}`,
          type: 'text', inputmode: 'numeric', pattern: '[0-9]*', id: `points-${i}`,
          autocomplete: 'off', enterkeyhint: 'next',
          value: value === null ? '' : String(value),
          placeholder: isPap ? `${PAPAYOO_POINTS} o més` : '0',
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
          onblur: () => {
            // El mínim del Papayoo s'aplica en sortir del camp, no mentre s'escriu.
            if (isPap && d.points[i] !== null && d.points[i] < PAPAYOO_POINTS) setPoints(i, PAPAYOO_POINTS);
          },
        }),
        h('button', { class: 'step', type: 'button', 'aria-label': `Suma 1 a ${name}`, disabled: value !== null && value >= max, onclick: () => bump(i, 1) }, '+'),
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
    h('h2', { class: 'section-title' }, `Ronda ${g.rounds.length + 1}`),
    h('p', { class: 'lede' }, 'Qui s\'ha endut el Papayoo?'),
    holder,
    d.papayoo === null ? h('p', { class: 'note' }, `Sempre se l'endú algú: val ${PAPAYOO_POINTS} punts.`) : null,
    h('ul', { class: 'entry' }, rows),
    h('div', { class: 'tally' },
      h('span', { class: `state ${stateClass}` }, stateText),
      h('span', { class: `sum ${stateClass}` }, sumEntered, h('small', null, ` / ${TOTAL}`)),
    ),
    firstError ? h('p', { class: 'error', style: { margin: '0 0 12px' } }, ERROR_TEXT[firstError]) : null,
    h('button', {
      class: 'btn block', type: 'button', disabled: !res.valid,
      onclick: () => {
        const final = resolveRound(state.draft);
        if (!final.valid) return;
        setState(st => {
          st.game.rounds.push({ papayoo: st.draft.papayoo, points: final.points.slice() });
          st.draft = emptyDraft(n);
        });
        window.scrollTo(0, 0);
      },
    }, 'Desa la ronda'),
  );
}

function legend(players) {
  return h('ul', { class: 'legend' }, players.map((p, i) => h('li', null, dot(i), p)));
}

function renderRoundsTable(g) {
  const tot = standings(g.players, g.rounds).sort((a, b) => a.index - b.index).map(r => r.total);
  return h('div', null,
    h('div', { class: 'scroll-x' },
      h('table', { class: 'rounds' },
        h('thead', null, h('tr', null, h('th', null, 'Ronda'), g.players.map(p => h('th', { title: p }, p)))),
        h('tbody', null, g.rounds.map((r, ri) => h('tr', null,
          h('td', null, ri + 1),
          r.points.map((p, i) => h('td', { class: r.papayoo === i ? 'pap' : null }, p)),
        ))),
        h('tfoot', null, h('tr', null, h('td', null, 'Total'), tot.map(t => h('td', null, t)))),
      ),
    ),
    h('p', { class: 'note legend-note' }, pcard(), 'En color: qui tenia el Papayoo aquella ronda.'),
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
    section('Partides anteriors', state.games.length ? `${state.games.length}` : null, list),
  );
}

function renderDetail() {
  const g = state.games.find(x => x.id === state.viewing);
  if (!g) return renderHistory();
  const rows = standings(g.players, g.rounds);
  const winners = rows.filter(r => r.rank === 1).map(r => r.name);
  return h('div', null,
    masthead(h('button', { class: 'crumb', type: 'button', onclick: () => go('history') }, 'Partides anteriors')),
    h('section', { class: 'winner' },
      h('p', { class: 'lead' }, `${fmtDate(g.endedAt)}, ${g.rounds.length} ${g.rounds.length === 1 ? 'ronda' : 'rondes'}`),
      h('p', { class: 'name' }, winners.join(' i ')),
      h('p', { class: 'sub' }, `${rows[0].total} punts. ${winners.length > 1 ? 'Empat al capdavant.' : ''}`),
    ),
    section('Classificació final', 'menys punts guanya',
      h('ol', { class: 'ledger' }, rows.map(r => h('li', { class: r.rank === 1 ? 'first' : null },
        h('span', { class: 'pos' }, `${r.rank}.`),
        h('span', { class: 'who' }, dot(r.index), h('span', null, r.name)),
        h('span', { class: 'score' }, r.total),
      ))),
    ),
    section('Com va anar', 'acumulat, menys és millor', renderChart(g.players, g.rounds), legend(g.players)),
    section('Ronda a ronda', null, renderRoundsTable(g)),
    h('div', { class: 'actions center' },
      h('button', {
        class: 'btn quiet danger', type: 'button',
        onclick: () => {
          if (!confirm('Vols esborrar aquesta partida de l\'historial?')) return;
          setState(st => { st.games = st.games.filter(x => x.id !== g.id); st.viewing = null; });
          go('history');
        },
      }, 'Esborra aquesta partida'),
    ),
  );
}

// ---------- Arrencada ----------
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
