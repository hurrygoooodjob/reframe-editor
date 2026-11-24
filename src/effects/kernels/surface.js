// Canvas allocation is deferred so metadata can also be imported by Node.
export function newSurface(width = 1, height = 1) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
