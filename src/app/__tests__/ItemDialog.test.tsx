import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test } from 'vitest';
import ItemDialog, { type DialogState } from '../components/ItemDialog';
import { ComparisonProvider, useComparison } from '../store';

function Harness({ initial, preload }: { initial: DialogState; preload?: DialogState }) {
  const [dialog, setDialog] = useState<DialogState | null>(initial);
  const { state, dispatch } = useComparison();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          dispatch({ type: 'add', item: { kind: 'custom', name: 'Old', h: 10, w: 10, d: 10 } })
        }
      >
        seed
      </button>
      <button type="button" onClick={() => setDialog(preload ?? null)}>
        reopen
      </button>
      <ItemDialog state={dialog} onClose={() => setDialog(null)} />
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

const renderHarness = (props: { initial: DialogState; preload?: DialogState }) =>
  render(
    <ComparisonProvider>
      <Harness {...props} />
    </ComparisonProvider>,
  );

beforeEach(() => localStorage.clear());

test('add: filling name + dimensions adds a custom item', async () => {
  const user = userEvent.setup();
  renderHarness({ initial: { mode: 'add', name: 'Widget' } });
  await user.type(screen.getByLabelText(/dimensions/i), '50x40x30');
  await user.click(screen.getByRole('button', { name: 'Add' }));
  expect(screen.getByTestId('items')).toHaveTextContent('Widget 50x40x30');
});

test('add: invalid dimensions show an error and add nothing', async () => {
  const user = userEvent.setup();
  renderHarness({ initial: { mode: 'add', name: 'Widget' } });
  await user.type(screen.getByLabelText(/dimensions/i), 'nope');
  await user.click(screen.getByRole('button', { name: 'Add' }));
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.getByTestId('items')).toBeEmptyDOMElement();
});

test('edit: saving replaces the item at its index in place', async () => {
  const user = userEvent.setup();
  // Start closed; seed one item, then reopen in edit mode for index 0.
  renderHarness({
    initial: null as unknown as DialogState,
    preload: { mode: 'edit', index: 0, name: 'Renamed', dims: '99×88×77' },
  });
  await user.click(screen.getByRole('button', { name: 'seed' }));
  expect(screen.getByTestId('items')).toHaveTextContent('Old 10x10x10');
  await user.click(screen.getByRole('button', { name: 'reopen' }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  const items = screen.getByTestId('items');
  expect(items).toHaveTextContent('Renamed 99x88x77');
  expect(items).not.toHaveTextContent('Old');
});
