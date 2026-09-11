import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, expect, test } from 'vitest';
import { AR_MODEL_VERSION, geometryFingerprint } from '../../shared/ar';
import type { ComparisonItem, Device } from '../../shared/types';
import ItemList from '../components/ItemList';
import { colorFor } from '../palette';
import { ComparisonProvider, useComparison } from '../store';

// Two custom items so the palette assigns index 0 and 1, and the rows are addressable by name.
const ITEMS: ComparisonItem[] = [
  { kind: 'custom', name: 'Small', h: 10, w: 10, d: 10 },
  { kind: 'custom', name: 'Large', h: 90, w: 90, d: 90 },
];

let hovered: number | null;

function Harness() {
  const { state, dispatch } = useComparison();
  hovered = state.hovered;
  useEffect(() => {
    dispatch({ type: 'load', items: ITEMS, missing: [] });
  }, [dispatch]);
  return <ItemList onEdit={() => {}} />;
}

function mount() {
  render(
    <ComparisonProvider>
      <Harness />
    </ComparisonProvider>,
  );
  return userEvent.setup();
}

const rowFor = (name: string) => screen.getByText(name).closest('li')!;

// The tint is written as an 8-digit hex, which jsdom reports back as rgba().
const rgba = (hex: string, alpha: number) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

test('a row is untinted until hovered', async () => {
  mount();
  expect(rowFor('Small')).toHaveStyle({ backgroundColor: '' });
  expect(hovered).toBeNull();
});

test('hovering tints the row with that item’s own colour, not a generic grey', async () => {
  const user = mount();
  await user.hover(rowFor('Small'));
  // Index 0 in the palette — the same colour its category icon and its box in the 3D view use.
  expect(rowFor('Small')).toHaveStyle({ backgroundColor: rgba(colorFor(0), 0.125) });
});

test('each row tints with its own colour', async () => {
  const user = mount();
  await user.hover(rowFor('Large'));
  expect(rowFor('Large')).toHaveStyle({ backgroundColor: rgba(colorFor(1), 0.125) });
  // And it is a different colour from the other row's.
  expect(colorFor(1)).not.toBe(colorFor(0));
});

test('hover publishes the index so the 3D view can highlight the same item', async () => {
  const user = mount();
  await user.hover(rowFor('Large'));
  expect(hovered).toBe(1);
  await user.unhover(rowFor('Large'));
  expect(hovered).toBeNull();
});

test('the options menu is present but hidden until the row is hovered', async () => {
  mount();
  // Present in the tree, so it stays reachable by keyboard; hidden by opacity, so the row's layout
  // does not shift when it appears.
  const trigger = screen.getByRole('button', { name: 'Options for Small' });
  expect(trigger.className).toContain('opacity-0');
  expect(trigger.className).toContain('group-hover:opacity-100');
  // No hover to reveal it on a touch device, so it is always shown there.
  expect(trigger.className).toContain('pointer-coarse:opacity-100');
});

// A folding phone: two states, so it gets a state control. The dims differ per state, which is what
// makes picking one observable from outside.
const FOLD = {
  kind: 'device' as const,
  device: {
    slug: 'fold',
    name: 'Fold',
    category: 'phone',
    h: 160,
    w: 70,
    d: 14,
    states: [
      { label: 'closed', h: 160, w: 70, d: 14 },
      { label: 'open', h: 160, w: 140, d: 7 },
    ],
  } as Device,
};

function mountFold() {
  function FoldHarness() {
    const { dispatch } = useComparison();
    useEffect(() => {
      dispatch({ type: 'load', items: [FOLD], missing: [] });
    }, [dispatch]);
    return <ItemList onEdit={() => {}} />;
  }
  render(
    <ComparisonProvider>
      <FoldHarness />
    </ComparisonProvider>,
  );
  return userEvent.setup();
}

test('a multi-state device shows no state control on the row itself', async () => {
  mountFold();
  // The row is one name and one line of dimensions; the state choice lives in the menu, so the list
  // stays scannable when several folding devices are in the comparison.
  const row = rowFor('Fold');
  expect(within(row).queryByRole('menuitemradio')).toBeNull();
  expect(within(row).queryByText('closed')).toBeNull();
  expect(within(row).queryByText('open')).toBeNull();
});

test('the states are in the options menu, with the active one checked', async () => {
  const user = mountFold();
  await user.click(screen.getByRole('button', { name: 'Options for Fold' }));
  const closed = screen.getByRole('menuitemradio', { name: /closed/i });
  expect(closed).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('menuitemradio', { name: /^open/i })).toHaveAttribute(
    'aria-checked',
    'false',
  );
});

test('picking a state from the menu applies it', async () => {
  const user = mountFold();
  await user.click(screen.getByRole('button', { name: 'Options for Fold' }));
  await user.click(screen.getByRole('menuitemradio', { name: /^open/i }));
  // Opening it doubles the width, so the row's dimensions are the proof it took effect.
  expect(within(rowFor('Fold')).getByText(/140/)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Options for Fold' }));
  expect(screen.getByRole('menuitemradio', { name: /^open/i })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('double-clicking a row cycles its state', async () => {
  const user = mountFold();
  // The same gesture works on the item in the 3D view; both go through the reducer's cycleState.
  await user.dblClick(rowFor('Fold'));
  expect(within(rowFor('Fold')).getByText(/140/)).toBeInTheDocument();

  // And it wraps, so a two-state device toggles.
  await user.dblClick(rowFor('Fold'));
  expect(within(rowFor('Fold')).getByText(/70/)).toBeInTheDocument();
});

test('double-clicking an item with nothing to cycle does nothing', async () => {
  const user = mount();
  await user.dblClick(rowFor('Small'));
  expect(within(rowFor('Small')).getByText(/10/)).toBeInTheDocument();
});

test('a single-state device gets no state rows in its menu', async () => {
  const user = mount();
  await user.click(screen.getByRole('button', { name: 'Options for Small' }));
  // Nothing to choose between, so the menu is just the actions.
  expect(screen.queryByRole('menuitemradio')).toBeNull();
});

// AR is offered per row through the same Worker route the whole-comparison button uses — a single item
// is just a one-item comparison. Only two of the catalog's 99 devices have a pre-built model file, so
// anything keyed to those files reached almost nothing.
function fakeQuickLookDevice() {
  const original = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'relList');
  Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
  Object.defineProperty(HTMLAnchorElement.prototype, 'relList', {
    configurable: true,
    get: () => ({ supports: (s: string) => s === 'ar', contains: () => false }),
  });
  return () => {
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true });
    if (original) Object.defineProperty(HTMLAnchorElement.prototype, 'relList', original);
  };
}

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

test('a device with no pre-built model still offers AR', async () => {
  cleanups.push(fakeQuickLookDevice());
  const { hrefs, restore } = captureLaunches();
  cleanups.push(restore);
  const user = mountFold();
  await user.click(screen.getByRole('button', { name: 'Options for Fold' }));
  await user.click(screen.getByRole('menuitem', { name: 'View in AR' }));
  // The route generates it on request, so the slug is all it needs. The state is spelled out even
  // though it's the default one, because the encoder stays canonical — a bare slug would answer with
  // the route's normalizing redirect before it answered with a model.
  expect(hrefs).toEqual([
    `/ar/fold-closed.usdz?v=${AR_MODEL_VERSION}&g=${geometryFingerprint([FOLD])}`,
  ]);
});

test('the AR target follows the chosen state, since that is a different shape', async () => {
  cleanups.push(fakeQuickLookDevice());
  const { hrefs, restore } = captureLaunches();
  cleanups.push(restore);
  const user = mountFold();
  await user.click(screen.getByRole('button', { name: 'Options for Fold' }));
  await user.click(screen.getByRole('menuitemradio', { name: /^open/i }));

  await user.click(screen.getByRole('button', { name: 'Options for Fold' }));
  await user.click(screen.getByRole('menuitem', { name: 'View in AR' }));
  const opened = { ...FOLD, state: 'open' };
  expect(hrefs).toEqual([
    `/ar/fold-open.usdz?v=${AR_MODEL_VERSION}&g=${geometryFingerprint([opened])}`,
  ]);
  // The two states fingerprint differently, which is the point: opening it is a different mesh.
  expect(geometryFingerprint([opened])).not.toBe(geometryFingerprint([FOLD]));
});

test('a custom item offers AR too, though it exists only in the URL', async () => {
  cleanups.push(fakeQuickLookDevice());
  const { hrefs, restore } = captureLaunches();
  cleanups.push(restore);
  const user = mount();
  await user.click(screen.getByRole('button', { name: 'Options for Small' }));
  await user.click(screen.getByRole('menuitem', { name: 'View in AR' }));
  expect(hrefs).toEqual([
    `/ar/small~10x10x10.usdz?v=${AR_MODEL_VERSION}&g=${geometryFingerprint([ITEMS[0]!])}`,
  ]);
});

test('the options menu stays visible while its own dropdown is open', async () => {
  const user = mount();
  const trigger = screen.getByRole('button', { name: 'Options for Small' });
  await user.click(trigger);
  expect(screen.getByRole('menu')).toBeInTheDocument();
  // Otherwise the pointer could leave the row and strand an open menu under an invisible trigger.
  expect(trigger.className).toContain('opacity-100');
  expect(trigger.className).not.toContain('opacity-0');
});

// An item is either in the catalog or it isn't, and the menu offers whichever issue fits. Both open
// GitHub's form prefilled rather than posting anything, so they are links, not buttons.
test('a custom item offers to be suggested, not reported', async () => {
  const user = mount();
  await user.click(screen.getByRole('button', { name: 'Options for Small' }));
  const link = screen.getByRole('menuitem', { name: 'Suggest for the catalog' });
  expect(link).toHaveAttribute('href', expect.stringContaining('template=add-a-device.yml'));
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  expect(screen.queryByRole('menuitem', { name: 'Report an error' })).toBeNull();
});

test('a catalog device offers to be reported, not suggested', async () => {
  const user = mountFold();
  await user.click(screen.getByRole('button', { name: 'Options for Fold' }));
  const link = screen.getByRole('menuitem', { name: 'Report an error' });
  expect(link).toHaveAttribute('href', expect.stringContaining('template=report-an-error.yml'));
  // The slug rides along so a maintainer can find the file without searching by name. Asserted on the
  // decoded value: URLSearchParams percent-encodes the parentheses, which is correct but unreadable.
  const item = new URL(link.getAttribute('href')!).searchParams.get('item');
  expect(item).toBe('Fold (fold)');
  expect(screen.queryByRole('menuitem', { name: 'Suggest for the catalog' })).toBeNull();
});

test('the issue link sits above Remove, so the destructive action stays last', async () => {
  const user = mount();
  await user.click(screen.getByRole('button', { name: 'Options for Small' }));
  const items = screen.getAllByRole('menuitem').map((el) => el.textContent?.trim());
  expect(items.indexOf('Suggest for the catalog')).toBeLessThan(
    items.findIndex((t) => t?.startsWith('Remove')),
  );
});

// A phone that turns to landscape: one state, so no radios, but a rotation — so it gets a toggle.
const PHONE = {
  kind: 'device' as const,
  device: {
    slug: 'phone',
    name: 'Phone',
    category: 'phone',
    h: 150,
    w: 70,
    d: 8,
    rotation: 'ccw',
  } as Device,
};

function mountPhone() {
  function PhoneHarness() {
    const { dispatch } = useComparison();
    useEffect(() => {
      dispatch({ type: 'load', items: [PHONE], missing: [] });
    }, [dispatch]);
    return <ItemList onEdit={() => {}} />;
  }
  render(
    <ComparisonProvider>
      <PhoneHarness />
    </ComparisonProvider>,
  );
  return userEvent.setup();
}

test('a rotatable device offers its other orientation as a checkbox in the menu', async () => {
  const user = mountPhone();
  await user.click(screen.getByRole('button', { name: 'Options for Phone' }));
  // Named for where the turn leads, which for a portrait phone is landscape.
  const toggle = screen.getByRole('menuitemcheckbox', { name: /landscape/i });
  expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(screen.queryByRole('menuitemradio')).toBeNull();
});

test('checking the orientation turns the item, and the label keeps naming the alternate', async () => {
  const user = mountPhone();
  await user.click(screen.getByRole('button', { name: 'Options for Phone' }));
  await user.click(screen.getByRole('menuitemcheckbox', { name: /landscape/i }));
  expect(within(rowFor('Phone')).getByText(/^70 × 150/)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Options for Phone' }));
  expect(screen.getByRole('menuitemcheckbox', { name: /landscape/i })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('geometry without a rotation gets no orientation toggle', async () => {
  const user = mountFold();
  await user.click(screen.getByRole('button', { name: 'Options for Fold' }));
  expect(screen.queryByRole('menuitemcheckbox')).toBeNull();
});
