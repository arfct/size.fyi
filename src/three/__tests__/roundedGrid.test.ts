import { expect, test } from 'vitest';
import { roundedGridBox, roundedGridRingSpecs } from '../scene';

const onLattice = (v: number, unit: number) => Math.abs(Math.round(v / unit) * unit - v) < 1e-6;

test('roundedGridBox snaps faces to the unit lattice with at least pad clearance', () => {
  const unit = 10;
  const pad = 30; // 3 units
  // content bounds with non-integer faces (device-like widths)
  const box = roundedGridBox({ x: 0, y: 0, z: -120 }, { x: 171.5, y: 90, z: 0 }, pad, unit);
  for (const face of [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]) {
    expect(onLattice(face, unit)).toBe(true);
  }
  // padding is honoured (>= pad) and minimal (< pad + one unit)
  expect(box.min.x).toBeLessThanOrEqual(0 - pad);
  expect(box.min.x).toBeGreaterThan(0 - pad - unit);
  expect(box.max.x).toBeGreaterThanOrEqual(171.5 + pad);
  expect(box.max.x).toBeLessThan(171.5 + pad + unit);
});

test('fillet tangents fall on the lattice when radius is a whole number of units', () => {
  const unit = 10, pad = 30, radius = 20;
  const box = roundedGridBox({ x: 0, y: 0, z: -95 }, { x: 171.5, y: 90, z: 0 }, pad, unit);
  for (const axis of ['x', 'y', 'z'] as const) {
    expect(onLattice(box.min[axis] + radius, unit)).toBe(true);
    expect(onLattice(box.max[axis] - radius, unit)).toBe(true);
  }
});

test('ring specs: one family per axis; rings span the full axis with full-radius core, shrinking caps', () => {
  const unit = 10, radius = 20, fine = 10;
  const min = { x: -30, y: -30, z: -150 };
  const max = { x: 200, y: 120, z: 30 };
  const families = roundedGridRingSpecs(min, max, radius, unit, fine);
  expect(families.map((f) => f.axis)).toEqual(['x', 'y', 'z']);

  const fx = families[0]!;
  const coords = fx.rings.map((r) => r.coord);
  // full span [min.x, max.x] minus the degenerate w≈0 endpoints (x=-30 and x=200 dropped)
  expect(coords[0]).toBeCloseTo(-20);
  expect(coords[coords.length - 1]!).toBeCloseTo(190);
  expect(coords.every((c) => onLattice(c, fine))).toBe(true);
  // core rings carry the full radius; cap rings shrink; none exceeds the radius
  const core = fx.rings.filter((r) => r.dAxis === 0);
  expect(core.length).toBeGreaterThan(0);
  expect(core.every((r) => Math.abs(r.w - radius) < 1e-9)).toBe(true);
  expect(fx.rings.every((r) => r.w > 0 && r.w <= radius + 1e-9)).toBe(true);
  // a cap ring's shrink follows sqrt(radius² − dAxis²)
  const cap = fx.rings.find((r) => r.dAxis !== 0)!;
  expect(cap.w).toBeCloseTo(Math.sqrt(radius * radius - cap.dAxis * cap.dAxis));
  // perpendicular centre and core half-extents come from the other two axes
  expect([fx.cu, fx.cv]).toEqual([(min.y + max.y) / 2, (min.z + max.z) / 2]);
  expect(fx.coreHalfU).toBeCloseTo((max.y - min.y) / 2 - radius);
});

test('ring specs: imperial half-unit spacing marks only whole-inch rings as major', () => {
  const unit = 25.4, radius = 50.8, fine = 12.7; // 1in unit, 2in radius, half-inch spacing
  const { min, max } = roundedGridBox({ x: 0, y: 0, z: -101.6 }, { x: 152.4, y: 203.2, z: 0 }, 3 * unit, unit);
  const [, fy] = roundedGridRingSpecs(min, max, radius, unit, fine);
  const majors = fy!.rings.filter((r) => r.major).map((r) => r.coord);
  const minors = fy!.rings.filter((r) => !r.major).map((r) => r.coord);
  expect(majors.length).toBeGreaterThan(0);
  expect(minors.length).toBeGreaterThan(0);
  expect(majors.every((c) => onLattice(c, unit))).toBe(true);
  expect(minors.every((c) => !onLattice(c, unit))).toBe(true);
});
