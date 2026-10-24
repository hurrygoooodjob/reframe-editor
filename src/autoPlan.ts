import { defaultOutputSize } from './io';
import type { EditSettings } from './types';

function seededRandom(seed: number) {
  let state = (seed >>> 0) ^ 0x73b81c29;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Retarget from the source while preserving the user's shape and squeeze settings. */
export function createRandomPlan(
  imageSize: { width: number; height: number },
  current: EditSettings,
  seed: number,
): EditSettings {
  if (!Number.isSafeInteger(imageSize.width) || !Number.isSafeInteger(imageSize.height) || imageSize.width < 1 || imageSize.height < 1) {
    throw new RangeError('原图尺寸无效。');
  }
  if (!Number.isFinite(seed)) throw new RangeError('随机种子无效。');
  const random = seededRandom(seed);
  const base = defaultOutputSize(imageSize.width, imageSize.height);
  const mode = Math.floor(random() * 4);
  const strong = 0.58 + random() * 0.22;
  const mild = 0.84 + random() * 0.08;
  // Both-axis modes still change aspect ratio, making retargeting visibly distinct
  // from an ordinary uniform resize. Single-axis modes keep the other edge intact.
  const widthFactor = mode === 0 || mode === 2 ? strong : mode === 1 ? 1 : mild;
  const heightFactor = mode === 1 || mode === 3 ? strong : mode === 0 ? 1 : mild;
  const width = Math.max(32, Math.min(8192, Math.round(base.width * widthFactor)));
  const height = Math.max(32, Math.min(8192, Math.round(base.height * heightFactor)));

  return {
    width,
    height,
    shape: current.shape,
    contentAmount: Number((0.8 + random() * 0.2).toFixed(2)),
    transitionSoftness: current.transitionSoftness,
    squeeze: current.squeeze,
    protectStrength: 1,
    forwardEnergy: true,
    quality: current.quality,
  };
}
