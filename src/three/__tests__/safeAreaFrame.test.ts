import * as THREE from 'three';
import { expect, test } from 'vitest';
import { applyViewOffset, safeAreaFrame } from '../scene';

test('with no inset, the safe area is the full frame', () => {
  const frame = safeAreaFrame(1200, 800, 0);
  expect(frame).toEqual({ width: 1200, height: 800, safeW: 1200, safeH: 800, aspect: 1200 / 800 });
});

test('a left inset shrinks the safe-area width and aspect, not the full width', () => {
  const frame = safeAreaFrame(1200, 800, 320);
  expect(frame.width).toBe(1200);
  expect(frame.safeW).toBe(880);
  expect(frame.aspect).toBeCloseTo(880 / 800);
});

test('a top inset shrinks the safe-area height and aspect, not the full height', () => {
  const frame = safeAreaFrame(1200, 800, 0, 64);
  expect(frame.height).toBe(800);
  expect(frame.safeH).toBe(736);
  expect(frame.aspect).toBeCloseTo(1200 / 736);
});

test('degenerate inputs are clamped to stay at least 1px', () => {
  expect(safeAreaFrame(0, 0, 0)).toEqual({ width: 1, height: 1, safeW: 1, safeH: 1, aspect: 1 });
  expect(safeAreaFrame(100, 100, -50)).toMatchObject({ safeW: 100 }); // negative inset ignored
  expect(safeAreaFrame(100, 100, 500)).toMatchObject({ safeW: 1 }); // inset larger than width
  expect(safeAreaFrame(100, 100, 0, 500)).toMatchObject({ safeH: 1 }); // top inset larger than height
});

// --- Projection wiring: does the real applyViewOffset()/setViewOffset() call actually keep the
// safe-area framing intact? The arithmetic tests above cover safeAreaFrame in isolation, but an
// arg swap or sign flip in applyViewOffset's setViewOffset call would still pass them. These
// tests go through applyViewOffset itself (same helper, same argument order scene.ts uses) and
// verify the resulting projection against a reference camera fit to the safe area with no offset
// at all — i.e. what the camera would see if the canvas really were only the right-hand column.
//
// Both cameras share the default identity transform (position 0,0,0, no rotation), so
// unprojecting the same NDC point through each is a direct, robust way to compare frustum edges
// without hand-deriving matrix-element formulas (which vary with near/far/coordinate system and
// are easy to get subtly wrong).

const FULL_W = 1280;
const HEIGHT = 800;
const INSET = 320; // aside width
const FRAME = safeAreaFrame(FULL_W, HEIGHT, INSET); // safeW = 960, aspect = 1.2

test('perspective: setViewOffset keeps the right edge fixed and extends the left edge by the inset fraction', () => {
  const reference = new THREE.PerspectiveCamera(40, FRAME.aspect, 1, 1e6);
  reference.updateProjectionMatrix(); // no offset — as if the canvas were only the safe area

  const offset = new THREE.PerspectiveCamera(40, FRAME.aspect, 1, 1e6);
  applyViewOffset(offset, FRAME, INSET); // the real production wiring
  offset.updateProjectionMatrix();

  // Unproject the frustum's right and left edges (NDC x = +1/-1) at an arbitrary depth.
  const rightRef = new THREE.Vector3(1, 0, 0.5).unproject(reference);
  const rightOffset = new THREE.Vector3(1, 0, 0.5).unproject(offset);
  const leftRef = new THREE.Vector3(-1, 0, 0.5).unproject(reference);
  const leftOffset = new THREE.Vector3(-1, 0, 0.5).unproject(offset);

  // Right edge: identical between offset and no-offset cameras — the safe-area framing is
  // unchanged even though the offset camera renders a wider (full-canvas) region.
  expect(rightOffset.x).toBeCloseTo(rightRef.x, 10);
  expect(rightOffset.y).toBeCloseTo(rightRef.y, 10);
  expect(rightOffset.z).toBeCloseTo(rightRef.z, 10);

  // Left edge: extends further left than the reference by exactly inset/safeW of the reference
  // frustum's width — i.e. the rendered region grows to cover the sidebar, proportionally.
  const refWidth = rightRef.x - leftRef.x;
  const expectedLeftOffsetX = leftRef.x - (INSET / FRAME.safeW) * refWidth;
  expect(leftOffset.x).toBeCloseTo(expectedLeftOffsetX, 10);
});

test('perspective: a top inset keeps the bottom edge fixed and extends the top edge upward', () => {
  // The control strip sits at the top, so the safe area anchors to the bottom of the canvas and
  // the rendered region extends upward into the strip — the vertical mirror of the left-inset case.
  const TOP = 160;
  const topFrame = safeAreaFrame(FULL_W, HEIGHT, 0, TOP); // safeH = 640
  const reference = new THREE.PerspectiveCamera(40, topFrame.aspect, 1, 1e6);
  reference.updateProjectionMatrix();

  const offset = new THREE.PerspectiveCamera(40, topFrame.aspect, 1, 1e6);
  applyViewOffset(offset, topFrame, 0, TOP);
  offset.updateProjectionMatrix();

  const topRef = new THREE.Vector3(0, 1, 0.5).unproject(reference);
  const topOffset = new THREE.Vector3(0, 1, 0.5).unproject(offset);
  const bottomRef = new THREE.Vector3(0, -1, 0.5).unproject(reference);
  const bottomOffset = new THREE.Vector3(0, -1, 0.5).unproject(offset);

  // Bottom edge unchanged — the safe-area content stays anchored to the bottom of the canvas.
  expect(bottomOffset.y).toBeCloseTo(bottomRef.y, 10);
  // Top edge extends further up by exactly insetTop/safeH of the reference frustum's height.
  const refHeight = topRef.y - bottomRef.y;
  const expectedTopY = topRef.y + (TOP / topFrame.safeH) * refHeight;
  expect(topOffset.y).toBeCloseTo(expectedTopY, 10);
});

test('orthographic: setViewOffset keeps the right edge fixed for a fit frustum', () => {
  // Mirrors scene.ts's ortho fit() math for an arbitrary bounds size, at the safe-area aspect.
  const fit = (fw: number, fh: number, aspect: number) => {
    const m = 1.1;
    const half = ((Math.max(fw / aspect, fh) * m) / 2) * Math.max(aspect, 1);
    const left = -half * (aspect >= 1 ? 1 : aspect);
    const right = -left;
    const top = right / aspect;
    const bottom = -top;
    return { left, right, top, bottom };
  };
  const { left, right, top, bottom } = fit(200, 150, FRAME.aspect);

  const reference = new THREE.OrthographicCamera(left, right, top, bottom, 1, 1e6);
  reference.updateProjectionMatrix();

  const offset = new THREE.OrthographicCamera(left, right, top, bottom, 1, 1e6);
  applyViewOffset(offset, FRAME, INSET);
  offset.updateProjectionMatrix();

  const rightRef = new THREE.Vector3(1, 0, 0.5).unproject(reference);
  const rightOffset = new THREE.Vector3(1, 0, 0.5).unproject(offset);
  expect(rightOffset.x).toBeCloseTo(rightRef.x, 6);
  expect(rightOffset.y).toBeCloseTo(rightRef.y, 6);
  expect(rightOffset.z).toBeCloseTo(rightRef.z, 6);
});

test('with zero inset, applyViewOffset clears any existing offset instead of applying one', () => {
  const withOffset = new THREE.PerspectiveCamera(40, FRAME.aspect, 1, 1e6);
  applyViewOffset(withOffset, FRAME, INSET);
  withOffset.updateProjectionMatrix();
  expect(withOffset.view).not.toBeNull();

  // Simulate the sidebar going away (mobile / setInset(0)): re-applying with inset 0 must
  // clear the stale offset rather than leaving it in place or setting a zero-width one.
  // (scene.ts always re-sets `.aspect` from the fresh frame before calling applyViewOffset —
  // mirrored here — since the safe area itself widens back out once the inset disappears.)
  const zeroFrame = safeAreaFrame(FULL_W, HEIGHT, 0);
  withOffset.aspect = zeroFrame.aspect;
  applyViewOffset(withOffset, zeroFrame, 0);
  withOffset.updateProjectionMatrix();
  // three's clearViewOffset() disables rather than nulls the `view` record — the meaningful
  // check is that it's disabled (so updateProjectionMatrix ignores it), verified below by
  // comparing the resulting matrix against a camera that never had an offset at all.
  expect(withOffset.view?.enabled).toBe(false);

  const plain = new THREE.PerspectiveCamera(40, zeroFrame.aspect, 1, 1e6);
  plain.updateProjectionMatrix();
  expect(withOffset.projectionMatrix.elements).toEqual(plain.projectionMatrix.elements);
});
