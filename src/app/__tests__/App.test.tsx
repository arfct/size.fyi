import { beforeEach, test, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

test('the display menu carries view, layout and units together', async () => {
  render(<App />);
  // Two menu triggers render (mobile toolbar + desktop float); either exposes the same controls.
  const trigger = screen.getAllByRole('button', { name: /view: 3d/i })[0]!;
  await userEvent.setup().click(trigger);
  const menu = screen.getAllByRole('menu')[0]!;
  expect(within(menu).getByRole('menuitemradio', { name: /^Side-by-side/ })).toBeInTheDocument();
  expect(within(menu).getByRole('menuitemradio', { name: /^Stack/ })).toBeInTheDocument();
  expect(within(menu).getByRole('menuitemradio', { name: /^Metric/ })).toBeInTheDocument();
  expect(within(menu).getByRole('menuitemradio', { name: /^Imperial/ })).toBeInTheDocument();
});

test('viewer column fills the full viewport height on desktop', () => {
  const { container } = render(<App />);
  // The viewer/canvas section is the one that grows to fill the row on desktop.
  const section = [...container.querySelectorAll('section')].find((s) =>
    /\bmd:flex-1\b/.test(s.className),
  );
  expect(section).toBeTruthy();
  expect(section!.className).toMatch(/\bmd:h-screen\b/);
});
