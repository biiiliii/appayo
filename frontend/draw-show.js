// L'espectacle del sorteig: es barregen les cartes amb els noms i es reparteixen, d'una en una, a cada taula.
// Les funcions exportades sense DOM (ordre, mida i ritme) es proven amb `node --test`.

// Mides en alçades de carta: una carta fa 2,9 d'ample; la taula té dues columnes de cartes i el nom a dalt.
const CARD_W = 2.9;
const GAP = 0.25;
const TABLE_W = 2 * CARD_W + 3 * GAP;
const TABLE_HEAD = 1.4;
const GRID_GAP = 0.6;
const DECK_ZONE = 2.2;
const MAX_CARD_H = 64;

/** Ordre del repartiment, com a la vida real: una carta per taula i torna a començar. */
export function dealOrder(tables) {
  const order = [];
  const seats = Math.max(0, ...tables.map(table => table.length));
  for (let seat = 0; seat < seats; seat++)
    tables.forEach((players, table) => { if (seat < players.length) order.push({ table, seat, player: players[seat] }); });
  return order;
}

/** Quantes columnes de taules i quina alçada de carta fan que tot hi càpiga tan gran com es pugui. */
export function drawLayout(tableCount, maxSeats, width, height) {
  const rowsPerTable = Math.ceil(maxSeats / 2);
  const tableH = TABLE_HEAD + rowsPerTable + (rowsPerTable + 1) * GAP;
  let best = { columns: 1, cardHeight: 0 };
  for (let columns = 1; columns <= tableCount; columns++) {
    const rows = Math.ceil(tableCount / columns);
    const byWidth = width / (columns * TABLE_W + (columns - 1) * GRID_GAP);
    const byHeight = height / (rows * tableH + (rows - 1) * GRID_GAP + DECK_ZONE);
    const cardHeight = Math.min(byWidth, byHeight, MAX_CARD_H);
    if (cardHeight > best.cardHeight + 0.01) best = { columns, cardHeight };
  }
  return { columns: best.columns, cardHeight: Math.floor(best.cardHeight * 10) / 10 };
}

/** Temps entre carta i carta: el repartiment dura uns 9 segons, sigui quin sigui el nombre de jugadors. */
export function dealInterval(cards) {
  return Math.round(Math.min(550, Math.max(110, 9000 / Math.max(1, cards))));
}

function el(tag, className, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
}

// Posició d'un element dins el tapet, sense comptar la inclinació 3D (offsetLeft no la veu).
function offsetIn(node, ancestor) {
  let x = 0, y = 0;
  for (let current = node; current && current !== ancestor; current = current.offsetParent) {
    x += current.offsetLeft;
    y += current.offsetTop;
  }
  return { x, y };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const jitter = spread => (Math.random() * 2 - 1) * spread;

/**
 * Obre el sorteig a pantalla completa.
 * `tables`: per a cada taula, els índexs dels jugadors; `players`: els noms.
 */
export function playDrawShow({ tables, players, game, games, closeLabel = 'Tanca' }) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const order = dealOrder(tables);
  const animations = new Set();
  let skipped = false;
  let finished = false;

  const title = el('h2', 'draw-title', games > 1 ? `Sorteig de la partida ${game + 1}` : 'Sorteig de les taules');
  title.id = 'draw-title';
  const summary = el('p', 'draw-summary', `${order.length} jugadors, ${tables.length} ${tables.length === 1 ? 'taula' : 'taules'}`);
  const skip = el('button', 'btn outline draw-skip', 'Salta l’animació');
  skip.type = 'button';
  const close = el('button', 'btn draw-close', closeLabel);
  close.type = 'button';
  close.hidden = true;

  const deck = el('div', 'draw-deck');
  const tableNodes = tables.map((players, index) => el('section', 'draw-table',
    el('h3', 'draw-table-name', `Taula ${index + 1}`),
    el('div', 'draw-seats', ...players.map(() => el('div', 'draw-seat')))));
  const grid = el('div', 'draw-grid', ...tableNodes);
  const floor = el('div', 'draw-floor', grid, el('div', 'draw-deck-zone', deck));
  const scene = el('div', 'draw-scene', floor);
  const dialog = el('dialog', 'draw-show',
    el('header', 'draw-head', el('div', '', title, summary)),
    scene,
    el('footer', 'draw-foot', skip, close));
  dialog.setAttribute('aria-labelledby', 'draw-title');

  // Les cartes: la primera que es reparteix és la de dalt de tot de la pila.
  const cards = order.map(({ player }, index) => {
    const name = players[player] ?? '';
    const card = el('div', 'draw-card',
      el('div', 'draw-card-back', el('span', 'pcard', '7')),
      el('div', `draw-card-face${name.length > 15 ? ' is-long' : ''}`, el('span', 'draw-card-name', name)));
    card.setAttribute('aria-hidden', 'true');
    card.dataset.z = String((order.length - index) * 0.9);
    card.dataset.tilt = String(jitter(4));
    card.style.transform = `translate3d(0,0,${card.dataset.z}px) rotateZ(${card.dataset.tilt}deg)`;
    deck.append(card);
    return card;
  });
  // Llista llegible per als lectors de pantalla: la carta animada no ho és.
  const spoken = el('ol', 'sr-only', ...tables.map((seats, index) =>
    el('li', '', `Taula ${index + 1}: ${seats.map(player => players[player]).join(', ')}`)));
  dialog.append(spoken);

  function fit() {
    const box = scene.getBoundingClientRect();
    const { columns, cardHeight } = drawLayout(tables.length, Math.max(...tables.map(t => t.length)),
      Math.max(160, box.width - 8), Math.max(160, box.height - 8));
    floor.style.setProperty('--h', `${cardHeight}px`);
    grid.style.setProperty('--columns', String(columns));
  }

  function place(card, { table, seat }) {
    const slot = tableNodes[table].querySelectorAll('.draw-seat')[seat];
    card.style.transform = `rotateY(180deg) rotateZ(${Number(card.dataset.tilt) / 2}deg) translateZ(-1px)`;
    card.classList.add('is-placed');
    slot.append(card);
    if ([...tableNodes[table].querySelectorAll('.draw-seat')].every(node => node.firstChild))
      tableNodes[table].classList.add('is-full');
  }

  function track(animation) {
    animations.add(animation);
    animation.finished.catch(() => {}).finally(() => animations.delete(animation));
    return animation;
  }

  function shuffle(pass) {
    const width = deck.offsetWidth;
    return Promise.all(cards.map((card, index) => {
      const base = card.style.transform;
      const side = (index + pass) % 2 ? 1 : -1;
      const lift = Number(card.dataset.z) + 30 + index % 7 * 3;
      return track(card.animate([
        { transform: base },
        { transform: `translate3d(${side * width * 0.62}px, ${jitter(6)}px, ${lift}px) rotateZ(${side * 9}deg)`, offset: 0.45 },
        { transform: base },
      ], { duration: 820, delay: (index % 12) * 18, easing: 'cubic-bezier(.45,.05,.3,1)' })).finished;
    }));
  }

  function deal(card, step) {
    const slot = tableNodes[step.table].querySelectorAll('.draw-seat')[step.seat];
    const from = offsetIn(deck, floor);
    const to = offsetIn(slot, floor);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lift = 50 + Math.hypot(dx, dy) * 0.08;
    const tilt = Number(card.dataset.tilt);
    card.style.zIndex = '2';
    const flight = track(card.animate([
      { transform: card.style.transform },
      { transform: `translate3d(${dx * 0.5}px, ${dy * 0.5}px, ${lift}px) rotateY(95deg) rotateZ(${tilt * 2}deg)`, offset: 0.48 },
      { transform: `translate3d(${dx}px, ${dy}px, 2px) rotateY(180deg) rotateZ(${tilt / 2}deg)` },
    ], { duration: 900, easing: 'cubic-bezier(.33,.6,.3,1)', fill: 'forwards' }));
    // Ja dins el seu seient, el vol es treu: si no, la carta es desplaçaria dues vegades.
    return flight.finished.then(() => { if (!skipped) { place(card, step); flight.cancel(); } },
      () => {}); // «Salta» cancel·la el vol i ja la deixa al seu lloc.
  }

  function finish() {
    if (finished) return;
    finished = true;
    cards.forEach((card, index) => { if (!card.classList.contains('is-placed')) place(card, order[index]); });
    for (const animation of animations) animation.cancel();
    cards.forEach(card => card.getAnimations().forEach(animation => animation.cancel()));
    floor.classList.add('is-flat');
    skip.hidden = true;
    close.hidden = false;
    close.focus();
  }

  async function run() {
    await wait(500);
    if (skipped) return;
    for (let pass = 0; pass < 2 && !skipped; pass++) await shuffle(pass);
    if (skipped) return;
    floor.classList.add('is-dealing');
    const interval = dealInterval(cards.length);
    const flights = [];
    for (let index = 0; index < cards.length && !skipped; index++) {
      flights.push(deal(cards[index], order[index]));
      await wait(interval);
    }
    await Promise.all(flights);
    if (skipped) return;
    await wait(450);
    finish();
  }

  skip.addEventListener('click', () => { skipped = true; finish(); });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (!finished) { event.preventDefault(); skipped = true; finish(); } });
  const onResize = () => fit();
  window.addEventListener('resize', onResize);
  dialog.addEventListener('close', () => {
    skipped = true;
    window.removeEventListener('resize', onResize);
    dialog.remove();
  }, { once: true });

  document.body.append(dialog);
  dialog.showModal();
  fit();
  if (reduced) { skipped = true; finish(); } else { skip.focus(); run(); }
  return dialog;
}
