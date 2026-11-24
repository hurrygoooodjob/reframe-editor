import { renderEffect } from '../effects/render';
import type { EffectRequest } from '../renderClient';
import type { PixelImage } from '../types';
import { renderImage } from './retarget';
import { analyzeRegions } from './autoRegions';
import type { RenderRequest, AutoRegionsRequest } from '../types';
type WorkMessage={id:number;kind:'render';request:RenderRequest}|{id:number;kind:'analyze';request:AutoRegionsRequest}|{id:number;kind:'effect';request:EffectRequest};
function applyEffect(request: EffectRequest): PixelImage {
  const { image, effect, reference } = request;
  const pixels = new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height);
  const filtered = renderEffect(pixels, effect, reference);
  return {width: filtered.width, height: filtered.height, data: filtered.data};
}
self.onmessage=(event:MessageEvent<WorkMessage>)=>{
  const message=event.data;
  const progress=(progress:number,label:string)=>self.postMessage({id:message.id,type:'progress',progress,label});
  try{
    if(message.kind==='analyze'){
      const result=analyzeRegions(message.request,progress);
      self.postMessage({id:message.id,type:'result',result},{transfer:[result.mask.buffer]});
    } else if (message.kind === 'effect') {
      const result = applyEffect(message.request);
      self.postMessage({id: message.id, type: 'result', result}, {transfer: [result.data.buffer]});
    } else {
      const { effect, settings } = message.request;
      const result = renderImage(message.request, effect ? (n, label) => progress(n * .85, label) : progress);
      if (effect) {
        progress(.86, '正在应用图片效果');
        result.image = applyEffect({image: result.image, effect, reference: settings});
      }
      self.postMessage({id:message.id,type:'result',result},{transfer:[result.image.data.buffer]});
    }
  }catch(error){self.postMessage({id:message.id,type:'error',error:error instanceof Error?error.message:'图片处理未完成。'});}
};
