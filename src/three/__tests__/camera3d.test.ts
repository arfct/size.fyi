import { describe, expect, test } from 'vitest';
import { view3dCameraDistance, view3dCameraOffset } from '../scene';

// The perspective and orthographic cameras look from different directions, but they must sit the SAME
// distance from the content. The transition lerps position and projection independently, so any
// difference in distance shows up as the camera flying out and back while the projection morphs.
// Orthographic used to sit at `far`, which was 4x to 14x too far depending on content size.
const PERSPECTIVE = { x: 1.2, y: 0.9, z: 1.6 };
const ORTHOGRAPHIC = { x: 1, y: 1, z: 1 };
const SIZES = [1, 43, 90, 330, 2400, 20000];

const len = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);

describe('3D camera placement', () => {
  test('both projections sit at exactly the same distance', () => {
    for (const size of SIZES) {
      const p = len(view3dCameraOffset(size, PERSPECTIVE));
      const i = len(view3dCameraOffset(size, ORTHOGRAPHIC));
      expect(i / p).toBeCloseTo(1, 12);
    }
  });

  test('the offset points along the direction it was given', () => {
    for (const dir of [PERSPECTIVE, ORTHOGRAPHIC]) {
      const off = view3dCameraOffset(330, dir);
      // Same unit direction: each component scaled by the same positive factor.
      const k = off.x / dir.x;
      expect(k).toBeGreaterThan(0);
      expect(off.y / dir.y).toBeCloseTo(k, 9);
      expect(off.z / dir.z).toBeCloseTo(k, 9);
    }
  });

  test('distance scales with content and never collapses to zero', () => {
    expect(view3dCameraDistance(330)).toBeCloseTo(view3dCameraDistance(33) * 10, 6);
    // An empty or degenerate scene still needs the camera somewhere sane.
    expect(view3dCameraDistance(0)).toBeGreaterThan(0);
    expect(view3dCameraDistance(0)).toBe(view3dCameraDistance(1));
  });

  test('the camera clears the content it is framing', () => {
    // Half the largest dimension is the furthest the content reaches from its own centre along an axis,
    // so anything less would put the camera inside the bounding box.
    for (const size of SIZES) expect(view3dCameraDistance(size)).toBeGreaterThan(size / 2);
  });
});
