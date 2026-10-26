import { useCallback, useEffect, useRef, useState } from 'react';
import type { useEditor } from './useEditor';
import type { LocalEdit } from '../localTypes';
import { constrainLocalPush } from '../localTypes';
import { detectParts, cancelDetection } from '../vision/client';
export interface LocalTarget {id:string;label:string;cx:number;cy:number;rx:number;ry:number;angle:number;axis?:'both'|'width';}
const uid=()=>crypto.randomUUID();
export function useLocalTools(ed:ReturnType<typeof useEditor>){
 const [targets,setTargets]=useState<LocalTarget[]>([]),[activeId,setActiveId]=useState<string|null>(null),[targetId,setTargetId]=useState<string|null>(null);
 const [label,setLabel]=useState('自由区域'),[axis,setAxis]=useState<'both'|'width'>('both');
 const [mode,setMode]=useState<'scale'|'push'>('scale'),[radius,setRadius]=useState(130),[softness,setSoftness]=useState(.7);
 const [detectBusy,setDetectBusy]=useState(false),[message,setMessage]=useState('点图片选择局部，或自动定位五官与手臂。');
 const request=useRef(0);
 const geometryKey=JSON.stringify(ed.settings);
 useEffect(()=>{++request.current;cancelDetection();setTargets([]);setActiveId(null);setTargetId(null);setDetectBusy(false);},[geometryKey,ed.mask]);
 const active=ed.localEdits.find(item=>item.id===activeId)||null;
 useEffect(()=>{++request.current;cancelDetection();setTargets([]);setActiveId(null);setTargetId(null);setDetectBusy(false);setMessage('点图片选择局部，或自动定位五官与手臂。');},[ed.source]);
 useEffect(()=>()=>{++request.current;cancelDetection();},[]);
 function choose(target:LocalTarget){
  const id=uid();setMode('scale');setActiveId(id);setTargetId(target.id);setLabel(target.label);setAxis(target.axis||'both');
  const keep=ed.localEdits.filter(e=>!(e.id===activeId&&e.kind==='scale'&&e.scaleX===1&&e.scaleY===1));
  ed.updateLocal([...keep,{id,kind:'scale',cx:target.cx,cy:target.cy,rx:target.rx,ry:target.ry,angle:target.angle,scaleX:1,scaleY:1,dx:0,dy:0,softness}]);
 }
 function point(p:{x:number;y:number},r:{x:number;y:number}){choose({id:uid(),label:'自由区域',cx:p.x,cy:p.y,rx:r.x,ry:r.y,angle:0});}
 function push(from:{x:number;y:number},to:{x:number;y:number},r:{x:number;y:number}){
  const id=uid();setActiveId(null);setTargetId(null);setTargets([]);
  const requested={id,kind:'push' as const,cx:from.x,cy:from.y,rx:r.x,ry:r.y,angle:0,scaleX:1,scaleY:1,dx:to.x-from.x,dy:to.y-from.y,softness};
  const bounded=constrainLocalPush(requested,ed.settings.width,ed.settings.height);ed.addLocal(bounded);
  if(Math.abs(bounded.dx-requested.dx)+Math.abs(bounded.dy-requested.dy)>.001)ed.notify('已限制本次推拉幅度，扩大影响范围可拉得更远。');
 }
 async function detect(kind:'face'|'body'){
  if(!ed.result||ed.busy||ed.autoBusy||ed.exporting)return;
  ed.cancelAuto();const token=++request.current;setDetectBusy(true);setMessage('正在准备识别…');
  try{
   const result=await detectParts(ed.result.image,kind,text=>{if(request.current===token)setMessage(text);});
   if(request.current!==token)return;
   setTargets(result.targets);setTargetId(null);setActiveId(null);
   setMessage(result.targets.length?`已找到 ${result.targets.length} 个部位，点选后调整。${result.warnings[0]||''}`:'没有找到可靠部位，点图片仍可自由塑形。');
  }catch(error){if(request.current===token)setMessage(error instanceof Error&&error.name==='AbortError'?'识别已取消，可直接点选塑形。':'识别暂不可用，可直接点选塑形。');}
  finally{if(request.current===token)setDetectBusy(false);}
 }
 const cancel=useCallback(()=>{++request.current;cancelDetection();setDetectBusy(false);setMessage('识别已取消，可直接点选塑形。');},[]);
 function scale(value:number,commit:boolean){if(active)ed.changeLocal(active.id,{scaleX:value,scaleY:axis==='width'?1:value},commit);if(commit)setTargets([]);}
 function change(patch:Partial<LocalEdit>,commit:boolean){if(active)ed.changeLocal(active.id,patch,commit);if(commit)setTargets([]);}
 return {targets,active,targetId,label,axis,mode,setMode,radius,setRadius,softness,setSoftness,detectBusy,message,detect,cancel,point,push,choose,
  select:(id:string)=>{const target=targets.find(t=>t.id===id);if(target)choose(target);},scale,change,
  remove:()=>{if(active)ed.removeLocal(active.id);setActiveId(null);setTargetId(null);},
  resetSelection:()=>{setActiveId(null);setTargetId(null);},
 };
}
