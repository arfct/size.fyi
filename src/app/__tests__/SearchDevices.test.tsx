import { useEffect } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchDevices from '../components/SearchDevices';
import { ComparisonProvider, useComparison } from '../store';
import { addMyItem } from '../localStore';
import { __resetCatalogStore } from '../useCatalog';
import { MAX_ITEMS } from '../../shared/types';

function Harness() {
  const { state } = useComparison();
  return (
    <>
      <SearchDevices />
      <ul data-testid="items">
        {state.items.map((it, i) => (
          <li key={i}>
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
  return <SearchDevices />;
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

test('popup shows a my-item match above device results, labeled, and selecting it dispatches a custom add', async () => {
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

  const input = await screen.findByPlaceholderText('iPhone 16, A4 paper…');
  await user.click(input);
  await user.type(input, 'sho');

  const options = await screen.findAllByRole('option');
  expect(options).toHaveLength(2);
  expect(options[0]).toHaveTextContent('Shoebox');
  expect(options[0]).toHaveTextContent('(my item)');
  expect(options[1]).toHaveTextContent('Shovel');
  expect(options[1]).not.toHaveTextContent('(my item)');

  await user.click(options[0]!);

  // Dispatched as a 'custom' item carrying the stored dimensions, not a 'device' add.
  expect(screen.getByTestId('items')).toHaveTextContent('Shoebox 350x250x130');
  expect(input).toHaveValue('');
});

test('disables the combobox at MAX_ITEMS', async () => {
  render(
    <ComparisonProvider>
      <FullHarness />
    </ComparisonProvider>,
  );

  const input = await screen.findByPlaceholderText('iPhone 16, A4 paper…');
  expect(input).toBeDisabled();
});

test('shows curated default devices as options when the popup opens with an empty query', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          version: 1,
          devices: [
            { slug: 'iphone-16-pro', name: 'iPhone 16 Pro', category: 'phone', h: 163, w: 78, d: 8.3 },
            { slug: 'drinks-can', name: 'Drinks Can', category: 'everyday', h: 122, w: 66, d: 66 },
            { slug: 'random-other', name: 'Random Other Thing', category: 'everyday', h: 10, w: 10, d: 10 },
          ],
        }),
    }),
  );

  const user = userEvent.setup();
  setup();

  const input = await screen.findByPlaceholderText('iPhone 16, A4 paper…');
  await user.click(input);

  const options = await screen.findAllByRole('option');
  const labels = options.map((o) => o.textContent ?? '');
  expect(labels.some((l) => l.includes('iPhone 16 Pro'))).toBe(true);
  expect(labels.some((l) => l.includes('Drinks Can'))).toBe(true);
  // Not in the curated defaults list, so it shouldn't show up before typing.
  expect(labels.some((l) => l.includes('Random Other Thing'))).toBe(false);
});
