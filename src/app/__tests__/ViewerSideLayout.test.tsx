import { render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { LayoutMode, Projection, View } from '../../shared/types';
import Viewer from '../components/Viewer';
import { ComparisonProvider, useComparison } from '../store';

// A stand-in scene that just records what it's told, so the assertions are about what the Viewer sends
// rather than about anything rendered. Hoisted because vi.mock runs before the module body.
const calls = vi.hoisted(() => ({
  layout: [] as string[],
  view: [] as string[],
  projection: [] as string[],
}));

vi.mock('../../three/scene', () => ({
  createScene: () => ({
    setItems: () => {},
    setView: (v: string) => {
      calls.view.push(v);
    },
    setLayout: (m: string) => {
      calls.layout.push(m);
    },
    setHighlight: () => {},
    setProjection: (p: string) => {
      calls.projection.push(p);
    },
    setInset: () => {},
    setUnits: () => {},
    resize: () => {},
    dispose: () => {},
  }),
}));

beforeEach(() => {
  calls.layout.length = 0;
  calls.view.length = 0;
  calls.projection.length = 0;
});

// Drives the store from outside and reports the layout the user actually chose, so a test can tell the
// difference between "the scene was told stack" and "the preference was changed to stack".
let setView: (v: View) => void;
let setLayout: (m: LayoutMode) => void;
let setProjection: (p: Projection) => void;
let storedLayout: LayoutMode;

function Harness() {
  const { state, dispatch } = useComparison();
  setView = (v) => dispatch({ type: 'setView', view: v });
  setLayout = (m) => dispatch({ type: 'setLayout', mode: m });
  setProjection = (p) => dispatch({ type: 'setProjection', projection: p });
  storedLayout = state.layoutMode;
  useEffect(() => {
    dispatch({ type: 'add', item: { kind: 'custom', name: 'Phone', h: 150, w: 75, d: 8 } });
  }, [dispatch]);
  return <Viewer />;
}

async function mount() {
  render(
    <ComparisonProvider>
      <Harness />
    </ComparisonProvider>,
  );
  // The scene module is lazy-loaded, so wait until the Viewer has started talking to it.
  await waitFor(() => expect(calls.view.length).toBeGreaterThan(0));
}

test('side view is laid out as a stack even when the preference is side-by-side', async () => {
  await mount();
  expect(storedLayout).toBe('row');

  setView('side');
  // A row spreads along +x, which is exactly the direction side view looks along, so every item would
  // hide behind the nearest one.
  await waitFor(() => expect(calls.layout.at(-1)).toBe('stack'));
  // The user's own choice is untouched — the override is derived, not dispatched.
  expect(storedLayout).toBe('row');
});

test('leaving side view restores the chosen layout', async () => {
  await mount();
  setView('side');
  await waitFor(() => expect(calls.layout.at(-1)).toBe('stack'));

  setView('3d');
  await waitFor(() => expect(calls.layout.at(-1)).toBe('row'));
  expect(storedLayout).toBe('row');
});

test('a stack preference is left alone by side view, and survives leaving it', async () => {
  await mount();
  setLayout('stack');
  await waitFor(() => expect(calls.layout.at(-1)).toBe('stack'));

  setView('side');
  setView('top');
  // Nothing to restore or override: the preference was already stack throughout.
  await waitFor(() => expect(calls.view.at(-1)).toBe('top'));
  expect(calls.layout.at(-1)).toBe('stack');
  expect(storedLayout).toBe('stack');
});

test('changing layout while in side view keeps the override but records the new preference', async () => {
  await mount();
  setView('side');
  await waitFor(() => expect(calls.layout.at(-1)).toBe('stack'));

  // Picking side-by-side here can't take effect while the view overrides it, but it must be remembered.
  setLayout('row');
  await waitFor(() => expect(storedLayout).toBe('row'));
  expect(calls.layout.at(-1)).toBe('stack');

  setView('front');
  await waitFor(() => expect(calls.layout.at(-1)).toBe('row'));
});

test('the other flat views use the chosen layout', async () => {
  await mount();
  for (const view of ['front', 'top'] as const) {
    setView(view);
    await waitFor(() => expect(calls.view.at(-1)).toBe(view));
    expect(calls.layout.at(-1)).toBe('row');
  }
});

test('the projection choice reaches the scene', async () => {
  await mount();
  expect(calls.projection).toEqual(['perspective']);
  setProjection('isometric');
  await waitFor(() => expect(calls.projection.at(-1)).toBe('isometric'));
});
