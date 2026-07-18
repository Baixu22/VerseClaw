/**
 * Main Layout Component
 * Platform-aware application shell.
 */
import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';
import { MAC_SIDEBAR_CHROME_HEIGHT } from '@shared/sidebar-layout';
import { cn } from '@/lib/utils';
import {
  BootShellHandoff,
  ChatRouteLoadingShell,
  GenericRouteLoadingShell,
  SettingsRouteLoadingShell,
} from '@/components/loading/RouteLoadingShell';
import { useUiOverlay } from './ui-overlay-context';
import { MOTION_SPRING } from '@/components/ui/motion';

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
  const reduceMotion = useReducedMotion();
  const { uiVersion, settingsOpen } = useUiOverlay();
  const isUiV2 = uiVersion === 'v2' && isWin;

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

      <motion.div
        data-testid="app-content-stage"
        data-depth={settingsOpen ? 'recessed' : 'base'}
        className={cn(
          'flex min-h-0 flex-1 overflow-hidden bg-surface-sidebar',
          isUiV2 && 'app-content-stage-v2 rounded-tl-[20px]',
        )}
        initial={false}
        animate={{
          transform: isUiV2 && settingsOpen && !reduceMotion
            ? 'scale(0.985) translateX(-8px)'
            : 'scale(1) translateX(0px)',
          opacity: isUiV2 && settingsOpen ? 0.96 : 1,
        }}
        transition={reduceMotion ? { duration: 0.16 } : MOTION_SPRING.surface}
        style={{ transformOrigin: 'left center', willChange: settingsOpen ? 'transform, opacity' : undefined }}
      >
        <Sidebar />
        <main
          data-testid="main-content"
          className={cn(
            'relative min-h-0 flex-1 overflow-auto border-l border-border/60 bg-background p-6',
            isUiV2 ? 'rounded-tl-[20px] shadow-[-1px_0_0_rgba(255,255,255,0.45)]' : 'rounded-tl-2xl',
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
      </motion.div>
    </div>
  );
}
