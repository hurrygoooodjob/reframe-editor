import type { EffectRequest, EffectLayersRequest } from '../renderClient';
import { renderEffectLayers } from '../effects/composite';
import { renderImage } from './retarget';
import { analyzeRegions } from './autoRegions';
import type { RenderRequest, AutoRegionsRequest } from '../types';

type WorkMessage =
  | {id:number; kind:'render'; request:RenderRequest}
  | {id:number; kind:'analyze'; request:AutoRegionsRequest}
  | {id:number | string; kind:'effect'; request:EffectRequest}
  | {id:number; kind:'layers'; request:EffectLayersRequest};

self.onmessage = (event:MessageEvent<WorkMessage>) => {
  const {id} = event.data;
  const progress = (fraction:number, label:string) => self.postMessage({id, type:'progress', progress:fraction, label});
  try {
    const message = event.data;
    if (message.kind === 'analyze') {
      const result = analyzeRegions(message.request, progress);
      self.postMessage({id, type:'result', result}, {transfer:[result.mask.buffer]});
    } else if (message.kind === 'effect' || message.kind === 'layers') {
      const {image, reference} = message.request;
      // Individual gallery thumbnails use the same compositor with one layer.
      const layers = message.kind === 'layers' ? message.request.layers : [{id:'sample', effect:message.request.effect}];
      const result = renderEffectLayers(image, layers, reference, progress);
      self.postMessage({id, type:'result', result}, {transfer:[result.data.buffer]});
    } else {
      const {settings, effect} = message.request;
      const layers = message.request.layers ?? (effect ? [{id:'single', effect}] : []);
      const result = renderImage(message.request, layers.length ? (n, label) => progress(n * .7, label) : progress);
      if (layers.length) result.image = renderEffectLayers(result.image, layers, settings,
        (fraction, label) => progress(.7 + .28 * fraction, label));
      self.postMessage({id, type:'result', result}, {transfer:[result.image.data.buffer]});
    }
  } catch (error) {
    self.postMessage({id, type:'error', error:error instanceof Error ? error.message : '图片处理未完成。'});
  }
};
