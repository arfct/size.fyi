import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { expect, test } from 'vitest';
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

test('a single-state device gets no state rows in its menu', async () => {
  const user = mount();
  await user.click(screen.getByRole('button', { name: 'Options for Small' }));
  // Nothing to choose between, so the menu is just the actions.
  expect(screen.queryByRole('menuitemradio')).toBeNull();
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
