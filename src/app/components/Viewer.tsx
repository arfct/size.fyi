import { useEffect, useRef, useState } from 'react';
import { createScene, type SizeScene } from '../../three/scene';
import { colorFor } from '../palette';
import { useComparison } from '../store';

export default function Viewer() {
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SizeScene | null>(null);
  const { state } = useComparison();
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    try { sceneRef.current = createScene(ref.current); }
    catch { sceneRef.current = null; setUnavailable(true); /* WebGL unavailable; table remains */ }
    return () => sceneRef.current?.dispose();
  }, []);

  useEffect(() => {
    sceneRef.current?.setItems(state.items.map((item, i) => ({
      name: item.kind === 'device' ? item.device.name : item.name,
      h: item.kind === 'device' ? item.device.h : item.h,
      w: item.kind === 'device' ? item.device.w : item.w,
      d: item.kind === 'device' ? item.device.d : item.d,
      radius: item.kind === 'device' ? item.device.radius : undefined,
      radiusAxis: item.kind === 'device' ? item.device.radiusAxis : undefined,
      screen: item.kind === 'device' ? item.device.screen : undefined,
      color: colorFor(i),
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
