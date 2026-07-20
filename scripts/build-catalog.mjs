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
    if (d.screen !== undefined) {
      if (typeof d.screen !== 'object' || d.screen === null || Array.isArray(d.screen)) {
        errors.push(`${id}: screen must be an object`);
      } else {
        const screenAllowed = new Set(['h', 'w', 'radius']);
        for (const k of Object.keys(d.screen)) if (!screenAllowed.has(k)) errors.push(`${id}: unknown key screen.${k}`);
        const sh = d.screen.h, sw = d.screen.w;
        if (typeof sh !== 'number' || sh <= 0) errors.push(`${id}: screen.h missing or invalid`);
        else if (typeof d.h === 'number' && sh > d.h) errors.push(`${id}: screen.h=${sh} exceeds device h=${d.h}`);
        if (typeof sw !== 'number' || sw <= 0) errors.push(`${id}: screen.w missing or invalid`);
        else if (typeof d.w === 'number' && sw > d.w) errors.push(`${id}: screen.w=${sw} exceeds device w=${d.w}`);
        if (d.screen.radius !== undefined) {
          if (typeof d.screen.radius !== 'number' || d.screen.radius <= 0
            || (typeof sh === 'number' && typeof sw === 'number' && d.screen.radius > Math.min(sh, sw) / 2 + 0.01))
            errors.push(`${id}: screen.radius out of range`);
        }
      }
    }
    const allowed = new Set(['slug', 'name', 'category', 'h', 'w', 'd', 'brand', 'year', 'aliases', 'source', 'radius', 'radiusAxis', 'screen']);
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
