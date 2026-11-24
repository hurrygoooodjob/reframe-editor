import { useEffect, useRef, useState } from 'react';
import type { EffectLayer } from '../effects/layers';
import type { RenderResult } from '../types';
import { startEffects } from '../renderClient';

interface Frame {
  source: RenderResult;
  result: RenderResult;
}

// A drag can produce masks faster than a long stack can render. Finish the current
// frame, then render only the newest pending update instead of starving the preview.
export function useStackPreview(source: RenderResult | null, layers: EffectLayer[],
  width: number, height: number, reportError: (message: string) => void) {
  const latest = useRef(layers);
  const wake = useRef<(() => void) | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [busy, setBusy] = useState(false);
  const enabled = layers.length > 0;

  useEffect(() => {
    latest.current = layers;
    wake.current?.();
  }, [layers]);

  useEffect(() => {
    if (!source || !enabled) {
      setFrame(null);
      setBusy(false);
      return;
    }
    const input = source;
    let disposed = false;
    let task: ReturnType<typeof startEffects> | null = null;
    let lastRequested: EffectLayer[] | undefined;
    async function render() {
      if (disposed || task || lastRequested === latest.current || !latest.current.length) return;
      lastRequested = latest.current;
      setBusy(true);
      try {
        task = startEffects({image:input.image, layers:lastRequested, reference:{width,height}});
        const image = await task.promise;
        if (!disposed) setFrame({source:input, result:{...input, image}});
      } catch (error) {
        if (!disposed) reportError(error instanceof Error ? error.message : '效果层预览失败，请重试。');
      } finally {
        task = null;
        if (!disposed) {
          if (latest.current !== lastRequested && latest.current.length) void render();
          else setBusy(false);
        }
      }
    }
    wake.current = render;
    void render();
    return () => {
      disposed = true;
      wake.current = null;
      task?.cancel();
    };
  }, [source, enabled, width, height, reportError]);

  return {result: enabled && source && frame?.source === source ? frame.result : source, busy};
}
