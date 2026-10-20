import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressiveLoadingSurface } from '@/components/loading/StructuralLoadingOverlay';

function Surface({ loading, reducedMotion = false }: { loading: boolean; reducedMotion?: boolean }) {
  if (reducedMotion) {
    vi.mocked(window.matchMedia).mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }

  return (
    <ProgressiveLoadingSurface
      surfaceId="agents"
      loading={loading}
      label="Loading agents"
      skeleton={(
        <div data-testid="surface-skeleton">
          <div data-structural-region data-reveal-order="0" className="h-20" />
        </div>
      )}
    >
      <div data-testid="surface-content">Loaded agents</div>
    </ProgressiveLoadingSurface>
  );
}

describe('ProgressiveLoadingSurface', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never shows structure when loading completes before the delay', () => {
    const { rerender } = render(<Surface loading />);
    expect(screen.queryByTestId('surface-skeleton')).not.toHaveAttribute('data-state', 'visible');

    rerender(<Surface loading={false} />);
    act(() => vi.advanceTimersByTime(300));

    expect(screen.getByTestId('surface-content')).toBeVisible();
    expect(screen.queryByTestId('surface-skeleton')).not.toBeInTheDocument();
    expect(document.querySelector('[data-structural-canvas]')).toBeNull();
  });

  it('shows a region-scoped skeleton, then keeps content while the structure exits', () => {
    const { rerender } = render(<Surface loading />);
    act(() => vi.advanceTimersByTime(300));

    const surface = document.querySelector('[data-structural-surface="agents"]');
    expect(surface).toHaveAttribute('data-state', 'visible');
    expect(screen.getByTestId('surface-skeleton')).toBeVisible();
    expect(document.querySelector('[data-structural-canvas]')).not.toBeNull();

    rerender(<Surface loading={false} />);
    expect(screen.getByTestId('surface-content')).toBeVisible();
    expect(surface).toHaveAttribute('data-state', 'leaving');

    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByTestId('surface-skeleton')).not.toBeInTheDocument();
    expect(screen.getByTestId('surface-content')).toBeVisible();
  });

  it('removes the skeleton immediately under reduced motion', () => {
    const { rerender } = render(<Surface loading reducedMotion />);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByTestId('surface-skeleton')).toBeVisible();

    rerender(<Surface loading={false} reducedMotion />);
    act(() => vi.advanceTimersByTime(1));

    expect(screen.queryByTestId('surface-skeleton')).not.toBeInTheDocument();
    expect(screen.getByTestId('surface-content')).toBeVisible();
  });
});