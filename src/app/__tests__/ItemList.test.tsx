import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { expect, test } from 'vitest';
import type { ComparisonItem } from '../../shared/types';
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

test('the options menu stays visible while its own dropdown is open', async () => {
  const user = mount();
  const trigger = screen.getByRole('button', { name: 'Options for Small' });
  await user.click(trigger);
  expect(screen.getByRole('menu')).toBeInTheDocument();
  // Otherwise the pointer could leave the row and strand an open menu under an invisible trigger.
  expect(trigger.className).toContain('opacity-100');
  expect(trigger.className).not.toContain('opacity-0');
});
