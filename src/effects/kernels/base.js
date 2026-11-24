// Adapted from the Tonepress v06 still-image renderer.
import { newSurface } from "./surface.js";
const kinds = { dither: 1, riso: 2, ascii: 3, pixel: 4, edge: 5, threshold: 6 };
const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const gameColors = [[17, 32, 29], [59, 88, 54], [126, 158, 79], [220, 228, 151]];
const palettes = {
  handheld: gameColors,
  ink: [[22,24,25],[91,94,94],[166,170,165],[241,239,222]],
  sunset: [[38,26,61],[113,52,109],[224,106,92],[255,218,153]]
};
const defaultGlyphs = " .,:-+=*#%@";
function glyphRamp(value) {
  if (typeof value !== "string") return defaultGlyphs;
  const printable = value.replace(/[^ -~]/g, "").slice(0, 24);
  return printable.length >= 2 && printable.trim().length ? printable : defaultGlyphs;
}
const glyphWidth = 16;
const glyphHeight = 22;
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(min, max, value) {
  const ratio = clamp((value - min) / (max - min), 0, 1);
  return ratio * ratio * (3 - 2 * ratio);
}

function glyphPixels(glyphs) {
  const atlas = newSurface(glyphWidth * glyphs.length, glyphHeight);
  const ctx = atlas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.font = "bold 18px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let index = 0; index < glyphs.length; index++) {
    ctx.fillText(glyphs[index], (index + 0.5) * glyphWidth, glyphHeight * 0.55, glyphWidth - 2);
  }
  return ctx.getImageData(0, 0, atlas.width, atlas.height).data;
}

export function renderBasic(image, settings) {
  const { type, size, strength, width, height, sourceWidth, sourceHeight } = settings;
  const mode = kinds[type];
  const output = new ImageData(width, height);
  output.data.set(image.data);
  const pixels = output.data;
  const original = image.data;
  const grayscale = mode === 5 ? new Float32Array(width * height) : null;
  if (grayscale) {
    for (let position = 0, index = 0; position < grayscale.length; position++, index += 4) {
      grayscale[position] = luma(pixels[index], pixels[index + 1], pixels[index + 2]);
    }
  }
  const glyphs = glyphRamp(settings.chars);
  const atlas = mode === 3 ? glyphPixels(glyphs) : null;
  const colors = palettes[settings.palette] ?? gameColors;
  const amount = strength / 100;
  const sourcePerX = sourceWidth / width;
  const sourcePerY = sourceHeight / height;
  const rasterIndex = (x, y) => clamp(Math.floor(x / sourcePerX), 0, width - 1) +
    clamp(Math.floor(y / sourcePerY), 0, height - 1) * width;
  const ditherValue = (x, y) => (bayer[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5;
  const threshold = 255 * (0.18 + (size - 2) * 0.64 / 14);
  const edgeStepX = Math.max(1, Math.round(Math.max(1, size / 4) / sourcePerX));
  const edgeStepY = Math.max(1, Math.round(Math.max(1, size / 4) / sourcePerY));
  const grainSize = Math.max(1, size / 4);
  const glyphCellWidth = size * 1.6;
  const glyphCellHeight = size * 2.24;

  for (let y = 0; y < height; y++) {
    const sourceY = (y + 0.5) * sourcePerY;
    const row = y * width;
    const upper = Math.max(0, y - edgeStepY) * width;
    const lower = Math.min(height - 1, y + edgeStepY) * width;

    for (let x = 0; x < width; x++) {
      const index = (row + x) * 4;
      if (!pixels[index + 3]) continue;
      const sourceX = (x + 0.5) * sourcePerX;
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      const tone = luma(r, g, b);
      let red, green, blue;

      if (mode === 1) {
        const matrix = ditherValue(Math.floor(sourceX / size), Math.floor(sourceY / size));
        const level = clamp(Math.floor(tone * (3 / 255) + matrix * 1.08 + 0.5), 0, 3);
        [red, green, blue] = colors[level];
      } else if (mode === 2) {
        const shifted = rasterIndex(sourceX + size * 0.47, sourceY - size * 0.31) * 4;
        const sample = original[shifted + 3] ? shifted : index;
        const warmR = original[sample];
        const warmG = original[sample + 1];
        const warmB = original[sample + 2];
        const grain = ditherValue(Math.floor(sourceX / grainSize), Math.floor(sourceY / grainSize));
        const cool = clamp((1 - tone / 255) * 1.14 + (b - r) * (0.28 / 255) + grain * 0.09, 0, 0.92);
        const warm = clamp((1 - luma(warmR, warmG, warmB) / 255) * 0.74 +
          (warmR - warmB) * (0.57 / 255) + grain * 0.08, 0, 0.94);
        red = 249 * (1 - 0.83 * cool) * (1 - 0.02 * warm) + grain * 7.14;
        green = 239 * (1 - 0.68 * cool) * (1 - 0.73 * warm) + grain * 7.14;
        blue = 219 * (1 - 0.29 * cool) * (1 - 0.68 * warm) + grain * 7.14;
      } else if (mode === 3) {
        const cellX = sourceX / glyphCellWidth, cellY = sourceY / glyphCellHeight;
        const left = Math.floor(cellX), top = Math.floor(cellY);
        const center = rasterIndex((left + 0.5) * glyphCellWidth, (top + 0.5) * glyphCellHeight) * 4;
        const sample = original[center + 3] ? center : index;
        const level = Math.min(glyphs.length - 1,
          Math.floor(luma(original[sample], original[sample + 1], original[sample + 2]) * (glyphs.length / 255)));
        const letterX = level * glyphWidth + Math.floor((cellX - left) * glyphWidth);
        const letterY = Math.floor((cellY - top) * glyphHeight);
        const mask = atlas[(letterY * glyphWidth * glyphs.length + letterX) * 4 + 3] / 255;
        red = 13 + (150 + original[sample] * 0.3 - 13) * mask;
        green = 18 + (170 + original[sample + 1] * 0.3 - 18) * mask;
        blue = 16 + (134 + original[sample + 2] * 0.3 - 16) * mask;
      } else if (mode === 4) {
        const block = size * 2;
        const center = rasterIndex((Math.floor(sourceX / block) + 0.5) * block,
          (Math.floor(sourceY / block) + 0.5) * block) * 4;
        const sample = original[center + 3] ? center : index;
        red = original[sample];
        green = original[sample + 1];
        blue = original[sample + 2];
      } else if (mode === 5) {
        const left = Math.max(0, x - edgeStepX), right = Math.min(width - 1, x + edgeStepX);
        const gx = grayscale[upper + right] + 2 * grayscale[row + right] + grayscale[lower + right] -
          grayscale[upper + left] - 2 * grayscale[row + left] - grayscale[lower + left];
        const gy = grayscale[lower + left] + 2 * grayscale[lower + x] + grayscale[lower + right] -
          grayscale[upper + left] - 2 * grayscale[upper + x] - grayscale[upper + right];
        const mark = smoothstep(0.035 * 1020, 0.39 * 1020, Math.sqrt(gx * gx + gy * gy));
        red = (214.14 + r * 0.14) * (1 - mark) + 28 * mark;
        green = (205.54 + g * 0.14) * (1 - mark) + 36 * mark;
        blue = (188.34 + b * 0.14) * (1 - mark) + 47 * mark;
      } else {
        const dark = tone < threshold;
        red = dark ? 28 : 249;
        green = dark ? 36 : 239;
        blue = dark ? 47 : 219;
      }

      pixels[index] = r + (red - r) * amount;
      pixels[index + 1] = g + (green - g) * amount;
      pixels[index + 2] = b + (blue - b) * amount;
    }
  }

  return output;
}


export { kinds };
