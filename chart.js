// Gràfica de l'evolució dels punts acumulats per ronda. SVG generat a mà, sense dependències.
import { totals } from './logic.js';

const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
export const seriesColor = (i) => SERIES[i % SERIES.length];

const svgNS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, text) {
  const node = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Punts acumulats de cada jugador després de cada ronda, començant per 0. */
export function cumulative(players, rounds) {
  return players.map((_, i) => {
    let acc = 0;
    return [0, ...rounds.map(r => (acc += r.points[i]))];
  });
}

export function renderChart(players, rounds) {
  const wrap = document.createElement('div');
  wrap.className = 'chart';
  if (rounds.length < 1) return wrap;

  const data = cumulative(players, rounds);
  const nRounds = rounds.length;
  const maxY = Math.max(50, ...data.flat());
  const W = 560, H = 260;
  const labelW = players.length <= 4 ? 70 : 0;
  const m = { top: 12, right: 12 + labelW, bottom: 28, left: 36 };
  const x = (r) => m.left + (r / nRounds) * (W - m.left - m.right);
  const y = (v) => m.top + (1 - v / maxY) * (H - m.top - m.bottom);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Evolució dels punts per ronda' });

  // Graella horitzontal discreta i eixos
  const grid = el('g', { class: 'grid' });
  const stepY = niceStep(maxY);
  for (let v = stepY; v <= maxY; v += stepY) grid.append(el('line', { x1: m.left, x2: W - m.right, y1: y(v), y2: y(v) }));
  svg.append(grid);

  const axis = el('g', { class: 'axis' });
  axis.append(el('line', { x1: m.left, x2: W - m.right, y1: y(0), y2: y(0) }));
  for (let v = 0; v <= maxY; v += stepY) axis.append(el('text', { x: m.left - 8, y: y(v) + 4, 'text-anchor': 'end' }, v));
  for (let r = 0; r <= nRounds; r++) axis.append(el('text', { x: x(r), y: H - 8, 'text-anchor': 'middle' }, r === 0 ? '' : r));
  axis.append(el('text', { x: W - m.right, y: H - 8, 'text-anchor': 'end', 'font-size': 11 }, ''));
  svg.append(axis);

  // Sèries: línies fines, marcadors amb anell blanc, etiqueta directa al final si són poques
  const series = el('g', { class: 'series' });
  const finals = data.map((d, i) => ({ i, v: d[nRounds] }));
  const labelYs = spreadLabels(finals.map(f => y(f.v)), 17, m.top, H - m.bottom);
  data.forEach((d, i) => {
    const color = seriesColor(i);
    const path = d.map((v, r) => `${r ? 'L' : 'M'}${x(r).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    series.append(el('path', { d: path, stroke: color }));
    d.forEach((v, r) => { if (r) series.append(el('circle', { cx: x(r), cy: y(v), r: 4, fill: color })); });
    if (labelW) {
      const k = finals.findIndex(f => f.i === i);
      series.append(el('text', { class: 'label', x: x(nRounds) + 10, y: labelYs[k] + 4 }, players[i]));
    }
  });
  svg.append(series);

  // Capa interactiva: cursor per ronda + tooltip
  const cursor = el('line', { class: 'cursor', y1: m.top, y2: H - m.bottom, visibility: 'hidden' });
  svg.append(cursor);
  const hit = el('rect', { class: 'hit', x: m.left, y: 0, width: W - m.left - m.right, height: H });
  svg.append(hit);
  wrap.append(svg);

  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  wrap.append(tip);

  const show = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    const r = Math.max(1, Math.min(nRounds, Math.round(((px - m.left) / (W - m.left - m.right)) * nRounds)));
    cursor.setAttribute('x1', x(r)); cursor.setAttribute('x2', x(r));
    cursor.setAttribute('visibility', 'visible');
    const rows = players.map((p, i) => ({ p, i, v: data[i][r] })).sort((a, b) => a.v - b.v);
    tip.replaceChildren(
      Object.assign(document.createElement('b'), { textContent: `Després de la ronda ${r}` }),
      ...rows.map(({ p, i, v }) => {
        const row = document.createElement('div');
        const name = document.createElement('span');
        const dot = document.createElement('i');
        dot.className = 'dot'; dot.style.background = seriesColor(i);
        name.append(dot, p);
        row.append(name, Object.assign(document.createElement('span'), { textContent: String(v) }));
        return row;
      }),
    );
    tip.hidden = false;
    const left = (x(r) / W) * rect.width;
    tip.style.left = `${Math.min(Math.max(0, left + 12), rect.width - tip.offsetWidth)}px`;
    tip.style.top = `${m.top}px`;
  };
  const hide = () => { cursor.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  hit.addEventListener('pointermove', (e) => show(e.clientX));
  hit.addEventListener('pointerdown', (e) => show(e.clientX));
  hit.addEventListener('pointerleave', hide);

  return wrap;
}

function niceStep(max) {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const nice = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
  return nice * pow;
}

/** Separa etiquetes massa juntes verticalment mantenint-les dins del marge. */
function spreadLabels(ys, minGap, top, bottom) {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++) {
    if (order[k].y - order[k - 1].y < minGap) order[k].y = order[k - 1].y + minGap;
  }
  const overflow = order.length ? order[order.length - 1].y - bottom : 0;
  if (overflow > 0) order.forEach(o => { o.y = Math.max(top, o.y - overflow); });
  const out = [];
  order.forEach(o => { out[o.i] = o.y; });
  return out;
}

export { totals };
