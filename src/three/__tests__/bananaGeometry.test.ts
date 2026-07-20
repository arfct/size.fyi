import { expect, test } from 'vitest';
import * as THREE from 'three';
import { buildBananaGeometry } from '../scene';

test('buildBananaGeometry normalizes to an exact, centered w×h×d bounding box', () => {
  const geo = buildBananaGeometry(190, 80, 35);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());

  expect(size.x).toBeCloseTo(190, 6);
  expect(size.y).toBeCloseTo(80, 6);
  expect(size.z).toBeCloseTo(35, 6);

  const center = bb.getCenter(new THREE.Vector3());
  expect(center.x).toBeCloseTo(0, 6);
  expect(center.y).toBeCloseTo(0, 6);
  expect(center.z).toBeCloseTo(0, 6);
});

test('buildBananaGeometry produces no NaN positions', () => {
  const geo = buildBananaGeometry(190, 80, 35);
  const pos = geo.attributes.position!.array;
  for (const v of pos) expect(Number.isNaN(v)).toBe(false);
});

test('buildBananaGeometry vertex/triangle counts match the 24 ring × 12 segment + 2 cap-center formula', () => {
  const geo = buildBananaGeometry(190, 80, 35);
  // N=24 rings * M=12 segments per ring, plus 2 spine-endpoint cap centers.
  expect(geo.attributes.position!.count).toBe(24 * 12 + 2);
  expect(geo.attributes.position!.count).toBe(290);

  // Body: (N-1) quads-per-ring-gap * M segments * 2 triangles, plus M triangles per cap * 2 caps.
  const bodyTriangles = (24 - 1) * 12 * 2;
  const capTriangles = 12 * 2;
  expect(geo.index!.count / 3).toBe(bodyTriangles + capTriangles);
  expect(geo.index!.count / 3).toBe(576);
});
