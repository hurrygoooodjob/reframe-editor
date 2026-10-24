import type { ReactNode, SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'name'> & { name: string; size?: number };

const paths: Record<string, ReactNode> = {
  open: <><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v1"/><path d="m3 9 1.5 11H20l2-11Z"/></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></>,
  undo: <><path d="m8 5-5 5 5 5M3 10h11a6 6 0 0 1 6 6v3"/></>,
  redo: <><path d="m16 5 5 5-5 5m5-5H10a6 6 0 0 0-6 6v3"/></>,
  compare: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 2v20M6 16l3-4 3 2m3-6h3"/></>,
  move: <><path d="M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3m14-6 3 3-3 3"/></>,
  brush: <><path d="m10 14 8-10a2.1 2.1 0 0 1 3 3L11 15M10 14l1 1c1 4-3 6-8 5 2-1 1-3 2-4s3-2 5-2Z"/></>,
  compress: <><path d="M3 5v14M21 5v14M6 12h5m-3-3 3 3-3 3m10-3h-5m3-3-3 3 3 3"/></>,
  eraser: <><path d="m13 3 8 8-9 9H7l-5-5L13 3Zm-7 8 8 8M12 20h10"/></>,
  rectangle: <rect x="4" y="5" width="16" height="14" rx="1"/>,
  rect: <rect x="4" y="5" width="16" height="14" rx="1"/>,
  ellipse: <ellipse cx="12" cy="12" rx="8" ry="8"/>,
  triangle: <path d="M12 3 22 21H2Z"/>,
  diamond: <path d="m12 2 10 10-10 10L2 12Z"/>,
  hexagon: <path d="m7 3 10 0 5 9-5 9H7l-5-9Z"/>,
  star: <path d="m12 2 3.1 6.4 7.1 1-5.1 5 1.2 7.1-6.3-3.3-6.3 3.3 1.2-7.1-5.1-5 7.1-1Z"/>,
  heart: <path d="M20.5 5.5a5.1 5.1 0 0 0-7.2 0L12 6.8l-1.3-1.3a5.1 5.1 0 0 0-7.2 7.2L12 21l8.5-8.3a5.1 5.1 0 0 0 0-7.2Z"/>,
  zoomIn: <><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5M7 10.5h7m-3.5-3.5v7"/></>,
  zoomOut: <><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5M7 10.5h7"/></>,
  fit: <><path d="M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6"/><rect x="7" y="7" width="10" height="10" rx="1"/></>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 8.5a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 16h.01"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/></>,
  unlock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 7.7-1.5M12 14v3"/></>,
  chevron: <path d="m7 10 5 5 5-5"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  file: <><path d="M14 2H5v20h14V7ZM14 2v5h5M8 12h8m-8 4h5"/></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></>,
  save: <><path d="M3 3h15l3 3v15H3ZM7 3v6h10V3M7 21v-8h10v8"/></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 3-6 6 7"/></>,
  plus: <path d="M5 12h14M12 5v14"/>,
  minus: <path d="M5 12h14"/>,
  shield: <><path d="m12 2 8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5Z"/><path d="m8 12 3 3 5-6"/></>,
  reset: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/></>,
  eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
  layers: <><path d="m12 2 10 5-10 5L2 7Zm-9 10 9 5 9-5M3 17l9 5 9-5"/></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  cursor: <path d="m5 3 14 10-7 1-3 7Z"/>,
};

export default function Icon({ name, size = 20, ...props }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] ?? paths.image}</svg>;
}
