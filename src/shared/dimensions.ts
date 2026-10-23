import type { Units } from './types';

const UNIT_TO_MM: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
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
  const [h, w, d] = [m[1]!, m[2]!, m[3]!].map((s) => round1(parseFloat(s) * factor)) as [
    number,
    number,
    number,
  ];
  if ([h, w, d].some((v) => !Number.isFinite(v) || v < MIN_MM || v > MAX_MM)) return null;
  return { h, w, d };
}

// The unit a set of lengths is shown in. One unit covers everything on screen at once — the 3D labels
// and the item list alike — so a comparison never reads "1.98 m" beside "838 mm". It's chosen from the
// smallest length, since that's the one a coarse unit would round away (a 1 mm sheet of paper is
// "0.00 m"); the large lengths just carry more digits.
export type LengthUnit = 'mm' | 'm' | 'in' | 'ft';

export function pickUnit(lengths: number[], units: Units): LengthUnit {
  const smallest = lengths.length ? Math.min(...lengths) : 0;
  if (units === 'metric') return smallest >= 1000 ? 'm' : 'mm';
  return smallest >= 36 * 25.4 ? 'ft' : 'in';
}

// Every length a set of items will display — all three axes, because the list shows depth even
// though the 3D labels don't, and both have to land on the same unit.
export function pickUnitFor(
  items: { h: number; w: number; d: number }[],
  units: Units,
): LengthUnit {
  return pickUnit(
    items.flatMap((i) => [i.h, i.w, i.d]),
    units,
  );
}

// Bare numeric value in the given unit, for compact side-by-side display like "71.9 × 150".
export function formatLengthValue(mm: number, unit: LengthUnit): string {
  switch (unit) {
    case 'mm': {
      const r = round1(mm);
      return Number.isInteger(r) ? String(r) : r.toFixed(1);
    }
    case 'm':
      return (mm / 1000).toFixed(2);
    case 'in':
      return round1(mm / 25.4).toFixed(1);
    case 'ft':
      return round1(mm / 304.8).toFixed(1);
  }
}

export function formatLength(mm: number, units: Units, unit = pickUnit([mm], units)): string {
  return `${formatLengthValue(mm, unit)} ${unit}`;
}

// "h × w × d unit", with the unit shown once. Pass the comparison's shared unit so every row agrees;
// on its own an item picks the unit its smallest side needs.
export function formatDims(
  item: { h: number; w: number; d: number },
  units: Units,
  unit = pickUnitFor([item], units),
): string {
  return `${[item.h, item.w, item.d].map((v) => formatLengthValue(v, unit)).join(' × ')} ${unit}`;
}
