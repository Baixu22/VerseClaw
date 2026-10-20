import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentsLoadingSurface } from '@/pages/Agents/AgentsLoadingSurface';

const rows = ['main', 'research', 'review'].map((id) => <button key={id} data-testid={id}>{id}</button>);
const surface = () => document.querySelector('[data-structural-surface="agents"]')!;

describe('Agents construction handoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips construction for a fast response', () => {
    const { rerender } = render(<AgentsLoadingSurface loading label="Loading agents" rows={[]} />);
    act(() => vi.advanceTimersByTime(100));
    rerender(<AgentsLoadingSurface loading={false} label="Loading agents" rows={rows} />);
    act(() => vi.advanceTimersByTime(300));
    expect(surface()).toHaveAttribute('data-state', 'idle');
    expect(screen.getByTestId('main').closest('[data-build-state]')).toHaveAttribute('data-build-state', 'complete');
    expect(screen.queryByTestId('agents-structure-row')).toBeNull();
  });

  it('hands actual rows off in three bounded groups with independent remaining wireframes', () => {
    const { rerender } = render(<AgentsLoadingSurface loading label="Loading agents" rows={[]} />);
    act(() => vi.advanceTimersByTime(240));
    expect(surface()).toHaveAttribute('data-state', 'visible');
    expect(screen.getAllByTestId('agents-structure-row')).toHaveLength(3);

    rerender(<AgentsLoadingSurface loading={false} label="Loading agents" rows={rows} />);
    expect(surface()).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByTestId('main').closest('[data-build-state]')).toHaveAttribute('data-build-state', 'revealing');
    expect(screen.getByTestId('review').closest('[inert]')).not.toBeNull();

    act(() => vi.advanceTimersByTime(220));
    expect(screen.getByTestId('main').closest('[data-build-state]')).toHaveAttribute('data-build-state', 'complete');
    expect(screen.getByTestId('research').closest('[data-build-state]')).toHaveAttribute('data-build-state', 'revealing');
    expect(screen.getByTestId('review').closest('[data-build-state]')).toHaveAttribute('data-build-state', 'pending');

    act(() => vi.advanceTimersByTime(440));
    expect(surface()).toHaveAttribute('data-state', 'idle');
    expect(surface().querySelectorAll('[inert]')).toHaveLength(0);
    expect(surface().querySelectorAll('[data-build-state="complete"]')).toHaveLength(3);
  });

  it('stops on an empty/error response and cleans timers on unmount', () => {
    const { rerender, unmount } = render(<AgentsLoadingSurface loading label="Loading agents" rows={[]} />);
    act(() => vi.advanceTimersByTime(240));
    rerender(<AgentsLoadingSurface loading={false} label="Loading agents" rows={[]} />);
    act(() => vi.advanceTimersByTime(1));
    expect(surface()).toHaveAttribute('data-state', 'idle');
    expect(screen.queryByTestId('agents-structure-row')).toBeNull();

    rerender(<AgentsLoadingSurface loading label="Loading agents" rows={[]} />);
    unmount();
    act(() => vi.runAllTimers());
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses all three groups for four rows and shortens single-row handoff', () => {
    const { rerender } = render(<AgentsLoadingSurface loading label="Loading agents" rows={[]} />);
    act(() => vi.advanceTimersByTime(240));
    const fourRows = [...rows, <button key="tools" data-testid="tools">tools</button>];
    rerender(<AgentsLoadingSurface loading={false} label="Loading agents" rows={fourRows} />);
    act(() => vi.advanceTimersByTime(440));
    expect(screen.getByTestId('tools').closest('[data-build-state]')).toHaveAttribute('data-build-state', 'revealing');
    act(() => vi.advanceTimersByTime(220));

    rerender(<AgentsLoadingSurface loading label="Loading agents" rows={[]} />);
    act(() => vi.advanceTimersByTime(240));
    rerender(<AgentsLoadingSurface loading={false} label="Loading agents" rows={rows.slice(0, 1)} />);
    act(() => vi.advanceTimersByTime(220));
    expect(surface()).toHaveAttribute('data-state', 'idle');
  });

  it('reveals all resolved rows immediately with reduced motion', () => {
    vi.mocked(window.matchMedia).mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)', media: query,
      onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    const { rerender } = render(<AgentsLoadingSurface loading label="Loading agents" rows={[]} />);
    act(() => vi.advanceTimersByTime(240));
    rerender(<AgentsLoadingSurface loading={false} label="Loading agents" rows={rows} />);
    expect(surface()).toHaveAttribute('data-state', 'idle');
    expect(surface().querySelectorAll('[data-build-state="complete"]')).toHaveLength(3);
  });
});
