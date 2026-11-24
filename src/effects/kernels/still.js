import { newSurface } from './surface.js';
import { kinds as basic, renderBasic } from './base.js';
import { kinds as signal, renderSignal } from './signal.js';
import { renderHalftone } from './halftone.js';
import * as print from './kit-print.js';
import * as type from './kit-type.js';
import * as optics from './kit-optics.js';
import * as tracking from './kit-tracking.js';

const painters = new Map();
for (const pack of [print, type, optics, tracking]) {
  for (const id of Object.keys(pack.definitions)) painters.set(id, pack.draw);
}

// Keep transparent edges from the geometric pass. The compositing equation is
// source-atop with adjustable opacity. Reading rows bounds our scratch memory.
function blend(image, artwork, strength) {
  const { width, height } = image;
  const output = new ImageData(width, height);
  const source = image.data;
  const result = output.data;
  const rows = Math.max(1, Math.floor(65536 / width));
  for (let y = 0; y < height; y += rows) {
    const patch = artwork.getImageData(0, y, width, Math.min(rows, height - y)).data;
    let target = y * width * 4;
    for (let p = 0; p < patch.length; p += 4, target += 4) {
      result[target + 3] = source[target + 3];
      if (!result[target + 3]) continue;
      const weight = patch[p + 3] * (strength / 25500);
      result[target] = source[target] + (patch[p] - source[target]) * weight;
      result[target + 1] = source[target + 1] + (patch[p + 1] - source[target + 1]) * weight;
      result[target + 2] = source[target + 2] + (patch[p + 2] - source[target + 2]) * weight;
    }
  }
  return output;
}

export function drawStill(image, effect, reference) {
  const { width, height } = image;
  const settings = {
    ...effect.params,
    type: effect.id,
    size: effect.size,
    strength: effect.strength,
    width, height,
    sourceWidth: reference.width,
    sourceHeight: reference.height,
    time: 0, videoSource: false,
  };
  if (effect.id === 'halftone') return renderHalftone(image, settings);
  if (Object.hasOwn(basic, effect.id)) return renderBasic(image, settings);
  if (Object.hasOwn(signal, effect.id)) {
    return renderSignal(image, { ...settings, kind: signal[effect.id], amount: effect.strength / 100 });
  }
  const painter = painters.get(effect.id);
  if (!painter) throw new Error('无法识别这个图片效果');
  const input = newSurface(width, height);
  const art = newSurface(width, height);
  try {
    const bitmap = input.getContext('2d', { willReadFrequently: true });
    const artwork = art.getContext('2d', { willReadFrequently: true });
    if (!bitmap || !artwork) throw new Error('设备无法创建效果画布，请降低导出尺寸。');
    bitmap.putImageData(image, 0, 0);
    if (!painter(input, art, settings) && !Object.hasOwn(tracking.definitions, effect.id)) {
      throw new Error('图片效果渲染失败');
    }
    return blend(image, artwork, effect.strength);
  } finally {
    input.width = art.width = 1;
    input.height = art.height = 1;
  }
}
