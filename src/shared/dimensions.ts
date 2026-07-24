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

// Splits a length into a bare value and its unit token — but only for the "simple" cases that
// carry a single trailing unit (metric mm/m, imperial inches under 3 ft). Returns null for the
// imperial ft+in compound, whose units are interleaved and so can't be factored out.
function splitLength(mm: number, units: Units): { value: string; unit: string } | null {
  if (units === 'metric') {
    if (mm >= 1000) return { value: (mm / 1000).toFixed(2), unit: 'm' };
    const r = round1(mm);
    return { value: Number.isInteger(r) ? String(r) : r.toFixed(1), unit: 'mm' };
  }
  const inches = mm / 25.4;
  if (inches >= 36) return null;
  return { value: round1(inches).toFixed(1), unit: 'in' };
}

export function formatLength(mm: number, units: Units): string {
  const part = splitLength(mm, units);
  if (part) return `${part.value} ${part.unit}`;
  const totalIn = Math.round(mm / 25.4);
  const ft = Math.floor(totalIn / 12);
  const rest = totalIn % 12;
  return `${ft} ft ${rest} in`;
}

// Bare numeric value with no unit, for compact side-by-side display like "71.9 × 150". Falls back to
// the full unit-bearing string for the imperial ft+in compound, whose interleaved units can't drop.
export function formatLengthValue(mm: number, units: Units): string {
  const part = splitLength(mm, units);
  return part ? part.value : formatLength(mm, units);
}

export function formatDims(item: { h: number; w: number; d: number }, units: Units): string {
  const parts = [item.h, item.w, item.d].map((v) => splitLength(v, units));
  const unit = parts[0]?.unit;
  // When all three share the same simple unit, show it once on the last component only.
  if (unit && parts.every((p) => p?.unit === unit)) {
    return `${parts.map((p) => p!.value).join(' × ')} ${unit}`;
  }
  // Mixed units (e.g. m + mm, or a ft+in component) — fall back to per-component units.
  return `${formatLength(item.h, units)} × ${formatLength(item.w, units)} × ${formatLength(item.d, units)}`;
}
