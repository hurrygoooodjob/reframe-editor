import assert from 'node:assert/strict';
import test from 'node:test';
import { createRandomPlan } from '../src/autoPlan';
import { defaultOutputSize, MAX_OUTPUT_PIXELS } from '../src/io';
import { DEFAULT_SETTINGS, SHAPES, type EditSettings } from '../src/types';

const original = { width: 1280, height: 850 };
const current: EditSettings = { ...DEFAULT_SETTINGS, ...original };

test('automatic deformation is deterministic and does not mutate its inputs', () => {
  const source = Object.freeze({ ...original });
  const settings = Object.freeze({ ...current, quality: 'fine' as const });
  const first = createRandomPlan(source, settings, 123456789);
  assert.deepEqual(first, createRandomPlan(source, settings, 123456789));
  assert.equal(first.quality, 'fine');
  assert.deepEqual(source, original);
  assert.deepEqual(settings, { ...current, quality: 'fine' });
});

test('100 seeds preserve the selected contour and squeeze while varying nonuniform targets', () => {
  const plans = Array.from({ length: 100 }, (_, seed) => createRandomPlan(original, current, seed));
  assert.ok(new Set(plans.map(plan => `${plan.width}x${plan.height}`)).size > 85);
  for (const plan of plans) {
    assert.ok(Math.abs(plan.width / original.width - plan.height / original.height) > 0.035);
    assert.ok(plan.width < original.width || plan.height < original.height);
    assert.ok(plan.width / original.width >= 0.579 && plan.height / original.height >= 0.579);
    assert.ok(plan.contentAmount >= 0.8 && plan.contentAmount <= 1);
    assert.equal(plan.protectStrength, 1);
    assert.equal(plan.forwardEnergy, true);
  }
  for (const { id: shape } of SHAPES) {
    for (const squeeze of [0, 0.43, 1]) {
      const selected = { ...current, shape, squeeze };
      for (let seed = 0; seed < 100; seed++) {
        const plan = createRandomPlan(original, selected, seed);
        assert.equal(plan.shape, shape, `seed ${seed} must preserve ${shape}`);
        assert.equal(plan.squeeze, squeeze, `seed ${seed} must preserve squeeze ${squeeze}`);
        assert.equal(plan.width, plans[seed].width);
        assert.equal(plan.height, plans[seed].height);
      }
    }
  }
});

test('successive plans use original dimensions and repeating a seed reproduces the same result', () => {
  let previous = current;
  for (let seed = 0; seed < 100; seed++) {
    const plan = createRandomPlan(original, previous, seed);
    const independent = createRandomPlan(original, current, seed);
    assert.deepEqual(plan, independent);
    const repeat = createRandomPlan(original, plan, seed);
    assert.deepEqual(repeat, plan);
    previous = plan;
  }
});

test('tiny, panoramic, portrait, 40MP, and large dimensions remain exportable', () => {
  for (const source of [
    { width: 1, height: 1 }, { width: 1, height: 40_000_000 },
    { width: 40_000_000, height: 1 }, { width: 4000, height: 10_000 },
    { width: 8000, height: 5000 }, { width: 8192, height: 8192 },
    { width: 960, height: 1215 }, { width: 32, height: 32 },
  ]) {
    const base = defaultOutputSize(source.width, source.height);
    for (let seed = 0; seed < 100; seed++) {
      const plan = createRandomPlan(source, current, seed);
      assert.ok(Number.isInteger(plan.width) && Number.isInteger(plan.height));
      assert.ok(plan.width >= 32 && plan.width <= 8192);
      assert.ok(plan.height >= 32 && plan.height <= 8192);
      assert.ok(plan.width * plan.height <= MAX_OUTPUT_PIXELS);
      assert.ok(plan.width <= base.width && plan.height <= base.height);
    }
  }
});

test('minimum-sized images retain their contour and malformed sizes fail clearly', () => {
  const tiny = { width: 1, height: 1 };
  const plan = createRandomPlan(tiny, current, 0);
  const next = createRandomPlan(tiny, plan, 0);
  assert.equal(plan.width, 32); assert.equal(plan.height, 32);
  assert.deepEqual(next, plan);
  assert.equal(plan.shape, current.shape);
  assert.equal(plan.squeeze, current.squeeze);
  for (const width of [0, -1, NaN, Infinity, 1.5]) {
    assert.throws(() => createRandomPlan({ width, height: 32 }, current, 0), /原图尺寸/);
  }
  assert.throws(() => createRandomPlan(original, current, NaN), /随机种子/);
});
