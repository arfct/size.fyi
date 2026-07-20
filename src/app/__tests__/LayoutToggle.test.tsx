import { test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LayoutToggle from '../components/LayoutToggle';
import { ComparisonProvider } from '../store';

test('toggles between Stack and Row, reflecting state via aria-pressed', async () => {
  const user = userEvent.setup();
  render(
    <ComparisonProvider>
      <LayoutToggle />
    </ComparisonProvider>,
  );
  const button = screen.getByRole('button', { name: 'Stack' });
  expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(button.className).toMatch(/\bpointer-events-auto\b/);

  await user.click(button);
  expect(screen.getByRole('button', { name: 'Row' })).toHaveAttribute('aria-pressed', 'true');
});
