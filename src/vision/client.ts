import workerSource from './generated-worker';
import type { PixelImage } from '../types';
import type { DetectionKind, PartDetection } from './types';
export type { PartTarget, PartDetection, DetectionKind } from './types';

let worker:Worker|null=null,workerURL:string|null=null,sequence=0;
type Pending={id:number;reject:(error:Error)=>void;resolve:(result:PartDetection)=>void;progress?:(label:string)=>void;timer:ReturnType<typeof setTimeout>};
let pending:Pending|null=null;
const cache=new WeakMap<PixelImage,Partial<Record<DetectionKind,PartDetection>>>();
const aborted=()=>new DOMException('已取消部位识别','AbortError');

function stopWorker(){worker?.terminate();worker=null;if(workerURL)URL.revokeObjectURL(workerURL);workerURL=null;}
export function cancelDetection(){
  if(!pending)return;
  const task=pending;pending=null;clearTimeout(task.timer);stopWorker();task.reject(aborted());
}
export function disposeDetection(){cancelDetection();stopWorker();}
function copyResult(result:PartDetection):PartDetection{return{targets:result.targets.map(t=>({...t})),warnings:[...result.warnings],protection:result.protection?{...result.protection,mask:new Float32Array(result.protection.mask)}:undefined};}

function ensureWorker(){
  if(worker)return worker;
  if(typeof Worker==='undefined')throw new Error('此浏览器无法运行自动定位，可直接点选图片塑形。');
  workerURL=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
  try{worker=new Worker(workerURL);}catch(error){stopWorker();throw error;}
  worker.onmessage=({data})=>{
    if(!pending||data.id!==pending.id)return;
    if(data.type==='progress'){pending.progress?.(data.label);return;}
    const task=pending;pending=null;clearTimeout(task.timer);
    if(data.type==='result')task.resolve(data.result);
    else{
      stopWorker();
      task.reject(new Error('自动定位未完成。请检查模型文件是否完整，或直接点选部位继续。'));
    }
  };
  worker.onerror=()=>{const task=pending;pending=null;stopWorker();if(task){clearTimeout(task.timer);task.reject(new Error('当前浏览器未能加载自动定位，可点选部位继续编辑。'));}};
  return worker;
}

/** Images remain on-device. Resources are resolved from the page directory, including GitHub Pages subpaths. */
export async function detectParts(image:PixelImage,kind:DetectionKind,progress?:(label:string)=>void):Promise<PartDetection>{
  cancelDetection();
  if(!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||image.width<1||image.height<1||image.width*image.height>40_000_000||image.data.length!==image.width*image.height*4)throw new Error('用于识别的图片数据不完整。');
  const cached=cache.get(image)?.[kind];if(cached){progress?.('已读取这张图片的定位结果');return copyResult(cached);}
  if(location.protocol==='file:')throw new Error('自动定位需要通过本地启动器或在线网址打开；点选塑形仍可直接使用。');
  const taskWorker=ensureWorker(),id=++sequence;
  const base=new URL('.',document.baseURI).href;
  const result=await new Promise<PartDetection>((resolve,reject)=>{
    const timer=setTimeout(()=>{if(pending?.id!==id)return;pending=null;stopWorker();reject(new Error('自动定位耗时较长，已停止。你可以重试或点选部位继续。'));},90_000);
    pending={id,resolve,reject,progress,timer};
    // Transfer a private copy: never detach the editor's source pixels.
    const data=new Uint8ClampedArray(image.data);
    taskWorker.postMessage({id,kind,image:{width:image.width,height:image.height,data},base},[data.buffer]);
  });
  cache.set(image,{...cache.get(image),[kind]:copyResult(result)});
  return result;
}
