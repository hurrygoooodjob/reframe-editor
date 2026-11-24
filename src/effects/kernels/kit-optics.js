// Adapted from the Tonepress v06 still-image renderer.
const TAU = Math.PI * 2;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const cycle = (value) => value - Math.floor(value);
const luma = (data, offset) => (54 * data[offset] + 183 * data[offset + 1] + 19 * data[offset + 2]) / 65280;

function noise(seed) {
  const a = Math.imul(seed ^ 2654435769, 1597334677);
  return ((a ^ (a >>> 16)) >>> 0) / 4294967296;
}

function select(key, label, value, options) {
  return { key, label, kind: "select", value, options: options.map(([value, label]) => ({ value, label })) };
}

const definitions = {
  "light-play": { name: "流光", english: "Light Play", scaleLabel: "光晕幅度", size: 9, strength: 80, timed: true,
    description: "按主体高光和原色提取光源，形成漂移的柔光与镜头光迹。" },
  "spark-field": { name: "闪光点阵", english: "Spark Field", scaleLabel: "闪点大小", size: 7, strength: 90, timed: true,
    description: "在亮部和边缘点亮带星芒的闪点，各自脉冲。" },
  "contour-outline": { name: "主体剪影轮廓", english: "Contour", scaleLabel: "轮廓线宽", size: 7, strength: 95,
    description: "估计从画面边缘连入的背景，在主体剪影边界描双线。",
    controls: [select("subject", "主体依据", "border", [["border", "边缘背景"], ["bright", "亮部区域"], ["dark", "暗部区域"]])] },
  "crystal-glass": { name: "水晶切面", english: "Crystal Glass", scaleLabel: "切面尺度", size: 9, strength: 92,
    description: "把图像分入三角切面，逐面折射并描画玻璃边缘。" },
  "glass-pixel-dispersion": { name: "像素玻璃色散", english: "Glass Pixel Dispersion", scaleLabel: "玻璃砖大小", size: 8,
    strength: 96, description: "方砖按自身中心折射，边缘将红绿蓝取样分开。" },
  "pixel-sort": { name: "像素排序", english: "Pixel Sort", scaleLabel: "亮度区间宽度", size: 8, strength: 100,
    description: "在符合亮度范围的连续像素段内部排序，保留原像素的颜色组合。",
    controls: [
      select("axis", "排序方向", "horizontal", [["horizontal", "横向"], ["vertical", "纵向"]]),
      select("range", "处理色调", "mid", [["mid", "中间调"], ["shadow", "阴影"], ["highlight", "高光"]])
    ] },
  "ribbon-scan": { name: "条带扫描", english: "Ribbon Scan", scaleLabel: "条带高度", size: 8, strength: 94, timed: true,
    description: "从素材各行读取明暗，扫描带经过时横向推移行块。" },
  "wave-lines": { name: "起伏线条", english: "Wave Lines", scaleLabel: "线条间隔", size: 7, strength: 95, timed: true,
    description: "让图像亮度塑造横向曲线，波形随时间从左向右传递。" },
  "ember-veil": { name: "余烬薄幕", english: "Ember Veil", scaleLabel: "余烬长度", size: 8, strength: 92, timed: true,
    description: "让亮部和边缘散出暖色火屑，叠加半透明暖雾。" },
  "holo": { name: "全息虹彩", english: "Holo", scaleLabel: "虹彩尺度", size: 8, strength: 88, timed: true,
    description: "把原片折射为冷色全息像，倾斜虹彩在亮度层次间扫过。" },
  "particle-brush": { name: "粒子笔触", english: "Particle Brush", scaleLabel: "笔触大小", size: 8, strength: 95, timed: true,
    description: "从原图各区提取颜色和明暗，以沿纹理铺开的短笔触重画。" },
  "rain-reveal": { name: "雨幕显影", english: "Rain Reveal", scaleLabel: "雨丝长度", size: 8, strength: 93, timed: true,
    description: "沿亮部、暗部与轮廓生成雨丝，经过处逐段显露原片。" },
  "stardust": { name: "星尘", english: "Stardust", scaleLabel: "微粒尺寸", size: 7, strength: 95, timed: true,
    description: "按亮度和局部颜色重组星尘，微粒保持主体走势并周期漂浮。" }
};

const canvases = new WeakMap();
function fieldCanvas(owner, width, height) {
  let canvas = canvases.get(owner);
  if (!canvas) {
    canvas = owner.ownerDocument?.createElement("canvas") || new OffscreenCanvas(1, 1);
    canvases.set(owner, canvas);
  }
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return canvas;
}

function sampleGrid(input, count) {
  const scale = Math.min(1, count / Math.min(input.width, input.height));
  const width = Math.max(1, Math.min(count * 4, Math.round(input.width * scale)));
  const height = Math.max(1, Math.min(count * 4, Math.round(input.height * scale)));
  const canvas = fieldCanvas(input, width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(input, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

function colorAt(data, offset, alpha = 1, lift = 0) {
  return "rgba(" + Math.round(data[offset] * (1 - lift) + 255 * lift) + "," +
    Math.round(data[offset + 1] * (1 - lift) + 255 * lift) + "," +
    Math.round(data[offset + 2] * (1 - lift) + 255 * lift) + "," + clamp(alpha) + ")";
}

function base(ctx, input, color, opacity = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, input.width, input.height);
  ctx.globalAlpha = opacity;
  ctx.drawImage(input, 0, 0);
  ctx.globalAlpha = 1;
}

function traverse(grid, width, height, callback) {
  const cellW = width / grid.width;
  const cellH = height / grid.height;
  for (let row = 0; row < grid.height; row += 1) {
    for (let col = 0; col < grid.width; col += 1) {
      const index = row * grid.width + col;
      const offset = index * 4;
      if (grid.data[offset + 3] < 28) continue;
      const tone = luma(grid.data, offset);
      const side = col ? luma(grid.data, offset - 4) : tone;
      const above = row ? luma(grid.data, offset - grid.width * 4) : tone;
      callback((col + 0.5) * cellW, (row + 0.5) * cellH, tone, side - tone, above - tone,
        index, offset, cellW, cellH);
    }
  }
}

function lightPlay(input, output, ctx, settings) {
  ctx.drawImage(input, 0, 0);
  const { width, height } = output;
  const grid = sampleGrid(input, 26);
  const mask = fieldCanvas(output, grid.width, grid.height);
  const maskContext = mask.getContext("2d");
  let lightX = 0;
  let lightY = 0;
  let total = 0;
  traverse(grid, width, height, (x, y, tone, dx, dy, index, offset) => {
    const emission = clamp((tone - 0.48) * 2.6) ** 1.6 * grid.data[offset + 3] / 255;
    grid.data[offset + 3] = Math.round(emission * 242);
    lightX += x * emission;
    lightY += y * emission;
    total += emission;
  });
  maskContext.putImageData(grid, 0, 0);
  const blur = Math.min(width, height) * (0.015 + settings.size * 0.0035);
  const phase = settings.phase * TAU;
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.84;
  ctx.filter = "blur(" + blur.toFixed(1) + "px)";
  ctx.drawImage(mask, Math.sin(phase) * blur / 2, Math.cos(phase) * blur / 3, width, height);
  ctx.filter = "none";
  ctx.globalAlpha = 1;
  if (total > 1) {
    const x = lightX / total + Math.cos(phase) * blur;
    const y = lightY / total + Math.sin(phase) * blur;
    const radius = blur * (2.8 + Math.sin(phase) * 0.42);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, "rgba(255,214,158,0.44)");
    glow.addColorStop(0.36, "rgba(190,209,252,0.16)");
    glow.addColorStop(1, "rgba(86,147,220,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
}

function sparkField(input, output, ctx, settings) {
  base(ctx, input, "#091327", 0.88);
  ctx.globalCompositeOperation = "screen";
  const grid = sampleGrid(input, 34);
  const { width, height } = output;
  traverse(grid, width, height, (x, y, tone, dx, dy, id, offset, cellW, cellH) => {
    const seed = noise(id + 3);
    if (tone + 0.6 * (Math.abs(dx) + Math.abs(dy)) < 0.64 || seed > 0.12 + tone * 0.16) return;
    const pulse = Math.max(0, Math.sin((settings.phase * 2 + noise(id + 2377)) * TAU)) ** 2;
    const px = x + (noise(id + 71) - 0.5) * cellW;
    const py = y + (noise(id + 321) - 0.5) * cellH;
    const span = Math.min(cellW, cellH) * (0.15 + settings.size * 0.055) * (0.55 + seed + pulse);
    const flare = ctx.createRadialGradient(px, py, 0, px, py, Math.max(0.5, span * 2.1));
    flare.addColorStop(0, colorAt(grid.data, offset, 0.34 + pulse * 0.6, 0.62));
    flare.addColorStop(1, "rgba(178,234,255,0)");
    ctx.fillStyle = flare;
    ctx.fillRect(px - span * 2.2, py - span * 2.2, span * 4.4, span * 4.4);
    ctx.strokeStyle = colorAt(grid.data, offset, 0.12 + pulse * 0.77, 0.78);
    ctx.lineWidth = Math.max(0.5, span * 0.09);
    ctx.beginPath();
    ctx.moveTo(px - span, py);
    ctx.lineTo(px + span, py);
    ctx.moveTo(px, py - span * 1.5);
    ctx.lineTo(px, py + span * 1.5);
    ctx.stroke();
  });
}

function contour(input, output, ctx, settings) {
  base(ctx, input, "#172632", 0.64);
  const grid = sampleGrid(input, 86);
  const { width, height, data } = grid;
  const mask = new Uint8Array(width * height);
  if (settings.subject === "bright" || settings.subject === "dark") {
    const bright = settings.subject === "bright";
    for (let i = 0; i < mask.length; i += 1) {
      const tone = luma(data, i * 4);
      mask[i] = data[i * 4 + 3] > 67 && (bright ? tone > 0.63 : tone < 0.39) ? 1 : 0;
    }
  } else {
    const corners = [0, width - 1, (height - 1) * width, width * height - 1].map((index) => index * 4);
    const queue = new Int32Array(mask.length);
    let length = 0;
    const offer = (index, edge = false) => {
      if (mask[index]) return;
      const p = index * 4;
      if (!edge && data[p + 3] > 58 && !corners.some((sample) =>
        Math.abs(data[p] - data[sample]) + Math.abs(data[p + 1] - data[sample + 1]) +
          Math.abs(data[p + 2] - data[sample + 2]) < 95)) return;
      mask[index] = 1;
      queue[length++] = index;
    };
    for (let x = 0; x < width; x += 1) {
      offer(x, true);
      offer((height - 1) * width + x, true);
    }
    for (let y = 0; y < height; y += 1) {
      offer(y * width, true);
      offer(y * width + width - 1, true);
    }
    for (let i = 0; i < length; i += 1) {
      const p = queue[i];
      if (p % width > 0) offer(p - 1);
      if (p % width < width - 1) offer(p + 1);
      if (p >= width) offer(p - width);
      if (p + width < mask.length) offer(p + width);
    }
  }
  const cw = output.width / width;
  const ch = output.height / height;
  ctx.beginPath();
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const cell = mask[y * width + x];
      if (cell !== mask[y * width + x + 1]) {
        ctx.moveTo((x + 1) * cw, y * ch);
        ctx.lineTo((x + 1) * cw, (y + 1) * ch);
      }
      if (cell !== mask[(y + 1) * width + x]) {
        ctx.moveTo(x * cw, (y + 1) * ch);
        ctx.lineTo((x + 1) * cw, (y + 1) * ch);
      }
    }
  }
  const line = Math.max(0.75, Math.min(cw, ch) * (0.23 + settings.size * 0.055));
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = line * 2.45;
  ctx.strokeStyle = "rgba(15,41,54,0.86)";
  ctx.stroke();
  ctx.lineWidth = line;
  ctx.strokeStyle = "rgba(208,255,234,0.96)";
  ctx.stroke();
}

function crystalGlass(input, output, ctx, settings) {
  const { width, height } = output;
  const grid = sampleGrid(input, 23);
  const tile = Math.max(9, Math.min(width, height) * (0.045 + settings.size * 0.006));
  ctx.drawImage(input, 0, 0);
  const columns = Math.ceil(width / tile);
  const rows = Math.ceil(height / tile);
  function corner(col, row) {
    const key = col + row * (columns + 2);
    const dx = col > 0 && col < columns ? (noise(key + 53) - 0.5) * 0.51 : 0;
    const dy = row > 0 && row < rows ? (noise(key + 731) - 0.5) * 0.51 : 0;
    return [(col + dx) * tile, (row + dy) * tile];
  }
  function prism(a, b, c, seed) {
    const mx = (a[0] + b[0] + c[0]) / 3;
    const my = (a[1] + b[1] + c[1]) / 3;
    const gx = clamp(Math.floor(mx * grid.width / width), 0, grid.width - 1);
    const gy = clamp(Math.floor(my * grid.height / height), 0, grid.height - 1);
    const tone = luma(grid.data, (gy * grid.width + gx) * 4);
    const dx = (noise(seed + 217) - 0.5) * tile * (0.11 + (1 - tone) * 0.46);
    const dy = (noise(seed + 813) - 0.5) * tile * 0.48;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(...a);
    ctx.lineTo(...b);
    ctx.lineTo(...c);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(input, dx, dy);
    const gradient = ctx.createLinearGradient(...a, ...c);
    gradient.addColorStop(0, "rgba(195,229,249,0.5)");
    gradient.addColorStop(0.12, "rgba(224,254,255,0.05)");
    gradient.addColorStop(0.74, "rgba(32,43,91,0.05)");
    gradient.addColorStop(1, "rgba(40,60,91,0.37)");
    ctx.fillStyle = gradient;
    ctx.fillRect(mx - tile * 1.35, my - tile * 1.35, tile * 2.7, tile * 2.7);
    ctx.lineWidth = Math.max(0.6, tile * 0.022);
    ctx.strokeStyle = "rgba(232,251,255,0.54)";
    ctx.stroke();
    ctx.restore();
  }
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const a = corner(x, y);
      const b = corner(x + 1, y);
      const c = corner(x, y + 1);
      const d = corner(x + 1, y + 1);
      const key = (y * columns + x) * 2;
      prism(a, b, c, key);
      prism(d, c, b, key + 1);
    }
  }
}

function glassPixel(input, output, ctx, settings) {
  const { width, height } = output;
  const src = input.getContext("2d").getImageData(0, 0, width, height).data;
  const result = ctx.createImageData(width, height);
  const pixels = result.data;
  const tile = Math.max(5, Math.round(Math.min(width, height) * (0.014 + settings.size * 0.003)));
  const red = new Int32Array(width);
  const green = new Int32Array(width);
  const blue = new Int32Array(width);
  const bevel = new Uint8Array(width);
  for (let x = 0; x < width; x += 1) {
    const ux = x % tile / tile - 0.5;
    const sourceX = x - ux * tile * 0.48;
    const fringe = (0.17 + Math.abs(ux)) * tile * 0.33;
    red[x] = clamp(Math.round(sourceX - fringe), 0, width - 1) * 4;
    green[x] = clamp(Math.round(sourceX), 0, width - 1) * 4 + 1;
    blue[x] = clamp(Math.round(sourceX + fringe), 0, width - 1) * 4 + 2;
    bevel[x] = Math.abs(ux) > 0.42 ? 1 : 0;
  }
  for (let y = 0; y < height; y += 1) {
    const uy = y % tile / tile - 0.5;
    const row = clamp(Math.round(y - uy * tile * 0.38), 0, height - 1) * width * 4;
    for (let x = 0; x < width; x += 1) {
      const shine = bevel[x] || Math.abs(uy) > 0.44 ? 24 : 0;
      const transmission = shine ? 0.89 : 1.02;
      const index = (y * width + x) * 4;
      pixels[index] = src[row + red[x]] * transmission + shine;
      pixels[index + 1] = src[row + green[x]] * transmission + shine;
      pixels[index + 2] = src[row + blue[x]] * transmission + shine;
      pixels[index + 3] = src[index + 3];
    }
  }
  ctx.putImageData(result, 0, 0);
}

function pixelSort(input, output, ctx, settings) {
  const { width, height } = output;
  const source = input.getContext("2d").getImageData(0, 0, width, height);
  const result = ctx.createImageData(width, height);
  result.data.set(source.data);
  const vertical = settings.axis === "vertical";
  const lines = vertical ? width : height;
  const length = vertical ? height : width;
  const stride = vertical ? width * 4 : 4;
  const low = settings.range === "shadow" ? 8 : settings.range === "highlight" ? 184 - 3 * settings.size : 109 - 4 * settings.size;
  const high = settings.range === "shadow" ? 91 + 3 * settings.size : settings.range === "highlight" ? 249 : 145 + 4 * settings.size;
  const keys = new Uint32Array(length);
  // Source pixel positions fit inside one 16-bit key field at the supported output sizes.
  const data = source.data;
  for (let line = 0; line < lines; line += 1) {
    const baseIndex = line * (vertical ? 4 : width * 4);
    let count = 0;
    for (let x = 0; x <= length; x += 1) {
      const index = baseIndex + x * stride;
      const tone = x < length ? (54 * data[index] + 183 * data[index + 1] + 19 * data[index + 2]) >> 8 : -1;
      if (tone >= low && tone <= high && data[index + 3] >= 127) {
        keys[count++] = (tone << 16) | x;
      } else if (count) {
        if (count > 1) {
          keys.subarray(0, count).sort();
          for (let i = 0; i < count; i += 1) {
            const from = baseIndex + (keys[i] & 65535) * stride;
            const to = baseIndex + (x - count + i) * stride;
            result.data[to] = data[from];
            result.data[to + 1] = data[from + 1];
            result.data[to + 2] = data[from + 2];
            result.data[to + 3] = data[from + 3];
          }
        }
        count = 0;
      }
    }
  }
  ctx.putImageData(result, 0, 0);
}

function ribbonScan(input, output, ctx, settings) {
  const { width, height } = output;
  const grid = sampleGrid(input, 24);
  const band = Math.max(2, Math.round(height * (0.008 + settings.size * 0.0042)));
  const scan = settings.phase * height;
  for (let y = 0; y < height; y += band) {
    const h = Math.min(band, height - y);
    const row = Math.min(grid.height - 1, Math.floor(y * grid.height / height));
    let tone = 0;
    for (let x = 0; x < grid.width; x += 1) tone += luma(grid.data, (row * grid.width + x) * 4);
    tone /= grid.width;
    const d = Math.abs(y + h * 0.5 - scan);
    const intensity = Math.exp(-Math.min(d, height - d) / (band * 2.2));
    const direction = Math.sin(row * 1.21 + settings.phase * TAU);
    const shift = Math.round(width * direction * (0.015 + tone * 0.08) * (0.2 + intensity * 1.38));
    ctx.drawImage(input, 0, y, width, h, shift, y, width, h);
    if (shift) ctx.drawImage(input, 0, y, width, h, shift + (shift < 0 ? width : -width), y, width, h);
    if (intensity > 0.51) {
      ctx.fillStyle = "rgba(112,230,248," + ((intensity - 0.5) * 0.32) + ")";
      ctx.fillRect(0, y, width, Math.max(1, band * 0.12));
    }
  }
}

function waveLines(input, output, ctx, settings) {
  base(ctx, input, "#132b37", 0.18);
  const { width, height } = output;
  const grid = sampleGrid(input, Math.round(83 - 2.3 * settings.size));
  const step = height / grid.height;
  ctx.lineWidth = Math.max(0.65, step * 0.18);
  for (let row = 0; row < grid.height; row += 1) {
    const reference = (row * grid.width + Math.floor(grid.width * 0.48)) * 4;
    ctx.strokeStyle = colorAt(grid.data, reference, 0.89, 0.53);
    ctx.beginPath();
    for (let col = 0; col <= grid.width; col += 1) {
      const offset = (row * grid.width + Math.min(col, grid.width - 1)) * 4;
      const tone = luma(grid.data, offset);
      const x = col * width / grid.width;
      const ripple = Math.sin((x / width * 3 + row * 0.028 - settings.phase) * TAU);
      const y = (row + 0.56) * step + (0.58 - tone) * step * (1.1 + 1.6 * ripple);
      if (col) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
}

function emberVeil(input, output, ctx, settings) {
  base(ctx, input, "#270d0d", 0.74);
  const { width, height } = output;
  const grid = sampleGrid(input, 39);
  ctx.globalCompositeOperation = "screen";
  traverse(grid, width, height, (x, y, tone, dx, dy, id, offset, cellW, cellH) => {
    const edge = Math.abs(dx) + Math.abs(dy);
    if (tone < 0.35 || noise(id + 2) > (tone * 0.25 + edge * 0.42)) return;
    const age = cycle(noise(id + 41) + settings.phase);
    const energy = Math.sin(age * Math.PI) ** 1.8;
    const px = x + age * cellW * 2 + Math.sin(age * 12 + id) * cellW * 0.4;
    const py = y - cellH * (0.4 + noise(id + 833) * 3) * age;
    const span = Math.min(cellH, cellW) * (0.33 + settings.size * 0.115) * (0.26 + tone);
    ctx.strokeStyle = "rgba(255," + Math.round(83 + tone * 134) + "," + Math.round(38 + tone * 96) + "," + (energy * 0.87) + ")";
    ctx.lineWidth = Math.max(0.7, span * 0.15);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - span * 0.58, py + span);
    ctx.stroke();
    if (edge > 0.2) {
      ctx.fillStyle = "rgba(255,141,56," + (energy * 0.14) + ")";
      ctx.beginPath();
      ctx.arc(px, py, Math.max(0.6, span * 0.86), 0, TAU);
      ctx.fill();
    }
  });
}

function holo(input, output, ctx, settings) {
  const { width, height } = output;
  const grid = sampleGrid(input, 32);
  base(ctx, input, "#122c51", 0.78);
  ctx.globalCompositeOperation = "screen";
  const angle = Math.sin(settings.phase * TAU) * 0.32;
  const ribbon = Math.max(2, Math.round(height * (0.006 + settings.size * 0.0024)));
  for (let y = 0; y < height; y += ribbon) {
    const h = Math.min(ribbon, height - y);
    const row = Math.min(grid.height - 1, Math.floor(y / height * grid.height));
    let mean = 0;
    for (let x = 0; x < grid.width; x += 1) mean += luma(grid.data, (row * grid.width + x) * 4);
    mean /= grid.width;
    const p = (y / height * (2 + settings.size * 0.25) - settings.phase * 2) * TAU;
    const offset = Math.sin(p) * (0.5 + mean) * (width * 0.015);
    ctx.globalAlpha = 0.27;
    ctx.drawImage(input, 0, y, width, h, offset, y, width, h);
    ctx.globalAlpha = 1;
    const colors = ctx.createLinearGradient(0, y, width, y + height * angle);
    const hue = 170 + 90 * Math.sin(p);
    const shine = (0.25 + mean * 0.65) * (0.18 + 0.42 * Math.abs(Math.cos(p)));
    colors.addColorStop(0, "hsla(" + hue + ",91%,62%," + (shine * 0.4) + ")");
    colors.addColorStop(0.52, "hsla(" + (hue + 94) + ",91%,70%," + shine + ")");
    colors.addColorStop(1, "hsla(" + (hue + 168) + ",94%,57%," + (shine * 0.6) + ")");
    ctx.fillStyle = colors;
    ctx.fillRect(0, y, width, h);
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(33,31,86,0.17)";
  for (let y = 0; y < height; y += Math.max(2, Math.round(ribbon / 4))) ctx.fillRect(0, y, width, 1);
}

function particleBrush(input, output, ctx, settings) {
  base(ctx, input, "#eee4d2", 0.28);
  const grid = sampleGrid(input, Math.round(106 - 3.7 * settings.size));
  ctx.lineCap = "round";
  traverse(grid, output.width, output.height, (x, y, tone, dx, dy, id, offset, cw, ch) => {
    const seed = noise(id + 4);
    const step = Math.min(cw, ch);
    const shift = Math.sin((settings.phase + noise(id + 891)) * TAU) * step * 0.17;
    const angle = Math.atan2(dy, dx || 0.001) + Math.PI * 0.5 + seed * 1.4 + shift / step;
    const stroke = step * (0.43 + seed * 1.2 + (1 - tone) * 0.25);
    const px = x + (noise(id + 879) - 0.5) * cw * 0.92 + shift;
    const py = y + (noise(id + 127) - 0.5) * ch * 0.92;
    ctx.lineWidth = Math.max(0.65, step * (0.21 + 0.33 * (1 - tone)));
    ctx.strokeStyle = colorAt(grid.data, offset, 0.68 + seed * 0.27);
    ctx.beginPath();
    ctx.moveTo(px - Math.cos(angle) * stroke * 0.44, py - Math.sin(angle) * stroke * 0.44);
    ctx.quadraticCurveTo(px - shift, py + shift, px + Math.cos(angle) * stroke, py + Math.sin(angle) * stroke);
    ctx.stroke();
  });
}

function rainReveal(input, output, ctx, settings) {
  base(ctx, input, "#111e32", 0.28);
  const { width, height } = output;
  const grid = sampleGrid(input, 32);
  const reveal = new Path2D();
  const streaks = new Path2D();
  traverse(grid, width, height, (x, y, tone, dx, dy, id, _offset, cw, ch) => {
    const edge = Math.abs(dx) + Math.abs(dy);
    const seed = noise(id + 578);
    if (seed > 0.11 + 0.34 * edge + 0.17 * Math.abs(tone - 0.47)) return;
    const age = cycle(settings.phase * (seed > 0.14 ? 2 : 1) + noise(id + 23));
    const px = x + (noise(id + 7) - 0.5) * cw * 1.7;
    const py = y - 0.19 * height + age * height * (0.46 + seed);
    const trail = Math.sin(age * Math.PI) * ch * (1.4 + settings.size * 0.5) * (0.6 + tone * 0.72);
    const thickness = Math.max(0.55, cw * (0.12 + (1 - tone) * 0.36 + Math.min(edge, 0.6)));
    reveal.moveTo(px, py - trail);
    reveal.lineTo(px + thickness * 0.76, py - trail * 0.86);
    reveal.lineTo(px - trail * 0.15 + thickness * 0.6, py + thickness);
    reveal.lineTo(px - trail * 0.15 - thickness * 0.6, py);
    reveal.closePath();
    streaks.moveTo(px + thickness * 0.35, py - trail * 0.59);
    streaks.lineTo(px - trail * 0.14 + thickness * 0.35, py);
  });
  ctx.save();
  ctx.clip(reveal);
  ctx.drawImage(input, 0, 0);
  ctx.restore();
  ctx.lineWidth = Math.max(0.62, Math.min(width, height) / 460);
  ctx.strokeStyle = "rgba(167,227,248,0.55)";
  ctx.stroke(streaks);
}

function stardust(input, output, ctx, settings) {
  base(ctx, input, "#090e25", 0.17);
  const grid = sampleGrid(input, Math.round(101 - 2.8 * settings.size));
  ctx.globalCompositeOperation = "screen";
  traverse(grid, output.width, output.height, (x, y, tone, dx, dy, id, offset, cw, ch) => {
    const edge = Math.abs(dx) + Math.abs(dy);
    const seed = noise(id + 34);
    if (seed > 0.12 + tone * 0.7 + edge * 0.22) return;
    const phase = (settings.phase + noise(id + 29)) * TAU;
    const px = x + (noise(id + 1148) - 0.5) * cw * 1.1 + Math.cos(phase) * cw * 0.94;
    const py = y + (noise(id + 1977) - 0.5) * ch * 1.1 + Math.sin(phase) * ch * 0.9;
    const twinkle = (1 + Math.sin(phase * 2 + id)) / 2;
    const size = Math.min(cw, ch) * (0.09 + tone * 0.19 + edge * 0.16) * (0.63 + twinkle * 0.95);
    ctx.fillStyle = colorAt(grid.data, offset, 0.22 + (tone + twinkle) * 0.38, 0.24 + twinkle * 0.37);
    ctx.beginPath();
    ctx.arc(px, py, Math.max(0.38, size), 0, TAU);
    ctx.fill();
  });
}

const effects = {
  "light-play": lightPlay, "spark-field": sparkField, "contour-outline": contour, "crystal-glass": crystalGlass,
  "glass-pixel-dispersion": glassPixel, "pixel-sort": pixelSort, "ribbon-scan": ribbonScan,
  "wave-lines": waveLines, "ember-veil": emberVeil, holo, "particle-brush": particleBrush,
  "rain-reveal": rainReveal, stardust
};

function draw(input, output, settings) {
  const render = effects[settings.type];
  if (!Object.hasOwn(effects, settings.type)) return false;
  const ctx = output.getContext("2d");
  const size = Number.isFinite(settings.size) ? clamp(settings.size, 2, 16) : definitions[settings.type].size;
  const time = Number.isFinite(settings.time) ? settings.time : 0;
  ctx.save();
  try {
    render(input, output, ctx, { ...settings, size, phase: cycle(time / 4) });
  } finally {
    ctx.restore();
  }
  return true;
}
export { definitions, draw };
