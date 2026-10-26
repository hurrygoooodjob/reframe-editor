import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useEditor } from './hooks/useEditor';
import CanvasEditor from './components/CanvasEditor';
import Inspector, { Slider } from './components/Inspector';
import LocalControls from './components/LocalControls';
import { useLocalTools } from './hooks/useLocalTools';
import AutoActions from './components/AutoActions';
import Icon from './components/Icon';
import type { Tool } from './types';
import balloon from './assets/balloon.jpg';
import astronaut from './assets/astronaut.jpg';

function Dialog({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}){
  const ref=useRef<HTMLDivElement>(null); const onCloseRef=useRef(onClose);onCloseRef.current=onClose;
  useEffect(()=>{const old=document.activeElement as HTMLElement|null;ref.current?.focus();const handle=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();onCloseRef.current();}if(e.key==='Tab'){const nodes=ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select');if(!nodes?.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};document.addEventListener('keydown',handle);return()=>{document.removeEventListener('keydown',handle);old?.focus();};},[]);
  return <div className="dialog-backdrop" onClick={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={ref} className={`dialog${wide?' wide':''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}><div className="dialog-header"><h2>{title}</h2><button className="btn-icon" aria-label="关闭对话框" onClick={onClose}><Icon name="close"/></button></div>{children}</div></div>;
}

const tools:{id:Tool;icon:string;label:string;key:string;short:string}[]=[{id:'transform',icon:'move',label:'整体调整',key:'V',short:'整体'},{id:'local',icon:'move',label:'局部塑形',key:'L',short:'局部'},{id:'protect',icon:'brush',label:'保护画笔',key:'B',short:'保护'},{id:'compress',icon:'compress',label:'压缩画笔',key:'C',short:'压缩'},{id:'erase',icon:'eraser',label:'擦除标记',key:'E',short:'擦除'},{id:'rectangle',icon:'rectangle',label:'矩形保护选区',key:'R',short:'框选'}];

export default function App(){
  const ed=useEditor();
  const local=useLocalTools(ed);
  const file=useRef<HTMLInputElement>(null),project=useRef<HTMLInputElement>(null),dragDepth=useRef(0);
  const [locked,setLocked]=useState(false),[brushSize,setBrushSize]=useState(42),[brushHardness,setBrushHardness]=useState(.45),[showMask,setShowMask]=useState(true),[compare,setCompare]=useState(false),[help,setHelp]=useState(false),[dragging,setDragging]=useState(false);
  const [panelMode,setPanelMode]=useState<'shape'|'local'|'selection'|'project'>('shape');
  const [panelOpen,setPanelOpen]=useState(false);
  const mobile=()=>window.matchMedia('(max-width: 760px), (max-width: 1000px) and (max-height: 500px)').matches;
  const maskStats=useMemo(()=>{let protect=0,compress=0;for(const v of ed.mask){if(v>0.1)protect++;if(v<-.1)compress++;}return{count:protect+compress,protect:ed.mask.length?protect/ed.mask.length:0,compress:ed.mask.length?compress/ed.mask.length:0};},[ed.mask]);
  const maskCount=maskStats.count;
  useEffect(()=>{ed.loadImage(balloon,'热气球.jpg');},[ed.loadImage]);
  useEffect(()=>{setCompare(false);},[ed.source]);
  useEffect(()=>{function key(e:KeyboardEvent){if(ed.autoBusy){if(e.key==='Escape'){e.preventDefault();ed.cancelAuto();}return;}if(help||ed.exporting||ed.exportImage||ed.projectFile)return;const node=e.target as HTMLElement;if(['INPUT','TEXTAREA','SELECT'].includes(node.tagName)||node.isContentEditable)return;
    if(e.metaKey||e.ctrlKey){if(e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)ed.redo();else ed.undo();}else if(e.key.toLowerCase()==='o'){e.preventDefault();file.current?.click();}else if(e.key.toLowerCase()==='e'){e.preventDefault();ed.exportPNG();}return;}
    if(e.key==='Escape'){setCompare(false);setPanelOpen(false);ed.setTool('transform');}else{const t=tools.find(t=>t.key.toLowerCase()===e.key.toLowerCase());if(t)selectTool(t.id);}
  }window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[ed,help]);
  const geometryLocked=ed.localEdits.some(e=>e.kind==='push'?Math.abs(e.dx)+Math.abs(e.dy)>.00001:Math.abs(e.scaleX-1)+Math.abs(e.scaleY-1)>.00001);
  function overallChange(patch:Parameters<typeof ed.changeSettings>[0],commit=false){if(geometryLocked){ed.notify('已有局部塑形，请先撤销或重置局部，再调整整体。');return;}ed.changeSettings(patch,commit);}
  function maskChange(mask:Float32Array){if(geometryLocked){ed.notify('已有局部塑形，请先撤销或重置局部，再编辑整体保护。');return;}ed.commitMask(mask);}
  const painting=['protect','compress','erase','rectangle'].includes(ed.tool);
  const selectionTools=<div className="selection-tools" role="group" aria-label="选区画笔">{tools.filter(t=>['protect','compress','erase','rectangle'].includes(t.id)).map(t=><button key={t.id} aria-label={t.label} aria-pressed={ed.tool===t.id} className={ed.tool===t.id?'is-active':''} onClick={()=>selectTool(t.id)}><Icon name={t.icon} size={16}/>{t.short}</button>)}</div>;
  function selectTool(tool:Tool){ed.setTool(tool);setCompare(false);setShowMask(true);setPanelMode(tool==='transform'?'shape':tool==='local'?'local':'selection');}
  function editMask(){selectTool('protect');setPanelOpen(true);}
  function openPanel(mode:'shape'|'local'|'selection'|'project'){
    setCompare(false);setPanelOpen(open=>mode===panelMode?!open:true);setPanelMode(mode);
    if(mode==='shape')ed.setTool('transform');
    if(mode==='local')ed.setTool('local');
    if(mode==='selection'&&!painting){ed.setTool('protect');setShowMask(true);}
  }
  function showComparison(value:boolean){setCompare(value);}
  function runAutomatic(random:boolean){if(geometryLocked){ed.notify('已有局部塑形，请先撤销或重置局部，再随机整体。');return;}setCompare(false);setShowMask(true);setPanelMode(random?'shape':'selection');if(random)ed.randomSqueeze();else ed.autoAnalyze();}
  return <div className={`app${panelOpen?' panel-open':''}`} onDragEnter={e=>{e.preventDefault();if(e.dataTransfer.types.includes('Files')){dragDepth.current++;setDragging(true);}}} onDragOver={e=>e.preventDefault()} onDragLeave={e=>{e.preventDefault();if(--dragDepth.current<=0)setDragging(false);}} onDrop={e=>{e.preventDefault();dragDepth.current=0;setDragging(false);const selected=e.dataTransfer.files[0];if(selected){if(/\.json$/i.test(selected.name))ed.loadProject(selected);else ed.importImage(selected);}}}>
    <input ref={file} type="file" aria-label="打开本地图片" accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp" onChange={e=>{const f=e.target.files?.[0];if(f)ed.importImage(f);e.target.value='';}}/>
    <input ref={project} type="file" aria-label="打开本地工程" accept=".json" onChange={e=>{const f=e.target.files?.[0];if(f)ed.loadProject(f);e.target.value='';}}/>
    <header className="header">
      <button className="btn header-open" onClick={()=>file.current?.click()}><Icon name="open" size={18}/><span>打开图片</span></button>
      <div className="brand"><span>Niuniu</span></div>
      <div className="header-actions"><button className="btn btn-primary" disabled={!ed.source||ed.exporting||ed.autoBusy||local.detectBusy} onClick={ed.exportPNG}><Icon name="download" size={18}/><span>{ed.exporting?'导出中…':'导出 PNG'}</span></button></div>
    </header>
    <div className="file-toolbar"><div className="file-info"><Icon name="image" size={15}/><span className="file-name">{ed.source?.name||'正在打开样例'}</span><span className="file-dimensions">{ed.source&&`${ed.source.image.width} × ${ed.source.image.height} 像素`}</span></div><div className="editor-actions"><button className="btn-icon" title="撤销 ⌘Z" aria-label="撤销" disabled={!ed.historyState.undo} onClick={ed.undo}><Icon name="undo" size={18}/></button><button className="btn-icon" title="重做 ⇧⌘Z" aria-label="重做" disabled={!ed.historyState.redo} onClick={ed.redo}><Icon name="redo" size={18}/></button><div className="action-divider"/><button className="btn-icon" aria-label="使用帮助" onClick={()=>setHelp(true)}><Icon name="help" size={18}/></button></div></div>
    <div className="workspace">
      <main className="editor" aria-label="图片编辑画布">
        <div className="canvas-toolbar"><span className="canvas-toolbar-label"><Icon name="image" size={15}/>{compare?'原始图片':painting?'原图 · 编辑保护区域':ed.tool==='local'?'局部塑形':'整体预览'}</span><button className={`btn compare-toggle${compare?' is-active':''}`} aria-pressed={compare} disabled={!ed.source} onClick={()=>showComparison(!compare)}><Icon name="compare" size={16}/>{compare?'返回编辑':'对比原图'}</button></div>
        {!compare&&<div className="context-controls">
          {painting?<>{selectionTools}<div className="brush-quick"><Slider label="画笔大小" value={brushSize} min={6} max={180} step={1} display={`${brushSize}px`} onChange={setBrushSize}/><Slider label="笔刷硬度" value={brushHardness} display={`${Math.round(brushHardness*100)}%`} onChange={setBrushHardness}/></div></>:ed.tool==='local'?<><LocalControls local={local} disabled={!ed.source||ed.busy} compact/><button className="text-button" onClick={()=>setPanelOpen(true)}>部位与参数</button></>:<button className="btn" disabled={ed.autoBusy||!ed.source} onClick={()=>runAutomatic(true)}>{ed.autoBusy?'正在分析…':'一键随机挤压'}</button>}
        </div>}
        {ed.source?<CanvasEditor geometryLocked={geometryLocked} source={ed.source} settings={ed.settings} result={ed.result} tool={compare?'transform':ed.tool} mask={ed.mask} maskSize={ed.maskSize} brushSize={brushSize} brushHardness={brushHardness} localMode={local.mode} localRadius={local.radius} localSoftness={local.softness} localTargets={local.targets} selectedLocalTarget={local.targetId} localFocus={local.active} onLocalTarget={local.select} onLocalPoint={local.point} onLocalPush={local.push} showMask={showMask} compare={compare} locked={locked} busy={ed.busy||ed.autoBusy} progress={ed.autoBusy?ed.autoProgress:ed.progress} onChange={overallChange} onMask={maskChange} onInteractionStart={()=>{ed.cancelAuto();if(local.detectBusy)local.cancel();}} onDone={()=>selectTool('transform')}/>:<div className="canvas-stage"><div className="drop-zone"><Icon name="image" size={38}/><h2>给图片一个新形状</h2><p>拖入图片，或从本地打开</p><button className="btn btn-primary" onClick={()=>file.current?.click()}>打开图片</button></div></div>}
        <div className="sample-strip"><span>试一试</span><button onClick={()=>ed.loadImage(balloon,'热气球.jpg')}><img src={balloon} alt=""/>热气球</button><button onClick={()=>ed.loadImage(astronaut,'宇航员.jpg')}><img src={astronaut} alt=""/>人像</button><span className="sample-note">所有编辑均在本地完成</span></div>
      </main>
      <div className="panel-host" id="editor-panel">{geometryLocked&&['shape','selection'].includes(panelMode)&&<div className="geometry-notice"><p>先整体，后局部。重新调整整体会改变部位位置。</p><button className="btn" onClick={()=>{ed.updateLocal([]);local.resetSelection();ed.notify('局部调整已重置，可撤销恢复。');}}>重置局部，调整整体</button></div>}<Inspector localControls={<LocalControls local={local} disabled={!ed.source||ed.busy||ed.autoBusy}/>} selectionTools={selectionTools} brushHardness={brushHardness} onBrushHardnessChange={setBrushHardness} mode={panelMode} onClose={()=>setPanelOpen(false)} onEditMask={editMask} protectRatio={maskStats.protect} compressRatio={maskStats.compress} autoControls={<AutoActions busy={ed.autoBusy} disabled={!ed.source||ed.exporting} info={ed.autoInfo} protectRatio={maskStats.protect} compressRatio={maskStats.compress} onRandom={()=>runAutomatic(true)} onAnalyze={()=>runAutomatic(false)} onEdit={editMask} onCancel={ed.cancelAuto} progress={ed.autoProgress}/>} settings={ed.settings} originalSize={ed.source?.image||{width:1280,height:850}} onChange={overallChange} locked={locked} onLockedChange={setLocked} brushSize={brushSize} onBrushSizeChange={setBrushSize} showMask={showMask} onShowMaskChange={setShowMask} onClearMask={()=>{if(geometryLocked)ed.notify('请先重置局部，再清空整体选区。');else ed.clearMask();}} onReset={()=>{ed.reset();setCompare(false);}} onSaveProject={ed.saveProject} onLoadProject={()=>project.current?.click()} maskCount={maskCount} busy={!ed.source||ed.exporting||ed.autoBusy||(geometryLocked&&panelMode!=='project'&&panelMode!=='local')}/></div>
    </div>
    <footer className="bottom-tabbar"><span className="local-note"><Icon name="shield" size={15}/>图片仅在设备中处理</span><nav className="tab-items" aria-label="编辑模式">
      {([{id:'shape',label:'整体',icon:'compress'},{id:'local',label:'局部',icon:'move'},{id:'selection',label:'保护',icon:'brush'},{id:'project',label:'更多',icon:'save'}] as const).map(t=><button key={t.id} className={`tab-button${panelMode===t.id?' is-active':''}`} aria-label={`${t.label}设置`} aria-pressed={panelMode===t.id} aria-controls="editor-panel" onClick={()=>openPanel(t.id)}><Icon name={t.icon} size={23}/><span>{t.label}</span></button>)}
    </nav><span className="output-note">{ed.settings.width} × {ed.settings.height} px<span>Niuniu · 自由塑形</span></span></footer>
    {ed.toast&&<div className="toast" role="status"><Icon name="check" size={15}/>{ed.toast}</div>}
    {ed.error&&<div className="error-banner" role="alert"><span>{ed.error}</span><button onClick={()=>ed.setError('')} aria-label="关闭错误提示"><Icon name="close" size={16}/></button></div>}
    {dragging&&<div className="drop-overlay"><Icon name="open" size={40}/><span>松开以打开图片或工程</span></div>}
    {help&&<Dialog title="Niuniu · 自由塑形" onClose={()=>setHelp(false)} wide><h3>整体</h3><p>拖动四边或四角改变尺寸；双指缩放与平移视图。随机挤压依据可压缩通道选择保守幅度，保留你选择的形状和柔和度。</p><h3>局部</h3><p>点图片选中区域，调整大小或展开宽高参数。定位五官与手臂会下载本地运行的识别模型；识别后点部位名称或画布标记。耳朵可直接点选并调整影响范围。自由推拉用单指拖动，双指移动视图。</p><p>局部操作只影响圈内并柔和过渡。目标部位可主动改变比例，极端幅度会受限制以减少折叠。自动识别不修改五官大小。</p><h3>保护</h3><p>原图上的绿色区域用于整体缩放时保留主体，橙色区域优先压缩。笔刷大小与硬度随时可调，擦除也有软边。保护选区不直接冻结局部塑形，局部调整请缩小影响范围。</p><h3>保存</h3><p>导出 PNG 从原图采样。更多中保存工程，保留原图、选区和局部操作，可打开旧版工程。页面没有自动保存，关闭前请保存工程。</p><p>所有图片在你的设备上处理。模型识别可能漏检，手动工具始终可用；非生成式塑形不能补出遮挡或极端放大的细节。</p></Dialog>}
    {ed.exporting&&<Dialog title="正在生成高清 PNG" onClose={ed.cancelExport}><p>{ed.progress.label} · {Math.round(ed.progress.value*100)}%</p><div className="export-progress"><div style={{width:`${ed.progress.value*100}%`}}/></div><p>直接从原图采样，保留透明边缘。</p><div className="dialog-actions"><button className="btn" onClick={ed.cancelExport}>取消导出</button></div></Dialog>}
    {ed.exportImage&&<Dialog title="图片已准备好" onClose={()=>ed.setExportImage(null)} wide><div className="export-preview"><img src={ed.exportImage.url} alt="导出的 PNG 预览"/></div><p className="export-info">{ed.exportImage.width} × {ed.exportImage.height} px · PNG · 透明背景</p>{ed.exportImage.warnings.map(w=><p key={w}>{w}</p>)}<div className="dialog-actions"><button className="btn" onClick={()=>ed.setExportImage(null)}>继续编辑</button><a className="btn btn-primary" href={ed.exportImage.url} download={ed.exportImage.name}><Icon name="download" size={16}/>保存 PNG</a></div></Dialog>}
    {ed.projectFile&&<Dialog title="保存可继续编辑的工程" onClose={()=>ed.setProjectFile(null)}><p>包含原始图片、所有参数和区域标记。下次使用「打开工程」即可恢复；也可以把工程文件直接拖入编辑器。</p><div className="dialog-actions"><button className="btn" onClick={()=>ed.setProjectFile(null)}>关闭</button><a className="btn btn-primary" href={ed.projectFile.url} download={ed.projectFile.name}><Icon name="save" size={16}/>保存工程文件</a></div></Dialog>}
  </div>;
}
