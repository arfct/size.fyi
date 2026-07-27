import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { MAX_ITEMS } from '../../shared/types';
import SearchDevices from '../components/SearchDevices';
import { addMyItem } from '../localStore';
import { ComparisonProvider, useComparison } from '../store';
import { __resetCatalogStore } from '../useCatalog';

function Harness() {
  const { state } = useComparison();
  return (
    <>
      <SearchDevices onAddCustom={() => {}} />
      <ul data-testid="items">
        {state.items.map((it) => (
          <li key={it.kind === 'custom' ? it.name : it.device.slug}>
            {it.kind === 'custom' ? `${it.name} ${it.h}x${it.w}x${it.d}` : it.device.name}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Preloads MAX_ITEMS items via the real 'load' reducer action, then renders the panel. */
function FullHarness() {
  const { dispatch } = useComparison();
  useEffect(() => {
    dispatch({
      type: 'load',
      items: Array.from({ length: MAX_ITEMS }, (_, i) => ({
        kind: 'custom' as const,
        name: `Item ${i}`,
        h: 10,
        w: 10,
        d: 10,
      })),
      missing: [],
    });
  }, [dispatch]);
  return <SearchDevices onAddCustom={() => {}} />;
}

function setup() {
  return render(
    <ComparisonProvider>
      <Harness />
    </ComparisonProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  __resetCatalogStore();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: 1, devices: [] }),
    }),
  );
});

test('a my-item match appears after device results, labeled, and selecting it dispatches a custom add', async () => {
  addMyItem({ name: 'Shoebox', h: 350, w: 250, d: 130 });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          version: 1,
          devices: [{ slug: 'shovel', name: 'Shovel', category: 'everyday', h: 100, w: 50, d: 20 }],
        }),
    }),
  );

  const user = userEvent.setup();
  setup();

  const input = await screen.findByPlaceholderText('Search');
  await user.type(input, 'sho');

  const options = await screen.findAllByRole('option');
  expect(options).toHaveLength(2);
  // Device results come first; the custom (my-item) match is appended at the end.
  expect(options[0]).toHaveTextContent('Shovel');
  expect(options[0]).not.toHaveTextContent('(my item)');
  expect(options[1]).toHaveTextContent('Shoebox');
  expect(options[1]).toHaveTextContent('(my item)');

  await user.click(options[1]!);

  // Dispatched as a 'custom' item carrying the stored dimensions, not a 'device' add.
  expect(screen.getByTestId('items')).toHaveTextContent('Shoebox 350x250x130');
  expect(input).toHaveValue('');
});

test('disables the search input at MAX_ITEMS', async () => {
  render(
    <ComparisonProvider>
      <FullHarness />
    </ComparisonProvider>,
  );

  const input = await screen.findByPlaceholderText('Search');
  expect(input).toBeDisabled();
});

test('focusing the search box selects its current text', async () => {
  const user = userEvent.setup();
  setup();
  const input = (await screen.findByPlaceholderText('Search')) as HTMLInputElement;
  await user.type(input, 'ipad');
  input.setSelectionRange(4, 4); // collapse to the end, as if the caret were resting there
  fireEvent.focus(input);
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe('ipad'.length);
});

test('shows the top-ranked suggestions (max 4) when the query is empty', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          version: 1,
          devices: [
            { slug: 'a', name: 'Alpha', category: 'phone', h: 1, w: 1, d: 1, rank: 90 },
            { slug: 'b', name: 'Bravo', category: 'phone', h: 1, w: 1, d: 1, rank: 80 },
            { slug: 'c', name: 'Charlie', category: 'phone', h: 1, w: 1, d: 1, rank: 70 },
            { slug: 'd', name: 'Delta', category: 'phone', h: 1, w: 1, d: 1, rank: 60 },
            { slug: 'e', name: 'Echo', category: 'phone', h: 1, w: 1, d: 1, rank: 10 },
          ],
        }),
    }),
  );

  setup();
  await screen.findByPlaceholderText('Search');

  const options = await screen.findAllByRole('option');
  const labels = options.map((o) => o.textContent ?? '');
  expect(options).toHaveLength(4);
  expect(labels.some((l) => l.includes('Alpha'))).toBe(true);
  expect(labels.some((l) => l.includes('Delta'))).toBe(true);
  // 5th by rank falls outside the 4-suggestion cap.
  expect(labels.some((l) => l.includes('Echo'))).toBe(false);
});

test('empty-query suggestions are filtered to the categories already in the comparison', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          version: 1,
          devices: [
            { slug: 'phone-x', name: 'Phone X', category: 'phone', h: 150, w: 70, d: 8, rank: 90 },
            { slug: 'phone-y', name: 'Phone Y', category: 'phone', h: 150, w: 70, d: 8, rank: 50 },
            {
              slug: 'laptop-z',
              name: 'Laptop Z',
              category: 'laptop',
              h: 200,
              w: 300,
              d: 12,
              rank: 95,
            },
          ],
        }),
    }),
  );

  const user = userEvent.setup();
  setup();
  const input = await screen.findByPlaceholderText('Search');

  // Add the phone via search, then clear the query so suggestions show.
  await user.type(input, 'Phone X');
  await user.click((await screen.findAllByRole('option'))[0]!);

  const labels = (await screen.findAllByRole('option')).map((o) => o.textContent ?? '');
  // Comparison now holds a phone, so only the other phone is suggested — not the higher-ranked laptop.
  expect(labels.some((l) => l.includes('Phone Y'))).toBe(true);
  expect(labels.some((l) => l.includes('Laptop Z'))).toBe(false);
  // And the already-added phone isn't re-suggested.
  expect(labels.some((l) => l.includes('Phone X'))).toBe(false);
});
