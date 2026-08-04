import { expect, test } from 'vitest';
import { cornerRadii, roundedRectShape } from '../geometry';

// roundedRectShape used to write its four corners out longhand, each with the same radius. It is now
// one parameterised block walked four times, which is what makes per-corner radii possible. These
// first cases are the receipt that the rewrite changed nothing for equal corners: the reference
// numbers were captured from the longhand version before it was replaced.
//
// A device's four corners are described as one outer radius plus an optional inner one on the hinge
// side (see cornerRadii), not as four loose numbers — a fold's inner corners are a fact about the
// device, and picking which two they are is the geometry's job, not the catalog author's.

const bounds = (pts: { x: number; y: number }[]) => ({
  minX: Math.min(...pts.map((p) => p.x)),
  maxX: Math.max(...pts.map((p) => p.x)),
  minY: Math.min(...pts.map((p) => p.y)),
  maxY: Math.max(...pts.map((p) => p.y)),
});

// How far in from the corner of the bounding box the outline sits, measured along the diagonal. A
// bigger radius cuts the corner deeper, so this is a monotone proxy for "how round is that corner".
function cornerInset(
  pts: { x: number; y: number }[],
  corner: 'tl' | 'tr' | 'br' | 'bl',
  W: number,
  H: number,
) {
  const cx = corner === 'tl' || corner === 'bl' ? -W / 2 : W / 2;
  const cy = corner === 'tl' || corner === 'tr' ? H / 2 : -H / 2;
  return Math.min(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)));
}

test('equal corners still produce the exact outline the longhand version did', () => {
  // Uniform r=11 on the Z Fold8's closed face. These numbers were read off the longhand version, not
  // off this one: at the time of the change the two were compared point-for-point to 9 decimal places
  // across 81.9x123.9 r=11, 161.4x123.9 r=9, 75x150 r=12, and 40x40 r=19 (a radius clamped by the
  // budget). 212 = four corners of 16 + 20 + 16 samples, plus the start point and three straight runs.
  const pts = roundedRectShape(81.9, 123.9, 11).getPoints(1);
  expect(pts.length).toBe(212);
  const b = bounds(pts);
  expect(b.maxX).toBeCloseTo(40.95, 9);
  expect(b.minX).toBeCloseTo(-40.95, 9);
  expect(b.maxY).toBeCloseTo(61.95, 9);
  expect(b.minY).toBeCloseTo(-61.95, 9);
  // All four corners cut in by the same amount, since they share a radius.
  const insets = (['tl', 'tr', 'br', 'bl'] as const).map((c) => cornerInset(pts, c, 81.9, 123.9));
  for (const i of insets) expect(i).toBeCloseTo(insets[0]!, 9);
  expect(insets[0]).toBeCloseTo(4.556349186104037, 9);
});

test('a square rect is still four points', () => {
  expect(roundedRectShape(10, 20, 0).getPoints(1).length).toBe(4);
});

test('a smaller inner radius cuts those corners less deeply', () => {
  const W = 81.9;
  const H = 123.9;
  const pts = roundedRectShape(W, H, cornerRadii(11, 2, 'left')).getPoints(1);
  const tl = cornerInset(pts, 'tl', W, H);
  const tr = cornerInset(pts, 'tr', W, H);
  const bl = cornerInset(pts, 'bl', W, H);
  const br = cornerInset(pts, 'br', W, H);
  // Hinge on the left, so the left pair is the tight one and the right pair keeps the full radius.
  expect(tl).toBeCloseTo(bl, 9);
  expect(tr).toBeCloseTo(br, 9);
  expect(tl).toBeLessThan(tr);
  // And the outer pair is untouched by the inner value.
  const uniform = roundedRectShape(W, H, 11).getPoints(1);
  expect(tr).toBeCloseTo(cornerInset(uniform, 'tr', W, H), 9);
});

test('the outline still fills its box whatever the corners do', () => {
  for (const radii of [
    cornerRadii(11, 2, 'left'),
    cornerRadii(11, 0, 'right'),
    cornerRadii(18, 2, 'bottom'),
    cornerRadii(9, 9, 'top'),
  ]) {
    const b = bounds(roundedRectShape(81.9, 123.9, radii).getPoints(1));
    expect(b.maxX).toBeCloseTo(40.95, 6);
    expect(b.minX).toBeCloseTo(-40.95, 6);
    expect(b.maxY).toBeCloseTo(61.95, 6);
    expect(b.minY).toBeCloseTo(-61.95, 6);
  }
});

test('an inner radius of zero gives genuinely square corners on that side', () => {
  const pts = roundedRectShape(81.9, 123.9, cornerRadii(11, 0, 'left')).getPoints(1);
  // The box corner itself is on the outline, which only happens when nothing is cut off it.
  expect(cornerInset(pts, 'tl', 81.9, 123.9)).toBeCloseTo(0, 9);
  expect(cornerInset(pts, 'tr', 81.9, 123.9)).toBeGreaterThan(1);
});

test('over-large radii are clamped rather than allowed to overrun the box', () => {
  // Both corners of the short edge asking for more than the whole edge. p is capped at half the
  // shorter side per corner, so two on one edge can meet but never cross.
  const b = bounds(roundedRectShape(81.9, 123.9, cornerRadii(999, 999, 'left')).getPoints(1));
  expect(b.maxX).toBeLessThanOrEqual(40.95 + 1e-9);
  expect(b.maxY).toBeLessThanOrEqual(61.95 + 1e-9);
});

test('cornerRadii puts the inner pair on the hinge edge, in CSS order', () => {
  // [tl, tr, br, bl] — the same order and winding as CSS border-radius.
  expect(cornerRadii(11, 2, 'left')).toEqual([2, 11, 11, 2]);
  expect(cornerRadii(11, 2, 'right')).toEqual([11, 2, 2, 11]);
  expect(cornerRadii(11, 2, 'top')).toEqual([2, 2, 11, 11]);
  expect(cornerRadii(11, 2, 'bottom')).toEqual([11, 11, 2, 2]);
});

test('cornerRadii with no inner radius is a plain uniform radius', () => {
  expect(cornerRadii(11, undefined, 'left')).toBe(11);
  // Which matters: it keeps the 60 non-foldable devices on the identical code path.
  expect(cornerRadii(0, undefined, 'left')).toBe(0);
});
