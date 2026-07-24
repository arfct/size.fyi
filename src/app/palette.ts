import type { ComparisonItem } from '../shared/types';

// Okabe–Ito colorblind-safe palette, ordered to lead with blue → red → yellow(amber) for the first
// three items. The true yellow (#F0E442) stays dropped so yellow reads as banana's signature color
// alone (see BANANA_YELLOW) and never collides with a regular item.
export const PALETTE = ['#0072B2', '#D55E00', '#E69F00', '#56B4E9', '#009E73', '#CC79A7', '#999999'];
export const colorFor = (index: number) => PALETTE[index % PALETTE.length]!;

// Items with a fixed procedural mesh render in their own signature color regardless of
// palette index, so the leading icon (ItemList) and the 3D scene (Viewer) must agree.
export const BANANA_YELLOW = '#FFE135';
export const itemColor = (item: ComparisonItem, index: number): string =>
  item.kind === 'device' && item.device.mesh === 'banana' ? BANANA_YELLOW : colorFor(index);
