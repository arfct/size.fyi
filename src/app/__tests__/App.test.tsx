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

test('header holds only the wordmark; the units toggle lives in the left column', () => {
  render(<App />);
  const header = screen.getByRole('link', { name: 'size.fyi' }).closest('header');
  expect(header).not.toBeNull();
  expect(header!.querySelector('button')).toBeNull();
  const unitsButton = screen.getByRole('button', { name: 'mm' });
  expect(header!.contains(unitsButton)).toBe(false);
});
