import test from 'node:test';
import assert from 'node:assert/strict';
import { EFFECT_CATALOG, createEffect, normalizeEffect } from '../src/effects/catalog';

test('all 65 real presets have distinct ids, 10 groups and round-trip with their dedicated controls', () => {
  assert.equal(EFFECT_CATALOG.length, 65);
  assert.equal(new Set(EFFECT_CATALOG.map(d => d.group)).size, 10);
  assert.equal(new Set(EFFECT_CATALOG.map(d => d.id)).size, 65);
  for (const def of EFFECT_CATALOG) {
    const preset = createEffect(def.id);
    assert.deepEqual(normalizeEffect(preset), preset);
    for (const c of def.controls) assert.equal(preset?.params[c.key], c.value);
  }
});

test('saved effects normalize external values and reject unknown presets', () => {
  assert.equal(normalizeEffect({ id: '__proto__' }), null);
  assert.equal(normalizeEffect({ id: 'wrong' }), null);
  assert.equal(normalizeEffect(null), null);
  const edit = normalizeEffect({ id: 'dither', strength: Infinity, size: -100, params: { palette: 'invalid' } });
  assert.equal(edit?.params.palette, 'handheld');
  assert.equal(edit?.size, 2);
  assert.equal(edit?.strength, createEffect('dither')?.strength);
  assert.equal(normalizeEffect({ id: 'dither', strength: 0, params: { palette: 'sunset' } })?.strength, 0);
  assert.equal(normalizeEffect({ id: 'dither', params: { palette: 'sunset' } })?.params.palette, 'sunset');
});
