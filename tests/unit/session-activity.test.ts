import { describe, expect, it } from 'vitest';
import {
  classifySessionActivity,
  createEmptySessionActivitySnapshot,
  retainRecentSessionActivity,
} from '@shared/types/session-activity';
import { reduceSessionActivity } from '@/stores/session-activity';

describe('session activity projection', () => {
  it('isolates events by session key', () => {
    const initial = createEmptySessionActivitySnapshot('session-a', 1);
    const next = reduceSessionActivity(initial, {
      channel: 'runtime',
      payload: { type: 'run.started', runId: 'run-b', sessionKey: 'session-b', ts: 2 },
    });

    expect(next).toBe(initial);
    expect(next.session.status).toBe('idle');
  });

  it('keeps a newer terminal state when an older event arrives late', () => {
    const initial = createEmptySessionActivitySnapshot('session-a', 1);
    const completed = reduceSessionActivity(initial, {
      channel: 'terminal',
      payload: {
        workspaceId: 'workspace', sessionKey: 'session-a', sessionId: 'terminal-1',
        status: 'exited', exitCode: 0, ts: 20,
      },
    });
    const lateRunning = reduceSessionActivity(completed, {
      channel: 'terminal',
      payload: {
        workspaceId: 'workspace', sessionKey: 'session-a', sessionId: 'terminal-1',
        status: 'running', ts: 10,
      },
    });

    expect(lateRunning.terminals).toHaveLength(1);
    expect(lateRunning.terminals[0].status).toBe('completed');
  });

  it('keeps a newer completed run when an older start event arrives late', () => {
    const initial = createEmptySessionActivitySnapshot('session-a', 1);
    const completed = reduceSessionActivity(initial, {
      channel: 'runtime',
      payload: { type: 'run.ended', runId: 'run-a', sessionKey: 'session-a', status: 'completed', ts: 20 },
    });
    const lateStart = reduceSessionActivity(completed, {
      channel: 'runtime',
      payload: { type: 'run.started', runId: 'run-a', sessionKey: 'session-a', ts: 10 },
    });

    expect(lateStart).toBe(completed);
    expect(lateStart.session.status).toBe('completed');
  });

  it('does not invent percentage progress for a normal chat run', () => {
    const next = reduceSessionActivity(createEmptySessionActivitySnapshot('session-a', 1), {
      channel: 'runtime',
      payload: { type: 'run.started', runId: 'run-a', sessionKey: 'session-a', ts: 2 },
    });

    expect(next.session.status).toBe('running');
    expect(next.tasks).toEqual([]);
  });

  it('preserves backend task progress from structured lifecycle events', () => {
    const next = reduceSessionActivity(createEmptySessionActivitySnapshot('session-a', 1), {
      channel: 'taskLoop',
      payload: {
        loopRunId: 'loop-a', sessionKey: 'session-a', phase: 'verify', status: 'running',
        iteration: 2, progress: 0.75, ts: 4,
      },
    });

    expect(next.tasks[0]).toMatchObject({ kind: 'taskLoop', progress: 0.75, status: 'running' });
  });

  it('files a sub-agent under the session that spawned it, not its own child session', () => {
    const parent = reduceSessionActivity(createEmptySessionActivitySnapshot('session-a', 1), {
      channel: 'subagent',
      payload: {
        runId: 'run-a', sessionKey: 'session-a', childSessionKey: 'agent:explorer:child-1',
        taskNodeId: 'node-1', agentId: 'explorer', roleName: 'explorer', task: 'Scout', status: 'started', ts: 4,
      },
    });
    expect(parent.subagents).toHaveLength(1);
    expect(parent.subagents[0]).toMatchObject({
      id: 'node-1', role: 'explorer', childSessionKey: 'agent:explorer:child-1', agentId: 'explorer',
    });

    // The child's own snapshot must NOT collect its parent's roster entry, or
    // the parent's status card lists nothing and the row is never openable.
    const child = reduceSessionActivity(createEmptySessionActivitySnapshot('agent:explorer:child-1', 1), {
      channel: 'subagent',
      payload: {
        runId: 'run-a', sessionKey: 'session-a', childSessionKey: 'agent:explorer:child-1',
        taskNodeId: 'node-1', roleName: 'explorer', status: 'started', ts: 4,
      },
    });
    expect(child.subagents).toEqual([]);
  });

  it('keeps the child session key when a later event omits it', () => {
    const started = reduceSessionActivity(createEmptySessionActivitySnapshot('session-a', 1), {
      channel: 'subagent',
      payload: {
        runId: 'run-a', sessionKey: 'session-a', childSessionKey: 'agent:explorer:child-1',
        taskNodeId: 'node-1', agentId: 'explorer', roleName: 'explorer', task: 'Scout', status: 'started', ts: 4,
      },
    });
    // Runtimes commonly report identity fields on the opening event only.
    const completed = reduceSessionActivity(started, {
      channel: 'subagent',
      payload: { runId: 'run-a', sessionKey: 'session-a', taskNodeId: 'node-1', status: 'completed', ts: 9 },
    });

    expect(completed.subagents).toHaveLength(1);
    expect(completed.subagents[0]).toMatchObject({
      status: 'completed',
      childSessionKey: 'agent:explorer:child-1',
      agentId: 'explorer',
      role: 'explorer',
      task: 'Scout',
    });
  });

  it('classifies blocked evidence above active and passive activity', () => {
    const snapshot = createEmptySessionActivitySnapshot('session-a', 1);
    snapshot.git = {
      isRepository: true,
      workspaceRoot: 'C:/workspace',
      branch: 'main',
      ahead: 0,
      behind: 0,
      clean: false,
      hasConflicts: false,
      stagedCount: 0,
      unstagedCount: 1,
      untrackedCount: 0,
      conflictedCount: 0,
      changes: [],
    };
    expect(classifySessionActivity(snapshot)).toBe('passive');

    snapshot.session = { ...snapshot.session, status: 'running', updatedAt: 2 };
    expect(classifySessionActivity(snapshot)).toBe('active');

    snapshot.continuity = { ...snapshot.continuity, blockedReason: 'Checkpoint review required' };
    expect(classifySessionActivity(snapshot)).toBe('attention');
  });

  it('classifies goal, process, and lineage projection states', () => {
    const snapshot = createEmptySessionActivitySnapshot('session-a', 1);
    snapshot.goals = [
      { id: 'goal-running', kind: 'mission', label: 'Mission goal-running', status: 'running', updatedAt: 2 },
    ];
    expect(classifySessionActivity(snapshot)).toBe('active');

    snapshot.processes = [
      { id: 'proc-failed', kind: 'bash', label: 'Process proc-failed', status: 'failed', updatedAt: 3 },
    ];
    expect(classifySessionActivity(snapshot)).toBe('attention');

    snapshot.goals = [
      { id: 'goal-done', kind: 'flow', label: 'Goal wait goal-done', status: 'completed', updatedAt: 3 },
    ];
    snapshot.processes = [];
    snapshot.lineage = [
      { id: 'child-done', kind: 'child', sessionKey: 'agent:main:child', status: 'completed', updatedAt: 4 },
    ];
    expect(classifySessionActivity(snapshot)).toBe('passive');
  });

  it('retains recent goal, process, and lineage projections while preserving failures', () => {
    const snapshot = createEmptySessionActivitySnapshot('session-a', 1);
    snapshot.goals = [
      { id: 'goal-old', kind: 'mission', label: 'Old', status: 'completed', updatedAt: 100_000 },
      { id: 'goal-failed', kind: 'flow', label: 'Failed', status: 'failed', updatedAt: 100_000 },
    ];
    snapshot.processes = [
      { id: 'proc-old', kind: 'bash', label: 'Old', status: 'completed', updatedAt: 100_000 },
      { id: 'proc-killed', kind: 'supervisor', label: 'Killed', status: 'killed', updatedAt: 100_000 },
    ];
    snapshot.lineage = [
      { id: 'lineage-old', kind: 'child', sessionKey: 'agent:main:child', status: 'completed', updatedAt: 100_000 },
      { id: 'lineage-error', kind: 'parent', sessionKey: 'agent:main:parent', status: 'error', updatedAt: 100_000 },
    ];

    const retained = retainRecentSessionActivity(snapshot, 5, 600_000);
    expect(retained.goals.map((goal) => goal.id)).toEqual(['goal-failed']);
    expect(retained.processes.map((process) => process.id)).toEqual(['proc-killed']);
    expect(retained.lineage.map((entry) => entry.id)).toEqual(['lineage-error']);
  });

  it('retains only recent completed items while preserving failures', () => {
    const snapshot = createEmptySessionActivitySnapshot('session-a', 1);
    snapshot.tasks = [
      { id: 'recent', kind: 'taskLoop', title: 'Recent', status: 'completed', updatedAt: 590_000, source: 'event' },
      { id: 'old', kind: 'taskLoop', title: 'Old', status: 'completed', updatedAt: 100_000, source: 'event' },
      { id: 'failed', kind: 'taskLoop', title: 'Failed', status: 'failed', updatedAt: 100_000, source: 'event' },
    ];

    expect(retainRecentSessionActivity(snapshot, 5, 600_000).tasks.map((task) => task.id)).toEqual(['recent', 'failed']);
    expect(retainRecentSessionActivity(snapshot, 0, 600_000).tasks.map((task) => task.id)).toEqual(['failed']);
  });
});
