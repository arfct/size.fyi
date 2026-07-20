import type { ComparisonItem, Device } from './types';
import { MAX_ITEMS } from './types';

export const RESERVED_PREFIXES = ['api', 'assets'];
const SEP = '-vs-';
const CUSTOM_RE = /^([a-z0-9]+(?:_[a-z0-9]+)*)~(\d+(?:\.\d)?)x(\d+(?:\.\d)?)x(\d+(?:\.\d)?)$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

function encodeItem(item: ComparisonItem): string {
  if (item.kind === 'device') return item.device.slug;
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
      if (SLUG_RE.test(token)) {
        const device = bySlug.get(token);
        if (device) items.push({ kind: 'device', device });
        else missing.push(token);
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
