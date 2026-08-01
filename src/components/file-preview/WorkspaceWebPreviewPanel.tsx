import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MousePointer2, Send, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  WebPreviewBrowser,
  WebPreviewConsole,
  WebPreviewEmpty,
  WebPreviewRoot,
  WebPreviewSelectionBar,
} from '@/components/ai-elements/web-preview';
import { hostApi, type WorkspaceWebPreviewResult } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { cn } from '@/lib/utils';
import { Camera, RefreshCw, X } from '@/components/icons/codex-icons';
import { useChatStore } from '@/stores/chat';
import { useWorkspacesStore } from '@/stores/workspaces';
import type { AgentBrowserSession } from '@shared/host-api/contract';
import type { WorkspacePreviewMode, WorkspacePreviewSelectedElement, WorkspaceWebPreviewLaunchConfig } from '@shared/types/workspace';
import { isWebPreviewAnnotationAvailable } from './workspace-browser-config';

type WorkspaceWebPreviewPanelProps = {
  onOpenWorkspaceWebView?: () => void;
  onAppendComposerDraft?: (text: string) => void;
};

type PreviewMessage = {
  type?: string;
  version?: number;
  previewId?: string;
  href?: string;
  element?: WorkspacePreviewSelectedElement;
};

function modeLabel(t: (key: string, fallback: string) => string, mode: WorkspacePreviewMode | undefined): string {
  switch (mode) {
    case 'devServer': return t('workspace.web.mode.devServer', 'Dev server');
    case 'externalUrl': return t('workspace.web.mode.externalUrl', 'External URL');
    default: return t('workspace.web.mode.static', 'Static');
  }
}

function formatPrompt(input: {
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string;
  mode: WorkspacePreviewMode;
  previewUrl?: string | null;
  targetUrl?: string | null;
  workspaceRoot?: string | null;
  element: WorkspacePreviewSelectedElement;
  screenshotDataUrl?: string | null;
  clipRect?: { x: number; y: number; width: number; height: number } | null;
}): string {
  const attrs = JSON.stringify(input.element.attributes, null, 2);
  const screenshotLine = input.screenshotDataUrl
    ? `\n[${input.t('workspace.web.prompt.screenshot', 'Preview screenshot')}]\n![preview](${input.screenshotDataUrl})\n${input.clipRect ? `- ${input.t('workspace.web.prompt.clip', 'Clip')}: x=${input.clipRect.x}, y=${input.clipRect.y}, ${input.clipRect.width}x${input.clipRect.height}px` : ''}\n`
    : '';
  const instruction = input.screenshotDataUrl
    ? input.t('workspace.web.prompt.instructionWithScreenshot', 'Use the screenshot and selected component details to locate the source and adjust this UI.')
    : input.t('workspace.web.prompt.instruction', 'Locate the source for this selected component and adjust it. If the source cannot be identified reliably, explain what extra context is needed.');
  return `${input.t('workspace.web.prompt.title', 'Please adjust the component selected in the Web preview.')}\n\n[${input.t('workspace.web.prompt.context', 'Preview context')}]\n- ${input.t('workspace.web.prompt.mode', 'Mode')}: ${input.mode}\n- ${input.t('workspace.web.prompt.previewUrl', 'Preview URL')}: ${input.previewUrl ?? '-'}\n- ${input.t('workspace.web.prompt.targetUrl', 'Target URL')}: ${input.targetUrl ?? '-'}\n- ${input.t('workspace.web.prompt.workspace', 'Workspace')}: ${input.workspaceRoot ?? '-'}\n${screenshotLine}\n[${input.t('workspace.web.prompt.selected', 'Selected component')}]\n- CSS selector: ${input.element.cssSelector}\n- ${input.t('workspace.web.prompt.tag', 'Tag')}: <${input.element.tagName}>\n- ${input.t('workspace.web.prompt.text', 'Text')}: ${input.element.text ?? '-'}\n- role: ${input.element.role ?? '-'}\n- aria-label: ${input.element.ariaLabel ?? '-'}\n- ${input.t('workspace.web.prompt.attributes', 'Attributes')}: ${attrs}\n- ${input.t('workspace.web.prompt.position', 'Position')}: x=${input.element.rect.x}, y=${input.element.rect.y}, width=${input.element.rect.width}, height=${input.element.rect.height}\n- ${input.t('workspace.web.prompt.html', 'HTML snippet')}:\n${input.element.outerHtmlPreview}\n\n${instruction}`;
}

function isSelectionMessage(value: unknown): value is PreviewMessage {
  return Boolean(value && typeof value === 'object' && (value as PreviewMessage).type === 'clawx.preview.selection');
}

function makeAgentBrowserProfile(workspaceId: string | undefined, sessionKey: string): string {
  const source = `${workspaceId || 'workspace'}-${sessionKey || 'session'}`;
  const normalized = source.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `workspace-${normalized || 'default'}`.slice(0, 96);
}

export function WorkspaceWebPreviewPanel({ onOpenWorkspaceWebView, onAppendComposerDraft }: WorkspaceWebPreviewPanelProps) {
  const { t } = useTranslation('chat');
  const activeWorkspace = useWorkspacesStore((s) => s.activeWorkspace);
  const workspaceId = activeWorkspace?.id;
  const workspaceRootPath = activeWorkspace?.rootPath;
  const saveWorkspaceState = useWorkspacesStore((s) => s.saveWorkspaceState);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const currentSessionState = activeWorkspace?.sessionStates
    ? activeWorkspace.sessionStates[currentSessionKey]
    : activeWorkspace?.state;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [mode, setMode] = useState<WorkspacePreviewMode>(currentSessionState?.webPreview?.mode ?? 'static');
  const [targetPath, setTargetPath] = useState(currentSessionState?.webPreview?.targetPath ?? '');
  const [externalUrl, setExternalUrl] = useState(currentSessionState?.webPreview?.targetUrl ?? '');
  const [launchConfigs, setLaunchConfigs] = useState<WorkspaceWebPreviewLaunchConfig[]>([]);
  const [selectedConfigName, setSelectedConfigName] = useState('');
  const [status, setStatus] = useState<WorkspaceWebPreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState('');
  const [selectionEnabled, setSelectionEnabled] = useState(false);
  const [selectedElement, setSelectedElement] = useState<WorkspacePreviewSelectedElement | null>(currentSessionState?.webPreview?.selectedElement ?? null);
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const [frameNonce, setFrameNonce] = useState(0);
  const [agentBrowserBusy, setAgentBrowserBusy] = useState(false);
  const [agentBrowserSession, setAgentBrowserSession] = useState<AgentBrowserSession | null>(() => {
    const saved = currentSessionState?.webPreview;
    if (!saved?.agentBrowserSessionId) return null;
    const now = new Date(saved.agentBrowserUpdatedAt ?? Date.now()).toISOString();
    return {
      id: saved.agentBrowserSessionId,
      profile: saved.agentBrowserProfile ?? makeAgentBrowserProfile(workspaceId, currentSessionKey),
      mode: saved.agentBrowserMode ?? 'visible',
      url: saved.agentBrowserUrl ?? undefined,
      title: saved.agentBrowserTitle ?? undefined,
      createdAt: now,
      updatedAt: now,
    };
  });

  const selectedConfig = useMemo(() => {
    return launchConfigs.find((config) => config.name === selectedConfigName) ?? launchConfigs[0] ?? null;
  }, [launchConfigs, selectedConfigName]);

  const previewId = status?.previewId ?? null;
  const previewUrl = status?.previewUrl ?? status?.url ?? null;
  const annotationEnabled = isWebPreviewAnnotationAvailable(mode, status?.mode, status?.running);
  const agentBrowserTargetUrl = useMemo(() => {
    const typedExternalUrl = mode === 'externalUrl' ? externalUrl.trim() : '';
    return typedExternalUrl || status?.targetUrl || previewUrl || '';
  }, [externalUrl, mode, previewUrl, status?.targetUrl]);

  const persistWebState = useCallback((patch: Record<string, unknown>) => {
    if (!workspaceId) return;
    void saveWorkspaceState({
      id: workspaceId,
      sessionKey: currentSessionKey,
      state: {
        webPreview: {
          open: true,
          mode,
          targetPath: targetPath.trim() || null,
          ...patch,
        },
      },
    });
  }, [currentSessionKey, mode, saveWorkspaceState, targetPath, workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    void hostApi.webPreview.status({ workspaceId }).then((result) => {
      setStatus(result);
    }).catch(() => setStatus(null));
  }, [workspaceId]);

  useEffect(() => {
    const savedSessionId = currentSessionState?.webPreview?.agentBrowserSessionId;
    if (!savedSessionId) return;
    let cancelled = false;
    void hostApi.agentBrowser.status().then((result) => {
      if (cancelled) return;
      const session = result.sessions?.find((entry) => entry.id === savedSessionId) ?? null;
      if (session) {
        setAgentBrowserSession(session);
      } else {
        setAgentBrowserSession(null);
        persistWebState({
          agentBrowserSessionId: null,
          agentBrowserMode: null,
          agentBrowserProfile: null,
          agentBrowserUrl: null,
          agentBrowserTitle: null,
          agentBrowserUpdatedAt: null,
        });
      }
    }).catch(() => {
      // Keep the saved binding visible even if the runtime cannot report status.
    });
    return () => {
      cancelled = true;
    };
  }, [currentSessionState?.webPreview?.agentBrowserSessionId, persistWebState]);

  useEffect(() => {
    if (!workspaceId) return;
    const unsubStatus = hostEvents.onWebPreviewStatusChanged((event) => {
      if (event.workspaceId !== workspaceId) return;
      setStatus((current) => ({
        success: true,
        running: event.status === 'running' || event.status === 'starting',
        mode: event.mode,
        status: event.status,
        previewId: event.previewId,
        previewUrl: event.previewUrl,
        url: event.previewUrl,
        targetUrl: event.targetUrl,
        port: event.port,
        processSessionId: event.processSessionId,
        launchConfig: event.launchConfig,
        rootPath: current?.rootPath ?? workspaceRootPath,
        targetPath: current?.targetPath ?? targetPath,
      }));
    });
    const unsubOutput = hostEvents.onWebPreviewDevServerOutput((event) => {
      if (event.workspaceId !== workspaceId) return;
      setLogs((current) => `${current}${event.data}`.slice(-80_000));
    });
    return () => {
      unsubStatus();
      unsubOutput();
    };
  }, [targetPath, workspaceId, workspaceRootPath]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!annotationEnabled) return;
      if (!iframeRef.current?.contentWindow || event.source !== iframeRef.current.contentWindow) return;
      if (!isSelectionMessage(event.data)) return;
      if (previewId && event.data.previewId !== previewId) return;
      if (!event.data.element) return;
      setSelectedElement(event.data.element);
      setSelectionEnabled(false);
      persistWebState({ selectedElement: event.data.element });
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [annotationEnabled, persistWebState, previewId]);

  useEffect(() => {
    if (!iframeRef.current?.contentWindow || !previewId) return;
    iframeRef.current.contentWindow.postMessage({
      type: 'clawx.preview.control',
      version: 1,
      previewId,
      selectionEnabled: annotationEnabled && selectionEnabled,
    }, '*');
  }, [annotationEnabled, selectionEnabled, previewId, status?.previewUrl]);

  useEffect(() => {
    if (annotationEnabled) return;
    setSelectionEnabled(false);
    setSelectedElement(null);
  }, [annotationEnabled]);

  const detectConfig = async () => {
    setBusy(true);
    try {
      const result = await hostApi.webPreview.detect(targetPath.trim() ? { targetPath: targetPath.trim() } : undefined);
      setLaunchConfigs(result.configs ?? []);
      setSelectedConfigName(result.preferred?.name ?? result.configs?.[0]?.name ?? '');
      if (!result.configs?.length) toast.info(t('workspace.web.toast.noScripts', 'No package scripts were detected'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const startPreview = async () => {
    setBusy(true);
    try {
      const payload = mode === 'static'
        ? { mode, targetPath: targetPath.trim() || undefined }
        : mode === 'externalUrl'
          ? { mode, url: externalUrl.trim() }
          : { mode, targetPath: targetPath.trim() || undefined, launchConfig: selectedConfig };
      const result = await hostApi.webPreview.start(payload);
      setStatus(result);
      if (!result.success || result.blocked) {
        toast.error(result.error || t('workspace.web.toast.startFailed', 'Failed to start preview'));
        return;
      }
      onOpenWorkspaceWebView?.();
      persistWebState({
        mode: result.mode ?? mode,
        targetPath: targetPath.trim() || null,
        url: result.previewUrl ?? result.url ?? null,
        previewId: result.previewId ?? null,
        previewUrl: result.previewUrl ?? result.url ?? null,
        targetUrl: result.targetUrl ?? (mode === 'externalUrl' ? externalUrl.trim() : null),
        rootPath: result.rootPath ?? workspaceRootPath ?? null,
        port: result.port ?? null,
        processSessionId: result.processSessionId ?? null,
        launchConfig: result.launchConfig ?? selectedConfig ?? null,
        status: result.status ?? 'running',
        lastStartedAt: Date.now(),
      });
      toast.success(t('workspace.web.toast.started', 'Web preview started'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const stopPreview = async () => {
    setBusy(true);
    try {
      await hostApi.webPreview.stop();
      setStatus({ success: true, running: false, status: 'stopped', url: null, previewUrl: null });
      persistWebState({ status: 'stopped', url: null, previewUrl: null, processSessionId: null });
    } finally {
      setBusy(false);
    }
  };

  const persistAgentBrowserSession = (session: AgentBrowserSession) => {
    setAgentBrowserSession(session);
    persistWebState({
      agentBrowserSessionId: session.id,
      agentBrowserMode: session.mode,
      agentBrowserProfile: session.profile,
      agentBrowserUrl: session.url ?? null,
      agentBrowserTitle: session.title ?? null,
      agentBrowserUpdatedAt: Date.now(),
    });
  };

  const openOrLocateAgentBrowser = async () => {
    const url = agentBrowserTargetUrl.trim();
    if (!url) {
      toast.info(t('workspace.web.toast.agentBrowserNoUrl', 'Start a preview or enter a URL first'));
      return;
    }
    setAgentBrowserBusy(true);
    try {
      if (agentBrowserSession?.id) {
        try {
          const result = await hostApi.agentBrowser.navigate({
            sessionId: agentBrowserSession.id,
            url,
            waitUntil: 'dom-ready',
          });
          let nextSession = result.session;
          persistAgentBrowserSession(nextSession);
          try {
            const focusResult = await hostApi.agentBrowser.focus({ sessionId: nextSession.id });
            nextSession = focusResult.session;
            persistAgentBrowserSession(nextSession);
          } catch {
            // Navigation succeeded; focus is best-effort for external headed browsers.
          }
          toast.success(t('workspace.web.toast.agentBrowserLocated', 'Agent Browser located'));
          return;
        } catch {
          setAgentBrowserSession(null);
        }
      }

      const result = await hostApi.agentBrowser.open({
        url,
        mode: 'visible',
        profile: currentSessionState?.webPreview?.agentBrowserProfile ?? makeAgentBrowserProfile(workspaceId, currentSessionKey),
        width: 1280,
        height: 900,
        authPersistence: 'profile',
      });
      let nextSession = result.session;
      persistAgentBrowserSession(nextSession);
      try {
        const focusResult = await hostApi.agentBrowser.focus({ sessionId: nextSession.id });
        nextSession = focusResult.session;
        persistAgentBrowserSession(nextSession);
      } catch {
        // The visible open path already surfaced the browser; focusing is best-effort.
      }
      toast.success(t('workspace.web.toast.agentBrowserOpened', 'Agent Browser opened'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setAgentBrowserBusy(false);
    }
  };

  const sendSelection = () => {
    if (!selectedElement) return;
    onAppendComposerDraft?.(formatPrompt({
      t,
      mode,
      previewUrl: status?.previewUrl ?? status?.url,
      targetUrl: status?.targetUrl,
      workspaceRoot: workspaceRootPath,
      element: selectedElement,
    }));
    toast.success(t('workspace.web.toast.sent', 'Sent to the composer'));
  };

  const clearSelection = () => {
    setSelectedElement(null);
    persistWebState({ selectedElement: null });
  };

  // Capture the iframe region via CDP screenshot (with clip) and send element + screenshot.
  const captureAndSend = async () => {
    if (!selectedElement || !iframeRef.current) return;
    setScreenshotBusy(true);
    let screenshotDataUrl: string | null = null;
    let clipRect: { x: number; y: number; width: number; height: number } | null = null;
    try {
      const rect = iframeRef.current.getBoundingClientRect();
      clipRect = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
      const result = await hostApi.remoteControl.screenshot({
        format: 'jpeg',
        quality: 70,
        clip: clipRect,
      });
      if (result.success && result.dataUrl) {
        screenshotDataUrl = result.dataUrl;
      } else {
        toast.warning(t('workspace.web.toast.screenshotUnavailable', 'Screenshot is unavailable; sent component details only'));
      }
    } catch {
      toast.warning(t('workspace.web.toast.screenshotFailed', 'Screenshot failed; sent component details only'));
    } finally {
      setScreenshotBusy(false);
    }
    onAppendComposerDraft?.(formatPrompt({
      t,
      mode,
      previewUrl: status?.previewUrl ?? status?.url,
      targetUrl: status?.targetUrl,
      workspaceRoot: workspaceRootPath,
      element: selectedElement,
      screenshotDataUrl,
      clipRect,
    }));
    toast.success(screenshotDataUrl ? t('workspace.web.toast.screenshotSent', 'Screenshot and component details sent') : t('workspace.web.toast.sent', 'Sent to the composer'));
  };

  return (
    <WebPreviewRoot>
      {/* Slim toolbar — single row with mode tabs + address + actions */}
      {annotationEnabled && selectedElement && (
        <WebPreviewSelectionBar>
          <div className="flex items-center gap-2">
            <span className="rounded bg-black/5 px-1.5 py-0.5 text-2xs font-medium text-foreground dark:bg-white/10">{t('workspace.web.selection.selected', 'Selected')}</span>
            <span className="rounded bg-background/80 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">&lt;{selectedElement.tagName}&gt;</span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{selectedElement.cssSelector}</span>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-2xs"
                onClick={clearSelection}
                aria-label={t('workspace.web.actions.clearSelection', 'Clear selection')}
                title={t('workspace.web.actions.clearSelection', 'Clear selection')}
              >
                <X className="h-3 w-3" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-1.5 text-2xs"
                onClick={sendSelection}
                disabled={!onAppendComposerDraft}
                aria-label={t('workspace.web.actions.sendToComposer', 'Send to composer')}
                title={t('workspace.web.actions.sendToComposer', 'Send to composer')}
              >
                <Send className="h-3 w-3" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-1.5 text-2xs"
                disabled={screenshotBusy || !onAppendComposerDraft}
                onClick={() => void captureAndSend()}
                aria-label={t('workspace.web.actions.captureAndSend', 'Capture and send')}
                title={t('workspace.web.actions.captureAndSend', 'Capture and send')}
              >
                <Camera className={cn('h-3 w-3', screenshotBusy && 'animate-pulse')} />
              </Button>
            </div>
          </div>
        </WebPreviewSelectionBar>
      )}

      {mode === 'devServer' && logs && (
        <WebPreviewConsole value={logs} />
      )}

      {/* Browser viewport — clean, minimal chrome */}
      <WebPreviewBrowser
        previewUrl={previewUrl}
        running={status?.running}
        onBack={() => iframeRef.current?.contentWindow?.history.back()}
        onForward={() => iframeRef.current?.contentWindow?.history.forward()}
        onReload={() => setFrameNonce((value) => value + 1)}
        onOpenExternal={previewUrl ? () => void hostApi.shell.openExternal(previewUrl) : undefined}
        agentBrowser={{
          active: Boolean(agentBrowserSession),
          busy: agentBrowserBusy,
          canOpen: Boolean(agentBrowserTargetUrl),
          label: agentBrowserSession?.title || agentBrowserSession?.profile || null,
          url: agentBrowserSession?.url ?? null,
        }}
        onOpenAgentBrowser={() => void openOrLocateAgentBrowser()}
        toolbarActions={(
          <>
            {!status?.running ? (
              <Button
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={busy}
                onClick={() => void startPreview()}
                data-testid="ai-web-preview-start"
              >
                {busy ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                {t('workspace.web.actions.start', 'Start')}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={busy}
                onClick={() => void stopPreview()}
                aria-label={t('workspace.web.actions.stop', 'Stop')}
                title={t('workspace.web.actions.stop', 'Stop')}
                data-testid="ai-web-preview-stop"
              >
                <Square className="h-3 w-3" />
              </Button>
            )}
            {annotationEnabled ? (
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7', selectionEnabled && 'bg-black/5 dark:bg-white/10')}
                disabled={!previewUrl}
                onClick={() => setSelectionEnabled((current) => !current)}
                title={t('workspace.web.actions.pickComponent', 'Pick component')}
                aria-label={t('workspace.web.actions.pickComponent', 'Pick component')}
                data-testid="ai-web-preview-pick-component"
              >
                <MousePointer2 className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </>
        )}
        menuConfiguration={(
          <div
            className="space-y-2 px-2 py-1.5"
            data-testid="ai-web-preview-configuration"
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <div className="text-[11px] font-medium text-muted-foreground">
              {t('workspace.web.configuration.title', 'Preview configuration')}
            </div>
            <div className="grid grid-cols-3 gap-1" role="group" aria-label={t('workspace.web.prompt.mode', 'Mode')}>
              {(['static', 'devServer', 'externalUrl'] as const).map((previewMode) => (
                <button
                  key={previewMode}
                  type="button"
                  className={cn(
                    'h-7 min-w-0 truncate rounded px-1 text-[11px] text-muted-foreground transition-colors duration-150 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10 motion-reduce:transition-none',
                    mode === previewMode && 'bg-black/5 text-foreground dark:bg-white/10',
                  )}
                  aria-pressed={mode === previewMode}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setMode(previewMode);
                  }}
                  data-testid={`ai-web-preview-mode-${previewMode}`}
                >
                  {modeLabel(t, previewMode)}
                </button>
              ))}
            </div>
            {mode !== 'externalUrl' ? (
              <Input
                aria-label={t('workspace.web.fields.targetPath', 'Target path')}
                value={targetPath}
                onChange={(event) => setTargetPath(event.target.value)}
                placeholder={t('workspace.web.fields.targetPathPlaceholder', 'Relative path, e.g. index.html')}
                className="h-8 bg-surface-input font-mono text-xs"
                data-testid="ai-web-preview-target-path"
              />
            ) : (
              <Input
                aria-label={t('workspace.web.fields.url', 'URL')}
                value={externalUrl ?? ''}
                onChange={(event) => setExternalUrl(event.target.value)}
                placeholder="http://localhost:3000"
                className="h-8 bg-surface-input font-mono text-xs"
                data-testid="ai-web-preview-external-url"
              />
            )}
            {mode === 'devServer' ? (
              <div className="flex items-center gap-1">
                <Select value={selectedConfigName} onValueChange={setSelectedConfigName} disabled={launchConfigs.length === 0}>
                  <SelectTrigger size="sm" className="h-8 min-w-0 flex-1 bg-surface-input text-xs" data-testid="ai-web-preview-launch-config">
                    <SelectValue placeholder={t('workspace.web.fields.detectScriptsFirst', 'Detect scripts first')} />
                  </SelectTrigger>
                  <SelectContent>
                    {launchConfigs.map((config) => <SelectItem key={config.name} value={config.name}>{config.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  disabled={busy}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void detectConfig();
                  }}
                  data-testid="ai-web-preview-detect"
                >
                  <RefreshCw className={cn('mr-1 h-3.5 w-3.5', busy && 'animate-spin')} />
                  {t('workspace.web.actions.detect', 'Detect')}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      >
          {/* Address bar — single slim row */}
          {previewUrl ? (
            <iframe
              ref={iframeRef}
              key={`${previewUrl}:${frameNonce}`}
              title={t('workspace.web.browser.title', 'Workspace preview')}
              src={previewUrl}
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
              className="min-h-0 flex-1 bg-white"
              onLoad={() => {
                if (!iframeRef.current?.contentWindow || !previewId) return;
                iframeRef.current.contentWindow.postMessage({
                  type: 'clawx.preview.control',
                  version: 1,
                  previewId,
                  selectionEnabled: annotationEnabled && selectionEnabled,
                }, '*');
              }}
            />
          ) : (
            <WebPreviewEmpty label={t('workspace.web.browser.placeholder', 'Start a preview to load a URL')} />
          )}
      </WebPreviewBrowser>
    </WebPreviewRoot>
  );
}
