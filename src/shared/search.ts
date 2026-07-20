import type { Device } from './types';

function haystack(d: Device): string {
  return [d.name, d.brand ?? '', ...(d.aliases ?? [])].join(' ').toLowerCase();
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
      if (idx === -1) { score = -1; break; }
      score += idx === 0 ? 3 : hay[idx - 1] === ' ' ? 2 : 1; // prefix > word-start > substring
    }
    if (score > 0) scored.push({ d, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.d.name.length - b.d.name.length || a.d.name.localeCompare(b.d.name))
    .slice(0, limit)
    .map((s) => s.d);
}
