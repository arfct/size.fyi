import type * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { buildGridRings, gridBox, gridRingSpecs, gridStep } from '../scene';

const unitOf = (units: 'metric' | 'imperial') => (units === 'imperial' ? 25.4 : 10);
const unitMM_ = unitOf;
const onLattice = (v: number, unit: number) => Math.abs(Math.round(v / unit) * unit - v) < 1e-6;

describe('gridBox', () => {
  test('is a cube sized from the largest content dimension, faces on the lattice', () => {
    const unit = 10;
    // content bounds with non-integer faces (device-like widths); largest dimension is x = 171.5
    const min = { x: 0, y: 0, z: -120 },
      max = { x: 171.5, y: 90, z: 0 };
    const box = gridBox(min, max, 0.5, unit, unit);
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

  test('keeps the content enclosed and roughly centred', () => {
    const unit = 10;
    // a phone: only 8.25mm deep, so the cube's depth comes from its 149.6mm height
    const min = { x: 0, y: 0, z: -8.25 },
      max = { x: 71.5, y: 149.6, z: 0 };
    const box = gridBox(min, max, 0.5, unit, unit);
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(box.min[axis]).toBeLessThan(min[axis]);
      expect(box.max[axis]).toBeGreaterThan(max[axis]);
      // content centre sits within half a unit of the room centre on every axis
      const boxMid = (box.min[axis] + box.max[axis]) / 2,
        contentMid = (min[axis] + max[axis]) / 2;
      expect(Math.abs(boxMid - contentMid)).toBeLessThanOrEqual(unit / 2 + 1e-9);
    }
  });

  test('respects minPad for content much smaller than a unit', () => {
    const unit = 10;
    // 2x the content is only 4mm, so the minimum clearance is what sizes this room.
    const box = gridBox({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }, 0.5, 3 * unit, unit);
    expect(box.max.x - box.min.x).toBeGreaterThanOrEqual(2 + 2 * 3 * unit);
  });
});

describe('gridRingSpecs', () => {
  test('one family per axis, rings on the fine lattice and strictly inside the room', () => {
    const unit = 10,
      fine = 10;
    const box = gridBox({ x: 0, y: 0, z: -95 }, { x: 171.5, y: 90, z: 0 }, 0.5, unit, unit);
    const families = gridRingSpecs(box.min, box.max, unit, fine);
    expect(families.map((f) => f.axis)).toEqual(['x', 'y', 'z']);

    for (const fam of families) {
      expect(fam.rings.length).toBeGreaterThan(0);
      const lo = fam.axis === 'x' ? box.min.x : fam.axis === 'y' ? box.min.y : box.min.z;
      const hi = fam.axis === 'x' ? box.max.x : fam.axis === 'y' ? box.max.y : box.max.z;
      for (const r of fam.rings) {
        expect(onLattice(r.coord, fine)).toBe(true);
        expect(r.coord).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(r.coord).toBeLessThanOrEqual(hi + 1e-9);
      }
      // The first and last rings ARE the faces — that's what strokes the room's edges.
      const coords = fam.rings.map((r) => r.coord).sort((a, b) => a - b);
      expect(coords[0]!).toBeCloseTo(lo, 9);
      expect(coords[coords.length - 1]!).toBeCloseTo(hi, 9);
    }
  });

  test('a ring family spans the full side, inclusive of both faces', () => {
    const unit = 10;
    const box = gridBox({ x: 0, y: 0, z: -95 }, { x: 171.5, y: 90, z: 0 }, 0.5, unit, unit);
    const [fx] = gridRingSpecs(box.min, box.max, unit, unit);
    const side = (box.max.x - box.min.x) / unit;
    // n intervals means n+1 lines, because both faces carry one.
    expect(fx!.rings.length).toBe(side + 1);
  });

  test('half-extents come from the other two axes', () => {
    const unit = 10;
    const min = { x: -30, y: -30, z: -150 },
      max = { x: 200, y: 120, z: 30 };
    const [fx] = gridRingSpecs(min, max, unit, unit);
    expect([fx!.cu, fx!.cv]).toEqual([(min.y + max.y) / 2, (min.z + max.z) / 2]);
    expect(fx!.halfU).toBeCloseTo((max.y - min.y) / 2);
    expect(fx!.halfV).toBeCloseTo((max.z - min.z) / 2);
  });

  test('imperial half-unit spacing marks only whole-inch rings as major', () => {
    const unit = 25.4,
      fine = 12.7; // 1in unit, half-inch spacing
    const { min, max } = gridBox(
      { x: 0, y: 0, z: -101.6 },
      { x: 152.4, y: 203.2, z: 0 },
      0.5,
      unit,
      unit,
    );
    const [, fy] = gridRingSpecs(min, max, unit, fine);
    const majors = fy!.rings.filter((r) => r.major).map((r) => r.coord);
    const minors = fy!.rings.filter((r) => !r.major).map((r) => r.coord);
    expect(majors.length).toBeGreaterThan(0);
    expect(minors.length).toBeGreaterThan(0);
    expect(majors.every((c) => onLattice(c, unit))).toBe(true);
    expect(minors.every((c) => !onLattice(c, unit))).toBe(true);
  });
});

describe('walls line up at the edges', () => {
  const content = { min: { x: 0, y: 0, z: -8.25 }, max: { x: 71.5, y: 149.6, z: 0 } };

  test('every face is a whole number of ruling steps from the origin, and the side is too', () => {
    for (const units of ['metric', 'imperial'] as const) {
      const unit = unitOf(units);
      const { fine, snap } = gridStep(units, 149.6, unit);
      const box = gridBox(content.min, content.max, 0.5, unit, snap);
      for (const axis of ['x', 'y', 'z'] as const) {
        // On the ruling lattice, so a line lands exactly on the wall.
        expect(onLattice(box.min[axis], fine)).toBe(true);
        expect(onLattice(box.max[axis], fine)).toBe(true);
        // And on a whole unit, so that line is a major one rather than a half-unit.
        expect(onLattice(box.min[axis], unit)).toBe(true);
        const size = box.max[axis] - box.min[axis];
        expect(Math.abs(size / fine - Math.round(size / fine))).toBeLessThan(1e-9);
      }
    }
  });

  test('the ruling step always divides the snap step, so no cell is ever short', () => {
    // This is the invariant the alignment rests on: either `fine` divides the unit (half-inch lines) or
    // the unit divides `fine` (coarsened), so the larger of the two is a common multiple of both.
    for (const units of ['metric', 'imperial'] as const) {
      for (const span of [20, 150, 400, 2400, 20000]) {
        const { unitMM, fine, snap } = gridStep(units, span, unitMM_(units));
        expect(Math.abs(snap / fine - Math.round(snap / fine))).toBeLessThan(1e-9);
        expect(Math.abs(snap / unitMM - Math.round(snap / unitMM))).toBeLessThan(1e-9);
      }
    }
  });

  test('face rings are major, so the edge stroke is a full-strength line', () => {
    for (const units of ['metric', 'imperial'] as const) {
      const unit = unitOf(units);
      const { unitMM, fine, snap } = gridStep(units, 149.6, unit);
      const box = gridBox(content.min, content.max, 0.5, unit, snap);
      for (const fam of gridRingSpecs(box.min, box.max, unitMM, fine)) {
        const sorted = [...fam.rings].sort((a, b) => a.coord - b.coord);
        expect(sorted[0]!.major).toBe(true);
        expect(sorted[sorted.length - 1]!.major).toBe(true);
      }
    }
  });
});

describe('buildGridRings', () => {
  const box = { min: { x: -85, y: -105, z: -165 }, max: { x: 245, y: 225, z: 165 } };

  // Regression: the room briefly divided by a zero fillet radius, giving 0/0 = NaN at every vertex.
  // Nothing threw, no test failed, and the entire grid silently vanished from the render.
  for (const units of ['metric', 'imperial'] as const) {
    test(`${units}: every position and normal is finite, and something is emitted`, () => {
      const { unitMM, fine } = gridStep(units, 330, unitOf(units));
      const group = buildGridRings(box, unitMM, fine);
      let vertices = 0;
      group.traverse((o) => {
        const geo = (o as THREE.LineSegments).geometry;
        if (!geo?.attributes) return;
        for (const name of ['position', 'normal']) {
          const attr = geo.attributes[name];
          if (!attr) continue;
          for (let i = 0; i < attr.array.length; i++) {
            expect(Number.isFinite(attr.array[i])).toBe(true);
          }
          if (name === 'position') vertices += attr.count;
        }
      });
      // A room with no vertices renders exactly like a NaN one.
      expect(vertices).toBeGreaterThan(0);
    });
  }

  test('emits four edges per ring — eight vertices, not a shared-vertex loop', () => {
    const group = buildGridRings(box, 10, 10);
    let vertices = 0;
    group.traverse((o) => {
      const attr = (o as THREE.LineSegments).geometry?.attributes?.position;
      if (attr) vertices += attr.count;
    });
    const rings = gridRingSpecs(box.min, box.max, 10, 10).reduce((n, f) => n + f.rings.length, 0);
    expect(vertices).toBe(rings * 8);
  });

  test('every normal is a unit axis direction, perpendicular to its ring family', () => {
    // The facing fade depends on these: a corner vertex shared between two walls could only carry one
    // normal, which is why each edge is its own segment pair.
    const group = buildGridRings(box, 10, 10);
    group.traverse((o) => {
      const attr = (o as THREE.LineSegments).geometry?.attributes?.normal;
      if (!attr) return;
      for (let i = 0; i < attr.count; i++) {
        const n = [attr.getX(i), attr.getY(i), attr.getZ(i)];
        expect(Math.hypot(...n)).toBeCloseTo(1, 9);
        // Exactly one component is ±1 and the rest are 0.
        expect(n.filter((v) => Math.abs(Math.abs(v) - 1) < 1e-9)).toHaveLength(1);
        expect(n.filter((v) => Math.abs(v) < 1e-9)).toHaveLength(2);
      }
    });
  });
});
