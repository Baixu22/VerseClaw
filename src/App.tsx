/**
 * Root Application Component
 * Handles routing and global providers
 */
import { Navigate, Routes, Route, useNavigate, useLocation, type Location } from 'react-router-dom';
import { Component, lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Toaster } from 'sonner';
import i18n from './i18n';
import { MainLayout } from './components/layout/MainLayout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BootShellHandoff, SetupRouteLoadingShell } from './components/loading/RouteLoadingShell';
import { useSettingsStore } from './stores/settings';
import { useGatewayStore } from './stores/gateway';
import { useProviderStore } from './stores/providers';
import { useStorageHealthStore } from './stores/storage-health';
import { rendererExtensionRegistry } from './extensions/registry';
import { loadExternalRendererExtensions } from './extensions/_ext-bridge.generated';
import { useNewChatAction } from './components/layout/use-new-chat-action';
import { hostEvents } from './lib/host-events';
import { recoverFromDynamicImportLoadError } from './lib/dynamic-import-recovery';
import { getAgentDevScenarioRoute, installAgentDevTestSurface } from './lib/agent-dev';
import { applyDocumentTheme } from './lib/theme';
import { SettingsRoute } from './pages/Settings/SettingsRoute';
import { resolveUiVersion } from './lib/ui-version';
import type { WorkspacePanelIntent } from '@shared/types/workspace';
import { UiOverlayProvider } from './components/layout/ui-overlay-context';
import { toRoutePath } from './lib/settings-overlay-routing';
import { OverlayPortalProvider } from './components/ui/overlay-portal';

const Chat = lazy(() => import('./pages/Chat').then((m) => ({ default: m.Chat })));
const Cron = lazy(() => import('./pages/Cron').then((m) => ({ default: m.Cron })));
const Inbox = lazy(() => import('./pages/Inbox').then((m) => ({ default: m.Inbox })));
const Dreams = lazy(() => import('./pages/Dreams').then((m) => ({ default: m.Dreams })));
const ImageGenerationPage = lazy(() => import('./pages/ImageGeneration').then((m) => ({ default: m.ImageGenerationPage })));
const ObservabilityDashboard = lazy(() => import('./pages/Observability').then((m) => ({ default: m.ObservabilityDashboard })));
const TaskLedgerPage = lazy(() => import('./pages/TaskLedger'));
const ClawGraphPage = lazy(() => import('./pages/ClawGraph'));
const CodeReviewPage = lazy(() => import('./pages/CodeReview'));
const Knowledge = lazy(() => import('./pages/Knowledge').then((m) => ({ default: m.Knowledge })));
const BrowserWorkbench = lazy(() => import('./pages/Browser').then((m) => ({ default: m.BrowserWorkbench })));
const Setup = lazy(() => import('./pages/Setup').then((m) => ({ default: m.Setup })));
const UiV2Showcase = lazy(() => import('./pages/UiV2Showcase').then((m) => ({ default: m.UiV2Showcase })));

function WorkspaceCompatibilityRoute({
  intent,
  legacy,
}: {
  intent: WorkspacePanelIntent;
  legacy: ReactNode;
}) {
  const location = useLocation();
  if (resolveUiVersion(window.electron?.platform, location.search) === 'legacy') return legacy;

  const search = new URLSearchParams(location.search);
  search.set('workspacePanel', intent.panel);
  if ('view' in intent && intent.view) search.set('view', intent.view);
  if (intent.panel === 'browser') {
    if (intent.url) search.set('url', intent.url);
    if (intent.sessionId) search.set('sessionId', intent.sessionId);
  }
  if ((intent.panel === 'review' || intent.panel === 'files') && intent.filePath) {
    search.set('filePath', intent.filePath);
  }
  if (intent.panel === 'terminal' && intent.placement) search.set('placement', intent.placement);
  if (intent.panel === 'artifact' && intent.artifactId) search.set('artifactId', intent.artifactId);
  return (
    <Navigate
      to={{ pathname: '/', search: `?${search.toString()}` }}
      state={{ workspacePanelIntent: intent }}
      replace
    />
  );
}

function SetupRoute() {
  return (
    <Suspense fallback={<SetupRouteLoadingShell />}>
      <BootShellHandoff />
      <Setup />
    </Suspense>
  );
}

type ExtraRoute = ReturnType<typeof rendererExtensionRegistry.getExtraRoutes>[number];

type BackgroundRoutesProps = {
  location: Location;
  devModeUnlocked: boolean;
  extraRoutes: ExtraRoute[];
};

const BackgroundRoutes = memo(function BackgroundRoutes({
  location,
  devModeUnlocked,
  extraRoutes,
}: BackgroundRoutesProps) {
  return (
    <Routes location={location}>
      <Route path="/setup/*" element={<SetupRoute />} />

      <Route element={<MainLayout />}>
        <Route path="/" element={<Chat />} />
        <Route path="/models" element={<Navigate to="/settings/models" replace />} />
        <Route path="/agents" element={<Navigate to="/settings/agents" replace />} />
        <Route path="/channels" element={<Navigate to="/settings/channels" replace />} />
        <Route path="/skills" element={<Navigate to="/settings/skills" replace />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/cron" element={<Cron />} />
        <Route path="/remote-tasks" element={<Navigate to="/inbox?source=remote-task" replace />} />
        <Route path="/task-ledger" element={<TaskLedgerPage />} />
        <Route path="/clawgraph" element={<ClawGraphPage />} />
        <Route
          path="/code-review"
          element={(
            <WorkspaceCompatibilityRoute
              intent={{ panel: 'review', view: 'ai-review' }}
              legacy={<CodeReviewPage />}
            />
          )}
        />
        <Route path="/knowledge" element={<Knowledge />} />
        <Route
          path="/browser"
          element={(
            <WorkspaceCompatibilityRoute
              intent={{ panel: 'browser', view: 'live' }}
              legacy={<BrowserWorkbench />}
            />
          )}
        />
        <Route path="/image-generation" element={devModeUnlocked ? <ImageGenerationPage /> : <Navigate to="/" replace />} />
        <Route path="/dreams" element={devModeUnlocked ? <Dreams /> : <Navigate to="/" replace />} />
        <Route path="/observability" element={<ObservabilityDashboard />} />
        <Route path="/ui-v2-showcase" element={<UiV2Showcase />} />
        <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
        <Route path="/settings/*" element={<SettingsRoute />} />
        {extraRoutes.map((route) => (
          <Route key={route.path} path={route.path} element={<route.component />} />
        ))}
      </Route>
    </Routes>
  );
}, (previous, next) => (
  previous.location === next.location
  && previous.devModeUnlocked === next.devModeUnlocked
  && previous.extraRoutes.length === next.extraRoutes.length
  && previous.extraRoutes.every((route, index) => (
    route.path === next.extraRoutes[index]?.path
    && route.component === next.extraRoutes[index]?.component
  ))
));

/**
 * Error Boundary to catch and display React rendering errors
 */
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (recoverFromDynamicImportLoadError(error)) {
      console.warn('Recovering from stale renderer chunk; reloading app shell.', error);
      return;
    }

    console.error('React Error Boundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px',
          color: '#f87171',
          background: '#0f172a',
          minHeight: '100vh',
          fontFamily: 'monospace'
        }}>
          <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>
            {i18n.t('common:status.error')}
          </h1>
          <pre style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            background: '#1e293b',
            padding: '16px',
            borderRadius: '8px',
            fontSize: '14px'
          }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{
              marginTop: '16px',
              padding: '8px 16px',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            {i18n.t('menu:view.reload')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const skipSetupForE2E = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('e2eSkipSetup') === '1';
  const initSettings = useSettingsStore((state) => state.init);
  const theme = useSettingsStore((state) => state.theme);
  const language = useSettingsStore((state) => state.language);
  const setupComplete = useSettingsStore((state) => state.setupComplete);
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const initGateway = useGatewayStore((state) => state.init);
  const initProviders = useProviderStore((state) => state.init);
  const initStorageHealth = useStorageHealthStore((state) => state.init);
  const handleNewChat = useNewChatAction();
  const uiVersion = resolveUiVersion(window.electron?.platform, window.location.search);
  const settingsOpen = location.pathname.startsWith('/settings');
  const [appOverlayHost, setAppOverlayHost] = useState<HTMLDivElement | null>(null);
  const settingsFocusRestoreRef = useRef<HTMLElement | null>(null);
  const settingsLocationState = location.state as { settingsBackgroundPath?: string } | null;
  const backgroundPath = settingsOpen
    ? settingsLocationState?.settingsBackgroundPath ?? '/'
    : toRoutePath(location);

  useEffect(() => {
    document.documentElement.dataset.uiVersion = uiVersion;
  }, [uiVersion]);

  const openSettings = useCallback((path = '/settings') => {
    const destination = path.startsWith('/settings') ? path : `/settings/${path.replace(/^\//, '')}`;
    if (document.activeElement instanceof HTMLElement) {
      settingsFocusRestoreRef.current = document.activeElement;
    }
    navigate(destination, { state: { settingsBackgroundPath: backgroundPath } });
  }, [backgroundPath, navigate]);

  const requestCloseSettings = useCallback((destination?: string) => {
    const target = destination ?? backgroundPath;
    navigate(target, { replace: true });
    window.requestAnimationFrame(() => {
      const storedTarget = settingsFocusRestoreRef.current;
      const fallbackTarget = document.querySelector<HTMLElement>('[data-testid="sidebar-nav-settings"]');
      (storedTarget?.isConnected ? storedTarget : fallbackTarget)?.focus();
      settingsFocusRestoreRef.current = null;
    });
  }, [backgroundPath, navigate]);

  const overlayContextValue = useMemo(() => ({
    settingsOpen,
    backgroundLocation: backgroundPath,
    openSettings,
    requestCloseSettings,
  }), [backgroundPath, openSettings, requestCloseSettings, settingsOpen]);

  useEffect(() => {
    installAgentDevTestSurface({
      route: location.pathname,
      language,
      theme,
      setupComplete,
      devModeUnlocked,
    });
  }, [devModeUnlocked, language, location.pathname, setupComplete, theme]);

  useEffect(() => {
    void initSettings();
  }, [initSettings]);

  // Sync i18n language with persisted settings on mount
  useEffect(() => {
    if (language && language !== i18n.language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  // Initialize Gateway connection on mount
  useEffect(() => {
    initGateway();
  }, [initGateway]);

  // Initialize provider snapshot on mount
  useEffect(() => {
    initProviders();
  }, [initProviders]);

  // Initialize storage health polling on mount
  useEffect(() => {
    void initStorageHealth();
    return () => {
      useStorageHealthStore.getState().stop();
    };
  }, [initStorageHealth]);

  // Redirect to setup wizard if not complete
  useEffect(() => {
    if (!setupComplete && !skipSetupForE2E && !location.pathname.startsWith('/setup')) {
      navigate('/setup');
    }
  }, [setupComplete, skipSetupForE2E, location.pathname, navigate]);

  useEffect(() => {
    const scenarioRoute = getAgentDevScenarioRoute();
    if (scenarioRoute && location.pathname !== scenarioRoute) {
      navigate(scenarioRoute, { replace: true });
    }
  }, [location.pathname, navigate]);

  // Listen for navigation events from main process
  useEffect(() => {
    const unsubscribe = hostEvents.onNavigate((path) => {
      navigate(path);
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [navigate]);

  useEffect(() => {
    const unsubscribe = hostEvents.onNewChat(handleNewChat);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [handleNewChat]);

  // Apply theme
  useEffect(() => {
    applyDocumentTheme(theme);

    if (theme !== 'system') return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => applyDocumentTheme(theme);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [theme]);

  // Load external renderer extensions (generated by scripts/generate-ext-bridge.mjs)
  // and initialize all registered extensions.
  useEffect(() => {
    loadExternalRendererExtensions();
    void rendererExtensionRegistry.initializeAll();
    return () => rendererExtensionRegistry.teardownAll();
  }, []);

  const extraRoutes = rendererExtensionRegistry.getExtraRoutes();

  return (
    <ErrorBoundary>
      <OverlayPortalProvider container={appOverlayHost}>
      <TooltipProvider delayDuration={300}>
        <UiOverlayProvider uiVersion={uiVersion} value={overlayContextValue}>
        <BackgroundRoutes
          location={location}
          devModeUnlocked={devModeUnlocked}
          extraRoutes={extraRoutes}
        />
        </UiOverlayProvider>

        <div ref={setAppOverlayHost} id="app-overlay-root" data-testid="app-overlay-root" />

        {/* Global toast notifications */}
        <Toaster
          position="top-right"
          richColors
          closeButton
          theme={theme}
          style={{ zIndex: 99999 }}
        />
      </TooltipProvider>
      </OverlayPortalProvider>
    </ErrorBoundary>
  );
}

export default App;
