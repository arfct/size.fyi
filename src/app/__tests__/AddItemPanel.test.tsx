import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AddItemPanel from '../components/AddItemPanel';
import { ComparisonProvider, useComparison } from '../store';

function Harness() {
  const { state } = useComparison();
  return (
    <>
      <AddItemPanel />
      <ul data-testid="items">
        {state.items.map((it, i) => (
          <li key={i}>{it.kind === 'custom' ? it.name : it.device.name}</li>
        ))}
      </ul>
    </>
  );
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
  fireEvent.change(screen.getByPlaceholderText('85x64x12mm or 5x3x2in'), { target: { value: 'foo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add item' }));

  expect(screen.getByRole('alert')).toHaveTextContent(
    'Use height x width x depth, e.g. 85x64x12mm or 5x3x2in',
  );
  expect(screen.getByTestId('items').children).toHaveLength(0);
});

test('accepts valid dimensions, adds the item, and clears the form', () => {
  setup();
  fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Widget' } });
  fireEvent.change(screen.getByPlaceholderText('85x64x12mm or 5x3x2in'), { target: { value: '85x64x12mm' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add item' }));

  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByTestId('items')).toHaveTextContent('Widget');
  expect(screen.getByPlaceholderText('Name')).toHaveValue('');
  expect(screen.getByPlaceholderText('85x64x12mm or 5x3x2in')).toHaveValue('');
});

test('pressing Enter in the dimensions field submits the custom item', () => {
  setup();
  fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Gadget' } });
  const dimsInput = screen.getByPlaceholderText('85x64x12mm or 5x3x2in');
  fireEvent.change(dimsInput, { target: { value: '5x3x2in' } });
  fireEvent.keyDown(dimsInput, { key: 'Enter' });

  expect(screen.getByTestId('items')).toHaveTextContent('Gadget');
});

test('missing a name reports an inline error and does not add an item', () => {
  setup();
  fireEvent.change(screen.getByPlaceholderText('85x64x12mm or 5x3x2in'), { target: { value: '85x64x12mm' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add item' }));

  expect(screen.getByRole('alert')).toHaveTextContent('Give it a name');
  expect(screen.getByTestId('items').children).toHaveLength(0);
});
