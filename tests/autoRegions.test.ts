import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeRegions } from '../src/engine/autoRegions';
import { renderImage } from '../src/engine/retarget';
import { DEFAULT_SETTINGS, type PixelImage } from '../src/types';

function image(width: number, height: number, pixel: (x: number, y: number) => number[]): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, data };
}
const object = (x: number, y: number) => ((x - 35) / 19) ** 2 + ((y - 51) / 30) ** 2 < 1;
const offCenter = image(160, 100, (x, y) => object(x, y) ? [220, 36 + (x % 7), 30, 255] : [75, 157 + y * 0.13, 224, 255]);
const request = (source: PixelImage, seed = 17, maskWidth = source.width, maskHeight = source.height) => ({ image: source, seed, maskWidth, maskHeight });

test('off-centre colour-distinct subject is protected and quiet background is expendable', () => {
  const result = analyzeRegions(request(offCenter));
  let subject = 0, protectedSubject = 0, negativeSubject = 0, background = 0, negativeBackground = 0;
  for (let y = 0; y < offCenter.height; y++) for (let x = 0; x < offCenter.width; x++) {
    const value = result.mask[y * offCenter.width + x];
    if (object(x, y)) { subject++; if (value > 0.2) protectedSubject++; if (value < 0) negativeSubject++; }
    else { background++; if (value < 0) negativeBackground++; }
  }
  assert.ok(protectedSubject / subject > 0.90, `subject coverage ${protectedSubject / subject}`);
  assert.equal(negativeSubject, 0, 'salient foreground must never be nominated for compression');
  assert.ok(negativeBackground / background > 0.5);
  assert.equal(result.regionCount, 1);
  assert.notEqual(result.confidence, 'low');
});

test('seeds reproduce masks exactly while alternatives keep their strongest subject protected', () => {
  const a = analyzeRegions(request(offCenter, 41));
  const same = analyzeRegions(request(offCenter, 41));
  const b = analyzeRegions(request(offCenter, 913));
  assert.deepEqual(a.mask, same.mask);
  let changed = 0;
  for (let i = 0; i < a.mask.length; i++) if (a.mask[i] !== b.mask[i]) changed++;
  assert.ok(changed / a.mask.length > 0.15, 'seed should yield a genuinely distinct candidate mask');
  for (const result of [a, b]) assert.ok(result.mask[51 * offCenter.width + 35] > 0.8);
});

test('flat, empty and invisible-colour images do not invent a foreground', () => {
  for (const source of [
    image(70, 30, () => [150, 150, 150, 255]),
    image(30, 30, (x, y) => [x * 8, y * 8, 255, 0]),
    image(1, 1, () => [0, 0, 0, 255]),
    image(60, 40, (x, y) => [100 + ((x + y) % 2), 100, 100, 255]),
  ]) {
    const result = analyzeRegions(request(source));
    assert.equal(result.confidence, 'low');
    assert.equal(result.protectRatio, 0); assert.equal(result.compressRatio, 0);
    assert.equal(result.regionCount, 0); assert.ok(result.warnings.length);
    assert.ok(result.mask.every(v => v === 0));
  }
});

test('transparent backgrounds stay neutral and opaque silhouettes receive protection', () => {
  const source = image(100, 80, (x, y) => x > 28 && x < 62 && y > 20 && y < 64 ? [245, 245, 245, 255] : [255, 0, 0, 0]);
  const result = analyzeRegions(request(source));
  assert.ok(result.mask[40 * 100 + 45] > 0.8);
  assert.equal(result.compressRatio, 0);
  for (let i = 0; i < result.mask.length; i++) if (!source.data[i * 4 + 3]) assert.equal(result.mask[i], 0);
  assert.ok(result.warnings.some(v => v.includes('透明')));
});

test('smooth low-saliency clothing inside a silhouette is not mistaken for expendable backdrop', () => {
  const source = image(160, 120, (x, y) => {
    if (x >= 48 && x < 84 && y >= 14 && y < 49) return [225, 179, 150, 255];
    if (x >= 26 && x < 111 && y >= 48 && y < 108) {
      if (x < 31 || x > 105 || y < 53 || y > 102) return [6, 18, 35, 255];
      return [31, 74, 114, 255];
    }
    return [78, 107, 142, 255];
  });
  const result = analyzeRegions(request(source));
  for (let y = 60; y < 95; y++) for (let x = 40; x < 95; x++) assert.ok(result.mask[y * 160 + x] >= 0, 'enclosed jacket must remain protected or neutral');
  assert.ok(result.compressRatio > 0.10, 'quiet exterior should still be compressible');
});

test('reported ratios and components refer to the actual editable output mask', () => {
  const result = analyzeRegions(request(offCenter, 7, 512, 320));
  const positives = result.mask.reduce((sum, v) => sum + (v > 0 ? 1 : 0), 0);
  const negatives = result.mask.reduce((sum, v) => sum + (v < 0 ? 1 : 0), 0);
  assert.equal(result.protectRatio, positives / result.mask.length);
  assert.equal(result.compressRatio, negatives / result.mask.length);
  assert.ok(result.protectRatio > 0.05 && result.protectRatio < 0.5);
  assert.ok(result.protectRatio + result.compressRatio < 0.99, 'retain a neutral transition area');
  assert.ok(result.mask.every(v => Number.isFinite(v) && v >= -1 && v <= 1));
  assert.equal(result.regionCount, 1);
});

test('analysis does not mutate caller image or depend on hidden RGB', () => {
  const before = new Uint8ClampedArray(offCenter.data), req = request(offCenter);
  const result = analyzeRegions(req);
  assert.deepEqual(offCenter.data, before);
  assert.equal(req.seed, 17); assert.notEqual(result.mask.buffer, offCenter.data.buffer);
  const one = image(100, 80, (x, y) => object(x, y) ? [220, 80, 30, 255] : [10, 20, 30, 0]);
  const two = image(100, 80, (x, y) => object(x, y) ? [220, 80, 30, 255] : [255, 2, 250, 0]);
  assert.deepEqual(analyzeRegions(request(one)).mask, analyzeRegions(request(two)).mask);
});

test('one-pixel axes and malformed requests are handled deterministically', () => {
  for (const [width, height] of [[1, 80], [100, 1], [1, 1]]) {
    const source = image(width, height, (x, y) => x + y > 25 && x + y < 50 ? [250, 10, 5, 255] : [80, 140, 250, 255]);
    const result = analyzeRegions(request(source));
    assert.equal(result.mask.length, width * height);
    assert.ok(result.mask.every(Number.isFinite));
  }
  assert.throws(() => analyzeRegions(request(offCenter, 1, 0, 20)), /选区尺寸/);
  assert.throws(() => analyzeRegions(request(offCenter, 1, 3000, 2000)), /选区尺寸/);
  assert.throws(() => analyzeRegions(request(offCenter, NaN)), /种子/);
  assert.throws(() => analyzeRegions(request({ ...offCenter, data: new Uint8ClampedArray(4) })), /像素数据/);
});

test('automatic protection changes actual seam selection and preserves the subject width', () => {
  const source = image(160, 100, (x, y) => x >= 20 && x < 51 && y > 15 && y < 87 ? [230, 15, 5, 255] : [80, 150, 220, 255]);
  const auto = analyzeRegions(request(source));
  const output = renderImage({ image: source, mask: auto.mask, maskWidth: 160, maskHeight: 100, settings: { ...DEFAULT_SETTINGS, width: 112, height: 100 } }).image;
  let redWidth = 0;
  for (let x = 0; x < output.width; x++) if (output.data[(50 * output.width + x) * 4] > 200) redWidth++;
  assert.ok(redWidth >= 30, `automatic region should retain 31px subject, got ${redWidth}`);
});

test('progress is monotonic and medium image analysis stays within an interactive budget', () => {
  const source = image(1280, 850, (x, y) => ((x - 350) / 160) ** 2 + ((y - 390) / 230) ** 2 < 1 ? [225, 50 + x % 30, 35, 255] : [65 + y % 20, 160, 220, 255]);
  const progress: number[] = [], result = analyzeRegions(request(source, 1, 512, 340), p => progress.push(p));
  assert.equal(progress[0], 0); assert.equal(progress.at(-1), 1);
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i] >= progress[i - 1]);
  console.log(`auto-region benchmark: ${result.elapsedMs.toFixed(1)} ms; protected ${(result.protectRatio * 100).toFixed(1)}%; compress ${(result.compressRatio * 100).toFixed(1)}%`);
  assert.ok(result.elapsedMs < 2000, `analysis took ${result.elapsedMs}ms`);
});
