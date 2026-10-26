import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalMapper } from '../src/engine/localWarp';
import { normalizeLocalEdit, constrainLocalPush, parseLocalEdits, MAX_LOCAL_EDITS, type LocalEdit } from '../src/localTypes';
import { renderImage } from '../src/engine/retarget';
import { DEFAULT_SETTINGS, type PixelImage, type RenderRequest } from '../src/types';

const operation = (patch: Partial<LocalEdit> = {}) => normalizeLocalEdit({ id: 'a', cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3, ...patch });
function source(w = 121, h = 101): PixelImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    data[i] = Math.round(x / (w - 1) * 255); data[i + 1] = Math.round(y / (h - 1) * 255);
    data[i + 2] = x >= w * 0.46 && x <= w * 0.54 ? 255 : 0; data[i + 3] = 255;
  }
  return { width: w, height: h, data };
}
function request(image = source(), edits: LocalEdit[] = []): RenderRequest {
  return { image, mask: new Float32Array(image.width * image.height), maskWidth: image.width, maskHeight: image.height,
    settings: { ...DEFAULT_SETTINGS, width: image.width, height: image.height, contentAmount: 0 }, localEdits: edits };
}
const at = (image: PixelImage, x: number, y: number) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

test('identity local operations preserve the original raster byte-for-byte', () => {
  const req = request(source(), [operation()]);
  assert.deepEqual(renderImage(req).image, req.image);
  assert.equal(createLocalMapper(req.localEdits, 121, 101).active, false);
});

test('scale changes only its support and its central derivative matches intended size', () => {
  const enlarged = createLocalMapper([operation({ scaleX: 2, scaleY: 2 })], 801, 601);
  const reduced = createLocalMapper([operation({ scaleX: 0.5, scaleY: 0.5 })], 801, 601);
  assert.deepEqual(enlarged.map(0.1, 0.1), { x: 0.1, y: 0.1 });
  assert.deepEqual(enlarged.map(0.8, 0.5), { x: 0.8, y: 0.5 });
  const epsilon = 1e-5;
  assert.ok(Math.abs((enlarged.map(0.5 + epsilon, 0.5).x - 0.5) / epsilon - 0.5) < 1e-5);
  assert.ok(Math.abs((reduced.map(0.5 + epsilon, 0.5).x - 0.5) / epsilon - 2) < 1e-5);
  assert.equal(enlarged.map(0.5, 0.5).x, 0.5);
});

test('anisotropic arm width follows the rotated physical axis on a non-square image', () => {
  const mapper = createLocalMapper([operation({ rx: 0.25, ry: 0.4, scaleX: 2, scaleY: 1, angle: Math.PI / 2 })], 801, 401);
  const alongVertical = mapper.map(0.5, 0.55), alongHorizontal = mapper.map(0.55, 0.5);
  assert.ok(alongVertical.y < 0.53, 'rotated local x scale should expand vertically');
  assert.ok(Math.abs(alongHorizontal.x - 0.55) < 1e-12, 'orthogonal width must stay unchanged');
});

test('push moves in the requested direction and bounds overlong gestures', () => {
  const map = createLocalMapper([operation({ kind: 'push', dx: 0.06 })], 501, 501);
  assert.ok(Math.abs(map.map(0.56, 0.5).x - 0.5) < 1e-12, 'destination must sample exact drag origin');
  assert.deepEqual(map.map(0.1, 0.1), { x: 0.1, y: 0.1 });
  const extreme = createLocalMapper([operation({ kind: 'push', dx: 1, dy: 1 })], 501, 501).map(0.5, 0.5);
  assert.ok(Math.hypot(extreme.x - 0.5, extreme.y - 0.5) <= 0.12 + 1e-12);
  const constrained = constrainLocalPush(operation({ kind: 'push', dx: 1, dy: 1 }), 501, 501);
  const target = createLocalMapper([constrained], 501, 501).map(constrained.cx + constrained.dx, constrained.cy + constrained.dy);
  assert.ok(Math.hypot(target.x - constrained.cx, target.y - constrained.cy) < 1e-12);
});

test('all supported extreme scales and pushes keep a positive inverse Jacobian', () => {
  const edits: LocalEdit[] = [];
  for (const softness of [0, 0.5, 1]) {
    for (const scaleX of [0.5, 1, 2]) for (const scaleY of [0.5, 1, 2]) {
      edits.push(operation({ rx: 0.37, ry: 0.22, angle: 0.61, scaleX, scaleY, softness }));
    }
    edits.push(operation({ kind: 'push', rx: 0.37, ry: 0.22, angle: 0.61, dx: 1, dy: -1, softness }));
  }
  const epsilon = 1e-6;
  for (const edit of edits) {
    const mapper = createLocalMapper([edit], 801, 601);
    for (let y = 0.08; y <= 0.92; y += 0.025) for (let x = 0.08; x <= 0.92; x += 0.025) {
      const p = mapper.map(x, y), px = mapper.map(x + epsilon, y), py = mapper.map(x, y + epsilon);
      const det = ((px.x - p.x) * (py.y - p.y) - (px.y - p.y) * (py.x - p.x)) / epsilon ** 2;
      assert.ok(det > 0.08, `folded local map det=${det}, ${JSON.stringify(edit)}`);
    }
  }
});

test('multiple edits compose inverse mappings in reverse chronological order', () => {
  const a = operation({ id: 'first', scaleX: 1.8 }), b = operation({ id: 'second', kind: 'push', cx: 0.57, dx: 0.06 });
  const first = createLocalMapper([a], 501, 401), second = createLocalMapper([b], 501, 401);
  const q = second.map(0.56, 0.51), expected = first.map(q.x, q.y);
  const actual = createLocalMapper([a, b], 501, 401).map(0.56, 0.51);
  assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-12);
  const reversed = createLocalMapper([b, a], 501, 401).map(0.56, 0.51);
  assert.ok(Math.abs(actual.x - reversed.x) > 1e-4);
});

test('local raster enlargement really widens the selected stripe without changing distant pixels', () => {
  const image = source(), enlarged = renderImage(request(image, [operation({ scaleX: 1.8 })])).image;
  const reduced = renderImage(request(image, [operation({ scaleX: 0.6 })])).image;
  const stripe = (im: PixelImage) => Array.from({ length: im.width }, (_, x) => at(im, x, 50)[2]).filter(v => v > 200).length;
  assert.ok(stripe(enlarged) > stripe(image));
  assert.ok(stripe(reduced) < stripe(image));
  for (const [x, y] of [[2, 2], [115, 90], [5, 50]]) assert.deepEqual(at(enlarged, x, y), at(image, x, y));
});

test('local edits remain aligned through preview scaling and sample original pixels', () => {
  const req = request(source(401, 301), [operation({ scaleX: 1.6, scaleY: 0.75, angle: 0.4 })]);
  const full = renderImage(req).image, preview = renderImage({ ...req, maxOutputEdge: 201 }).image;
  for (let py = 0; py < preview.height; py += 13) for (let px = 0; px < preview.width; px += 13) {
    const x = Math.round(px / (preview.width - 1) * (full.width - 1)), y = Math.round(py / (preview.height - 1) * (full.height - 1));
    const a = at(full, x, y), b = at(preview, px, py);
    assert.ok(Math.abs(a[0] - b[0]) <= 2 && Math.abs(a[1] - b[1]) <= 2);
  }
});

test('local edits compose with two-axis seam maps and preserve chosen shape alpha', () => {
  const req = request(source(160, 120)); req.settings = { ...req.settings, contentAmount: 1, width: 125, height: 100, shape: 'heart' };
  for (let y = 20; y < 90; y++) for (let x = 60; x < 90; x++) req.mask[y * 160 + x] = 1;
  const base = renderImage(req).image;
  const output = renderImage({ ...req, localEdits: [operation({ scaleX: 1.5, scaleY: 0.65 }), operation({ id: 'push', kind: 'push', dx: 0.04, dy: -0.02 })] }).image;
  let changed = 0;
  for (let i = 0; i < output.data.length; i += 4) {
    assert.equal(output.data[i + 3], base.data[i + 3]);
    if (output.data[i] !== base.data[i]) changed++;
  }
  assert.ok(changed > 100, 'local effects should be visible on shaped content');
});

test('malformed saved local edits fail and old projects get an empty operation stack', () => {
  assert.deepEqual(parseLocalEdits(undefined), []);
  assert.deepEqual(parseLocalEdits([operation()]), [operation()]);
  for (const value of [null, {}, [null], [operation({ id: 'a' }), operation({ id: 'a' })], [{ ...operation(), scaleX: NaN }],
    [{ ...operation(), scaleY: 99 }], [{ ...operation(), kind: 'unknown' }], Array.from({ length: MAX_LOCAL_EDITS + 1 }, (_, i) => operation({ id: String(i) }))]) {
    assert.throws(() => parseLocalEdits(value), /局部塑形/);
  }
  const malformed = operation({ cx: Infinity, rx: NaN, angle: NaN, scaleX: Infinity });
  const point = createLocalMapper([malformed], 100, 100).map(0.5, 0.5);
  assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
});
