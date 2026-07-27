import { expect, test } from 'vitest';
import { roundedGridBox, roundedGridRingSpecs } from '../scene';

const onLattice = (v: number, unit: number) => Math.abs(Math.round(v / unit) * unit - v) < 1e-6;

test('roundedGridBox is a cube sized from the largest content dimension, on the unit lattice', () => {
  const unit = 10,
    radius = 20;
  // content bounds with non-integer faces (device-like widths); largest dimension is x = 171.5
  const min = { x: 0, y: 0, z: -120 },
    max = { x: 171.5, y: 90, z: 0 };
  const box = roundedGridBox(min, max, 0.5, radius, unit);
  for (const face of [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]) {
    expect(onLattice(face, unit)).toBe(true);
  }
  // equal side on every axis — a cube
  const side = box.max.x - box.min.x;
  expect(box.max.y - box.min.y).toBeCloseTo(side);
  expect(box.max.z - box.min.z).toBeCloseTo(side);
  // side is twice the largest content dimension, rounded up to a whole unit
  expect(side).toBeCloseTo(Math.ceil((2 * 171.5) / unit) * unit);
});

test('roundedGridBox keeps the content enclosed and roughly centred', () => {
  const unit = 10,
    radius = 20;
  // a phone: only 8.25mm deep, so the cube's depth comes from its 149.6mm height
  const min = { x: 0, y: 0, z: -8.25 },
    max = { x: 71.5, y: 149.6, z: 0 };
  const box = roundedGridBox(min, max, 0.5, radius, unit);
  for (const axis of ['x', 'y', 'z'] as const) {
    expect(box.min[axis]).toBeLessThan(min[axis]);
    expect(box.max[axis]).toBeGreaterThan(max[axis]);
    // content centre sits within half a unit of the room centre on every axis
    const boxMid = (box.min[axis] + box.max[axis]) / 2,
      contentMid = (min[axis] + max[axis]) / 2;
    expect(Math.abs(boxMid - contentMid)).toBeLessThanOrEqual(unit / 2 + 1e-9);
  }
  // the flat axis still gets a full-depth room, so the rounding has room to work
  expect(box.max.z - box.min.z).toBeGreaterThan(2 * radius);
});

test('fillet tangents fall on the lattice when radius is a whole number of units', () => {
  const unit = 10,
    radius = 20;
  const box = roundedGridBox({ x: 0, y: 0, z: -95 }, { x: 171.5, y: 90, z: 0 }, 0.5, radius, unit);
  for (const axis of ['x', 'y', 'z'] as const) {
    expect(onLattice(box.min[axis] + radius, unit)).toBe(true);
    expect(onLattice(box.max[axis] - radius, unit)).toBe(true);
  }
});

test('ring specs: one family per axis; lattice core at full radius, arc-stepped caps that shrink', () => {
  const unit = 10,
    radius = 20,
    fine = 10;
  const min = { x: -30, y: -30, z: -150 };
  const max = { x: 200, y: 120, z: 30 };
  const families = roundedGridRingSpecs(min, max, radius, unit, fine);
  expect(families.map((f) => f.axis)).toEqual(['x', 'y', 'z']);

  const fx = families[0]!;
  const core = fx.rings.filter((r) => r.dAxis === 0);
  const caps = fx.rings.filter((r) => r.dAxis !== 0);

  // Core rings fill the flat band between the fillet tangents, on the `fine` lattice, at full radius.
  const coreCoords = core.map((r) => r.coord).sort((a, b) => a - b);
  expect(coreCoords.length).toBeGreaterThan(0);
  expect(coreCoords[0]!).toBeCloseTo(min.x + radius);
  expect(coreCoords[coreCoords.length - 1]!).toBeCloseTo(max.x - radius);
  expect(coreCoords.every((c) => onLattice(c, fine))).toBe(true);
  expect(core.every((r) => Math.abs(r.w - radius) < 1e-9)).toBe(true);

  // Cap rings step by equal arc, so they land off the lattice — inside the faces, shrinking, on both ends.
  // The φ=0 ring would repeat the tangent and φ=90° is the degenerate pole; both are skipped.
  expect(caps.length).toBeGreaterThan(0);
  expect(caps.every((r) => r.coord > min.x && r.coord < max.x)).toBe(true);
  expect(caps.every((r) => r.w > 0 && r.w < radius)).toBe(true);
  expect(caps.some((r) => r.dAxis > 0)).toBe(true);
  expect(caps.some((r) => r.dAxis < 0)).toBe(true);
  // a cap ring's shrink follows sqrt(radius² − dAxis²)
  expect(
    caps.every((r) => Math.abs(r.w - Math.sqrt(radius * radius - r.dAxis * r.dAxis)) < 1e-9),
  ).toBe(true);

  // perpendicular centre and core half-extents come from the other two axes
  expect([fx.cu, fx.cv]).toEqual([(min.y + max.y) / 2, (min.z + max.z) / 2]);
  expect(fx.coreHalfU).toBeCloseTo((max.y - min.y) / 2 - radius);
});

test('ring specs: imperial half-unit spacing marks only whole-inch core rings as major', () => {
  const unit = 25.4,
    radius = 50.8,
    fine = 12.7; // 1in unit, 2in radius, half-inch spacing
  const { min, max } = roundedGridBox(
    { x: 0, y: 0, z: -101.6 },
    { x: 152.4, y: 203.2, z: 0 },
    0.5,
    radius,
    unit,
  );
  const [, fy] = roundedGridRingSpecs(min, max, radius, unit, fine);
  const core = fy!.rings.filter((r) => r.dAxis === 0);
  const caps = fy!.rings.filter((r) => r.dAxis !== 0);

  // On the flat core, `major` is the whole-inch test applied to the coordinate itself.
  const majors = core.filter((r) => r.major).map((r) => r.coord);
  const minors = core.filter((r) => !r.major).map((r) => r.coord);
  expect(majors.length).toBeGreaterThan(0);
  expect(minors.length).toBeGreaterThan(0);
  expect(majors.every((c) => onLattice(c, unit))).toBe(true);
  expect(minors.every((c) => !onLattice(c, unit))).toBe(true);

  // Cap rings step by arc, so `major` counts whole units of arc from the tangent instead of coordinate.
  const capSteps = Math.round(((Math.PI / 2) * radius) / fine);
  const majorEvery = Math.round(unit / fine);
  const arcStep = (dAxis: number) =>
    Math.round((Math.asin(Math.abs(dAxis) / radius) / (Math.PI / 2)) * capSteps);
  expect(caps.some((r) => r.major)).toBe(true);
  expect(caps.some((r) => !r.major)).toBe(true);
  for (const r of caps) expect(r.major).toBe(arcStep(r.dAxis) % majorEvery === 0);
});
