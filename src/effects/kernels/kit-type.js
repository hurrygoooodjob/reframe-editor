// Adapted from the Tonepress v06 still-image renderer.
const diamond = [
  "00011000", "00111100", "01100110", "11011011",
  "11011011", "01100110", "00111100", "00011000"
].join("");
const textControl = (label, value, maxLength) => ({key: "text", label, kind: "text", value, maxLength});
const selectControl = (key, label, value, options) => ({
  key, label, kind: "select", value,
  options: Object.entries(options).map(([option, caption]) => ({value: option, label: caption}))
});

const definitions = {
  "ascii-ghost": {
    name: "字符幽影", english: "ASCII Ghost", scaleLabel: "字符尺度", size: 7, strength: 92,
    description: "以亮度选字，在相邻位置印出淡色字符影。"
  },
  "tag-pills": {
    name: "胶囊标签", english: "Tag Pills", scaleLabel: "标签尺度", size: 9, strength: 100,
    description: "从素材取色与明暗，把画面拼成可读的胶囊标签。",
    controls: [selectControl("labelMode", "标签内容", "level", {level: "亮度百分比", channel: "颜色通道", none: "仅胶囊"})]
  },
  "data-hatching": {
    name: "数据排线", english: "Data Hatching", scaleLabel: "排线尺度", size: 7, strength: 100,
    description: "以明暗控制有刻度的短排线数量，用色差改变线条方向。"
  },
  "dither-text": {
    name: "抖色文字", english: "Dither Text", scaleLabel: "字符点距", size: 6, strength: 100,
    description: "将给定文字转为点阵，连续抖色网格在文字内部表现原图明暗。",
    controls: [textControl("重复文字", "TONEPRESS", 36)]
  },
  "glyph-studio": {
    name: "点阵字形", english: "Glyph Studio", scaleLabel: "字格尺度", size: 7, strength: 100,
    description: "用手绘或导入的 8×8 字形重组素材，每格取原图颜色。",
    controls: [{key: "glyph", label: "编辑字形", kind: "bitmap", value: diamond},
      selectControl("inkMode", "字形着色", "source", {source: "原片取色", mono: "单色油墨"})]
  },
  "grid-glyph": {
    name: "网格符号", english: "Grid Glyph", scaleLabel: "符号格距", size: 9, strength: 100,
    description: "在固定网格中，用几何符号的形状、明度和空实表达素材。"
  },
  "inscribe": {
    name: "铭文刻印", english: "Inscribe", scaleLabel: "铭文行距", size: 8, strength: 100,
    description: "让重复文字沿画面横排，亮度决定字的刻痕和阴影。",
    controls: [textControl("铭刻文字", "MEMORY PRESSED IN INK", 60)]
  },
  "matrix-rain": {
    name: "矩阵字雨", english: "Matrix Rain", scaleLabel: "字雨格距", size: 7, strength: 100, timed: true,
    description: "原片亮度调制字符密度，不同列按素材时间落下。",
    controls: [selectControl("rainSpeed", "下落速度", "steady", {slow: "慢速", steady: "中速", fast: "快速"})]
  },
  "number-field": {
    name: "数字场", english: "Number Field", scaleLabel: "数字格距", size: 8, strength: 100,
    description: "每格读取明暗，将画面还原为带色阶的数值记录。",
    controls: [selectControl("radix", "数字格式", "decimal", {decimal: "0–99", hex: "00–FF"})]
  },
  "pixel-code": {
    name: "像素编码", english: "Pixel Code", scaleLabel: "编码方块", size: 7, strength: 100,
    description: "把原片每格的颜色与亮度编码为块状位图和定位像素。"
  },
  "word-mosaic": {
    name: "词语马赛克", english: "Word Mosaic", scaleLabel: "词语布局", size: 9, strength: 100,
    description: "用输入词语组成宽窄不同的拼贴块，每块从素材取色。",
    controls: [textControl("马赛克文字", "TONE PRESS PRINT IMAGE", 120)]
  },
  "knitted-embroidery": {
    name: "针织刺绣", english: "Knitted Embroidery", scaleLabel: "线圈尺度", size: 6, strength: 100,
    description: "每格像素化为有起伏的双色 V 形线圈，保留素材色彩关系。"
  },
  "kilim-carpet": {
    name: "平织地毯", english: "Kilim Carpet", scaleLabel: "菱纹尺度", size: 9, strength: 100,
    description: "按取样色织成连续菱纹，每个织块保留经纬线结构。",
    controls: [selectControl("weavePalette", "纱线配色", "earth", {earth: "陶土与靛蓝", lake: "湖蓝与胡桃"})]
  },
  "stitch-poster": {
    name: "缝线海报", english: "Stitch Poster", scaleLabel: "缝针间距", size: 9, strength: 100,
    description: "将照片铺成色块布片，再在颜色交界处缝上断续的针脚。"
  },
  "vector-engraving": {
    name: "矢量版画", english: "Vector Engraving", scaleLabel: "刻线间距", size: 6, strength: 100,
    description: "以细曲线的深浅、弯曲和交叠模拟版画刻线。"
  },
  "contour-type": {
    name: "等高线文字", english: "Contour Type", scaleLabel: "字纹间距", size: 7, strength: 100,
    description: "让标点随轮廓方向排列，较弱内部纹理用稀疏字符表示。",
    controls: [textControl("轮廓字符", ".:/+*", 16)]
  }
};

const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const ascii = Array.from(" .,:-+=*#%@");
const documents = new WeakMap();
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const modulo = (value, period) => ((value % period) + period) % period;
const rgb = (r, g, b) => "rgb(" + Math.round(clamp(r, 0, 255)) + "," +
  Math.round(clamp(g, 0, 255)) + "," + Math.round(clamp(b, 0, 255)) + ")";
const shade = (tone, dark, light) => rgb(
  dark[0] + (light[0] - dark[0]) * tone,
  dark[1] + (light[1] - dark[1]) * tone,
  dark[2] + (light[2] - dark[2]) * tone
);
const hash = (x, y) => {
  const seed = Math.imul((x | 0) + 1283, 1597334677) ^ Math.imul((y | 0) + 593, 3812015801);
  return ((seed ^ seed >>> 13) >>> 0) / 4294967296;
};
const normalizedText = (value, fallback, limit) =>
  Array.from(typeof value === "string" && value.trim() ? value.trim() : fallback).slice(0, limit);

function makeCanvas(owner) {
  return owner.ownerDocument ? owner.ownerDocument.createElement("canvas") : new OffscreenCanvas(1, 1);
}

function cacheFor(output) {
  const owner = output.ownerDocument || output;
  if (!documents.has(owner)) {
    documents.set(owner, {
      sample: makeCanvas(output), glyphSamples: makeCanvas(output), letterMasks: new Map(),
      knit: new Map(), customTiles: new Map(), glyphSignature: ""
    });
  }
  return documents.get(owner);
}

function setSize(canvas, width, height) {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

function grid(input, environment, pitch, aspect = 1, budget = 7600) {
  const {width, height, cache} = environment;
  // Bound the number of marks using logical dimensions so preview and export keep the same pattern.
  const step = Math.max(pitch, Math.sqrt(width * height / (budget * aspect)));
  const columns = Math.max(1, Math.round(width / step));
  const rows = Math.max(1, Math.round(height / (step * aspect)));
  const w = width / columns;
  const h = height / rows;
  const sample = cache.sample;
  setSize(sample, columns, rows);
  const read = sample.getContext("2d", {willReadFrequently: true});
  read.clearRect(0, 0, columns, rows);
  read.imageSmoothingEnabled = true;
  read.imageSmoothingQuality = "high";
  read.drawImage(input, 0, 0, columns, rows);
  const colors = read.getImageData(0, 0, columns, rows).data;
  const tones = new Float32Array(columns * rows);
  for (let index = 0; index < tones.length; index++) {
    const i = index * 4;
    tones[index] = (colors[i] * 0.2126 + colors[i + 1] * 0.7152 + colors[i + 2] * 0.0722) / 255;
  }
  const at = (x, y) => tones[clamp(y, 0, rows - 1) * columns + clamp(x, 0, columns - 1)];
  return {columns, rows, w, h, colors, tones, at};
}

function cells(field, draw) {
  const {columns, rows, w, h, colors, tones} = field;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      const offset = index * 4;
      draw(column * w, row * h, tones[index], colors[offset], colors[offset + 1], colors[offset + 2],
        column, row, colors[offset + 3] / 255);
    }
  }
}

function ground(environment, color) {
  const {ctx, width, height} = environment;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
}

function centerText(ctx, size, font = "ui-monospace, Menlo, monospace", weight = "700") {
  ctx.font = weight + " " + size + "px " + font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
}

function asciiGhost(input, environment) {
  const {ctx, size} = environment;
  const field = grid(input, environment, 8 + size * 2, 1.24);
  const {w, h, at} = field;
  ground(environment, "#191724");
  centerText(ctx, Math.min(w * .97, h * .82));
  cells(field, (x, y, tone, r, g, b, column, row) => {
    if (tone < .025) return;
    const letter = ascii[Math.min(ascii.length - 1, Math.floor(tone * ascii.length))];
    const displacedTone = at(column - 1, row);
    const ghost = ascii[Math.min(ascii.length - 1, Math.floor(displacedTone * ascii.length))];
    const ox = w * (.22 + tone * .13);
    const oy = h * .17;
    ctx.fillStyle = shade(tone, [37, 37, 57], [81, 99, 140]);
    ctx.fillText(ghost, x + w * .5 - ox, y + h * .5 + oy);
    ctx.fillStyle = shade(tone, [37, 24, 49], [170, 86, 135]);
    ctx.fillText(letter, x + w * .5 + ox * .70, y + h * .5 + oy * .65);
    ctx.fillStyle = rgb(83 + r * .65, 78 + g * .61, 97 + b * .60);
    ctx.fillText(letter, x + w * .5, y + h * .51);
  });
}

function tagPills(input, environment) {
  const {ctx, size, settings} = environment;
  const field = grid(input, environment, 19 + size * 3.15, .50, 5100);
  const {w, h} = field;
  const mode = settings.labelMode || "level";
  ground(environment, "#e7e6d9");
  centerText(ctx, Math.min(w * .16, h * .47));
  cells(field, (x, y, tone, r, g, b) => {
    const tablet = w * (.51 + tone * .40);
    const thick = h * .65;
    const left = x + (w - tablet) * .5;
    const top = y + (h - thick) * .5;
    ctx.fillStyle = rgb(23 + r * .86, 28 + g * .82, 26 + b * .80);
    ctx.beginPath();
    ctx.roundRect(left, top, tablet, thick, thick / 2);
    ctx.fill();
    if (mode === "none") return;
    ctx.fillStyle = tone < .52 ? "#f8f2e2" : "#232926";
    const category = r >= g && r >= b ? "R" : (g >= b ? "G" : "B");
    const label = mode === "channel" ? category : Math.round(tone * 99).toString().padStart(2, "0");
    ctx.fillText(label, x + w / 2, y + h * .515, tablet * .70);
  });
}

function dataHatching(input, environment) {
  const {ctx, size} = environment;
  const field = grid(input, environment, 13 + size * 2.3, 1, 5600);
  const {w, h} = field;
  ground(environment, "#f4eee0");
  ctx.lineCap = "round";
  const axis = new Path2D();
  for (let x = 0; x < field.columns; x++) {
    axis.moveTo(x * w, 0);
    axis.lineTo(x * w, environment.height);
  }
  for (let y = 0; y < field.rows; y++) {
    axis.moveTo(0, y * h);
    axis.lineTo(environment.width, y * h);
  }
  ctx.strokeStyle = "#d9d6ca";
  ctx.lineWidth = Math.max(.55, w * .019);
  ctx.stroke(axis);
  cells(field, (x, y, tone, r, g, b) => {
    const count = Math.ceil((1 - tone) * 6);
    if (!count) return;
    const tilt = r > b ? 1 : -1;
    const span = h * (.22 + (1 - tone) * .56);
    ctx.strokeStyle = r > b + 20 ? "#923847" : "#244658";
    ctx.lineWidth = Math.max(.7, w * (.036 + (1 - tone) * .035));
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const cx = x + w * (i + .7) / 7;
      ctx.moveTo(cx, y + h * .5 + span * tilt * .35);
      ctx.lineTo(cx + w * .20, y + h * .5 - span * tilt * .35);
    }
    ctx.stroke();
    ctx.fillStyle = "#bda982";
    ctx.fillRect(x + w * .78, y + h * .83, w * .13 * tone, Math.max(.55, h * .035));
  });
}

function letterMask(letter, cache) {
  if (cache.letterMasks.has(letter)) return cache.letterMasks.get(letter);
  if (cache.letterMasks.size > 170) cache.letterMasks.clear();
  const scratch = cache.glyphSamples;
  setSize(scratch, 8, 10);
  const ctx = scratch.getContext("2d", {willReadFrequently: true});
  ctx.clearRect(0, 0, 8, 10);
  centerText(ctx, 10);
  ctx.fillStyle = "#fff";
  ctx.fillText(letter, 4, 5, 7.5);
  const rgba = ctx.getImageData(0, 0, 8, 10).data;
  const alpha = new Uint8Array(80);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
  cache.letterMasks.set(letter, alpha);
  return alpha;
}

function ditherText(input, environment) {
  const {ctx, size, settings, cache} = environment;
  const field = grid(input, environment, 12 + size * 2.05, 1.25, 3700);
  const {columns, w, h} = field;
  const letters = normalizedText(settings.text, "TONEPRESS", 36);
  const masks = letters.map(letter => letterMask(letter, cache));
  const dot = w / 8, high = h / 10;
  ground(environment, "#ebe8dc");
  cells(field, (x, y, tone, r, g, b, column, row) => {
    const glyph = masks[(row * columns + column) % masks.length];
    ctx.fillStyle = shade(tone, [26, 31, 42], [84 + r * .24, 95 + g * .27, 110 + b * .29]);
    const density = .14 + .82 * (1 - tone);
    for (let pixelY = 0; pixelY < 10; pixelY++) {
      for (let pixelX = 0; pixelX < 8; pixelX++) {
        // Threshold lookup uses the whole grid; it does not restart at a text boundary.
        const rank = (bayer[((row * 10 + pixelY) & 3) * 4 + ((column * 8 + pixelX) & 3)] + .5) / 16;
        if (glyph[pixelY * 8 + pixelX] * density / 255 > rank) {
          ctx.fillRect(x + dot * pixelX, y + high * pixelY, dot * .89, high * .88);
        }
      }
    }
  });
}

function quantize(channel, levels) {
  return Math.round(channel * levels / 255) * 255 / levels;
}

function customTile(output, cache, signature, ink) {
  if (cache.glyphSignature !== signature) {
    cache.glyphSignature = signature;
    cache.customTiles.clear();
  }
  if (cache.customTiles.has(ink)) return cache.customTiles.get(ink);
  if (cache.customTiles.size > 400) cache.customTiles.clear();
  const tile = makeCanvas(output);
  setSize(tile, 8, 8);
  const ctx = tile.getContext("2d");
  ctx.fillStyle = ink;
  for (let i = 0; i < signature.length; i++) {
    if (signature[i] === "1") ctx.fillRect(i % 8, Math.floor(i / 8), 1, 1);
  }
  cache.customTiles.set(ink, tile);
  return tile;
}

function glyphStudio(input, environment) {
  const {ctx, size, settings, cache, output} = environment;
  const field = grid(input, environment, 13 + size * 2.4, 1, 6400);
  const {w, h} = field;
  const signature = typeof settings.glyph === "string" && /^[01]{64}$/.test(settings.glyph) ? settings.glyph : diamond;
  const monochrome = settings.inkMode === "mono";
  ground(environment, monochrome ? "#f5efdb" : "#161d25");
  ctx.imageSmoothingEnabled = false;
  cells(field, (x, y, tone, r, g, b) => {
    const ink = monochrome ? shade(quantize(tone * 255, 16) / 255, [37, 32, 28], [211, 195, 172])
      : rgb(20 + quantize(r, 6) * .91, 22 + quantize(g, 6) * .89, 22 + quantize(b, 6) * .91);
    const mark = .71 + tone * .21;
    ctx.drawImage(customTile(output, cache, signature, ink),
      x + w * (1 - mark) / 2, y + h * (1 - mark) / 2, w * mark, h * mark);
  });
}

function makeSymbols() {
  const circle = new Path2D();
  circle.arc(0, 0, .32, 0, Math.PI * 2);
  const diamond = new Path2D();
  diamond.moveTo(0, -.38);
  diamond.lineTo(.38, 0);
  diamond.lineTo(0, .38);
  diamond.lineTo(-.38, 0);
  diamond.closePath();
  const plus = new Path2D();
  plus.rect(-.29, -.07, .58, .14);
  plus.rect(-.07, -.29, .14, .58);
  const block = new Path2D();
  block.rect(-.33, -.33, .66, .66);
  const triangle = new Path2D();
  triangle.moveTo(0, -.35);
  triangle.lineTo(.37, .30);
  triangle.lineTo(-.37, .30);
  triangle.closePath();
  return [circle, plus, triangle, diamond, block];
}

let symbolPaths;
function gridGlyph(input, environment) {
  const {ctx, size} = environment;
  const field = grid(input, environment, 11 + size * 2.5, 1, 6900);
  const {w, h} = field;
  const paths = symbolPaths ||= makeSymbols();
  ground(environment, "#e7e2cb");
  cells(field, (x, y, tone, r, g, b) => {
    ctx.fillStyle = shade(tone, [213, 216, 191], [240, 231, 199]);
    ctx.fillRect(x + w * .03, y + h * .03, w * .94, h * .94);
    ctx.save();
    ctx.translate(x + w * .5, y + h * .5);
    const scale = .58 + .42 * (1 - tone);
    ctx.scale(w * scale, h * scale);
    ctx.fillStyle = rgb(29 + r * .52, 38 + g * .53, 29 + b * .58);
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = .076;
    const index = Math.min(paths.length - 1, Math.floor((1 - tone) * paths.length));
    if (tone > .56) ctx.stroke(paths[index]);
    else ctx.fill(paths[index]);
    ctx.restore();
  });
}

function inscribe(input, environment) {
  const {ctx, size, settings} = environment;
  const field = grid(input, environment, 9 + size * 1.45, 1.5, 6950);
  const {columns, w, h} = field;
  const letters = normalizedText(settings.text, "MEMORY PRESSED IN INK", 60);
  ground(environment, "#ddc7a2");
  ctx.strokeStyle = "#bfa780";
  ctx.lineWidth = Math.max(.55, h * .022);
  ctx.beginPath();
  for (let row = 0; row < field.rows; row++) {
    const y = h * (row + .88);
    ctx.moveTo(0, y);
    ctx.lineTo(environment.width, y);
  }
  ctx.stroke();
  centerText(ctx, Math.min(w * 1.22, h * .85), "Georgia, serif", "700");
  cells(field, (x, y, tone, r, g, b, column, row) => {
    const letter = letters[(column + row * (columns + 3)) % letters.length];
    ctx.fillStyle = shade(1 - tone, [218, 196, 164], [249, 227, 182]);
    ctx.fillText(letter, x + w * .52, y + h * .55);
    ctx.fillStyle = shade(tone, [48, 34, 24], [174, 142, 103]);
    ctx.fillText(letter, x + w * .48, y + h * .49);
  });
}

const rainLetters = "01ABCDEFGHIJKLMNOPQRSTUVXYZ※⁕";
const rainRates = {
  slow: {laps: 1, glyphSteps: 10},
  steady: {laps: 2, glyphSteps: 17},
  fast: {laps: 3, glyphSteps: 25}
};
function matrixRain(input, environment) {
  const {ctx, size, time, settings} = environment;
  const field = grid(input, environment, 8 + size * 1.8, 1.25);
  const {rows, w, h} = field;
  const speed = rainRates[settings.rainSpeed] || rainRates.steady;
  const phase = modulo(time, 4) / 4;
  ground(environment, "#071711");
  centerText(ctx, Math.min(w, h * .77));
  cells(field, (x, y, tone, r, g, b, column, row) => {
    // Each column travels a whole number of laps so its head and tail agree on both sides of the cut.
    const laps = speed.laps + (hash(column, 22) > .78 ? 1 : 0);
    const head = modulo(hash(column, 11) + phase * laps, 1) * rows;
    const distance = modulo(head - row, rows);
    const trail = Math.exp(-distance * .25);
    const edge = distance < 1.1;
    const gain = .055 + tone * .55 + trail * (.18 + .44 * tone);
    if (gain < .15 && hash(column, row) < .57) return;
    // Round each periodically changing glyph around its key so it stays stable through the loop seam.
    const keys = Math.round(speed.glyphSteps * (.68 + hash(column, row) * .62));
    const offset = .36 + hash(column + 37, row) * .28;
    const change = Math.floor(phase * keys + offset) % keys;
    const letter = rainLetters[Math.floor(hash(column + change * 3, row + change) * rainLetters.length)];
    ctx.fillStyle = edge ? shade(.57 + tone * .43, [53, 135, 79], [228, 255, 192])
      : shade(clamp(gain, 0, 1), [8, 29, 20], [139, 229, 98]);
    ctx.fillText(letter, x + w * .5, y + h * .52);
  });
}

function numberField(input, environment) {
  const {ctx, size, settings} = environment;
  const hex = settings.radix === "hex";
  const field = grid(input, environment, 16 + size * 2.5, .73, 6100);
  const {w, h} = field;
  ground(environment, "#1b2530");
  centerText(ctx, Math.min(w * .44, h * .69));
  cells(field, (x, y, tone, r, g, b) => {
    ctx.fillStyle = shade(tone, [19, 36, 50], [219, 165, 100]);
    ctx.fillRect(x + w * .036, y + h * .052, w * .928, h * .896);
    const label = Math.round(tone * (hex ? 255 : 99)).toString(hex ? 16 : 10).padStart(2, "0").toUpperCase();
    ctx.fillStyle = tone > .46 ? "#24212c" : "#f5c592";
    ctx.fillText(label, x + w * .5, y + h * .51);
  });
}

function pixelCode(input, environment) {
  const {ctx, size} = environment;
  const field = grid(input, environment, 12 + size * 2.2, .95, 5500);
  const {w, h} = field;
  const unitX = w / 5, unitY = h / 6;
  ground(environment, "#112333");
  cells(field, (x, y, tone, r, g, b, column, row) => {
    const code = (Math.round(r / 17) << 8) | (Math.round(g / 17) << 4) | Math.round(b / 17);
    ctx.fillStyle = shade(tone, [22, 48, 64], [95, 142, 143]);
    ctx.fillRect(x + unitX * .18, y + unitY * .23, unitX * 4.65, unitY * 5.53);
    ctx.fillStyle = "#142f3b";
    ctx.fillRect(x + unitX * .75, y + unitY * .88, unitX * 3.5, unitY * 4.17);
    ctx.fillStyle = rgb(78 + r * .61, 137 + g * .44, 113 + b * .51);
    ctx.fillRect(x + unitX, y + unitY, unitX * .81, unitY * .81);
    for (let i = 0; i < 12; i++) {
      if (code & (1 << i)) ctx.fillRect(x + unitX * (1 + (i % 3)), y + unitY * (1.8 + Math.floor(i / 3) * .73),
        unitX * .76, unitY * .63);
    }
    ctx.fillStyle = (column ^ row) & 1 ? "#e2af57" : "#92cad5";
    ctx.fillRect(x + unitX * 3.87, y + unitY * 4.71, unitX * .39, unitY * .35);
  });
}

function wordMosaic(input, environment) {
  const {ctx, size, settings} = environment;
  const defaults = "TONE PRESS PRINT IMAGE";
  const text = normalizedText(settings.text, defaults, 120).join("");
  const split = text.split(/[\s/|、]+/u).filter(Boolean);
  const words = split.length === 1 && Array.from(text).length > 11 ? text.match(/.{1,7}/gu) : split;
  const tokens = words?.length ? words : defaults.split(" ");
  const field = grid(input, environment, 25 + size * 3.6, .54, 4300);
  const {w, h} = field;
  ground(environment, "#25253a");
  centerText(ctx, Math.min(w * .23, h * .54), "Georgia, serif", "700");
  cells(field, (x, y, tone, r, g, b, column, row) => {
    const word = tokens[(column + row * 3) % tokens.length];
    const relative = .70 + .25 * Math.min(1, Array.from(word).length / 7);
    const inset = (1 - relative) * w / 2;
    ctx.fillStyle = rgb(17 + r * .88, 15 + g * .86, 24 + b * .82);
    ctx.fillRect(x + inset, y + h * .07, w * relative, h * .86);
    ctx.fillStyle = tone < .52 ? "#fff2d5" : "#202032";
    ctx.fillText(word, x + w * .5, y + h * .52, w * relative * .90);
  });
}

function knitTile(output, cache, r, g, b) {
  r = quantize(r, 5);
  g = quantize(g, 5);
  b = quantize(b, 5);
  const ink = rgb(r, g, b);
  if (cache.knit.has(ink)) return cache.knit.get(ink);

  const tile = makeCanvas(output);
  setSize(tile, 30, 34);
  const ctx = tile.getContext("2d");
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.fillStyle = rgb(16 + r * .28, 13 + g * .29, 15 + b * .27);
  ctx.fillRect(0, 0, tile.width, tile.height);

  function yarn(x, direction, color, width) {
    ctx.beginPath();
    ctx.moveTo(x, 2);
    ctx.bezierCurveTo(x + direction * 1, 8,
      x + direction * 12, 18, x + direction * 10, 29);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  yarn(5, 1, rgb(r * .55, g * .54, b * .53), 9);
  yarn(25, -1, rgb(r * .55, g * .53, b * .53), 9);
  yarn(4, 1, rgb(24 + r * .90, 21 + g * .88, 20 + b * .86), 6.6);
  yarn(24, -1, rgb(20 + r * .79, 16 + g * .80, 17 + b * .81), 6.6);
  yarn(2, 1, rgb(58 + r * .72, 52 + g * .70, 48 + b * .72), 1.2);
  yarn(23, -1, rgb(50 + r * .67, 41 + g * .67, 44 + b * .68), 1.0);
  cache.knit.set(ink, tile);
  return tile;
}

function knittedEmbroidery(input, environment) {
  const {ctx, size, output, cache} = environment;
  const field = grid(input, environment, 5 + size * 1.66, 1.23, 9700);
  const {w, h} = field;
  ground(environment, "#2a2630");
  ctx.imageSmoothingEnabled = true;
  cells(field, (x, y, tone, r, g, b) => {
    ctx.drawImage(knitTile(output, cache, r, g, b), x, y, w + .28, h + .28);
  });
}

const carpetPalettes = {
  earth: [
    [38, 45, 53], [71, 84, 105], [115, 106, 71], [159, 58, 53],
    [219, 119, 66], [202, 162, 101], [235, 209, 154], [242, 223, 188]
  ],
  lake: [
    [31, 55, 58], [57, 80, 88], [70, 114, 131], [88, 133, 127],
    [123, 82, 65], [174, 126, 82], [207, 179, 125], [231, 222, 186]
  ]
};

function findYarn(r, g, b, tone, palette) {
  let best;
  let distance = Infinity;
  for (const candidate of palette) {
    const luma = (candidate[0] * .2126 + candidate[1] * .7152 + candidate[2] * .0722) / 255;
    const dr = candidate[0] - r, dg = candidate[1] - g, db = candidate[2] - b;
    const error = dr * dr * .22 + dg * dg * .56 + db * db * .22 + (luma - tone) ** 2 * 20000;
    if (error < distance) {distance = error; best = candidate;}
  }
  return best;
}

function kilimCarpet(input, environment) {
  const {ctx, size, settings} = environment;
  const field = grid(input, environment, 11 + size * 2.2, .91, 7700);
  const {w, h} = field;
  const palette = carpetPalettes[settings.weavePalette] || carpetPalettes.earth;
  ground(environment, rgb(...palette[0]));
  cells(field, (x, y, tone, r, g, b, column, row) => {
    const yarn = findYarn(r, g, b, tone, palette);
    ctx.fillStyle = shade(.82, palette[0], yarn);
    ctx.fillRect(x, y, w + .3, h + .3);
    ctx.fillStyle = rgb(...yarn);
    const bias = (row + column) % 2 ? .02 : 0;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y + h * bias);
    ctx.lineTo(x + w * .97, y + h * .5);
    ctx.lineTo(x + w / 2, y + h * (1 - bias));
    ctx.lineTo(x + w * .03, y + h * .5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = tone > .53 ? "#f9e2b44a" : "#efe5c44c";
    ctx.lineWidth = Math.max(.55, h * .045);
    ctx.beginPath();
    for (let index = 1; index < 5; index++) {
      const fraction = index / 5;
      const inset = Math.abs(fraction - .5);
      ctx.moveTo(x + w * inset, y + h * fraction);
      ctx.lineTo(x + w * (1 - inset), y + h * fraction);
    }
    ctx.stroke();
  });
  ctx.strokeStyle = "#231c231f";
  ctx.lineWidth = Math.max(.55, w * .035);
  ctx.beginPath();
  for (let column = 0; column < field.columns; column++) {
    const x = (column + .5) * w;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, environment.height);
  }
  ctx.stroke();
}

function stitchPoster(input, environment) {
  const {ctx, size} = environment;
  const field = grid(input, environment, 12 + size * 2.3, 1, 6700);
  const {w, h, at} = field;
  ground(environment, "#e5d9be");
  cells(field, (x, y, tone, r, g, b) => {
    ctx.fillStyle = rgb(16 + quantize(r, 6) * .88, 13 + quantize(g, 6) * .88, 16 + quantize(b, 6) * .83);
    ctx.fillRect(x, y, w + .25, h + .25);
  });

  const boundaries = new Path2D();
  const fibers = new Path2D();
  cells(field, (x, y, tone, r, g, b, column, row) => {
    const contrast = .062 + size * .004;
    if (column > 0 && Math.abs(at(column - 1, row) - tone) > contrast) {
      boundaries.moveTo(x, y - .05);
      boundaries.lineTo(x, y + h + .05);
    }
    if (row > 0 && Math.abs(at(column, row - 1) - tone) > contrast) {
      boundaries.moveTo(x - .05, y);
      boundaries.lineTo(x + w + .05, y);
    }
    if ((column + row) % 2 === 0) {
      fibers.moveTo(x + w * .21, y + h * .68);
      fibers.lineTo(x + w * .34, y + h * .47);
      fibers.moveTo(x + w * .47, y + h * .68);
      fibers.lineTo(x + w * .60, y + h * .47);
    }
  });
  ctx.strokeStyle = "#efe4bd47";
  ctx.lineWidth = Math.max(.55, w * .024);
  ctx.stroke(fibers);

  ctx.lineCap = "round";
  ctx.strokeStyle = "#322321bc";
  ctx.lineWidth = Math.max(.95, w * .10);
  ctx.setLineDash([w * .19, w * .115]);
  ctx.stroke(boundaries);
  ctx.strokeStyle = "#f6e4c5";
  ctx.lineDashOffset = w * .018;
  ctx.lineWidth = Math.max(.65, w * .059);
  ctx.stroke(boundaries);
  ctx.setLineDash([]);
}

function vectorEngraving(input, environment) {
  const {ctx, size} = environment;
  const field = grid(input, environment, 5.1 + size * .88, .59, 22500);
  const {w, h, at} = field;
  ground(environment, "#efe6cf");
  const plates = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
  const cross = new Path2D();
  ctx.lineCap = "round";
  cells(field, (x, y, tone, r, g, b, column, row) => {
    if (tone > .96) return;
    const ink = clamp(Math.floor((1 - tone) * 4), 0, 3);
    const curve = (at(column - 1, row + 1) - at(column + 1, row - 1)) * h;
    const wave = Math.sin(x * .019 + y * .023) * h * .29;
    const baseline = y + h * .5 + wave;
    const segment = plates[ink];
    const left = x + w * (ink === 0 ? .17 : .02), right = x + w * (ink === 0 ? .80 : 1.02);
    segment.moveTo(left, baseline - curve * .42);
    segment.quadraticCurveTo(x + w * .5, baseline + curve * .56, right, baseline + curve * .42);
    if (ink === 3 || ink === 2 && (column + row) % 2 === 0) {
      cross.moveTo(x + w * .20, y + h * .97);
      cross.quadraticCurveTo(x + w * .46, y + h * .45, x + w * .78, y + h * .04);
    }
  });
  const weights = [.091, .13, .22, .36];
  const ink = ["#694f3688", "#624834b0", "#584332cf", "#422e23"];
  for (let i = 0; i < plates.length; i++) {
    ctx.strokeStyle = ink[i];
    ctx.lineWidth = Math.max(.34, h * weights[i]);
    ctx.stroke(plates[i]);
  }
  ctx.strokeStyle = "#543b2fbd";
  ctx.lineWidth = Math.max(.45, h * .15);
  ctx.stroke(cross);
}

function contourType(input, environment) {
  const {ctx, size, settings} = environment;
  const field = grid(input, environment, 8 + size * 1.9, 1.13, 8400);
  const {w, h, at} = field;
  const punctuation = normalizedText(settings.text, ".:/+*", 16);
  const light = [.13, .18, .26];
  ground(environment, "#ede8d5");
  centerText(ctx, Math.min(w * 1.13, h * .89));
  cells(field, (x, y, tone, r, g, b, column, row) => {
    const gx = (at(column + 1, row - 1) + at(column + 1, row) * 2 + at(column + 1, row + 1)
      - at(column - 1, row - 1) - at(column - 1, row) * 2 - at(column - 1, row + 1)) * .25;
    const gy = (at(column - 1, row + 1) + at(column, row + 1) * 2 + at(column + 1, row + 1)
      - at(column - 1, row - 1) - at(column, row - 1) * 2 - at(column + 1, row - 1)) * .25;
    const edge = clamp(Math.hypot(gx, gy) * 3.9, 0, 1);
    if (edge < .085 && hash(column, row) > .59 - tone * .50) return;
    const intensity = clamp(.56 * edge + .44 * (1 - tone), 0, .999);
    const letter = punctuation[Math.floor(intensity * punctuation.length)];
    const angle = modulo(Math.atan2(gy, gx) + Math.PI, Math.PI) - Math.PI / 2;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(angle);
    ctx.fillStyle = rgb(108 + light[0] * r - edge * 81, 114 + light[1] * g - edge * 70,
      110 + light[2] * b - edge * 63);
    ctx.fillText(letter, 0, 0);
    ctx.restore();
  });
}

const methods = {
  "ascii-ghost": asciiGhost,
  "tag-pills": tagPills,
  "data-hatching": dataHatching,
  "dither-text": ditherText,
  "glyph-studio": glyphStudio,
  "grid-glyph": gridGlyph,
  inscribe,
  "matrix-rain": matrixRain,
  "number-field": numberField,
  "pixel-code": pixelCode,
  "word-mosaic": wordMosaic,
  "knitted-embroidery": knittedEmbroidery,
  "kilim-carpet": kilimCarpet,
  "stitch-poster": stitchPoster,
  "vector-engraving": vectorEngraving,
  "contour-type": contourType
};

function draw(input, output, settings) {
  if (!Object.hasOwn(methods, settings.type)) return false;
  const width = Math.max(1, settings.sourceWidth || input.width);
  const height = Math.max(1, settings.sourceHeight || input.height);
  const ctx = output.getContext("2d");
  const size = clamp(Number(settings.size) || definitions[settings.type].size, 2, 16);
  const time = Number.isFinite(settings.time) ? settings.time : 0;
  ctx.save();
  try {
    ctx.setTransform(output.width / width, 0, 0, output.height / height, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    methods[settings.type](input, {ctx, width, height, cache: cacheFor(output), output, size, settings, time});
  } finally {
    ctx.restore();
  }
  return true;
}
export { definitions, draw };
