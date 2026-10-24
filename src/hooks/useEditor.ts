import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, SHAPES } from '../types';
import type { EditSettings, PixelImage, RenderResult, Tool, AutoSelectionInfo } from '../types';
import { decodeImage, readDataURL, imageToCanvas, cleanFilename, encodeMask, decodeMask, defaultOutputSize, isImageDataURL, MAX_OUTPUT_PIXELS, MAX_PROJECT_BYTES } from '../io';
import { startRender, startAutoAnalysis } from '../renderClient';
import { createRandomPlan } from '../autoPlan';

export interface SourceImage { image: PixelImage; url: string; name: string; }
interface Snapshot { settings: EditSettings; mask: Float32Array; autoInfo: AutoSelectionInfo | null; }
interface RestoredProject { settings: EditSettings; mask: Float32Array; maskSize: {width:number;height:number}; }
const isCancelled = (error: unknown) => error instanceof Error && error.name === 'AbortError';
export function useEditor() {
  const [source, setSource] = useState<SourceImage | null>(null);
  const [settings, setSettings] = useState<EditSettings>({...DEFAULT_SETTINGS, width:1280,height:850});
  const [mask, setMask] = useState<Float32Array>(() => new Float32Array(0));
  const [maskSize, setMaskSize] = useState({width:0,height:0});
  const [result, setResult] = useState<RenderResult | null>(null);
  const [tool, setTool] = useState<Tool>('transform');
  const [autoBusy,setAutoBusy]=useState(false);
  const [autoProgress,setAutoProgress]=useState({value:0,label:''});
  const [autoInfo,setAutoInfoState]=useState<AutoSelectionInfo|null>(null);
  const autoInfoRef=useRef<AutoSelectionInfo|null>(null);
  const autoTask=useRef<ReturnType<typeof startAutoAnalysis>|null>(null);
  const setAutoInfo=useCallback((value:AutoSelectionInfo|null)=>{autoInfoRef.current=value;setAutoInfoState(value);},[]);
  const cancelAuto=useCallback(()=>{const task=autoTask.current;autoTask.current=null;task?.cancel();setAutoBusy(false);},[]);
  const [busy,setBusy] = useState(false);
  const [previewProgress,setPreviewProgress] = useState({value:0,label:''});
  const [exportProgress,setExportProgress] = useState({value:0,label:''});
  const [error,setError] = useState('');
  const [toast,setToast] = useState('');
  const [revision,setRevision] = useState(0);
  const [exporting,setExporting] = useState(false);
  const [exportImage,setExportImage] = useState<{url:string;name:string;width:number;height:number;warnings:string[]}|null>(null);
  const [projectFile,setProjectFile] = useState<{url:string;name:string}|null>(null);
  const settingsRef = useRef(settings); settingsRef.current=settings;
  const history = useRef<Snapshot[]>([]);
  const historyIndex = useRef(-1);
  const exportTask = useRef<ReturnType<typeof startRender> | null>(null);
  const importToken = useRef(0);
  const [historyState,setHistoryState] = useState({undo:false,redo:false});
  const progress = exporting ? exportProgress : previewProgress;

  const syncHistory = () => setHistoryState({undo:historyIndex.current>0,redo:historyIndex.current<history.current.length-1});
  const record = useCallback((nextSettings:EditSettings, nextMask:Float32Array, replace=false) => {
    if (replace) {history.current=[];historyIndex.current=-1;}
    const current=history.current[historyIndex.current];
    if(current && JSON.stringify(current.settings)===JSON.stringify(nextSettings) && current.mask===nextMask && current.autoInfo===autoInfoRef.current) return;
    history.current=history.current.slice(0,historyIndex.current+1);
    history.current.push({settings:{...nextSettings},mask:nextMask,autoInfo:autoInfoRef.current});
    if(history.current.length>30) history.current.shift();
    historyIndex.current=history.current.length-1;syncHistory();
  },[]);

  const notify = useCallback((message:string)=>setToast(message),[]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),3600);return()=>clearTimeout(t);},[toast]);

  const cancelExport = useCallback(() => {
    const task = exportTask.current;
    exportTask.current = null;
    task?.cancel();
    setExporting(false);
  }, []);

  useEffect(() => () => {
    ++importToken.current;
    autoTask.current?.cancel();autoTask.current=null;
    exportTask.current?.cancel();
    exportTask.current = null;
  }, []);

  const beginImport = useCallback(() => {
    const token = ++importToken.current;
    cancelExport();cancelAuto();
    setError('');
    setExportImage(null);
    setProjectFile(null);
    return token;
  }, [cancelExport,cancelAuto]);

  // All entry points claim an import token before any FileReader/decode await.
  const applyImage = useCallback(async (url:string,name:string,token:number,restored?:RestoredProject) => {
    const image=await decodeImage(url);
    if(token!==importToken.current)return;
    if (restored) {
      const { width, height } = restored.maskSize;
      const expected = image.width >= image.height
        ? Math.max(1, Math.round(width * image.height / image.width))
        : Math.max(1, Math.round(height * image.width / image.height));
      const actual = image.width >= image.height ? height : width;
      if (Math.abs(actual - expected) > 1 || restored.mask.length !== width * height) {
        throw new Error('工程选区与原图比例不匹配。');
      }
    }
    // Vite asset/blob URLs are session-specific; persist their decoded pixels.
    const persistentURL = isImageDataURL(url) ? url : imageToCanvas(image).toDataURL('image/png');
    if (!isImageDataURL(persistentURL)) throw new Error('无法保存这张图片的像素，请使用较小的本地图片。');
    const scale=Math.min(1,512/Math.max(image.width,image.height));
    const size=restored?.maskSize||{width:Math.max(1,Math.round(image.width*scale)),height:Math.max(1,Math.round(image.height*scale))};
    const nextMask=restored?.mask||new Float32Array(size.width*size.height);
    const nextSettings=restored?.settings||{...DEFAULT_SETTINGS,...defaultOutputSize(image.width,image.height)};
    cancelExport();cancelAuto();setExportImage(null);setProjectFile(null);
    setSource({image,url:persistentURL,name});setMaskSize(size);setMask(nextMask);setSettings(nextSettings);settingsRef.current=nextSettings;
    setResult(null);setTool('transform');setAutoInfo(null);record(nextSettings,nextMask,true);
    notify(restored?'工程已恢复':nextSettings.width!==image.width||nextSettings.height!==image.height?'图片已打开，画布已适配输出尺寸上限':'图片已打开');
  },[record,notify,cancelExport,cancelAuto,setAutoInfo]);

  const loadImage = useCallback(async (url:string,name:string) => {
    const token=beginImport();
    try{
      await applyImage(url,name,token);
    }catch(e){if(token===importToken.current)setError(e instanceof Error?e.message:'无法打开这张图片。');}
  },[beginImport,applyImage]);

  const importImage = useCallback(async (file:File) => {
    const token=beginImport();
    try{
      if(!/^image\/(jpeg|png|webp|gif|avif|bmp)$/i.test(file.type) && !/\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(file.name))throw new Error('请选择 JPG、PNG、WebP、AVIF 或 GIF 图片。');
      const url=await readDataURL(file);
      if(token!==importToken.current)return;
      await applyImage(url,file.name,token);
    }catch(e){if(token===importToken.current)setError(e instanceof Error?e.message:'图片无法读取。');}
  },[beginImport,applyImage]);

  const changeSettings = useCallback((patch:Partial<EditSettings>,commit=false)=>{
    cancelAuto();
    const next={...settingsRef.current,...patch};
    next.width=Math.round(Math.max(32,Math.min(8192,Number(next.width)||32)));
    next.height=Math.round(Math.max(32,Math.min(8192,Number(next.height)||32)));
    for (const key of ['contentAmount','transitionSoftness','squeeze','protectStrength'] as const) next[key]=Number.isFinite(next[key])?Math.max(0,Math.min(1,next[key])):settingsRef.current[key];
    settingsRef.current=next;setSettings(next);
    if(commit)record(next,mask);
  },[mask,record,cancelAuto]);

  const commitMask = useCallback((nextMask:Float32Array)=>{
    cancelAuto();
    if(nextMask.length!==maskSize.width*maskSize.height)return;
    const committed = new Float32Array(nextMask.length);
    for(let i=0;i<nextMask.length;i++) committed[i]=Number.isFinite(nextMask[i])?Math.max(-1,Math.min(1,nextMask[i])):0;
    if(autoInfoRef.current)setAutoInfo({...autoInfoRef.current,edited:true});
    setMask(committed);record(settingsRef.current,committed);
  },[record,maskSize,cancelAuto,setAutoInfo]);
  const clearMask = useCallback(()=>{cancelAuto();setAutoInfo(null);const next=new Float32Array(mask.length);setMask(next);record(settingsRef.current,next);notify('选区已清空');},[mask.length,record,notify,cancelAuto,setAutoInfo]);
  const undo = useCallback(()=>{
    cancelAuto();
    if(historyIndex.current<=0)return;
    const snap=history.current[--historyIndex.current];settingsRef.current=snap.settings;setSettings(snap.settings);setMask(snap.mask);setAutoInfo(snap.autoInfo);syncHistory();
  },[cancelAuto,setAutoInfo]);
  const redo = useCallback(()=>{
    cancelAuto();
    if(historyIndex.current>=history.current.length-1)return;
    const snap=history.current[++historyIndex.current];settingsRef.current=snap.settings;setSettings(snap.settings);setMask(snap.mask);setAutoInfo(snap.autoInfo);syncHistory();
  },[cancelAuto,setAutoInfo]);
  const reset = useCallback(()=>{
    cancelAuto();setAutoInfo(null);
    if(!source)return;
    const next={...DEFAULT_SETTINGS,...defaultOutputSize(source.image.width,source.image.height)};
    const clean=new Float32Array(mask.length);settingsRef.current=next;setSettings(next);setMask(clean);setTool('transform');record(next,clean);notify('已恢复原始图片，可撤销');
  },[source,mask.length,record,notify,cancelAuto,setAutoInfo]);

  const automatic = useCallback(async (randomize:boolean)=>{
    if(!source||exportTask.current)return;
    cancelAuto();
    setAutoBusy(true);setAutoProgress({value:0,label:'正在分析图片'});setError('');
    const seed=crypto.getRandomValues(new Uint32Array(1))[0];
    let task:ReturnType<typeof startAutoAnalysis>|null=null;
    try{
      task=startAutoAnalysis({image:source.image,maskWidth:maskSize.width,maskHeight:maskSize.height,seed},(value,label)=>{if(autoTask.current===task)setAutoProgress({value,label});});
      autoTask.current=task;
      const selection=await task.promise;
      if(autoTask.current!==task)return;
      const nextSettings=randomize?createRandomPlan(source.image,settingsRef.current,seed):settingsRef.current;
      const info:AutoSelectionInfo={seed,confidence:selection.confidence,regionCount:selection.regionCount,warnings:selection.warnings,edited:false};
      setAutoInfo(info);setMask(selection.mask);settingsRef.current=nextSettings;setSettings(nextSettings);
      setTool(randomize?'transform':'protect');record(nextSettings,selection.mask);
      notify(randomize?'新方案已生成，可撤销或继续涂抹修改':selection.protectRatio+selection.compressRatio===0?'暂未找到可靠选区，可继续手动涂抹':'自动选区已生成，绿色保护、橙色优先压缩');
    }catch(e){if((!task||autoTask.current===task)&&!isCancelled(e))setError(e instanceof Error?e.message:'自动选区未完成。');}
    finally{if(autoTask.current===task){autoTask.current=null;setAutoBusy(false);}}
  },[source,maskSize,cancelAuto,record,notify,setAutoInfo]);

  useEffect(()=>{
    if(!source)return;
    let disposed=false;let task:ReturnType<typeof startRender>|null=null;
    setBusy(true);setPreviewProgress({value:0,label:'准备预览'});setError('');
    const timer=setTimeout(()=>{
      try {
        task=startRender({image:source.image,mask,maskWidth:maskSize.width,maskHeight:maskSize.height,settings,maxOutputEdge:900},(value,label)=>{if(!disposed)setPreviewProgress({value,label});});
        task.promise.then(data=>{if(!disposed){setResult(data);setBusy(false);}}).catch(e=>{if(!disposed){if(!isCancelled(e))setError(e instanceof Error?e.message:'预览失败');setBusy(false);}});
      } catch(e) { if(!disposed){setError(e instanceof Error?e.message:'预览无法启动');setBusy(false);} }
    },100);
    return()=>{disposed=true;clearTimeout(timer);task?.cancel();};
  },[source,mask,maskSize,settings,revision]);

  const exportPNG = useCallback(async()=>{
    if(!source||exportTask.current||autoTask.current)return;
    if(settings.width*settings.height>MAX_OUTPUT_PIXELS){setError('导出上限为 2400 万像素，请调小宽度或高度。');return;}
    setExporting(true);setError('');setExportImage(null);setExportProgress({value:0,label:'准备高清导出'});
    let task: ReturnType<typeof startRender> | null = null;
    try{
      task=startRender({image:source.image,mask,maskWidth:maskSize.width,maskHeight:maskSize.height,settings},(value,label)=>{
        if(exportTask.current===task)setExportProgress({value,label});
      });
      exportTask.current=task;
      const output=await task.promise;
      if(exportTask.current!==task)return;
      const url=imageToCanvas(output.image).toDataURL('image/png');
      if(!isImageDataURL(url))throw new Error('浏览器无法创建该尺寸的 PNG，请调小宽度或高度。');
      setExportImage({url,name:`${cleanFilename(source.name)}-折形-${settings.width}x${settings.height}.png`,width:output.image.width,height:output.image.height,warnings:output.warnings});
    }catch(e){if((!task||exportTask.current===task)&&!isCancelled(e))setError(e instanceof Error?e.message:'导出失败');}
    finally{if(exportTask.current===task){setExporting(false);exportTask.current=null;}}
  },[source,settings,mask,maskSize]);

  const saveProject = useCallback(()=>{
    if(!source)return;
    try {
      if(settings.width*settings.height>MAX_OUTPUT_PIXELS)throw new Error('工程输出超过 2400 万像素，请调小宽度或高度后保存。');
      const json=JSON.stringify({format:'reframe-project',version:1,name:source.name,image:source.url,settings,mask:{width:maskSize.width,height:maskSize.height,data:encodeMask(mask)}});
      const file=new Blob([json],{type:'application/json'});
      if(file.size>MAX_PROJECT_BYTES)throw new Error('工程文件超过 75 MB，请使用较小的图片。');
      const url=URL.createObjectURL(file);
      setProjectFile({url,name:`${cleanFilename(source.name)}.reframe.json`});
    } catch(e) { setError(e instanceof Error?e.message:'工程无法保存。'); }
  },[source,settings,mask,maskSize]);
  useEffect(()=>()=>{if(projectFile)URL.revokeObjectURL(projectFile.url);},[projectFile]);

  const loadProject = useCallback(async(file:File)=>{
    const token=beginImport();
    try{
      if(file.size>MAX_PROJECT_BYTES)throw new Error('工程文件过大，请使用 75 MB 以内的工程。');
      const data=JSON.parse(await file.text());
      if(token!==importToken.current)return;
      if(!data||data.format!=='reframe-project'||data.version!==1||typeof data.image!=='string'||!isImageDataURL(data.image))throw new Error('这不是有效的折形工程文件。');
      const s=data.settings;
      if(!s||!Number.isInteger(s.width)||!Number.isInteger(s.height)||s.width<32||s.height<32||s.width>8192||s.height>8192||s.width*s.height>MAX_OUTPUT_PIXELS||!SHAPES.some(shape=>shape.id===s.shape)||!['draft','balanced','fine'].includes(s.quality))throw new Error('工程参数不完整或输出尺寸超限。');
      for(const key of ['contentAmount','squeeze','protectStrength'])if(!Number.isFinite(s[key])||s[key]<0||s[key]>1)throw new Error('工程参数超出范围。');
      // Legacy projects retain their original seam appearance until adjusted.
      const transitionSoftness=s.transitionSoftness===undefined?0:s.transitionSoftness;
      if(!Number.isFinite(transitionSoftness)||transitionSoftness<0||transitionSoftness>1)throw new Error('工程柔和度参数超出范围。');
      if(typeof s.forwardEnergy!=='boolean')throw new Error('工程算法参数不完整。');
      const m=data.mask;
      if(!m||!Number.isInteger(m.width)||!Number.isInteger(m.height)||m.width<1||m.height<1||m.width>1024||m.height>1024||typeof m.data!=='string')throw new Error('工程选区尺寸无效。');
      const restoredSettings: EditSettings={width:s.width,height:s.height,shape:s.shape,quality:s.quality,contentAmount:s.contentAmount,transitionSoftness,squeeze:s.squeeze,protectStrength:s.protectStrength,forwardEnergy:s.forwardEnergy};
      await applyImage(data.image,typeof data.name==='string'?data.name.slice(0,250):'image.png',token,{settings:restoredSettings,mask:decodeMask(m.data,m.width*m.height),maskSize:{width:m.width,height:m.height}});
    }catch(e){if(token===importToken.current)setError(e instanceof Error?e.message:'工程无法读取。');}
  },[beginImport,applyImage]);

  return {source,settings,mask,maskSize,result,tool,setTool:(next:Tool)=>{cancelAuto();setTool(next);},busy,progress,error,setError,toast,notify,
    loadImage,importImage,changeSettings,commitMask,clearMask,undo,redo,historyState,reset,
    autoBusy,autoProgress,autoInfo,cancelAuto,autoAnalyze:()=>automatic(false),randomSqueeze:()=>automatic(true),
    exporting,exportPNG,cancelExport,exportImage,setExportImage,
    saveProject,loadProject,projectFile,setProjectFile,retry:()=>setRevision(v=>v+1)};
}
