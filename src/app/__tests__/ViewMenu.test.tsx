import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { beforeEach, expect, test } from 'vitest';
import type { Device } from '../../shared/types';
import ViewMenu from '../components/ViewMenu';
import { getStoredUnits } from '../localStore';
import { ComparisonProvider, useComparison } from '../store';

// Puts two items in the store so the AR affordance has a comparison to point at. Seeds from an effect
// rather than during render, which React rejects.
function Seeded() {
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
  }, [dispatch]);
  return null;
}

beforeEach(() => localStorage.clear());

function open() {
  render(
    <ComparisonProvider>
      <ViewMenu />
    </ComparisonProvider>,
  );
  return userEvent.setup();
}

test('the trigger reflects the current view and opens a menu', async () => {
  const user = open();
  const trigger = screen.getByRole('button', { name: /view: 3d/i });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await user.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('menu')).toBeInTheDocument();
});

test('the menu holds view, layout and units controls together', async () => {
  const user = open();
  await user.click(screen.getByRole('button', { name: /view: 3d/i }));
  const menu = screen.getByRole('menu');
  for (const label of [
    '3D',
    'Front',
    'Side',
    'Top',
    'Side-by-side',
    'Stack',
    'Metric',
    'Imperial',
  ]) {
    expect(within(menu).getByRole('menuitemradio', { name: label })).toBeInTheDocument();
  }
});

test('choosing Stack layout updates the checked state', async () => {
  const user = open();
  await user.click(screen.getByRole('button', { name: /view: 3d/i }));
  await user.click(screen.getByRole('menuitemradio', { name: /^Stack/ }));
  await user.click(screen.getByRole('button', { name: /view: 3d/i }));
  expect(screen.getByRole('menuitemradio', { name: /^Stack/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  expect(screen.getByRole('menuitemradio', { name: /^Side-by-side/ })).toHaveAttribute(
    'aria-checked',
    'false',
  );
});

test('choosing Imperial units updates checked state and persists', async () => {
  const user = open();
  await user.click(screen.getByRole('button', { name: /view: 3d/i }));
  await user.click(screen.getByRole('menuitemradio', { name: /^Imperial/ }));
  await user.click(screen.getByRole('button', { name: /view: 3d/i }));
  expect(screen.getByRole('menuitemradio', { name: /^Imperial/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  expect(getStoredUnits()).toBe('imperial');
});

// "View in AR" is gated on the device being able to place it, so these tests stand in for a phone:
// a touch device whose anchors advertise `rel="ar"` support (how Quick Look announces itself).
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

test('hides View in AR on a device that cannot place it', async () => {
  const user = open();
  await user.click(screen.getByRole('button', { name: /view: 3d/i }));
  expect(screen.queryByRole('menuitem', { name: /view in ar/i })).not.toBeInTheDocument();
});

test('hides View in AR when the comparison is empty — nothing to place', async () => {
  const restore = fakeQuickLookDevice();
  try {
    const user = open(); // the provider starts with no items
    await user.click(screen.getByRole('button', { name: /view: 3d/i }));
    expect(screen.queryByRole('menuitem', { name: /view in ar/i })).not.toBeInTheDocument();
  } finally {
    restore();
  }
});

test('View in AR opens the comparison route, carrying the chosen layout', async () => {
  const restore = fakeQuickLookDevice();
  const clicked: string[] = [];
  const realClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    clicked.push(this.getAttribute('href') ?? '');
  };
  try {
    const user = userEvent.setup();
    render(
      <ComparisonProvider>
        <Seeded />
        <ViewMenu />
      </ComparisonProvider>,
    );

    await user.click(screen.getByRole('button', { name: /view: 3d/i }));
    await user.click(screen.getByRole('menuitem', { name: /view in ar/i }));
    expect(clicked).toEqual(['/ar/a-vs-b.usdz']);

    // Switching to Stack must change the model that gets launched, not just the on-screen view.
    await user.click(screen.getByRole('button', { name: /view: 3d/i }));
    await user.click(screen.getByRole('menuitemradio', { name: /stack/i }));
    await user.click(screen.getByRole('button', { name: /view: 3d/i }));
    await user.click(screen.getByRole('menuitem', { name: /view in ar/i }));
    expect(clicked[1]).toBe('/ar/a-vs-b.usdz?layout=stack');
  } finally {
    HTMLAnchorElement.prototype.click = realClick;
    restore();
  }
});
