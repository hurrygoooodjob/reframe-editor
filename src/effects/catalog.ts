import definitions from './definitions.json';

export interface EffectControl {
  key: string;
  label: string;
  kind: 'select' | 'text' | 'bitmap';
  value: string;
  options?: {value: string; label: string}[];
  maxLength?: number;
}

export interface EffectDefinition {
  id: string;
  name: string;
  english: string;
  group: string;
  description: string;
  scaleLabel: string;
  strength: number;
  size: number;
  controls: EffectControl[];
}

export interface EffectSettings {
  id: string;
  strength: number;
  size: number;
  params: Record<string, string>;
}

export const EFFECT_CATALOG = definitions as EffectDefinition[];
const byId = new Map(EFFECT_CATALOG.map(definition => [definition.id, definition]));

export function createEffect(id: string): EffectSettings | null {
  const definition = byId.get(id);
  if (!definition) return null;
  return {
    id,
    strength: definition.strength,
    size: definition.size,
    params: Object.fromEntries(definition.controls.map(control => [control.key, control.value])),
  };
}

function bounded(value: unknown, minimum: number, maximum: number, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeEffect(value: unknown): EffectSettings | null {
  if (!record(value) || typeof value.id !== 'string') return null;
  const definition = byId.get(value.id);
  const result = createEffect(value.id);
  if (!definition || !result) return null;
  result.strength = bounded(value.strength, 0, 100, result.strength);
  result.size = bounded(value.size, 2, 16, result.size);
  const params = value.params;
  if (!record(params)) return result;
  for (const control of definition.controls) {
    const raw = params[control.key];
    if (typeof raw !== 'string') continue;
    if (control.kind === 'text') result.params[control.key] = raw.slice(0, control.maxLength ?? 40);
    if (control.kind === 'select' && control.options?.some(option => option.value === raw)) result.params[control.key] = raw;
    if (control.kind === 'bitmap' && /^[01]{64}$/.test(raw)) result.params[control.key] = raw;
  }
  return result;
}
