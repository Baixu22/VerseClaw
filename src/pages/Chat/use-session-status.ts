/**
 * Session status snapshot for the chat's third column.
 *
 * The rail needs four things the Chat page does not already have in hand:
 * git state, the live sub-agent roster, and the workspace terminal's state.
 * Everything else it shows (the run's plan, the task ledger, long-task
 * control) is already projected by the page and arrives as props — pulling
 * those in here would mean a second subscription to the same stores and a
 * second render per streamed token.
 *
 * Fetches are tagged with the workspace they were issued for: a result that
 * lands after the user switched projects is dropped rather than cleared in an
 * effect body, so switching workspaces costs one render instead of two.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { subagentLifecycleIdentityKey } from '@shared/subagent-lifecycle';
import type { SubagentRuntimeLifecycleEvent } from '@shared/host-events/contract';
import type { GitRepositoryStatus } from '@shared/types/git';

export type SessionGitSummary = {
  isRepository: boolean;
  branch: string | null;
  detached: boolean;
  clean: boolean;
  changeCount: number;
  conflictedCount: number;
  stagedCount: number;
  unstagedCount: number;
  ahead: number;
  behind: number;
  /** null when every change is binary or unmeasured. */
  added: number | null;
  removed: number | null;
};

export type SessionSubagentEntry = {
  key: string;
  roleName: string;
  task: string;
  status: SubagentRuntimeLifecycleEvent['status'];
  error?: string;
  /** The child's own session, once the runtime reports it. Opens its transcript. */
  childSessionKey?: string;
  agentId?: string;
  ts: number;
};

export type SessionTerminalSummary = {
  state: 'idle' | 'starting' | 'running' | 'exited' | 'blocked';
  pid: number | null;
};

export type SessionStatusSnapshot = {
  git: SessionGitSummary | null;
  gitLoading: boolean;
  subagents: SessionSubagentEntry[];
  runningSubagentCount: number;
  terminal: SessionTerminalSummary | null;
  refreshGit: () => void;
};

/** Sums the per-file diff stats the main process attaches to `git.status()`. */
export function summarizeGitLineDelta(status: GitRepositoryStatus): { added: number; removed: number } | null {
  let added = 0;
  let removed = 0;
  let measured = false;
  for (const change of status.changes) {
    if (typeof change.additions === 'number') {
      added += change.additions;
      measured = true;
    }
    if (typeof change.deletions === 'number') {
      removed += change.deletions;
      measured = true;
    }
  }
  return measured ? { added, removed } : null;
}

export function summarizeGitStatus(status: GitRepositoryStatus | undefined): SessionGitSummary | null {
  if (!status?.isRepository) return null;
  const delta = summarizeGitLineDelta(status);
  return {
    isRepository: true,
    branch: status.branch || null,
    detached: status.detached ?? false,
    clean: status.clean,
    changeCount: status.stagedCount + status.unstagedCount + status.untrackedCount + status.conflictedCount,
    conflictedCount: status.conflictedCount,
    stagedCount: status.stagedCount,
    unstagedCount: status.unstagedCount,
    ahead: status.ahead,
    behind: status.behind,
    added: delta?.added ?? null,
    removed: delta?.removed ?? null,
  };
}

/**
 * Folds a lifecycle event into the roster. Events are keyed by their stable
 * identity so a `started` → `completed` pair collapses into one row instead of
 * stacking two, and a stale `started` never overwrites a newer terminal state.
 */
export function foldSubagentEvent(
  roster: ReadonlyMap<string, SessionSubagentEntry>,
  event: SubagentRuntimeLifecycleEvent,
): Map<string, SessionSubagentEntry> {
  const key = subagentLifecycleIdentityKey(event);
  const ts = event.ts ?? Date.now();
  const previous = roster.get(key);
  if (previous && previous.ts > ts) return roster as Map<string, SessionSubagentEntry>;
  const next = new Map(roster);
  next.set(key, {
    key,
    roleName: event.roleName || previous?.roleName || 'agent',
    task: event.task || previous?.task || '',
    status: event.status,
    error: event.error ?? previous?.error,
    childSessionKey: event.childSessionKey ?? previous?.childSessionKey,
    agentId: event.agentId ?? previous?.agentId,
    ts,
  });
  return next;
}

export const SUBAGENT_ROSTER_LIMIT = 12;

const EMPTY_ROSTER: ReadonlyMap<string, SessionSubagentEntry> = new Map();

export function rosterToList(roster: ReadonlyMap<string, SessionSubagentEntry>): SessionSubagentEntry[] {
  return Array.from(roster.values())
    .sort((left, right) => {
      // Running first, then most recent.
      const leftRunning = left.status === 'started' ? 0 : 1;
      const rightRunning = right.status === 'started' ? 0 : 1;
      if (leftRunning !== rightRunning) return leftRunning - rightRunning;
      return right.ts - left.ts;
    })
    .slice(0, SUBAGENT_ROSTER_LIMIT);
}

export function useSessionStatus({
  workspaceId,
  sessionKey,
  refreshSignal,
}: {
  workspaceId?: string | null;
  sessionKey: string;
  refreshSignal?: number;
}): SessionStatusSnapshot {
  const [git, setGit] = useState<{ token: string; workspaceId: string; summary: SessionGitSummary | null } | null>(null);
  const [terminal, setTerminal] = useState<{ workspaceId: string; summary: SessionTerminalSummary | null } | null>(null);
  const [roster, setRoster] = useState<{ owner: string; entries: ReadonlyMap<string, SessionSubagentEntry> }>(
    () => ({ owner: '', entries: EMPTY_ROSTER }),
  );
  const [gitNonce, setGitNonce] = useState(0);

  const rosterOwner = `${workspaceId ?? ''}::${sessionKey}`;
  const gitToken = `${workspaceId ?? ''}::${refreshSignal ?? 0}::${gitNonce}`;

  const refreshGit = useCallback(() => setGitNonce((value) => value + 1), []);

  // No reset when the workspace clears: the snapshot below only surfaces a
  // summary whose workspaceId still matches, so stale state cannot leak out.
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    void Promise.resolve()
      .then(() => hostApi.git?.status?.())
      .then((result) => {
        if (cancelled) return;
        setGit({ token: gitToken, workspaceId, summary: summarizeGitStatus(result?.status) });
      })
      .catch(() => {
        if (cancelled) return;
        setGit({ token: gitToken, workspaceId, summary: null });
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, gitToken]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    // The rail is decorative: a host build without terminal support degrades to
    // an absent summary rather than taking the conversation down with it.
    void Promise.resolve()
      .then(() => hostApi.terminal?.status?.({ workspaceId, sessionKey }))
      .then((result) => {
        if (cancelled) return;
        setTerminal({
          workspaceId,
          summary: result?.status ? { state: result.status, pid: result.pid ?? null } : null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setTerminal({ workspaceId, summary: null });
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, sessionKey, refreshSignal]);

  useEffect(() => {
    const unsubscribe = hostEvents.onSubagentLifecycle?.((event) => {
      // Events without a session tag belong to the run in the foreground.
      if (event.sessionKey && event.sessionKey !== sessionKey) return;
      setRoster((current) => ({
        owner: rosterOwner,
        // A roster tagged to another session carries no history worth keeping:
        // lifecycle events replay nothing, so those agents are not ours.
        entries: foldSubagentEvent(current.owner === rosterOwner ? current.entries : EMPTY_ROSTER, event),
      }));
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [sessionKey, rosterOwner]);

  const subagents = useMemo(
    () => rosterToList(roster.owner === rosterOwner ? roster.entries : EMPTY_ROSTER),
    [roster, rosterOwner],
  );
  const runningSubagentCount = useMemo(
    () => subagents.filter((entry) => entry.status === 'started').length,
    [subagents],
  );

  // Loading is derived, not stored: a request is in flight for exactly as long
  // as the newest settled result is still tagged to an earlier request.
  const gitLoading = Boolean(workspaceId) && git?.token !== gitToken;

  return useMemo(() => ({
    git: git && git.workspaceId === workspaceId ? git.summary : null,
    gitLoading,
    subagents,
    runningSubagentCount,
    terminal: terminal && terminal.workspaceId === workspaceId ? terminal.summary : null,
    refreshGit,
  }), [git, gitLoading, refreshGit, runningSubagentCount, subagents, terminal, workspaceId]);
}
