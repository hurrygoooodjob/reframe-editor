export interface Point { x: number; y: number }
export type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export const RESIZE_HANDLES: { id: ResizeHandle; label: string }[] = [
  { id: 'nw', label: '从左上角调整宽高' }, { id: 'n', label: '从顶部调整高度' },
  { id: 'ne', label: '从右上角调整宽高' }, { id: 'e', label: '从右侧调整宽度' },
  { id: 'se', label: '从右下角调整宽高' }, { id: 's', label: '从底部调整高度' },
  { id: 'sw', label: '从左下角调整宽高' }, { id: 'w', label: '从左侧调整宽度' },
];

/** The opposite edge/corner stays still; a locked side handle fixes its opposite midpoint. */
export function resizeGeometry(width: number, height: number, handle: ResizeHandle, delta: Point, scale: number, locked: boolean) {
  const sx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const sy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  const safeScale = Math.max(.0001, scale);
  let w = width + sx * delta.x / safeScale, h = height + sy * delta.y / safeScale;
  if (locked) {
    const factor = sx === 0 ? h / height : sy === 0 ? w / width
      : Math.abs(w / width - 1) >= Math.abs(h / height - 1) ? w / width : h / height;
    const bounded = Math.max(Math.max(32 / width, 32 / height), Math.min(Math.min(8192 / width, 8192 / height), factor));
    w = width * bounded; h = height * bounded;
  }
  w = Math.round(Math.max(32, Math.min(8192, w)));
  h = Math.round(Math.max(32, Math.min(8192, h)));
  return { width: w, height: h, shift: { x: sx * (w - width) * safeScale / 2, y: sy * (h - height) * safeScale / 2 } };
}

export function brushFalloff(distance: number, hardness: number): number {
  if (!Number.isFinite(distance) || distance >= 1) return 0;
  const core = Math.min(1, Math.max(0, Number.isFinite(hardness) ? hardness : .5));
  if (distance <= core || core === 1) return 1;
  const t = (distance - core) / (1 - core);
  return 1 - t * t * (3 - 2 * t);
}

/** Max coverage over one stroke keeps the edge soft regardless of pointer sample density. */
export function stampSoftBrush(data: Float32Array, base: Float32Array, coverage: Float32Array,
  width: number, height: number, center: Point, radius: Point, hardness: number,
  mode: 'protect' | 'compress' | 'erase') {
  const rx = Math.max(.01, radius.x), ry = Math.max(.01, radius.y);
  const target = mode === 'protect' ? 1 : mode === 'compress' ? -1 : 0;
  for (let y = Math.max(0, Math.floor(center.y - ry)); y < Math.min(height, Math.ceil(center.y + ry)); y++) {
    for (let x = Math.max(0, Math.floor(center.x - rx)); x < Math.min(width, Math.ceil(center.x + rx)); x++) {
      const alpha = brushFalloff(Math.hypot((x + .5 - center.x) / rx, (y + .5 - center.y) / ry), hardness);
      const i = y * width + x;
      if (alpha <= coverage[i]) continue;
      coverage[i] = alpha;
      data[i] = base[i] + (target - base[i]) * alpha;
    }
  }
}
