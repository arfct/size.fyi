import { useEffect } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddItemPanel from '../components/AddItemPanel';
import { ComparisonProvider, useComparison } from '../store';
import { addMyItem } from '../localStore';
import { __resetCatalogStore } from '../useCatalog';
import { MAX_ITEMS } from '../../shared/types';

function Harness() {
  const { state } = useComparison();
  return (
    <>
      <AddItemPanel />
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
  return <AddItemPanel />;
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

test('rejects invalid dimensions with an inline error and does not add an item', () => {
  setup();
  fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Thing' } });
  const dimsInput = screen.getByPlaceholderText('85×64×12 or 5×3×2in');
  fireEvent.change(dimsInput, { target: { value: 'foo' } });
  fireEvent.keyDown(dimsInput, { key: 'Enter' });

  expect(screen.getByRole('alert')).toHaveTextContent(
    'Use height × width × depth, e.g. 85×64×12mm or 5×3×2in',
  );
  expect(screen.getByTestId('items').children).toHaveLength(0);
});

test('accepts valid dimensions, adds the item, and clears the form', () => {
  setup();
  fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Widget' } });
  const dimsInput = screen.getByPlaceholderText('85×64×12 or 5×3×2in');
  fireEvent.change(dimsInput, { target: { value: '85x64x12mm' } });
  fireEvent.keyDown(dimsInput, { key: 'Enter' });

  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByTestId('items')).toHaveTextContent('Widget');
  expect(screen.getByPlaceholderText('Name')).toHaveValue('');
  expect(screen.getByPlaceholderText('85×64×12 or 5×3×2in')).toHaveValue('');
});

test('pressing Enter in the dimensions field submits the custom item', () => {
  setup();
  fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Gadget' } });
  const dimsInput = screen.getByPlaceholderText('85×64×12 or 5×3×2in');
  fireEvent.change(dimsInput, { target: { value: '5x3x2in' } });
  fireEvent.keyDown(dimsInput, { key: 'Enter' });

  expect(screen.getByTestId('items')).toHaveTextContent('Gadget');
});

test('pressing Enter in the name field also submits the custom item', () => {
  setup();
  const nameInput = screen.getByPlaceholderText('Name');
  fireEvent.change(nameInput, { target: { value: 'Doohickey' } });
  fireEvent.change(screen.getByPlaceholderText('85×64×12 or 5×3×2in'), { target: { value: '5x3x2in' } });
  fireEvent.keyDown(nameInput, { key: 'Enter' });

  expect(screen.getByTestId('items')).toHaveTextContent('Doohickey');
  expect(nameInput).toHaveValue('');
});

test('missing a name reports an inline error and does not add an item', () => {
  setup();
  const dimsInput = screen.getByPlaceholderText('85×64×12 or 5×3×2in');
  fireEvent.change(dimsInput, { target: { value: '85x64x12mm' } });
  fireEvent.keyDown(dimsInput, { key: 'Enter' });

  expect(screen.getByRole('alert')).toHaveTextContent('Give it a name');
  expect(screen.getByTestId('items').children).toHaveLength(0);
});

test('disables the combobox and custom-entry fields, and shows the full notice, at MAX_ITEMS', async () => {
  render(
    <ComparisonProvider>
      <FullHarness />
    </ComparisonProvider>,
  );

  const input = await screen.findByPlaceholderText('iPhone 16, A4 paper…');
  expect(input).toBeDisabled();
  expect(screen.getByPlaceholderText('Name')).toBeDisabled();
  expect(screen.getByPlaceholderText('85×64×12 or 5×3×2in')).toBeDisabled();
  expect(screen.getByText(`Comparison is full (${MAX_ITEMS} items)`)).toBeInTheDocument();
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
