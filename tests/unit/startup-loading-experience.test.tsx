import { act, render, screen } from '@testing-library/react';
import { lazy, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MainLayout } from '@/components/layout/MainLayout';
import { SettingsSectionLoading } from '@/pages/Settings/sections/SettingsSectionLoading';
import { BootShellHandoff } from '@/components/loading/RouteLoadingShell';

vi.mock('@/components/layout/Sidebar', () => ({
  Sidebar: () => <aside data-testid="sidebar" />,
}));

vi.mock('@/components/layout/TitleBar', () => ({
  TitleBar: () => <div data-testid="titlebar" />,
}));

function createDeferredRoute(testId: string) {
  let resolveModule!: () => void;
  const modulePromise = new Promise<{ default: () => ReactNode }>((resolve) => {
    resolveModule = () => resolve({ default: () => <div data-testid={testId} /> });
  });

  return {
    Component: lazy(() => modulePromise),
    resolve: resolveModule,
  };
}

function renderDeferredMainRoute(pathname: string) {
  const deferred = createDeferredRoute('resolved-route');
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path={pathname} element={<deferred.Component />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return deferred;
}

describe('route loading shells', () => {
  it.each([
    ['/', 'route-loading-chat'],
    ['/settings/models', 'route-loading-settings'],
    ['/knowledge', 'route-loading-generic'],
  ])('keeps MainLayout mounted for the %s fallback', async (pathname, fallbackTestId) => {
    const deferred = renderDeferredMainRoute(pathname);

    expect(screen.getByTestId('main-layout')).toBeVisible();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('titlebar')).toBeInTheDocument();
    expect(screen.getByTestId(fallbackTestId)).toHaveAttribute('aria-busy', 'true');

    await act(async () => deferred.resolve());

    expect(await screen.findByTestId('resolved-route')).toBeVisible();
    expect(screen.queryByTestId(fallbackTestId)).not.toBeInTheDocument();
    expect(screen.getByTestId('main-layout')).toBeVisible();
  });
});

describe('Settings section loading feedback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delays the local skeleton and status without losing reduced-motion safeguards', () => {
    render(<SettingsSectionLoading label="Loading settings" />);

    const loading = screen.getByTestId('settings-section-loading');
    const status = screen.getByTestId('settings-section-loading-status');
    const skeleton = loading.children.item(1);
    expect(skeleton).not.toBeNull();
    expect(skeleton).toHaveClass('opacity-0');
    expect(status).toHaveClass('opacity-0');

    act(() => vi.advanceTimersByTime(100));
    expect(skeleton).toHaveClass('opacity-100');
    expect(status).toHaveClass('opacity-0');

    act(() => vi.advanceTimersByTime(500));
    expect(status).toHaveClass('opacity-100', 'motion-reduce:transition-none');
    expect(screen.getAllByText('Loading settings')).toHaveLength(2);

    const shimmer = Array.from(loading.querySelectorAll('[aria-hidden="true"]'))
      .find((element) => element.getAttribute('class')?.includes('motion-safe:animate-'));
    expect(shimmer).toHaveClass('motion-safe:animate-[ai-elements-shimmer_1.8s_linear_infinite]');
    const dot = loading.querySelector('[data-slot="dot-matrix-dot"]');
    expect(dot).toHaveClass('motion-reduce:[animation-name:none]');
  });
});

describe('boot shell handoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/?e2eBootHoldMs=500');
    document.documentElement.dataset.bootStartedAt = String(performance.now());
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<div id="boot-shell" data-testid="boot-shell" aria-hidden="true"></div>',
    );
  });

  afterEach(() => {
    document.getElementById('boot-shell')?.remove();
    delete document.documentElement.dataset.bootStartedAt;
    window.history.replaceState({}, '', '/');
    vi.useRealTimers();
  });

  it('honors the E2E hold before the 160ms visual handoff', () => {
    render(<BootShellHandoff />);

    act(() => vi.advanceTimersByTime(499));
    expect(screen.getByTestId('boot-shell')).not.toHaveAttribute('data-state');

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('boot-shell')).toHaveAttribute('data-state', 'leaving');

    act(() => vi.advanceTimersByTime(159));
    expect(screen.getByTestId('boot-shell')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('boot-shell')).not.toBeInTheDocument();
  });

  it('removes the shell immediately after the hold under reduced motion', () => {
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

    render(<BootShellHandoff />);
    act(() => vi.advanceTimersByTime(500));
    act(() => vi.advanceTimersByTime(1));

    expect(screen.queryByTestId('boot-shell')).not.toBeInTheDocument();
  });
});
