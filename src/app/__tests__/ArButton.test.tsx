import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, expect, test } from 'vitest';
import { AR_MODEL_VERSION } from '../../shared/ar';
import type { Device, LayoutMode } from '../../shared/types';
import ArButton from '../components/ArButton';
import { ComparisonProvider, useComparison } from '../store';

// The button only appears where AR can actually run, so these tests stand in for a phone: a touch device
// whose anchors advertise `rel="ar"` support, which is how Quick Look announces itself.
function fakeQuickLookDevice() {
  // Capture the descriptor, not the value — reading `prototype.relList` would invoke the getter on the
  // prototype itself, which jsdom rejects.
  const original = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'relList');
  Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
  Object.defineProperty(HTMLAnchorElement.prototype, 'relList', {
    configurable: true,
    get() {
      return { supports: (s: string) => s === 'ar', contains: () => false };
    },
  });
  return () => {
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true });
    if (original) Object.defineProperty(HTMLAnchorElement.prototype, 'relList', original);
  };
}

// Records the href of any synthesized `rel="ar"` anchor instead of navigating to it.
function captureLaunches() {
  const hrefs: string[] = [];
  const real = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (this.rel === 'ar') {
      hrefs.push(this.getAttribute('href') ?? '');
      return;
    }
    return real.call(this);
  };
  return { hrefs, restore: () => (HTMLAnchorElement.prototype.click = real) };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function Seeded({ layout }: { layout?: LayoutMode }) {
  const { dispatch } = useComparison();
  useEffect(() => {
    dispatch({
      type: 'load',
      items: [
        { kind: 'device', device: { slug: 'a', name: 'A', h: 10, w: 10, d: 10 } as Device },
        { kind: 'device', device: { slug: 'b', name: 'B', h: 20, w: 20, d: 20 } as Device },
      ],
      missing: [],
    });
    if (layout) dispatch({ type: 'setLayout', mode: layout });
  }, [dispatch, layout]);
  return null;
}

function mount(opts: { seeded?: boolean; layout?: LayoutMode } = {}) {
  render(
    <ComparisonProvider>
      {opts.seeded !== false && <Seeded layout={opts.layout} />}
      <ArButton />
    </ComparisonProvider>,
  );
  return userEvent.setup();
}

test('is absent where AR cannot run — desktop has no button at all', async () => {
  mount();
  expect(screen.queryByRole('button', { name: /view in ar/i })).not.toBeInTheDocument();
});

test('is absent with nothing in the comparison to place', async () => {
  cleanups.push(fakeQuickLookDevice());
  mount({ seeded: false });
  expect(screen.queryByRole('button', { name: /view in ar/i })).not.toBeInTheDocument();
});

test('is an icon-only button, labelled for screen readers like Share', async () => {
  cleanups.push(fakeQuickLookDevice());
  mount();
  const button = await screen.findByRole('button', { name: 'View in AR' });
  // Icon only: the accessible name comes from aria-label, not from any visible text.
  expect(button).toHaveAccessibleName('View in AR');
  expect(button.textContent).toBe('');
});

test('launches the comparison route on click', async () => {
  cleanups.push(fakeQuickLookDevice());
  const { hrefs, restore } = captureLaunches();
  cleanups.push(restore);
  const user = mount();
  await user.click(await screen.findByRole('button', { name: 'View in AR' }));
  expect(hrefs).toEqual([`/ar/a-vs-b.usdz?v=${AR_MODEL_VERSION}`]);
});

test('carries the chosen layout, since a stack and a row are different models', async () => {
  cleanups.push(fakeQuickLookDevice());
  const { hrefs, restore } = captureLaunches();
  cleanups.push(restore);
  const user = mount({ layout: 'stack' });
  await user.click(await screen.findByRole('button', { name: 'View in AR' }));
  expect(hrefs).toEqual([`/ar/a-vs-b.usdz?layout=stack&v=${AR_MODEL_VERSION}`]);
});
