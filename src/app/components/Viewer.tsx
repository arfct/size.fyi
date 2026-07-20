import { useEffect, useRef, useState, type RefObject } from 'react';
import { createScene, type SizeScene } from '../../three/scene';
import { itemColor } from '../palette';
import { useComparison } from '../store';
import { useIsDesktop } from '../useIsDesktop';

interface ViewerProps {
  // The floating sidebar's element, when one is floating above this canvas (md+ full-bleed
  // layout). Its live width becomes the camera's left inset. Omitted for the mobile, contained
  // viewer, where there's no overlapping sidebar and inset is always 0.
  asideRef?: RefObject<HTMLElement | null>;
}

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
    if (!aside || !isDesktop) { scene.setInset(0); return; }
    const update = () => scene.setInset(aside.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(aside);
    return () => ro.disconnect();
  }, [asideRef, isDesktop]);

  useEffect(() => {
    sceneRef.current?.setItems(state.items.map((item, i) => ({
      name: item.kind === 'device' ? item.device.name : item.name,
      h: item.kind === 'device' ? item.device.h : item.h,
      w: item.kind === 'device' ? item.device.w : item.w,
      d: item.kind === 'device' ? item.device.d : item.d,
      radius: item.kind === 'device' ? item.device.radius : undefined,
      radiusAxis: item.kind === 'device' ? item.device.radiusAxis : undefined,
      screen: item.kind === 'device' ? item.device.screen : undefined,
      mesh: item.kind === 'device' ? item.device.mesh : undefined,
      color: itemColor(item, i),
    })));
  }, [state.items]);

  useEffect(() => { sceneRef.current?.setView(state.view); }, [state.view]);

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
