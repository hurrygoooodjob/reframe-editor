/** File dimensions are independent of the editor's logical canvas. */
export interface PixelSize {
  width: number;
  height: number;
}

export const MAX_EXPORT_EDGE = 8192;
export const MAX_OUTPUT_PIXELS = 24_000_000;

export function validateExportSize(size: PixelSize): string | null {
  if (!Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height) ||
      size.width < 1 || size.height < 1) {
    return '请输入大于零的整数宽度和高度。';
  }
  if (Math.max(size.width, size.height) > MAX_EXPORT_EDGE) {
    return '输出过大，单边最多为 8192 像素，请缩小导出尺寸。';
  }
  if (size.width * size.height > MAX_OUTPUT_PIXELS) {
    return '输出过大，最多可导出 2400 万像素，请缩小导出宽高。';
  }
  return null;
}

export function fitLongEdge(canvas: PixelSize, edge: number): PixelSize {
  const scale = edge / Math.max(canvas.width, canvas.height);
  return {
    width: Math.max(1, Math.round(canvas.width * scale)),
    height: Math.max(1, Math.round(canvas.height * scale)),
  };
}

/** At initial export keep small images at their resolution and fit large ones to 2048px. */
export function recommendedExportSize(canvas: PixelSize): PixelSize {
  return fitLongEdge(canvas, Math.min(2048, Math.max(canvas.width, canvas.height)));
}
