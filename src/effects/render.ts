import type { EffectSettings } from './catalog';
import { drawStill } from './kernels/still.js';

/** Stable reference dimensions keep screen pitch in the same picture space at every output size. */
export function renderEffect(
  image: ImageData,
  effect: EffectSettings | null,
  reference: {width: number; height: number} = image,
): ImageData {
  if (!effect || effect.strength === 0) return image;
  const scale = Math.min(1, 900 / Math.max(reference.width, reference.height));
  return drawStill(image, effect, {
    width: Math.max(1, reference.width * scale),
    height: Math.max(1, reference.height * scale),
  });
}
