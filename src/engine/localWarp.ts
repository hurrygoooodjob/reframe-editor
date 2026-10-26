import { MAX_LOCAL_EDITS, constrainLocalPush, type LocalEdit } from '../localTypes';
export interface WarpPoint { x: number; y: number; }
interface PreparedEdit {
  kind: LocalEdit['kind']; cx: number; cy: number; rx: number; ry: number;
  cosine: number; sine: number; ax: number; ay: number; du: number; dv: number; power: number;
  boundX: number; boundY: number;
}

/** Compact-support inverse deformation. A scale s changes the centre derivative
 * to 1/s, while the outer ellipse has exactly zero displacement and derivative.
 * For s in [0.5, 2] and falloff power in [2, 4], the inverse Jacobian stays positive.
 * Push displacement is capped in ellipse space to preserve the same property. */
export function createLocalMapper(edits: readonly LocalEdit[] | undefined, width: number, height: number) {
  const w = Math.max(1, width - 1), h = Math.max(1, height - 1);
  const prepared: PreparedEdit[] = [];
  for (const candidate of (edits || []).slice(0, MAX_LOCAL_EDITS)) {
    const e = constrainLocalPush(candidate, width, height), cosine = Math.cos(e.angle), sine = Math.sin(e.angle);
    const rx = Math.max(0.01, e.rx * w), ry = Math.max(0.01, e.ry * h);
    const dx = e.dx * w, dy = e.dy * h;
    const du = (cosine * dx + sine * dy) / rx, dv = (-sine * dx + cosine * dy) / ry;
    // max norm of gradient((1-r²)^p) < 1.91 for p in [2,4]. This bound
    // keeps det(I - delta ⊗ gradient) positive for every supported softness.
    if (e.kind === 'scale' ? e.scaleX === 1 && e.scaleY === 1 : du === 0 && dv === 0) continue;
    // At the drag destination this inverse samples the original drag origin,
    // so an actual feature follows the pointer rather than lagging behind it.
    prepared.push({ kind: e.kind, cx: e.cx * w + (e.kind === 'push' ? dx : 0), cy: e.cy * h + (e.kind === 'push' ? dy : 0), rx, ry, cosine, sine,
      ax: 1 / e.scaleX - 1, ay: 1 / e.scaleY - 1, du, dv, power: 2 + 2 * e.softness,
      boundX: Math.hypot(rx * cosine, ry * sine), boundY: Math.hypot(rx * sine, ry * cosine) });
  }
  return {
    active: prepared.length > 0,
    /** Current output -> pre-local output, both normalised. Reuse out per pixel. */
    map(x: number, y: number, out: WarpPoint = { x: 0, y: 0 }): WarpPoint {
      let px = x * w, py = y * h;
      for (let i = prepared.length - 1; i >= 0; i--) {
        const e = prepared[i], ox = px - e.cx, oy = py - e.cy;
        if (Math.abs(ox) >= e.boundX || Math.abs(oy) >= e.boundY) continue;
        const u = (e.cosine * ox + e.sine * oy) / e.rx;
        const v = (-e.sine * ox + e.cosine * oy) / e.ry;
        const radius2 = u * u + v * v;
        if (radius2 >= 1) continue;
        const weight = (1 - radius2) ** e.power;
        const nu = e.kind === 'scale' ? u * (1 + e.ax * weight) : u - e.du * weight;
        const nv = e.kind === 'scale' ? v * (1 + e.ay * weight) : v - e.dv * weight;
        px = e.cx + e.cosine * nu * e.rx - e.sine * nv * e.ry;
        py = e.cy + e.sine * nu * e.rx + e.cosine * nv * e.ry;
      }
      out.x = px / w; out.y = py / h;
      return out;
    },
  };
}
