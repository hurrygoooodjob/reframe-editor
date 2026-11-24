import { useEffect, useRef } from 'react';
import type { PixelImage } from '../types';
import { createEffect } from '../effects/catalog';
import workerSource from '../generated-worker';

interface SampleCache {
  input: PixelImage;
  results: Map<string, PixelImage>;
}

// Only the tiny downsample and rendered tiles are retained. Old previews and
// their samples can be collected together when the geometry changes.
const samples = new WeakMap<PixelImage, SampleCache>();

function sampleCache(preview: PixelImage) {
  const existing = samples.get(preview);
  if (existing) return existing;
  const scale = Math.min(1, 110 / preview.width, 76 / preview.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(preview.width * scale));
  canvas.height = Math.max(1, Math.round(preview.height * scale));
  const full = document.createElement('canvas');
  full.width = preview.width;
  full.height = preview.height;
  try {
    const sourceContext = full.getContext('2d');
    const target = canvas.getContext('2d', { willReadFrequently: true });
    if (!sourceContext || !target) return null;
    sourceContext.putImageData(new ImageData(preview.data as Uint8ClampedArray<ArrayBuffer>, preview.width, preview.height), 0, 0);
    target.imageSmoothingQuality = 'high';
    target.drawImage(full, 0, 0, canvas.width, canvas.height);
    const input = target.getImageData(0, 0, canvas.width, canvas.height);
    const cache: SampleCache = { input: { width: input.width, height: input.height, data: input.data }, results: new Map() };
    samples.set(preview, cache);
    return cache;
  } finally {
    canvas.width = full.width = 1;
    canvas.height = full.height = 1;
  }
}

function paint(canvas: HTMLCanvasElement, image: PixelImage) {
  canvas.width = image.width;
  canvas.height = image.height;
  const pixels = new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height);
  canvas.getContext('2d')?.putImageData(pixels, 0, 0);
  canvas.dataset.ready = 'true';
}

/** One background worker per active gallery. Queue only intersecting tiles and cancel on source/filter changes. */
export function useEffectSamples(preview: PixelImage | null, displayedIds: string) {
  const gallery = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = gallery.current;
    if (!host) return;
    const cells = Array.from(host.querySelectorAll<HTMLCanvasElement>('canvas[data-effect]'));
    for (const cell of cells) {
      cell.width = cell.height = 1;
      delete cell.dataset.ready;
    }
    if (!preview || !cells.length) return;
    let cache: SampleCache | null = null;
    try { cache = sampleCache(preview); } catch { return; }
    if (!cache) return;
    const { input, results } = cache;
    const pending = new Set<HTMLCanvasElement>();
    let worker: Worker | null = null;
    let url: string | null = null;
    let working: HTMLCanvasElement | null = null;
    let stopped = false;
    let observer: IntersectionObserver | null = null;

    function stop() {
      stopped = true;
      observer?.disconnect();
      pending.clear();
      worker?.terminate();
      if (url) URL.revokeObjectURL(url);
    }

    function next() {
      if (stopped || working) return;
      for (const cell of pending) {
        pending.delete(cell);
        const id = cell.dataset.effect!;
        const cached = results.get(id);
        if (cached) { paint(cell, cached); continue; }
        const effect = createEffect(id);
        if (!effect) continue;
        try {
          if (!worker) {
            url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
            worker = new Worker(url);
            worker.onerror = stop;
            worker.onmessage = event => {
              if (stopped || !working || event.data.type === 'progress') return;
              const target = working;
              working = null;
              if (event.data.type === 'result') {
                results.set(target.dataset.effect!, event.data.result);
                paint(target, event.data.result);
              }
              next();
            };
          }
          working = cell;
          worker.postMessage({ id, kind: 'effect', request: {
            image: input, effect, reference: { width: preview!.width, height: preview!.height },
          } });
        } catch { stop(); }
        break;
      }
    }

    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const cell = entry.target as HTMLCanvasElement;
          if (entry.isIntersecting && cell !== working && !cell.dataset.ready) pending.add(cell);
          else pending.delete(cell);
        }
        next();
      }, { root: host.closest('.inspector-scroll'), rootMargin: '65px 0px' });
      cells.forEach(cell => observer!.observe(cell));
    } else {
      cells.forEach(cell => pending.add(cell));
      next();
    }
    return stop;
  }, [preview, displayedIds]);
  return gallery;
}
