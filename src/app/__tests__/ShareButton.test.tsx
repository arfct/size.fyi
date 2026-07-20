import { useEffect } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ShareButton from '../components/ShareButton';
import { ComparisonProvider, useComparison } from '../store';

// NOTE: deliberately uses fireEvent (not @testing-library/user-event) here.
// userEvent.setup() unconditionally installs its own navigator.clipboard stub
// (see @testing-library/user-event/dist/.../utils/dataTransfer/Clipboard.js,
// attachClipboardStubToView), which clobbers any custom mock we install for
// these tests regardless of call order. A plain click doesn't need the full
// interaction simulation userEvent provides, so fireEvent sidesteps it.

function Harness() {
  const { dispatch } = useComparison();
  useEffect(() => {
    dispatch({ type: 'add', item: { kind: 'custom', name: 'Phone', h: 150, w: 75, d: 8 } });
  }, [dispatch]);
  return <ShareButton />;
}

function setup() {
  return render(
    <ComparisonProvider>
      <Harness />
    </ComparisonProvider>,
  );
}

const originalShare = Object.getOwnPropertyDescriptor(navigator, 'share');
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

afterEach(() => {
  if (originalShare) Object.defineProperty(navigator, 'share', originalShare);
  else delete (navigator as { share?: unknown }).share;
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete (navigator as { clipboard?: unknown }).clipboard;
  vi.restoreAllMocks();
});

test('when the user cancels the native share sheet, it never falls through to the clipboard', async () => {
  const share = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'));
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));

  await waitFor(() => expect(share).toHaveBeenCalled());
  expect(writeText).not.toHaveBeenCalled();
  expect(screen.getByRole('button')).toHaveTextContent('Share');
});

test('when share is unsupported and the clipboard write fails, it silently no-ops', async () => {
  delete (navigator as { share?: unknown }).share;
  const writeText = vi.fn().mockRejectedValue(new Error('denied'));
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));

  await waitFor(() => expect(writeText).toHaveBeenCalled());
  expect(screen.getByRole('button')).toHaveTextContent('Share');
});

test('when share is unsupported and the clipboard write succeeds, it shows Copied!', async () => {
  delete (navigator as { share?: unknown }).share;
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));

  await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Copied!'));
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/phone~150x75x8'));
});
