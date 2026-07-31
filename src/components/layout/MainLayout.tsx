/**
 * Main Layout Component
 * Platform-aware application shell.
 */
import { Suspense, useEffect } from 'react';
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
import { useUiVersion } from './ui-overlay-context';
import { useWorkspacesStore } from '@/stores/workspaces';

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
  const uiVersion = useUiVersion();
  const isUiV2 = uiVersion === 'v2' && isWin;
  const isSettingsRoute = location.pathname.startsWith('/settings');
  const fetchWorkspaces = useWorkspacesStore((s) => s.fetchWorkspaces);

  useEffect(() => {
    void fetchWorkspaces();
  }, [fetchWorkspaces]);

  return (
    <div
      data-testid="main-layout"
      data-platform={platform}
      data-ui-version={uiVersion}
      className={cn(
        'flex h-screen overflow-hidden',
        isWin ? 'bg-surface-sidebar' : 'bg-background',
        isMac ? 'flex-row' : 'flex-col',
      )}
    >
      <BootShellHandoff />
      <TitleBar />

      <div
        data-testid="app-content-stage"
        data-depth="base"
        className={cn(
          'flex min-h-0 flex-1 overflow-hidden bg-surface-sidebar',
          isUiV2 && !isSettingsRoute && 'app-content-stage-v2 rounded-tl-[20px]',
        )}
      >
        {isSettingsRoute ? <SettingsSidebar /> : <Sidebar />}
        <main
          data-testid="main-content"
          className={cn(
            'relative min-h-0 flex-1 border-l border-border/60 bg-background',
            isSettingsRoute
              ? 'overflow-hidden border-l-0 p-0 rounded-none shadow-none'
              : cn('overflow-auto p-6', isUiV2 ? 'rounded-tl-[20px] shadow-[-1px_0_0_rgba(255,255,255,0.45)]' : 'rounded-tl-2xl'),
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
