import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, ListChecks, MousePointerClick, ShieldCheck, Square, Type } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Ellipsis,
  Eye,
  Globe,
  Monitor,
  RefreshCw,
  X,
} from '@/components/icons/codex-icons';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { useChatStore } from '@/stores/chat';
import { useWorkspacesStore } from '@/stores/workspaces';
import type { AgentBrowserProfileEntry, AgentBrowserSession } from '@shared/host-api/contract';
import type { WorkspaceArtifactPanelState } from '@shared/types/workspace';

type InspectKind = 'network' | 'console' | 'sources' | 'source-maps' | 'runtime';

const INSPECT_KINDS: readonly InspectKind[] = ['network', 'console', 'sources', 'source-maps', 'runtime'];

export function WorkspaceLiveBrowserPanel({
  onSessionStateChange,
}: {
  onSessionStateChange?: (patch: WorkspaceArtifactPanelState) => void;
}) {
  const { t } = useTranslation('browser');
  const storedSessionId = useArtifactPanel((state) => state.browserSessionId);
  const storedUrl = useArtifactPanel((state) => state.browserUrl);
  const setBrowserSessionId = useArtifactPanel((state) => state.setBrowserSessionId);
  const [sessions, setSessions] = useState<AgentBrowserSession[]>([]);
  const [profiles, setProfiles] = useState<AgentBrowserProfileEntry[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(storedSessionId);
  const [url, setUrl] = useState(storedUrl ?? '');
  // A link card may target this panel while it is already mounted. Filling the
  // address loads nothing; the page opens only through this panel's own action.
  useEffect(() => {
    if (storedUrl) setUrl(storedUrl);
  }, [storedUrl]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [uid, setUid] = useState('');
  const [uidValue, setUidValue] = useState('');
  const [keyValue, setKeyValue] = useState('Enter');
  const [inspectOutput, setInspectOutput] = useState<string | null>(null);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [inspectKind, setInspectKind] = useState<InspectKind>('network');
  const [runtimePaths, setRuntimePaths] = useState('window.location, document.title');
  const [newSessionMode, setNewSessionMode] = useState<'headless' | 'visible'>('visible');
  const [newSessionProfile, setNewSessionProfile] = useState('default');
  const [automationOpen, setAutomationOpen] = useState(false);
  const [automationName, setAutomationName] = useState('Check current page');
  const [automationObjective, setAutomationObjective] = useState('Read the current page and verify it is available');
  const [automationSuccess, setAutomationSuccess] = useState('');
  const [automationMode, setAutomationMode] = useState<'headless' | 'visible'>('headless');
  const [automationBusy, setAutomationBusy] = useState(false);
  const activeWorkspace = useWorkspacesStore((state) => state.activeWorkspace);
  const currentSessionKey = useChatStore((state) => state.currentSessionKey);
  const workspaceId = activeWorkspace?.id;
  const sessionKey = currentSessionKey || activeWorkspace?.activeSessionKey;
  const agentId = activeWorkspace?.selectedAgentId ?? activeWorkspace?.agentId;

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === sessionId) ?? null,
    [sessionId, sessions],
  );
  const snapshotUids = useMemo(() => {
    if (!snapshot) return [];
    return Array.from(new Set(Array.from(snapshot.matchAll(/uid=(\d+_\d+)/g), (match) => match[1])));
  }, [snapshot]);

  const persistSession = useCallback((next: AgentBrowserSession | null) => {
    const nextId = next?.id ?? null;
    setSessionId(nextId);
    setBrowserSessionId(nextId);
    if (next?.url) setUrl(next.url);
    onSessionStateChange?.({ browserSessionId: nextId });
  }, [onSessionStateChange, setBrowserSessionId]);

  const refresh = useCallback(async (preferredId?: string | null) => {
    setError(null);
    try {
      const [result, profileResult] = await Promise.all([
        hostApi.agentBrowser.status(),
        hostApi.agentBrowser.profiles(),
      ]);
      const nextSessions = result.sessions ?? [];
      setProfiles(profileResult.profiles ?? []);
      if (profileResult.profiles?.length && !profileResult.profiles.some((entry) => entry.profile === newSessionProfile)) {
        setNewSessionProfile(profileResult.profiles[0].profile);
      }
      setSessions(nextSessions);
      const targetId = preferredId ?? sessionId ?? storedSessionId;
      const next = nextSessions.find((session) => session.id === targetId) ?? nextSessions[0] ?? null;
      persistSession(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [newSessionProfile, persistSession, sessionId, storedSessionId]);

  useEffect(() => {
    void refresh(storedSessionId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- load once; actions refresh explicitly

  const run = async (name: string, action: () => Promise<{ success: boolean; error?: string; session?: AgentBrowserSession }>) => {
    setBusyAction(name);
    setError(null);
    try {
      const result = await action();
      if (!result.success) throw new Error(result.error || t('workspace.errors.actionFailed'));
      if (result.session) persistSession(result.session);
      await refresh(result.session?.id ?? sessionId);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      toast.error(message);
    } finally {
      setBusyAction(null);
    }
  };

  const openOrNavigate = async () => {
    const target = url.trim();
    if (!target) return;
    if (selectedSession) {
      await run('navigate', () => hostApi.agentBrowser.navigate({ sessionId: selectedSession.id, url: target }));
      return;
    }
    await run('open', () => hostApi.agentBrowser.open({
      url: target,
      mode: newSessionMode,
      profile: newSessionProfile,
      authPersistence: 'profile',
      workspaceId,
      sessionKey,
      agentId,
    }));
  };

  const createAutomation = async () => {
    const target = (selectedSession?.url || url).trim();
    const success = automationSuccess.trim();
    if (!target || !automationName.trim() || !automationObjective.trim() || !success) return;
    setAutomationBusy(true);
    setError(null);
    try {
      const hostname = new URL(target).hostname;
      await hostApi.agentBrowser.createTask({
        name: automationName.trim(),
        url: target,
        objective: automationObjective.trim(),
        profile: selectedSession?.profile || newSessionProfile,
        mode: automationMode,
        allowedDomains: [hostname],
        steps: [{ action: 'wait-for-selector', selector: 'body' }],
        successCriteria: { kind: 'text-includes', value: success },
        workspaceId,
        sessionKey,
        agentId,
      });
      setAutomationOpen(false);
      setAutomationSuccess('');
      toast.success(t('workspace.automation.created'));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      toast.error(message);
    } finally {
      setAutomationBusy(false);
    }
  };

  const capture = async () => {
    if (!selectedSession) return;
    setBusyAction('screenshot');
    setError(null);
    try {
      const result = await hostApi.agentBrowser.screenshot({ sessionId: selectedSession.id, fullPage: false });
      if (!result.success) throw new Error(result.error || t('workspace.errors.actionFailed'));
      setScreenshot(result.dataUrl);
      persistSession(result.session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyAction(null);
    }
  };

  const takeSnapshot = async () => {
    if (!selectedSession) return;
    setBusyAction('snapshot');
    setError(null);
    try {
      const result = await hostApi.agentBrowser.takeSnapshot({ sessionId: selectedSession.id });
      if (!result.success) throw new Error(result.error || t('workspace.errors.actionFailed'));
      setSnapshot(result.snapshot);
      persistSession(result.session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyAction(null);
    }
  };

  const inspect = async (kind: InspectKind) => {
    if (!selectedSession) return;
    setInspectOpen(true);
    setInspectKind(kind);
    setBusyAction(`inspect-${kind}`);
    setError(null);
    try {
      if (kind === 'network') {
        const result = await hostApi.agentBrowser.networkListRequests({ sessionId: selectedSession.id });
        if (!result.success) throw new Error(result.error || t('workspace.errors.actionFailed'));
        setInspectOutput(JSON.stringify(result.requests, null, 2));
      } else if (kind === 'console') {
        const result = await hostApi.agentBrowser.getConsoleMessages({ sessionId: selectedSession.id });
        if (!result.success) throw new Error(result.error || t('workspace.errors.actionFailed'));
        setInspectOutput(JSON.stringify(result, null, 2));
      } else if (kind === 'sources') {
        const result = await hostApi.agentBrowser.jsListResources({ sessionId: selectedSession.id });
        if (!result.success) throw new Error(result.error || t('workspace.errors.actionFailed'));
        setInspectOutput(result.content || JSON.stringify(result.resources, null, 2));
      } else if (kind === 'source-maps') {
        const result = await hostApi.agentBrowser.sourceMapListCandidates({ sessionId: selectedSession.id });
        if (!result.success) throw new Error(result.error || t('workspace.errors.actionFailed'));
        setInspectOutput(result.content || JSON.stringify(result.candidates, null, 2));
      } else {
        const paths = runtimePaths.split(',').map((entry) => entry.trim()).filter(Boolean);
        const result = await hostApi.agentBrowser.runtimeInspectGlobals({
          sessionId: selectedSession.id,
          paths: paths.length > 0 ? paths : ['window.location', 'document.title'],
          maxDepth: 2,
          limit: 50,
        });
        if (!result.success) throw new Error(result.error || t('workspace.errors.actionFailed'));
        setInspectOutput(result.content);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyAction(null);
    }
  };

  const toggleVisible = async () => {
    if (!selectedSession) return;
    const isVisible = selectedSession.mode === 'visible';
    await run(isVisible ? 'hide' : 'show', () => (
      isVisible
        ? hostApi.agentBrowser.hide({ sessionId: selectedSession.id })
        : hostApi.agentBrowser.show({ sessionId: selectedSession.id })
    ));
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background" data-testid="workspace-browser-live">
      <div className="rs-browser-header">
        <select
          className="h-7 max-w-32 rounded-md border-0 bg-transparent px-1 text-xs text-muted-foreground outline-none hover:bg-black/5 dark:hover:bg-white/10"
          aria-label={t('workspace.session')}
          value={sessionId ?? ''}
          onChange={(event) => persistSession(sessions.find((item) => item.id === event.target.value) ?? null)}
        >
          <option value="">{t('workspace.newSession')}</option>
          {sessions.map((session) => <option key={session.id} value={session.id}>{session.title || session.profile || session.id}</option>)}
        </select>
        <div className="flex shrink-0 items-center gap-0.5">
          <button className="rs-icon-btn" type="button" disabled={!selectedSession} onClick={() => selectedSession && void run('back', () => hostApi.agentBrowser.pressKey({ sessionId: selectedSession.id, key: 'Alt+ArrowLeft' }))} aria-label={t('workspace.back')} title={t('workspace.back')}><ArrowLeft className="h-3.5 w-3.5" /></button>
          <button className="rs-icon-btn" type="button" disabled={!selectedSession} onClick={() => selectedSession && void run('forward', () => hostApi.agentBrowser.pressKey({ sessionId: selectedSession.id, key: 'Alt+ArrowRight' }))} aria-label={t('workspace.forward')} title={t('workspace.forward')}><ArrowRight className="h-3.5 w-3.5" /></button>
        </div>
        <form className="rs-browser-url-form" onSubmit={(event) => { event.preventDefault(); void openOrNavigate(); }}>
          <label className={cn('rs-browser-address-bar', !url && 'is-empty')}>
            <span className="rs-browser-site-info"><Globe className="h-3.5 w-3.5" /></span>
            <span className="rs-browser-address-input-wrap">
              <input
                className="rs-browser-address-input"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={t('workspace.urlPlaceholder')}
                aria-label={t('workspace.url')}
              />
            </span>
          </label>
        </form>
        <div className="rs-browser-actions">
          <button className="rs-icon-btn" type="button" onClick={() => selectedSession ? void run('refresh', () => hostApi.agentBrowser.navigate({ sessionId: selectedSession.id, url: selectedSession.url || url })) : void refresh()} aria-label={t('actions.refresh')} title={t('actions.refresh')}>
            <RefreshCw className={cn('h-3.5 w-3.5', busyAction === 'refresh' && 'animate-spin')} />
          </button>
          {selectedSession && <button className="rs-icon-btn" type="button" onClick={() => void toggleVisible()} aria-label={selectedSession.mode === 'visible' ? t('actions.hide') : t('actions.takeOver')} title={selectedSession.mode === 'visible' ? t('actions.hide') : t('actions.takeOver')}><Monitor className="h-3.5 w-3.5" /></button>}
          {selectedSession && <details className="relative">
            <summary className="rs-icon-btn list-none" aria-label={t('workspace.more')} title={t('workspace.more')}><Ellipsis className="h-3.5 w-3.5" /></summary>
            <div className="absolute right-0 top-8 z-30 min-w-44 rounded-md border border-border bg-surface-modal p-1 shadow-lg">
              <button type="button" className="rs-browser-options-item" onClick={() => void run('focus', () => hostApi.agentBrowser.focus({ sessionId: selectedSession.id }))}><Eye className="h-3.5 w-3.5" />{t('workspace.focus')}</button>
              <button type="button" className="rs-browser-options-item" onClick={() => void capture()}><Camera className="h-3.5 w-3.5" />{t('workspace.screenshot')}</button>
              <button type="button" className="rs-browser-options-item" onClick={() => void takeSnapshot()}>{t('workspace.snapshot')}</button>
              <button type="button" className="rs-browser-options-item" onClick={() => setAutomationOpen(true)}><ListChecks className="h-3.5 w-3.5" />{t('workspace.automation.open')}</button>
              <button type="button" className="rs-browser-options-item" onClick={() => { setInspectOpen(true); setInspectOutput(null); }}>{t('workspace.inspect')}</button>
              <button type="button" className="rs-browser-options-item" onClick={() => void run('upgrade', () => hostApi.agentBrowser.requestModeUpgrade({ sessionId: selectedSession.id, targetMode: 'controlled_enhanced', reason: 'workspace-inspection', userApproval: true }))}><ShieldCheck className="h-3.5 w-3.5" />{t('runtimeMode.upgrade')}</button>
              <button type="button" className="rs-browser-options-item text-red-700 dark:text-red-400" onClick={() => void run('close', async () => { const result = await hostApi.agentBrowser.close({ sessionId: selectedSession.id }); persistSession(null); return { ...result, session: undefined }; })}><Square className="h-3.5 w-3.5" />{t('actions.stop')}</button>
            </div>
          </details>}
        </div>
      </div>

      {sessions.length > 0 && (
        <ul
          className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/60 px-2 py-1.5"
          data-testid="workspace-browser-sessions"
          aria-label={t('workspace.activeSessions')}
        >
          {sessions.map((session) => (
            <li
              key={session.id}
              data-testid={`workspace-browser-session-${session.id}`}
              className={cn(
                'flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px]',
                session.id === sessionId ? 'bg-black/5 dark:bg-white/10' : 'bg-transparent',
              )}
            >
              <span className="shrink-0 rounded bg-black/[0.06] px-1 py-0.5 font-medium text-muted-foreground dark:bg-white/[0.08]">{session.profile}</span>
              <span className="shrink-0 font-medium text-foreground">{session.title || t('sessions.untitled')}</span>
              <span className="min-w-0 truncate font-mono text-muted-foreground">{session.url || t('sessions.blank')}</span>
            </li>
          ))}
        </ul>
      )}

      {!selectedSession && (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
          <div className="max-w-sm">
            <Globe className="mx-auto h-7 w-7 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">{t('workspace.empty')}</p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <select
                className="h-8 rounded-md border border-input bg-surface-input px-2 text-xs"
                aria-label={t('workspace.mode')}
                value={newSessionMode}
                onChange={(event) => setNewSessionMode(event.target.value as 'headless' | 'visible')}
              >
                <option value="visible">{t('modes.visible')}</option>
                <option value="headless">{t('modes.headless')}</option>
              </select>
              <select
                className="h-8 max-w-32 rounded-md border border-input bg-surface-input px-2 text-xs"
                aria-label={t('workspace.profile')}
                value={newSessionProfile}
                onChange={(event) => setNewSessionProfile(event.target.value)}
              >
                {(profiles.length ? profiles : [{ profile: 'default', source: 'metadata' as const }]).map((profile) => (
                  <option key={profile.profile} value={profile.profile}>{profile.label || profile.profile}</option>
                ))}
              </select>
            </div>
            <Button className="mt-4 h-8" disabled={!url.trim() || busyAction !== null} onClick={() => void openOrNavigate()}>
              {busyAction === 'open' && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {t('workspace.open')}
            </Button>
          </div>
        </div>
      )}

      {selectedSession && (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{selectedSession.title || t('sessions.untitled')}</span>
            <span className="ml-2">{selectedSession.runtimeMode || 'normal_restricted'}</span>
          </div>
          {error && <p role="alert" className="border-b border-red-500/20 px-3 py-2 text-xs text-red-700 dark:text-red-400">{error}</p>}
          {screenshot && <img src={screenshot} alt={t('workspace.screenshotAlt')} className="block max-h-80 w-full object-contain bg-black/5 dark:bg-white/5" data-testid="workspace-browser-screenshot" />}
          {snapshot && (
            <section className="border-t border-border/60" data-testid="workspace-browser-snapshot">
              {snapshotUids.length > 0 && (
                <div className="flex flex-wrap gap-1 border-b border-border/60 px-2 py-1.5" aria-label={t('workspace.snapshotNodes')}>
                  {snapshotUids.map((snapshotUid) => (
                    <button key={snapshotUid} type="button" className={cn('h-6 rounded px-1.5 font-mono text-[11px] text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10', uid === snapshotUid && 'bg-black/5 text-foreground dark:bg-white/10')} onClick={() => setUid(snapshotUid)}>
                      {snapshotUid}
                    </button>
                  ))}
                </div>
              )}
              <details className="border-b border-border/60 p-2">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">{t('workspace.advancedControls')}</summary>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Input className="h-8 min-w-28 flex-1 font-mono text-xs" value={uid} onChange={(event) => setUid(event.target.value)} placeholder={t('workspace.uid')} />
                  <Input className="h-8 min-w-32 flex-1 text-xs" value={uidValue} onChange={(event) => setUidValue(event.target.value)} placeholder={t('workspace.value')} />
                  <Button variant="outline" size="sm" className="h-8" disabled={!uid} onClick={() => void run('uid-click', () => hostApi.agentBrowser.clickByUid({ sessionId: selectedSession.id, uid }))}><MousePointerClick className="mr-1 h-3.5 w-3.5" />{t('workspace.click')}</Button>
                  <Button variant="outline" size="sm" className="h-8" disabled={!uid} onClick={() => void run('uid-fill', () => hostApi.agentBrowser.fillByUid({ sessionId: selectedSession.id, uid, value: uidValue, clear: true }))}><Type className="mr-1 h-3.5 w-3.5" />{t('workspace.fill')}</Button>
                  <Input className="h-8 w-24 font-mono text-xs" value={keyValue} onChange={(event) => setKeyValue(event.target.value)} aria-label={t('workspace.key')} />
                  <Button variant="outline" size="sm" className="h-8" disabled={!keyValue} onClick={() => void run('press-key', () => hostApi.agentBrowser.pressKey({ sessionId: selectedSession.id, key: keyValue }))}>{t('workspace.pressKey')}</Button>
                </div>
              </details>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-5 text-foreground">{snapshot}</pre>
            </section>
          )}
        </div>
      )}
      {automationOpen && selectedSession && (
        <section className="absolute inset-x-2 bottom-2 z-30 rounded-md border border-border bg-surface-modal p-3 shadow-xl" data-testid="workspace-browser-automation">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium"><ListChecks className="h-3.5 w-3.5" />{t('workspace.automation.title')}</div>
            <button type="button" className="rs-icon-btn" onClick={() => setAutomationOpen(false)} aria-label={t('workspace.automation.close')} title={t('workspace.automation.close')}><X className="h-3.5 w-3.5" /></button>
          </div>
          <p className="mb-2 truncate font-mono text-[11px] text-muted-foreground" title={selectedSession.url}>{selectedSession.url}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input className="h-8 text-xs" aria-label={t('workspace.automation.name')} value={automationName} onChange={(event) => setAutomationName(event.target.value)} placeholder={t('workspace.automation.name')} />
            <Input className="h-8 text-xs" aria-label={t('workspace.automation.objective')} value={automationObjective} onChange={(event) => setAutomationObjective(event.target.value)} placeholder={t('workspace.automation.objective')} />
            <Input className="h-8 text-xs sm:col-span-2" aria-label={t('workspace.automation.success')} value={automationSuccess} onChange={(event) => setAutomationSuccess(event.target.value)} placeholder={t('workspace.automation.success')} />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <select className="h-8 rounded-md border border-input bg-surface-input px-2 text-xs" aria-label={t('workspace.mode')} value={automationMode} onChange={(event) => setAutomationMode(event.target.value as 'headless' | 'visible')}>
              <option value="headless">{t('modes.headless')}</option>
              <option value="visible">{t('modes.visible')}</option>
            </select>
            <Button size="sm" className="h-8" disabled={automationBusy || !automationSuccess.trim()} onClick={() => void createAutomation()}>
              {automationBusy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {t('workspace.automation.submit')}
            </Button>
          </div>
        </section>
      )}
      {inspectOpen && selectedSession && (
        <aside
          className="absolute inset-y-0 right-0 z-40 flex w-[min(100%,28rem)] flex-col border-l border-border bg-surface-modal shadow-xl"
          aria-label={t('workspace.inspect')}
          data-testid="workspace-browser-inspect"
        >
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-2">
            <span className="text-xs font-medium text-foreground">{t('workspace.inspect')}</span>
            <button type="button" className="rs-icon-btn" onClick={() => setInspectOpen(false)} aria-label={t('workspace.closeInspect')} title={t('workspace.closeInspect')}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border px-2 py-1.5" role="tablist" aria-label={t('workspace.inspect')}>
            {INSPECT_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={inspectKind === kind}
                className={cn(
                  'h-7 shrink-0 rounded px-2 text-[11px] text-muted-foreground transition-colors duration-150 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10 motion-reduce:transition-none',
                  inspectKind === kind && 'bg-black/5 text-foreground dark:bg-white/10',
                )}
                onClick={() => void inspect(kind)}
                data-testid={`workspace-browser-inspect-${kind}`}
              >
                {t(`workspace.inspectKinds.${kind}`)}
              </button>
            ))}
          </div>
          {inspectKind === 'runtime' && (
            <form
              className="flex shrink-0 gap-1 border-b border-border p-2"
              onSubmit={(event) => { event.preventDefault(); void inspect('runtime'); }}
            >
              <Input
                className="h-8 min-w-0 flex-1 font-mono text-xs"
                value={runtimePaths}
                onChange={(event) => setRuntimePaths(event.target.value)}
                aria-label={t('workspace.runtimePaths')}
                placeholder="window.location, document.title"
              />
              <Button type="submit" size="sm" className="h-8 px-2 text-xs" disabled={busyAction === 'inspect-runtime'}>
                {t('workspace.runInspect')}
              </Button>
            </form>
          )}
          <div className="min-h-0 flex-1 overflow-auto">
            {busyAction?.startsWith('inspect-') ? (
              <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
            ) : inspectOutput ? (
              <pre className="whitespace-pre-wrap p-3 font-mono text-[11px] leading-5 text-foreground">{inspectOutput}</pre>
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">{t('workspace.inspectEmpty')}</div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
