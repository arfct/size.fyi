import { beforeEach, test, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import App from '../App';
import { __resetCatalogStore } from '../useCatalog';

beforeEach(() => {
  __resetCatalogStore();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: 1, devices: [] }),
    }),
  );
});

test('renders the wordmark as a link home', () => {
  render(<App />);
  // The wordmark appears in both the mobile toolbar and the desktop sidebar header.
  const wordmarks = screen.getAllByRole('link', { name: 'size.fyi' });
  expect(wordmarks.length).toBeGreaterThan(0);
  for (const w of wordmarks) expect(w).toHaveAttribute('href', '/');
});

test('the sidebar header holds the wordmark and the units toggle', () => {
  render(<App />);
  const header = screen
    .getAllByRole('link', { name: 'size.fyi' })
    .map((l) => l.closest('header'))
    .find((h): h is HTMLElement => h != null);
  expect(header).toBeTruthy();
  const unitsButton = within(header!).getByRole('button', { name: /units:/i });
  expect(unitsButton).toHaveTextContent('mm');
});

test('viewer column fills the full viewport height on desktop', () => {
  render(<App />);
  const tablist = screen.getByRole('tablist', { name: 'View' });
  const section = tablist.closest('section');
  expect(section).not.toBeNull();
  expect(section!.className).toMatch(/\bmd:h-screen\b/);
});
