import assert from 'node:assert/strict';
import test from 'node:test';
import { renderImage } from '../src/engine/retarget';
import { DEFAULT_SETTINGS, type PixelImage, type RenderRequest, type ShapeId } from '../src/types';

function image(w: number, h: number, pixel: (x: number, y: number) => number[]): PixelImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(pixel(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
}
function request(source: PixelImage, width: number, height: number, overrides: Partial<RenderRequest['settings']> = {}): RenderRequest {
  return { image: source, mask: new Float32Array(source.width * source.height), maskWidth: source.width, maskHeight: source.height,
    settings: { ...DEFAULT_SETTINGS, width, height, ...overrides } };
}
function at(source: PixelImage, x: number, y: number) { return [...source.data.slice((y * source.width + x) * 4, (y * source.width + x) * 4 + 4)]; }
function blueWidth(source: PixelImage, y: number) {
  let width = 0;
  for (let x = 0; x < source.width; x++) { const [r, , b, a] = at(source, x, y); if (r < 40 && b > 200 && a > 240) width++; }
  return width;
}
const gradient = image(80, 48, (x, y) => [x * 3, y * 5, (x + y) % 256, 255]);

test('unchanged dimensions preserve pixels exactly, including transparency', () => {
  const source = image(80, 40, (x, y) => [x * 3, y * 5, 80, 64 + x % 192]);
  const result = renderImage(request(source, 80, 40));
  assert.deepEqual(result.image, source);
  assert.equal(result.analysisWidth, 80);
});

test('zero content amount performs ordinary resizing with correct endpoints', () => {
  const result = renderImage(request(gradient, 120, 24, { contentAmount: 0 })).image;
  assert.equal(result.width, 120); assert.equal(result.height, 24);
  assert.deepEqual(at(result, 0, 0), at(gradient, 0, 0));
  assert.deepEqual(at(result, 119, 23), at(gradient, 79, 47));
  const center = at(result, 60, 12);
  assert.ok(Math.abs(center[0] - 119) < 3);
  assert.ok(Math.abs(center[1] - 123) < 3);
});

test('seam carving preserves the width of a protected region when ordinary resizing shrinks it', () => {
  const source = image(240, 160, x => x >= 96 && x < 144 ? [10, 25, 245, 255] : [210, 210, 210, 255]);
  const req = request(source, 180, 160);
  for (let y = 0; y < 160; y++) for (let x = 96; x < 144; x++) req.mask[y * 240 + x] = 1;
  const carved = renderImage(req).image;
  const stretched = renderImage({ ...req, settings: { ...req.settings, contentAmount: 0 } }).image;
  assert.equal(blueWidth(carved, 80), 48);
  assert.ok(blueWidth(stretched, 80) <= 36);
  assert.equal(blueWidth(carved, 1), blueWidth(carved, 158));
});

test('negative mask attracts seams away from a protected region', () => {
  const source = image(120, 32, x => x < 30 ? [5, 20, 240, 255] : x > 80 ? [240, 20, 5, 255] : [140, 140, 140, 255]);
  const req = request(source, 90, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 120; x++) req.mask[y * 120 + x] = x < 30 ? 1 : x > 80 ? -1 : 0;
  const result = renderImage(req).image;
  assert.equal(blueWidth(result, 16), 30);
  let red = 0;
  for (let x = 0; x < 90; x++) if (at(result, x, 16)[0] > 200) red++;
  assert.ok(red < 15, `priority compression should remove most red, got ${red}`);
});

test('horizontal seams preserve protected region height through transposition', () => {
  const source = image(64, 120, (_x, y) => y >= 40 && y < 70 ? [10, 25, 245, 255] : [210, 210, 210, 255]);
  const req = request(source, 64, 80);
  for (let y = 40; y < 70; y++) for (let x = 0; x < 64; x++) req.mask[y * 64 + x] = 1;
  const output = renderImage(req).image;
  let height = 0;
  for (let y = 0; y < output.height; y++) if (at(output, 32, y)[2] > 230) height++;
  assert.equal(height, 30);
});

test('batch insertion expands both axes without collapsing the source into one repeated stripe', () => {
  const source = image(80, 48, (x, y) => [x * 3, y * 5, 40, 255]);
  for (const forwardEnergy of [true, false]) {
    const result = renderImage(request(source, 128, 76, { forwardEnergy })).image;
    assert.equal(result.data.length, 128 * 76 * 4);
    let distinct = new Set<number>();
    for (let x = 0; x < 128; x++) distinct.add(at(result, x, 38)[0]);
    assert.ok(distinct.size >= 75, `expected varied samples, got ${distinct.size}`);
    for (let x = 1; x < 128; x++) assert.ok(at(result, x, 38)[0] >= at(result, x - 1, 38)[0]);
  }
});

test('shape clipping and squeezing are observably different and all non-rect shapes have real transparency', () => {
  const source = image(100, 100, x => [Math.round(x * 255 / 99), 100, 140, 255]);
  const shapes: ShapeId[] = ['ellipse', 'triangle', 'diamond', 'hexagon', 'star', 'heart'];
  for (const shape of shapes) {
    const result = renderImage(request(source, 100, 100, { shape, squeeze: 1 })).image;
    assert.equal(at(result, 0, 0)[3], 0, `${shape} corner must be transparent`);
    assert.ok(result.data.some((v, i) => i % 4 === 3 && v === 255), `${shape} has opaque interior`);
    assert.ok(result.data.some((v, i) => i % 4 === 3 && v > 0 && v < 255), `${shape} has antialiased edges`);
  }
  const clipped = renderImage(request(source, 100, 100, { shape: 'diamond', squeeze: 0 })).image;
  const squeezed = renderImage(request(source, 100, 100, { shape: 'diamond', squeeze: 1 })).image;
  assert.ok(at(clipped, 43, 15)[0] - at(squeezed, 43, 15)[0] > 30, 'squeeze maps the source row into the contour');
});

test('shape protection allocates more contour width to marked content', () => {
  const source = image(100, 100, x => x >= 40 && x < 60 ? [10, 25, 245, 255] : [210, 210, 210, 255]);
  const req = request(source, 100, 100, { shape: 'diamond', squeeze: 1, contentAmount: 0 });
  for (let y = 0; y < 100; y++) for (let x = 40; x < 60; x++) req.mask[y * 100 + x] = 1;
  const protectedImage = renderImage(req).image;
  const ordinary = renderImage({ ...req, settings: { ...req.settings, protectStrength: 0 } }).image;
  assert.ok(blueWidth(protectedImage, 25) > blueWidth(ordinary, 25) + 5);
});

test('high-resolution output samples original details rather than enlarging the analysis thumbnail', () => {
  const source = image(1100, 12, (x, y) => [(x + y) % 2 * 255, x % 2 * 255, 0, 255]);
  const result = renderImage(request(source, 1100, 12, { quality: 'draft', contentAmount: 0 }));
  assert.ok(result.analysisWidth <= 256);
  let error = 0;
  for (let i = 0; i < source.data.length; i++) error = Math.max(error, Math.abs(source.data[i] - result.image.data[i]));
  assert.ok(error <= 1, `original detail should survive, max error ${error}`);
});

test('extreme panoramas retain both original rows instead of collapsing the short axis', () => {
  const source = image(2000, 2, (_x, y) => y === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
  const result = renderImage(request(source, 2000, 2, { quality: 'draft', contentAmount: 0 }));
  assert.equal(result.analysisHeight, 2);
  assert.deepEqual(result.image.data, source.data);
});

test('premultiplied-alpha interpolation avoids hidden red pixels bleeding onto blue', () => {
  const source = image(2, 1, x => x === 0 ? [255, 0, 0, 0] : [0, 0, 255, 255]);
  const result = renderImage(request(source, 3, 1, { contentAmount: 0 })).image;
  assert.deepEqual(at(result, 1, 0), [0, 0, 255, 128]);
  assert.deepEqual(at(result, 0, 0), [0, 0, 0, 0]);
});

test('preview dimension cap does not change requested dimensions or mutate inputs', () => {
  const req = request(gradient, 160, 96), before = new Uint8ClampedArray(req.image.data);
  const result = renderImage({ ...req, maxOutputEdge: 80 });
  assert.equal(result.image.width, 80); assert.equal(result.image.height, 48);
  assert.equal(req.settings.width, 160); assert.deepEqual(req.image.data, before);
  assert.equal(req.mask.reduce((a, b) => a + b, 0), 0);
});

test('one-pixel source, small outputs, missing masks and extreme ratios are bounded', () => {
  const dot = image(1, 1, () => [12, 34, 56, 160]);
  assert.deepEqual(at(renderImage(request(dot, 32, 20)).image, 15, 10), [12, 34, 56, 160]);
  for (const [width, height] of [[1, 20], [20, 1], [1, 1], [500, 2]]) {
    const req = request(gradient, width, height); req.mask = new Float32Array(0);
    const result = renderImage(req);
    assert.equal(result.image.data.length, width * height * 4);
    assert.ok([...result.image.data].every(Number.isFinite));
  }
  assert.throws(() => renderImage(request(gradient, NaN, 20)), /输出宽高/);
  assert.throws(() => renderImage(request(gradient, 9000, 9000)), /输出过大/);
});

test('progress is monotonic, starts before work and ends at 100 percent', () => {
  const progress: number[] = [];
  renderImage(request(gradient, 56, 32), p => progress.push(p));
  assert.equal(progress.at(-1), 1);
  assert.ok(progress.length >= 5);
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i] >= progress[i - 1]);
});

test('balanced medium-photo analysis completes within an interactive processing budget', () => {
  const source = image(1000, 667, (x, y) => [x % 256, y % 256, (x + y) % 256, 255]);
  const result = renderImage({ ...request(source, 720, 600), maxOutputEdge: 900 });
  console.log(`engine benchmark: ${result.elapsedMs.toFixed(1)} ms; analysis ${result.analysisWidth}×${result.analysisHeight}`);
  assert.ok(result.elapsedMs < 12000, `medium image took ${result.elapsedMs} ms`);
});
