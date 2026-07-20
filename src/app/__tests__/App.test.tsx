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

test('renders the wordmark as a link home', () => {
  render(<App />);
  const wordmark = screen.getByRole('link', { name: 'size.fyi' });
  expect(wordmark).toBeInTheDocument();
  expect(wordmark).toHaveAttribute('href', '/');
});
