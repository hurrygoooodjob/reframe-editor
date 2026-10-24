import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { EditSettings, RenderResult, Tool } from '../types';
import type { SourceImage } from '../hooks/useEditor';
import Icon from './Icon';

interface Props {
  source: SourceImage; settings: EditSettings; result: RenderResult | null; tool: Tool;
  mask: Float32Array; maskSize: {width:number;height:number}; brushSize: number; showMask:boolean;
  compare:boolean; locked:boolean; busy:boolean; progress:{value:number;label:string};
  onChange:(patch:Partial<EditSettings>,commit?:boolean)=>void; onMask:(mask:Float32Array)=>void; onDone:()=>void; onInteractionStart:()=>void;
}
type Point={x:number;y:number};
type GestureContext={pointerId:number;source:SourceImage;mask:Float32Array;tool:Tool;compare:boolean;settings:EditSettings};
type Gesture=({kind:'paint';data:Float32Array;base:Float32Array;start:Point;last:Point}|{kind:'resize';start:Point;width:number;height:number;scale:number;axis:string;locked:boolean;last:{width:number;height:number}}|{kind:'pan';start:Point;origin:Point})&GestureContext;
type ResizeView={width:number;height:number;scale:number;pan:Point};

export default function CanvasEditor(p:Props) {
  const stage=useRef<HTMLDivElement>(null), wrap=useRef<HTMLDivElement>(null), pixels=useRef<HTMLCanvasElement>(null), overlay=useRef<HTMLCanvasElement>(null);
  const gesture=useRef<Gesture|null>(null);
  const latest=useRef(p);latest.current=p;
  const [space,setSpace]=useState({width:900,height:650}),[zoom,setZoom]=useState(1),[pan,setPan]=useState<Point>({x:0,y:0});
  const [resizeView,setResizeView]=useState<ResizeView|null>(null);
  const painting=p.tool!=='transform';
  const original=painting||p.compare;
  const width=original?p.source.image.width:p.settings.width, height=original?p.source.image.height:p.settings.height;
  // Leave room for the resize hit areas and size label without shrinking a
  // phone's canvas as aggressively as the desktop workspace.
  const compact=space.width<=760||space.height<=380;
  const insetX=compact?48:90,insetY=compact?(space.height<240?64:88):120;
  const fit=Math.min(Math.max(1,space.width-insetX)/width,Math.max(1,space.height-insetY)/height,1);
  // Keep the opposite corner stationary and the active handle under the pointer.
  // Auto-fit resumes once the resize gesture has ended.
  const scale=resizeView?.scale??Math.max(.001,fit)*zoom;
  const shownPan=resizeView?{x:resizeView.pan.x+(width-resizeView.width)*scale/2,y:resizeView.pan.y+(height-resizeView.height)*scale/2}:pan;
  const shown=original?p.source.image:(p.result?.image||p.source.image);
  useLayoutEffect(()=>{
    if(!stage.current)return;
    const observer=new ResizeObserver(entries=>{
      const r=entries[0].contentRect;
      // A rotating phone or opening settings moves the image under a finger.
      // Cancel that in-flight gesture before adopting the new canvas bounds.
      cancelGesture(true);
      setSpace({width:r.width,height:r.height});
    });
    observer.observe(stage.current);return()=>observer.disconnect();
  },[]);
  useLayoutEffect(()=>{cancelGesture(false);setPan({x:0,y:0});setZoom(1);},[p.source]);
  // External actions (undo, reset, tool changes, new images) invalidate the scratch
  // gesture. Never commit its old mask over the newer state.
  useLayoutEffect(()=>{
    const g=gesture.current;if(!g)return;
    const size=g.kind==='resize'?g.last:g.settings;
    const changedSettings=p.settings.width!==size.width||p.settings.height!==size.height
      ||(['contentAmount','transitionSoftness','shape','squeeze','protectStrength','forwardEnergy','quality'] as const).some(key=>p.settings[key]!==g.settings[key]);
    if(p.source!==g.source||p.mask!==g.mask||p.tool!==g.tool||p.compare!==g.compare||changedSettings)cancelGesture(false);
  },[p.source,p.mask,p.tool,p.compare,p.settings]);
  useEffect(()=>{
    function beforeShortcut(e:KeyboardEvent){
      if(!gesture.current)return;
      const key=e.key.toLowerCase(),modifier=e.metaKey||e.ctrlKey;
      if(key==='escape'||(modifier&&['z','o','e'].includes(key))||(!modifier&&!e.altKey&&['v','b','c','e','r'].includes(key)))cancelGesture(true);
    }
    // Capture runs before the app shortcut handler, so its undo/reset wins.
    document.addEventListener('keydown',beforeShortcut,true);
    const leaveWindow=()=>cancelGesture(true);
    const visibility=()=>{if(document.hidden)cancelGesture(true);};
    window.addEventListener('blur',leaveWindow);
    document.addEventListener('visibilitychange',visibility);
    return()=>{
      document.removeEventListener('keydown',beforeShortcut,true);
      window.removeEventListener('blur',leaveWindow);
      document.removeEventListener('visibilitychange',visibility);
    };
  },[]);
  useLayoutEffect(()=>{const c=pixels.current;if(!c)return;c.width=shown.width;c.height=shown.height;c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(shown.data),shown.width,shown.height),0,0);},[shown]);
  function paintOverlay(data:Float32Array) {
    const c=overlay.current;if(!c)return;const size=latest.current.maskSize;c.width=size.width;c.height=size.height;
    const rgba=new Uint8ClampedArray(data.length*4);
    for(let i=0;i<data.length;i++){const n=data[i],j=i*4;if(!n)continue;rgba[j]=n>0?28:242;rgba[j+1]=n>0?190:133;rgba[j+2]=n>0?141:49;rgba[j+3]=Math.round(Math.abs(n)*130);}
    c.getContext('2d')?.putImageData(new ImageData(rgba,c.width,c.height),0,0);
  }
  useLayoutEffect(()=>{if(painting)paintOverlay(p.mask);},[p.mask,p.maskSize,painting]);
  function releasePointer(pointerId:number){const target=stage.current;if(target?.hasPointerCapture(pointerId))target.releasePointerCapture(pointerId);}
  function cancelGesture(restoreResize:boolean){
    const g=gesture.current;if(!g)return;
    gesture.current=null;setResizeView(null);releasePointer(g.pointerId);
    const current=latest.current;
    if(g.kind==='paint')paintOverlay(current.mask);
    else if(g.kind==='resize'&&restoreResize&&current.source===g.source&&current.mask===g.mask)
      current.onChange({width:g.width,height:g.height},false);
  }
  function context(pointerId:number):GestureContext{return{pointerId,source:p.source,mask:p.mask,tool:p.tool,compare:p.compare,settings:p.settings};}
  function maskPoint(e:ReactPointerEvent):Point {const r=wrap.current!.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*p.maskSize.width,y:(e.clientY-r.top)/r.height*p.maskSize.height};}
  function stamp(data:Float32Array,at:Point,tool:Tool) {
    const r=wrap.current!.getBoundingClientRect();const rx=p.brushSize/2*p.maskSize.width/r.width,ry=p.brushSize/2*p.maskSize.height/r.height;
    for(let y=Math.max(0,Math.floor(at.y-ry));y<Math.min(p.maskSize.height,Math.ceil(at.y+ry));y++)for(let x=Math.max(0,Math.floor(at.x-rx));x<Math.min(p.maskSize.width,Math.ceil(at.x+rx));x++)if(((x+.5-at.x)/rx)**2+((y+.5-at.y)/ry)**2<=1)data[y*p.maskSize.width+x]=tool==='erase'?0:tool==='compress'?-1:1;
  }
  function draw(g:Extract<Gesture,{kind:'paint'}>,point:Point){
    if(g.tool==='rectangle'){
      g.data.set(g.base);const x0=Math.max(0,Math.floor(Math.min(g.start.x,point.x))),x1=Math.min(p.maskSize.width,Math.ceil(Math.max(g.start.x,point.x))),y0=Math.max(0,Math.floor(Math.min(g.start.y,point.y))),y1=Math.min(p.maskSize.height,Math.ceil(Math.max(g.start.y,point.y)));
      for(let y=y0;y<y1;y++)g.data.fill(1,y*p.maskSize.width+x0,y*p.maskSize.width+x1);
    }else{const distance=Math.hypot(point.x-g.last.x,point.y-g.last.y),steps=Math.max(1,Math.ceil(distance/1.5));for(let i=1;i<=steps;i++)stamp(g.data,{x:g.last.x+(point.x-g.last.x)*i/steps,y:g.last.y+(point.y-g.last.y)*i/steps},g.tool);}
    g.last=point;paintOverlay(g.data);
  }
  function down(e:ReactPointerEvent<HTMLDivElement>){
    if(e.button!==0||!e.isPrimary||gesture.current)return;
    if(painting&&e.target===overlay.current){p.onInteractionStart();const point=maskPoint(e),data=new Float32Array(p.mask);gesture.current={...context(e.pointerId),kind:'paint',data,base:p.mask,start:point,last:point};if(p.tool!=='rectangle')stamp(data,point,p.tool);paintOverlay(data);}
    else if(!painting)gesture.current={...context(e.pointerId),kind:'pan',start:{x:e.clientX,y:e.clientY},origin:pan};else return;
    e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();
  }
  function resize(e:ReactPointerEvent<HTMLButtonElement>,axis:string){
    e.stopPropagation();if(e.button!==0||!e.isPrimary||gesture.current)return;e.preventDefault();
    p.onInteractionStart();
    const size={width:p.settings.width,height:p.settings.height};
    gesture.current={...context(e.pointerId),kind:'resize',start:{x:e.clientX,y:e.clientY},...size,scale,axis,locked:p.locked,last:size};
    setResizeView({...size,scale,pan});stage.current?.setPointerCapture(e.pointerId);
  }
  function move(e:ReactPointerEvent<HTMLDivElement>){const g=gesture.current;if(!g||g.pointerId!==e.pointerId)return;
    if(g.kind==='paint'){draw(g,maskPoint(e));return;}
    if(g.kind==='pan'){setPan({x:g.origin.x+e.clientX-g.start.x,y:g.origin.y+e.clientY-g.start.y});return;}
    let w=g.width+(g.axis==='bottom'?0:(e.clientX-g.start.x)/g.scale),h=g.height+(g.axis==='right'?0:(e.clientY-g.start.y)/g.scale);
    if(g.locked){
      const factor=g.axis==='bottom'?h/g.height:g.axis==='right'?w/g.width:Math.abs(w/g.width-1)>=Math.abs(h/g.height-1)?w/g.width:h/g.height;
      const bounded=Math.max(Math.max(32/g.width,32/g.height),Math.min(Math.min(8192/g.width,8192/g.height),factor));
      w=g.width*bounded;h=g.height*bounded;
    }
    g.last={width:Math.max(32,Math.min(8192,Math.round(w))),height:Math.max(32,Math.min(8192,Math.round(h)))};p.onChange(g.last,false);
  }
  function up(e:ReactPointerEvent<HTMLDivElement>){const g=gesture.current;if(!g||g.pointerId!==e.pointerId)return;
    move(e);gesture.current=null;setResizeView(null);
    // Clear the gesture before releasing capture: lostpointercapture must not
    // commit or roll back a stroke that has already completed.
    releasePointer(e.pointerId);
    if(g.kind==='paint'){if(g.data.some((value,i)=>value!==g.base[i]))p.onMask(g.data);}
    else if(g.kind==='resize')p.onChange(g.last,true);
  }
  function cancel(e:ReactPointerEvent<HTMLDivElement>){if(gesture.current?.pointerId===e.pointerId)cancelGesture(true);}
  function changeZoom(factor:number){cancelGesture(true);setZoom(z=>Math.max(.25,Math.min(4,z*factor)));}
  function fitView(){cancelGesture(true);setZoom(1);setPan({x:0,y:0});}
  return <>
    <div ref={stage} className="canvas-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={cancel}>
      <div ref={wrap} className={`canvas-wrap${!original?' has-handles':''}${painting?' is-painting':''}`} style={{width:width*scale,height:height*scale,transform:`translate(${shownPan.x}px, ${shownPan.y}px)`}}>
        <canvas ref={pixels} className="canvas-image" aria-label={original?'原始图片':'编辑结果'} role="img" />
        {painting&&<canvas ref={overlay} className="mask-canvas" style={{opacity:p.showMask?1:0}} aria-label="区域绘制画布" />}
        {!original&&['right','bottom','corner'].map(axis=><button key={axis} className={`resize-handle ${axis}`} aria-label={axis==='right'?'拖动调整宽度':axis==='bottom'?'拖动调整高度':'拖动调整宽高'} onPointerDown={e=>resize(e,axis)} />)}
        <span className="canvas-size-label">{width} × {height}</span>
      </div>
      {painting?<div className={`canvas-message ${p.tool==='compress'?'compress':'protect'}`}><Icon name={p.tool==='erase'?'eraser':'shield'} size={14}/><span>原图选区 · {p.tool==='protect'?'涂抹要保护的主体':p.tool==='compress'?'涂抹可优先压缩的区域':p.tool==='erase'?'擦除已有标记':'拖动框选要保护的区域'}</span><button className="text-button" onClick={p.onDone}>完成选区</button></div>:p.compare?<div className="canvas-badge"><Icon name="compare" size={14}/>正在查看原图</div>:<div className="canvas-badge"><span className="local-indicator">本地处理</span></div>}
      {p.busy&&<div className="progress" role="status"><span className="spinner"/><span>{p.progress.label||'正在处理'}</span><div className="progress-track"><div className="progress-bar" style={{width:`${Math.max(3,p.progress.value*100)}%`}}/></div></div>}
    </div>
    <div className="statusbar"><span className="status-text">{painting?'绿色保护 · 橙色优先压缩':p.result?.warnings[0]||'拖动边缘改变尺寸，拖动画面平移'}</span><div className="zoom-controls" role="group" aria-label="画布缩放"><button className="btn-icon" title="缩小视图" aria-label="缩小视图" disabled={zoom<=.25} onClick={()=>changeZoom(1/1.25)}><Icon name="minus" size={15}/></button><span className="zoom-value">{Math.round(scale*100)}%</span><button className="btn-icon" title="放大视图" aria-label="放大视图" disabled={zoom>=4} onClick={()=>changeZoom(1.25)}><Icon name="plus" size={15}/></button><button className="btn-icon" title="适应窗口" aria-label="适应窗口" onClick={fitView}><Icon name="fit" size={16}/></button></div></div>
  </>;
}
