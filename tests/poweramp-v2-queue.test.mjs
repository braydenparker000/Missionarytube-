import test from 'node:test';
import assert from 'node:assert/strict';
import { QueueOrder } from '../frontend/poweramp-v2/queue.js';

function random(seed = 42) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}

test('linear queue ends without wrapping and repeat-all wraps', () => {
  const order = new QueueOrder();
  order.reset(3);
  assert.equal(order.next(), 1);
  assert.equal(order.next(), 2);
  assert.equal(order.next(), null);
  assert.equal(order.index, 2);
  assert.equal(order.next({ repeat: 'all' }), 0);
  assert.equal(order.previous(), null);
});

test('repeat-one affects natural end, not explicit next', () => {
  const order = new QueueOrder();
  order.reset(3, 1);
  assert.equal(order.next({ repeat: 'one', ended: true }), 1);
  assert.equal(order.next({ repeat: 'one' }), 2);
});

test('shuffle visits every track once per cycle and no adjacent repeat at boundaries', () => {
  const order = new QueueOrder({ random: random() });
  order.reset(50, 17);
  order.setShuffle(true);
  const first = [order.index];
  for (let i = 1; i < 50; i++) first.push(order.next());
  assert.equal(new Set(first).size, 50);
  assert.equal(order.next(), null);
  let previous = first.at(-1);
  for (let cycle = 0; cycle < 10; cycle++) {
    const indices = Array.from({ length: 50 }, () => order.next({ repeat: 'all' }));
    assert.equal(new Set(indices).size, 50);
    assert.notEqual(indices[0], previous);
    previous = indices.at(-1);
  }
});

test('shuffle previous and next retrace actual history without consuming another track', () => {
  const order = new QueueOrder({ random: random() });
  order.reset(5, 2);
  order.setShuffle(true);
  const a = order.next();
  const b = order.next();
  assert.equal(order.previous(), a);
  assert.equal(order.previous(), 2);
  assert.equal(order.previous(), null);
  assert.equal(order.next(), a);
  assert.equal(order.next(), b);
  const remainder = [order.next(), order.next()];
  assert.equal(new Set([2, a, b, ...remainder]).size, 5);
});

test('empty and singleton queues have explicit boundary behavior', () => {
  const order = new QueueOrder();
  assert.equal(order.index, -1);
  assert.equal(order.next({ repeat: 'all' }), null);
  assert.equal(order.previous(), null);
  assert.equal(order.select(1), false);
  order.reset(1);
  order.setShuffle(true);
  assert.equal(order.next(), null);
  assert.equal(order.next({ repeat: 'all' }), 0);
});

test('selection resets shuffle traversal and toggling shuffle preserves current identity', () => {
  const order = new QueueOrder({ random: random() });
  order.reset(5);
  order.setShuffle(true);
  order.next();
  assert.equal(order.select(3), true);
  assert.equal(order.previous(), null);
  assert.equal(new Set([3, ...Array.from({ length: 4 }, () => order.next())]).size, 5);
  order.setShuffle(false);
  const index = order.index;
  assert.equal(order.next({ repeat: 'all' }), (index + 1) % 5);
});
