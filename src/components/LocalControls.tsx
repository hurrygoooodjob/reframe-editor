import type { useLocalTools } from '../hooks/useLocalTools';
import { Slider } from './Inspector';
export default function LocalControls({local,disabled,compact=false}:{local:ReturnType<typeof useLocalTools>;disabled:boolean;compact?:boolean}){
 const a=local.active;
 return <div className={compact?'local-controls compact-controls':'local-controls'}>
  {!compact&&<><p className="field-note">点选部位调整比例，周围柔和过渡。</p><div className="local-detect"><button className="btn" disabled={disabled||local.detectBusy} onClick={()=>local.detect('face')}>定位五官</button><button className="btn" disabled={disabled||local.detectBusy} onClick={()=>local.detect('body')}>定位手臂</button></div><p className="field-note" role="status">{local.message}</p>{local.detectBusy&&<button className="text-button" onClick={local.cancel}>取消识别</button>}
  {local.targets.length>0&&<div className="target-chips">{local.targets.map(t=><button key={t.id} className={`chip${t.id===local.targetId?' is-active':''}`} onClick={()=>local.select(t.id)}>{t.label}</button>)}</div>}
  <div className="local-mode" role="group" aria-label="局部工具"><button className={local.mode==='scale'?'is-active':''} onClick={()=>local.setMode('scale')}>大小与比例</button><button className={local.mode==='push'?'is-active':''} onClick={()=>{local.resetSelection();local.setMode('push');}}>自由推拉</button></div></>}
  {a&&local.mode==='scale'?<><Slider label={local.axis==='width'?`${local.label}粗细`:`${local.label}大小`} value={a.scaleX} min={.5} max={1.8} step={.01} display={`${Math.round(a.scaleX*100)}%`} onChange={local.scale}/>
   {!compact&&<details className="advanced"><summary>比例与影响范围</summary><Slider label="局部宽度" value={a.scaleX} min={.5} max={1.8} step={.01} display={`${Math.round(a.scaleX*100)}%`} onChange={(v,c)=>local.change({scaleX:v},c)}/><Slider label="局部高度" value={a.scaleY} min={.5} max={1.8} step={.01} display={`${Math.round(a.scaleY*100)}%`} onChange={(v,c)=>local.change({scaleY:v},c)}/><Slider label="影响宽度" value={a.rx} min={.015} max={.5} step={.005} display={`${Math.round(a.rx*200)}%`} onChange={(v,c)=>local.change({rx:v},c)}/><Slider label="影响高度" value={a.ry} min={.015} max={.5} step={.005} display={`${Math.round(a.ry*200)}%`} onChange={(v,c)=>local.change({ry:v},c)}/><Slider label="局部柔和度" value={a.softness} display={`${Math.round(a.softness*100)}%`} onChange={(v,c)=>local.change({softness:v},c)}/><button className="text-button" onClick={local.remove}>移除此局部调整</button></details>}
  </>:<Slider label="影响范围" value={local.radius} min={40} max={300} step={2} display={`${local.radius} px`} onChange={v=>local.setRadius(v)}/>}
  {!compact&&!a&&<Slider label="局部柔和度" value={local.softness} display={`${Math.round(local.softness*100)}%`} onChange={v=>local.setSoftness(v)}/>}
  {!compact&&<p className="field-note">耳朵可直接点选后调整范围。手臂重叠或部位较小时，建议手动选点。局部调整只影响圈内，保护画笔用于整体缩放。</p>}
 </div>;
}
