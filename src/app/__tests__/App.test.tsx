import { beforeEach, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: 1, devices: [] }),
    }),
  );
});

test('renders the wordmark', () => {
  render(<App />);
  expect(screen.getByText('size.fyi')).toBeInTheDocument();
});
