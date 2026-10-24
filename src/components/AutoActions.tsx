import type { AutoSelectionInfo } from '../types';

export interface AutoActionsProps {
  busy: boolean;
  disabled: boolean;
  info: AutoSelectionInfo | null;
  protectRatio: number;
  compressRatio: number;
  onRandom: () => void;
  onAnalyze: () => void;
  onEdit: () => void;
  onCancel: () => void;
  progress: { value: number; label: string };
}

const clampRatio = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const percent = (value: number) => value > 0 && value < 0.005 ? '<1%' : `${Math.round(value * 100)}%`;

function DiceIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4.5" y="4.5" width="15" height="15" rx="3" transform="rotate(-9 12 12)" />
    <g fill="currentColor" stroke="none" transform="rotate(-9 12 12)"><circle cx="8.5" cy="8.5" r="1" /><circle cx="15.5" cy="8.5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="8.5" cy="15.5" r="1" /><circle cx="15.5" cy="15.5" r="1" /></g>
  </svg>;
}

function SelectionIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 3H3v3.5M13.5 3H17v3.5M17 13.5V17h-3.5M6.5 17H3v-3.5" /><circle cx="10" cy="10" r="3" /></svg>;
}

function EditIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m11.5 4.5 4 4M4 12l9-9a1.5 1.5 0 0 1 2.1 0l1.9 1.9a1.5 1.5 0 0 1 0 2.1l-9 9-5 1z" /></svg>;
}

export default function AutoActions({ busy, disabled, info, protectRatio, compressRatio, onRandom, onAnalyze, onEdit, onCancel, progress }: AutoActionsProps) {
  const protect = clampRatio(protectRatio);
  const compress = Math.min(1 - protect, clampRatio(compressRatio));
  const hasMask = protect > 0 || compress > 0;
  const unavailable = busy || disabled;
  const completion = Math.round(clampRatio(progress.value) * 100);
  const warning = info?.confidence === 'low' ? info.warnings[0] || '画面特征较弱，建议检查并微调选区。' : null;

  return <div className="auto-actions" role="region" aria-label="自动识别与随机挤压" aria-busy={busy}>
    <div className="auto-heading"><h2>自动塑形</h2><span className="auto-local">本地分析</span></div>
    <button className="auto-primary" type="button" onClick={onRandom} disabled={unavailable} aria-describedby="auto-explanation">
      {busy ? <span className="auto-spinner" aria-hidden="true" /> : <DiceIcon />}
      <span>{busy ? '正在生成方案' : info ? '再随机一次' : '一键随机挤压'}</span>
      {!busy ? <svg className="auto-arrow" aria-hidden="true" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10h11m-4-4 4 4-4 4" /></svg> : null}
    </button>
    <div className="auto-secondary-row">
      <button className="auto-secondary" type="button" onClick={onAnalyze} disabled={unavailable}><SelectionIcon /><span>仅识别选区</span></button>
      <button className="auto-secondary" type="button" onClick={onEdit} disabled={unavailable || !hasMask}><EditIcon /><span>查看 / 微调</span></button>
    </div>
    {busy ? <div className="auto-working">
      <div className="auto-working-header"><span role="status">{progress.label || '正在分析画面'}</span><button type="button" onClick={onCancel}>取消</button></div>
      <div className="auto-progress" role="progressbar" aria-label="自动识别进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion}><span style={{ width: `${completion}%` }} /></div>
    </div> : null}
    {hasMask && !busy ? <div className="auto-summary">
      <div className="auto-summary-labels"><span><i className="auto-dot auto-dot-protect" />保护 <strong>{percent(protect)}</strong></span><span><i className="auto-dot auto-dot-compress" />压缩 <strong>{percent(compress)}</strong></span>{info?.edited ? <small>已微调</small> : null}</div>
      <div className="auto-coverage" aria-hidden="true"><span className="auto-coverage-protect" style={{ width: `${protect * 100}%` }} /><span className="auto-coverage-compress" style={{ width: `${compress * 100}%` }} /></div>
    </div> : null}
    {warning && !busy ? <p className="auto-warning"><svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="5.6" /><path d="M8 4.7v3.7" /><circle cx="8" cy="10.8" r=".4" fill="currentColor" /></svg><span>{warning}</span></p> : null}
    <p id="auto-explanation" className="auto-explanation">自动寻找保护与压缩区域。<br />保留当前形状、挤压强度和柔和度。</p>
  </div>;
}
