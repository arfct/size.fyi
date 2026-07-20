import type { Units } from './types';

const UNIT_TO_MM: Record<string, number> = {
  mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8,
};
const MIN_MM = 0.1;
const MAX_MM = 100_000; // 100 m

const round1 = (n: number) => Math.round(n * 10) / 10;

export function parseDimensions(input: string): { h: number; w: number; d: number } | null {
  const cleaned = input.trim().toLowerCase().replace(/×/g, 'x').replace(/\s+/g, '');
  const m = cleaned.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(mm|cm|m|in|ft)?$/);
  if (!m) return null;
  const factor = UNIT_TO_MM[m[4] ?? 'mm'];
  if (factor === undefined) return null;
  const [h, w, d] = [m[1]!, m[2]!, m[3]!].map((s) => round1(parseFloat(s) * factor)) as [number, number, number];
  if ([h, w, d].some((v) => !Number.isFinite(v) || v < MIN_MM || v > MAX_MM)) return null;
  return { h, w, d };
}

export function formatLength(mm: number, units: Units): string {
  if (units === 'metric') {
    if (mm >= 1000) return `${(mm / 1000).toFixed(2)} m`;
    const r = round1(mm);
    return `${Number.isInteger(r) ? r : r.toFixed(1)} mm`;
  }
  const inches = mm / 25.4;
  if (inches >= 36) {
    const totalIn = Math.round(inches);
    const ft = Math.floor(totalIn / 12);
    const rest = totalIn % 12;
    return `${ft} ft ${rest} in`;
  }
  return `${round1(inches).toFixed(1)} in`;
}

export function formatDims(item: { h: number; w: number; d: number }, units: Units): string {
  if (units === 'metric' && [item.h, item.w, item.d].every((v) => v < 1000)) {
    const f = (v: number) => { const r = round1(v); return Number.isInteger(r) ? String(r) : r.toFixed(1); };
    return `${f(item.h)} × ${f(item.w)} × ${f(item.d)} mm`;
  }
  return `${formatLength(item.h, units)} × ${formatLength(item.w, units)} × ${formatLength(item.d, units)}`;
}
