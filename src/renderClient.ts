import workerSource from './generated-worker';
import type { RenderRequest, RenderResult, AutoRegionsRequest, AutoRegionsResult } from './types';

let sequence = 0;
function startTask<T>(kind:'render'|'analyze',request:RenderRequest|AutoRegionsRequest,progress:(value:number,label:string)=>void){
  const id=++sequence;
  const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
  let worker:Worker;
  try{worker=new Worker(url);}catch(error){URL.revokeObjectURL(url);throw error;}
  let settled=false;
  let rejectPromise:(error:Error)=>void=()=>{};
  const cleanup=()=>{worker.terminate();URL.revokeObjectURL(url);};
  const promise=new Promise<T>((resolve,reject)=>{
    rejectPromise=reject;
    worker.onmessage=event=>{
      if(settled||event.data.id!==id)return;
      if(event.data.type==='progress')progress(event.data.progress,event.data.label);
      else if(event.data.type==='result'){settled=true;cleanup();resolve(event.data.result);}
      else if(event.data.type==='error'){settled=true;cleanup();reject(new Error(event.data.error));}
    };
    worker.onerror=event=>{if(!settled){settled=true;cleanup();reject(new Error(event.message||'图片处理未完成。'));}};
    try{worker.postMessage({id,kind,request});}catch(error){settled=true;cleanup();reject(error);}
  });
  return{promise,cancel:()=>{if(!settled){settled=true;cleanup();rejectPromise(new DOMException('已取消','AbortError'));}}};
}
export const startRender=(request:RenderRequest,progress:(value:number,label:string)=>void)=>startTask<RenderResult>('render',request,progress);
export const startAutoAnalysis=(request:AutoRegionsRequest,progress:(value:number,label:string)=>void)=>startTask<AutoRegionsResult>('analyze',request,progress);
