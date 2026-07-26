import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { __resetCatalogStore, useCatalog } from '../useCatalog';

function Probe({ id }: { id: string }) {
  const { status, retry } = useCatalog();
  return (
    <div>
      <span data-testid={`status-${id}`}>{status}</span>
      <button data-testid={`retry-${id}`} onClick={retry}>
        retry {id}
      </button>
    </div>
  );
}

beforeEach(() => {
  __resetCatalogStore();
});

test('retrying from one mounted instance unblocks every other mounted instance', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({}) })
    .mockResolvedValue({ ok: true, json: () => Promise.resolve({ version: 1, devices: [] }) });
  vi.stubGlobal('fetch', fetchMock);

  render(
    <>
      <Probe id="a" />
      <Probe id="b" />
    </>,
  );

  await waitFor(() => {
    expect(screen.getByTestId('status-a')).toHaveTextContent('error');
    expect(screen.getByTestId('status-b')).toHaveTextContent('error');
  });

  screen.getByTestId('retry-a').click();

  await waitFor(() => {
    expect(screen.getByTestId('status-a')).toHaveTextContent('ready');
    expect(screen.getByTestId('status-b')).toHaveTextContent('ready');
  });
});

test('two instances mounted together only issue a single initial fetch', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ version: 1, devices: [] }),
  });
  vi.stubGlobal('fetch', fetchMock);

  render(
    <>
      <Probe id="a" />
      <Probe id="b" />
    </>,
  );

  await waitFor(() => {
    expect(screen.getByTestId('status-a')).toHaveTextContent('ready');
    expect(screen.getByTestId('status-b')).toHaveTextContent('ready');
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
