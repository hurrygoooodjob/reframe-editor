import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { EditSettings, RenderResult, Tool } from '../types';
import type { SourceImage } from '../hooks/useEditor';
import Icon from './Icon';
import { RESIZE_HANDLES, resizeGeometry, stampSoftBrush } from './canvasGeometry';
import type { Point, ResizeHandle } from './canvasGeometry';
import './canvas-improvements.css';

export interface LocalCanvasTarget { id: string; label: string; cx: number; cy: number; rx: number; ry: number; angle: number }
interface Props {
  source: SourceImage; settings: EditSettings; result: RenderResult | null; tool: Tool;
  mask: Float32Array; maskSize: { width: number; height: number }; brushSize: number; brushHardness?: number; showMask: boolean;
  compare: boolean; locked: boolean; geometryLocked?: boolean; busy: boolean; progress: { value: number; label: string };
  onChange: (patch: Partial<EditSettings>, commit?: boolean) => void;
  onMask: (mask: Float32Array) => void; onDone: () => void; onInteractionStart: () => void;
  localMode?: 'scale' | 'push'; localRadius?: number; localSoftness?: number;
  localTargets?: LocalCanvasTarget[]; selectedLocalTarget?: string | null;
  onLocalTarget?: (id: string) => void;
  onLocalPoint?: (point: Point, radius: Point) => void;
  onLocalPush?: (from: Point, to: Point, radius: Point) => void;
  localFocus?: { cx: number; cy: number; rx: number; ry: number; angle: number } | null;
}
type Context = { pointerId: number; source: SourceImage; mask: Float32Array; tool: Tool; compare: boolean; settings: EditSettings };
type Gesture = Context & (
  { kind: 'paint'; data: Float32Array; base: Float32Array; coverage: Float32Array; start: Point; last: Point }
  | { kind: 'resize'; start: Point; width: number; height: number; scale: number; handle: ResizeHandle; locked: boolean; origin: Point; last: { width: number; height: number }; shift: Point }
  | { kind: 'pan'; start: Point; origin: Point }
  | { kind: 'local'; start: Point; last: Point; radius: Point; mode: 'scale' | 'push' }
);
type View = { scale: number | null; pan: Point };
type Pinch = { distance: number; midpoint: Point; scale: number; pan: Point; anchor: Point };
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const isPainting = (tool: Tool) => ['protect', 'compress', 'erase', 'rectangle'].includes(tool);

export default function CanvasEditor(p: Props) {
  const stage = useRef<HTMLDivElement>(null), wrap = useRef<HTMLDivElement>(null);
  const pixels = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<Gesture | null>(null), pinch = useRef<Pinch | null>(null);
  const pointers = useRef(new Map<number, Point>()), holdingSpace = useRef(false);
  const resizeRestore = useRef<{ width: number; height: number; center: Point; scale: number } | null>(null);
  const latest = useRef(p); latest.current = p;
  const [space, setSpace] = useState({ width: 900, height: 650 });
  const [view, setView] = useState<View>({ scale: null, pan: { x: 0, y: 0 } });
  const rawViewRef = useRef(view); rawViewRef.current = view;
  const [resizeOffset, setResizeOffset] = useState<Point>({ x: 0, y: 0 });
  const [pushPreview, setPushPreview] = useState<{ from: Point; to: Point; radius: Point } | null>(null);
  const painting = isPainting(p.tool) && !p.compare;
  const local = p.tool === 'local' && !p.compare;
  const original = painting || p.compare;
  const width = original ? p.source.image.width : p.settings.width;
  const height = original ? p.source.image.height : p.settings.height;
  const compact = space.width <= 760 || space.height <= 380;
  const insetX = compact ? 64 : 130, insetY = compact ? 86 : 120;
  const fit = Math.max(.001, Math.min(Math.max(1, space.width - insetX) / width, Math.max(1, space.height - insetY) / height, 1));
  const scale = view.scale ?? fit;
  const shownPan = { x: view.pan.x + resizeOffset.x, y: view.pan.y + resizeOffset.y };
  const viewRef = useRef({ scale, pan: shownPan, fit }); viewRef.current = { scale, pan: shownPan, fit };
  const shown = original ? p.source.image : (p.result?.image || p.source.image);

  function anchor(): Point {
    const element = stage.current!; const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const left = parseFloat(style.paddingLeft) || 0, right = parseFloat(style.paddingRight) || 0;
    return { x: rect.left + (rect.width + left - right) / 2, y: rect.top + rect.height / 2 };
  }
  function release(id: number) { if (stage.current?.hasPointerCapture(id)) stage.current.releasePointerCapture(id); }
  function paintOverlay(data: Float32Array) {
    const canvas = overlay.current; if (!canvas) return;
    const size = latest.current.maskSize; if (!size.width || !size.height) return;
    canvas.width = size.width; canvas.height = size.height;
    const rgba = new Uint8ClampedArray(data.length * 4);
    for (let i = 0; i < data.length; i++) {
      const n = data[i], j = i * 4; if (!n) continue;
      rgba[j] = n > 0 ? 28 : 242; rgba[j + 1] = n > 0 ? 190 : 133; rgba[j + 2] = n > 0 ? 141 : 49; rgba[j + 3] = Math.round(Math.abs(n) * 145);
    }
    canvas.getContext('2d')?.putImageData(new ImageData(rgba, canvas.width, canvas.height), 0, 0);
  }
  function cancelGesture(restoreResize: boolean, releaseCapture = true) {
    const g = gesture.current; gesture.current = null; setResizeOffset({ x: 0, y: 0 }); setPushPreview(null);
    if (!g) return;
    if (releaseCapture) release(g.pointerId);
    if (g.kind === 'paint') paintOverlay(latest.current.mask);
    if (g.kind === 'resize' && restoreResize && latest.current.source === g.source && latest.current.mask === g.mask)
      latest.current.onChange({ width: g.width, height: g.height }, false);
  }
  function cancelAll(restoreResize: boolean) {
    pinch.current = null; pointers.current.clear(); cancelGesture(restoreResize);
  }
  useLayoutEffect(() => {
    const element = stage.current; if (!element) return;
    let previousAnchor: Point | null = null;
    let previousSize = { width: 0, height: 0 };
    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect, nextAnchor = anchor();
      cancelAll(true);
      const oldAnchor = previousAnchor, oldSize = previousSize; previousAnchor = nextAnchor; previousSize = { width: rect.width, height: rect.height };
      setSpace({ width: rect.width, height: rect.height });
      // Keep zoom fixed. If an inspector would clip the image, move only enough
      // to keep it visible; restore the old framing when that inspector closes.
      if (oldAnchor) {
        const v = { scale: viewRef.current.scale, pan: rawViewRef.current.pan };
        const props = latest.current, showOriginal = isPainting(props.tool) || props.compare;
        const iw = (showOriginal ? props.source.image.width : props.settings.width) * v.scale;
        const ih = (showOriginal ? props.source.image.height : props.settings.height) * v.scale;
        const priorCenter = { x: oldAnchor.x + v.pan.x, y: oldAnchor.y + v.pan.y };
        let center = { ...priorCenter };
        const restore = resizeRestore.current;
        if (restore && Math.abs(rect.width - restore.width) < 2 && Math.abs(rect.height - restore.height) < 2 && Math.abs(v.scale - restore.scale) < .0001) {
          center = restore.center; resizeRestore.current = null;
        } else {
          const halfW = Math.max(1, rect.width / 2 - 30), halfH = Math.max(1, rect.height / 2 - 36);
          if (iw <= halfW * 2) center.x = clamp(center.x, nextAnchor.x - halfW + iw / 2, nextAnchor.x + halfW - iw / 2);
          if (ih <= halfH * 2) center.y = clamp(center.y, nextAnchor.y - halfH + ih / 2, nextAnchor.y + halfH - ih / 2);
          if (!restore && (rect.width < oldSize.width || rect.height < oldSize.height) && (center.x !== priorCenter.x || center.y !== priorCenter.y))
            resizeRestore.current = { ...oldSize, center: priorCenter, scale: v.scale };
        }
        setView({ scale: v.scale, pan: { x: center.x - nextAnchor.x, y: center.y - nextAnchor.y } });
      }
      else {
        const props = latest.current, showOriginal = isPainting(props.tool) || props.compare;
        const iw = showOriginal ? props.source.image.width : props.settings.width, ih = showOriginal ? props.source.image.height : props.settings.height;
        const small = rect.width <= 760 || rect.height <= 380;
        const initialScale = Math.max(.001, Math.min(Math.max(1, rect.width - (small ? 64 : 130)) / iw, Math.max(1, rect.height - (small ? 86 : 120)) / ih, 1));
        setView({ scale: initialScale, pan: { x: 0, y: 0 } });
      }
    });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => { cancelAll(false); resizeRestore.current = null; setView({ scale: null, pan: { x: 0, y: 0 } }); }, [p.source]);
  useLayoutEffect(() => { if (view.scale === null) setView(v => v.scale === null ? { ...v, scale: fit } : v); }, [view.scale, fit]);
  useLayoutEffect(() => {
    const g = gesture.current; if (!g) return;
    const size = g.kind === 'resize' ? g.last : g.settings;
    const changed = p.settings.width !== size.width || p.settings.height !== size.height
      || (['contentAmount', 'transitionSoftness', 'shape', 'squeeze', 'protectStrength', 'forwardEnergy', 'quality'] as const).some(key => p.settings[key] !== g.settings[key]);
    if (p.source !== g.source || p.mask !== g.mask || p.tool !== g.tool || p.compare !== g.compare || changed) cancelAll(false);
  }, [p.source, p.mask, p.tool, p.compare, p.settings]);
  useLayoutEffect(() => { if (p.geometryLocked) cancelAll(false); }, [p.geometryLocked]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName)) holdingSpace.current = true;
      const key = e.key.toLowerCase();
      if (key === 'escape' || ((e.metaKey || e.ctrlKey) && ['z', 'o', 'e'].includes(key))) cancelAll(true);
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') holdingSpace.current = false; };
    const blur = () => { holdingSpace.current = false; cancelAll(true); };
    const visibility = () => { if (document.hidden) blur(); };
    document.addEventListener('keydown', down, true); document.addEventListener('keyup', up);
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility);
    return () => { document.removeEventListener('keydown', down, true); document.removeEventListener('keyup', up); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useLayoutEffect(() => {
    const canvas = pixels.current; if (!canvas) return;
    canvas.width = shown.width; canvas.height = shown.height;
    canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(shown.data), shown.width, shown.height), 0, 0);
  }, [shown]);
  useLayoutEffect(() => { if (painting) paintOverlay(p.mask); }, [p.mask, p.maskSize, painting]);
  // Switching original/result keeps the visual width stable instead of jumping to another fit.
  const previousDimensions = useRef({ width, height, original, scale, source: p.source });
  useLayoutEffect(() => {
    const previous = previousDimensions.current;
    if (previous.original !== original && previous.source === p.source && !gesture.current) {
      const oldScale = previous.scale;
      setView(v => ({ ...v, scale: oldScale * previous.width / width }));
    }
    previousDimensions.current = { width, height, original, scale, source: p.source };
  }, [width, height, original, scale, p.source]);

  function context(pointerId: number): Context { return { pointerId, source: p.source, mask: p.mask, tool: p.tool, compare: p.compare, settings: p.settings }; }
  function normalizedPoint(e: { clientX: number; clientY: number }): Point {
    const rect = wrap.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - rect.left) / rect.width, 0, 1), y: clamp((e.clientY - rect.top) / rect.height, 0, 1) };
  }
  function maskPoint(e: { clientX: number; clientY: number }): Point {
    const rect = wrap.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width * p.maskSize.width, y: (e.clientY - rect.top) / rect.height * p.maskSize.height };
  }
  function radius(): Point {
    const rect = wrap.current!.getBoundingClientRect(), diameter = p.localRadius ?? 110;
    return { x: Math.max(.005, diameter / (2 * rect.width)), y: Math.max(.005, diameter / (2 * rect.height)) };
  }
  function stamp(g: Extract<Gesture, { kind: 'paint' }>, point: Point) {
    const rect = wrap.current!.getBoundingClientRect();
    stampSoftBrush(g.data, g.base, g.coverage, p.maskSize.width, p.maskSize.height, point,
      { x: p.brushSize * p.maskSize.width / (2 * rect.width), y: p.brushSize * p.maskSize.height / (2 * rect.height) },
      p.brushHardness ?? .5, g.tool === 'erase' ? 'erase' : g.tool === 'compress' ? 'compress' : 'protect');
  }
  function draw(g: Extract<Gesture, { kind: 'paint' }>, point: Point) {
    if (g.tool === 'rectangle') {
      g.data.set(g.base);
      const x0 = Math.max(0, Math.floor(Math.min(g.start.x, point.x))), x1 = Math.min(p.maskSize.width, Math.ceil(Math.max(g.start.x, point.x)));
      const y0 = Math.max(0, Math.floor(Math.min(g.start.y, point.y))), y1 = Math.min(p.maskSize.height, Math.ceil(Math.max(g.start.y, point.y)));
      for (let y = y0; y < y1; y++) g.data.fill(1, y * p.maskSize.width + x0, y * p.maskSize.width + x1);
    } else {
      const distance = Math.hypot(point.x - g.last.x, point.y - g.last.y), steps = Math.max(1, Math.ceil(distance / 1.5));
      for (let i = 1; i <= steps; i++) stamp(g, { x: g.last.x + (point.x - g.last.x) * i / steps, y: g.last.y + (point.y - g.last.y) * i / steps });
    }
    g.last = point; paintOverlay(g.data);
  }
  function beginPinch() {
    const [a, b] = [...pointers.current.values()]; if (!a || !b) return;
    const resizeGesture = gesture.current?.kind === 'resize' ? gesture.current : null;
    const v = resizeGesture ? { scale: resizeGesture.scale, pan: resizeGesture.origin } : viewRef.current;
    cancelGesture(true, false);
    pinch.current = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, scale: v.scale, pan: v.pan, anchor: anchor() };
    for (const id of pointers.current.keys()) stage.current?.setPointerCapture(id);
  }
  function down(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    resizeRestore.current = null;
    if (e.pointerType === 'touch') {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size >= 2) { beginPinch(); e.preventDefault(); return; }
    }
    if (!e.isPrimary || gesture.current || pinch.current) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const within = wrap.current?.contains(e.target as Node);
    setView(v => ({ ...v, scale: v.scale ?? scale }));
    if (e.altKey || holdingSpace.current || (!within && !painting) || (painting && p.geometryLocked) || p.compare || p.tool === 'transform') {
      gesture.current = { ...context(e.pointerId), kind: 'pan', start: { x: e.clientX, y: e.clientY }, origin: view.pan };
    } else if (painting && within) {
      p.onInteractionStart();
      const point = maskPoint(e), data = new Float32Array(p.mask);
      const g: Extract<Gesture, { kind: 'paint' }> = { ...context(e.pointerId), kind: 'paint', data, base: p.mask, coverage: new Float32Array(data.length), start: point, last: point };
      gesture.current = g; if (p.tool !== 'rectangle') stamp(g, point); paintOverlay(data);
    } else if (local && within) {
      p.onInteractionStart();
      const point = normalizedPoint(e), r = radius();
      gesture.current = { ...context(e.pointerId), kind: 'local', start: point, last: point, radius: r, mode: p.localMode ?? 'scale' };
      if (p.localMode === 'push') setPushPreview({ from: point, to: point, radius: r });
    } else return;
    e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault();
  }
  function resize(e: ReactPointerEvent<HTMLButtonElement>, handle: ResizeHandle) {
    e.stopPropagation();
    if (e.pointerType === 'touch' && pointers.current.size > 0 && !pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); beginPinch(); e.preventDefault(); return;
    }
    if (e.button !== 0 || !e.isPrimary || gesture.current || p.geometryLocked) return; e.preventDefault();
    p.onInteractionStart(); resizeRestore.current = null; setView(v => ({ ...v, scale }));
    const size = { width: p.settings.width, height: p.settings.height };
    gesture.current = { ...context(e.pointerId), kind: 'resize', start: { x: e.clientX, y: e.clientY }, ...size, scale, handle, locked: p.locked, origin: view.pan, last: size, shift: { x: 0, y: 0 } };
    if (e.pointerType === 'touch') pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stage.current?.setPointerCapture(e.pointerId);
  }
  function move(e: ReactPointerEvent<HTMLDivElement>) {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pin = pinch.current;
    if (pin) {
      const [a, b] = [...pointers.current.values()]; if (!a || !b) return;
      const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const nextScale = clamp(pin.scale * Math.hypot(a.x - b.x, a.y - b.y) / pin.distance, .005, 8);
      const ratio = nextScale / pin.scale;
      setView({ scale: nextScale, pan: { x: middle.x - pin.anchor.x - (pin.midpoint.x - pin.anchor.x - pin.pan.x) * ratio, y: middle.y - pin.anchor.y - (pin.midpoint.y - pin.anchor.y - pin.pan.y) * ratio } });
      return;
    }
    const g = gesture.current; if (!g || g.pointerId !== e.pointerId) return;
    if (g.kind === 'paint') { draw(g, maskPoint(e)); return; }
    if (g.kind === 'pan') { setView(v => ({ ...v, pan: { x: g.origin.x + e.clientX - g.start.x, y: g.origin.y + e.clientY - g.start.y } })); return; }
    if (g.kind === 'local') {
      g.last = normalizedPoint(e);
      if (g.mode === 'push') setPushPreview({ from: g.start, to: g.last, radius: g.radius });
      return;
    }
    const next = resizeGeometry(g.width, g.height, g.handle, { x: e.clientX - g.start.x, y: e.clientY - g.start.y }, g.scale, g.locked);
    g.last = { width: next.width, height: next.height }; g.shift = next.shift;
    setResizeOffset(next.shift); p.onChange(g.last, false);
  }
  function up(e: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      pinch.current = null; pointers.current.clear(); release(e.pointerId); return;
    }
    const g = gesture.current; if (!g || g.pointerId !== e.pointerId) return;
    move(e); gesture.current = null; setResizeOffset({ x: 0, y: 0 }); setPushPreview(null); release(e.pointerId);
    if (g.kind === 'paint' && g.data.some((value, i) => value !== g.base[i])) p.onMask(g.data);
    else if (g.kind === 'resize') {
      setView({ scale: g.scale, pan: { x: g.origin.x + g.shift.x, y: g.origin.y + g.shift.y } }); p.onChange(g.last, true);
    } else if (g.kind === 'local') {
      if (g.mode === 'push') { if (Math.hypot(g.last.x - g.start.x, g.last.y - g.start.y) > .002) p.onLocalPush?.(g.start, g.last, g.radius); }
      else p.onLocalPoint?.(g.last, g.radius);
    }
  }
  function cancel(e: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pinch.current) { pinch.current = null; pointers.current.clear(); }
    if (gesture.current?.pointerId === e.pointerId) cancelGesture(true);
  }
  function resizeKey(e: ReactKeyboardEvent<HTMLButtonElement>, handle: ResizeHandle) {
    const axis = e.key === 'ArrowLeft' ? { x: -1, y: 0 } : e.key === 'ArrowRight' ? { x: 1, y: 0 } : e.key === 'ArrowUp' ? { x: 0, y: -1 } : e.key === 'ArrowDown' ? { x: 0, y: 1 } : null;
    if (!axis || p.geometryLocked) return; e.preventDefault(); cancelAll(true); p.onInteractionStart();
    const step = e.shiftKey ? 1 : 10, next = resizeGeometry(p.settings.width, p.settings.height, handle, { x: axis.x * step, y: axis.y * step }, scale, p.locked);
    setView({ scale, pan: { x: view.pan.x + next.shift.x, y: view.pan.y + next.shift.y } });
    p.onChange({ width: next.width, height: next.height }, true);
  }
  function changeZoom(factor: number) { cancelAll(true); resizeRestore.current = null; setView(v => ({ ...v, scale: clamp(scale * factor, .005, 8) })); }
  function fitView() { cancelAll(true); resizeRestore.current = null; setView({ scale: null, pan: { x: 0, y: 0 } }); }
  const focus = p.localFocus;
  return <>
    <div ref={stage} className={`canvas-stage niuniu-canvas${local ? ' is-local-editing' : ''}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={cancel}>
      <div ref={wrap} className={`canvas-wrap${!original && !local && !p.geometryLocked ? ' has-handles' : ''}${painting && !p.geometryLocked ? ' is-painting' : ''}`} style={{ width: width * scale, height: height * scale, transform: `translate(${shownPan.x}px, ${shownPan.y}px)` }}>
        <canvas ref={pixels} className="canvas-image" aria-label={original ? '原始图片' : '编辑结果'} role="img" />
        {painting && <canvas ref={overlay} className="mask-canvas" style={{ opacity: p.showMask ? 1 : 0 }} aria-label={p.geometryLocked ? '保护选区（已锁定）' : '区域绘制画布'} />}
        {!original && !local && !p.geometryLocked && RESIZE_HANDLES.map(handle => <button key={handle.id} className={`resize-handle ${handle.id}`} aria-label={handle.label} title={`${handle.label} · 方向键微调`} onPointerDown={e => resize(e, handle.id)} onKeyDown={e => resizeKey(e, handle.id)} />)}
        {local && <>
          <svg className="local-focus-overlay" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
            {focus && <ellipse cx={focus.cx * width} cy={focus.cy * height} rx={focus.rx * width} ry={focus.ry * height} transform={`rotate(${focus.angle * 180 / Math.PI} ${focus.cx * width} ${focus.cy * height})`} />}
            {pushPreview && <><ellipse cx={pushPreview.from.x * width} cy={pushPreview.from.y * height} rx={pushPreview.radius.x * width} ry={pushPreview.radius.y * height} /><line x1={pushPreview.from.x * width} y1={pushPreview.from.y * height} x2={pushPreview.to.x * width} y2={pushPreview.to.y * height} /><circle cx={pushPreview.to.x * width} cy={pushPreview.to.y * height} r={5 / scale} /></>}
          </svg>
          {(p.localTargets ?? []).map(target => <button key={target.id} className={`local-target${p.selectedLocalTarget === target.id ? ' is-active' : ''}`} style={{ left: `${target.cx * 100}%`, top: `${target.cy * 100}%` }} aria-label={`选择${target.label}`} aria-pressed={p.selectedLocalTarget === target.id} title={target.label} onClick={() => { p.onInteractionStart(); p.onLocalTarget?.(target.id); }}><span aria-hidden="true" /><span className="local-target-label">{target.label}</span></button>)}
        </>}
        <span className="canvas-size-label">{width} × {height}</span>
      </div>
      {painting ? <div className={`canvas-message ${p.tool === 'compress' ? 'compress' : 'protect'}`}><Icon name={p.tool === 'erase' ? 'eraser' : 'shield'} size={14} /><span>原图选区 · {p.geometryLocked ? '重置局部后可编辑保护' : p.tool === 'protect' ? '保护主体' : p.tool === 'compress' ? '优先压缩' : p.tool === 'erase' ? '柔和擦除' : '框选保护'}</span><button className="text-button" onClick={p.onDone}>查看结果</button></div>
        : p.compare ? <div className="canvas-badge"><Icon name="compare" size={14} />正在查看原图</div>
        : local ? <div className="canvas-badge local-instruction">{p.localMode === 'push' ? '拖动推拉 · 双指移动视图' : '点选部位或图片 · 调整局部比例'}</div>
        : <div className="canvas-badge"><span className="local-indicator">{p.geometryLocked ? '已有局部塑形 · 整体尺寸已锁定' : '拖动四边与四角调整画布'}</span></div>}
      {p.busy && <div className="progress" role="status"><span className="spinner" /><span>{p.progress.label || '正在处理'}</span><div className="progress-track"><div className="progress-bar" style={{ width: `${Math.max(3, p.progress.value * 100)}%` }} /></div></div>}
    </div>
    <div className="statusbar"><span className="status-text">{painting ? p.geometryLocked ? '原图选区已锁定 · 可平移查看' : '原图标记 · 绿色保护 · 橙色压缩' : local ? '双指缩放平移 · 空格拖动平移' : p.result?.warnings[0] || '八向调整尺寸 · 双指缩放平移'}</span><div className="zoom-controls" role="group" aria-label="画布缩放"><button className="btn-icon" title="缩小视图" aria-label="缩小视图" disabled={scale <= .005} onClick={() => changeZoom(1 / 1.25)}><Icon name="minus" size={15} /></button><span className="zoom-value">{Math.round(scale * 100)}%</span><button className="btn-icon" title="放大视图" aria-label="放大视图" disabled={scale >= 8} onClick={() => changeZoom(1.25)}><Icon name="plus" size={15} /></button><button className="btn-icon" title="适应窗口" aria-label="适应窗口" onClick={fitView}><Icon name="fit" size={16} /></button></div></div>
  </>;
}
