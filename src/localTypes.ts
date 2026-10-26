/** Local operations use output-canvas coordinates. Positions, radii and deltas
 * are normalised by each canvas dimension; angle uses physical image pixels. */
export interface LocalEdit {
  id: string;
  kind: 'scale' | 'push';
  cx: number; cy: number; rx: number; ry: number; angle: number;
  scaleX: number; scaleY: number; dx: number; dy: number; softness: number;
}
export const MAX_LOCAL_EDITS = 64;
export const LOCAL_SCALE_MIN = 0.5;
export const LOCAL_SCALE_MAX = 2;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const value = (n: unknown, fallback: number) => typeof n === 'number' && Number.isFinite(n) ? n : fallback;

/** For live controls: sanitise input without retaining arbitrary fields. */
export function normalizeLocalEdit(edit: Partial<LocalEdit>): LocalEdit {
  return {
    id: typeof edit.id === 'string' && edit.id.length ? edit.id.slice(0, 100) : 'local',
    kind: edit.kind === 'push' ? 'push' : 'scale',
    cx: clamp(value(edit.cx, 0.5), 0, 1), cy: clamp(value(edit.cy, 0.5), 0, 1),
    rx: clamp(value(edit.rx, 0.15), 0.005, 1), ry: clamp(value(edit.ry, 0.15), 0.005, 1),
    angle: ((value(edit.angle, 0) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
    scaleX: clamp(value(edit.scaleX, 1), LOCAL_SCALE_MIN, LOCAL_SCALE_MAX),
    scaleY: clamp(value(edit.scaleY, 1), LOCAL_SCALE_MIN, LOCAL_SCALE_MAX),
    dx: clamp(value(edit.dx, 0), -1, 1), dy: clamp(value(edit.dy, 0), -1, 1),
    softness: clamp(value(edit.softness, 0.65), 0, 1),
  };
}

/** A push starts at cx/cy and ends at cx+dx/cy+dy. Bound its displacement
 * in rotated ellipse space so the compact inverse map cannot fold. */
export function constrainLocalPush(edit: LocalEdit, width: number, height: number): LocalEdit {
  const e = normalizeLocalEdit(edit);
  if (e.kind !== 'push') return e;
  const w = Math.max(1, width - 1), h = Math.max(1, height - 1);
  const cosine = Math.cos(e.angle), sine = Math.sin(e.angle);
  const dx = e.dx * w, dy = e.dy * h;
  const du = (cosine * dx + sine * dy) / (e.rx * w), dv = (-sine * dx + cosine * dy) / (e.ry * h);
  const length = Math.hypot(du, dv), factor = length > 0.4 ? 0.4 / length : 1;
  return { ...e, dx: e.dx * factor, dy: e.dy * factor };
}

/** Saved projects fail visibly instead of silently changing out-of-range edits. */
export function parseLocalEdits(input: unknown): LocalEdit[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > MAX_LOCAL_EDITS) throw new Error('局部塑形记录无效或超过 64 步。');
  const ids = new Set<string>();
  return input.map((candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('局部塑形参数不完整。');
    const edit = candidate as Record<string, unknown>;
    if (typeof edit.id !== 'string' || !edit.id.length || edit.id.length > 100 || ids.has(edit.id)
      || !['scale', 'push'].includes(String(edit.kind))) throw new Error('局部塑形编号或类型无效。');
    ids.add(edit.id);
    for (const key of ['cx', 'cy', 'rx', 'ry', 'angle', 'scaleX', 'scaleY', 'dx', 'dy', 'softness']) {
      if (typeof edit[key] !== 'number' || !Number.isFinite(edit[key])) throw new Error('局部塑形参数必须是有限数字。');
    }
    const e = edit as unknown as LocalEdit;
    if (e.cx < 0 || e.cx > 1 || e.cy < 0 || e.cy > 1 || e.rx < 0.005 || e.rx > 1 || e.ry < 0.005 || e.ry > 1
      || Math.abs(e.angle) > Math.PI * 100 || e.scaleX < LOCAL_SCALE_MIN || e.scaleX > LOCAL_SCALE_MAX
      || e.scaleY < LOCAL_SCALE_MIN || e.scaleY > LOCAL_SCALE_MAX || Math.abs(e.dx) > 1 || Math.abs(e.dy) > 1
      || e.softness < 0 || e.softness > 1) throw new Error('局部塑形参数超出可用范围。');
    return normalizeLocalEdit(e);
  });
}
