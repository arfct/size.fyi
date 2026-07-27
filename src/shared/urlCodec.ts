import type { ComparisonItem, Device } from './types';
import { defaultStateLabel, MAX_ITEMS } from './types';

export const RESERVED_PREFIXES = ['api', 'assets'];
const SEP = '-vs-';
const CUSTOM_RE = /^([a-z0-9]+(?:_[a-z0-9]+)*)~(\d+(?:\.\d)?)x(\d+(?:\.\d)?)x(\d+(?:\.\d)?)$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLON_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+$/;

export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function slugifyCustomName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'item';
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);

// Multi-state devices (foldables) are addressed as `slug-state`, e.g. galaxy-z-fold8-open — which
// reproduces the natural per-state slug and is always explicit about which state is shown. Single-
// state devices are just their slug.
function encodeItem(item: ComparisonItem): string {
  if (item.kind === 'device') {
    const { device } = item;
    const label = item.state ?? defaultStateLabel(device);
    if (device.states?.length && label) return `${device.slug}-${label}`;
    return device.slug;
  }
  return `${slugifyCustomName(item.name)}~${fmt(item.h)}x${fmt(item.w)}x${fmt(item.d)}`;
}

export function encodeComparison(items: ComparisonItem[]): string {
  if (items.length === 0) return '/';
  return `/${items.slice(0, MAX_ITEMS).map(encodeItem).join(SEP)}`;
}

function titleCaseCustom(slug: string): string {
  return slug
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

// Resolves a device token to a device (+ optional state). Accepts: an exact slug (bare — default
// state for foldables); `slug-state` (e.g. galaxy-z-fold8-open); and `slug:state` (the earlier colon
// form, kept working). For the split forms we only strip the trailing segment when the remainder is
// a MULTI-STATE device, so ordinary slugs like `iphone-16-pro-max` are never mis-parsed; an unknown
// state label on a real multi-state device fails open to its default rather than 404ing.
function resolveDeviceToken(
  token: string,
  bySlug: Map<string, Device>,
): { device: Device; state?: string } | null {
  const exact = bySlug.get(token);
  if (exact) return { device: exact };
  const idx = token.includes(':') ? token.indexOf(':') : token.lastIndexOf('-');
  if (idx > 0) {
    const device = bySlug.get(token.slice(0, idx));
    if (device?.states?.length) {
      const label = token.slice(idx + 1);
      return device.states.some((s) => s.label === label) ? { device, state: label } : { device };
    }
  }
  return null;
}

// A bare slug, `slug-state`, or `slug:state` token selects a device (and, for foldables, a state).
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
      if (!SLUG_RE.test(token) && !COLON_RE.test(token)) continue;
      const resolved = resolveDeviceToken(token, bySlug);
      if (resolved) {
        items.push(
          resolved.state
            ? { kind: 'device', device: resolved.device, state: resolved.state }
            : { kind: 'device', device: resolved.device },
        );
      } else {
        missing.push(token);
      }
    }
  } catch {
    /* malformed URI etc. — fail open with what we have */
  }
  return { items, missing };
}

export function comparisonTitle(items: ComparisonItem[]): string {
  return items
    .map((i) => {
      if (i.kind !== 'device') return i.name;
      const label = i.state ?? defaultStateLabel(i.device);
      return i.device.states?.length && label ? `${i.device.name} (${label})` : i.device.name;
    })
    .join(' vs ');
}
