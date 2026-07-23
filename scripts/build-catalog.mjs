import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = 'data/devices';
const OUT = 'public/devices.json';
const CATEGORIES = ['everyday', 'paper', 'phone', 'tablet', 'laptop', 'console', 'pc-case', 'audio', 'camera', 'watch'];
const MESHES = ['banana'];
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const checkOnly = process.argv.includes('--check');

const errors = [];
const devices = [];
const seen = new Set();

// Validates the geometry fields (h/w/d + optional radius/radiusAxis/screen) on a device or one of
// its states. `g` is the object carrying them; `id` prefixes any error.
function validateGeometry(g, id) {
  for (const k of ['h', 'w', 'd']) {
    const v = g[k];
    if (typeof v !== 'number' || v < 0.1 || v > 100_000) errors.push(`${id}: ${k}=${v} out of range`);
  }
  if (g.radius !== undefined || g.radiusAxis !== undefined) {
    if (g.radiusAxis === undefined) {
      // all-edge rounding (RoundedBox): radius must fit the smallest side
      if (typeof g.radius !== 'number' || g.radius <= 0 || g.radius > Math.min(g.h, g.w, g.d) / 2 + 0.01)
        errors.push(`${id}: radius out of range for all-edge rounding`);
    } else {
      const cross = { x: ['h', 'd'], y: ['w', 'd'], z: ['h', 'w'] }[g.radiusAxis];
      if (!cross) errors.push(`${id}: radiusAxis must be x|y|z`);
      else if (typeof g.radius !== 'number' || g.radius <= 0
        || g.radius > Math.min(g[cross[0]], g[cross[1]]) / 2 + 0.01)
        errors.push(`${id}: radius out of range for its cross-section`);
    }
  }
  if (g.screen !== undefined) {
    if (typeof g.screen !== 'object' || g.screen === null || Array.isArray(g.screen)) {
      errors.push(`${id}: screen must be an object`);
    } else {
      const screenAllowed = new Set(['h', 'w', 'radius']);
      for (const k of Object.keys(g.screen)) if (!screenAllowed.has(k)) errors.push(`${id}: unknown key screen.${k}`);
      const sh = g.screen.h, sw = g.screen.w;
      if (typeof sh !== 'number' || sh <= 0) errors.push(`${id}: screen.h missing or invalid`);
      else if (typeof g.h === 'number' && sh > g.h) errors.push(`${id}: screen.h=${sh} exceeds h=${g.h}`);
      if (typeof sw !== 'number' || sw <= 0) errors.push(`${id}: screen.w missing or invalid`);
      else if (typeof g.w === 'number' && sw > g.w) errors.push(`${id}: screen.w=${sw} exceeds w=${g.w}`);
      if (g.screen.radius !== undefined) {
        if (typeof g.screen.radius !== 'number' || g.screen.radius <= 0
          || (typeof sh === 'number' && typeof sw === 'number' && g.screen.radius > Math.min(sh, sw) / 2 + 0.01))
          errors.push(`${id}: screen.radius out of range`);
      }
    }
  }
}

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

    // Multi-state devices: validate each state and mirror the default state's geometry to the top
    // level so single-state consumers (and the geometry check below) keep working unchanged.
    if (d.states !== undefined) {
      const geomKeys = ['h', 'w', 'd', 'radius', 'radiusAxis', 'screen'];
      for (const k of geomKeys) if (d[k] !== undefined) errors.push(`${id}: ${k} must live on states[], not the device, when states is set`);
      if (!Array.isArray(d.states) || d.states.length < 2) {
        errors.push(`${id}: states must be an array of 2+ states`);
      } else {
        const labels = new Set();
        for (const [i, s] of d.states.entries()) {
          const sid = `${id}.states[${i}]`;
          if (typeof s.label !== 'string' || !/^[a-z0-9]+$/.test(s.label)) errors.push(`${sid}: label must be [a-z0-9]+`);
          else if (labels.has(s.label)) errors.push(`${sid}: duplicate state label ${s.label}`);
          else labels.add(s.label);
          if (s.seam !== undefined && typeof s.seam !== 'boolean') errors.push(`${sid}: seam must be a boolean`);
          const stateAllowed = new Set(['label', 'h', 'w', 'd', 'radius', 'radiusAxis', 'screen', 'seam']);
          for (const k of Object.keys(s)) if (!stateAllowed.has(k)) errors.push(`${sid}: unknown key ${k}`);
          validateGeometry(s, sid);
        }
        if (d.defaultState !== undefined && !labels.has(d.defaultState)) errors.push(`${id}: defaultState ${d.defaultState} is not a state label`);
        const def = d.states.find((s) => s.label === (d.defaultState ?? d.states[0].label)) ?? d.states[0];
        for (const k of geomKeys) if (def[k] !== undefined) d[k] = def[k]; // mirror default state up
      }
    } else {
      validateGeometry(d, id);
    }
    if (d.mesh !== undefined) {
      if (!MESHES.includes(d.mesh)) errors.push(`${id}: unknown mesh ${d.mesh}`);
      if (d.radius !== undefined || d.radiusAxis !== undefined || d.screen !== undefined)
        errors.push(`${id}: mesh devices define their own geometry`);
    }
    for (const k of ['make', 'model']) {
      if (d[k] !== undefined && (typeof d[k] !== 'string' || !d[k].trim())) errors.push(`${id}: ${k} must be a non-empty string`);
    }
    if (d.rank !== undefined && (typeof d.rank !== 'number' || d.rank < 0 || !Number.isFinite(d.rank))) errors.push(`${id}: rank must be a non-negative number`);
    if (d.url !== undefined && (typeof d.url !== 'string' || !/^https:\/\/\S+$/.test(d.url))) errors.push(`${id}: url must be an https:// string`);
    if (d.model3d !== undefined) {
      const m = d.model3d;
      if (typeof m !== 'object' || m === null || Array.isArray(m)) errors.push(`${id}: model3d must be an object`);
      else {
        if (typeof m.url !== 'string' || !/^[a-z0-9-]+\.glb$/.test(m.url)) errors.push(`${id}: model3d.url must look like "name.glb"`);
        else if (!existsSync(path.join('public/models', m.url))) errors.push(`${id}: model3d file public/models/${m.url} not found`);
        if (m.rotation !== undefined && (!Array.isArray(m.rotation) || m.rotation.length !== 3 || m.rotation.some((n) => typeof n !== 'number' || !Number.isFinite(n))))
          errors.push(`${id}: model3d.rotation must be [x, y, z] numbers`);
        if (d.mesh !== undefined) errors.push(`${id}: model3d and mesh are mutually exclusive`);
        for (const k of Object.keys(m)) if (!['url', 'rotation'].includes(k)) errors.push(`${id}: unknown key model3d.${k}`);
      }
    }
    const allowed = new Set(['slug', 'name', 'category', 'h', 'w', 'd', 'make', 'model', 'rank', 'url', 'year', 'aliases', 'source', 'radius', 'radiusAxis', 'screen', 'mesh', 'model3d', 'states', 'defaultState']);
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
