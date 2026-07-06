import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Check, Circle, Play, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { hostApi, type WorkspaceTerminalSessionResult } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { cn } from '@/lib/utils';
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
      theme: {
        background: '#111111',
        foreground: '#e8e8e8',
        cursor: '#f5f5f5',
        cursorAccent: '#111111',
        selectionBackground: '#334155',
        black: '#171717',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e2e8f0',
        brightBlack: '#64748b',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fafc',
      },
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
    return () => {
      dataDisposable.dispose();
      resizeObserver.disconnect();
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

  const blocked = permissionMode === 'plan' || permissionMode === 'readOnly';
  const startDisabled = blocked || busy || status === 'running' || status === 'starting' || !workspaceId;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0a0a0a]">
      <div className="shrink-0 border-b border-white/10 bg-[#111111] px-3 py-2">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{t('workspace.terminal.title', 'Workspace terminal')}</p>
            <p className="truncate font-mono text-[11px] text-white/45">
              {workspaceRootPath || t('workspace.terminal.noWorkspace', 'No workspace selected')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden max-w-28 truncate rounded-sm border border-white/10 px-1.5 py-0.5 text-[11px] text-white/50 sm:inline">
              {permissionLabel(t, permissionMode)}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-sm border border-white/10 px-1.5 py-0.5 text-[11px] text-white/65">
              <Circle
                className={cn(
                  'h-1.5 w-1.5 fill-current stroke-0',
                  status === 'running' ? 'text-emerald-400' : status === 'blocked' ? 'text-amber-400' : 'text-white/25',
                )}
              />
              {statusLabel(t, blocked ? 'blocked' : status)}
            </span>
            <Button
              type="button"
              size="sm"
              className="h-7"
              disabled={startDisabled}
              onClick={() => void openTerminal()}
            >
              <Play className="mr-1.5 h-3 w-3" />
              {t('workspace.terminal.actions.start', 'Start')}
            </Button>
          </div>
        </div>
      </div>

      {blocked && (
        <div className="mx-3 mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs">
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
        <div className="mx-3 mt-3 flex items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs">
          <p className="truncate text-amber-800 dark:text-amber-300">{pendingApproval.reason}</p>
          <Button size="sm" className="h-7" disabled={busy} onClick={() => void approveOpen()}>
            <Check className="mr-1.5 h-3 w-3" />{t('workspace.terminal.actions.approve', 'Approve')}
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 p-2">
        <div className="relative h-full overflow-hidden rounded-md bg-[#0a0a0a]">
          {/* Minimal status dot — top-right corner */}
          <div className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-1.5">
            <Circle
              className={cn(
                'h-1.5 w-1.5 fill-current stroke-0',
                status === 'running' ? 'text-emerald-400' : status === 'blocked' ? 'text-amber-400' : 'text-white/20',
              )}
            />
            {status === 'running' && (
              <span className="font-mono text-[10px] text-white/30">{statusLabel(t, status)}</span>
            )}
          </div>
          <div ref={containerRef} className="h-full w-full p-3" />
        </div>
      </div>
    </div>
  );
}
