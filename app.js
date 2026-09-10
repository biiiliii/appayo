import {
  TOTAL, PAPAYOO_POINTS, MIN_PLAYERS, MAX_PLAYERS,
  resolveRound, clampPoints, maxPointsFor, standings, validateSetup, createGame,
} from './logic.js';

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
const state = load() ?? {
  screen: 'setup',
  setup: { names: ['', '', '', ''], roundsPlanned: 5 },
  game: null,
  draft: null,
};

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

// ---------- Utilitats DOM ----------
function h(tag, attrs, ...children) {
  attrs = attrs || {};
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'type' && k !== 'value' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function render() {
  const active = document.activeElement;
  const focusId = active && active.id ? active.id : null;
  root.replaceChildren(state.screen === 'game' && state.game ? renderGame() : renderSetup());
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

function header(subtitle) {
  return h('header', { class: 'header' },
    h('div', { class: 'brand' },
      h('img', { src: 'icons/icon.svg', alt: '' }),
      h('div', null, h('h1', null, 'Appayo'), h('small', null, subtitle)),
    ),
  );
}

// ---------- Pantalla d'inici ----------
function renderSetup() {
  const s = state.setup;
  const errorBox = h('p', { class: 'error-text', id: 'setup-error', hidden: true });

  const nameRows = s.names.map((name, i) => h('div', { class: 'field' },
    h('span', { class: 'num' }, i + 1),
    h('input', {
      class: 'text-input', type: 'text', id: `name-${i}`, value: name,
      placeholder: `Jugador ${i + 1}`, autocomplete: 'off', autocapitalize: 'words', maxlength: 20,
      oninput: (e) => { s.names[i] = e.target.value; save(); },
    }),
    h('button', {
      class: 'icon-btn', type: 'button', 'aria-label': 'Treu aquest jugador',
      disabled: s.names.length <= MIN_PLAYERS,
      onclick: () => setState(st => { st.setup.names.splice(i, 1); }),
    }, '×'),
  ));

  const roundOptions = [3, 4, 5, 6, 8, 10, null];
  const segmented = h('div', { class: 'segmented' },
    roundOptions.map(n => h('button', {
      class: 'seg', type: 'button', 'aria-pressed': String(s.roundsPlanned === n),
      onclick: () => setState(st => { st.setup.roundsPlanned = n; }),
    }, n === null ? 'Sense límit' : n)),
  );

  const resume = state.game ? h('section', { class: 'card' },
    h('h2', null, 'Partida en curs'),
    h('p', { style: 'margin:0 0 12px' },
      `${state.game.players.join(', ')} · ${state.game.rounds.length} ${state.game.rounds.length === 1 ? 'ronda jugada' : 'rondes jugades'}`),
    h('button', { class: 'btn block', type: 'button', onclick: () => setState(st => { st.screen = 'game'; }) }, 'Continuar la partida'),
  ) : null;

  return h('div', null,
    header('Comptador de punts del Papayoo'),
    resume,
    h('section', { class: 'card' },
      h('h2', null, 'Jugadors'),
      h('div', { class: 'stack' }, nameRows),
      h('div', { class: 'row spread', style: 'margin-top:12px' },
        h('p', { class: 'hint', style: 'margin:0' }, `De ${MIN_PLAYERS} a ${MAX_PLAYERS} jugadors`),
        h('button', {
          class: 'btn secondary small', type: 'button', disabled: s.names.length >= MAX_PLAYERS,
          onclick: () => setState(st => { st.setup.names.push(''); }),
        }, '+ Afegeix jugador'),
      ),
    ),
    h('section', { class: 'card' },
      h('h2', null, 'Rondes'),
      segmented,
      h('p', { class: 'hint' }, 'Les normes recomanen 5 rondes. Sempre podreu afegir-ne més al final.'),
    ),
    errorBox,
    h('button', {
      class: 'btn block', type: 'button', style: 'margin-top:4px',
      onclick: () => {
        const errors = validateSetup(s.names);
        if (errors.length) {
          errorBox.textContent = ERROR_TEXT[errors[0]];
          errorBox.hidden = false;
          return;
        }
        if (state.game && state.game.rounds.length && !confirm('Hi ha una partida en curs. Vols començar-ne una de nova i perdre-la?')) return;
        setState(st => {
          st.game = createGame(s.names, s.roundsPlanned);
          st.draft = emptyDraft(st.game.players.length);
          st.screen = 'game';
        });
        window.scrollTo(0, 0);
      },
    }, 'Comença la partida'),
  );
}

// ---------- Pantalla de partida ----------
function renderGame() {
  const g = state.game;
  const n = g.players.length;
  if (!state.draft || state.draft.points.length !== n) state.draft = emptyDraft(n);
  const roundNo = g.rounds.length + 1;
  const finished = g.roundsPlanned !== null && g.rounds.length >= g.roundsPlanned;
  const subtitle = g.roundsPlanned ? `Ronda ${Math.min(roundNo, g.roundsPlanned)} de ${g.roundsPlanned}` : `Ronda ${roundNo}`;

  return h('div', null,
    header(finished ? 'Partida acabada' : subtitle),
    finished ? renderFinished(g) : null,
    renderStandings(g),
    finished ? null : renderRoundEntry(g),
    renderHistory(g),
    h('div', { class: 'footer-actions' },
      finished ? h('button', {
        class: 'btn secondary', type: 'button',
        onclick: () => setState(st => { st.game.roundsPlanned += 1; }),
      }, '+ Juga una ronda més') : null,
      g.rounds.length ? h('button', {
        class: 'btn ghost', type: 'button',
        onclick: () => {
          if (!confirm(`Vols desfer la ronda ${g.rounds.length}? Els seus punts tornaran al formulari.`)) return;
          setState(st => {
            const last = st.game.rounds.pop();
            st.draft = { papayoo: last.papayoo, points: last.points.slice() };
          });
        },
      }, '↩ Desfés l\'última ronda') : null,
      h('button', {
        class: 'btn ghost', type: 'button',
        onclick: () => {
          if (g.rounds.length && !confirm('Vols acabar aquesta partida i començar-ne una de nova?')) return;
          setState(st => {
            st.setup.names = st.game.players.slice();
            st.setup.roundsPlanned = st.game.roundsPlanned;
            st.game = null;
            st.draft = null;
            st.screen = 'setup';
          });
          window.scrollTo(0, 0);
        },
      }, 'Partida nova'),
    ),
  );
}

function renderFinished(g) {
  const rows = standings(g.players, g.rounds);
  const winners = rows.filter(r => r.rank === 1).map(r => r.name);
  return h('section', { class: 'banner' },
    h('div', { class: 'big' }, '🏆'),
    h('strong', null, winners.length > 1 ? `Empat: ${winners.join(' i ')}` : `Guanya ${winners[0]}!`),
    h('p', null, `${rows[0].total} punts després de ${g.rounds.length} rondes`),
  );
}

function renderStandings(g) {
  const rows = standings(g.players, g.rounds);
  const last = g.rounds[g.rounds.length - 1];
  return h('section', { class: 'card' },
    h('h2', null, 'Classificació ', h('span', { class: 'hint', style: 'text-transform:none;letter-spacing:0;font-weight:500' }, '(menys punts guanya)')),
    h('ol', { class: 'standings' },
      rows.map(r => h('li', { class: r.rank === 1 && g.rounds.length ? 'leader' : null },
        h('span', { class: 'rank' }, r.rank),
        h('span', { class: 'name' }, r.name),
        h('span', { class: 'total' }, r.total,
          last ? h('span', { class: 'delta' }, `+${last.points[r.index]}`) : null),
      )),
    ),
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

  const chips = h('div', { class: 'chips' },
    g.players.map((name, i) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(d.papayoo === i),
      onclick: () => setState(st => {
        st.draft.papayoo = i;
        if (st.draft.points[i] !== null && st.draft.points[i] < PAPAYOO_POINTS) st.draft.points[i] = PAPAYOO_POINTS;
      }),
    }, name)),
  );

  const playerRows = g.players.map((name, i) => {
    const isPap = d.papayoo === i;
    const isAuto = res.auto === i;
    const value = displayValue(i);
    const inputId = `points-${i}`;
    return h('div', { class: 'player-row' },
      h('div', { class: 'top' },
        h('span', { class: 'pname' }, name),
        isPap ? h('span', { class: 'pill papayoo' }, 'Papayoo +40') : null,
        isAuto ? h('span', { class: `pill auto${autoBad ? ' bad' : ''}` }, 'la resta') : null,
        d.points[i] !== null ? h('button', {
          class: 'clear-btn', type: 'button', 'aria-label': `Esborra els punts de ${name}`,
          onclick: () => setPoints(i, null),
        }, '✕') : null,
      ),
      h('div', { class: 'stepper' },
        h('button', {
          class: 'step', type: 'button', 'aria-label': 'Resta 1',
          disabled: (value ?? 0) <= (isPap ? PAPAYOO_POINTS : 0) && value !== null,
          onclick: () => bump(i, -1),
        }, '−'),
        h('input', {
          class: `points${isAuto ? ' is-auto' : ''}${isAuto && autoBad ? ' bad' : ''}`,
          type: 'text', inputmode: 'numeric', pattern: '[0-9]*', id: inputId,
          autocomplete: 'off', enterkeyhint: 'next',
          value: value === null ? '' : String(value),
          placeholder: isPap ? `≥ ${PAPAYOO_POINTS}` : '0',
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
            // En sortir del camp, aplica el mínim del Papayoo (no ho fem mentre s'escriu).
            if (isPap && d.points[i] !== null && d.points[i] < PAPAYOO_POINTS) setPoints(i, PAPAYOO_POINTS);
          },
        }),
        h('button', {
          class: 'step', type: 'button', 'aria-label': 'Suma 1',
          disabled: value !== null && value >= maxPointsFor(isPap),
          onclick: () => bump(i, 1),
        }, '+'),
      ),
      h('div', { class: 'quick' },
        [-10, -5, 5, 10].map(delta => h('button', {
          type: 'button',
          disabled: value !== null && (delta < 0 ? value + delta < (isPap ? PAPAYOO_POINTS : 0) : value + delta > maxPointsFor(isPap)),
          onclick: () => bump(i, delta),
        }, `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`)),
      ),
    );
  });

  const sumEntered = res.valid ? TOTAL : d.points.reduce((a, p) => a + (p ?? 0), 0);
  let status;
  if (res.valid) status = h('span', { class: 'pill left ok' }, `${TOTAL} punts repartits ✓`);
  else if (res.remaining < 0) status = h('span', { class: 'pill left bad' }, `Sobren ${-res.remaining} punts`);
  else if (missing > 1) status = h('span', { class: 'pill left' }, `Queden ${res.remaining} punts per a ${missing} jugadors`);
  else status = h('span', { class: 'pill left' }, `Queden ${res.remaining} punts`);

  const firstError = res.errors.find(e => e !== 'papayoo-missing') ?? (missing <= 1 ? res.errors[0] : null);

  return h('section', { class: 'card', id: 'round-entry' },
    h('h2', null, `Ronda ${g.rounds.length + 1}`),
    h('p', { style: 'margin:0 0 8px;font-weight:700' }, 'Qui s\'ha endut el Papayoo?'),
    chips,
    d.papayoo === null ? h('p', { class: 'hint' }, 'Obligatori: el Papayoo val 40 punts i sempre se l\'endú algú.') : null,
    h('div', { style: 'margin-top:14px' }, playerRows),
    h('div', { class: 'summary' },
      status,
      h('span', { class: `total${res.valid ? ' ok' : (res.remaining < 0 ? ' bad' : '')}` }, `${sumEntered} / ${TOTAL}`),
    ),
    firstError ? h('p', { class: 'error-text', style: 'margin:0 0 10px' }, ERROR_TEXT[firstError]) : null,
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

function renderHistory(g) {
  if (!g.rounds.length) return null;
  const tot = standings(g.players, g.rounds).sort((a, b) => a.index - b.index).map(r => r.total);
  return h('section', { class: 'card' },
    h('h2', null, 'Historial'),
    h('div', { class: 'scroll-x' },
      h('table', { class: 'history' },
        h('thead', null, h('tr', null, h('th', null, 'Ronda'), g.players.map(p => h('th', { title: p }, p)))),
        h('tbody', null, g.rounds.map((r, ri) => h('tr', null,
          h('td', null, ri + 1),
          r.points.map((p, i) => h('td', { class: r.papayoo === i ? 'papayoo' : null }, p)),
        ))),
        h('tfoot', null, h('tr', null, h('td', null, 'Total'), tot.map(t => h('td', null, t)))),
      ),
    ),
    h('p', { class: 'hint' }, '● = tenia el Papayoo aquella ronda'),
  );
}

// ---------- Arrencada ----------
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
