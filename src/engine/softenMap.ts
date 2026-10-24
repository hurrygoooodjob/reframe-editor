const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Three box passes approximate a Gaussian in linear time. Only coordinates and
 * constraint weights pass through this filter: source RGB is never blurred. */
function blurField(field: Float32Array, width: number, height: number, radius: number): Float32Array {
  let source = field.slice(), scratch = new Float32Array(field.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < height; y++) {
      const start = y * width;
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += source[start + clamp(k, 0, width - 1)];
      for (let x = 0; x < width; x++) {
        scratch[start + x] = sum / (radius * 2 + 1);
        sum += source[start + clamp(x + radius + 1, 0, width - 1)] - source[start + clamp(x - radius, 0, width - 1)];
      }
    }
    [source, scratch] = [scratch, source];
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += source[clamp(k, 0, height - 1) * width + x];
      for (let y = 0; y < height; y++) {
        scratch[y * width + x] = sum / (radius * 2 + 1);
        sum += source[clamp(y + radius + 1, 0, height - 1) * width + x] - source[clamp(y - radius, 0, height - 1) * width + x];
      }
    }
    [source, scratch] = [scratch, source];
  }
  return source;
}

/** Smooth a family of inverse, horizontal coordinate maps. Width and height
 * retargeting are softened separately then composed, so no 2D mesh can fold.
 * Original-image boundaries are restored continuously with softness; protected
 * interior coordinates remain fixed. Seam-cut boundary offsets must not be
 * restored row by row: they amplify tiny boundary changes into long spikes. */
export function softenMonotoneMap(values: Float32Array, mask: Float32Array, width: number, height: number,
  softness: number, sourceExtent: number, protectStrength: number): Float32Array {
  if (softness <= 0 || width < 3 || sourceExtent <= 0) return values;
  // Use the analysis dimensions, never output dimensions, for identical export
  // and preview geometry. Three box passes have sigma approximately radius.
  const radius = Math.max(1, Math.round(Math.min(width, height) * (0.006 + 0.024 * softness)));
  const displacement = new Float32Array(values.length), protectedWeight = new Float32Array(values.length);
  const baseStep = sourceExtent / (width - 1);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    displacement[i] = values[i] - x * baseStep;
    protectedWeight[i] = clamp(mask[i] * protectStrength, 0, 1);
  }
  const smooth = blurField(displacement, width, height, radius);
  const softProtection = blurField(protectedWeight, width, height, radius);
  const result = values.slice();
  const amount = Math.min(1, softness * 1.6);
  for (let y = 0; y < height; y++) {
    const start = y * width, last = start + width - 1;
    // Seam carving may crop a different number of edge pixels in each row.
    // Reimposing those jagged cropped endpoints after blur would stretch them
    // across the entire image. Restore the common original-image boundary.
    const leftBoundary = values[start] * (1 - amount);
    const rightBoundary = values[last] + (sourceExtent - values[last]) * amount;
    const leftCorrection = leftBoundary - smooth[start];
    const rightCorrection = rightBoundary - sourceExtent - smooth[last];
    result[start] = leftBoundary; result[last] = rightBoundary;
    for (let x = 1; x < width - 1; x++) {
      const i = start + x, t = x / (width - 1);
      const anchor = Math.max(protectedWeight[i], clamp(softProtection[i] * 2, 0, 1));
      const desired = x * baseStep + smooth[i] + leftCorrection * (1 - t) + rightCorrection * t;
      result[i] = values[i] + (desired - values[i]) * amount * (1 - anchor);
    }
    // Spatially varying anchors can cross an adjacent coordinate. Bound each
    // unprotected interval between its exact anchors, and project monotonically.
    // Positive slopes keep inversion stable without moving protected content.
    let anchorX = 0;
    for (let x = 1; x < width; x++) {
      if (x !== width - 1 && protectedWeight[start + x] < 0.999) continue;
      const left = result[start + anchorX], right = x === width - 1 ? rightBoundary : values[start + x];
      const step = Math.max(0, Math.min(baseStep * 0.5, (right - left) / (x - anchorX) * 0.5));
      result[start + x] = right;
      for (let xx = anchorX + 1; xx < x; xx++) {
        const i = start + xx;
        result[i] = clamp(result[i], result[i - 1] + step, right - step * (x - xx));
      }
      anchorX = x;
    }
  }
  return result;
}

/** Broaden only the transition around a protection boundary, retaining its core. */
export function featherProtection(mask: Float32Array, width: number, height: number, softness: number): Float32Array {
  const positive = Float32Array.from(mask, value => Math.max(0, value));
  if (softness <= 0) return positive;
  const radius = Math.max(1, Math.round(Math.min(width, height) * (0.004 + 0.016 * softness)));
  const smooth = blurField(positive, width, height, radius);
  for (let i = 0; i < smooth.length; i++) smooth[i] = Math.max(positive[i], smooth[i]);
  return smooth;
}
