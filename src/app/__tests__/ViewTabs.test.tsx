import { test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ViewTabs from '../components/ViewTabs';
import { ComparisonProvider } from '../store';

test('renders as a floating pill positioned over the viewer, not inline layout', () => {
  render(
    <ComparisonProvider>
      <ViewTabs />
    </ComparisonProvider>,
  );
  const tablist = screen.getByRole('tablist', { name: 'View' });
  expect(tablist.className).toMatch(/\babsolute\b/);
  expect(tablist.className).toMatch(/\btop-3\b/);
});
