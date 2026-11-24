import type { EffectLayer, EffectLayerMask } from './layers';
import type { PixelImage } from '../types';
import type { PixelSize } from '../exportSize';
import { renderEffect } from './render';

function blendMask(input: ImageData, filtered: ImageData, mask: EffectLayerMask): void {
  const {width, height} = input;
  const {width: mw, height: mh, data} = mask;
  // Pixel centers in one image map to pixel centers in the other. Clamp at the
  // edges; the same normalized mask supports portrait, custom and tiny exports.
  const left = new Int32Array(width), right = new Int32Array(width), mixX = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    const mx = Math.max(0, Math.min(mw - 1, (x + .5) * mw / width - .5));
    left[x] = Math.floor(mx);
    right[x] = Math.min(left[x] + 1, mw - 1);
    mixX[x] = mx - left[x];
  }
  const before = input.data, after = filtered.data;
  for (let y = 0; y < height; y++) {
    const my = Math.max(0, Math.min(mh - 1, (y + .5) * mh / height - .5));
    const top = Math.floor(my), y1 = top * mw, y2 = Math.min(top + 1, mh - 1) * mw;
    const fy = my - top;
    for (let x = 0; x < width; x++) {
      const a = left[x], b = right[x], fx = mixX[x];
      const topValue = data[y1+a] + fx * (data[y1+b] - data[y1+a]);
      const bottomValue = data[y2+a] + fx * (data[y2+b] - data[y2+a]);
      const amount = (topValue + fy * (bottomValue - topValue)) / 255;
      if (amount === 1) continue;
      // All effect kernels retain input alpha. Only RGB needs compositing.
      const offset = (y * width + x) * 4;
      for (let c = offset; c < offset + 3; c++) after[c] = before[c] + amount * (after[c] - before[c]);
    }
  }
}

export function renderEffectLayers(image: PixelImage, layers: readonly EffectLayer[], reference: PixelSize,
  onProgress?: (fraction: number, label: string) => void): PixelImage {
  let current = new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height);
  for (let i = 0; i < layers.length; i++) {
    const {effect, mask} = layers[i];
    onProgress?.(i / layers.length, `正在应用第 ${i+1} / ${layers.length} 层效果`);
    if (!effect.strength || (mask && !mask.data.some(value => value !== 0))) continue;
    const filtered = renderEffect(current, effect, reference);
    if (mask) blendMask(current, filtered, mask);
    current = filtered;
  }
  return {width:current.width, height:current.height, data:current.data};
}
