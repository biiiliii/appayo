import test from 'node:test';
import assert from 'node:assert/strict';
import { dealOrder, drawLayout, dealInterval } from '../frontend/draw-show.js';

test('el repartiment dona una carta a cada taula per torns i no se n’oblida cap', () => {
  const order = dealOrder([[4, 1, 7], [0, 2], [3, 5, 6]]);
  assert.deepEqual(order.map(step => step.player), [4, 0, 3, 1, 2, 5, 7, 6]);
  assert.deepEqual(order.slice(-2), [{ table: 0, seat: 2, player: 7 }, { table: 2, seat: 2, player: 6 }]);
});

test('les taules s’ordenen perquè les cartes siguin tan grans com es pugui', () => {
  assert.deepEqual(drawLayout(3, 5, 1300, 660), { columns: 3, cardHeight: 62.3 });
  assert.equal(drawLayout(3, 5, 343, 560).columns, 1);
  for (const [tables, seats, width, height] of [[40, 3, 1200, 700], [24, 5, 360, 600], [1, 8, 800, 600]]) {
    const { columns, cardHeight } = drawLayout(tables, seats, width, height);
    const rows = Math.ceil(tables / columns);
    const seatRows = Math.ceil(seats / 2);
    assert.ok(cardHeight > 0);
    assert.ok(columns * 6.55 * cardHeight + (columns - 1) * .6 * cardHeight <= width + 0.5);
    assert.ok((rows * (1.4 + seatRows + (seatRows + 1) * .25) + (rows - 1) * .6 + 2.2) * cardHeight <= height + 0.5);
  }
});

test('el repartiment dura uns segons sigui quin sigui el nombre de jugadors', () => {
  assert.equal(dealInterval(9), 550);
  assert.equal(dealInterval(36), 250);
  assert.equal(dealInterval(120), 110);
});
