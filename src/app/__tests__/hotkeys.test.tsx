import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { expect, test } from 'vitest';
import type { ComparisonItem } from '../../shared/types';
import ItemList from '../components/ItemList';
import { ComparisonProvider, useComparison } from '../store';
import { HOTKEYS, useHotkeys } from '../useHotkeys';

const ITEMS: ComparisonItem[] = [
  { kind: 'custom', name: 'Small', h: 10, w: 10, d: 10 },
  { kind: 'custom', name: 'Large', h: 90, w: 90, d: 90 },
];

let snapshot: {
  view: string;
  projection: string;
  layoutMode: string;
  names: string[];
};

// The list is mounted alongside the hook so hovering a row is a real pointer interaction rather than a
// dispatch — hovering is how the remove key learns what to remove.
function Harness({ enabled = true }: { enabled?: boolean }) {
  const { state, dispatch } = useComparison();
  useHotkeys(enabled);
  snapshot = {
    view: state.view,
    projection: state.projection,
    layoutMode: state.layoutMode,
    names: state.items.map((i) => (i.kind === 'custom' ? i.name : i.device.name)),
  };
  useEffect(() => {
    dispatch({ type: 'load', items: ITEMS, missing: [] });
  }, [dispatch]);
  return (
    <>
      <input aria-label="Search" />
      <ItemList onEdit={() => {}} />
    </>
  );
}

function mount(enabled = true) {
  render(
    <ComparisonProvider>
      <Harness enabled={enabled} />
    </ComparisonProvider>,
  );
  return userEvent.setup();
}

const rowFor = (name: string) => screen.getByText(name).closest('li')!;

test('the view keys switch views', async () => {
  const user = mount();
  for (const [key, view] of [
    [HOTKEYS.front, 'front'],
    [HOTKEYS.side, 'side'],
    [HOTKEYS.top, 'top'],
    [HOTKEYS['3d'], '3d'],
  ] as const) {
    await user.keyboard(key);
    expect(snapshot.view).toBe(view);
  }
});

test('P toggles perspective and S toggles stack', async () => {
  const user = mount();
  expect(snapshot.projection).toBe('orthographic');
  await user.keyboard(HOTKEYS.perspective);
  expect(snapshot.projection).toBe('perspective');
  await user.keyboard(HOTKEYS.perspective);
  expect(snapshot.projection).toBe('orthographic');

  expect(snapshot.layoutMode).toBe('row');
  await user.keyboard(HOTKEYS.stack);
  expect(snapshot.layoutMode).toBe('stack');
  await user.keyboard(HOTKEYS.stack);
  expect(snapshot.layoutMode).toBe('row');
});

test('the keys are case-insensitive, so caps lock or shift still works', async () => {
  const user = mount();
  await user.keyboard('X');
  expect(snapshot.view).toBe('front');
});

test('backspace removes the hovered item, and only that one', async () => {
  const user = mount();
  await user.hover(rowFor('Large'));
  await user.keyboard('{Backspace}');
  expect(snapshot.names).toEqual(['Small']);
});

test('backspace with nothing hovered removes nothing', async () => {
  const user = mount();
  await user.keyboard('{Backspace}');
  expect(snapshot.names).toEqual(['Small', 'Large']);
});

test('typing in a field is left alone', async () => {
  const user = mount();
  await user.click(screen.getByRole('textbox', { name: 'Search' }));
  // "x" would be Front and Backspace would delete an item if the page were listening.
  await user.keyboard('x{Backspace}');
  expect(snapshot.view).toBe('3d');
  expect(snapshot.names).toEqual(['Small', 'Large']);
});

test('modified keystrokes belong to the browser', async () => {
  const user = mount();
  // ⌘X is cut, not Front.
  await user.keyboard('{Meta>}x{/Meta}');
  expect(snapshot.view).toBe('3d');
});

test('the bindings can be suspended, as they are while a dialog is open', async () => {
  const user = mount(false);
  await user.hover(rowFor('Large'));
  await user.keyboard('x{Backspace}');
  expect(snapshot.view).toBe('3d');
  expect(snapshot.names).toEqual(['Small', 'Large']);
});

test('the menu announces the shortcut without it becoming part of the label', async () => {
  const user = mount();
  await user.click(screen.getByRole('button', { name: 'Options for Small' }));
  const remove = screen.getByRole('menuitem', { name: 'Remove' });
  // The visible ⌫ is aria-hidden, so the accessible name stays the plain verb and the binding is
  // carried by aria-keyshortcuts instead.
  expect(remove).toHaveAttribute('aria-keyshortcuts', HOTKEYS.remove);
  expect(remove).toHaveAccessibleName('Remove');
  expect(remove.textContent).toContain('⌫');
});
