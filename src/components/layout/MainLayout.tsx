/**
 * Main Layout Component
 * Platform-aware application shell.
 */
import { Suspense, useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { SettingsSidebar } from '@/pages/Settings/SettingsSidebar';
import { TitleBar } from './TitleBar';
import { MAC_SIDEBAR_CHROME_HEIGHT } from '@shared/sidebar-layout';
import { cn } from '@/lib/utils';
import {
  BootShellHandoff,
  ChatRouteLoadingShell,
  GenericRouteLoadingShell,
  SettingsRouteLoadingShell,
} from '@/components/loading/RouteLoadingShell';
import { useWorkspacesStore } from '@/stores/workspaces';
import { useSettingsStore } from '@/stores/settings';

const SIDEBAR_AUTO_COLLAPSE_WIDTH = 1120;
const SIDEBAR_AUTO_EXPAND_WIDTH = 1200;

function RouteLoadingFallback({ pathname }: { pathname: string }) {
  if (pathname === '/') return <ChatRouteLoadingShell />;
  if (pathname.startsWith('/settings')) return <SettingsRouteLoadingShell />;
  return <GenericRouteLoadingShell />;
}

export function MainLayout() {
  const location = useLocation();
  const platform = window.electron?.platform;
  const isMac = platform === 'darwin';
  const isWin = platform === 'win32';
  const isSettingsRoute = location.pathname.startsWith('/settings');
  const fetchWorkspaces = useWorkspacesStore((s) => s.fetchWorkspaces);
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const autoCollapsedSidebar = useRef(false);

  useEffect(() => {
    void fetchWorkspaces();
  }, [fetchWorkspaces]);

  useEffect(() => {
    if (isSettingsRoute) return;
    const stage = document.querySelector<HTMLElement>('[data-testid="app-content-stage"]');
    if (!stage) return;

    const updateSidebarDensity = () => {
      const width = stage.clientWidth || window.innerWidth;
      const isNarrow = width < SIDEBAR_AUTO_COLLAPSE_WIDTH;
      if (isNarrow) {
        if (!sidebarCollapsed) {
          autoCollapsedSidebar.current = true;
          setSidebarCollapsed(true);
        }
        return;
      }
      if (width >= SIDEBAR_AUTO_EXPAND_WIDTH && autoCollapsedSidebar.current) {
        autoCollapsedSidebar.current = false;
        setSidebarCollapsed(false);
      }
    };

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateSidebarDensity) : null;
    observer?.observe(stage);
    updateSidebarDensity();
    return () => observer?.disconnect();
  }, [isSettingsRoute, setSidebarCollapsed, sidebarCollapsed]);

  return (
    <div
      data-testid="main-layout"
      data-platform={platform}
      data-ui-version="v2"
      className={cn(
        'flex h-screen overflow-hidden',
        'bg-surface-sidebar',
        isMac ? 'flex-row' : 'flex-col',
      )}
    >
      <BootShellHandoff />
      <TitleBar />

      <div
        data-testid="app-content-stage"
        data-depth="base"
        className={cn(
          'flex min-h-0 min-w-0 flex-1 overflow-hidden bg-surface-sidebar',
          !isSettingsRoute && 'app-content-stage-v2',
        )}
      >
        {isSettingsRoute ? <SettingsSidebar /> : <Sidebar />}
        <main
          data-testid="main-content"
          className={cn(
            'relative min-h-0 min-w-0 flex-1 border-l border-border bg-background',
            isSettingsRoute
              ? 'overflow-hidden border-l-0 p-0 rounded-none shadow-none'
              : 'overflow-auto p-5',
            !isWin && 'border-t border-border/60',
          )}
        >
          {isMac && (
            <div
              data-testid="mac-main-drag-region"
              aria-hidden="true"
              className="drag-region absolute inset-x-0 top-0 z-10"
              style={{ height: MAC_SIDEBAR_CHROME_HEIGHT }}
            />
          )}
          <Suspense fallback={<RouteLoadingFallback pathname={location.pathname} />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
