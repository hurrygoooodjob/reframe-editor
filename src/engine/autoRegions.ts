import type { AutoRegionsRequest, AutoRegionsResult } from '../types';

/** Classless, local saliency. This deliberately makes no object/face recognition claim.
 * Colour contrast proposes foreground; border similarity and low texture propose
 * expendable background. A seed changes thresholds/soft background weights, never
 * replaces the image evidence with random geometric selections. */
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a: number, b: number, v: number) => { const t = clamp((v - a) / Math.max(1e-8, b - a)); return t * t * (3 - 2 * t); };
const linear = Float32Array.from({ length: 256 }, (_, n) => { const s = n / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
function lab(r: number, g: number, b: number): [number, number, number] {
  const f = (n: number) => n > 0.008856 ? Math.cbrt(n) : 7.787 * n + 16 / 116;
  r = linear[Math.round(r)]; g = linear[Math.round(g)]; b = linear[Math.round(b)];
  const x = f((r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047);
  const y = f(r * 0.2126729 + g * 0.7151522 + b * 0.072175);
  const z = f((r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883);
  return [(116 * y - 16) / 100, (500 * (x - y)) / 100, (200 * (y - z)) / 100];
}
function distance(a: ArrayLike<number>, b: ArrayLike<number>) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
function random(seed: number) { let s = seed >>> 0; return () => { s += 0x6d2b79f5; let t = Math.imul(s ^ s >>> 15, 1 | s); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function quantile(values: number[], p: number) { return values.length ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))] : 0; }

/** Box blur with clamped boundaries, linear in pixel count and independent of radius. */
function blur(values: Float32Array, w: number, h: number, radius: number) {
  const temp = new Float32Array(values.length), out = new Float32Array(values.length), divisor = 2 * radius + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0; for (let d = -radius; d <= radius; d++) sum += values[y * w + clamp(d, 0, w - 1)];
    for (let x = 0; x < w; x++) { temp[y * w + x] = sum / divisor; sum += values[y * w + Math.min(w - 1, x + radius + 1)] - values[y * w + Math.max(0, x - radius)]; }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0; for (let d = -radius; d <= radius; d++) sum += temp[clamp(d, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = sum / divisor; sum += temp[Math.min(h - 1, y + radius + 1) * w + x] - temp[Math.max(0, y - radius) * w + x]; }
  }
  return out;
}
function sample(values: Float32Array, w: number, h: number, x: number, y: number) {
  x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1), tx = x - x0, ty = y - y0;
  return (values[y0 * w + x0] * (1 - tx) + values[y0 * w + x1] * tx) * (1 - ty)
    + (values[y1 * w + x0] * (1 - tx) + values[y1 * w + x1] * tx) * ty;
}
function components(selection: Uint8Array, w: number, h: number, minimum: number, mutate: boolean) {
  const seen = new Uint8Array(selection.length), queue = new Int32Array(selection.length); let count = 0;
  for (let start = 0; start < selection.length; start++) {
    if (!selection[start] || seen[start]) continue;
    let head = 0, tail = 1; queue[0] = start; seen[start] = 1;
    while (head < tail) {
      const i = queue[head++], x = i % w, y = Math.floor(i / w);
      const visit = (next: number) => { if (selection[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; } };
      if (x > 0) visit(i - 1); if (x + 1 < w) visit(i + 1); if (y > 0) visit(i - w); if (y + 1 < h) visit(i + w);
    }
    if (tail >= minimum) count++; else if (mutate) for (let k = 0; k < tail; k++) selection[queue[k]] = 0;
  }
  return count;
}
interface Palette { count: number; border: number; r: number; g: number; b: number; lab: [number, number, number]; contrast: number; background: number; expendable: number; }

export function analyzeRegions(request: AutoRegionsRequest, onProgress?: (progress: number, label: string) => void): AutoRegionsResult {
  const started = performance.now(), { image, maskWidth, maskHeight } = request;
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > 40_000_000 || image.data.length !== image.width * image.height * 4) throw new Error('图片像素数据无效或过大');
  if (!Number.isInteger(maskWidth) || !Number.isInteger(maskHeight) || maskWidth < 1 || maskHeight < 1 || maskWidth > 2048 || maskHeight > 2048 || maskWidth * maskHeight > 1_048_576) throw new Error('选区尺寸无效或过大');
  if (!Number.isFinite(request.seed)) throw new Error('随机种子无效');
  onProgress?.(0, '分析图片颜色');
  const mask = new Float32Array(maskWidth * maskHeight), warnings: string[] = [];
  const finishEmpty = (warning: string): AutoRegionsResult => { onProgress?.(1, '分析完成'); return { mask, protectRatio: 0, compressRatio: 0, confidence: 'low', regionCount: 0, warnings: [warning], elapsedMs: performance.now() - started }; };
  const scale = Math.min(1, 192 / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * scale)), h = Math.max(1, Math.round(image.height * scale)), n = w * h;
  const alpha = new Float32Array(n), luminance = new Float32Array(n), bins = new Uint16Array(n);
  const palettes = new Map<number, Palette>(); let visible = 0, weight = 0, transparent = 0;
  // Four samples per output cell suppress high-resolution aliasing without scanning
  // a 40 MP original. Invisible RGB never enters the palette or saliency statistics.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let red = 0, green = 0, blue = 0, coverage = 0;
    for (const oy of [0.25, 0.75]) for (const ox of [0.25, 0.75]) {
      const sx = Math.min(image.width - 1, Math.floor((x + ox) * image.width / w)), sy = Math.min(image.height - 1, Math.floor((y + oy) * image.height / h));
      const j = (sy * image.width + sx) * 4, a = image.data[j + 3] / 255;
      red += image.data[j] * a; green += image.data[j + 1] * a; blue += image.data[j + 2] * a; coverage += a;
    }
    const i = y * w + x; alpha[i] = coverage / 4;
    if (alpha[i] < 0.05) { transparent++; continue; }
    red /= coverage; green /= coverage; blue /= coverage; visible++; weight += alpha[i];
    const key = (Math.min(7, red >> 5) << 6) | (Math.min(7, green >> 5) << 3) | Math.min(7, blue >> 5); bins[i] = key;
    let p = palettes.get(key); if (!p) { p = { count: 0, border: 0, r: 0, g: 0, b: 0, lab: [0, 0, 0], contrast: 0, background: 0, expendable: Infinity }; palettes.set(key, p); }
    p.count += alpha[i]; p.r += red * alpha[i]; p.g += green * alpha[i]; p.b += blue * alpha[i];
    if (x < w * 0.075 || x >= w * 0.925 || y < h * 0.075 || y >= h * 0.925) p.border += alpha[i];
    luminance[i] = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  }
  if (visible < Math.max(1, n * 0.002)) return finishEmpty('图片几乎全透明，没有足够的可见内容可识别。');
  const palette = [...palettes.values()];
  for (const p of palette) p.lab = lab(p.r / p.count, p.g / p.count, p.b / p.count);
  for (const p of palette) for (const q of palette) p.contrast += distance(p.lab, q.lab) * q.count / weight;
  const boundary = palette.filter(p => p.border > 0).sort((a, b) => b.border - a.border), backgrounds: Palette[] = [];
  const borderTotal = boundary.reduce((sum, p) => sum + p.border, 0); let borderCount = 0;
  for (const p of boundary) { backgrounds.push(p); borderCount += p.border; if (borderCount >= borderTotal * 0.82 || backgrounds.length >= 18) break; }
  for (const p of palette) p.background = backgrounds.length ? Math.min(...backgrounds.map(q => distance(p.lab, q.lab))) : 0;
  // A dark, smooth jacket may have low global saliency but is not necessarily
  // background. Only colours near the dominant border-colour cluster are eligible
  // for negative weights. Distinct secondary border objects stay neutral.
  let dominant: Palette | undefined, dominantSupport = 0;
  for (const p of boundary) {
    const support = boundary.reduce((sum, q) => sum + q.border * Math.exp(-((distance(p.lab, q.lab) / 0.20) ** 2)), 0);
    if (support > dominantSupport) { dominantSupport = support; dominant = p; }
  }
  const expendableBackground = dominant ? boundary.filter(p => distance(p.lab, dominant!.lab) < 0.24) : [];
  for (const p of palette) if (expendableBackground.length) p.expendable = Math.min(...expendableBackground.map(q => distance(p.lab, q.lab)));
  onProgress?.(0.3, '寻找显著内容与平缓背景');
  const contrastValues: number[] = []; for (let i = 0; i < n; i++) if (alpha[i] >= 0.05) contrastValues.push(palettes.get(bins[i])!.contrast);
  contrastValues.sort((a, b) => a - b);
  const minContrast = quantile(contrastValues, 0.03), maxContrast = quantile(contrastValues, 0.985), contrastRange = maxContrast - minContrast;
  const meanContrast = palette.reduce((sum, p) => sum + p.contrast * p.count / weight, 0);
  const alphaSubject = transparent / n > 0.18 && visible / n < 0.50;
  if (!alphaSubject && (palette.length < 2 || contrastRange < 0.025 || meanContrast < 0.035)) return finishEmpty('画面对比度低或内容分布过于均匀，暂未找到可靠的保护区域；可继续手动涂抹。');
  const blurredLuma = blur(luminance, w, h, Math.max(1, Math.round(Math.min(w, h) / 32)));
  const texture = new Float32Array(n), score = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (alpha[i] < 0.05) continue;
    const p = palettes.get(bins[i])!, l = luminance[i];
    const dx = Math.abs(luminance[y * w + Math.max(0, x - 1)] - luminance[y * w + Math.min(w - 1, x + 1)]);
    const dy = Math.abs(luminance[Math.max(0, y - 1) * w + x] - luminance[Math.min(h - 1, y + 1) * w + x]);
    texture[i] = clamp((dx + dy) * 2.3);
    const center = 1 - Math.min(1, Math.hypot((x + 0.5) / w - 0.5, (y + 0.5) / h - 0.5) / 0.707);
    score[i] = alphaSubject ? alpha[i] : clamp(0.70 * clamp((p.contrast - minContrast) / Math.max(0.025, contrastRange))
      + 0.23 * clamp(p.background / 0.40) + 0.05 * clamp(Math.abs(l - blurredLuma[i]) / 0.16) + 0.02 * center);
  }
  const scores = blur(score, w, h, Math.max(1, Math.round(Math.min(w, h) / 100)));
  const textures = blur(texture, w, h, 2), rng = random(request.seed), thresholdVariation = (rng() - 0.5) * 0.05;
  const sortedScores = Array.from(scores).filter((_, i) => alpha[i] >= 0.05).sort((a, b) => a - b);
  // Rank cap prevents a global colour cast/large background from being marked as
  // an all-covering foreground. Constant score plateaus remain neutral.
  const protectThreshold = alphaSubject ? 0.58 : Math.max(0.46 + thresholdVariation, quantile(sortedScores, 0.68));
  const protection = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (alpha[i] > 0.15 && scores[i] > protectThreshold) protection[i] = 1;
  const componentMinimum = Math.max(2, Math.round(n * 0.0013));
  components(protection, w, h, componentMinimum, true);
  // A conservative halo prevents the negative background from touching the
  // protected contour; soft positive weights keep boundaries editable.
  const protectedFloat = Float32Array.from(protection), halo = blur(protectedFloat, w, h, 3), softened = blur(protectedFloat, w, h, 1);
  const resultSmall = new Float32Array(n), compressLimit = Math.min(0.29, quantile(sortedScores, 0.55) + 0.045 + rng() * 0.04);
  const phaseX = rng() * Math.PI * 2, phaseY = rng() * Math.PI * 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (alpha[i] < 0.08) continue;
    if (softened[i] > 0.10) resultSmall[i] = (0.48 + 0.48 * smoothstep(0.10, 0.9, softened[i])) * Math.min(1, alpha[i] * 2);
    else if (!alphaSubject && halo[i] < 0.01 && scores[i] < compressLimit && textures[i] < 0.18 && palettes.get(bins[i])!.expendable < 0.10) {
      // Smooth, seed-dependent confidence weights give repeatable alternatives
      // without punching arbitrary random holes into the detected subject.
      const variation = 0.5 + 0.25 * Math.sin(x / Math.max(1, w) * 5 + phaseX) + 0.25 * Math.cos(y / Math.max(1, h) * 5 + phaseY);
      resultSmall[i] = -(0.25 + 0.27 * variation) * (1 - 0.45 * textures[i] / 0.18);
    }
  }
  // Background must also connect to an outer edge through eligible, visually
  // similar pixels. This stops a blue shirt enclosed by its silhouette from
  // being compressed merely because a blue backdrop shares its colour.
  const exterior = new Uint8Array(n), flood = new Int32Array(n); let head = 0, tail = 0;
  const seedExterior = (i: number) => { if (!exterior[i] && resultSmall[i] < 0) { exterior[i] = 1; flood[tail++] = i; } };
  for (let x = 0; x < w; x++) { seedExterior(x); seedExterior((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seedExterior(y * w); seedExterior(y * w + w - 1); }
  while (head < tail) {
    const i = flood[head++], x = i % w, y = Math.floor(i / w), colour = palettes.get(bins[i])!.lab;
    const visit = (j: number) => { if (!exterior[j] && resultSmall[j] < 0 && distance(colour, palettes.get(bins[j])!.lab) < 0.13) { exterior[j] = 1; flood[tail++] = j; } };
    if (x > 0) visit(i - 1); if (x + 1 < w) visit(i + 1); if (y > 0) visit(i - w); if (y + 1 < h) visit(i + w);
  }
  for (let i = 0; i < n; i++) if (resultSmall[i] < 0 && !exterior[i]) resultSmall[i] = 0;
  onProgress?.(0.75, '生成可编辑选区');
  let positives = 0, negatives = 0;
  const positiveSelection = new Uint8Array(mask.length);
  for (let y = 0; y < maskHeight; y++) for (let x = 0; x < maskWidth; x++) {
    const gx = (x + 0.5) * w / maskWidth - 0.5, gy = (y + 0.5) * h / maskHeight - 0.5;
    let v = sample(resultSmall, w, h, gx, gy);
    // Check original alpha, so resampling cannot paint over invisible RGB.
    const sx = Math.min(image.width - 1, Math.floor((x + 0.5) * image.width / maskWidth)), sy = Math.min(image.height - 1, Math.floor((y + 0.5) * image.height / maskHeight));
    if (image.data[(sy * image.width + sx) * 4 + 3] < 12 || Math.abs(v) <= 0.10) v = 0;
    mask[y * maskWidth + x] = v;
    if (v > 0) { positives++; positiveSelection[y * maskWidth + x] = 1; } else if (v < 0) negatives++;
  }
  const protectRatio = positives / mask.length, compressRatio = negatives / mask.length;
  const regionCount = components(positiveSelection, maskWidth, maskHeight, 1, false);
  let confidence: AutoRegionsResult['confidence'] = 'medium';
  if (!positives || protectRatio < 0.007 || contrastRange < 0.06 || regionCount > 12) { confidence = 'low'; warnings.push('这张图片的显著区域较分散或不明确，建议检查绿色选区后再挤压。'); }
  else if (!alphaSubject && contrastRange > 0.18 && meanContrast > 0.08 && regionCount <= 5 && compressRatio > 0.15) confidence = 'high';
  if (alphaSubject) warnings.push('根据透明轮廓保护可见内容，透明背景保持中性。');
  if (compressRatio < 0.02 && !alphaSubject) warnings.push('未找到足够平缓的背景，优先压缩区域较少。');
  onProgress?.(1, '自动选区完成');
  return { mask, protectRatio, compressRatio, confidence, regionCount, warnings, elapsedMs: performance.now() - started };
}
