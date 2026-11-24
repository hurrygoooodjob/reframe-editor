// Adapted from the Tonepress v06 still-image renderer.
import { newSurface } from "./surface.js";
const define = (name, english, scaleLabel, size, strength, description, extras = {}) => ({
  name, english, scaleLabel, size, strength, description, ...extras
});
const select = (key, label, value, choices) => ({
  key, label, kind: "select", value,
  options: choices.map(([value, label]) => ({value, label}))
});
const definitions = {
  "cross-stitch": define("十字绣", "Cross Stitch", "针脚间距", 6, 96, "用交叠的彩色丝线和布纹重画图像。", {
    controls: [select("fabric", "底布", "linen", [["linen", "亚麻"], ["black", "乌棉"]])]
  }),
  "drift-lines": define("漂移线", "Drift Lines", "线条距离", 7, 89, "用源画面的亮度和颜色拉动曲线。", {timed: true}),
  "glitch-grid": define("故障网格", "Glitch Grid", "故障格大小", 8, 92, "在具有画面细节的网格中交换块并产生分色错位。", {timed: true}),
  "glyph-matrix": define("符文字阵", "Glyph Matrix", "字阵大小", 7, 98, "用明暗驱动的符文和图形线条组成发光点阵。", {
    timed: true, controls: [select("alphabet", "符号组", "runes", [["runes", "符文线"], ["blocks", "几何块"]])]
  }),
  "pixel-press": define("像素印版", "Pixel Press", "印版格大小", 6, 95, "把冷暖颜色拆成重叠的方形墨层，保留纸色和套印偏差。"),
  "pattern-halftone": define("图案半调", "Pattern Halftone", "图案间距", 6, 98, "随着画面暗部加深放大图案覆盖面积。", {
    controls: [select("mark", "图案形状", "diamond", [["diamond", "菱形"], ["circle", "圆点"], ["bars", "斜线"]])]
  }),
  "pixel-dither-glow": define("发光抖点", "Pixel Dither Glow", "发光像素大小", 5, 98, "有序抖色映成深蓝与霓虹蓝，并为亮点添加晕光。"),
  "pixel-poster": define("像素海报", "Pixel Poster", "海报色块尺寸", 6, 97, "用分级的高饱和色块保留大形和明暗。"),
  "retro-matrix": define("复古矩阵", "Retro Matrix", "屏幕单元大小", 6, 97, "深色底上以明暗选择点、块和扫描格。", {
    timed: true, controls: [select("phosphor", "荧光颜色", "green", [["green", "电绿"], ["amber", "琥珀"]])]
  }),
  "riso-glow": define("孔版泛光", "Riso Glow", "色版纹距", 7, 90, "把照片转成青紫圆点套印，让较亮区域向邻近扩光。"),
  "scatter-mosaic": define("散落马赛克", "Scatter Mosaic", "散块大小", 8, 93, "使亮度变化明显的画面块离开原位并随时间漂移。", {timed: true}),
  "symbol-matrix": define("图标矩阵", "Symbol Matrix", "符号间距", 7, 98, "按亮度选择圆、横杠、十字和星形。"),
  "tone-geometry": define("色阶几何", "Tone Geometry", "几何单元大小", 8, 97, "用线、圆和色块表达不同明暗区间。"),
  blockify: define("凸起方块", "Blockify", "浮雕块大小", 7, 95, "把色块铺成明暗起伏的方形浮雕。"),
  "3d-toy-bricks": define("立体玩具砖", "3D Toy Bricks", "积木砖大小", 8, 98, "每块砖按原色重建，并绘出侧面、投影和凸钉。", {
    controls: [select("studs", "凸钉", "two", [["one", "单凸钉"], ["two", "双凸钉"]])]
  }),
  outline: define("彩色描边", "Outline", "描边宽度", 6, 96, "沿颜色边界提取粗描边，在画面上压出墨线。"),
  "quadtree-zoom": define("四叉树分割", "Quadtree Zoom", "保留细节大小", 7, 96, "依据区域亮度方差递归切块，复杂区域会得到更多小块。"),
  voronoi: define("沃罗诺伊镶嵌", "Voronoi", "种子间距", 8, 97, "依据最近种子划分不规则多边形，使用种子附近的源色。")
};

const samplerCache = new WeakMap();
const outlineCache = new WeakMap();
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const mix = (a, b, amount) => a + (b - a) * amount;
const brightness = (r, g, b) => (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
const gray = color => brightness(...color);
const color = (source, amount = 1, offset = 0) =>
  "rgb(" + source.map(value => Math.round(clamp(value * amount + offset, 0, 255))).join(",") + ")";
function hash(x, y) {
  const seed = Math.imul(x | 0, 1597334677) ^ Math.imul(y | 0, 3812015801);
  const result = Math.imul(seed ^ (seed >>> 16), 2246822519);
  return ((result ^ (result >>> 13)) >>> 0) / 4294967296;
}

function inputPixels(input, limit) {
  let surface = samplerCache.get(input);
  if (!surface) {
    const canvas = newSurface();
    surface = {canvas, ctx: canvas.getContext("2d", {willReadFrequently: true})};
    samplerCache.set(input, surface);
  }
  const scale = Math.min(1, limit / Math.max(input.width, input.height));
  const w = Math.max(1, Math.round(input.width * scale));
  const h = Math.max(1, Math.round(input.height * scale));
  if (surface.canvas.width !== w) surface.canvas.width = w;
  if (surface.canvas.height !== h) surface.canvas.height = h;
  const ctx = surface.ctx;
  ctx.globalCompositeOperation = "copy";
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(input, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function frameSource(input, output, settings) {
  const width = settings.sourceWidth > 0 ? settings.sourceWidth : input.width;
  const height = settings.sourceHeight > 0 ? settings.sourceHeight : input.height;
  const size = clamp(Number.isFinite(settings.size) ? settings.size : 7, 2, 16);
  const time = Number.isFinite(settings.time) ? Math.max(0, settings.time) : 0;
  const ctx = output.getContext("2d");
  const pixels = inputPixels(input, settings.type === "outline" ? 640 : 520);
  const read = (x, y) => {
    const col = clamp(Math.floor(x / width * pixels.width), 0, pixels.width - 1);
    const row = clamp(Math.floor(y / height * pixels.height), 0, pixels.height - 1);
    const index = (row * pixels.width + col) * 4;
    return [pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]];
  };
  return {input, output, width, height, size, time, ctx, pixels, read, settings};
}

function step(frame, multiplier, minimum = 2) {
  return Math.max(minimum, frame.size * multiplier, frame.width / 165, frame.height / 128);
}
function cells(frame, pitch, process) {
  for (let row = 0; row * pitch < frame.height; row++) {
    for (let col = 0; col * pitch < frame.width; col++) {
      const x = (col + 0.5) * pitch, y = (row + 0.5) * pitch;
      const rgb = frame.read(x, y);
      process(x, y, rgb, gray(rgb), col, row);
    }
  }
}
function background(frame, css) {
  frame.ctx.fillStyle = css;
  frame.ctx.fillRect(0, 0, frame.width, frame.height);
}
function polygon(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
}
function ellipse(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2);
  ctx.fill();
}

function crossStitch(frame) {
  const {ctx, settings} = frame;
  const dark = settings.fabric === "black";
  background(frame, dark ? "#1d2330" : "#e0d3b9");
  const pitch = step(frame, 2.8);
  ctx.lineCap = "round";
  cells(frame, pitch, (x, y, rgb, light) => {
    const spread = pitch * (0.26 + (1 - light) * 0.15);
    ctx.strokeStyle = dark ? "#313846" : "#c9baa0";
    ctx.lineWidth = pitch * 0.055;
    ctx.strokeRect(x - pitch * 0.485, y - pitch * 0.485, pitch * 0.97, pitch * 0.97);
    ctx.lineWidth = pitch * 0.23;
    ctx.strokeStyle = color(rgb, dark ? 0.84 : 0.77, dark ? 15 : 5);
    ctx.beginPath();
    ctx.moveTo(x - spread, y - spread);
    ctx.lineTo(x + spread, y + spread);
    ctx.stroke();
    ctx.strokeStyle = color(rgb, 0.94, dark ? 28 : 20);
    ctx.beginPath();
    ctx.moveTo(x - spread, y + spread);
    ctx.lineTo(x + spread, y - spread);
    ctx.stroke();
  });
}

function driftLines(frame) {
  const {ctx, width, height, time, read} = frame;
  background(frame, "#0b1824");
  const pitch = step(frame, 2.65);
  const gap = pitch * 1.65;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let y = pitch * 0.5; y < height; y += pitch) {
    let x0 = 0, y0 = y;
    for (let x = 0; x < width + gap; x += gap) {
      const rgb = read(x, y);
      const t = gray(rgb);
      const displaced = y + (0.25 + t) * pitch * 0.80
        * Math.sin(x / (pitch * 4.8) + y / (pitch * 3.3) - time * 3.1)
        + (t - 0.5) * pitch * 1.15;
      ctx.lineWidth = pitch * (0.075 + 0.37 * t);
      ctx.strokeStyle = color(rgb, 0.72, 37);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x, displaced);
      ctx.stroke();
      x0 = x;
      y0 = displaced;
    }
  }
}

function glitchGrid(frame) {
  const {ctx, width, height, output, input, time, read} = frame;
  const pitch = step(frame, 4.15);
  const tick = Math.floor(time * 8);
  const sx = output.width / width, sy = output.height / height;
  ctx.drawImage(input, 0, 0, width, height);
  cells(frame, pitch, (cx, cy, rgb, light, x, y) => {
    const px = cx - pitch / 2, py = cy - pitch / 2;
    const difference = Math.abs(light - gray(read(cx + pitch, cy))) + Math.abs(light - gray(read(cx, cy + pitch)));
    if (hash(x + tick * 13, y + 8) < 0.84 - Math.min(0.26, difference * 0.38)) return;
    const w = Math.min(pitch, width - px), h = Math.min(pitch, height - py);
    const dx = clamp(px + pitch * (hash(x - 8, y + tick * 5) - 0.5) * 5, 0, width - w);
    const dy = clamp(py + pitch * (hash(y + 4, x + tick) - 0.5) * 3, 0, height - h);
    ctx.drawImage(input, dx * sx, dy * sy, w * sx, h * sy, px, py, w, h);
    ctx.globalAlpha = 0.56;
    ctx.fillStyle = hash(y, x + 4) < 0.5 ? "#e930bd" : "#27d8de";
    ctx.fillRect(px, py, w * 0.18, h);
    ctx.fillStyle = color(rgb, 1.16, 14);
    ctx.fillRect(px, py + h * 0.83, w, Math.max(1, h * 0.09));
    ctx.globalAlpha = 1;
  });
}

const runeSegments = [
  [[0, 1], [1, 2]], [[0, 3], [3, 6]], [[0, 4], [4, 8]], [[1, 4], [4, 7]],
  [[1, 3], [1, 5], [3, 7]], [[0, 5], [2, 3], [1, 7]], [[0, 8], [2, 6], [3, 5]],
  [[0, 2], [0, 6], [2, 8], [6, 8], [0, 8]], [[0, 2], [2, 8], [8, 6], [6, 0], [1, 7], [3, 5]]
];
function glyphMatrix(frame) {
  const {ctx, time, settings} = frame;
  background(frame, "#111623");
  const pitch = step(frame, 3.35);
  const blockLetters = settings.alphabet === "blocks";
  ctx.lineCap = "round";
  cells(frame, pitch, (x, y, rgb, light, col, row) => {
    const rise = Math.floor(clamp(light * 0.96 + Math.sin(row * 0.31 - time * 2.6) * 0.09) * 8);
    const type = clamp(rise + (hash(col + 37, row) > 0.74 ? 1 : 0), 0, 8);
    const ink = [mix(40, rgb[0], 0.55), mix(96, rgb[1], 0.62), mix(104, rgb[2], 0.55)];
    ctx.strokeStyle = ctx.fillStyle = color(ink, 0.77 + light * 0.95, 9);
    ctx.lineWidth = pitch * (0.039 + light * 0.055);
    if (blockLetters) {
      for (const [a, b] of runeSegments[type]) {
        ctx.fillRect(x + ((a % 3) - 1) * pitch * 0.24, y + (Math.floor(a / 3) - 1) * pitch * 0.24, pitch * 0.18, pitch * 0.18);
        ctx.fillRect(x + ((b % 3) - 1) * pitch * 0.24, y + (Math.floor(b / 3) - 1) * pitch * 0.24, pitch * 0.18, pitch * 0.18);
      }
    } else {
      ctx.beginPath();
      for (const [a, b] of runeSegments[type]) {
        ctx.moveTo(x + ((a % 3) - 1) * pitch * 0.27, y + (Math.floor(a / 3) - 1) * pitch * 0.33);
        ctx.lineTo(x + ((b % 3) - 1) * pitch * 0.27, y + (Math.floor(b / 3) - 1) * pitch * 0.33);
      }
      ctx.stroke();
    }
  });
}

function pixelPress(frame) {
  const {ctx} = frame;
  background(frame, "#ede2ca");
  const pitch = step(frame, 3.0);
  ctx.globalCompositeOperation = "multiply";
  cells(frame, pitch, (x, y, rgb, light) => {
    const cool = clamp((1 - light) * 0.91 + (rgb[2] - rgb[0]) / 480);
    const warm = clamp((1 - light) * 0.66 + (rgb[0] - rgb[2]) / 410);
    ctx.fillStyle = "#317e9c";
    const a = pitch * (0.11 + 0.80 * Math.sqrt(cool));
    ctx.fillRect(x - a / 2 - pitch * 0.10, y - a / 2 + pitch * 0.09, a, a);
    ctx.fillStyle = "#e24d37";
    const b = pitch * (0.08 + 0.76 * Math.sqrt(warm));
    ctx.fillRect(x - b / 2 + pitch * 0.08, y - b / 2 - pitch * 0.07, b, b);
    if (light < 0.44) {
      ctx.fillStyle = "#363750";
      ctx.fillRect(x - pitch * 0.12, y - pitch * 0.13, pitch * 0.24, pitch * 0.26);
    }
  });
}

function patternHalftone(frame) {
  const {ctx, settings} = frame;
  background(frame, "#f8ead9");
  const pitch = step(frame, 2.75);
  const shape = settings.mark || "diamond";
  ctx.fillStyle = "#4b2556";
  ctx.strokeStyle = "#4b2556";
  ctx.lineCap = "round";
  cells(frame, pitch, (x, y, _, light, col, row) => {
    const radius = pitch * (0.045 + Math.sqrt(1 - light) * 0.48);
    if (shape === "circle") ellipse(ctx, x, y, radius, radius);
    else if (shape === "bars") {
      const sign = (col + row) % 2 ? -1 : 1;
      ctx.lineWidth = Math.max(0.5, radius * 0.75);
      ctx.beginPath();
      ctx.moveTo(x - radius * 0.76, y - radius * 0.76 * sign);
      ctx.lineTo(x + radius * 0.76, y + radius * 0.76 * sign);
      ctx.stroke();
    } else {
      polygon(ctx, [[x, y - radius], [x + radius, y], [x, y + radius], [x - radius, y]]);
      ctx.fill();
    }
  });
}

const ordered = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function pixelDitherGlow(frame) {
  const {ctx, output, width} = frame;
  background(frame, "#071328");
  const pitch = step(frame, 2.4);
  const levels = Array.from({length: 4}, () => new Path2D());
  cells(frame, pitch, (x, y, _, light, col, row) => {
    const threshold = (ordered[(row % 4) * 4 + (col % 4)] + 0.5) / 16 - 0.5;
    const level = clamp(Math.floor(light * 3.6 + threshold * 1.28), 0, 3);
    const tile = pitch * (0.48 + 0.13 * level);
    levels[level].rect(x - tile / 2, y - tile / 2, tile, tile);
  });
  const inks = ["#122547", "#155587", "#37c3df", "#c5ffe3"];
  ctx.shadowColor = "#40ddfc";
  for (const [index, path] of levels.entries()) {
    ctx.shadowBlur = index >= 2 ? Math.max(1, pitch * output.width / width * (index === 3 ? 1.35 : 1.05)) : 0;
    ctx.fillStyle = inks[index];
    ctx.fill(path);
  }
}

function pixelPoster(frame) {
  const {ctx, size, input, width, height} = frame;
  ctx.drawImage(input, 0, 0, width, height);
  const pitch = step(frame, 3.8);
  const blocks = Math.max(3, Math.round(8 - size * 0.28));
  cells(frame, pitch, (x, y, rgb, light) => {
    const poster = rgb.map(value => {
      const vivid = clamp(light + (value / 255 - light) * 1.35);
      return Math.round(vivid * blocks) * 255 / blocks;
    });
    ctx.fillStyle = color(poster, 0.97, 5);
    ctx.fillRect(x - pitch / 2, y - pitch / 2, pitch + 0.3, pitch + 0.3);
  });
}

function retroMatrix(frame) {
  const {ctx, time, settings} = frame;
  background(frame, "#0f1718");
  const amber = settings.phosphor === "amber";
  const pitch = step(frame, 2.75), tick = Math.floor(time * 16);
  const colors = amber ? ["#302322", "#604025", "#d09642", "#ffe28d"] : ["#1c3330", "#28534e", "#60aa6b", "#c1f58b"];
  cells(frame, pitch, (x, y, _, light, col, row) => {
    const jitter = (hash(col + tick, row + 7) - 0.5) * 0.11;
    const level = clamp(Math.floor((light + jitter) * 4), 0, 3);
    ctx.fillStyle = colors[level];
    if (!level) ellipse(ctx, x, y, pitch * 0.09, pitch * 0.09);
    else {
      const w = pitch * (0.32 + 0.16 * level), h = pitch * (0.16 + 0.075 * level);
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
      if (level >= 2) ctx.fillRect(x - w / 2, y + h * 0.89, w, pitch * 0.052);
      if (level === 3) ctx.fillRect(x - w / 2, y - h * 0.96, w, pitch * 0.06);
    }
  });
}

function risoGlow(frame) {
  const {ctx, output, width} = frame;
  background(frame, "#eadbdf");
  const pitch = step(frame, 3.55);
  const inks = [new Path2D(), new Path2D()], lights = new Path2D();
  cells(frame, pitch, (x, y, rgb, light) => {
    const cool = clamp((1 - light) * 0.88 + (rgb[2] - rgb[0]) / 380);
    const pink = clamp((1 - light) * 0.78 + (rgb[0] - rgb[1]) / 430);
    const radii = [pitch * (0.08 + 0.49 * cool), pitch * (0.04 + 0.46 * pink)];
    for (const [index, radius] of radii.entries()) {
      const offset = index ? pitch * 0.16 : -pitch * 0.15;
      inks[index].moveTo(x + offset + radius, y - offset * 0.55);
      inks[index].arc(x + offset, y - offset * 0.55, radius, 0, 2 * Math.PI);
    }
    if (light > 0.66) {
      const radius = pitch * (0.17 + (light - 0.66) * 0.79);
      lights.moveTo(x + radius, y);
      lights.arc(x, y, radius, 0, 2 * Math.PI);
    }
  });
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "#65bbcf";
  ctx.fill(inks[0]);
  ctx.fillStyle = "#bc5d9c";
  ctx.fill(inks[1]);
  ctx.globalCompositeOperation = "screen";
  ctx.shadowBlur = Math.max(2, pitch * output.width / width * 1.15);
  ctx.shadowColor = "#f3bdf0";
  ctx.fillStyle = "#f2a9db";
  ctx.fill(lights);
}

function scatterMosaic(frame) {
  const {ctx, time, read, width, height, input} = frame;
  const pitch = step(frame, 4.5);
  background(frame, "#25343e");
  ctx.globalAlpha = 0.28;
  ctx.drawImage(input, 0, 0, width, height);
  ctx.globalAlpha = 1;
  cells(frame, pitch, (x, y, rgb, light, col, row) => {
    const edge = Math.abs(light - gray(read(x + pitch * 0.5, y))) + Math.abs(light - gray(read(x, y + pitch * 0.5)));
    const phase = hash(col + 1, row - 8) * 6.28;
    const sway = Math.sin(time * 2.1 + phase);
    const displacement = Math.min(1.5, edge * 3.4 + 0.19) * pitch;
    const tx = (hash(row, col) - 0.5) * displacement * (1.5 + 0.65 * sway);
    const ty = (hash(col, row + 7) - 0.5) * displacement + sway * displacement * 0.29;
    const block = pitch * (0.71 + light * 0.21);
    ctx.fillStyle = color(rgb);
    ctx.fillRect(x - block / 2 + tx, y - block / 2 + ty, block, block);
  });
}

function symbolMatrix(frame) {
  const {ctx} = frame;
  background(frame, "#24182f");
  const pitch = step(frame, 4.6);
  ctx.lineCap = "round";
  cells(frame, pitch, (x, y, rgb, light) => {
    const r = pitch * (0.15 + light * 0.25);
    ctx.fillStyle = ctx.strokeStyle = color([mix(222, rgb[0], 0.47), mix(154, rgb[1], 0.48), mix(223, rgb[2], 0.49)], 0.53 + light * 0.82, 7);
    ctx.lineWidth = pitch * 0.105;
    if (light > 0.7) {
      polygon(ctx, [[x - r, y], [x - r * 0.22, y - r * 0.21], [x, y - r], [x + r * 0.22, y - r * 0.21],
        [x + r, y], [x + r * 0.22, y + r * 0.21], [x, y + r], [x - r * 0.22, y + r * 0.21]]);
      ctx.fill();
    } else if (light > 0.52) {
      ctx.beginPath();
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      ctx.moveTo(x, y - r);
      ctx.lineTo(x, y + r);
      ctx.stroke();
    } else if (light > 0.29) {
      ctx.beginPath();
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      ctx.stroke();
    } else ellipse(ctx, x, y, r * 0.53, r * 0.53);
  });
}

function toneGeometry(frame) {
  const {ctx, read} = frame;
  background(frame, "#f4e5cb");
  const pitch = step(frame, 4.25);
  cells(frame, pitch, (x, y, rgb, light) => {
    const fill = color(rgb, 0.92, 18);
    ctx.fillStyle = fill;
    ctx.strokeStyle = fill;
    ctx.lineWidth = pitch * 0.095;
    if (light < 0.37) {
      const block = pitch * (0.98 - light * 0.17);
      ctx.fillRect(x - block / 2, y - block / 2, block, block);
    } else if (light < 0.69) {
      ellipse(ctx, x, y, pitch * 0.433, pitch * 0.35);
    } else {
      const gx = gray(read(x + pitch * 0.51, y)) - gray(read(x - pitch * 0.51, y));
      const gy = gray(read(x, y + pitch * 0.51)) - gray(read(x, y - pitch * 0.51));
      const angle = Math.atan2(gy, gx) + Math.PI / 2;
      const r = pitch * 0.43;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(angle) * r, y - Math.sin(angle) * r);
      ctx.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
      ctx.stroke();
    }
  });
}

function blockify(frame) {
  const {ctx} = frame;
  background(frame, "#334049");
  const pitch = step(frame, 4.65);
  cells(frame, pitch, (x, y, rgb, light) => {
    const r = pitch * (0.33 + 0.12 * light), bevel = pitch * (0.14 - light * 0.06);
    ctx.fillStyle = color(rgb, 0.67, 7);
    ctx.fillRect(x - pitch / 2, y - pitch / 2, pitch, pitch);
    ctx.fillStyle = color(rgb, 0.51, 6);
    ctx.fillRect(x - r, y - r, r * 2 + bevel * 0.9, r * 2 + bevel * 0.9);
    ctx.fillStyle = color(rgb, 0.95, 10);
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.fillStyle = color(rgb, 0.89, 43);
    ctx.fillRect(x - r, y - r, r * 2, bevel * 0.42);
    ctx.fillRect(x - r, y - r, bevel * 0.47, r * 2);
  });
}

function toyBricks(frame) {
  const {ctx, settings} = frame;
  background(frame, "#323645");
  const pitch = step(frame, 5.8);
  const positions = settings.studs === "one" ? [0.5] : [0.28, 0.72];
  cells(frame, pitch, (x, y, rgb, light) => {
    const left = x - pitch * 0.44, right = x + pitch * 0.34;
    const top = y - pitch * 0.42, bottom = y + pitch * 0.29;
    const depth = pitch * (0.13 + light * 0.07);
    ctx.fillStyle = color(rgb, 0.34, 6);
    polygon(ctx, [[left + depth * 1.15, bottom + depth], [right + depth, top + depth],
      [right + depth * 1.42, bottom + depth * 1.33], [left + depth * 1.33, bottom + depth * 1.33]]);
    ctx.fill();
    ctx.fillStyle = color(rgb, 0.55, 8);
    polygon(ctx, [[right, top], [right + depth, top + depth], [right + depth, bottom + depth], [right, bottom]]);
    ctx.fill();
    ctx.fillStyle = color(rgb, 0.73, 9);
    polygon(ctx, [[left, bottom], [right, bottom], [right + depth, bottom + depth], [left + depth, bottom + depth]]);
    ctx.fill();
    ctx.fillStyle = color(rgb, 1, 12);
    ctx.fillRect(left, top, right - left, bottom - top);
    ctx.fillStyle = color(rgb, 0.99, 30);
    ctx.fillRect(left, top, right - left, pitch * 0.026);
    for (const position of positions) {
      const center = mix(left, right, position);
      const cy = mix(top, bottom, 0.53);
      ctx.fillStyle = color(rgb, 0.52, 10);
      ellipse(ctx, center + pitch * 0.036, cy + pitch * 0.062, pitch * 0.138, pitch * 0.12);
      ctx.fillStyle = color(rgb, 0.77, 15);
      ellipse(ctx, center, cy + pitch * 0.025, pitch * 0.138, pitch * 0.12);
      ctx.fillStyle = color(rgb, 1.04, 39);
      ellipse(ctx, center, cy - pitch * 0.029, pitch * 0.136, pitch * 0.104);
    }
  });
}

function outline(frame) {
  const {ctx, input, width, height, size, output, pixels} = frame;
  const kernel = Math.max(1, Math.round((1 + size * 0.48) * pixels.width / width));
  const w = pixels.width, h = pixels.height;
  const data = pixels.data;
  const index = (x, y) => (clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)) * 4;
  function difference(a, b) {
    return (Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]) +
      Math.abs(data[a + 2] - data[b + 2]) + Math.abs(data[a + 3] - data[b + 3]) * 0.96) / 765;
  }
  const owner = output;
  if (!outlineCache.has(owner)) outlineCache.set(owner, newSurface());
  const b = outlineCache.get(owner);
  if (b.width !== w) b.width = w;
  if (b.height !== h) b.height = h;
  const mask = b.getContext("2d");
  const layer = mask.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const edge = Math.max(difference(index(x - kernel, y), index(x + kernel, y)),
        difference(index(x, y - kernel), index(x, y + kernel)));
      layer.data[i] = 16;
      layer.data[i + 1] = 24;
      layer.data[i + 2] = 47;
      layer.data[i + 3] = clamp((edge - 0.045) * 5) * 255;
    }
  }
  mask.putImageData(layer, 0, 0);
  background(frame, "#e9e7de");
  ctx.globalAlpha = 0.87;
  ctx.drawImage(input, 0, 0, width, height);
  ctx.globalAlpha = 1;
  ctx.drawImage(b, 0, 0, width, height);
}

function integralFields(pixels) {
  const w = pixels.width, h = pixels.height, stride = w + 1;
  const sum = new Float64Array(stride * (h + 1));
  const squares = new Float64Array(sum.length);
  for (let y = 1; y <= h; y++) {
    let row = 0, rowSquares = 0;
    for (let x = 1; x <= w; x++) {
      const offset = ((y - 1) * w + x - 1) * 4;
      const tone = brightness(pixels.data[offset], pixels.data[offset + 1], pixels.data[offset + 2]);
      const i = y * stride + x;
      row += tone;
      rowSquares += tone * tone;
      sum[i] = sum[i - stride] + row;
      squares[i] = squares[i - stride] + rowSquares;
    }
  }
  const area = (field, x0, y0, x1, y1) => field[y1 * stride + x1] - field[y0 * stride + x1]
    - field[y1 * stride + x0] + field[y0 * stride + x0];
  return function variation(x0, y0, x1, y1) {
    const n = (x1 - x0) * (y1 - y0);
    const mean = area(sum, x0, y0, x1, y1) / n;
    return area(squares, x0, y0, x1, y1) / n - mean * mean;
  };
}

function quadtree(frame) {
  const {ctx, width, height, pixels, size, read} = frame;
  const w = pixels.width, h = pixels.height;
  const sx = width / w, sy = height / h;
  const target = step(frame, 2.4, 4);
  const cutoff = (0.026 + size * 0.0021) ** 2;
  const variance = integralFields(pixels);
  function divide(x0, y0, x1, y1, levels) {
    const x = (x1 + x0) >> 1, y = (y1 + y0) >> 1;
    const w = (x1 - x0) * sx, h = (y1 - y0) * sy;
    const canSplit = x > x0 && y > y0 && w > target * 1.65 && h > target * 1.65;
    const detailed = variance(x0, y0, x1, y1) > cutoff;
    if (levels && canSplit && (detailed || w > target * 16 || h > target * 16)) {
      divide(x0, y0, x, y, levels - 1);
      divide(x, y0, x1, y, levels - 1);
      divide(x0, y, x, y1, levels - 1);
      divide(x, y, x1, y1, levels - 1);
      return;
    }
    const colors = [read(mix(x0, x1, 0.28) * sx, mix(y0, y1, 0.29) * sy),
      read(mix(x0, x1, 0.70) * sx, mix(y0, y1, 0.72) * sy),
      read((x0 + x1) * sx / 2, (y0 + y1) * sy / 2)];
    ctx.fillStyle = color(colors[0].map((channel, index) => (channel + colors[1][index] + colors[2][index] * 2) / 4));
    ctx.fillRect(x0 * sx, y0 * sy, w + 0.3, h + 0.3);
    ctx.strokeStyle = "rgba(28,36,49,.24)";
    ctx.lineWidth = Math.max(0.5, target * 0.051);
    ctx.strokeRect(x0 * sx, y0 * sy, w, h);
  }
  divide(0, 0, w, h, 9);
}

function clipCell(vertices, seed, other) {
  if (!vertices.length) return vertices;
  const dx = other[0] - seed[0], dy = other[1] - seed[1];
  const offset = (other[0] + seed[0]) * dx * 0.5 + (other[1] + seed[1]) * dy * 0.5;
  const clipped = [];
  let last = vertices[vertices.length - 1];
  let old = last[0] * dx + last[1] * dy - offset;
  for (const point of vertices) {
    const next = point[0] * dx + point[1] * dy - offset;
    if ((old > 0) !== (next > 0)) {
      const ratio = old / (old - next);
      clipped.push([mix(last[0], point[0], ratio), mix(last[1], point[1], ratio)]);
    }
    if (next <= 0) clipped.push(point);
    last = point;
    old = next;
  }
  return clipped;
}

function voronoi(frame) {
  const {ctx, width, height, read, input} = frame;
  const pitch = step(frame, 5.7, 11);
  const cols = Math.ceil(width / pitch), rows = Math.ceil(height / pitch), stride = cols + 8;
  const seeds = [];
  // Jitter is limited to 0.29 cell per axis. A point's own lattice cell
  // always has a seed within 1.12 cells, so farther sites cannot clip it.
  for (let y = -4; y < rows + 4; y++) {
    for (let x = -4; x < cols + 4; x++) {
      seeds.push([(x + 0.5 + (hash(x + 3, y + 8) - 0.5) * 0.58) * pitch,
        (y + 0.5 + (hash(x - 9, y + 15) - 0.5) * 0.58) * pitch]);
    }
  }
  const site = (x, y) => seeds[(y + 4) * stride + x + 4];
  ctx.drawImage(input, 0, 0, width, height);
  ctx.lineWidth = pitch * 0.033;
  for (let y = -2; y < rows + 2; y++) {
    for (let x = -2; x < cols + 2; x++) {
      const seed = site(x, y);
      let shape = [[Math.max(0, seed[0] - pitch * 1.14), Math.max(0, seed[1] - pitch * 1.14)],
        [Math.min(width, seed[0] + pitch * 1.14), Math.max(0, seed[1] - pitch * 1.14)],
        [Math.min(width, seed[0] + pitch * 1.14), Math.min(height, seed[1] + pitch * 1.14)],
        [Math.max(0, seed[0] - pitch * 1.14), Math.min(height, seed[1] + pitch * 1.14)]];
      if (shape[0][0] >= shape[1][0] || shape[0][1] >= shape[2][1]) continue;
      for (let dy = -2; dy <= 2 && shape.length; dy++) {
        for (let dx = -2; dx <= 2 && shape.length; dx++) {
          if (dx || dy) shape = clipCell(shape, seed, site(x + dx, y + dy));
        }
      }
      if (shape.length < 3) continue;
      const rgb = read(...seed);
      ctx.fillStyle = color(rgb, 0.95, 8);
      ctx.strokeStyle = color(rgb, 0.54, 12);
      polygon(ctx, shape);
      ctx.fill();
      ctx.stroke();
    }
  }
}

const painters = {
  "cross-stitch": crossStitch, "drift-lines": driftLines, "glitch-grid": glitchGrid,
  "glyph-matrix": glyphMatrix, "pixel-press": pixelPress, "pattern-halftone": patternHalftone,
  "pixel-dither-glow": pixelDitherGlow, "pixel-poster": pixelPoster, "retro-matrix": retroMatrix,
  "riso-glow": risoGlow, "scatter-mosaic": scatterMosaic, "symbol-matrix": symbolMatrix,
  "tone-geometry": toneGeometry, blockify, "3d-toy-bricks": toyBricks, outline,
  "quadtree-zoom": quadtree, voronoi
};

function draw(input, output, settings) {
  if (!Object.hasOwn(painters, settings.type)) return false;
  const frame = frameSource(input, output, settings);
  const ctx = frame.ctx;
  ctx.save();
  try {
    ctx.setTransform(output.width / frame.width, 0, 0, output.height / frame.height, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    painters[settings.type](frame);
  } finally {
    ctx.restore();
  }
  return true;
}
export { definitions, draw };
