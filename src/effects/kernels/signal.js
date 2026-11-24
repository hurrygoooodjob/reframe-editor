// Adapted from the Tonepress v06 still-image renderer.
const kinds = Object.freeze({ thermal: 0, crt: 1, vhs: 2, glitch: 3, hatch: 4, contour: 5, prism: 6 });
const heatStops = [
  [0.025, 0.035, 0.125], [0.115, 0.135, 0.455], [0.425, 0.07, 0.58],
  [0.825, 0.125, 0.32], [0.99, 0.39, 0.105], [1, 0.77, 0.16], [1, 0.98, 0.76]
];

const clamp = (number, min = 0, max = 1) => Math.min(max, Math.max(min, number));
const frac = (number) => number - Math.floor(number);
const mix = (a, b, amount) => a + (b - a) * amount;
const PI2 = Math.PI * 2;
const luma = (r, g, b) => r * 0.2126 + g * 0.7152 + b * 0.0722;
const smooth = (min, max, value) => {
  const t = clamp((value - min) / (max - min));
  return t * t * (3 - 2 * t);
};
function hash(x, y) {
  const a = frac(x * 0.1031), b = frac(y * 0.1031);
  const blend = (a + b) * (a + 33.33) + a * (b + 33.33);
  return frac((a + b + blend * 2) * (a + blend));
}

export function renderSignal(image, settings) {
  const { kind, size, sourceWidth, sourceHeight, amount, time } = settings;
  const { width, height } = image;
  const source = image.data;
  const result = new ImageData(width, height);
  const output = result.data;
  const sx = sourceWidth / width, sy = sourceHeight / height;
  const frame = Math.floor(time * (kind === kinds.vhs ? 24 : 7));
  const levels = mix(30, 7, (size - 2) / 14);
  const pitch = kind === kinds.crt ? 1.2 + size * 0.77 : 1.8 + size * 0.76;
  const srgb = 1 / 255;
  const index = (x, y) => (clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)) * 4;
  const tone = kind === kinds.thermal || kind === kinds.contour ? new Float32Array(width * height) : null;
  if (tone) {
    for (let i = 0; i < tone.length; i++) {
      tone[i] = luma(source[i * 4], source[i * 4 + 1], source[i * 4 + 2]) * srgb;
    }
  }
  const toneAt = (x, y) => tone[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)];
  function sampling(distance) {
    const rx = distance / sx, ry = distance / sy;
    const x0 = Math.floor(rx), y0 = Math.floor(ry);
    const fx = frac(rx), fy = frac(ry);
    return (x, y) => toneAt(x, y) * 0.4 + 0.15 * (
      mix(toneAt(x - x0, y), toneAt(x - x0 - 1, y), fx)
      + mix(toneAt(x + x0, y), toneAt(x + x0 + 1, y), fx)
      + mix(toneAt(x, y - y0), toneAt(x, y - y0 - 1), fy)
      + mix(toneAt(x, y + y0), toneAt(x, y + y0 + 1), fy)
    );
  }
  const heat = kind === kinds.thermal ? sampling(size * 0.43) : null;
  const stripe = (position, spacing, thickness, pixelWidth) => {
    const distance = Math.abs(frac(position / spacing + 0.5) - 0.5) * spacing;
    const edge = Math.max(0.32, 0.48 * pixelWidth);
    return (1 - smooth(Math.max(0, thickness - edge), thickness + edge, distance))
      * (1 - smooth(0.27, 1.15, edge / spacing));
  };
  const elevation = kind === kinds.contour ? new Float32Array(width * height) : null;
  if (elevation) {
    const near = sampling(size * 0.68), far = sampling(size * 1.35);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        elevation[y * width + x] = near(x, y) * 0.6 + far(x, y) * 0.4;
      }
    }
  }

  for (let y = 0; y < height; y++) {
    const py = (y + 0.5) * sy;
    const v = (y + 0.5) / height;
    const slice = Math.floor(py / (2 + size * 2.25));
    const trigger = hash(slice, frame + 8);
    const jump = hash(slice + 48, frame);
    const glitchShift = trigger >= 0.66 ? (jump - 0.5) * size * 6.8 : 0;
    const fringe = size * (0.37 + (trigger >= 0.81 ? 1.25 : 0));
    const analogRow = Math.floor(py / (1 + size * 0.23));
    const head = 1 - smooth(0, 0.025, Math.abs(v - (0.907 + Math.sin(time * 1.9) * 0.05)));
    const wobble = Math.sin(analogRow * 0.17 + time * 5.1) * 0.65 + Math.sin(analogRow * 0.038 - time * 3) * 0.35;
    const shift = wobble * size * 0.42 + head * (hash(analogRow, frame) - 0.5) * size * 3.8;
    const scan = mix(1, 0.55 + (0.5 + 0.5 * Math.cos(py / pitch * PI2)) * 0.56, 1 - smooth(0.30, 0.88, sy / pitch));

    for (let x = 0; x < width; x++) {
      const px = (x + 0.5) * sx;
      const i = (y * width + x) * 4;
      const r = source[i] * srgb, g = source[i + 1] * srgb, b = source[i + 2] * srgb;
      output[i + 3] = source[i + 3];
      if (!source[i + 3]) continue;
      let rr, gg, bb;
      if (kind === kinds.thermal) {
        const ramp = 5.9999 * Math.pow(clamp(heat(x, y)), 0.88);
        const low = heatStops[Math.floor(ramp)], high = heatStops[Math.floor(ramp) + 1];
        rr = mix(low[0], high[0], frac(ramp));
        gg = mix(low[1], high[1], frac(ramp));
        bb = mix(low[2], high[2], frac(ramp));
      } else if (kind === kinds.crt) {
        const phase = px / pitch;
        const mask = 1 - smooth(0.32, 0.92, sx / pitch);
        const vignette = 1 - 0.23 * Math.min(1, 2.45 * (((x + 0.5) / width - 0.5) ** 2 + (v - 0.5) ** 2));
        const offset = index(x + Math.round(pitch * 0.5 / sx), y);
        const phosphor = (phase) => 1 + mask * (-0.065 + 0.245 * Math.cos(PI2 * phase));
        rr = (r * 0.93 + source[offset] * srgb * 0.11 + 0.025) * scan * phosphor(phase) * vignette;
        gg = (g * 0.93 + source[offset + 1] * srgb * 0.11 + 0.025) * scan * phosphor(phase - 0.3333) * vignette;
        bb = (b * 0.93 + source[offset + 2] * srgb * 0.11 + 0.025) * scan * phosphor(phase - 0.6667) * vignette;
      } else if (kind === kinds.vhs) {
        const a = index(x + Math.round(shift / sx), y);
        const c = index(x + Math.round((shift - size * 0.75) / sx), y);
        const d = index(x + Math.round((shift - size * 1.8) / sx), y);
        const e = index(x + Math.round((shift + size * 0.4125) / sx), y);
        const red = (source[a] * 0.36 + source[c] * 0.31 + source[d] * 0.22 + source[e] * 0.11) * srgb;
        const green = (source[a + 1] * 0.36 + source[c + 1] * 0.31 + source[d + 1] * 0.22 + source[e + 1] * 0.11) * srgb;
        const blue = (source[a + 2] * 0.36 + source[c + 2] * 0.31 + source[d + 2] * 0.22 + source[e + 2] * 0.11) * srgb;
        const grain = (hash(Math.floor(px / 1.4) + frame * 11, Math.floor(py) + frame * 2) - 0.5) * (0.082 + head * 0.18);
        const line = Math.sin(py * 2.1 + time * 2.7) * (0.008 + head * 0.02);
        const brightness = luma(source[a], source[a + 1], source[a + 2]) * srgb * 0.91 + 0.047 + grain + line;
        const chromaTone = luma(red, green, blue);
        rr = brightness + (red - chromaTone) * 0.87 + 0.012;
        gg = brightness + (green - chromaTone) * 0.87 - 0.005;
        bb = brightness + (blue - chromaTone) * 0.87 + 0.004;
      } else if (kind === kinds.glitch) {
        rr = source[index(x + Math.round((glitchShift - fringe) / sx), y)] * srgb;
        gg = source[index(x + Math.round(glitchShift / sx), y) + 1] * srgb;
        bb = source[index(x + Math.round((glitchShift + fringe) / sx), y) + 2] * srgb;
        const block = hash(Math.floor(px / (size * 3.5)) + frame, slice + 9);
        if (trigger >= 0.86 && block >= 0.77) {
          rr = mix(rr, 0.95 - bb * 0.6, 0.42);
          gg *= 0.7732;
          bb = mix(bb, 0.78, 0.42);
        }
      } else if (kind === kinds.hatch) {
        const tone = Math.pow(1 - luma(r, g, b), 0.78);
        const thickness = 0.26 + tone * 0.43;
        const span = (sx + sy) * Math.SQRT1_2;
        const a = stripe((px + py) * Math.SQRT1_2, pitch, thickness, span) * smooth(0.12, 0.39, tone);
        const c = stripe((px - py) * Math.SQRT1_2 + pitch * 0.28, pitch * 1.03, thickness, span) * smooth(0.37, 0.68, tone);
        const d = stripe(px + pitch * 0.36, pitch * 0.74, thickness, sx) * smooth(0.65, 0.89, tone);
        const ink = 1 - (1 - a * 0.88) * (1 - c * 0.82) * (1 - d * 0.88);
        const background = 0.22 + tone * 0.14;
        rr = mix(mix(0.985, r, background), 0.075, ink);
        gg = mix(mix(0.956, g, background), 0.112, ink);
        bb = mix(mix(0.882, b, background), 0.108, ink);
      } else if (kind === kinds.contour) {
        const center = elevation[y * width + x];
        const horizontal = elevation[y * width + Math.min(width - 1, x + 1)] - elevation[y * width + Math.max(0, x - 1)];
        const vertical = elevation[Math.min(height - 1, y + 1) * width + x] - elevation[Math.max(0, y - 1) * width + x];
        const gradient = (Math.abs(horizontal) + Math.abs(vertical)) * 0.5;
        const distance = Math.abs(frac(center * levels + 0.5) - 0.5);
        const stroke = clamp(gradient * levels * 0.69, 0.012, 0.36);
        const line = (1 - smooth(stroke * 0.43, stroke * 1.31, distance)) * smooth(0.00006, 0.0021, gradient) * 0.96;
        const band = 1 - Math.floor(center * levels + 0.5) / levels;
        rr = mix(mix(mix(0.94, 0.60, band), r, 0.31), 0.047, line);
        gg = mix(mix(mix(0.95, 0.79, band), g, 0.31), 0.22, line);
        bb = mix(mix(mix(0.84, 0.70, band), b, 0.31), 0.22, line);
      } else {
        const radialX = ((x + 0.5) / width - 0.5) * 2, radialY = (v - 0.5) * 2;
        const radius = Math.min(1.45, Math.hypot(radialX, radialY));
        const spread = size * (0.42 + radius * radius * 0.82);
        const dx = spread * (radialX + 0.25) / sx, dy = spread * (radialY - 0.12) / sy;
        const warm = index(x + Math.round(dx), y + Math.round(dy));
        const cool = index(x - Math.round(dx * 1.13), y - Math.round(dy * 1.13));
        const neutral = index(x + Math.round(dx * 0.08), y + Math.round(dy * 0.08));
        const halo = Math.max(Math.abs(luma(source[warm], source[warm + 1], source[warm + 2]) * srgb - luma(r, g, b)),
          Math.abs(luma(source[cool], source[cool + 1], source[cool + 2]) * srgb - luma(r, g, b))) * (0.45 + radius * 0.55);
        rr = mix(r, source[warm] * srgb, 0.82) + 0.22 * halo;
        gg = mix(g, source[neutral + 1] * srgb, 0.82) + 0.075 * halo;
        bb = mix(b, source[cool + 2] * srgb, 0.82) + 0.27 * halo;
      }
      output[i] = mix(r, clamp(rr), amount) * 255;
      output[i + 1] = mix(g, clamp(gg), amount) * 255;
      output[i + 2] = mix(b, clamp(bb), amount) * 255;
    }
  }
  return result;
}


export { kinds };
