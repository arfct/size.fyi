import { useEffect } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CustomEntry from '../components/CustomEntry';
import { ComparisonProvider, useComparison } from '../store';
import { MAX_ITEMS } from '../../shared/types';

function Harness() {
  const { state } = useComparison();
  return (
    <>
      <CustomEntry />
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
  return <CustomEntry />;
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
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: 1, devices: [] }),
    }),
  );
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

test('disables the custom-entry fields and shows the full notice at MAX_ITEMS', async () => {
  render(
    <ComparisonProvider>
      <FullHarness />
    </ComparisonProvider>,
  );

  expect(await screen.findByPlaceholderText('Name')).toBeDisabled();
  expect(screen.getByPlaceholderText('85×64×12 or 5×3×2in')).toBeDisabled();
  expect(screen.getByText(`Comparison is full (${MAX_ITEMS} items)`)).toBeInTheDocument();
});
