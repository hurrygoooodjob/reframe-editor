export type ShapeId = 'rect' | 'ellipse' | 'triangle' | 'diamond' | 'hexagon' | 'star' | 'heart';
export type Tool = 'transform' | 'protect' | 'compress' | 'erase' | 'rectangle';
export type Quality = 'draft' | 'balanced' | 'fine';
export interface PixelImage { width: number; height: number; data: Uint8ClampedArray; }
export interface EditSettings {
  width: number;
  height: number;
  contentAmount: number;
  transitionSoftness: number;
  shape: ShapeId;
  squeeze: number;
  protectStrength: number;
  forwardEnergy: boolean;
  quality: Quality;
}
export interface RenderRequest {
  image: PixelImage;
  mask: Float32Array;
  maskWidth: number;
  maskHeight: number;
  settings: EditSettings;
  maxOutputEdge?: number;
}
export interface RenderResult {
  image: PixelImage;
  elapsedMs: number;
  analysisWidth: number;
  analysisHeight: number;
  warnings: string[];
}
export const DEFAULT_SETTINGS: Omit<EditSettings, 'width' | 'height'> = {
  contentAmount: 1, transitionSoftness: 0.65, shape: 'rect', squeeze: 0.85, protectStrength: 1,
  forwardEnergy: true, quality: 'balanced',
};
export const SHAPES: { id: ShapeId; label: string }[] = [
  {id:'rect',label:'矩形'}, {id:'ellipse',label:'圆形'},
  {id:'triangle',label:'三角'}, {id:'diamond',label:'菱形'},
  {id:'hexagon',label:'六边形'}, {id:'star',label:'星形'}, {id:'heart',label:'心形'},
];

export interface AutoRegionsRequest {
  image: PixelImage;
  maskWidth: number;
  maskHeight: number;
  seed: number;
}
export interface AutoRegionsResult {
  mask: Float32Array;
  protectRatio: number;
  compressRatio: number;
  confidence: 'low' | 'medium' | 'high';
  regionCount: number;
  warnings: string[];
  elapsedMs: number;
}
export interface AutoSelectionInfo {
  seed: number;
  confidence: AutoRegionsResult['confidence'];
  regionCount: number;
  warnings: string[];
  edited: boolean;
}
