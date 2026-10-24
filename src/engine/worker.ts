import { renderImage } from './retarget';
import { analyzeRegions } from './autoRegions';
import type { RenderRequest, AutoRegionsRequest } from '../types';
type WorkMessage={id:number;kind:'render';request:RenderRequest}|{id:number;kind:'analyze';request:AutoRegionsRequest};
self.onmessage=(event:MessageEvent<WorkMessage>)=>{
  const message=event.data;
  const progress=(progress:number,label:string)=>self.postMessage({id:message.id,type:'progress',progress,label});
  try{
    if(message.kind==='analyze'){
      const result=analyzeRegions(message.request,progress);
      self.postMessage({id:message.id,type:'result',result},{transfer:[result.mask.buffer]});
    }else{
      const result=renderImage(message.request,progress);
      self.postMessage({id:message.id,type:'result',result},{transfer:[result.image.data.buffer]});
    }
  }catch(error){self.postMessage({id:message.id,type:'error',error:error instanceof Error?error.message:'图片处理未完成。'});}
};
