import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Check, Circle, Play, ShieldAlert, Square, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { hostApi, type WorkspaceTerminalSessionResult } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { cn } from '@/lib/utils';
import { X } from '@/components/icons/codex-icons';
import { useChatStore } from '@/stores/chat';
import { useWorkspacesStore } from '@/stores/workspaces';
import type { PermissionApprovalEvent } from '@shared/types/workspace';

type TerminalStatus = NonNullable<WorkspaceTerminalSessionResult['status']>;

function statusLabel(t: (key: string, fallback: string) => string, status: TerminalStatus | undefined): string {
  switch (status) {
    case 'running': return t('workspace.terminal.status.running', 'Running');
    case 'starting': return t('workspace.terminal.status.starting', 'Starting');
    case 'exited': return t('workspace.terminal.status.exited', 'Exited');
    case 'blocked': return t('workspace.terminal.status.blocked', 'Blocked');
    case 'idle': return t('workspace.terminal.status.idle', 'Idle');
    default: return t('workspace.terminal.status.idle', 'Idle');
  }
}

function permissionLabel(t: (key: string, fallback: string) => string, mode: string | undefined): string {
  switch (mode) {
    case 'readOnly': return t('workspace.terminal.permission.readOnly', 'Read only');
    case 'acceptEdits': return t('workspace.terminal.permission.acceptEdits', 'Accept edits');
    case 'plan': return t('workspace.terminal.permission.plan', 'Plan');
    case 'fullAccess': return t('workspace.terminal.permission.fullAccess', 'Full access');
    default: return t('workspace.terminal.permission.acceptEdits', 'Accept edits');
  }
}

function readTerminalTheme() {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => {
    const value = styles.getPropertyValue(name).trim();
    return value ? `hsl(${value})` : fallback;
  };
  return {
    background: token('--background', '#ffffff'),
    foreground: token('--foreground', '#171717'),
    cursor: token('--foreground', '#171717'),
    cursorAccent: token('--background', '#ffffff'),
    selectionBackground: token('--surface-input', '#e5e7eb'),
    black: token('--foreground', '#171717'),
    white: token('--background', '#ffffff'),
    brightBlack: token('--muted-foreground', '#737373'),
    brightWhite: token('--foreground', '#171717'),
  };
}

export function WorkspaceTerminalPanel() {
  const { t } = useTranslation('chat');
  const activeWorkspace = useWorkspacesStore((s) => s.activeWorkspace);
  const workspaceId = activeWorkspace?.id;
  const workspaceRootPath = activeWorkspace?.rootPath;
  const permissionMode = activeWorkspace?.permissionMode;
  const saveWorkspaceState = useWorkspacesStore((s) => s.saveWorkspaceState);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<TerminalStatus>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PermissionApprovalEvent | null>(null);
  const [busy, setBusy] = useState(false);

  const persistTerminalState = useCallback((patch: Record<string, unknown>) => {
    if (!workspaceId) return;
    void saveWorkspaceState({
      id: workspaceId,
      sessionKey: currentSessionKey,
      state: {
        terminal: {
          open: true,
          registeredWorkspaceId: workspaceId,
          ...patch,
        },
      },
    });
  }, [currentSessionKey, saveWorkspaceState, workspaceId]);

  useEffect(() => {
    if (!containerRef.current) return;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.3,
      theme: readTerminalTheme(),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    const dataDisposable = terminal.onData((data) => {
      const id = sessionIdRef.current;
      if (!id) return;
      void hostApi.terminal.write({ sessionId: id, data }).catch((error) => {
        toast.error(error instanceof Error ? error.message : String(error));
      });
    });
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      const id = sessionIdRef.current;
      if (!id) return;
      const dims = fitAddon.proposeDimensions();
      if (!dims) return;
      void hostApi.terminal.resize({ sessionId: id, cols: dims.cols, rows: dims.rows }).catch(() => {});
      persistTerminalState({ cols: dims.cols, rows: dims.rows });
    });
    resizeObserver.observe(containerRef.current);
    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = readTerminalTheme();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });
    return () => {
      dataDisposable.dispose();
      resizeObserver.disconnect();
      themeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      sessionIdRef.current = null;
    };
  }, [persistTerminalState]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    if (!workspaceId) return;
    const unsubData = hostEvents.onTerminalData((event) => {
      if (event.workspaceId !== workspaceId || event.sessionKey !== currentSessionKey) return;
      if (event.sessionId !== sessionIdRef.current) return;
      terminalRef.current?.write(event.data);
    });
    const unsubStatus = hostEvents.onTerminalStatusChanged((event) => {
      if (event.workspaceId !== workspaceId || event.sessionKey !== currentSessionKey) return;
      setStatus(event.status ?? 'idle');
      setSessionId(event.sessionId);
      persistTerminalState({ sessionId: event.sessionId, status: event.status, cwd: event.cwd ?? workspaceRootPath, activeProcessId: event.pid ? String(event.pid) : null });
    });
    const unsubExit = hostEvents.onTerminalExit((event) => {
      if (event.workspaceId !== workspaceId || event.sessionKey !== currentSessionKey) return;
      setStatus('exited');
      terminalRef.current?.writeln(`\r\n[terminal exited: ${event.exitCode ?? 'null'}]`);
      persistTerminalState({ status: 'exited', lastExitCode: event.exitCode, activeProcessId: null });
    });
    return () => {
      unsubData();
      unsubStatus();
      unsubExit();
    };
  }, [currentSessionKey, persistTerminalState, workspaceId, workspaceRootPath]);

  useEffect(() => {
    if (!workspaceId) {
      setStatus('idle');
      setSessionId(null);
      return;
    }
    void hostApi.terminal.status({ workspaceId, sessionKey: currentSessionKey })
      .then((result) => {
        setStatus(result.status ?? 'idle');
        setSessionId(result.sessionId ?? null);
        if (result.scrollback) terminalRef.current?.write(result.scrollback);
      })
      .catch(() => {
        setStatus('idle');
        setSessionId(null);
      });
  }, [currentSessionKey, workspaceId]);

  const openTerminal = async (approvalId?: string) => {
    if (!workspaceId) return;
    setBusy(true);
    try {
      fitAddonRef.current?.fit();
      const dims = fitAddonRef.current?.proposeDimensions();
      const result = await hostApi.terminal.open({
        workspaceId,
        sessionKey: currentSessionKey,
        cols: dims?.cols,
        rows: dims?.rows,
        approvalId,
      });
      if (result.approvalRequired && result.approval) {
        setPendingApproval(result.approval);
        setStatus('blocked');
        toast.warning(t('workspace.terminal.toast.approvalRequired', 'Interactive terminal requires approval'));
        return;
      }
      if (!result.success || result.blocked) {
        setStatus(result.status ?? 'blocked');
        toast.error(result.reason || t('workspace.terminal.toast.blocked', 'Terminal launch was blocked'));
        return;
      }
      setPendingApproval(null);
      setSessionId(result.sessionId ?? null);
      setStatus(result.status ?? 'running');
      terminalRef.current?.focus();
      persistTerminalState({ sessionId: result.sessionId ?? null, cwd: result.cwd ?? workspaceRootPath, status: result.status ?? 'running', cols: result.cols, rows: result.rows, activeProcessId: result.pid ? String(result.pid) : null });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const approveOpen = async () => {
    if (!pendingApproval) return;
    setBusy(true);
    try {
      const result = await hostApi.permissions.decideApproval({ id: pendingApproval.id, decision: 'approved' });
      if (!result.success) {
        toast.error(result.error || t('workspace.terminal.toast.approvalFailed', 'Approval failed'));
        return;
      }
      await openTerminal(pendingApproval.id);
    } finally {
      setBusy(false);
    }
  };

  const interruptTerminal = async () => {
    if (!sessionId || status !== 'running') return;
    setBusy(true);
    try {
      const result = await hostApi.terminal.interrupt({ sessionId });
      if (!result.success) {
        throw new Error(result.error || t('workspace.terminal.toast.interruptFailed', 'Could not interrupt terminal'));
      }
      terminalRef.current?.focus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const endTerminal = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      const result = await hostApi.terminal.close({ sessionId });
      if (!result.success) {
        throw new Error(result.error || t('workspace.terminal.toast.closeFailed', 'Could not end terminal'));
      }
      sessionIdRef.current = null;
      setSessionId(null);
      setStatus('idle');
      persistTerminalState({ sessionId: null, status: 'idle', activeProcessId: null });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const blocked = permissionMode === 'plan' || permissionMode === 'readOnly';
  const startDisabled = blocked || busy || status === 'running' || status === 'starting' || !workspaceId;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="workspace-terminal-panel">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-2">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
          <Circle
            className={cn(
              'h-1.5 w-1.5 fill-current stroke-0',
              status === 'running' ? 'text-blue-600 dark:text-blue-400' : status === 'blocked' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground/45',
            )}
          />
          <span>{statusLabel(t, blocked ? 'blocked' : status)}</span>
          <span aria-hidden="true">/</span>
          <span className="truncate">{permissionLabel(t, permissionMode)}</span>
          {workspaceRootPath && <span className="hidden truncate font-mono text-muted-foreground/70 md:inline">{workspaceRootPath}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => terminalRef.current?.clear()} title={t('workspace.terminal.actions.clear', 'Clear')} aria-label={t('workspace.terminal.actions.clear', 'Clear')}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          {status === 'running' && (
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={busy} onClick={() => void interruptTerminal()} title={t('workspace.terminal.actions.interrupt', 'Ctrl+C')} aria-label={t('workspace.terminal.actions.interrupt', 'Ctrl+C')}>
              <Square className="h-3.5 w-3.5" />
            </Button>
          )}
          {sessionId && (
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-700 dark:text-red-400" disabled={busy} onClick={() => void endTerminal()} title={t('workspace.terminal.actions.end', 'End terminal')} aria-label={t('workspace.terminal.actions.end', 'End terminal')}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
          {!sessionId && (
            <Button type="button" size="sm" className="h-7 px-2 text-xs" disabled={startDisabled} onClick={() => void openTerminal()}>
              <Play className="mr-1 h-3 w-3" />
              {t('workspace.terminal.actions.start', 'Start')}
            </Button>
          )}
        </div>
      </div>

      {blocked && (
        <div className="flex items-start gap-2 border-b border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0">
            <p className="font-medium text-amber-800 dark:text-amber-300">
              {t('workspace.terminal.blocked.title', 'Interactive terminal is disabled in this permission mode')}
            </p>
            <p className="mt-0.5 text-amber-800 dark:text-amber-300">{t('workspace.terminal.blocked.body', 'Switch to Accept edits or Full access before starting a live terminal.')}</p>
          </div>
        </div>
      )}

      {pendingApproval && (
        <div className="flex items-center justify-between gap-3 border-b border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs">
          <p className="truncate text-amber-800 dark:text-amber-300">{pendingApproval.reason}</p>
          <Button size="sm" className="h-7" disabled={busy} onClick={() => void approveOpen()}>
            <Check className="mr-1.5 h-3 w-3" />{t('workspace.terminal.actions.approve', 'Approve')}
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 bg-background">
        <div className="relative h-full overflow-hidden bg-background">
          {/* Minimal status dot — top-right corner */}
          <div ref={containerRef} className="workspace-terminal-surface h-full w-full px-2 py-1" />
        </div>
      </div>
    </div>
  );
}
