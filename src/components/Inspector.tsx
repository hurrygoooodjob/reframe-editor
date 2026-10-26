import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { SHAPES } from '../types';
import type { EditSettings, Quality } from '../types';
import Icon from './Icon';

export interface InspectorProps {
  autoControls?: ReactNode;
  mode: 'shape' | 'local' | 'selection' | 'project';
  localControls?: ReactNode;
  brushHardness: number;
  onBrushHardnessChange:(value:number)=>void;
  selectionTools?:ReactNode;
  onClose: () => void;
  onEditMask: () => void;
  protectRatio: number;
  compressRatio: number;
  settings: EditSettings;
  originalSize: { width: number; height: number };
  onChange: (patch: Partial<EditSettings>, commit?: boolean) => void;
  locked: boolean;
  onLockedChange: (value: boolean) => void;
  brushSize: number;
  onBrushSizeChange: (value: number) => void;
  showMask: boolean;
  onShowMaskChange: (value: boolean) => void;
  onClearMask: () => void;
  onReset: () => void;
  onSaveProject: () => void;
  onLoadProject: () => void;
  maskCount: number;
  busy: boolean;
}

const MIN_SIZE = 32;
const MAX_SIZE = 8192;
const boundSize = (value: number) => Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(value)));
const rangeStyle = (value: number, min = 0, max = 1) => ({ '--range-progress': `${100 * (value - min) / (max - min)}%` } as CSSProperties);

function fitLockedDimensions(axis: 'width' | 'height', value: number, ratio: number) {
  const safeRatio = Math.max(MIN_SIZE / MAX_SIZE, Math.min(MAX_SIZE / MIN_SIZE, ratio));
  const driverRatio = axis === 'width' ? safeRatio : 1 / safeRatio;
  // Restrict the edited axis first so its dependent axis never needs a separate clamp.
  const minimum = Math.max(MIN_SIZE, Math.ceil(MIN_SIZE * driverRatio));
  const maximum = Math.min(MAX_SIZE, Math.floor(MAX_SIZE * driverRatio));
  const driver = Math.max(minimum, Math.min(maximum, Math.round(value)));
  const dependent = Math.round(driver / driverRatio);
  return axis === 'width' ? { width: driver, height: dependent } : { width: dependent, height: driver };
}

function DimensionField({ label, value, onEditStart, onChange }: { label: string; value: number; onEditStart: () => void; onChange: (value: number, commit: boolean) => number }) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(String(value)); }, [value]);
  function commit() {
    focused.current = false;
    const parsed = Number(draft);
    const next = draft.trim() && Number.isFinite(parsed) ? boundSize(parsed) : value;
    const applied = onChange(next, true);
    setDraft(String(applied));
  }
  return <label className="dimension-field">
    <span>{label}</span>
    <div className="number-input">
      <input aria-label={label === '宽度' ? '画布宽度' : '画布高度'} type="number" inputMode="numeric" min={MIN_SIZE} max={MAX_SIZE} step="1" value={draft}
        onFocus={() => { focused.current = true; onEditStart(); }}
        onChange={(event) => {
          const input = event.currentTarget.value;
          setDraft(input);
          const parsed = Number(input);
          if (input !== '' && Number.isFinite(parsed) && parsed >= MIN_SIZE && parsed <= MAX_SIZE) onChange(boundSize(parsed), false);
        }}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
      /><span>px</span>
    </div>
  </label>;
}

export function Slider({ label, value, min = 0, max = 1, step = 0.01, display, onChange, disabled = false }: { label: string; value: number; min?: number; max?: number; step?: number; display: string; onChange: (value: number, commit: boolean) => void; disabled?: boolean }) {
  const last = useRef(value);
  const changed = useRef(false);
  last.current = value;
  function commit() {
    if (!changed.current) return;
    changed.current = false;
    onChange(last.current, true);
  }
  function keyCommit(event: KeyboardEvent<HTMLInputElement>) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
      last.current = Number(event.currentTarget.value);
      commit();
    }
  }
  return <div className={`slider-field${disabled ? ' is-disabled' : ''}`}>
    <div className="field-heading"><span>{label}</span><output>{display}</output></div>
    <input type="range" aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled} style={rangeStyle(value, min, max)}
      onChange={(event) => { last.current = Number(event.currentTarget.value); changed.current = true; onChange(last.current, false); }}
      onPointerUp={(event) => { last.current = Number(event.currentTarget.value); commit(); }}
      onKeyUp={keyCommit} onBlur={(event) => { last.current = Number(event.currentTarget.value); commit(); }} />
  </div>;
}

export default function Inspector(props: InspectorProps) {
  const { settings, originalSize, onChange, locked, onLockedChange, brushSize, onBrushSizeChange, showMask, onShowMaskChange, onClearMask, onReset, onSaveProject, onLoadProject, maskCount, busy } = props;
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; }, [props.mode]);
  const latest = useRef(settings);
  const dimensionRatio = useRef<number | null>(null);
  latest.current = settings;
  function patch(values: Partial<EditSettings>, commit = true) {
    latest.current = { ...latest.current, ...values };
    onChange(values, commit);
  }
  function changeDimension(axis: 'width' | 'height', value: number, commit: boolean) {
    const previous = latest.current;
    // Hold the ratio for the entire typing gesture: rounded live updates must not
    // become the source ratio for the next digit or the final blur commit.
    dimensionRatio.current ??= previous.width / previous.height;
    const next: Partial<EditSettings> = locked
      ? fitLockedDimensions(axis, value, dimensionRatio.current)
      : { [axis]: boundSize(value) };
    patch(next, commit);
    if (commit) dimensionRatio.current = null;
    return next[axis] ?? previous[axis];
  }
  function startDimensionEdit() {
    dimensionRatio.current = latest.current.width / latest.current.height;
  }
  function setRatio(ratio: number) {
    dimensionRatio.current = null;
    patch(fitLockedDimensions('width', latest.current.width, ratio));
  }
  const selectedRatio = settings.width / settings.height;
  const ratios = [{ label: '原始', ratio: originalSize.width / originalSize.height }, { label: '1:1', ratio: 1 }, { label: '4:5', ratio: 4 / 5 }, { label: '16:9', ratio: 16 / 9 }];

  const title = props.mode === 'shape' ? '整体调整' : props.mode === 'local' ? '局部塑形' : props.mode === 'selection' ? '保护与压缩' : '工程与输出';
  return <aside className={`inspector inspector-${props.mode}`} aria-label="图片编辑属性">
    <div className="inspector-title"><h2>{title}</h2><span className="inspector-eyebrow">本地处理</span><button className="panel-close" aria-label="收起设置面板" onClick={props.onClose}><Icon name="chevron" size={18}/><span>收起</span></button></div>
    <div ref={scroll} className="inspector-scroll">
    {props.mode === 'local' && props.localControls}
    {props.mode === 'shape' && props.autoControls}
    {props.mode === 'shape' && <fieldset className="controls-fieldset" disabled={busy}>
    <section className="section" aria-labelledby="dimensions-heading">
      <div className="section-heading"><h2 id="dimensions-heading">画布尺寸</h2></div>
      <div className="grouped-card"><div className="dimensions-row">
        <DimensionField label="宽度" value={settings.width} onEditStart={startDimensionEdit} onChange={(value, commit) => changeDimension('width', value, commit)} />
        <button className={`btn-icon ratio-lock${locked ? ' is-active' : ''}`} title={locked ? '取消锁定比例' : '锁定宽高比例'} aria-label={locked ? '取消锁定比例' : '锁定宽高比例'} aria-pressed={locked} onClick={() => onLockedChange(!locked)}><Icon name={locked ? 'lock' : 'unlock'} size={16} /></button>
        <DimensionField label="高度" value={settings.height} onEditStart={startDimensionEdit} onChange={(value, commit) => changeDimension('height', value, commit)} />
      </div><div className="ratio-presets" aria-label="画布比例预设">{ratios.map(({ label, ratio }) => <button key={label} className={`ratio-button${Math.abs(selectedRatio - ratio) < 0.005 ? ' is-active' : ''}`} onClick={() => setRatio(ratio)} aria-label={`设为${label}比例`}>{label}</button>)}</div></div>
    </section>
    <details className="advanced"><summary>高级缩放与轮廓</summary>
    <section className="section" aria-labelledby="content-heading">
      <div className="section-heading"><h2 id="content-heading">内容感知</h2></div>
      <div className="grouped-card">
        <Slider label="智能缩放强度" value={settings.contentAmount} display={`${Math.round(settings.contentAmount * 100)}%`} onChange={(value, commit) => patch({ contentAmount: value }, commit)} />
        <Slider label="过渡柔和度" value={settings.transitionSoftness} display={`${Math.round(settings.transitionSoftness * 100)}%`} onChange={(value, commit) => patch({ transitionSoftness: value }, commit)} />
        <div className="range-labels"><span>原始接缝</span><span>柔和衔接</span></div>
        <label className="checkbox-row switch-row"><span>优化边缘连续性</span><input type="checkbox" checked={settings.forwardEnergy} onChange={(event) => patch({ forwardEnergy: event.currentTarget.checked })}/><span className="classic-switch" aria-hidden="true"><span>{settings.forwardEnergy ? 'ON' : 'OFF'}</span></span></label>
      </div>
    </section>
    <section className="section" aria-labelledby="shape-heading">
      <div className="section-heading"><h2 id="shape-heading">形状挤压</h2><span className="section-meta">{SHAPES.find((shape) => shape.id === settings.shape)?.label}</span></div>
      <div className="grouped-card"><div className="shape-grid">{SHAPES.map((shape) => <button key={shape.id} className={`shape-button${settings.shape === shape.id ? ' is-active' : ''}`} aria-label={`选择${shape.label}`} aria-pressed={settings.shape === shape.id} title={shape.label} onClick={() => patch({ shape: shape.id })}><Icon name={shape.id} size={20}/><span>{shape.label}</span></button>)}</div>
      {settings.shape !== 'rect' && <Slider label="挤压强度" value={settings.squeeze} display={`${Math.round(settings.squeeze * 100)}%`} onChange={(value, commit) => patch({ squeeze: value }, commit)}/>}</div>
      <p className="field-note">{settings.shape === 'rect' ? '当前矩形无需形状挤压。形状由你手动选择。' : '低强度裁切轮廓，高强度将内容挤入轮廓。'}</p>
    </section>
    </details></fieldset>}
    {props.mode === 'selection' && <section className="section" aria-labelledby="mask-heading">
      <div className="section-heading"><h2 id="mask-heading">手动微调</h2><span className={`section-meta${maskCount ? ' mask-present' : ''}`}>{maskCount ? '已有标记' : '尚未标记'}</span></div>
      {props.selectionTools}
      <div className="grouped-card">
        <Slider label="画笔大小" value={brushSize} min={6} max={180} step={1} display={`${brushSize} px`} onChange={(value) => onBrushSizeChange(value)} />
        <Slider label="笔刷硬度" value={props.brushHardness} display={`${Math.round(props.brushHardness*100)}%`} onChange={v=>props.onBrushHardnessChange(v)}/>
        <div className="mask-legend"><span><i className="legend-dot protect"/>保护 {Math.round(props.protectRatio * 100)}%</span><span><i className="legend-dot compress"/>压缩 {Math.round(props.compressRatio * 100)}%</span></div>
        <div className="mask-actions"><label className="checkbox-row"><input type="checkbox" checked={showMask} onChange={(event) => onShowMaskChange(event.currentTarget.checked)}/><span>显示区域标记</span></label><button className="text-button" disabled={!maskCount} onClick={onClearMask}>清空选区</button></div>

      </div>
      <p className="field-note">选择保护、压缩、擦除或框选工具，再涂抹图片。手机上可收起此面板，留出完整画布。</p>
      <p className="field-note">软边影响真实保护权重。整体缩放使用此选区，局部塑形使用独立影响范围。</p>
    </section>}

    {props.mode === 'project' && <section className="section output-section" aria-labelledby="output-heading">
      <div className="section-heading"><h2 id="output-heading">输出设置</h2><span className="section-meta">PNG · 透明背景</span></div>
      <div className="grouped-card"><label className="select-field"><span>计算精度</span><select value={settings.quality} aria-label="计算精度" onChange={(event) => patch({ quality: event.currentTarget.value as Quality })}><option value="draft">快速</option><option value="balanced">均衡 · 推荐</option><option value="fine">精细</option></select><Icon name="chevron" size={15}/></label></div>
      <p className="field-note">精细模式保留更多结构，计算时间会增加。导出始终从原图采样。</p>
      <div className="section-heading"><h2>继续编辑</h2></div>
      <div className="project-actions"><button className="btn" onClick={onSaveProject} disabled={busy}><Icon name="save" size={16}/>保存工程</button><button className="btn" onClick={onLoadProject}><Icon name="open" size={16}/>打开工程</button></div>
      <p className="field-note">工程包含原图、参数和选区。关闭页面前保存，下次打开即可继续。</p>
      <button className="reset-button" onClick={onReset}><Icon name="reset" size={16}/><span>还原所有编辑</span></button>
    </section>}
    <div className="inspector-footer"><Icon name="shield" size={14}/><span>图片仅在你的设备中处理</span></div>
    </div>
  </aside>;
}
