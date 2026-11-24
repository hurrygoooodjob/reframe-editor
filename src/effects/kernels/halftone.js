// Adapted from the Tonepress v06 still-image renderer.
const DIAGONAL = Math.SQRT1_2;
const PI = Math.PI;
const LUMA = [0.2126, 0.7152, 0.0722];
const MIN_RADIUS = 0.18;
const RADIUS_RANGE = 0.18;
const MAX_CONTRAST = 0.92;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(min, max, value) {
  const ratio = clamp((value - min) / (max - min), 0, 1);
  return ratio * ratio * (3 - 2 * ratio);
}

export function renderHalftone(input, settings) {
  const { width, height, sourceWidth, sourceHeight, size: pitch } = settings;
  const projectedPitch = pitch * Math.min(width / sourceWidth, height / sourceHeight);
  const edge = Math.min(0.13, 0.55 / Math.max(1, projectedPitch));
  const contrast = settings.strength / 100 * MAX_CONTRAST * smoothstep(1.25, 3.1, projectedPitch);
  if (contrast === 0) return input;
  const image = new ImageData(width, height);
  image.data.set(input.data);
  const pixels = image.data;
  const luminance = new Float32Array(width * height);
  for (let pixel = 0, index = 0; pixel < luminance.length; pixel += 1, index += 4) {
    luminance[pixel] = (pixels[index] * LUMA[0] + pixels[index + 1] * LUMA[1] +
      pixels[index + 2] * LUMA[2]) / 255;
  }

  const scaleX = sourceWidth / width;
  const scaleY = sourceHeight / height;
  const diagonalPitch = DIAGONAL * pitch;
  const projectedXStep = DIAGONAL * scaleX / pitch;
  const edgeCoverage = edge * edge / 5;
  for (let y = 0; y < height; y += 1) {
    const sourceY = (y + 0.5) * scaleY;
    const gridStartX = (scaleX * 0.5 - sourceY) * DIAGONAL / pitch;
    const gridStartY = (scaleX * 0.5 + sourceY) * DIAGONAL / pitch;
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const pixel = row + x;
      const index = pixel * 4;
      const tone = luminance[pixel];
      if (pixels[index + 3] === 0 || tone <= 0 || tone >= 1) continue;

      const gridX = gridStartX + x * projectedXStep;
      const gridY = gridStartY + x * projectedXStep;
      const localX = gridX - Math.floor(gridX) - 0.5;
      const localY = gridY - Math.floor(gridY) - 0.5;
      const centerX = clamp(Math.floor(x + 0.5 - (localX + localY) * diagonalPitch / scaleX), 0, width - 1);
      const centerY = clamp(Math.floor(y + 0.5 - (localY - localX) * diagonalPitch / scaleY), 0, height - 1);
      const radius = MIN_RADIUS + RADIUS_RANGE * (1 - luminance[centerY * width + centerX]);
      const distance = Math.sqrt(localX * localX + localY * localY);
      const mark = 1 - smoothstep(radius - edge, radius + edge, distance);
      const coverage = PI * (radius * radius + edgeCoverage);
      const delta = (coverage - mark) * Math.min(tone, 1 - tone) * contrast;
      const target = delta < 0 ? 0 : 255;
      const room = delta < 0 ? tone : 1 - tone;
      const amount = Math.abs(delta) / room;
      pixels[index] += (target - pixels[index]) * amount;
      pixels[index + 1] += (target - pixels[index + 1]) * amount;
      pixels[index + 2] += (target - pixels[index + 2]) * amount;
    }
  }

  return image;
}
