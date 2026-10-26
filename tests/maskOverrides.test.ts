import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyMaskOverrides, hasMaskOverrides, updateMaskOverrides, applyMaskOverrides, encodeMaskOverrides, decodeMaskOverrides } from '../src/maskOverrides';
import { encodeMask, decodeMask } from '../src/io';

const f = (values: number[]) => new Float32Array(values);
const savedMask = (mask: Float32Array) => decodeMask(encodeMask(mask), mask.length);

test('manual painting and erasure to zero survive every subsequent automatic pass', () => {
  const original = f([0.8, -0.6, 0.2, 0]), painted = f([0, -0.6, 1, -0.5]);
  const manual = updateMaskOverrides(original, painted, emptyMaskOverrides(4));
  assert.equal(manual[0], 0); assert.ok(Number.isNaN(manual[1])); assert.equal(manual[2], 1);
  assert.equal(hasMaskOverrides(manual), true);
  const autoA = f([1, 0.2, -0.8, 0.8]), autoB = f([-1, 0.6, 0.1, 0.1]);
  assert.deepEqual(applyMaskOverrides(autoA, manual), f([0, 0.2, 1, -0.5]));
  assert.deepEqual(applyMaskOverrides(autoB, manual), f([0, 0.6, 1, -0.5]));
  assert.deepEqual(autoA, f([1, 0.2, -0.8, 0.8]), 'automatic evidence must not be mutated');
});

test('immutable override snapshots restore exactly the manual intent on undo and redo', () => {
  const original = f([0.7, 0, 0.3]), erased = f([0, 0, 0.3]), corrected = f([0.9, 0, -0.4]);
  const before = emptyMaskOverrides(3), erasedSnapshot = updateMaskOverrides(original, erased, before);
  const correctedSnapshot = updateMaskOverrides(erased, corrected, erasedSnapshot);
  assert.ok(before.every(Number.isNaN)); assert.equal(erasedSnapshot[0], 0); assert.ok(Number.isNaN(erasedSnapshot[2]));
  const automatic = f([1, 0.5, 1]);
  assert.deepEqual(applyMaskOverrides(automatic, erasedSnapshot), f([0, 0.5, 1]));
  assert.deepEqual(applyMaskOverrides(automatic, correctedSnapshot), f([0.9, 0.5, -0.4]));
});

test('new project roundtrip preserves erased zero and leaves untouched automatic cells refreshable', () => {
  const manual = f([NaN, 0, 0.7, -0.6, NaN, NaN, 1, NaN, 0]);
  const merged = applyMaskOverrides(f([0.6, 0.2, 0.3, 0.8, 0, -0.4, 0.9, 0.1, 0.8]), manual);
  const loadedMask = savedMask(merged);
  const loaded = decodeMaskOverrides(JSON.parse(JSON.stringify(encodeMaskOverrides(manual))), loadedMask);
  assert.equal(loaded[1], 0); assert.equal(loaded[8], 0);
  assert.ok(Number.isNaN(loaded[0])); assert.ok(Number.isNaN(loaded[5]));
  assert.ok(Math.abs(loaded[2] - 0.7) <= 1 / 127);
  const refreshed = applyMaskOverrides(f([1, 1, 1, 1, 1, 1, 1, 1, 1]), loaded);
  assert.equal(refreshed[0], 1); assert.equal(refreshed[1], 0); assert.equal(refreshed[8], 0);
});

test('new projects with empty overrides do not accidentally freeze their automatic masks', () => {
  const automatic = f([1, -1, 0, 0.5, 0]), empty = emptyMaskOverrides(5);
  const loaded = decodeMaskOverrides(encodeMaskOverrides(empty), savedMask(automatic));
  assert.equal(hasMaskOverrides(loaded), false);
  assert.deepEqual(applyMaskOverrides(f([0, 0, 1, 0, -1]), loaded), f([0, 0, 1, 0, -1]));
});

test('legacy merged masks retain nonzero marks while clear starts a fresh automatic layer', () => {
  const legacy = f([0, 1, -1, 0.4]), loaded = decodeMaskOverrides(undefined, legacy);
  assert.ok(Number.isNaN(loaded[0])); assert.equal(loaded[1], 1); assert.equal(loaded[2], -1);
  const next = f([0.8, 0.8, 0.8, 0.8]);
  assert.deepEqual(applyMaskOverrides(next, loaded), f([0.8, 1, -1, 0.4]));
  const cleared = emptyMaskOverrides(legacy.length);
  assert.equal(hasMaskOverrides(cleared), false); assert.deepEqual(applyMaskOverrides(next, cleared), next);
});

test('corrupt override length, bitmap, padding and mismatched values fail visibly', () => {
  const merged = f([0, 1, 0]), good = encodeMaskOverrides(f([0, 1, NaN]));
  for (const candidate of [null, [], {}, { ...good, version: 2 }, { ...good, touched: '!!!=' },
    { ...good, touched: btoa('\xff') }, { ...good, touched: btoa('\x01\x02') },
    { ...good, values: encodeMask(f([1, 1, 0])) }, { ...good, values: encodeMask(f([0, 1, -1])) }]) {
    assert.throws(() => decodeMaskOverrides(candidate, merged));
  }
  assert.throws(() => updateMaskOverrides(f([0]), f([0, 1]), emptyMaskOverrides(1)), /尺寸/);
  assert.throws(() => updateMaskOverrides(f([0]), f([NaN]), emptyMaskOverrides(1)), /数值/);
  assert.throws(() => encodeMaskOverrides(f([Infinity])), /数值/);
  assert.throws(() => applyMaskOverrides(f([0]), emptyMaskOverrides(2)), /尺寸/);
});
