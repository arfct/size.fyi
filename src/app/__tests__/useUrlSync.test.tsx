import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { isCustomOnlyPath, useUrlSync } from '../useUrlSync';
import { ComparisonProvider, useComparison } from '../store';
import type { Device } from '../../shared/types';

describe('isCustomOnlyPath', () => {
  test('true when every token is a custom item', () => {
    expect(isCustomOnlyPath('/phone~150x75x8')).toBe(true);
    expect(isCustomOnlyPath('/phone~150x75x8-vs-book~200x140x20')).toBe(true);
  });
  test('false when any token is a catalog slug', () => {
    expect(isCustomOnlyPath('/iphone-16')).toBe(false);
    expect(isCustomOnlyPath('/iphone-16-vs-phone~150x75x8')).toBe(false);
    expect(isCustomOnlyPath('/phone~150x75x8-vs-iphone-16')).toBe(false);
  });
});

const catalog: { status: 'loading' | 'ready' | 'error'; bySlug: Map<string, Device> } = {
  status: 'loading',
  bySlug: new Map(),
};

vi.mock('../useCatalog', () => ({
  useCatalog: () => ({ devices: [], bySlug: catalog.bySlug, status: catalog.status, retry: vi.fn() }),
}));

function useTestSync() {
  useUrlSync();
  return useComparison();
}

const a4: Device = { slug: 'paper-a4', name: 'A4 Paper', category: 'paper', h: 297, w: 210, d: 0.1 };

beforeEach(() => {
  catalog.status = 'loading';
  catalog.bySlug = new Map();
  localStorage.clear();
  window.history.pushState({}, '', '/');
});

describe('useUrlSync hydration', () => {
  test('root path hydrates immediately with no items', () => {
    window.history.pushState({}, '', '/');
    const { result } = renderHook(useTestSync, { wrapper: ComparisonProvider });
    expect(result.current.state.items).toEqual([]);
  });

  test('custom-only path hydrates immediately without waiting for the catalog', () => {
    window.history.pushState({}, '', '/phone~150x75x8-vs-book~200x140x20');
    const { result } = renderHook(useTestSync, { wrapper: ComparisonProvider });
    expect(result.current.state.items).toHaveLength(2);
    expect(result.current.state.items[0]).toMatchObject({ kind: 'custom', name: 'Phone' });
    expect(result.current.state.items[1]).toMatchObject({ kind: 'custom', name: 'Book' });
  });

  test('mixed/slug path waits for catalog status to become ready', () => {
    window.history.pushState({}, '', '/iphone-16-vs-paper-a4');
    const { result, rerender } = renderHook(useTestSync, { wrapper: ComparisonProvider });
    // not hydrated yet — reducer's initial state, nothing dispatched
    expect(result.current.state.items).toEqual([]);
    expect(result.current.state.missing).toEqual([]);

    catalog.status = 'ready';
    catalog.bySlug = new Map([[a4.slug, a4]]);
    act(() => rerender());

    expect(result.current.state.items).toEqual([{ kind: 'device', device: a4 }]);
    expect(result.current.state.missing).toEqual(['iphone-16']);
  });

  test('only hydrates once — a later catalog update does not re-run load', () => {
    window.history.pushState({}, '', '/iphone-16-vs-paper-a4');
    catalog.status = 'ready';
    catalog.bySlug = new Map([[a4.slug, a4]]);
    const { result, rerender } = renderHook(useTestSync, { wrapper: ComparisonProvider });
    expect(result.current.state.items).toEqual([{ kind: 'device', device: a4 }]);

    // simulate the catalog map changing again post-hydration; state should be untouched
    catalog.bySlug = new Map();
    act(() => rerender());
    expect(result.current.state.items).toEqual([{ kind: 'device', device: a4 }]);
  });
});

describe('useUrlSync reflects state back to the URL', () => {
  test('adding items updates the path and title', () => {
    window.history.pushState({}, '', '/');
    const { result } = renderHook(useTestSync, { wrapper: ComparisonProvider });
    act(() => {
      result.current.dispatch({ type: 'add', item: { kind: 'custom', name: 'Phone', h: 150, w: 75, d: 8 } });
      result.current.dispatch({ type: 'add', item: { kind: 'custom', name: 'Book', h: 200, w: 140, d: 20 } });
    });
    expect(location.pathname).toBe('/phone~150x75x8-vs-book~200x140x20');
    expect(document.title).toBe('Phone vs Book — size.fyi');
  });
});

describe('useUrlSync popstate handling', () => {
  test('navigating back re-decodes the new path', () => {
    window.history.pushState({}, '', '/phone~150x75x8');
    const { result } = renderHook(useTestSync, { wrapper: ComparisonProvider });
    expect(result.current.state.items).toHaveLength(1);

    window.history.pushState({}, '', '/book~200x140x20');
    act(() => {
      dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.state.items).toEqual([{ kind: 'custom', name: 'Book', h: 200, w: 140, d: 20 }]);
  });
});
