import assert from 'node:assert/strict';
import test from 'node:test';
import { resizeGeometry, brushFalloff, stampSoftBrush } from '../src/components/canvasGeometry';

test('left and top handles expand toward the pointer while the opposite edge remains fixed', () => {
  const left = resizeGeometry(1000, 600, 'w', { x: -100, y: 0 }, .5, false);
  assert.equal(left.width, 1200); assert.equal(left.height, 600);
  assert.equal(left.shift.x + left.width * .5 / 2, 1000 * .5 / 2);
  const top = resizeGeometry(1000, 600, 'n', { x: 0, y: -50 }, .5, false);
  assert.equal(top.height, 700);
  assert.equal(top.shift.y + top.height * .5 / 2, 600 * .5 / 2);
});
test('all four corners keep the opposite corner fixed after resize', () => {
  for (const handle of ['nw', 'ne', 'sw', 'se'] as const) {
    const sx = handle.includes('e') ? 1 : -1, sy = handle.includes('s') ? 1 : -1;
    const next = resizeGeometry(800, 600, handle, { x: sx * 60, y: sy * 30 }, .5, false);
    assert.equal(next.width, 920); assert.equal(next.height, 660);
    assert.equal(next.shift.x - sx * next.width * .5 / 2, -sx * 800 * .5 / 2);
    assert.equal(next.shift.y - sy * next.height * .5 / 2, -sy * 600 * .5 / 2);
  }
});
test('locked side resize retains the opposite midpoint and aspect ratio', () => {
  const next = resizeGeometry(800, 400, 'w', { x: -50, y: 20 }, .5, true);
  assert.equal(next.width, 900); assert.equal(next.height, 450); assert.equal(next.shift.y, 0);
  assert.equal(next.width / next.height, 2);
  assert.equal(next.shift.x + next.width * .5 / 2, 200);
});
test('resizing across the opposite edge stops at minimum size without flipping', () => {
  const next = resizeGeometry(800, 600, 'nw', { x: 1000, y: 1000 }, 1, false);
  assert.equal(next.width, 32); assert.equal(next.height, 32);
  assert.equal(next.shift.x + next.width / 2, 400);
});
test('brush hardness changes actual weights, keeping a full core and a smooth falloff', () => {
  assert.equal(brushFalloff(0, 0), 1);
  assert.equal(brushFalloff(.7, .9), 1);
  assert(brushFalloff(.7, .1) < .5);
  assert.equal(brushFalloff(1, .9), 0);
  assert(brushFalloff(.99, .1) < .001);
});
test('overlapping pointer samples within a stroke do not make a soft edge hard', () => {
  const base = new Float32Array(41 * 41), data = base.slice(), coverage = base.slice();
  stampSoftBrush(data, base, coverage, 41, 41, { x: 20.5, y: 20.5 }, { x: 15, y: 15 }, .2, 'protect');
  const edge = data[20 * 41 + 32];
  assert(edge > 0 && edge < 1);
  for (let i = 0; i < 30; i++) stampSoftBrush(data, base, coverage, 41, 41, { x: 20.5, y: 20.5 }, { x: 15, y: 15 }, .2, 'protect');
  assert.equal(data[20 * 41 + 32], edge);
  assert.equal(data[20 * 41 + 20], 1); assert.equal(data[0], 0);
});
test('soft eraser removes the core while partially preserving boundary protection', () => {
  const base = new Float32Array(41 * 41).fill(1), data = base.slice(), coverage = new Float32Array(base.length);
  stampSoftBrush(data, base, coverage, 41, 41, { x: 20.5, y: 20.5 }, { x: 15, y: 15 }, .2, 'erase');
  assert.equal(data[20 * 41 + 20], 0);
  assert(data[20 * 41 + 32] > .5 && data[20 * 41 + 32] < 1);
  assert.equal(data[0], 1);
});
test('compress brush has negative soft weights and transitions old protection continuously', () => {
  const base = new Float32Array(41 * 41).fill(.4), data = base.slice(), coverage = new Float32Array(base.length);
  stampSoftBrush(data, base, coverage, 41, 41, { x: 20.5, y: 20.5 }, { x: 15, y: 15 }, .2, 'compress');
  assert.equal(data[20 * 41 + 20], -1);
  assert(data[20 * 41 + 31] > -1 && data[20 * 41 + 31] < .4);
});
