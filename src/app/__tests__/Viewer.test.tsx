import { useEffect } from 'react';
import { expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Viewer from '../components/Viewer';
import { ComparisonProvider, useComparison } from '../store';

vi.mock('../../three/scene', () => ({
  createScene: () => { throw new Error('WebGL unavailable'); },
}));

function Harness() {
  const { dispatch } = useComparison();
  useEffect(() => {
    dispatch({ type: 'add', item: { kind: 'custom', name: 'Phone', h: 150, w: 75, d: 8 } });
  }, [dispatch]);
  return <Viewer />;
}

test('shows a fallback message when the 3D scene fails to initialize', () => {
  render(
    <ComparisonProvider>
      <Harness />
    </ComparisonProvider>,
  );
  expect(screen.getByText(/3D view isn't available in this browser/)).toBeInTheDocument();
});
