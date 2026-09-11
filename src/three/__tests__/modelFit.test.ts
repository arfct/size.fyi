import { expect, test } from 'vitest';
import { modelFit } from '../geometry';

// A phone authored at true millimetre scale: body 71.9 × 150 × 8.75 centred on x/y, its front face at
// +4.375, and a camera plateau standing 4 mm proud of the BACK (so the box runs to -8.375 in z).
const phone = {
  min: { x: -35.95, y: -75, z: -8.375 },
  max: { x: 35.95, y: 75, z: 4.375 },
};
const target = { w: 71.9, h: 150, d: 8.75 };
// The transform is applied scale-first: v * scale + translate.
const apply = (v: { x: number; y: number; z: number }, f: ReturnType<typeof modelFit>) => ({
  x: v.x * f.scale.x + f.translate.x,
  y: v.y * f.scale.y + f.translate.y,
  z: v.z * f.scale.z + f.translate.z,
});

test('stretch fills the target exactly, which is what a bumpless model wants', () => {
  const box = { min: { x: -1, y: -2, z: -0.5 }, max: { x: 1, y: 2, z: 0.5 } };
  const f = modelFit(box, target, 'stretch');
  expect(apply(box.max, f)).toEqual({ x: 35.95, y: 75, z: 4.375 });
  expect(apply(box.min, f)).toEqual({ x: -35.95, y: -75, z: -4.375 });
});

test('stretch re-centres a model authored off the origin', () => {
  const box = { min: { x: 10, y: 10, z: 10 }, max: { x: 12, y: 14, z: 11 } };
  const f = modelFit(box, target, 'stretch');
  expect(apply(box.max, f).x).toBeCloseTo(35.95, 6);
  expect(apply(box.min, f).x).toBeCloseTo(-35.95, 6);
});

test('uniform keeps one ratio on every axis, so the plateau is not squashed', () => {
  const f = modelFit(phone, target, 'uniform');
  expect(f.scale.x).toBeCloseTo(f.scale.y, 9);
  expect(f.scale.y).toBeCloseTo(f.scale.z, 9);
});

test('uniform puts the front face on +d/2, where the screen is drawn', () => {
  const f = modelFit(phone, target, 'uniform');
  expect(apply(phone.max, f).z).toBeCloseTo(target.d / 2, 9);
});

test('uniform lets the bump stand proud of the quoted depth instead of compressing the body', () => {
  const f = modelFit(phone, target, 'uniform');
  // Authored at true scale, so it should pass through untouched: body still 8.75 deep.
  expect(f.scale.x).toBeCloseTo(1, 9);
  const back = apply(phone.min, f).z;
  expect(back).toBeCloseTo(-8.375, 9);
  // The model is deeper than the catalog depth, and that is the point.
  expect(apply(phone.max, f).z - back).toBeGreaterThan(target.d);
});

test('uniform rescales a model authored in other units and still lands the front face', () => {
  const metres = {
    min: { x: -0.03595, y: -0.075, z: -0.008375 },
    max: { x: 0.03595, y: 0.075, z: 0.004375 },
  };
  const f = modelFit(metres, target, 'uniform');
  expect(f.scale.x).toBeCloseTo(1000, 6);
  expect(apply(metres.max, f).z).toBeCloseTo(target.d / 2, 9);
  expect(apply(metres.max, f).x).toBeCloseTo(35.95, 6);
});

test('uniform centres width and height on the item, wherever the model was authored', () => {
  const offset = {
    min: { x: 100 - 35.95, y: 200 - 75, z: -8.375 },
    max: { x: 100 + 35.95, y: 200 + 75, z: 4.375 },
  };
  const f = modelFit(offset, target, 'uniform');
  expect(apply(offset.max, f).x).toBeCloseTo(35.95, 6);
  expect(apply(offset.min, f).x).toBeCloseTo(-35.95, 6);
  expect(apply(offset.max, f).y).toBeCloseTo(75, 6);
});

test('a degenerate axis does not produce a NaN transform', () => {
  const flat = { min: { x: -1, y: -2, z: 0 }, max: { x: 1, y: 2, z: 0 } };
  for (const mode of ['stretch', 'uniform'] as const) {
    const f = modelFit(flat, target, mode);
    for (const v of [f.scale, f.translate])
      for (const n of [v.x, v.y, v.z]) expect(Number.isFinite(n)).toBe(true);
  }
});
