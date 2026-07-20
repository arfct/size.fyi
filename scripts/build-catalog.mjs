import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = 'data/devices';
const OUT = 'public/devices.json';
const CATEGORIES = ['everyday', 'paper', 'phone', 'tablet', 'laptop', 'console', 'pc-case', 'audio', 'camera'];
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const checkOnly = process.argv.includes('--check');

const errors = [];
const devices = [];
const seen = new Set();

for (const file of (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json')).sort()) {
  const list = JSON.parse(await readFile(path.join(DATA_DIR, file), 'utf8'));
  if (!Array.isArray(list)) { errors.push(`${file}: not an array`); continue; }
  for (const d of list) {
    const id = `${file}:${d.slug ?? '?'}`;
    if (typeof d.slug !== 'string' || !SLUG_RE.test(d.slug)) errors.push(`${id}: bad slug`);
    if (d.slug?.includes('-vs-') || d.slug?.includes('~')) errors.push(`${id}: slug collides with URL grammar`);
    if (seen.has(d.slug)) errors.push(`${id}: duplicate slug`);
    seen.add(d.slug);
    if (typeof d.name !== 'string' || !d.name.trim()) errors.push(`${id}: missing name`);
    if (!CATEGORIES.includes(d.category)) errors.push(`${id}: bad category ${d.category}`);
    for (const k of ['h', 'w', 'd']) {
      const v = d[k];
      if (typeof v !== 'number' || v < 0.1 || v > 100_000) errors.push(`${id}: ${k}=${v} out of range`);
    }
    if (d.radius !== undefined || d.radiusAxis !== undefined) {
      const cross = { x: ['h', 'd'], y: ['w', 'd'], z: ['h', 'w'] }[d.radiusAxis];
      if (!cross) errors.push(`${id}: radiusAxis must be x|y|z when radius present`);
      else if (typeof d.radius !== 'number' || d.radius <= 0
        || d.radius > Math.min(d[cross[0]], d[cross[1]]) / 2 + 0.01)
        errors.push(`${id}: radius out of range for its cross-section`);
    }
    const allowed = new Set(['slug', 'name', 'category', 'h', 'w', 'd', 'brand', 'year', 'aliases', 'source', 'radius', 'radiusAxis']);
    for (const k of Object.keys(d)) if (!allowed.has(k)) errors.push(`${id}: unknown key ${k}`);
    devices.push(d);
  }
}

if (errors.length) {
  console.error(`Catalog validation failed:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
devices.sort((a, b) => a.slug.localeCompare(b.slug));
console.log(`Catalog OK: ${devices.length} devices`);
if (!checkOnly) {
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ version: 1, devices }));
  console.log(`Wrote ${OUT}`);
}
