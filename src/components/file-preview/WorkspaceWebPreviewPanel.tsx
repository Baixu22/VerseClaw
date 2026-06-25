import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ExternalLink, Globe, Loader2, MousePointer2, RefreshCw, Send, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { hostApi, type WorkspaceWebPreviewResult } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat';
import { useWorkspacesStore } from '@/stores/workspaces';
import type { WorkspacePreviewMode, WorkspacePreviewSelectedElement, WorkspaceWebPreviewLaunchConfig } from '@shared/types/workspace';

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

  const selectedConfig = useMemo(() => {
    return launchConfigs.find((config) => config.name === selectedConfigName) ?? launchConfigs[0] ?? null;
  }, [launchConfigs, selectedConfigName]);

  const previewId = status?.previewId ?? null;
  const previewUrl = status?.previewUrl ?? status?.url ?? null;

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
  }, [persistWebState, previewId]);

  useEffect(() => {
    if (!iframeRef.current?.contentWindow || !previewId) return;
    iframeRef.current.contentWindow.postMessage({
      type: 'clawx.preview.control',
      version: 1,
      previewId,
      selectionEnabled,
    }, '*');
  }, [selectionEnabled, previewId, status?.previewUrl]);

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
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Slim toolbar — single row with mode tabs + address + actions */}
      <div className="shrink-0 border-b border-black/5 bg-surface-modal px-3 py-2 dark:border-white/10">
        <div className="flex items-center gap-2">
          <div className="inline-flex shrink-0 rounded-md border border-black/10 bg-surface-input p-0.5 dark:border-white/10">
            {(['static', 'devServer', 'externalUrl'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={cn(
                  'rounded px-2 py-1 text-2xs transition-colors',
                  mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setMode(m)}
              >
                {modeLabel(t, m)}
              </button>
            ))}
          </div>

          <div className="min-w-0 flex-1">
            {mode !== 'externalUrl' ? (
              <Input
                aria-label={t('workspace.web.fields.targetPath', 'Target path')}
                value={targetPath}
                onChange={(event) => setTargetPath(event.target.value)}
                placeholder={t('workspace.web.fields.targetPathPlaceholder', 'Relative path, e.g. index.html')}
                className="h-7 bg-surface-input font-mono text-xs"
              />
            ) : (
              <Input
                aria-label={t('workspace.web.fields.url', 'URL')}
                value={externalUrl ?? ''}
                onChange={(event) => setExternalUrl(event.target.value)}
                placeholder="http://localhost:3000"
                className="h-7 bg-surface-input font-mono text-xs"
              />
            )}
          </div>

          {mode === 'devServer' && (
            <Select value={selectedConfigName} onValueChange={setSelectedConfigName} disabled={launchConfigs.length === 0}>
              <SelectTrigger size="sm" className="h-7 min-w-[120px] bg-surface-input text-xs"><SelectValue placeholder={t('workspace.web.fields.detectScriptsFirst', 'Detect scripts first')} /></SelectTrigger>
              <SelectContent>
                {launchConfigs.map((config) => <SelectItem key={config.name} value={config.name}>{config.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          <div className="flex shrink-0 items-center gap-1">
            {mode === 'devServer' && (
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={busy} onClick={() => void detectConfig()} title={t('workspace.web.actions.detect', 'Detect')}>
                <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
              </Button>
            )}
            <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void startPreview()}>
              {busy ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1.5 h-3 w-3" />}
              {t('workspace.web.actions.start', 'Start')}
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy || !status?.running} onClick={() => void stopPreview()}>
              <Square className="h-3 w-3" />
            </Button>
            <Button
              variant={selectionEnabled ? 'default' : 'outline'}
              size="icon"
              className="h-7 w-7"
              disabled={!previewUrl}
              onClick={() => setSelectionEnabled((current) => !current)}
              title={t('workspace.web.actions.pickComponent', 'Pick component')}
            >
              <MousePointer2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {selectedElement && (
        <div className="shrink-0 border-b border-primary/20 bg-primary/[0.04] px-3 py-1.5">
          <div className="flex items-center gap-2">
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-2xs font-medium text-primary">{t('workspace.web.selection.selected', 'Selected')}</span>
            <span className="rounded bg-background/80 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">&lt;{selectedElement.tagName}&gt;</span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{selectedElement.cssSelector}</span>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-2xs" onClick={clearSelection}>
                <X className="h-3 w-3" />
              </Button>
              <Button variant="outline" size="sm" className="h-6 px-1.5 text-2xs" onClick={sendSelection} disabled={!onAppendComposerDraft}>
                <Send className="h-3 w-3" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-1.5 text-2xs"
                disabled={screenshotBusy || !onAppendComposerDraft}
                onClick={() => void captureAndSend()}
              >
                <Camera className={cn('h-3 w-3', screenshotBusy && 'animate-pulse')} />
              </Button>
            </div>
          </div>
        </div>
      )}

      {mode === 'devServer' && logs && (
        <Textarea readOnly value={logs} className="mx-3 mt-2 h-16 shrink-0 resize-none border-black/10 bg-surface-input font-mono text-2xs dark:border-white/10" />
      )}

      {/* Browser viewport — clean, minimal chrome */}
      <div className="min-h-0 flex-1 bg-surface-input p-2">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-black/10 bg-white shadow-sm dark:border-white/10">
          {/* Address bar — single slim row */}
          <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-black/5 bg-surface-modal px-2 dark:border-white/10">
            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" disabled={!previewUrl} onClick={() => setFrameNonce((value) => value + 1)} title={t('workspace.web.actions.refresh', 'Refresh')}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-black/5 bg-surface-input px-2.5 py-1 dark:border-white/10">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', status?.running ? 'bg-emerald-400' : 'bg-muted-foreground/30')} />
              <span className="truncate font-mono text-2xs text-muted-foreground">{previewUrl ?? t('workspace.web.browser.placeholder', 'Start a preview to load a URL')}</span>
            </div>
            {previewUrl && (
              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={() => void hostApi.shell.openExternal(previewUrl)} title={t('workspace.web.actions.openExternal', 'Open externally')}>
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
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
                iframeRef.current.contentWindow.postMessage({ type: 'clawx.preview.control', version: 1, previewId, selectionEnabled }, '*');
              }}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-muted-foreground/50">
              <Globe className="h-7 w-7 opacity-60" />
              <p className="text-xs">{t('workspace.web.empty', '{{mode}} preview will appear here after it starts.', { mode: modeLabel(t, mode) })}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
