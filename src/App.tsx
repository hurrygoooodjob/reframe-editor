import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useEditor } from './hooks/useEditor';
import CanvasEditor from './components/CanvasEditor';
import Inspector from './components/Inspector';
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

const tools:{id:Tool;icon:string;label:string;key:string;short:string}[]=[{id:'transform',icon:'move',label:'变形与平移',key:'V',short:'变形'},{id:'protect',icon:'brush',label:'保护画笔',key:'B',short:'保护'},{id:'compress',icon:'compress',label:'压缩画笔',key:'C',short:'压缩'},{id:'erase',icon:'eraser',label:'擦除标记',key:'E',short:'擦除'},{id:'rectangle',icon:'rectangle',label:'矩形保护选区',key:'R',short:'框选'}];

export default function App(){
  const ed=useEditor();
  const file=useRef<HTMLInputElement>(null),project=useRef<HTMLInputElement>(null),dragDepth=useRef(0);
  const [locked,setLocked]=useState(false),[brushSize,setBrushSize]=useState(42),[showMask,setShowMask]=useState(true),[compare,setCompare]=useState(false),[help,setHelp]=useState(false),[dragging,setDragging]=useState(false);
  const [panelMode,setPanelMode]=useState<'shape'|'selection'|'project'>('shape');
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
  function selectTool(tool:Tool){ed.setTool(tool);setCompare(false);setShowMask(true);setPanelMode(tool==='transform'?'shape':'selection');if(mobile())setPanelOpen(false);}
  function editMask(){selectTool(ed.tool==='transform'?'protect':ed.tool);}
  function openPanel(mode:'shape'|'selection'|'project'){
    setCompare(false);
    setPanelOpen(open=>mode===panelMode?!open:true);
    setPanelMode(mode);
    if(mode==='shape'&&!ed.autoBusy&&ed.tool!=='transform')ed.setTool('transform');
    if(mode==='selection'&&!ed.autoBusy&&ed.tool==='transform'){ed.setTool('protect');setShowMask(true);}
  }
  function showComparison(value:boolean){ed.setTool('transform');setCompare(value);if(mobile())setPanelOpen(false);}
  function runAutomatic(random:boolean){setCompare(false);setShowMask(true);if(mobile())setPanelOpen(false);setPanelMode(random?'shape':'selection');if(random)ed.randomSqueeze();else ed.autoAnalyze();}
  return <div className={`app${panelOpen?' panel-open':''}`} onDragEnter={e=>{e.preventDefault();if(e.dataTransfer.types.includes('Files')){dragDepth.current++;setDragging(true);}}} onDragOver={e=>e.preventDefault()} onDragLeave={e=>{e.preventDefault();if(--dragDepth.current<=0)setDragging(false);}} onDrop={e=>{e.preventDefault();dragDepth.current=0;setDragging(false);const selected=e.dataTransfer.files[0];if(selected){if(/\.json$/i.test(selected.name))ed.loadProject(selected);else ed.importImage(selected);}}}>
    <input ref={file} type="file" aria-label="打开本地图片" accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp" onChange={e=>{const f=e.target.files?.[0];if(f)ed.importImage(f);e.target.value='';}}/>
    <input ref={project} type="file" aria-label="打开本地工程" accept=".json" onChange={e=>{const f=e.target.files?.[0];if(f)ed.loadProject(f);e.target.value='';}}/>
    <header className="header">
      <button className="btn header-open" onClick={()=>file.current?.click()}><Icon name="open" size={18}/><span>打开图片</span></button>
      <div className="brand"><span>折形</span><span className="brand-en">Reframe</span></div>
      <div className="header-actions"><button className="btn btn-primary" disabled={!ed.source||ed.exporting||ed.autoBusy} onClick={ed.exportPNG}><Icon name="download" size={18}/><span>{ed.exporting?'导出中…':'导出 PNG'}</span></button></div>
    </header>
    <div className="file-toolbar"><div className="file-info"><Icon name="image" size={15}/><span className="file-name">{ed.source?.name||'正在打开样例'}</span><span className="file-dimensions">{ed.source&&`${ed.source.image.width} × ${ed.source.image.height} 像素`}</span></div><div className="editor-actions"><button className="btn-icon" title="撤销 ⌘Z" aria-label="撤销" disabled={!ed.historyState.undo} onClick={ed.undo}><Icon name="undo" size={18}/></button><button className="btn-icon" title="重做 ⇧⌘Z" aria-label="重做" disabled={!ed.historyState.redo} onClick={ed.redo}><Icon name="redo" size={18}/></button><div className="action-divider"/><button className="btn-icon" aria-label="使用帮助" onClick={()=>setHelp(true)}><Icon name="help" size={18}/></button></div></div>
    <div className="workspace">
      <main className="editor" aria-label="图片编辑画布">
        <div className="canvas-toolbar"><span className="canvas-toolbar-label"><Icon name="image" size={15}/>图片预览</span><div className="preview-segment" aria-label="原图与编辑预览"><button className={compare?'is-active':''} aria-pressed={compare} disabled={!ed.source} onClick={()=>showComparison(true)}>原图</button><button className={!compare?'is-active':''} aria-pressed={!compare} disabled={!ed.source} onClick={()=>showComparison(false)}>编辑预览</button></div></div>
        <nav className="tool-rail" aria-label="编辑工具">{tools.map(t=><button key={t.id} className={`tool-button ${t.id}${ed.tool===t.id&&!compare?' is-active':''}`} title={`${t.label} (${t.key})`} aria-label={t.label} aria-pressed={ed.tool===t.id&&!compare} onClick={()=>selectTool(t.id)} disabled={!ed.source}><Icon name={t.icon} size={21}/><span>{t.short}</span></button>)}</nav>
        {ed.source?<CanvasEditor source={ed.source} settings={ed.settings} result={ed.result} tool={ed.tool} mask={ed.mask} maskSize={ed.maskSize} brushSize={brushSize} showMask={showMask} compare={compare} locked={locked} busy={ed.busy||ed.autoBusy} progress={ed.autoBusy?ed.autoProgress:ed.progress} onChange={ed.changeSettings} onMask={ed.commitMask} onInteractionStart={ed.cancelAuto} onDone={()=>selectTool('transform')}/>:<div className="canvas-stage"><div className="drop-zone"><Icon name="image" size={38}/><h2>给图片一个新形状</h2><p>拖入图片，或从本地打开</p><button className="btn btn-primary" onClick={()=>file.current?.click()}>打开图片</button></div></div>}
        <div className="sample-strip"><span>试一试</span><button onClick={()=>ed.loadImage(balloon,'热气球.jpg')}><img src={balloon} alt=""/>热气球</button><button onClick={()=>ed.loadImage(astronaut,'宇航员.jpg')}><img src={astronaut} alt=""/>人像</button><span className="sample-note">所有编辑均在本地完成</span></div>
      </main>
      <div className="panel-host" id="editor-panel"><Inspector mode={panelMode} onClose={()=>setPanelOpen(false)} onEditMask={editMask} protectRatio={maskStats.protect} compressRatio={maskStats.compress} autoControls={<AutoActions busy={ed.autoBusy} disabled={!ed.source||ed.exporting} info={ed.autoInfo} protectRatio={maskStats.protect} compressRatio={maskStats.compress} onRandom={()=>runAutomatic(true)} onAnalyze={()=>runAutomatic(false)} onEdit={editMask} onCancel={ed.cancelAuto} progress={ed.autoProgress}/>} settings={ed.settings} originalSize={ed.source?.image||{width:1280,height:850}} onChange={ed.changeSettings} locked={locked} onLockedChange={setLocked} brushSize={brushSize} onBrushSizeChange={setBrushSize} showMask={showMask} onShowMaskChange={setShowMask} onClearMask={ed.clearMask} onReset={()=>{ed.reset();setCompare(false);}} onSaveProject={ed.saveProject} onLoadProject={()=>project.current?.click()} maskCount={maskCount} busy={!ed.source||ed.exporting||ed.autoBusy}/></div>
    </div>
    <footer className="bottom-tabbar"><span className="local-note"><Icon name="shield" size={15}/>图片仅在你的设备中处理</span><nav className="tab-items" aria-label="编辑面板">
      <button className={`tab-button${!compare&&panelMode==='shape'?' is-active':''}`} aria-label="塑形设置" aria-pressed={!compare&&panelMode==='shape'} aria-controls="editor-panel" onClick={()=>openPanel('shape')}><Icon name="compress" size={23}/><span>塑形</span></button>
      <button className={`tab-button${!compare&&panelMode==='selection'?' is-active':''}`} aria-label="选区设置" aria-pressed={!compare&&panelMode==='selection'} aria-controls="editor-panel" onClick={()=>openPanel('selection')}><Icon name="brush" size={23}/><span>选区</span></button>
      <button className={`tab-button${compare?' is-active':''}`} aria-label="对比原图" aria-pressed={compare} disabled={!ed.source} onClick={()=>showComparison(!compare)}><Icon name="compare" size={23}/><span>对比</span></button>
      <button className={`tab-button${!compare&&panelMode==='project'?' is-active':''}`} aria-label="工程设置" aria-pressed={!compare&&panelMode==='project'} aria-controls="editor-panel" onClick={()=>openPanel('project')}><Icon name="save" size={23}/><span>工程</span></button>
    </nav><span className="output-note">{ed.settings.width} × {ed.settings.height} px<span>经典触感 · 自由塑形</span></span></footer>
    {ed.toast&&<div className="toast" role="status"><Icon name="check" size={15}/>{ed.toast}</div>}
    {ed.error&&<div className="error-banner" role="alert"><span>{ed.error}</span><button onClick={()=>ed.setError('')} aria-label="关闭错误提示"><Icon name="close" size={16}/></button></div>}
    {dragging&&<div className="drop-overlay"><Icon name="open" size={40}/><span>松开以打开图片或工程</span></div>}
    {help&&<Dialog title="让图片适应你的布局" onClose={()=>setHelp(false)} wide><p>点击「一键随机挤压」，自动生成选区与缩放尺寸，保留当前形状、挤压强度和柔和度。想先检查选区，可以点击「仅识别选区」。</p><h3>自动后也能手动修改</h3><p>「查看 / 微调」会显示原图上的绿色保护区和橙色压缩区，原有画笔、框选与橡皮擦均可继续使用。「再随机一次」重新生成选区和变形参数，始终依据原图；一次撤销即可恢复整组操作。</p><p>自动判断依据颜色显著性、边缘和纹理，复杂画面可能漏选或误选。重新识别会替换现有标记，可先保存工程。</p><h3>手机上编辑</h3><p>底部「塑形」「选区」「工程」打开对应设置，再点一次或点击「收起」回到完整画布。选择画笔后用单指涂抹，变形工具用单指平移。用加减按钮缩放，再点「适应窗口」回到完整图片。</p><h3>1 · 标记区域</h3><p>绿色画笔和矩形框保护主体；橙色画笔指定可优先压缩的背景。标记时显示原图，点击「完成选区」查看结果。橡皮擦可修正选区。</p><h3>2 · 改变尺寸与轮廓</h3><p>拖动画布右侧、底部或右下角，或输入精确尺寸。智能缩放强度为 0 时均匀拉伸，为 100% 时优先压缩低能量区域。「过渡柔和度」控制挤压区域之间的平滑衔接，默认65%，设为0恢复原始接缝。形状挤压强度为 0 时裁切，为 100% 时把内容压入轮廓。</p><h3>3 · 保存结果</h3><p>「导出 PNG」保留形状外的透明区域。保存工程可保留原图、参数和选区；撤销记录仅保留在当前会话。</p><h3>适用范围</h3><p>主体周围留有天空、墙面等空白时效果更好。密集人群、文字和规则线条在大幅变形时仍可能扭曲。区域保护是软约束，形状尖端和极窄尺寸无法保证主体完全不变形。</p><div className="help-row"><span>变形 / 保护 / 压缩 / 擦除 / 框选</span><span><kbd>V</kbd> <kbd>B</kbd> <kbd>C</kbd> <kbd>E</kbd> <kbd>R</kbd></span></div><div className="help-row"><span>撤销 / 重做</span><span><kbd>⌘ / Ctrl Z</kbd> / <kbd>⇧ Z</kbd></span></div><p className="privacy-note">图片不会上传服务器。支持单张不超过 4000 万像素、50 MB 的图片，导出上限 2400 万像素；动图读取第一帧。示例照片分别采用 CC0 和 NASA 公共领域素材。</p></Dialog>}
    {ed.exporting&&<Dialog title="正在生成高清 PNG" onClose={ed.cancelExport}><p>{ed.progress.label} · {Math.round(ed.progress.value*100)}%</p><div className="export-progress"><div style={{width:`${ed.progress.value*100}%`}}/></div><p>直接从原图采样，保留透明边缘。</p><div className="dialog-actions"><button className="btn" onClick={ed.cancelExport}>取消导出</button></div></Dialog>}
    {ed.exportImage&&<Dialog title="图片已准备好" onClose={()=>ed.setExportImage(null)} wide><div className="export-preview"><img src={ed.exportImage.url} alt="导出的 PNG 预览"/></div><p className="export-info">{ed.exportImage.width} × {ed.exportImage.height} px · PNG · 透明背景</p>{ed.exportImage.warnings.map(w=><p key={w}>{w}</p>)}<div className="dialog-actions"><button className="btn" onClick={()=>ed.setExportImage(null)}>继续编辑</button><a className="btn btn-primary" href={ed.exportImage.url} download={ed.exportImage.name}><Icon name="download" size={16}/>保存 PNG</a></div></Dialog>}
    {ed.projectFile&&<Dialog title="保存可继续编辑的工程" onClose={()=>ed.setProjectFile(null)}><p>包含原始图片、所有参数和区域标记。下次使用「打开工程」即可恢复；也可以把工程文件直接拖入编辑器。</p><div className="dialog-actions"><button className="btn" onClick={()=>ed.setProjectFile(null)}>关闭</button><a className="btn btn-primary" href={ed.projectFile.url} download={ed.projectFile.name}><Icon name="save" size={16}/>保存工程文件</a></div></Dialog>}
  </div>;
}
