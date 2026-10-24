import type { PixelImage } from './types';

export const MAX_OUTPUT_PIXELS = 24_000_000;
export const MAX_PROJECT_BYTES = 75 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 40_000_000;

/** Preserve the aspect ratio until the minimum 32px edge makes that impossible. */
export function defaultOutputSize(width: number, height: number) {
  const scale = Math.min(1, 8192 / width, 8192 / height, Math.sqrt(MAX_OUTPUT_PIXELS / (width * height)));
  return { width: Math.max(32, Math.floor(width * scale)), height: Math.max(32, Math.floor(height * scale)) };
}

export function isImageDataURL(value: string): boolean {
  return /^data:image\/(?:jpeg|png|webp|gif|avif|bmp);base64,[a-z0-9+/]+={0,2}$/i.test(value);
}

export async function decodeImage(url: string): Promise<PixelImage> {
  const image = new Image();
  image.src = url;
  try { await image.decode(); }
  catch { throw new Error('图片无法解码，请使用浏览器支持的 JPG、PNG、WebP、AVIF 或 GIF 图片。'); }
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > MAX_SOURCE_PIXELS) {
    throw new Error('图片过大，请使用 4000 万像素以内的图片。');
  }
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建图片画布，请缩小图片后重试。');
  try {
    ctx.drawImage(image, 0, 0);
    return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
  } catch { throw new Error('无法读取图片像素，请使用本地图片，或缩小图片后重试。'); }
}

export function readDataURL(file: File): Promise<string> {
  if (file.size > 50 * 1024 * 1024) return Promise.reject(new Error('文件过大，请选择小于 50 MB 的图片。'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('未能读取文件，请再试一次。'));
    reader.onabort = () => reject(new DOMException('已取消读取', 'AbortError'));
    reader.readAsDataURL(file);
  });
}

export function imageToCanvas(image: PixelImage): HTMLCanvasElement {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.data.length !== image.width * image.height * 4) {
    throw new Error('图片像素数据不完整。');
  }
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建导出画布，请调小输出尺寸。');
  context.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return canvas;
}

export function encodeMask(mask: Float32Array): string {
  const bytes = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) bytes[i] = Math.round((Math.max(-1, Math.min(1, Number.isFinite(mask[i]) ? mask[i] : 0)) + 1) * 127);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export function decodeMask(value: string, length: number): Float32Array {
  if (!Number.isInteger(length) || length < 1 || length > 1_048_576 || value.length !== Math.ceil(length / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('工程选区数据不完整。');
  }
  let binary: string;
  try { binary = atob(value); } catch { throw new Error('工程选区编码无效。'); }
  if (binary.length !== length) throw new Error('工程选区数据不完整。');
  const mask = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const code = binary.charCodeAt(i);
    if (code > 254) throw new Error('工程选区数值超出范围。');
    mask[i] = (code - 127) / 127;
  }
  return mask;
}

export function cleanFilename(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 100).trim() || 'image';
}

export function downloadFile(url: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
}
