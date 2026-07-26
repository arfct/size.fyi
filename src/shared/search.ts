import type { Device } from './types';

function haystack(d: Device): string {
  return [d.name, d.make ?? '', d.model ?? '', ...(d.aliases ?? [])].join(' ').toLowerCase();
}

// Suggestions shown when the search box is empty: ranked by `rank` descending (name as a stable
// tiebreak), excluding anything already in the comparison. When the comparison already holds one or
// more catalog devices, suggestions are narrowed to those same categories (size class / type) so we
// surface peers of what's being compared; with an empty or custom-only comparison, no such filter.
export function suggestDevices(
  devices: Device[],
  categories: Set<string>,
  exclude: Set<string>,
  limit = 4,
): Device[] {
  return devices
    .filter((d) => !exclude.has(d.slug))
    .filter((d) => categories.size === 0 || categories.has(d.category))
    .slice()
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function searchDevices(devices: Device[], query: string, limit = 10): Device[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const scored: Array<{ d: Device; score: number }> = [];
  for (const d of devices) {
    const hay = haystack(d);
    let score = 0;
    for (const t of tokens) {
      const idx = hay.indexOf(t);
      if (idx === -1) {
        score = -1;
        break;
      }
      score += idx === 0 ? 3 : hay[idx - 1] === ' ' ? 2 : 1; // prefix > word-start > substring
    }
    if (score > 0) scored.push({ d, score });
  }
  return scored
    .sort(
      (a, b) =>
        b.score - a.score || a.d.name.length - b.d.name.length || a.d.name.localeCompare(b.d.name),
    )
    .slice(0, limit)
    .map((s) => s.d);
}
