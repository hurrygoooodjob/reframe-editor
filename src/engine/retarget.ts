import type { PixelImage, RenderRequest, RenderResult, ShapeId } from '../types';
import { featherProtection, softenMonotoneMap } from './softenMap';
import { createLocalMapper } from './localWarp';

/** The small analysis image retains a two-dimensional map to the immutable original.
 * Seam removal/insertion changes this map; the final pass samples the original pixels.
 * This avoids exporting an upscaled analysis thumbnail. Protection is a soft constraint. */
interface Grid {
  w: number; h: number;
  x: Float32Array; y: Float32Array;
  rgba: Uint8ClampedArray; mask: Float32Array;
}
type Interval = [number, number];
const LIMITS = { draft: 256, balanced: 448, fine: 768 };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const finite = (n: number, fallback: number) => Number.isFinite(n) ? n : fallback;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Premultiplied-alpha interpolation prevents invisible RGB from creating colored fringes.
function samplePixel(image: PixelImage, x: number, y: number, target: Uint8ClampedArray, offset: number, coverage = 1) {
  x = clamp(x, 0, image.width - 1); y = clamp(y, 0, image.height - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, image.width - 1), y1 = Math.min(y0 + 1, image.height - 1);
  const tx = x - x0, ty = y - y0, data = image.data;
  const a = (y0 * image.width + x0) * 4, b = (y0 * image.width + x1) * 4;
  const c = (y1 * image.width + x0) * 4, d = (y1 * image.width + x1) * 4;
  const wa = (1 - tx) * (1 - ty) * data[a + 3], wb = tx * (1 - ty) * data[b + 3];
  const wc = (1 - tx) * ty * data[c + 3], wd = tx * ty * data[d + 3];
  const alpha = wa + wb + wc + wd;
  if (alpha > 0.0001) {
    target[offset] = (wa * data[a] + wb * data[b] + wc * data[c] + wd * data[d]) / alpha;
    target[offset + 1] = (wa * data[a + 1] + wb * data[b + 1] + wc * data[c + 1] + wd * data[d + 1]) / alpha;
    target[offset + 2] = (wa * data[a + 2] + wb * data[b + 2] + wc * data[c + 2] + wd * data[d + 2]) / alpha;
    target[offset + 3] = alpha * coverage;
  }
}

function makeGrid(request: RenderRequest, edge: number): Grid {
  const { image, mask, maskWidth, maskHeight } = request;
  const scale = Math.min(1, edge / Math.max(image.width, image.height));
  // Retain two endpoint coordinates on every non-degenerate axis, even for panoramas.
  const w = Math.max(image.width > 1 ? 2 : 1, Math.round(image.width * scale));
  const h = Math.max(image.height > 1 ? 2 : 1, Math.round(image.height * scale));
  const grid: Grid = { w, h, x: new Float32Array(w * h), y: new Float32Array(w * h),
    rgba: new Uint8ClampedArray(w * h * 4), mask: new Float32Array(w * h) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    grid.x[i] = w === 1 ? (image.width - 1) / 2 : x * (image.width - 1) / (w - 1);
    grid.y[i] = h === 1 ? (image.height - 1) / 2 : y * (image.height - 1) / (h - 1);
    samplePixel(image, grid.x[i], grid.y[i], grid.rgba, i * 4);
  }
  // Pool mask coverage, retaining thin protection strokes even on a coarse analysis grid.
  if (maskWidth > 0 && maskHeight > 0 && mask.length === maskWidth * maskHeight) {
    for (let y = 0; y < maskHeight; y++) {
      const gy = maskHeight === 1 ? 0 : Math.round(y * (h - 1) / (maskHeight - 1));
      for (let x = 0; x < maskWidth; x++) {
        const m = clamp(finite(mask[y * maskWidth + x], 0), -1, 1);
        const gx = maskWidth === 1 ? 0 : Math.round(x * (w - 1) / (maskWidth - 1));
        const i = gy * w + gx;
        if (m > 0) grid.mask[i] = Math.max(grid.mask[i], m);
        else if (grid.mask[i] <= 0) grid.mask[i] = Math.min(grid.mask[i], m);
      }
    }
    // When the editable mask is smaller than the analysis grid, fill sampling gaps.
    if (maskWidth < w || maskHeight < h) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const mx = Math.round(x * (maskWidth - 1) / Math.max(1, w - 1));
      const my = Math.round(y * (maskHeight - 1) / Math.max(1, h - 1));
      grid.mask[y * w + x] = clamp(finite(mask[my * maskWidth + mx], 0), -1, 1);
    }
  }
  return grid;
}

function colorDistance(rgba: Uint8ClampedArray, a: number, b: number) {
  a *= 4; b *= 4;
  const aa = rgba[a + 3] / 255, ab = rgba[b + 3] / 255;
  return (Math.abs(rgba[a] * aa - rgba[b] * ab) + Math.abs(rgba[a + 1] * aa - rgba[b + 1] * ab)
    + Math.abs(rgba[a + 2] * aa - rgba[b + 2] * ab)) / 3 + Math.abs(rgba[a + 3] - rgba[b + 3]);
}

/** Dynamic programming with backward gradient energy and optional forward disruption cost. */
function findSeam(grid: Grid, forward: boolean, protectStrength: number): Int32Array {
  const { w, h, rgba, mask } = grid;
  const directions = new Int8Array(w * h);
  let previous = new Float64Array(w), current = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, left = y * w + Math.max(0, x - 1), right = y * w + Math.min(w - 1, x + 1);
      const up = Math.max(0, y - 1) * w + x, down = Math.min(h - 1, y + 1) * w + x;
      let energy = colorDistance(rgba, left, right) + colorDistance(rgba, up, down);
      const m = mask[i];
      energy += m > 0 ? m * protectStrength * 100000 : m * 10000;
      if (y === 0) { current[x] = energy; continue; }
      const across = forward ? colorDistance(rgba, left, right) : 0;
      let best = previous[x] + across, direction = 0;
      if (x > 0) {
        const candidate = previous[x - 1] + across + (forward ? colorDistance(rgba, up, left) : 0);
        if (candidate < best) { best = candidate; direction = -1; }
      }
      if (x < w - 1) {
        const candidate = previous[x + 1] + across + (forward ? colorDistance(rgba, up, right) : 0);
        if (candidate < best) { best = candidate; direction = 1; }
      }
      current[x] = energy + best; directions[i] = direction;
    }
    [previous, current] = [current, previous];
  }
  let end = 0;
  for (let x = 1; x < w; x++) if (previous[x] < previous[end]) end = x;
  const seam = new Int32Array(h);
  for (let y = h - 1; y >= 0; y--) { seam[y] = end; end += directions[y * w + end]; }
  return seam;
}

function removeSeam(grid: Grid, seam: Int32Array): Grid {
  const w = grid.w - 1, h = grid.h;
  const next: Grid = { w, h, x: new Float32Array(w * h), y: new Float32Array(w * h),
    rgba: new Uint8ClampedArray(w * h * 4), mask: new Float32Array(w * h) };
  for (let y = 0; y < h; y++) {
    const cut = seam[y], source = y * grid.w, dest = y * w;
    for (const key of ['x', 'y', 'mask'] as const) {
      next[key].set(grid[key].subarray(source, source + cut), dest);
      next[key].set(grid[key].subarray(source + cut + 1, source + grid.w), dest + cut);
    }
    next.rgba.set(grid.rgba.subarray(source * 4, (source + cut) * 4), dest * 4);
    next.rgba.set(grid.rgba.subarray((source + cut + 1) * 4, (source + grid.w) * 4), (dest + cut) * 4);
  }
  return next;
}

function transpose(grid: Grid): Grid {
  const out: Grid = { w: grid.h, h: grid.w, x: new Float32Array(grid.x.length), y: new Float32Array(grid.y.length),
    rgba: new Uint8ClampedArray(grid.rgba.length), mask: new Float32Array(grid.mask.length) };
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
    const from = y * grid.w + x, to = x * out.w + y;
    out.x[to] = grid.x[from]; out.y[to] = grid.y[from]; out.mask[to] = grid.mask[from];
    out.rgba.set(grid.rgba.subarray(from * 4, from * 4 + 4), to * 4);
  }
  return out;
}

/** Find independent seams on a shrinking copy, then insert them together into the original.
 * Re-inserting the current cheapest seam repeatedly would stretch one line into a stripe. */
function insertBatch(grid: Grid, count: number, forward: boolean, strength: number, step: () => void): Grid {
  if (grid.w === 1) {
    const out: Grid = { w: 1 + count, h: grid.h, x: new Float32Array((1 + count) * grid.h),
      y: new Float32Array((1 + count) * grid.h), mask: new Float32Array((1 + count) * grid.h),
      rgba: new Uint8ClampedArray((1 + count) * grid.h * 4) };
    for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
      const i = y * out.w + x;
      out.x[i] = grid.x[y]; out.y[i] = grid.y[y]; out.mask[i] = grid.mask[y];
      out.rgba.set(grid.rgba.subarray(y * 4, y * 4 + 4), i * 4);
    }
    for (let i = 0; i < count; i++) step();
    return out;
  }
  const selected = new Uint8Array(grid.w * grid.h);
  let work = grid, ids = new Int32Array(grid.w * grid.h);
  for (let i = 0; i < ids.length; i++) ids[i] = i % grid.w;
  for (let n = 0; n < count; n++) {
    const seam = findSeam(work, forward, strength);
    const nextIds = new Int32Array((work.w - 1) * work.h);
    for (let y = 0; y < work.h; y++) {
      const cut = seam[y], start = y * work.w, dest = y * (work.w - 1);
      selected[y * grid.w + ids[start + cut]] = 1;
      nextIds.set(ids.subarray(start, start + cut), dest);
      nextIds.set(ids.subarray(start + cut + 1, start + work.w), dest + cut);
    }
    work = removeSeam(work, seam); ids = nextIds; step();
  }
  const w = grid.w + count, h = grid.h;
  const out: Grid = { w, h, x: new Float32Array(w * h), y: new Float32Array(w * h),
    rgba: new Uint8ClampedArray(w * h * 4), mask: new Float32Array(w * h) };
  for (let y = 0; y < h; y++) {
    let dx = 0;
    for (let x = 0; x < grid.w; x++) {
      const i = y * grid.w + x, o = y * w + dx++;
      out.x[o] = grid.x[i]; out.y[o] = grid.y[i]; out.mask[o] = grid.mask[i];
      out.rgba.set(grid.rgba.subarray(i * 4, i * 4 + 4), o * 4);
      if (selected[i]) {
        const j = y * grid.w + Math.min(grid.w - 1, x + 1), added = y * w + dx++;
        out.x[added] = (grid.x[i] + grid.x[j]) / 2; out.y[added] = (grid.y[i] + grid.y[j]) / 2;
        out.mask[added] = Math.max(grid.mask[i], grid.mask[j]);
        const alpha = grid.rgba[i * 4 + 3] + grid.rgba[j * 4 + 3];
        for (let c = 0; c < 3; c++) out.rgba[added * 4 + c] = alpha
          ? (grid.rgba[i * 4 + c] * grid.rgba[i * 4 + 3] + grid.rgba[j * 4 + c] * grid.rgba[j * 4 + 3]) / alpha : 0;
        out.rgba[added * 4 + 3] = alpha / 2;
      }
    }
  }
  return out;
}

function resizeWidth(grid: Grid, target: number, forward: boolean, strength: number, step: () => void): Grid {
  while (grid.w > target) { grid = removeSeam(grid, findSeam(grid, forward, strength)); step(); }
  while (grid.w < target) {
    const batch = grid.w === 1 ? target - 1 : Math.min(target - grid.w, Math.max(1, Math.floor(grid.w * 0.6)), grid.w - 1);
    grid = insertBatch(grid, batch, forward, strength, step);
  }
  return grid;
}

function polygon(shape: ShapeId): [number, number][] {
  if (shape === 'triangle') return [[0.5, 0], [1, 1], [0, 1]];
  if (shape === 'diamond') return [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
  if (shape === 'hexagon') return [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]];
  const points: [number, number][] = [];
  if (shape === 'star') for (let i = 0; i < 10; i++) {
    const theta = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 === 0 ? 1 : 0.45;
    points.push([Math.cos(theta) * r, Math.sin(theta) * r]);
  }
  if (shape === 'heart') for (let i = 0; i < 160; i++) {
    const t = i / 160 * Math.PI * 2;
    points.push([16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]);
  }
  if (points.length) {
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    return points.map(([x, y]) => [(x - x0) / (x1 - x0), (y - y0) / (y1 - y0)]);
  }
  return [];
}

function intervalsAt(shape: ShapeId, y: number, points: [number, number][]): Interval[] {
  if (shape === 'rect') return [[0, 1]];
  if (shape === 'ellipse') {
    const half = Math.sqrt(Math.max(0, 1 - (y * 2 - 1) ** 2)) / 2;
    return [[0.5 - half, 0.5 + half]];
  }
  const hits: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) hits.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
  }
  hits.sort((a, b) => a - b);
  const spans: Interval[] = [];
  for (let i = 0; i + 1 < hits.length; i += 2) spans.push([clamp(hits[i], 0, 1), clamp(hits[i + 1], 0, 1)]);
  return spans;
}

function sampleMap(grid: Grid, gx: number, gy: number, image: PixelImage, out: Uint8ClampedArray, offset: number, coverage: number, widthStage?: Grid) {
  gx = clamp(gx, 0, grid.w - 1); gy = clamp(gy, 0, grid.h - 1);
  const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(x0 + 1, grid.w - 1), y1 = Math.min(y0 + 1, grid.h - 1);
  const a = y0 * grid.w + x0, b = y0 * grid.w + x1, c = y1 * grid.w + x0, d = y1 * grid.w + x1;
  const tx = gx - x0, ty = gy - y0;
  let sx = lerp(lerp(grid.x[a], grid.x[b], tx), lerp(grid.x[c], grid.x[d], tx), ty);
  const sy = lerp(lerp(grid.y[a], grid.y[b], tx), lerp(grid.y[c], grid.y[d], tx), ty);
  if (widthStage) {
    // Evaluate the continuous composition here. Baking it into a 2D mesh and
    // interpolating that mesh again can fold a very steep, coarse grid cell.
    const sourceRow = image.height > 1 ? clamp(sy * (widthStage.h - 1) / (image.height - 1), 0, widthStage.h - 1) : 0;
    const row0 = Math.floor(sourceRow), row1 = Math.min(row0 + 1, widthStage.h - 1), fraction = sourceRow - row0;
    sx = lerp(lerp(widthStage.x[row0 * grid.w + x0], widthStage.x[row0 * grid.w + x1], tx),
      lerp(widthStage.x[row1 * grid.w + x0], widthStage.x[row1 * grid.w + x1], tx), fraction);
  }
  samplePixel(image, sx, sy, out, offset, coverage);
}

/** Allocate more of a squeezed scanline to protected source pixels. The CDF is inverted
 * in the raster loop. If the available contour is too small, all content must compress. */
function shapeCDF(grid: Grid, gy: number, occupied: number, strength: number, cdf: Float32Array, weights: Float32Array, softMask?: Float32Array): boolean {
  const cy = Math.round(gy);
  let protectedFraction = 0;
  for (let x = 0; x < grid.w; x++) {
    let m = 0, n = 0;
    if (softMask) {
      // Interpolate the protection field vertically rather than rounding every
      // output row to one analysis row (which creates visible horizontal steps).
      const y0 = Math.floor(gy), y1 = Math.min(y0 + 1, grid.h - 1);
      m = lerp(softMask[y0 * grid.w + x], softMask[y1 * grid.w + x], gy - y0); n = 1;
    } else for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const weight = (3 - Math.abs(dx)) * (3 - Math.abs(dy));
      m += Math.max(0, grid.mask[clamp(cy + dy, 0, grid.h - 1) * grid.w + clamp(x + dx, 0, grid.w - 1)]) * weight;
      n += weight;
    }
    weights[x] = clamp(m / n * strength, 0, 1); protectedFraction += weights[x];
  }
  protectedFraction /= grid.w;
  const backgroundScale = clamp((occupied - protectedFraction) / Math.max(0.001, 1 - protectedFraction), 0.08, 1);
  cdf[0] = 0;
  for (let x = 1; x < grid.w; x++) {
    const protect = (weights[x - 1] + weights[x]) / 2;
    cdf[x] = cdf[x - 1] + backgroundScale + (1 - backgroundScale) * protect;
  }
  const total = cdf[grid.w - 1];
  if (total > 0) for (let x = 1; x < grid.w; x++) cdf[x] /= total;
  return protectedFraction > occupied * 0.9 && protectedFraction > 0.05;
}

export function renderImage(request: RenderRequest, onProgress?: (progress: number, label: string) => void): RenderResult {
  const started = performance.now(), { image, settings } = request;
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1
    || image.data.length !== image.width * image.height * 4) throw new Error('图片像素数据或尺寸无效。');
  if (!Number.isFinite(settings.width) || !Number.isFinite(settings.height) || settings.width < 1 || settings.height < 1)
    throw new Error('输出宽高必须是大于 0 的数字。');
  let outputWidth = Math.max(1, Math.round(settings.width)), outputHeight = Math.max(1, Math.round(settings.height));
  if (request.maxOutputEdge && Number.isFinite(request.maxOutputEdge) && request.maxOutputEdge > 0) {
    const scale = Math.min(1, request.maxOutputEdge / Math.max(outputWidth, outputHeight));
    outputWidth = Math.max(1, Math.round(outputWidth * scale)); outputHeight = Math.max(1, Math.round(outputHeight * scale));
  }
  if (outputWidth * outputHeight > 40_000_000 || outputWidth > 16384 || outputHeight > 16384)
    throw new Error('输出过大，请将尺寸调整到 4000 万像素以内，且单边不超过 16384 像素。');
  const warnings: string[] = [], amount = clamp(finite(settings.contentAmount, 1), 0, 1);
  const strength = clamp(finite(settings.protectStrength, 1), 0, 3), edge = LIMITS[settings.quality] || LIMITS.balanced;
  const softness = clamp(finite(settings.transitionSoftness, 0), 0, 1);
  onProgress?.(0.02, '分析图片与保护区域');
  let grid = makeGrid(request, edge);
  const analysisWidth = grid.w, analysisHeight = grid.h;
  const sourceGrid = grid;
  const rw = settings.width / image.width, rh = settings.height / image.height;
  let hasProtection = false, positive = 0;
  for (const value of grid.mask) if (value > 0.1) { hasProtection = true; positive++; }
  if (Math.min(rw, rh) < 0.45 || Math.max(rw, rh) > 1.8)
    warnings.push('尺寸变化较大，纹理和直线可能出现变形；可降低内容感知强度或分步调整。');
  if (hasProtection && strength > 0 && amount > 0 && positive / grid.mask.length > Math.min(rw, rh, 1) * 0.8)
    warnings.push('保护区域占比较大，目标尺寸可能无法同时保留所有区域的比例。');
  // Bound seam work for extreme inputs. The remaining size change uses smooth map scaling.
  const requestedW = Math.max(1, Math.round(grid.w * lerp(1, rw, amount)));
  const requestedH = Math.max(1, Math.round(grid.h * lerp(1, rh, amount)));
  const targetW = clamp(requestedW, Math.max(1, Math.round(grid.w * 0.15)), Math.max(grid.w, Math.round(edge * 1.5)));
  const targetH = clamp(requestedH, Math.max(1, Math.round(grid.h * 0.15)), Math.max(grid.h, Math.round(edge * 1.5)));
  if (requestedW !== targetW || requestedH !== targetH)
    warnings.push('极端尺寸超出接缝分析范围，剩余变化使用平滑缩放；可提高质量或减小尺寸变化。');
  const total = Math.abs(grid.w - targetW) + Math.abs(grid.h - targetH);
  let completed = 0;
  const step = () => {
    completed++;
    if (completed % 8 === 0 || completed === total) onProgress?.(0.04 + 0.72 * completed / Math.max(1, total), '计算内容感知接缝');
  };
  let widthStage: Grid | undefined;
  if (targetW !== grid.w) {
    grid = resizeWidth(grid, targetW, settings.forwardEnergy, strength, step);
    if (softness > 0) {
      grid.x = softenMonotoneMap(grid.x, grid.mask, grid.w, grid.h, softness, image.width - 1, strength);
      // The next axis must analyse the actual softened intermediate image and
      // its mask, not the stale seam-cut pixels at different source locations.
      grid.rgba.fill(0);
      for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
        const i = y * grid.w + x;
        samplePixel(image, grid.x[i], grid.y[i], grid.rgba, i * 4);
        const gx = image.width > 1 ? grid.x[i] * (sourceGrid.w - 1) / (image.width - 1) : 0;
        const x0 = Math.floor(gx), x1 = Math.min(sourceGrid.w - 1, x0 + 1);
        grid.mask[i] = lerp(sourceGrid.mask[y * sourceGrid.w + x0], sourceGrid.mask[y * sourceGrid.w + x1], gx - x0);
      }
    }
  }
  if (targetH !== grid.h) {
    // Compose two monotone 1D warps instead of averaging a coupled 2D mesh.
    // The latter can fold and tear when horizontal and vertical seams intersect.
    if (softness > 0) widthStage = grid;
    let vertical = resizeWidth(transpose(grid), targetH, settings.forwardEnergy, strength, step);
    if (softness > 0) vertical.y = softenMonotoneMap(vertical.y, vertical.mask, vertical.w, vertical.h,
      softness, image.height - 1, strength);
    grid = transpose(vertical);
  }
  onProgress?.(0.78, '映射形状与原图细节');
  const out = new Uint8ClampedArray(outputWidth * outputHeight * 4);
  const shape = settings.shape, points = polygon(shape), squeeze = clamp(finite(settings.squeeze, 0.85), 0, 1);
  const cdf = new Float32Array(grid.w), weights = new Float32Array(grid.w);
  const softMask = softness > 0 && hasProtection && shape !== 'rect' ? featherProtection(grid.mask, grid.w, grid.h, softness) : undefined;
  let shapeConflict = false;
  // Local operations are expressed on the visible output. Invert them BEFORE
  // evaluating shape and seam maps, then sample the immutable original once.
  // Use requested dimensions so preview/export have identical physical angles.
  const localMapper = createLocalMapper(request.localEdits, settings.width, settings.height);
  const localPoint = { x: 0, y: 0 };
  const localCDFs = new Map<number, Float32Array>();
  const localProtected = hasProtection && strength > 0 && shape !== 'rect' && squeeze > 0 && grid.w > 1;
  function cdfAtRow(row: number): Float32Array {
    const cached = localCDFs.get(row); if (cached) return cached;
    const rowCDF = new Float32Array(grid.w);
    const spans = intervalsAt(shape, (row + 0.5) / outputHeight, points);
    const occupied = spans.reduce((sum, [a, b]) => sum + b - a, 0);
    const gy = outputHeight === 1 ? (grid.h - 1) / 2 : row * (grid.h - 1) / (outputHeight - 1);
    shapeConflict = shapeCDF(grid, gy, occupied, strength, rowCDF, weights, softMask) || shapeConflict;
    localCDFs.set(row, rowCDF); return rowCDF;
  }
  function localShapeX(px: number, py: number): number {
    if (shape === 'rect') return px;
    const sourceRow = py * Math.max(0, outputHeight - 1);
    const spans = intervalsAt(shape, (sourceRow + 0.5) / outputHeight, points);
    const occupied = spans.reduce((sum, [a, b]) => sum + b - a, 0);
    if (!spans.length || occupied < 1e-9) return px;
    // Keep the user's chosen outer silhouette. A local pull beyond that
    // silhouette reaches its nearest edge instead of creating internal holes.
    const query = (px * Math.max(0, outputWidth - 1) + 0.5) / outputWidth;
    let arc = 0, closest = Infinity, selected = 0;
    for (const [a, b] of spans) {
      const within = clamp(query, a, b), distance = Math.abs(query - within);
      if (distance < closest) { closest = distance; selected = arc + within - a; }
      arc += b - a;
    }
    let shaped = clamp(selected / occupied, 0, 1);
    if (localProtected) {
      const row0 = Math.floor(sourceRow), row1 = Math.min(row0 + 1, outputHeight - 1), fraction = sourceRow - row0;
      const c0 = cdfAtRow(row0), c1 = cdfAtRow(row1);
      let lo = 0, hi = grid.w - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (lerp(c0[mid], c1[mid], fraction) < shaped) lo = mid; else hi = mid;
      }
      const left = lerp(c0[lo], c1[lo], fraction), right = lerp(c0[hi], c1[hi], fraction);
      shaped = (lo + (shaped - left) / Math.max(1e-7, right - left)) / (grid.w - 1);
    }
    return lerp(px, clamp(shaped, 0, 1), squeeze);
  }
  for (let y = 0; y < outputHeight; y++) {
    const gy = outputHeight === 1 ? (grid.h - 1) / 2 : y * (grid.h - 1) / (outputHeight - 1);
    const spans = intervalsAt(shape, (y + 0.5) / outputHeight, points);
    let occupied = 0;
    for (const [a, b] of spans) occupied += b - a;
    const useProtection = hasProtection && strength > 0 && shape !== 'rect' && squeeze > 0 && grid.w > 1;
    if (useProtection) shapeConflict = shapeCDF(grid, gy, occupied, strength, cdf, weights, softMask) || shapeConflict;
    let arcBefore = 0, cdfIndex = 0;
    for (const [a, b] of spans) {
      const left = a * outputWidth, right = b * outputWidth;
      for (let x = Math.max(0, Math.floor(left)); x < Math.min(outputWidth, Math.ceil(right)); x++) {
        const coverage = Math.max(0, Math.min(x + 1, right) - Math.max(x, left));
        if (coverage <= 0) continue;
        const base = outputWidth === 1 ? 0.5 : x / (outputWidth - 1);
        let shaped = clamp((arcBefore + (x + 0.5) / outputWidth - a) / Math.max(0.0000001, occupied), 0, 1);
        if (useProtection) {
          while (cdfIndex < grid.w - 2 && cdf[cdfIndex + 1] < shaped) cdfIndex++;
          shaped = (cdfIndex + (shaped - cdf[cdfIndex]) / Math.max(0.0000001, cdf[cdfIndex + 1] - cdf[cdfIndex])) / (grid.w - 1);
        }
        const nx = shape === 'rect' ? base : lerp(base, shaped, squeeze);
        let sampleX = nx * (grid.w - 1), sampleY = gy;
        if (localMapper.active) {
          const baseY = outputHeight === 1 ? 0.5 : y / (outputHeight - 1);
          localMapper.map(base, baseY, localPoint);
          if (Math.abs(localPoint.x - base) > 1e-12 || Math.abs(localPoint.y - baseY) > 1e-12) {
            const px = clamp(localPoint.x, 0, 1), py = clamp(localPoint.y, 0, 1);
            sampleX = localShapeX(px, py) * (grid.w - 1); sampleY = py * (grid.h - 1);
          }
        }
        sampleMap(grid, sampleX, sampleY, image, out, (y * outputWidth + x) * 4, coverage, widthStage);
      }
      arcBefore += b - a;
    }
    if (y % 64 === 0) onProgress?.(0.78 + 0.21 * y / outputHeight, '生成输出像素');
  }
  if (shapeConflict) warnings.push('形状尖端空间不足，保护区域仍会被挤压；请降低挤压强度或改用更宽的轮廓。');
  onProgress?.(1, '处理完成');
  return { image: { width: outputWidth, height: outputHeight, data: out }, elapsedMs: performance.now() - started,
    analysisWidth, analysisHeight, warnings };
}
