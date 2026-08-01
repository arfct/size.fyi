import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
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
  for (const label of ['3D', 'Front', 'Side', 'Top', 'Metric', 'Imperial']) {
    expect(within(menu).getByRole('menuitemradio', { name: label })).toBeInTheDocument();
  }
  // The two-state settings are single checkable rows, not a pair of radios each.
  for (const label of ['Perspective', 'Stack']) {
    expect(within(menu).getByRole('menuitemcheckbox', { name: label })).toBeInTheDocument();
  }
  expect(within(menu).queryByRole('menuitemradio', { name: /side-by-side/i })).toBeNull();
});

test('Stack is one row that toggles, unchecked meaning side-by-side', async () => {
  const user = open();
  await user.click(screen.getByRole('button', { name: /view: 3d/i }));
  expect(screen.getByRole('menuitemcheckbox', { name: /^Stack/ })).toHaveAttribute(
    'aria-checked',
    'false',
  );

  await user.click(screen.getByRole('menuitemcheckbox', { name: /^Stack/ }));
  await user.click(screen.getByRole('button', { name: /view: 3d/i }));
  expect(screen.getByRole('menuitemcheckbox', { name: /^Stack/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // And the same row turns it back off — there's no separate side-by-side item to go back to.
  await user.click(screen.getByRole('menuitemcheckbox', { name: /^Stack/ }));
  await user.click(screen.getByRole('button', { name: /view: 3d/i }));
  expect(screen.getByRole('menuitemcheckbox', { name: /^Stack/ })).toHaveAttribute(
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

test('Perspective is one row that toggles, unchecked by default', async () => {
  const user = open();
  await user.click(screen.getByRole('button', { name: /view: 3d/i }));
  // 3D opens orthographic: it reads as a measured drawing rather than a photograph, which is what a
  // size comparison is for. Checking this row is what opts into perspective.
  expect(screen.getByRole('menuitemcheckbox', { name: /^Perspective/ })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  // And there is no separate Orthographic row to go with it.
  expect(screen.queryByRole('menuitemcheckbox', { name: /orthographic/i })).toBeNull();

  await user.click(screen.getByRole('menuitemcheckbox', { name: /^Perspective/ }));
  await user.click(screen.getByRole('button', { name: /view: 3d/i }));
  expect(screen.getByRole('menuitemcheckbox', { name: /^Perspective/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await user.click(screen.getByRole('menuitemcheckbox', { name: /^Perspective/ }));
  await user.click(screen.getByRole('button', { name: /view: 3d/i }));
  expect(screen.getByRole('menuitemcheckbox', { name: /^Perspective/ })).toHaveAttribute(
    'aria-checked',
    'false',
  );
});

test('hides the projection row in the flat views, where it would do nothing', async () => {
  const user = open();
  await user.click(screen.getByRole('button', { name: /view: 3d/i }));
  await user.click(screen.getByRole('menuitemradio', { name: /^Front/ }));
  await user.click(screen.getByRole('button', { name: /view: front/i }));
  // Orthographic by definition, so there is no choice to make.
  expect(screen.queryByRole('menuitemcheckbox', { name: /^Perspective/ })).not.toBeInTheDocument();
  // Layout still applies, so its row stays.
  expect(screen.getByRole('menuitemcheckbox', { name: /^Stack/ })).toBeInTheDocument();
});
