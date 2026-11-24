import { useLayoutEffect, useRef, useState } from 'react';
import type { PixelImage } from '../types';
import { createEffect, EFFECT_CATALOG, type EffectSettings } from '../effects/catalog';
import { MAX_EFFECT_LAYERS, type EffectLayer } from '../effects/layers';
import Icon from './Icon';
import { Slider } from './Inspector';
import { useEffectSamples } from './useEffectSamples';
import './effect-controls.css';

type Definition = (typeof EFFECT_CATALOG)[number];
type Control = Definition['controls'][number];
interface Props {
  layers: EffectLayer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (effect: EffectSettings) => void;
  onChange: (id: string, effect: EffectSettings, commit: boolean) => void;
  onMove: (id: string, offset: -1 | 1) => void;
  onRemove: (id: string) => void;
  brushMode: 'erase' | 'restore' | null;
  onBrushMode: (mode: 'erase' | 'restore' | null) => void;
  brushSize: number;
  onBrushSize: (size: number) => void;
  brushHardness: number;
  onBrushHardness: (hardness: number) => void;
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

function EffectLibrary({preview, onPick}: {preview: PixelImage | null; onPick: (effect: EffectSettings) => void}) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [expanded, setExpanded] = useState(false);
  const search = query.trim().toLowerCase();
  const filtered = EFFECT_CATALOG.filter(effect =>
    (!group || effect.group === group) &&
    (!search || [effect.name, effect.english, effect.id, effect.group, effect.description]
      .some(text => text.toLowerCase().includes(search))),
  );
  const showFeatured = !group && !search && !expanded;
  const items = showFeatured ? featured : filtered;
  const gallery = useEffectSamples(preview, items.map(item => item.id).join(','));
  return <>
    <div className="effect-filters">
      <input type="search" aria-label="搜索效果" placeholder="搜索效果" value={query}
        onChange={event => setQuery(event.target.value)}/>
      <select aria-label="效果分类" value={group} onChange={event => setGroup(event.target.value)}>
        <option value="">全部分类</option>{groups.map(name => <option key={name}>{name}</option>)}
      </select>
    </div>
    <p className="effect-gallery-caption" aria-live="polite">
      {showFeatured ? '精选效果' : '找到 ' + filtered.length + ' 种效果'}<span>点选以叠加</span>
    </p>
    {items.length ? <div ref={gallery} className="effect-gallery" aria-label="效果列表">
      {items.map(effect => <button type="button" key={effect.id} className="effect-tile"
        aria-label={effect.name} title={effect.description} onClick={() => {
          const next = createEffect(effect.id);
          if (next) onPick(next);
        }}>
        <canvas className="effect-sample" data-effect={effect.id} width={1} height={1} aria-hidden="true"/>
        <span className="effect-tile-name">{effect.name}</span>
      </button>)}
    </div> : <div className="effect-empty">
      <p>没有找到匹配的效果。</p><button type="button" className="text-button"
        onClick={() => { setGroup(''); setQuery(''); }}>清除筛选</button>
    </div>}
    {!group && !search && <button className="btn effect-expand" type="button"
      aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {expanded ? '收起效果库' : '查看全部 ' + EFFECT_CATALOG.length + ' 种效果'}
    </button>}
  </>;
}

const definitions = new Map(EFFECT_CATALOG.map(definition => [definition.id, definition]));

function LayerParameters({layer, onChange}: Pick<Props,'onChange'> & {layer: EffectLayer}) {
  const value = layer.effect;
  const active = definitions.get(value.id);
  if (!active) return null;
  function change(patch: Partial<EffectSettings>, commit: boolean) {
    onChange(layer.id, {...value, ...patch}, commit);
  }
  return <>
    <Slider label="效果强度" min={0} max={100} step={1} value={value.strength} display={value.strength + '%'}
      onChange={(strength, commit) => change({strength}, commit)}/>
    <details className="effect-extra">
      <summary>调整{active.scaleLabel}{active.controls.length ? '与细节' : ''}</summary>
      <Slider label={active.scaleLabel} min={2} max={16} step={1} value={value.size} display={String(value.size)}
        onChange={(size, commit) => change({size}, commit)}/>
      {active.controls.map(control => <Parameter key={control.key} control={control}
        value={value.params[control.key] ?? control.value}
        onChange={next => change({params: {...value.params, [control.key]: next}}, true)}/>)}
      <button type="button" className="text-button" onClick={() => {
        const defaults = createEffect(value.id);
        if (defaults) onChange(layer.id, defaults, true);
      }}>恢复默认参数</button>
    </details>
  </>;
}

function LayerBrush(p: Props & {name: string}) {
  return <div className="layer-brush grouped-card">
    <div className="layer-brush-header">
      <strong>{p.name}</strong>
      <button type="button" className="btn" onClick={() => p.onBrushMode(null)}>完成擦除</button>
    </div>
    <div className="layer-brush-modes" role="group" aria-label="局部效果画笔">
      <button type="button" className="btn" aria-pressed={p.brushMode === 'erase'}
        onClick={() => p.onBrushMode('erase')}><Icon name="eraser" size={15}/>擦除本层</button>
      <button type="button" className="btn" aria-pressed={p.brushMode === 'restore'}
        onClick={() => p.onBrushMode('restore')}><Icon name="brush" size={15}/>恢复本层</button>
    </div>
    <Slider label="擦除笔刷大小" min={6} max={180} step={1} value={p.brushSize}
      display={Math.round(p.brushSize) + ' px'} onChange={size => p.onBrushSize(size)}/>
    <Slider label="擦除笔刷硬度" value={p.brushHardness} display={Math.round(p.brushHardness * 100) + '%'}
      onChange={value => p.onBrushHardness(value)}/>
    <p>{p.brushMode === 'erase' ? '在画布上涂抹，露出下面的图层。' : '在画布上涂抹，恢复这一层的效果。'}</p>
  </div>;
}

export default function EffectControls(p: Props) {
  const [adding, setAdding] = useState(false);
  const root = useRef<HTMLFieldSetElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const index = p.layers.findIndex(layer => layer.id === p.selectedId);
  const layer = p.layers[index];
  const name = layer ? definitions.get(layer.effect.id)?.name ?? layer.effect.id : '';
  const atLimit = p.layers.length >= MAX_EFFECT_LAYERS;
  const painting = Boolean(p.brushMode && layer);
  const library = !painting && (!p.layers.length || (adding && !atLimit));

  useLayoutEffect(() => {
    const panel = root.current?.closest('.inspector-scroll');
    if (panel) panel.scrollTop = 0;
  }, [library, painting]);

  // Reordering a deep stack should keep selection visible inside its list.
  useLayoutEffect(() => {
    const host = list.current;
    const row = host?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!host || !row) return;
    const bounds = host.getBoundingClientRect(), selected = row.getBoundingClientRect();
    if (selected.top < bounds.top) host.scrollTop += selected.top - bounds.top;
    else if (selected.bottom > bounds.bottom) host.scrollTop += selected.bottom - bounds.bottom;
  }, [index, library, painting]);

  return <fieldset ref={root} className="effect-controls" disabled={p.disabled} aria-label="图片效果">
    {painting && <LayerBrush {...p} name={name}/>}
    {library && <>
      <div className="effect-layer-heading">
        <strong>{p.layers.length ? '添加到顶部' : '添加第一层效果'}</strong>
        {!!p.layers.length && <button type="button" className="text-button"
          onClick={() => setAdding(false)}>返回图层</button>}
      </div>
      <EffectLibrary preview={p.preview ?? null} onPick={effect => { p.onAdd(effect); setAdding(false); }}/>
    </>}
    {!painting && !library && <>
      <div className="effect-layer-heading">
        <strong>效果层 <span>{p.layers.length}</span></strong>
        <button type="button" className="btn" onClick={() => setAdding(true)} disabled={atLimit}
          aria-label="添加效果层"><Icon name="plus" size={14}/>{atLimit ? '已达 ' + MAX_EFFECT_LAYERS + ' 层' : '添加效果层'}</button>
      </div>
      <ol ref={list} className="effect-stack grouped-card" aria-label="效果层，从顶层到底层" reversed>
        {p.layers.map((item, position) => {
          const title = definitions.get(item.effect.id)?.name ?? item.effect.id;
          return <li key={item.id}>
            <button type="button" aria-pressed={item.id === p.selectedId} onClick={() => p.onSelect(item.id)}
              aria-label={`选择第 ${position + 1} 层 ${title}`}>
              <span className="effect-layer-number">{position + 1}</span>
              <span className="effect-layer-name">{title}</span>
              {item.mask && <span className="effect-mask-mark" title="本层有擦除区域"><Icon name="eraser" size={13}/><span className="effect-sr">已局部擦除</span></span>}
              <span className="effect-layer-strength">{item.effect.strength}%</span>
            </button>
          </li>;
        }).reverse()}
      </ol>
      {layer && <>
        <div className="effect-layer-actions" role="group" aria-label="编辑选中图层">
          <button type="button" className="btn" aria-label="上移一层" disabled={index === p.layers.length - 1}
            onClick={() => p.onMove(layer.id, 1)}><Icon name="arrow" size={14} className="arrow-up"/>上移</button>
          <button type="button" className="btn" aria-label="下移一层" disabled={index === 0}
            onClick={() => p.onMove(layer.id, -1)}><Icon name="arrow" size={14} className="arrow-down"/>下移</button>
          <button type="button" className="btn effect-remove" aria-label="删除此层"
            onClick={() => p.onRemove(layer.id)}><Icon name="trash" size={14}/>删除</button>
        </div>
        <div className="effect-current grouped-card" key={layer.id}>
          <div className="effect-current-heading"><strong>{name}</strong>
            <button type="button" className="text-button" onClick={() => p.onBrushMode('erase')}>
              <Icon name="eraser" size={15}/>擦除本层
            </button>
          </div>
          <LayerParameters layer={layer} onChange={p.onChange}/>
        </div>
      </>}
    </>}
  </fieldset>;
}
