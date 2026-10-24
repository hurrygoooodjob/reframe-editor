import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { renderImage } from '../src/engine/retarget';
import { DEFAULT_SETTINGS, type PixelImage, type RenderRequest, type ShapeId } from '../src/types';

function image(width: number, height: number, pixel: (x: number, y: number) => number[]): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, data };
}
function request(source: PixelImage, width: number, height: number, softness = 0.65): RenderRequest {
  return { image: source, mask: new Float32Array(source.width * source.height), maskWidth: source.width,
    maskHeight: source.height, settings: { ...DEFAULT_SETTINGS, width, height, transitionSoftness: softness } };
}
function pixel(source: PixelImage, x: number, y: number) {
  return [...source.data.subarray((y * source.width + x) * 4, (y * source.width + x) * 4 + 4)];
}
function curvature(source: PixelImage) {
  let sum = 0;
  // R encodes original x. Its second difference exposes abrupt changes in local scale.
  for (let y = 2; y < source.height - 2; y++) for (let x = 2; x < source.width - 2; x++) {
    const i = (y * source.width + x) * 4;
    sum += Math.abs(source.data[i - 4] - 2 * source.data[i] + source.data[i + 4]);
    sum += Math.abs(source.data[i - source.width * 4] - 2 * source.data[i] + source.data[i + source.width * 4]);
  }
  return sum;
}

test('zero transition softness matches pre-change pixel hashes for rectangular and shaped retargeting', () => {
  const source = image(64, 48, (x, y) => [(x * 7 + y * 3) % 256, (x * 2 + y * 11) % 256,
    (x * 13 + y * 5) % 256, 80 + (x + y) % 176]);
  const req = request(source, 49, 39, 0);
  for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++)
    req.mask[y * 64 + x] = x > 23 && x < 37 && y > 10 && y < 38 ? 1 : x > 45 ? -0.7 : 0;
  // Golden hashes captured from the shipped v1.1.1 engine, before smoothing was added.
  const hashes: Partial<Record<ShapeId, string>> = {
    rect: 'a67258670e30d7f47a86fdab46510abc88ef6a967e937694740dc10abd6efb84',
    ellipse: 'de86eb9eb6baf1c63fe6de8340f491a12fdbb091bbba46fbf9e333dd0c19ae86',
    diamond: 'a4ba25b4525fb66cae23cc3e145f2416dae4b9d2f75dbe3f6a1538334601a932',
    star: 'ad6e48712e45f8152ced8308fb4a232d3428e087cd7f0f3cf40e5506d52eb0b6',
  };
  for (const [shape, expected] of Object.entries(hashes)) {
    const output = renderImage({ ...req, settings: { ...req.settings, shape: shape as ShapeId } }).image;
    assert.equal(createHash('sha256').update(output.data).digest('hex'), expected, shape);
  }
});

test('softened compression reduces local coordinate kinks without reversing source order', () => {
  const source = image(192, 144, (x, y) => [x, y, 80, 255]);
  const req = request(source, 132, 144);
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const boundary = 85 + Math.round(18 * Math.sin(y / 9));
    req.mask[y * source.width + x] = x > boundary && x < boundary + 28 ? -1 : x >= 155 ? 1 : 0;
  }
  const hard = renderImage({ ...req, settings: { ...req.settings, transitionSoftness: 0 } }).image;
  const soft = renderImage(req).image;
  const strong = renderImage({ ...req, settings: { ...req.settings, transitionSoftness: 1 } }).image;
  const baseline = curvature(hard), softened = curvature(soft), strongest = curvature(strong);
  console.log(`coordinate curvature: hard=${baseline}, default=${softened}, strong=${strongest}`);
  assert.ok(softened < baseline * 0.9, 'default softening should materially reduce abrupt map changes');
  assert.ok(strongest <= baseline, 'strong softening should not add coordinate kinks');
  for (let y = 0; y < soft.height; y++) for (let x = 1; x < soft.width; x++)
    assert.ok(pixel(soft, x, y)[0] >= pixel(soft, x - 1, y)[0], 'source x order must remain monotonic');
});

test('soft transition retains the width and crisp interior of a protected subject', () => {
  const source = image(240, 120, x => x >= 96 && x < 144 ? [10, 25, 245, 255] : [210, 210, 210, 255]);
  const req = request(source, 180, 120, 1);
  for (let y = 0; y < 120; y++) for (let x = 96; x < 144; x++) req.mask[y * 240 + x] = 1;
  const out = renderImage(req).image;
  const blue = Array.from({ length: out.width }, (_, x) => pixel(out, x, 60)).filter(([r, g, b]) => r < 40 && g < 40 && b > 230);
  assert.ok(blue.length >= 45, `subject should retain nearly all 48 pixels, got ${blue.length}`);
  assert.ok(blue.filter(p => p[0] === 10 && p[1] === 25 && p[2] === 245).length >= 43, 'subject interior must not become RGB blur');
});

test('softness does not blur an unchanged high-frequency original above the analysis resolution', () => {
  const source = image(1100, 18, (x, y) => [(x + y) % 2 * 255, x % 2 * 255, 85, 80 + x % 176]);
  const req = request(source, source.width, source.height, 1); req.settings.quality = 'draft';
  const out = renderImage(req).image;
  const largestError = out.data.reduce((max, value, i) => Math.max(max, Math.abs(value - source.data[i])), 0);
  assert.ok(largestError <= 1, `unchanged texture must remain intact, maximum difference ${largestError}`);
});

test('soft map sampling keeps transparent RGB invisible and opaque blue free from red fringes', () => {
  const source = image(120, 72, (x, y) => x < 30 + Math.round(10 * Math.sin(y / 7)) ? [255, 0, 0, 0] : [0, 0, 255, 255]);
  const req = request(source, 83, 54, 1);
  const out = renderImage(req).image;
  for (let i = 0; i < out.data.length; i += 4) {
    assert.equal(out.data[i], 0, 'hidden red must never leak into visible or transparent output');
    if (out.data[i + 3] === 0) assert.equal(out.data[i + 2], 0, 'fully transparent pixels stay cleared');
  }
  assert.ok(out.data.some((v, i) => i % 4 === 3 && v > 0), 'test retains a visible subject');
});

test('softening handles one-pixel axes and extreme bounded reductions without nonfinite pixels', () => {
  for (const [w, h] of [[1, 80], [80, 1], [1, 1], [180, 2]]) {
    const source = image(w, h, (x, y) => [x % 255, y % 255, 240, 180]);
    for (const [ow, oh] of [[1, 1], [1, 30], [30, 1], [33, 21]]) {
      const out = renderImage(request(source, ow, oh, 1)).image;
      assert.equal(out.data.length, ow * oh * 4);
      for (let i = 3; i < out.data.length; i += 4) assert.equal(out.data[i], 180, 'every sample remains in a valid source location');
    }
  }
});

test('preview and export use the same softened geometry at matching normalized coordinates', () => {
  const source = image(192, 144, (x, y) => [x, y, (x + y) % 255, 255]);
  const req = request(source, 129, 97);
  for (let y = 0; y < 144; y++) for (let x = 60; x < 100 + Math.round(10 * Math.sin(y / 12)); x++) req.mask[y * 192 + x] = -1;
  const full = renderImage(req).image, preview = renderImage({ ...req, maxOutputEdge: 65 }).image;
  assert.equal(preview.width, 65); assert.equal(preview.height, 49);
  let max = 0;
  for (let y = 0; y < preview.height; y++) for (let x = 0; x < preview.width; x++) {
    const a = pixel(preview, x, y), b = pixel(full, x * 2, y * 2);
    for (let c = 0; c < 4; c++) max = Math.max(max, Math.abs(a[c] - b[c]));
  }
  assert.ok(max <= 1, `preview/export geometry differs at common coordinates by ${max}`);
});

test('biaxial softening restores common source borders instead of stretching jagged seam-cut endpoints into spikes', () => {
  const source = image(192, 144, (x, y) => [x, y, 80, 255]);
  const req = request(source, 129, 97, 0.65);
  // Both axes remove different amounts at their borders, while an interior
  // protected region remains anchored. This reproduces the boundary interaction
  // missed by the original single-axis real-photo comparison.
  for (let y = 0; y < 144; y++) for (let x = 0; x < 192; x++)
    req.mask[y * 192 + x] = x < 32 + 20 * Math.sin(y / 9) || y < 30 + 20 * Math.sin(x / 11)
      ? -1 : x > 78 && x < 118 && y > 58 && y < 100 ? 1 : 0;
  const hard = renderImage({ ...req, settings: { ...req.settings, transitionSoftness: 0 } }).image;
  assert.ok(Array.from({ length: hard.width }, (_, x) => pixel(hard, x, 0)[1]).some(y => y > 10),
    'fixture must actually create cropped, varying seam boundaries');
  const soft = renderImage(req).image;
  for (let x = 0; x < soft.width; x++) {
    assert.equal(pixel(soft, x, 0)[1], 0, 'top border must sample a common original row');
    assert.equal(pixel(soft, x, soft.height - 1)[1], 143, 'bottom border must sample a common original row');
  }
  for (let y = 0; y < soft.height; y++) {
    assert.equal(pixel(soft, 0, y)[0], 0, 'left border must sample a common original column');
    assert.equal(pixel(soft, soft.width - 1, y)[0], 191, 'right border must sample a common original column');
  }
});
