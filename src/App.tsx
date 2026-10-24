/**
 * Root Application Component
 * Handles routing and global providers
 */
import { Navigate, Routes, Route, useNavigate, useLocation, type Location } from 'react-router-dom';
import { Component, lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Toaster } from 'sonner';
import i18n, { changeLanguageWithResources } from './i18n';
import { MainLayout } from './components/layout/MainLayout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RuntimeApprovalPrompt } from '@/components/runtime-approvals/RuntimeApprovalPrompt';
import { BootShellHandoff, SetupRouteLoadingShell } from './components/loading/RouteLoadingShell';
import { useSettingsStore } from './stores/settings';
import { useGatewayStore } from './stores/gateway';
import { useProviderStore } from './stores/providers';
import { useSessionActivityStore } from './stores/session-activity';
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
import { sanitizeUiErrorText } from '@shared/privacy/ui-error-sanitize';
import { UiOverlayProvider } from './components/layout/ui-overlay-context';
import { toRoutePath } from './lib/settings-overlay-routing';
import { OverlayPortalProvider } from './components/ui/overlay-portal';

const Chat = lazy(() => import('./pages/Chat').then((m) => ({ default: m.Chat })));
const KnowledgeChat = lazy(() => import('./pages/Chat/KnowledgeChat').then((m) => ({ default: m.KnowledgeChat })));
const Cron = lazy(() => import('./pages/Cron').then((m) => ({ default: m.Cron })));
const Inbox = lazy(() => import('./pages/Inbox').then((m) => ({ default: m.Inbox })));
const Dreams = lazy(() => import('./pages/Dreams').then((m) => ({ default: m.Dreams })));
const ImageGenerationPage = lazy(() => import('./pages/ImageGeneration').then((m) => ({ default: m.ImageGenerationPage })));
const ObservabilityDashboard = lazy(() => import('./pages/Observability').then((m) => ({ default: m.ObservabilityDashboard })));
const TaskLedgerPage = lazy(() => import('./pages/TaskLedger'));
const ClawGraphPage = lazy(() => import('./pages/ClawGraph'));
const Knowledge = lazy(() => import('./pages/Knowledge').then((m) => ({ default: m.Knowledge })));
const MemoryPage = lazy(() => import('./pages/Memory').then((m) => ({ default: m.MemoryPage })));
const Setup = lazy(() => import('./pages/Setup').then((m) => ({ default: m.Setup })));
const UiV2Showcase = lazy(() => import('./pages/UiV2Showcase').then((m) => ({ default: m.UiV2Showcase })));

function ChatRoute() {
  const location = useLocation();
  return new URLSearchParams(location.search).get('knowledge') === 'ask' ? <KnowledgeChat /> : <Chat />;
}

function WorkspaceCompatibilityRoute({
  intent,
}: {
  intent: WorkspacePanelIntent;
}) {
  const location = useLocation();

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
        <Route path="/" element={<ChatRoute />} />
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
            />
          )}
        />
        <Route path="/knowledge" element={<Knowledge />} />
        <Route path="/memory" element={<MemoryPage />} />
        <Route
          path="/browser"
          element={(
            <WorkspaceCompatibilityRoute
              intent={{ panel: 'browser', view: 'live' }}
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
 * Error Boundary to catch and display React rendering errors.
 * The raw message / stack are logged to the developer console only; the UI
 * renders a sanitized message so internal paths, module names, stack frames,
 * and secret-shaped text never reach the user.
 */
function generateErrorReference(): string {
  return `err-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null; errorId: string | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, errorId: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error, errorId: generateErrorReference() };
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
      const safeMessage = sanitizeUiErrorText(this.state.error);
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
          <p style={{
            color: '#94a3b8',
            fontSize: '14px',
            marginBottom: '16px',
            maxWidth: '640px'
          }}>
            {i18n.t('common:errorBoundary.description')}
          </p>
          {safeMessage && (
            <pre style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              background: '#1e293b',
              padding: '16px',
              borderRadius: '8px',
              fontSize: '14px'
            }}>
              {safeMessage}
            </pre>
          )}
          {this.state.errorId && (
            <div style={{ color: '#64748b', fontSize: '12px', marginTop: '16px' }}>
              {i18n.t('common:errorBoundary.errorReference')} <code>{this.state.errorId}</code>
            </div>
          )}
          <button
            onClick={() => { this.setState({ hasError: false, error: null, errorId: null }); window.location.reload(); }}
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
  const initSessionActivity = useSessionActivityStore((state) => state.init);
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
      void changeLanguageWithResources(language);
    }
  }, [language]);

  // Initialize Gateway connection on mount
  useEffect(() => {
    initGateway();
  }, [initGateway]);

  useEffect(() => {
    initSessionActivity();
  }, [initSessionActivity]);

  // Initialize provider snapshot on mount
  useEffect(() => {
    initProviders();
  }, [initProviders]);

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
        <UiOverlayProvider value={overlayContextValue}>
        <BackgroundRoutes
          location={location}
          devModeUnlocked={devModeUnlocked}
          extraRoutes={extraRoutes}
        />
        </UiOverlayProvider>

        <div ref={setAppOverlayHost} id="app-overlay-root" data-testid="app-overlay-root" />

        {/* Runtime exec-approval boundary: app-level, so it never touches ChatInput. */}
        <RuntimeApprovalPrompt />

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
