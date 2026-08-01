import { type RefObject, useEffect, useRef, useState } from 'react';
import { itemDims } from '../../shared/types';
import type { SizeScene } from '../../three/scene';
import { colorFor, itemColor } from '../palette';
import { useComparison } from '../store';
import { useIsDesktop } from '../useIsDesktop';

// Shown in the empty viewer as a size primer: three cubes at 6/9/12 cm. Display-only — not real
// comparison items, so they never enter the sidebar list or the shareable URL.
const PLACEHOLDER_CUBES = [
  { name: '6 cm', h: 60, w: 60, d: 60 },
  { name: '9 cm', h: 90, w: 90, d: 90 },
  { name: '12 cm', h: 120, w: 120, d: 120 },
];

interface ViewerProps {
  // The floating sidebar's element, when one is floating above this canvas (md+ full-bleed
  // layout). Its live width becomes the camera's left inset. Omitted for the mobile, contained
  // viewer, where there's no overlapping sidebar and inset is always 0.
  asideRef?: RefObject<HTMLElement | null>;
}

// Vertical room (px) reserved at the top of the mobile canvas. The canvas draws full-bleed up
// under the sticky top toolbar (App pulls it up with -mt-14); this inset matches that toolbar's
// height (h-14 = 56px) so the framed model centers in the space that stays visible below it.
// Desktop reserves horizontal room for the sidebar instead, not this.
const MOBILE_TOP_INSET = 56;

export default function Viewer({ asideRef }: ViewerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SizeScene | null>(null);
  const { state, dispatch } = useComparison();
  const [unavailable, setUnavailable] = useState(false);
  const [ready, setReady] = useState(false); // flips true once the lazy 3D chunk has created the scene
  const isDesktop = useIsDesktop();

  // Lazy-load the Three.js scene as its own chunk so first paint (and the no-WebGL table fallback)
  // don't block on the 3D engine. `ready` re-runs the state-sync effects below once it's created.
  useEffect(() => {
    if (!ref.current) return;
    let disposed = false;
    import('../../three/scene')
      .then(({ createScene }) => {
        if (disposed || !ref.current) return;
        try {
          // A drag in a flat view turns it into an orbit, which is the one place the scene changes
          // view (and projection) on its own. dispatch is stable, so the effect still runs once.
          sceneRef.current = createScene(ref.current, {
            onViewChange: (view) => dispatch({ type: 'setView', view }),
            onProjectionChange: (projection) => dispatch({ type: 'setProjection', projection }),
          });
          setReady(true);
        } catch {
          setUnavailable(true); /* WebGL unavailable; table remains */
        }
      })
      .catch(() => setUnavailable(true));
    return () => {
      disposed = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [dispatch]);

  // Measures the floating sidebar's width and feeds it to the scene as a left inset, so the
  // camera keeps framing the safe area (right of the sidebar) while the canvas itself spans the
  // full width. Declared after the scene-creation effect above so sceneRef.current is already
  // populated by the time this one runs on mount.
  // Each of the sync effects below reads `ready` in its own guard rather than just listing it as a
  // dependency: sceneRef is a ref and so isn't reactive, and the flag is the only thing that re-runs
  // them once the lazy chunk has created the scene.
  useEffect(() => {
    const scene = ready ? sceneRef.current : null;
    if (!scene) return;
    const aside = asideRef?.current;
    // Mobile: no horizontal inset (canvas is full-width), but reserve vertical room at the top
    // for the overlapping segmented control. Desktop-without-aside: no inset at all.
    if (!aside || !isDesktop) {
      scene.setInset(0, isDesktop ? 0 : MOBILE_TOP_INSET);
      return;
    }
    const update = () => scene.setInset(aside.getBoundingClientRect().width, 0);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(aside);
    return () => ro.disconnect();
  }, [asideRef, isDesktop, ready]);

  useEffect(() => {
    if (!ready) return;
    const items =
      state.items.length > 0
        ? state.items.map((item, i) => {
            const dims = itemDims(item); // resolves the active state for foldables
            return {
              name: item.kind === 'device' ? item.device.name : item.name,
              h: dims.h,
              w: dims.w,
              d: dims.d,
              radius: dims.radius,
              radiusAxis: dims.radiusAxis,
              screen: dims.screen,
              seam: dims.seam,
              mesh: item.kind === 'device' ? item.device.mesh : undefined,
              model3d: item.kind === 'device' ? item.device.model3d : undefined,
              color: itemColor(item, i),
            };
          })
        : PLACEHOLDER_CUBES.map((c, i) => ({ ...c, color: colorFor(i) }));
    sceneRef.current?.setItems(items);
  }, [state.items, ready]);

  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setView(state.view);
  }, [state.view, ready]);

  // Side view looks along +x, which is the axis a row spreads along — every item would sit directly
  // behind the nearest one and only the front one would be visible. Stack spreads along z instead, so
  // the items stay separate and the view reads as a depth comparison.
  //
  // Derived rather than dispatched: the store keeps the user's own choice untouched, so it comes back on
  // its own when they leave side view, with no previous-value to stash and nothing to get out of sync if
  // they change layout while they're in there. The layout controls stay bound to their real preference,
  // which is what will apply everywhere else.
  const effectiveLayout = state.view === 'side' ? 'stack' : state.layoutMode;

  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setLayout(effectiveLayout);
  }, [effectiveLayout, ready]);

  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setUnits(state.units);
  }, [state.units, ready]);

  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setProjection(state.projection);
  }, [state.projection, ready]);

  // Hovering a sidebar row picks out its item in the scene. The index is into state.items, which is the
  // same array and order setItems was given, so no key translation is needed here.
  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setHighlight(state.hovered);
  }, [state.hovered, ready]);

  return (
    <div ref={ref} className="relative h-full min-h-[320px] w-full" data-testid="viewer">
      {unavailable && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-stone-500 dark:text-stone-400">
          3D view isn&apos;t available in this browser — item dimensions are listed on the left.
        </div>
      )}
    </div>
  );
}
