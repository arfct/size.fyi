import { useEffect, useRef, useState, type RefObject } from 'react';
import { createScene, type SizeScene } from '../../three/scene';
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

// Vertical breathing room (px) reserved at the top of the mobile canvas so the framed model
// sits below the floating segmented control (ViewTabs / Stack toggle), which overlaps the
// canvas near the top. Desktop reserves horizontal room for the sidebar instead, not this.
const MOBILE_TOP_INSET = 64;

export default function Viewer({ asideRef }: ViewerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SizeScene | null>(null);
  const { state } = useComparison();
  const [unavailable, setUnavailable] = useState(false);
  const isDesktop = useIsDesktop();

  useEffect(() => {
    if (!ref.current) return;
    try { sceneRef.current = createScene(ref.current); }
    catch { sceneRef.current = null; setUnavailable(true); /* WebGL unavailable; table remains */ }
    return () => sceneRef.current?.dispose();
  }, []);

  // Measures the floating sidebar's width and feeds it to the scene as a left inset, so the
  // camera keeps framing the safe area (right of the sidebar) while the canvas itself spans the
  // full width. Declared after the scene-creation effect above so sceneRef.current is already
  // populated by the time this one runs on mount.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const aside = asideRef?.current;
    // Mobile: no horizontal inset (canvas is full-width), but reserve vertical room at the top
    // for the overlapping segmented control. Desktop-without-aside: no inset at all.
    if (!aside || !isDesktop) { scene.setInset(0, isDesktop ? 0 : MOBILE_TOP_INSET); return; }
    const update = () => scene.setInset(aside.getBoundingClientRect().width, 0);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(aside);
    return () => ro.disconnect();
  }, [asideRef, isDesktop]);

  useEffect(() => {
    const items = state.items.length > 0
      ? state.items.map((item, i) => ({
        name: item.kind === 'device' ? item.device.name : item.name,
        h: item.kind === 'device' ? item.device.h : item.h,
        w: item.kind === 'device' ? item.device.w : item.w,
        d: item.kind === 'device' ? item.device.d : item.d,
        radius: item.kind === 'device' ? item.device.radius : undefined,
        radiusAxis: item.kind === 'device' ? item.device.radiusAxis : undefined,
        screen: item.kind === 'device' ? item.device.screen : undefined,
        mesh: item.kind === 'device' ? item.device.mesh : undefined,
        model3d: item.kind === 'device' ? item.device.model3d : undefined,
        color: itemColor(item, i),
      }))
      : PLACEHOLDER_CUBES.map((c, i) => ({ ...c, color: colorFor(i) }));
    sceneRef.current?.setItems(items);
  }, [state.items]);

  useEffect(() => { sceneRef.current?.setView(state.view); }, [state.view]);

  useEffect(() => { sceneRef.current?.setLayout(state.layoutMode); }, [state.layoutMode]);

  useEffect(() => { sceneRef.current?.setUnits(state.units); }, [state.units]);

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
