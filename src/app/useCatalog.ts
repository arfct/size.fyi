import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Catalog, Device } from '../shared/types';

type Status = 'loading' | 'ready' | 'error';
interface Snapshot { devices: Device[]; status: Status; }

// Module-level store shared by every `useCatalog()` instance, so a `retry()`
// called from one component (e.g. SearchDevices) is observed by all of them
// (e.g. useUrlSync too) instead of leaving siblings stuck on their own local
// 'error' state forever.
let devices: Device[] = [];
let status: Status = 'loading';
let requested = false; // true once a fetch has ever been kicked off
let inFlight: Promise<void> | null = null;
let snapshot: Snapshot = { devices, status };
const listeners = new Set<() => void>();

function notify(): void {
  snapshot = { devices, status };
  for (const l of listeners) l();
}

function load(): void {
  if (inFlight) return; // a fetch is already in progress; don't stack another
  requested = true;
  status = 'loading';
  notify();
  inFlight = fetch('/api/devices')
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<Catalog>;
    })
    .then((c) => {
      devices = c.devices;
      status = 'ready';
    })
    .catch(() => {
      status = 'error';
    })
    .finally(() => {
      inFlight = null;
      notify();
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Snapshot {
  return snapshot;
}

export function useCatalog() {
  const snap = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    if (!requested) load();
  }, []);

  const bySlug = useMemo(() => new Map(snap.devices.map((d) => [d.slug, d])), [snap.devices]);
  return { devices: snap.devices, bySlug, status: snap.status, retry: load };
}

/** Test-only: resets the module-level store between tests. */
export function __resetCatalogStore(): void {
  devices = [];
  status = 'loading';
  requested = false;
  inFlight = null;
  snapshot = { devices, status };
  listeners.clear();
}
