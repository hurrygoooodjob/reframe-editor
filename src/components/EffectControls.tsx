import { useId, useState } from 'react';
import type { PixelImage } from '../types';
import { createEffect, EFFECT_CATALOG, type EffectSettings } from '../effects/catalog';
import Icon from './Icon';
import { Slider } from './Inspector';
import { useEffectSamples } from './useEffectSamples';
import './effect-controls.css';

type Definition = (typeof EFFECT_CATALOG)[number];
type Control = Definition['controls'][number];
interface Props {
  value: EffectSettings | null;
  onChange: (effect: EffectSettings | null, commit: boolean) => void;
  disabled?: boolean;
  preview?: PixelImage | null;
}

const groups = [...new Set(EFFECT_CATALOG.map(effect => effect.group))];
const featuredIds = ['halftone', 'riso', 'dither', 'ascii', '3d-toy-bricks', 'cross-stitch', 'edge', 'prism', 'vhs'];
const featured = featuredIds.map(id => EFFECT_CATALOG.find(effect => effect.id === id))
  .filter((effect): effect is Definition => Boolean(effect));

function TextParameter({ control, value, onChange }: {
  control: Control; value: string; onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return <label className="effect-param">{control.label}
    <input type="text" value={draft ?? value} maxLength={control.maxLength ?? 40}
      onChange={event => setDraft(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur(); }}
      onBlur={() => { if (draft !== null && draft !== value) onChange(draft); setDraft(null); }}/>
  </label>;
}

function Parameter({ control, value, onChange }: { control: Control; value: string; onChange: (value: string) => void }) {
  if (control.kind === 'bitmap') {
    return <div className="effect-param">
      <span>{control.label}</span>
      <div className="effect-bitmap" role="group" aria-label={control.label}>
        {Array.from({ length: 64 }, (_, index) => <button key={index} type="button"
          aria-label={Math.floor(index / 8) + 1 + ' 行 ' + (index % 8 + 1) + ' 列'}
          aria-pressed={value[index] === '1'}
          onClick={() => onChange(value.slice(0, index) + (value[index] === '1' ? '0' : '1') + value.slice(index + 1))}/>)}
      </div>
    </div>;
  }
  if (control.kind === 'text') return <TextParameter control={control} value={value} onChange={onChange}/>;
  return <label className="effect-param">{control.label}
    <select value={value} onChange={event => onChange(event.target.value)}>
      {control.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>;
}

export default function EffectControls({ value, onChange, disabled = false, preview = null }: Props) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [expanded, setExpanded] = useState(false);
  const searchId = useId();
  const active = EFFECT_CATALOG.find(effect => effect.id === value?.id);
  const search = query.trim().toLowerCase();
  const filtered = EFFECT_CATALOG.filter(effect =>
    (!group || effect.group === group) &&
    (!search || [effect.name, effect.english, effect.id, effect.group, effect.description]
      .some(text => text.toLowerCase().includes(search))),
  );
  const showFeatured = !group && !search && !expanded;
  const items = showFeatured ? featured : filtered;
  const gallery = useEffectSamples(preview, items.map(item => item.id).join(','));

  return <fieldset className="effect-controls" disabled={disabled} aria-label="图片效果">
    {active && value && <div className="effect-current grouped-card">
      <div className="effect-current-heading">
        <strong>{active.name}</strong>
        <button type="button" className="text-button" onClick={() => onChange(null, true)}>移除效果</button>
      </div>
      <Slider label="效果强度" min={0} max={100} step={1} value={value.strength} display={value.strength + '%'}
        onChange={(strength, commit) => onChange({ ...value, strength }, commit)}/>
      <details key={active.id} className="effect-extra">
        <summary>调整{active.scaleLabel}{active.controls.length ? '与细节' : ''}</summary>
        <Slider label={active.scaleLabel} min={2} max={16} step={1} value={value.size} display={String(value.size)}
          onChange={(size, commit) => onChange({ ...value, size }, commit)}/>
        {active.controls.map(control => <Parameter key={control.key} control={control}
          value={value.params[control.key] ?? control.value}
          onChange={change => onChange({ ...value, params: { ...value.params, [control.key]: change } }, true)}/>)}
        <button type="button" className="text-button" onClick={() => onChange(createEffect(active.id), true)}>恢复默认参数</button>
      </details>
    </div>}
    <div className="effect-filters">
      <input id={searchId} type="search" aria-label="搜索效果" placeholder="搜索效果" value={query}
        onChange={event => setQuery(event.target.value)}/>
      <select aria-label="效果分类" value={group} onChange={event => setGroup(event.target.value)}>
        <option value="">全部分类</option>{groups.map(name => <option key={name}>{name}</option>)}
      </select>
    </div>
    <p className="effect-gallery-caption" aria-live="polite">
      {showFeatured ? '精选效果' : '找到 ' + filtered.length + ' 种效果'}<span>当前图片</span>
    </p>
    {items.length > 0 ?
      <div ref={gallery} className="effect-gallery" aria-label="效果列表">
        {items.map(effect => <button type="button" key={effect.id} className="effect-tile"
          aria-pressed={value?.id === effect.id} aria-label={effect.name} title={effect.description}
          onClick={() => { if (effect.id !== value?.id) onChange(createEffect(effect.id), true); }}>
          <canvas className="effect-sample" data-effect={effect.id} width={1} height={1} aria-hidden="true"/><span className="effect-tile-name">{effect.name}</span>
          {value?.id === effect.id && <span className="effect-check"><Icon name="check" size={12}/></span>}
        </button>)}
      </div> :
      <div className="effect-empty"><p>没有找到匹配的效果。</p><button type="button" className="text-button" onClick={() => { setGroup(''); setQuery(''); }}>清除筛选</button></div>}
    {!group && !search && <button className="btn effect-expand" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {expanded ? '收起效果库' : '查看全部 ' + EFFECT_CATALOG.length + ' 种效果'}
    </button>}
  </fieldset>;
}
