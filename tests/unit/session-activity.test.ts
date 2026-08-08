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
