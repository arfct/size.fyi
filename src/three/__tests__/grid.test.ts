import type * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { buildGridRings, gridBox, gridRingSpecs } from '../scene';

const onLattice = (v: number, unit: number) => Math.abs(Math.round(v / unit) * unit - v) < 1e-6;
// Faces sit mid-cell: half a unit off the lattice, so each face keeps a half-unit margin at every edge
// and two adjacent margins meet as one full cell wrapping the edge.
const onHalfLattice = (v: number, unit: number) =>
  Math.abs((Math.round(v / unit - 0.5) + 0.5) * unit - v) < 1e-6;

describe('gridBox', () => {
  test('is a cube sized from the largest content dimension, faces mid-cell', () => {
    const unit = 10;
    // content bounds with non-integer faces (device-like widths); largest dimension is x = 171.5
    const min = { x: 0, y: 0, z: -120 },
      max = { x: 171.5, y: 90, z: 0 };
    const box = gridBox(min, max, 0.5, unit, unit);
    for (const face of [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]) {
      expect(onHalfLattice(face, unit)).toBe(true);
      expect(onLattice(face, unit)).toBe(false);
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
      for (const r of fam.rings) {
        expect(onLattice(r.coord, fine)).toBe(true);
        // Faces are mid-cell, so no ring can ever land on a wall.
        const lo = fam.axis === 'x' ? box.min.x : fam.axis === 'y' ? box.min.y : box.min.z;
        const hi = fam.axis === 'x' ? box.max.x : fam.axis === 'y' ? box.max.y : box.max.z;
        expect(r.coord).toBeGreaterThan(lo);
        expect(r.coord).toBeLessThan(hi);
      }
    }
  });

  test('a ring family spans the full side, one ring per unit', () => {
    const unit = 10;
    const box = gridBox({ x: 0, y: 0, z: -95 }, { x: 171.5, y: 90, z: 0 }, 0.5, unit, unit);
    const [fx] = gridRingSpecs(box.min, box.max, unit, unit);
    const side = (box.max.x - box.min.x) / unit;
    // Half a unit of margin at each end means exactly `side` interior lattice lines.
    expect(fx!.rings.length).toBe(side);
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

describe('faces sit mid-cell so edges get a whole wrapped cell', () => {
  const unit = 10;

  test('each face is a whole number of units across', () => {
    const box = gridBox({ x: 0, y: 0, z: -8.25 }, { x: 71.5, y: 149.6, z: 0 }, 0.5, unit, unit);
    for (const axis of ['x', 'y', 'z'] as const) {
      const size = box.max[axis] - box.min[axis];
      expect(Math.abs(size / unit - Math.round(size / unit))).toBeLessThan(1e-9);
    }
  });

  test('the margin from each face to its first ruling line is half a unit', () => {
    const box = gridBox({ x: 0, y: 0, z: -8.25 }, { x: 71.5, y: 149.6, z: 0 }, 0.5, unit, unit);
    for (const axis of ['x', 'y', 'z'] as const) {
      const lo = box.min[axis];
      const hi = box.max[axis];
      const firstLine = Math.ceil(lo / unit) * unit;
      const lastLine = Math.floor(hi / unit) * unit;
      expect(firstLine - lo).toBeCloseTo(unit / 2, 9);
      expect(hi - lastLine).toBeCloseTo(unit / 2, 9);
      // The two margins meeting at an edge make one full cell.
      expect(firstLine - lo + (hi - lastLine)).toBeCloseTo(unit, 9);
    }
  });

  test('holds for both unit systems and a range of content sizes', () => {
    for (const u of [10, 25.4]) {
      for (const [w, h, d] of [
        [161.9, 131.5, 8.05],
        [2410, 1370, 200],
        [43, 36, 10.9],
      ]) {
        const box = gridBox({ x: 0, y: 0, z: 0 }, { x: w!, y: h!, z: d! }, 0.5, u, u);
        for (const axis of ['x', 'y', 'z'] as const) {
          expect(onHalfLattice(box.min[axis], u)).toBe(true);
          expect(onHalfLattice(box.max[axis], u)).toBe(true);
          const size = box.max[axis] - box.min[axis];
          expect(Math.abs(size / u - Math.round(size / u))).toBeLessThan(1e-9);
        }
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
      const group = buildGridRings(box, units, 330);
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
    const group = buildGridRings(box, 'metric', 330);
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
    const group = buildGridRings(box, 'metric', 330);
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
