import type { ComparisonItem, Device } from './types';
import { MAX_ITEMS, defaultStateLabel } from './types';

export const RESERVED_PREFIXES = ['api', 'assets'];
const SEP = '-vs-';
const CUSTOM_RE = /^([a-z0-9]+(?:_[a-z0-9]+)*)~(\d+(?:\.\d)?)x(\d+(?:\.\d)?)x(\d+(?:\.\d)?)$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STATE_RE = /^[a-z0-9]+$/;

export function slugify(name: string): string {
  return name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function slugifyCustomName(name: string): string {
  const slug = name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug || 'item';
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);

// Multi-state devices append the active state as `slug:state`; the default state stays bare so the
// common URL is unchanged (and matches the pre-merge slug for the default).
function encodeItem(item: ComparisonItem): string {
  if (item.kind === 'device') {
    const { slug } = item.device;
    if (item.state && item.state !== defaultStateLabel(item.device)) return `${slug}:${item.state}`;
    return slug;
  }
  return `${slugifyCustomName(item.name)}~${fmt(item.h)}x${fmt(item.w)}x${fmt(item.d)}`;
}

export function encodeComparison(items: ComparisonItem[]): string {
  if (items.length === 0) return '/';
  return '/' + items.slice(0, MAX_ITEMS).map(encodeItem).join(SEP);
}

function titleCase(slug: string): string {
  return slug.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}

function titleCaseCustom(slug: string): string {
  return slug.split('_').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}

// A `slug:state` token selects a multi-state device's state; a bare slug uses its default state.
export function decodeComparison(
  path: string,
  bySlug: Map<string, Device>,
): { items: ComparisonItem[]; missing: string[] } {
  const items: ComparisonItem[] = [];
  const missing: string[] = [];
  try {
    const raw = decodeURIComponent(path).replace(/^\/+|\/+$/g, '');
    if (!raw || raw.includes('/')) return { items, missing };
    if (RESERVED_PREFIXES.includes(raw)) return { items, missing };
    for (const token of raw.split(SEP)) {
      if (items.length + missing.length >= MAX_ITEMS) break;
      const m = token.match(CUSTOM_RE);
      if (m) {
        const [h, w, d] = [m[2]!, m[3]!, m[4]!].map(Number);
        if ([h, w, d].every((v) => v! >= 0.1 && v! <= 100_000)) {
          items.push({ kind: 'custom', name: titleCaseCustom(m[1]!), h: h!, w: w!, d: d! });
          continue;
        }
      }
      const colon = token.indexOf(':');
      const base = colon === -1 ? token : token.slice(0, colon);
      const stateTok = colon === -1 ? '' : token.slice(colon + 1);
      if (!SLUG_RE.test(base) || (stateTok && !STATE_RE.test(stateTok))) continue;
      const device = bySlug.get(base);
      if (device) {
        const state = stateTok && device.states?.some((s) => s.label === stateTok) ? stateTok : undefined;
        items.push(state ? { kind: 'device', device, state } : { kind: 'device', device });
      } else {
        missing.push(base);
      }
    }
  } catch {
    /* malformed URI etc. — fail open with what we have */
  }
  return { items, missing };
}

export function comparisonTitle(items: ComparisonItem[]): string {
  return items.map((i) => (i.kind === 'device' ? i.device.name : i.name)).join(' vs ');
}
