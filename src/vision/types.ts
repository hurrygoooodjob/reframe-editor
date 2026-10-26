export type DetectionKind = 'face' | 'body';

/** Centers/radii use image-normalized coordinates; angle is measured in pixel space. */
export interface PartTarget {
  id: string;
  label: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  angle: number;
  axis?: 'both' | 'width';
  confidence?: number;
}

export interface PartDetection {
  targets: PartTarget[];
  warnings: string[];
  protection?: { mask: Float32Array; width: number; height: number };
}

export interface LandmarkPoint { x: number; y: number; z?: number; visibility?: number; presence?: number; }
