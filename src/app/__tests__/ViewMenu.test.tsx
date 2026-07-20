import { beforeEach, test, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ViewMenu from '../components/ViewMenu';
import { getStoredUnits } from '../localStore';
import { ComparisonProvider } from '../store';

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
  for (const label of ['3D', 'Front', 'Side', 'Top', 'Side-by-side', 'Stack', 'Metric', 'Imperial']) {
    expect(within(menu).getByRole('menuitemradio', { name: label })).toBeInTheDocument();
  }
});

test('choosing Stack layout updates the checked state', async () => {
  const user = open();
  await user.click(screen.getByRole('button', { name: /view: 3d/i }));
  await user.click(screen.getByRole('menuitemradio', { name: /^Stack/ }));
  await user.click(screen.getByRole('button', { name: /view: 3d/i }));
  expect(screen.getByRole('menuitemradio', { name: /^Stack/ })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('menuitemradio', { name: /^Side-by-side/ })).toHaveAttribute('aria-checked', 'false');
});

test('choosing Imperial units updates checked state and persists', async () => {
  const user = open();
  await user.click(screen.getByRole('button', { name: /view: 3d/i }));
  await user.click(screen.getByRole('menuitemradio', { name: /^Imperial/ }));
  await user.click(screen.getByRole('button', { name: /view: 3d/i }));
  expect(screen.getByRole('menuitemradio', { name: /^Imperial/ })).toHaveAttribute('aria-checked', 'true');
  expect(getStoredUnits()).toBe('imperial');
});
