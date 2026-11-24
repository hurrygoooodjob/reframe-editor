import { normalizeEffect, type EffectSettings } from './catalog';
import { brushFalloff, type Point } from '../components/canvasGeometry';
import type { PixelSize } from '../exportSize';

/** Array order is render order: the first layer receives the warped image. */
export interface EffectLayer {
  id: string;
  effect: EffectSettings;
  mask?: EffectLayerMask;
}

export interface EffectLayerMask extends PixelSize {
  /** 0 shows the layer input, 255 shows its filtered output. */
  data: Uint8Array;
}

export const MAX_EFFECT_LAYERS = 16;
const MAX_MASK_EDGE = 1024;

export function createEffectLayer(effect: EffectSettings): EffectLayer {
  // getRandomValues also works on a phone opening the editor over a local HTTP network.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const id = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return { id, effect };
}

export function migrateSingleEffect(saved: unknown): EffectLayer[] {
  const preset = normalizeEffect(saved);
  return preset ? [createEffectLayer(preset)] : [];
}

export function createLayerMask(canvas: PixelSize): EffectLayerMask {
  if (![canvas.width, canvas.height].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new Error('效果层画布尺寸无效。');
  }
  const scale = Math.min(1, MAX_MASK_EDGE / Math.max(canvas.width, canvas.height));
  const width = Math.max(1, Math.round(canvas.width * scale));
  const height = Math.max(1, Math.round(canvas.height * scale));
  return { width, height, data: new Uint8Array(width * height).fill(255) };
}

export interface LayerBrushStroke {
  mask: EffectLayerMask;
  base: Uint8Array;
}

export function beginLayerBrush(mask: EffectLayerMask | undefined, canvas: PixelSize): LayerBrushStroke {
  const original = mask ?? createLayerMask(canvas);
  return { mask: { ...original, data: original.data.slice() }, base: original.data };
}

/** Radius and center are fractions of the warped image width and height.
 * Take the strongest stamp relative to the stroke's starting mask, so overlapping
 * pointer events can't harden a feathered edge. */
export function stampLayerBrush(stroke: LayerBrushStroke, center: Point, radius: Point,
  hardness: number, mode: 'erase' | 'restore'): void {
  const { width, height, data } = stroke.mask;
  const cx = center.x * width, cy = center.y * height;
  const rx = Math.max(.75, radius.x * width), ry = Math.max(.75, radius.y * height);
  const endX = Math.min(width, Math.ceil(cx + rx)), endY = Math.min(height, Math.ceil(cy + ry));
  for (let y = Math.max(0, Math.floor(cy - ry)); y < endY; y++) {
    for (let x = Math.max(0, Math.floor(cx - rx)); x < endX; x++) {
      const distance = Math.hypot((x + .5 - cx) / rx, (y + .5 - cy) / ry);
      const coverage = brushFalloff(distance, hardness);
      if (!coverage) continue;
      const index = y * width + x, base = stroke.base[index];
      data[index] = mode === 'erase'
        ? Math.min(data[index], Math.round(base * (1 - coverage)))
        : Math.max(data[index], Math.round(base + (255 - base) * coverage));
    }
  }
}

interface SavedMask extends PixelSize {
  encoding: 'raw' | 'rle16';
  data: string;
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

/** A single eraser stroke typically leaves long runs of unmodified pixels. The
 * raw representation bounds the file size for dense, photograph-like masks. */
function encodeMask(mask: EffectLayerMask): SavedMask {
  const {width, height, data} = mask;
  const packed = new Uint8Array(data.length);
  let used = 0;
  for (let i = 0; i < data.length;) {
    if (used + 3 >= packed.length) return {width, height, encoding:'raw', data:toBase64(data)};
    const value = data[i];
    let end = i + 1;
    while (end < data.length && end - i < 65535 && data[end] === value) end++;
    const count = end - i;
    packed[used++] = count >>> 8;
    packed[used++] = count & 255;
    packed[used++] = value;
    i = end;
  }
  return {width, height, encoding:'rle16', data:toBase64(packed.subarray(0, used))};
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function decodeMask(value: unknown): EffectLayerMask {
  if (!isRecord(value)) throw new Error('效果层擦除记录无效。');
  const {width, height, encoding, data} = value;
  if (typeof width !== 'number' || typeof height !== 'number' ||
      !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > MAX_MASK_EDGE || height > MAX_MASK_EDGE) throw new Error('效果层擦除尺寸无效。');
  const count = width * height;
  if (!['rle16', 'raw'].includes(String(encoding)) || typeof data !== 'string' ||
      !data.length || data.length > Math.ceil(count / 3) * 4 || data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('效果层擦除数据不完整。');
  const binary = atob(data);
  if (encoding === 'raw') {
    if (binary.length !== count) throw new Error('效果层擦除数据长度无效。');
    return {width, height, data:Uint8Array.from(binary, c => c.charCodeAt(0))};
  }
  if (binary.length % 3 !== 0 || binary.length > count) throw new Error('效果层擦除编码无效。');
  const result = new Uint8Array(count);
  let offset = 0;
  for (let i = 0; i < binary.length; i += 3) {
    const run = (binary.charCodeAt(i) << 8) + binary.charCodeAt(i + 1);
    if (!run || offset + run > count) throw new Error('效果层擦除记录超出范围。');
    result.fill(binary.charCodeAt(i + 2), offset, offset + run);
    offset += run;
  }
  if (offset !== count) throw new Error('效果层擦除记录长度无效。');
  return {width, height, data:result};
}

export function encodeEffectLayers(layers: readonly EffectLayer[]) {
  return layers.map(({id, effect, mask}) => ({
    id, effect, ...(mask ? {mask:encodeMask(mask)} : {}),
  }));
}

export function decodeEffectLayers(value: unknown): EffectLayer[] {
  if (!Array.isArray(value) || value.length > MAX_EFFECT_LAYERS) throw new Error('工程效果层列表无效。');
  const ids = new Set<string>();
  return value.map(entry => {
    if (!isRecord(entry) || typeof entry.id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,80}$/.test(entry.id) || ids.has(entry.id)) throw new Error('工程效果层标识无效。');
    ids.add(entry.id);
    const effect = normalizeEffect(entry.effect);
    if (!effect) throw new Error('工程中有无法识别的图片效果。');
    const layer: EffectLayer = {id:entry.id, effect};
    if (entry.mask !== undefined) layer.mask = decodeMask(entry.mask);
    return layer;
  });
}
