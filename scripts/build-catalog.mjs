import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = 'data/devices';
const OUT = 'public/devices.json';
const CATEGORIES = [
  'everyday',
  'paper',
  'phone',
  'tablet',
  'laptop',
  'console',
  'pc-case',
  'audio',
  'camera',
  'watch',
];
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
    if (typeof v !== 'number' || v < 0.1 || v > 100_000)
      errors.push(`${id}: ${k}=${v} out of range`);
  }
  if (g.radius !== undefined || g.radiusAxis !== undefined) {
    if (g.radiusAxis === undefined) {
      // all-edge rounding (RoundedBox): radius must fit the smallest side
      if (
        typeof g.radius !== 'number' ||
        g.radius <= 0 ||
        g.radius > Math.min(g.h, g.w, g.d) / 2 + 0.01
      )
        errors.push(`${id}: radius out of range for all-edge rounding`);
    } else {
      const cross = { x: ['h', 'd'], y: ['w', 'd'], z: ['h', 'w'] }[g.radiusAxis];
      if (!cross) errors.push(`${id}: radiusAxis must be x|y|z`);
      else if (
        typeof g.radius !== 'number' ||
        g.radius <= 0 ||
        g.radius > Math.min(g[cross[0]], g[cross[1]]) / 2 + 0.01
      )
        errors.push(`${id}: radius out of range for its cross-section`);
    }
  }
  // A tighter radius on the hinge-side corners of a fold. Needs a radiusAxis: without one the rounding
  // is all-edge (RoundedBox), which has no notion of four corners to treat differently. Needs a radius
  // too, since it describes the OTHER two corners — on its own it would be a fold with no outer
  // rounding, which no device is.
  if (g.radiusInner !== undefined) {
    const cross = { x: ['h', 'd'], y: ['w', 'd'], z: ['h', 'w'] }[g.radiusAxis];
    if (!cross) {
      errors.push(`${id}: radiusInner needs a radiusAxis`);
    } else if (typeof g.radius !== 'number') {
      errors.push(`${id}: radiusInner needs a radius for the outer corners`);
    } else if (
      typeof g.radiusInner !== 'number' ||
      g.radiusInner < 0 ||
      g.radiusInner > Math.min(g[cross[0]], g[cross[1]]) / 2 + 0.01
    ) {
      errors.push(`${id}: radiusInner out of range for its cross-section`);
    } else if (g.radiusInner > g.radius) {
      // Not a geometric problem, but it inverts what the field means, so it's almost certainly a typo.
      errors.push(`${id}: radiusInner ${g.radiusInner} exceeds radius ${g.radius}`);
    }
  }
  if (g.hinge !== undefined) {
    if (!['left', 'right', 'top', 'bottom'].includes(g.hinge))
      errors.push(`${id}: hinge must be left|right|top|bottom`);
    if (g.radiusInner === undefined) errors.push(`${id}: hinge without radiusInner does nothing`);
  }
  if (g.screen !== undefined) {
    if (typeof g.screen !== 'object' || g.screen === null || Array.isArray(g.screen)) {
      errors.push(`${id}: screen must be an object`);
    } else {
      const screenAllowed = new Set(['h', 'w', 'radius', 'px', 'pixelRatio']);
      for (const k of Object.keys(g.screen))
        if (!screenAllowed.has(k)) errors.push(`${id}: unknown key screen.${k}`);
      const sh = g.screen.h,
        sw = g.screen.w;
      if (typeof sh !== 'number' || sh <= 0) errors.push(`${id}: screen.h missing or invalid`);
      else if (typeof g.h === 'number' && sh > g.h)
        errors.push(`${id}: screen.h=${sh} exceeds h=${g.h}`);
      if (typeof sw !== 'number' || sw <= 0) errors.push(`${id}: screen.w missing or invalid`);
      else if (typeof g.w === 'number' && sw > g.w)
        errors.push(`${id}: screen.w=${sw} exceeds w=${g.w}`);
      if (g.screen.radius !== undefined) {
        if (
          typeof g.screen.radius !== 'number' ||
          g.screen.radius <= 0 ||
          (typeof sh === 'number' &&
            typeof sw === 'number' &&
            g.screen.radius > Math.min(sh, sw) / 2 + 0.01)
        )
          errors.push(`${id}: screen.radius out of range`);
      }
      if (g.screen.px !== undefined) {
        const px = g.screen.px;
        if (typeof px !== 'object' || px === null || Array.isArray(px))
          errors.push(`${id}: screen.px must be an object`);
        else {
          for (const k of Object.keys(px))
            if (k !== 'w' && k !== 'h') errors.push(`${id}: unknown key screen.px.${k}`);
          for (const k of ['w', 'h'])
            if (!Number.isInteger(px[k]) || px[k] <= 0)
              errors.push(`${id}: screen.px.${k} must be a positive integer`);
        }
      }
      if (
        g.screen.pixelRatio !== undefined &&
        (typeof g.screen.pixelRatio !== 'number' || g.screen.pixelRatio <= 0)
      )
        errors.push(`${id}: screen.pixelRatio must be a positive number`);
    }
  }
}

// One device per file under data/devices/<category>/<slug>.json, so PRs adding a device never
// conflict and each diff is a single self-contained file. Legacy arrays are still accepted so a
// file may hold several devices if ever needed.
async function jsonFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await jsonFiles(full)));
    else if (e.name.endsWith('.json') && !e.name.endsWith('.template.json')) out.push(full);
  }
  return out.sort();
}

for (const file of await jsonFiles(DATA_DIR)) {
  const rel = path.relative(DATA_DIR, file);
  const dirCategory = path.dirname(rel).split(path.sep)[0]; // data/devices/<category>/...
  let parsed;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    errors.push(`${rel}: invalid JSON — ${e.message}`);
    continue;
  }
  for (const d of Array.isArray(parsed) ? parsed : [parsed]) {
    const id = `${rel}:${d.slug ?? '?'}`;
    if (typeof d.slug !== 'string' || !SLUG_RE.test(d.slug)) errors.push(`${id}: bad slug`);
    if (d.slug?.includes('-vs-') || d.slug?.includes('~'))
      errors.push(`${id}: slug collides with URL grammar`);
    // `/api/og/default` is the root share card (see renderDefaultOgImage). A device by this name would
    // be unreachable there, silently showing the generic card instead of its own.
    if (d.slug === 'default') errors.push(`${id}: slug is reserved for the default share card`);
    if (seen.has(d.slug)) errors.push(`${id}: duplicate slug`);
    seen.add(d.slug);
    if (typeof d.name !== 'string' || !d.name.trim()) errors.push(`${id}: missing name`);
    if (!CATEGORIES.includes(d.category)) errors.push(`${id}: bad category ${d.category}`);
    else if (dirCategory !== '.' && dirCategory !== d.category)
      errors.push(
        `${id}: file is under ${dirCategory}/ but category is "${d.category}" — move it to data/devices/${d.category}/`,
      );

    // Multi-state devices: validate each state and mirror the default state's geometry to the top
    // level so single-state consumers (and the geometry check below) keep working unchanged.
    if (d.states !== undefined) {
      const geomKeys = ['h', 'w', 'd', 'radius', 'radiusAxis', 'screen'];
      for (const k of geomKeys)
        if (d[k] !== undefined)
          errors.push(`${id}: ${k} must live on states[], not the device, when states is set`);
      if (!Array.isArray(d.states) || d.states.length < 2) {
        errors.push(`${id}: states must be an array of 2+ states`);
      } else {
        const labels = new Set();
        for (const [i, s] of d.states.entries()) {
          const sid = `${id}.states[${i}]`;
          if (typeof s.label !== 'string' || !/^[a-z0-9]+$/.test(s.label))
            errors.push(`${sid}: label must be [a-z0-9]+`);
          else if (labels.has(s.label)) errors.push(`${sid}: duplicate state label ${s.label}`);
          else labels.add(s.label);
          if (s.seam !== undefined && typeof s.seam !== 'boolean')
            errors.push(`${sid}: seam must be a boolean`);
          const stateAllowed = new Set([
            'label',
            'h',
            'w',
            'd',
            'radius',
            'radiusAxis',
            'radiusInner',
            'hinge',
            'screen',
            'seam',
          ]);
          for (const k of Object.keys(s))
            if (!stateAllowed.has(k)) errors.push(`${sid}: unknown key ${k}`);
          validateGeometry(s, sid);
        }
        if (d.defaultState !== undefined && !labels.has(d.defaultState))
          errors.push(`${id}: defaultState ${d.defaultState} is not a state label`);
        const def =
          d.states.find((s) => s.label === (d.defaultState ?? d.states[0].label)) ?? d.states[0];
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
      if (d[k] !== undefined && (typeof d[k] !== 'string' || !d[k].trim()))
        errors.push(`${id}: ${k} must be a non-empty string`);
    }
    if (
      d.rank !== undefined &&
      (typeof d.rank !== 'number' || d.rank < 0 || !Number.isFinite(d.rank))
    )
      errors.push(`${id}: rank must be a non-negative number`);
    if (d.url !== undefined && (typeof d.url !== 'string' || !/^https:\/\/\S+$/.test(d.url)))
      errors.push(`${id}: url must be an https:// string`);
    if (d.model3d !== undefined) {
      const m = d.model3d;
      if (typeof m !== 'object' || m === null || Array.isArray(m))
        errors.push(`${id}: model3d must be an object`);
      else {
        if (typeof m.url !== 'string' || !/^[a-z0-9-]+\.glb$/.test(m.url))
          errors.push(`${id}: model3d.url must look like "name.glb"`);
        else if (!existsSync(path.join('public/models', m.url)))
          errors.push(`${id}: model3d file public/models/${m.url} not found`);
        if (
          m.rotation !== undefined &&
          (!Array.isArray(m.rotation) ||
            m.rotation.length !== 3 ||
            m.rotation.some((n) => typeof n !== 'number' || !Number.isFinite(n)))
        )
          errors.push(`${id}: model3d.rotation must be [x, y, z] numbers`);
        if (d.mesh !== undefined) errors.push(`${id}: model3d and mesh are mutually exclusive`);
        for (const k of Object.keys(m))
          if (!['url', 'rotation'].includes(k)) errors.push(`${id}: unknown key model3d.${k}`);
      }
    }
    const allowed = new Set([
      'slug',
      'name',
      'category',
      'h',
      'w',
      'd',
      'make',
      'model',
      'rank',
      'url',
      'year',
      'aliases',
      'source',
      'radius',
      'radiusAxis',
      'radiusInner',
      'hinge',
      'screen',
      'mesh',
      'model3d',
      'states',
      'defaultState',
    ]);
    for (const k of Object.keys(d)) if (!allowed.has(k)) errors.push(`${id}: unknown key ${k}`);
    devices.push(d);
  }
}

if (errors.length) {
  console.error(
    `Catalog validation failed (${errors.length} error${errors.length > 1 ? 's' : ''}):\n  ${errors.join('\n  ')}`,
  );
  console.error(
    '\nSee CONTRIBUTING.md for the device schema, or copy data/devices/device.template.json.',
  );
  process.exit(1);
}
devices.sort((a, b) => a.slug.localeCompare(b.slug));
console.log(`Catalog OK: ${devices.length} devices`);
if (!checkOnly) {
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ version: 1, devices }));
  console.log(`Wrote ${OUT}`);
}
