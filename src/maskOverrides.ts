import { encodeMask, decodeMask } from './io';

/** NaN means untouched. Zero is an intentional eraser result and must survive
 * automatic analysis, history navigation and saving a project. */
export function emptyMaskOverrides(length: number): Float32Array {
  if (!Number.isInteger(length) || length < 0 || length > 1_048_576) throw new Error('手动选区尺寸无效。');
  return new Float32Array(length).fill(NaN);
}

export function hasMaskOverrides(overrides: Float32Array): boolean {
  return overrides.some(Number.isFinite);
}

export function updateMaskOverrides(previous: Float32Array, next: Float32Array, overrides: Float32Array): Float32Array {
  if (previous.length !== next.length || overrides.length !== next.length) throw new Error('手动选区尺寸不匹配。');
  const result = new Float32Array(overrides);
  for (let i = 0; i < next.length; i++) {
    if (!Number.isFinite(next[i]) || Math.abs(next[i]) > 1) throw new Error('手动选区数值无效。');
    if (next[i] !== previous[i]) result[i] = next[i];
  }
  return result;
}

export function applyMaskOverrides(automatic: Float32Array, overrides: Float32Array): Float32Array {
  if (automatic.length !== overrides.length) throw new Error('手动选区尺寸不匹配。');
  const result = new Float32Array(automatic);
  for (let i = 0; i < result.length; i++) if (Number.isFinite(overrides[i])) result[i] = overrides[i];
  return result;
}

export interface SavedMaskOverrides { version: 1; values: string; touched: string; }

export function encodeMaskOverrides(overrides: Float32Array): SavedMaskOverrides {
  const values = new Float32Array(overrides.length), touched = new Uint8Array(Math.ceil(overrides.length / 8));
  for (let i = 0; i < overrides.length; i++) {
    const value = overrides[i];
    if (Number.isNaN(value)) continue;
    if (!Number.isFinite(value) || Math.abs(value) > 1) throw new Error('手动选区数值无效。');
    values[i] = value; touched[i >> 3] |= 1 << (i & 7);
  }
  let binary = '';
  for (let i = 0; i < touched.length; i += 8192) binary += String.fromCharCode(...touched.subarray(i, i + 8192));
  return { version: 1, values: encodeMask(values), touched: btoa(binary) };
}

/** Old projects have only a merged mask: conservatively retain their non-zero
 * marks. New projects always include the bitmap, even when it is entirely empty. */
export function decodeMaskOverrides(input: unknown, mergedMask: Float32Array): Float32Array {
  const length = mergedMask.length, result = emptyMaskOverrides(length);
  if (input === undefined) {
    for (let i = 0; i < length; i++) if (mergedMask[i] !== 0) result[i] = mergedMask[i];
    return result;
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('手动选区记录无效。');
  const saved = input as Record<string, unknown>, byteLength = Math.ceil(length / 8);
  if (saved.version !== 1 || typeof saved.values !== 'string' || typeof saved.touched !== 'string'
    || saved.touched.length !== Math.ceil(byteLength / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(saved.touched)) throw new Error('手动选区记录不完整。');
  let binary: string;
  try { binary = atob(saved.touched); } catch { throw new Error('手动选区位图编码无效。'); }
  if (binary.length !== byteLength) throw new Error('手动选区位图长度无效。');
  if (length % 8 && binary.charCodeAt(byteLength - 1) >>> (length % 8)) throw new Error('手动选区位图超出范围。');
  const values = decodeMask(saved.values, length);
  for (let i = 0; i < length; i++) {
    if (binary.charCodeAt(i >> 3) & (1 << (i & 7))) {
      if (values[i] !== mergedMask[i]) throw new Error('手动选区与工程区域不一致。');
      result[i] = values[i];
    } else if (values[i] !== 0) throw new Error('未标记区域包含无效手动数据。');
  }
  return result;
}
