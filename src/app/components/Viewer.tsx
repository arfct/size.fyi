import { useEffect, useRef } from 'react';
import { createScene, type SizeScene } from '../../three/scene';
import { colorFor } from '../palette';
import { useComparison } from '../store';

export default function Viewer() {
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SizeScene | null>(null);
  const { state } = useComparison();

  useEffect(() => {
    if (!ref.current) return;
    try { sceneRef.current = createScene(ref.current); }
    catch { sceneRef.current = null; /* WebGL unavailable; table remains */ }
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
      color: colorFor(i),
    })));
  }, [state.items]);

  useEffect(() => { sceneRef.current?.setView(state.view); }, [state.view]);

  return <div ref={ref} className="relative h-full min-h-[320px] w-full" data-testid="viewer" />;
}
