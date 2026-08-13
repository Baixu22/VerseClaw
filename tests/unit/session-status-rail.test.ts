/**
 * Session status rail helpers — git summarisation and the sub-agent roster.
 * The rail component only wires these together; the semantics that matter
 * (what counts as "no line stats", how a lifecycle pair collapses into one
 * row, what order the roster shows) live here.
 */
import { describe, expect, it } from 'vitest';
import {
  SUBAGENT_ROSTER_LIMIT,
  foldSubagentEvent,
  rosterToList,
  summarizeGitLineDelta,
  summarizeGitStatus,
  type SessionSubagentEntry,
} from '@/pages/Chat/use-session-status';
import type { SubagentRuntimeLifecycleEvent } from '@shared/host-events/contract';
import type { GitFileChange, GitRepositoryStatus } from '@shared/types/git';

const change = (path: string, additions?: number | null, deletions?: number | null): GitFileChange => ({
  path,
  absolutePath: `/repo/${path}`,
  status: 'M',
  staged: false,
  unstaged: true,
  untracked: false,
  conflicted: false,
  bucket: 'unstaged',
  additions,
  deletions,
});

const status = (overrides: Partial<GitRepositoryStatus> = {}): GitRepositoryStatus => ({
  isRepository: true,
  workspaceRoot: '/repo',
  branch: 'main',
  ahead: 0,
  behind: 0,
  clean: false,
  hasConflicts: false,
  changes: [],
  stagedCount: 0,
  unstagedCount: 0,
  untrackedCount: 0,
  conflictedCount: 0,
  ...overrides,
});

const event = (overrides: Partial<SubagentRuntimeLifecycleEvent> = {}): SubagentRuntimeLifecycleEvent => ({
  runId: 'run-1',
  taskNodeId: 'node-1',
  roleName: 'researcher',
  task: 'survey the codebase',
  status: 'started',
  ts: 1_000,
  ...overrides,
});

describe('summarizeGitLineDelta', () => {
  it('sums per-file additions and deletions', () => {
    expect(summarizeGitLineDelta(status({
      changes: [change('a.ts', 10, 2), change('b.ts', 5, 3)],
    }))).toEqual({ added: 15, removed: 5 });
  });

  it('returns null when nothing was measured, so the rail can say so instead of showing +0 −0', () => {
    expect(summarizeGitLineDelta(status({
      changes: [change('bin.png'), change('other.png', null, null)],
    }))).toBeNull();
  });

  it('counts a partially measured set rather than discarding it', () => {
    expect(summarizeGitLineDelta(status({
      changes: [change('bin.png'), change('a.ts', 4, 1)],
    }))).toEqual({ added: 4, removed: 1 });
  });
});

describe('summarizeGitStatus', () => {
  it('returns null outside a repository', () => {
    expect(summarizeGitStatus(undefined)).toBeNull();
    expect(summarizeGitStatus(status({ isRepository: false }))).toBeNull();
  });

  it('totals every change bucket into one count', () => {
    const summary = summarizeGitStatus(status({
      stagedCount: 2,
      unstagedCount: 3,
      untrackedCount: 1,
      conflictedCount: 4,
    }));
    expect(summary?.changeCount).toBe(10);
    expect(summary?.conflictedCount).toBe(4);
  });

  it('carries branch, detached and tracking state through', () => {
    const summary = summarizeGitStatus(status({ branch: 'feature', detached: true, ahead: 2, behind: 5 }));
    expect(summary).toMatchObject({ branch: 'feature', detached: true, ahead: 2, behind: 5 });
  });

  it('reports a null branch rather than an empty string', () => {
    expect(summarizeGitStatus(status({ branch: '' }))?.branch).toBeNull();
  });

  it('leaves the delta null when no file carried line stats', () => {
    const summary = summarizeGitStatus(status({ changes: [change('bin.png')] }));
    expect(summary?.added).toBeNull();
    expect(summary?.removed).toBeNull();
  });
});

describe('foldSubagentEvent', () => {
  it('collapses a started → completed pair onto one row', () => {
    const started = foldSubagentEvent(new Map(), event());
    const finished = foldSubagentEvent(started, event({ status: 'completed', ts: 2_000 }));
    expect(finished.size).toBe(1);
    expect(finished.get('node-1')).toMatchObject({ status: 'completed', ts: 2_000 });
  });

  it('ignores a stale event so a late `started` cannot resurrect a finished agent', () => {
    const finished = foldSubagentEvent(new Map(), event({ status: 'completed', ts: 2_000 }));
    const stale = foldSubagentEvent(finished, event({ status: 'started', ts: 1_000 }));
    expect(stale.get('node-1')?.status).toBe('completed');
  });

  it('keeps agents lacking a node id apart by role and task', () => {
    let roster = foldSubagentEvent(new Map(), event({ taskNodeId: undefined, roleName: 'a', task: 'one' }));
    roster = foldSubagentEvent(roster, event({ taskNodeId: undefined, roleName: 'b', task: 'two' }));
    expect(roster.size).toBe(2);
  });

  it('inherits role and task from the previous entry when a terminal event omits them', () => {
    const started = foldSubagentEvent(new Map(), event());
    const finished = foldSubagentEvent(started, event({
      status: 'error',
      roleName: '',
      task: '',
      error: 'boom',
      ts: 2_000,
    }));
    expect(finished.get('node-1')).toMatchObject({
      roleName: 'researcher',
      task: 'survey the codebase',
      status: 'error',
      error: 'boom',
    });
  });
});

describe('rosterToList', () => {
  const entry = (key: string, status: SessionSubagentEntry['status'], ts: number): [string, SessionSubagentEntry] => (
    [key, { key, roleName: key, task: '', status, ts }]
  );

  it('puts running agents first, then the most recent', () => {
    const list = rosterToList(new Map([
      entry('done-old', 'completed', 1_000),
      entry('done-new', 'completed', 3_000),
      entry('running', 'started', 2_000),
    ]));
    expect(list.map((item) => item.key)).toEqual(['running', 'done-new', 'done-old']);
  });

  it('caps the roster so a fan-out run cannot grow the column without bound', () => {
    const roster = new Map(
      Array.from({ length: SUBAGENT_ROSTER_LIMIT + 5 }, (_, index) => entry(`agent-${index}`, 'completed', index)),
    );
    expect(rosterToList(roster)).toHaveLength(SUBAGENT_ROSTER_LIMIT);
  });

  it('keeps running agents when the cap truncates', () => {
    const roster = new Map([
      ...Array.from({ length: SUBAGENT_ROSTER_LIMIT + 5 }, (_, index) => entry(`done-${index}`, 'completed', 9_000 + index)),
      entry('running', 'started', 1),
    ]);
    expect(rosterToList(roster).map((item) => item.key)).toContain('running');
  });
});
