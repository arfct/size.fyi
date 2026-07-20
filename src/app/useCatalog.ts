import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Catalog, Device } from '../shared/types';

let cache: Device[] | null = null;

export function useCatalog() {
  const [devices, setDevices] = useState<Device[]>(cache ?? []);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(cache ? 'ready' : 'loading');

  const load = useCallback(() => {
    setStatus('loading');
    fetch('/api/devices')
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<Catalog>;
      })
      .then((c) => {
        cache = c.devices;
        setDevices(c.devices);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, []);

  useEffect(() => {
    if (!cache) load();
  }, [load]);

  const bySlug = useMemo(() => new Map(devices.map((d) => [d.slug, d])), [devices]);
  return { devices, bySlug, status, retry: load };
}
