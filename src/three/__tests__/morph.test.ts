import { expect, test } from 'vitest';
import { morphStep, view3dCameraDistance } from '../scene';

// The projection switch used to lerp between the two cameras' projection matrices. That's a valid
// projective transform at every step — straight lines stay straight — but it isn't perceptually even:
// the perspective divide collapses at the very end, so the content held roughly still and then lurched
// 12% larger over the last 1.3% of the timeline. It read as two things happening in sequence.
//
// The morph replaces it with a dolly zoom: back away while narrowing the lens, so every frame is a real
// perspective projection converging on the orthographic one. These tests are about the evenness that
// buys, not about the endpoints, which any interpolation gets right.

const VIEW_FOV = 40;
const VIEW_ORTHO_DOLLY = 50;

// A 150x75x8 phone, the shape the 3D view is usually framing.
const near = view3dCameraDistance(150);
const TO_ORTHO = {
  fromDist: near,
  toDist: near * VIEW_ORTHO_DOLLY,
  fromHalfH: near * Math.tan(((VIEW_FOV / 2) * Math.PI) / 180),
  toHalfH: 88.9, // the ortho fit for that phone: half the bounding sphere, times ORTHO_MARGIN
};

// How large a probe of half-height H appears on screen, as a fraction of the frame. Placed half a box
// in FRONT of the centre rather than at it: at the centre the apparent size depends only on the framed
// height, so it would hide exactly the perspective change the morph is supposed to spread out.
const H = 75;
const Z = 75;
function apparentSize(m: typeof TO_ORTHO, e: number) {
  const { dist, halfH } = morphStep(m, e);
  return (H * dist) / (halfH * (dist - Z));
}

const stepsOver = (m: typeof TO_ORTHO, n: number) => {
  const xs = Array.from({ length: n + 1 }, (_, i) => apparentSize(m, i / n));
  return xs.slice(1).map((v, i) => v / xs[i]! - 1);
};

test('apparent size changes at a near-constant rate across the whole morph', () => {
  const steps = stepsOver(TO_ORTHO, 40);
  const min = Math.min(...steps.map(Math.abs));
  const max = Math.max(...steps.map(Math.abs));
  // Under 2x between the slowest and fastest fortieth. The matrix lerp was two orders of magnitude
  // worse than that by this measure.
  expect(max / min).toBeLessThan(2);
});

test('the last step is no bigger than the typical one — nothing is saved up for the end', () => {
  const steps = stepsOver(TO_ORTHO, 40).map(Math.abs);
  const median = [...steps].sort((a, b) => a - b)[Math.floor(steps.length / 2)]!;
  expect(steps.at(-1)!).toBeLessThan(2 * median);
});

test('apparent size is monotonic — the content never doubles back', () => {
  const steps = stepsOver(TO_ORTHO, 200);
  expect(steps.every((s) => s < 0)).toBe(true);
});

test('the morph starts at the real perspective lens', () => {
  // Not an approximation of it: at e=0 the camera is exactly where the perspective view already had it,
  // so the first frame is a no-op and nothing snaps.
  expect(morphStep(TO_ORTHO, 0).dist).toBeCloseTo(near, 6);
  expect(morphStep(TO_ORTHO, 0).fovDeg).toBeCloseTo(VIEW_FOV, 6);
});

test('the swap to the real orthographic camera has almost no perspective left to lose', () => {
  const { dist, halfH } = morphStep(TO_ORTHO, 1);
  expect(halfH).toBeCloseTo(TO_ORTHO.toHalfH, 6);
  // Near face vs far face of the box, which under a true orthographic camera are identical. Half a
  // percent is well under what reads as a step at the moment of the swap.
  const spread = dist / (dist - Z) - dist / (dist + Z);
  expect(spread / 2).toBeLessThan(0.01);
});

test('reversing the morph retraces the same path', () => {
  // Switching back to perspective is the same interpolation with the endpoints exchanged, so the two
  // directions have to agree frame for frame — otherwise a switch and a switch-back would take
  // visibly different routes.
  const back = {
    fromDist: TO_ORTHO.toDist,
    toDist: TO_ORTHO.fromDist,
    fromHalfH: TO_ORTHO.toHalfH,
    toHalfH: TO_ORTHO.fromHalfH,
  };
  for (const e of [0, 0.25, 0.5, 0.75, 1]) {
    expect(morphStep(back, 1 - e).dist).toBeCloseTo(morphStep(TO_ORTHO, e).dist, 6);
    expect(morphStep(back, 1 - e).fovDeg).toBeCloseTo(morphStep(TO_ORTHO, e).fovDeg, 6);
  }
});

test('distance is interpolated reciprocally, not linearly', () => {
  // The distinction the whole thing rests on: apparent size goes as 1/d, so a linear walk in d would
  // spend most of the timeline nearly stationary out at the far end. Halfway through, the camera should
  // be at the harmonic mean of the two distances, far short of the arithmetic one.
  const half = morphStep(TO_ORTHO, 0.5).dist;
  const harmonic = 2 / (1 / TO_ORTHO.fromDist + 1 / TO_ORTHO.toDist);
  expect(half).toBeCloseTo(harmonic, 6);
  expect(half).toBeLessThan((TO_ORTHO.fromDist + TO_ORTHO.toDist) / 4);
});
