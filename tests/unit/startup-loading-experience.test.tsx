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
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['/', 'route-loading-chat', 'sidebar'],
    ['/settings/models', 'route-loading-settings', 'settings-sidebar'],
    ['/knowledge', 'route-loading-generic', 'sidebar'],
  ])('keeps MainLayout mounted for the %s fallback', async (pathname, fallbackTestId, sidebarTestId) => {
    const deferred = renderDeferredMainRoute(pathname);

    expect(screen.getByTestId('main-layout')).toBeVisible();
    expect(screen.getByTestId(sidebarTestId)).toBeInTheDocument();
    expect(screen.getByTestId('titlebar')).toBeInTheDocument();
    expect(screen.getByTestId('route-loading-pending')).toHaveAttribute('aria-busy', 'true');

    act(() => vi.advanceTimersByTime(199));
    expect(screen.queryByTestId(fallbackTestId)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId(fallbackTestId)).toHaveAttribute('aria-busy', 'true');

    vi.useRealTimers();
    await act(async () => {
      deferred.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('resolved-route')).toBeVisible();
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

  it('delays the quiet section skeleton and never mounts a structural surface', () => {
    render(<SettingsSectionLoading label="Loading settings" variant="archived" />);

    const loading = screen.getByTestId('settings-section-loading');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading).toHaveAttribute('data-state', 'pending');
    expect(screen.queryByTestId('settings-section-loading-skeleton')).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(199));
    expect(screen.queryByTestId('settings-section-loading-skeleton')).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(loading).toHaveAttribute('data-state', 'visible');
    expect(screen.getByTestId('settings-section-loading-skeleton')).toBeVisible();
    expect(loading.querySelector('[data-structural-surface]')).toBeNull();
    expect(screen.getByText('Loading settings')).toBeInTheDocument();
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

