import { beforeEach, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  const wordmark = screen.getByRole('link', { name: 'size.fyi' });
  expect(wordmark).toBeInTheDocument();
  expect(wordmark).toHaveAttribute('href', '/');
});

test('header row holds the wordmark on the left and the units toggle on the right', () => {
  render(<App />);
  const header = screen.getByRole('link', { name: 'size.fyi' }).closest('header');
  expect(header).not.toBeNull();
  const unitsButton = screen.getByRole('button', { name: /units:/i });
  expect(unitsButton).toHaveTextContent('mm');
  expect(header!.contains(unitsButton)).toBe(true);
});

test('viewer column fills the full viewport height on desktop', () => {
  render(<App />);
  const tablist = screen.getByRole('tablist', { name: 'View' });
  const section = tablist.closest('section');
  expect(section).not.toBeNull();
  expect(section!.className).toMatch(/\bmd:h-screen\b/);
});
