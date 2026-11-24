import type { PixelImage } from './types';

import { MAX_OUTPUT_PIXELS, type PixelSize } from './exportSize';
export { MAX_OUTPUT_PIXELS } from './exportSize';
export const MAX_PROJECT_BYTES = 75 * 1024 * 1024;
const MAX_WORKING_PIXELS = 12_000_000;
const MAX_WORKING_EDGE = 8192;
const MAX_IMPORT_BYTES = 256 * 1024 * 1024;
const MAX_EMBEDDED_IMAGE_BYTES = 50 * 1024 * 1024;

/** Preserve the aspect ratio until the minimum 32px edge makes that impossible. */
export function defaultOutputSize(width: number, height: number) {
  const scale = Math.min(1, 8192 / width, 8192 / height, Math.sqrt(MAX_OUTPUT_PIXELS / (width * height)));
  return { width: Math.max(32, Math.floor(width * scale)), height: Math.max(32, Math.floor(height * scale)) };
}

export function isImageDataURL(value: string): boolean {
  return /^data:image\/(?:jpeg|png|webp|gif|avif|bmp);base64,[a-z0-9+/]+={0,2}$/i.test(value);
}

export function workingImageSize(original: PixelSize): PixelSize {
  const scale = Math.min(1, MAX_WORKING_EDGE / Math.max(original.width, original.height),
    Math.sqrt(MAX_WORKING_PIXELS / (original.width * original.height)));
  return {
    width: Math.max(1, Math.floor(original.width * scale)),
    height: Math.max(1, Math.floor(original.height * scale)),
  };
}

function openImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('浏览器无法读取这张图片。请尝试 JPG、PNG 或 WebP 格式，或缩小源图片。'));
    image.src = url;
  });
}

function canvasToPNG(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob?.size
      ? resolve(blob)
      : reject(new Error('浏览器内存不足，PNG 未生成。请选择较小的像素尺寸重试。')), 'image/png');
  });
}

/** Large files are opened from a temporary URL. Only the bounded working copy is
 * read to RGBA and embedded in a new project; existing project pixels stay exact. */
export async function loadImageSource(input: string | File, options: {legacyProject?: boolean} = {}) {
  const file = typeof input === 'string' ? undefined : input;
  if (file && file.size > MAX_IMPORT_BYTES) throw new Error('单个图片文件最多 256 MiB，请先压缩文件后打开。');
  const url = typeof input === 'string' ? input : URL.createObjectURL(input);
  const canvas = document.createElement('canvas');
  let element: HTMLImageElement | undefined;
  let bitmap: ImageBitmap | undefined;
  try {
    element = await openImage(url);
    const originalWidth = element.naturalWidth;
    const originalHeight = element.naturalHeight;
    if (!originalWidth || !originalHeight) throw new Error('这张图片没有可读取的像素尺寸。');
    const original = {width: originalWidth, height: originalHeight};
    const retainLegacyPixels = options.legacyProject && originalWidth * originalHeight <= 40_000_000;
    const size = retainLegacyPixels ? original : workingImageSize(original);
    const adapted = size.width !== originalWidth || size.height !== originalHeight;
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    if (!context) throw new Error('无法创建工作画布，请缩小源图片后重试。');
    // Supply a resize hint to the browser's decoder where available. The canvas
    // fallback is also sized before drawing, so it never allocates a full-size raster.
    if (adapted && file && typeof createImageBitmap === 'function') {
      try { bitmap = await createImageBitmap(file, {resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high'}); }
      catch { /* Browsers differ in bitmap decoder/format support. */ }
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap ?? element, 0, 0, size.width, size.height);
    bitmap?.close();
    bitmap = undefined;
    const image: PixelImage = {...size, data: context.getImageData(0, 0, size.width, size.height).data};
    let persistentURL: string;
    if (!adapted && typeof input === 'string' && isImageDataURL(input)) persistentURL = input;
    else if (!adapted && file && file.size <= MAX_EMBEDDED_IMAGE_BYTES &&
      /^image\/(jpeg|png|webp|gif|avif|bmp)$/i.test(file.type)) persistentURL = await readDataURL(file);
    else persistentURL = await readDataURL(await canvasToPNG(canvas));
    if (!isImageDataURL(persistentURL)) throw new Error('无法保存工作图片，请换用 JPG、PNG 或 WebP。');
    return {image, url: persistentURL, originalWidth, originalHeight, adapted};
  } finally {
    bitmap?.close();
    canvas.width = canvas.height = 0;
    element?.removeAttribute('src');
    if (file) URL.revokeObjectURL(url);
  }
}

export function readDataURL(file: Blob): Promise<string> {
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
  const pixels = image.data.buffer instanceof ArrayBuffer
    ? new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.length)
    : new Uint8ClampedArray(image.data);
  context.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
  return canvas;
}

export async function imageToPNGBlob(image: PixelImage): Promise<Blob> {
  const canvas = imageToCanvas(image);
  try { return await canvasToPNG(canvas); }
  finally { canvas.width = canvas.height = 0; }
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
