import { useEffect, useId, useRef, useState } from 'react';
import {
  fitLongEdge, MAX_EXPORT_EDGE, recommendedExportSize, validateExportSize,
  type PixelSize,
} from '../exportSize';
import Icon from './Icon';
import './output-controls.css';

interface Props {
  canvasSize: PixelSize;
  initialSize?: PixelSize;
  onSubmit: (size: PixelSize) => void;
  onClose: () => void;
}

export default function ExportSizeDialog({ canvasSize, initialSize, onSubmit, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const messageId = useId();
  const recommended = recommendedExportSize(canvasSize);
  const startingSize = initialSize && !validateExportSize(initialSize) ? initialSize : recommended;
  const [width, setWidth] = useState(String(startingSize.width));
  const [height, setHeight] = useState(String(startingSize.height));
  const aspect = canvasSize.width / canvasSize.height;
  const [locked, setLocked] = useState(
    Math.abs(startingSize.width - startingSize.height * aspect) <= Math.max(1, aspect),
  );
  const size = { width: Number(width), height: Number(height) };
  const error = validateExportSize(size);
  const [presetKey, setPresetKey] = useState(initialSize ? '' : 'recommended');
  const editedAspect = size.width / size.height;
  const changesProportion = !locked && !error && Math.abs(editedAspect / aspect - 1) > 0.005;
  const canvasError = validateExportSize(canvasSize);

  useEffect(() => {
    const node = dialog.current;
    const previousFocus = document.activeElement;
    node?.showModal();
    return () => {
      node?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  function fit(size: PixelSize, preset: string) {
    setPresetKey(preset);
    setWidth(String(size.width));
    setHeight(String(size.height));
    setLocked(true);
  }

  function edit(axis: 'width' | 'height', raw: string) {
    setPresetKey('');
    const value = Number(raw);
    if (axis === 'width') setWidth(raw);
    else setHeight(raw);
    if (!locked || !Number.isInteger(value) || value < 1 || value > MAX_EXPORT_EDGE) return;
    if (axis === 'width') setHeight(String(Math.max(1, Math.round(value / aspect))));
    else setWidth(String(Math.max(1, Math.round(value * aspect))));
  }

  function toggleLock() {
    if (!locked) {
      const driver = size.width;
      if (Number.isInteger(driver) && driver >= 1) {
        setHeight(String(Math.max(1, Math.round(driver / aspect))));
      } else {
        fit(recommended, 'recommended');
      }
    }
    setLocked(!locked);
  }

  return (
    <dialog className="dialog output-size-dialog" ref={dialog} aria-labelledby={headingId}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => {
        if (event.target !== dialog.current) return;
        const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
        if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) onClose();
      }}>
      <div className="dialog-header">
        <h2 id={headingId}>导出尺寸</h2>
        <button type="button" className="btn-icon" aria-label="关闭导出设置" onClick={onClose}><Icon name="close"/></button>
      </div>
      <form noValidate onSubmit={event => { event.preventDefault(); if (!error) onSubmit(size); }}>
        <p className="output-canvas-size">塑形画布 <strong>{canvasSize.width} × {canvasSize.height} px</strong></p>
        <div className="output-presets" role="group" aria-label="导出尺寸预设">
          <button type="button" aria-pressed={presetKey === 'recommended'} onClick={() => fit(recommended, 'recommended')}>推荐尺寸</button>
          {[1080, 2048, 4096].map(edge => {
            const preset = fitLongEdge(canvasSize, edge);
            return <button key={edge} type="button" disabled={Boolean(validateExportSize(preset))}
              aria-pressed={presetKey === String(edge)} onClick={() => fit(preset, String(edge))}>长边 {edge}</button>;
          })}
          <button type="button" disabled={Boolean(canvasError)} title={canvasError ?? undefined}
            aria-pressed={presetKey === 'canvas'} onClick={() => fit(canvasSize, 'canvas')}>画布尺寸</button>
        </div>
        <div className="output-dimensions">
          <label>宽度 <span>px</span><input type="number" inputMode="numeric" min={1} max={MAX_EXPORT_EDGE}
            aria-label="导出宽度" aria-describedby={messageId} value={width} onChange={event => edit('width', event.target.value)}/></label>
          <button type="button" className="output-lock" aria-label="保持画布宽高比" aria-pressed={locked}
            title={locked ? '解锁宽高比' : '保持画布宽高比'} onClick={toggleLock}>
            <Icon name={locked ? 'lock' : 'unlock'} size={19}/>
          </button>
          <label>高度 <span>px</span><input type="number" inputMode="numeric" min={1} max={MAX_EXPORT_EDGE}
            aria-label="导出高度" aria-describedby={messageId} value={height} onChange={event => edit('height', event.target.value)}/></label>
        </div>
        <p id={messageId} className={'output-size-message' + (error ? ' has-error' : '')} aria-live="polite">
          {error || (changesProportion ? '导出的图片会拉伸到这个宽高比。' : '按所选尺寸直接生成 PNG，保留塑形效果和透明区域。')}
        </p>
        <div className="output-result"><span>PNG</span><strong>{error ? '待输入有效尺寸' : size.width + ' × ' + size.height + ' px'}</strong></div>
        <div className="dialog-actions">
          <button className="btn" type="button" onClick={onClose}>取消</button>
          <button className="btn btn-primary" type="submit" disabled={Boolean(error)}><Icon name="download" size={16}/>生成 PNG</button>
        </div>
      </form>
    </dialog>
  );
}
