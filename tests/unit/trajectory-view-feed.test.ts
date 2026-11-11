import { describe, expect, it, vi } from 'vitest';
import { TrajectoryViewFeed, type TrajectoryView } from '@/lib/trajectory-view/feed';
import type { TrajectoryEventV2 } from '@/lib/trajectory-assembler';
import { sessionFromTrajectory } from '@/stores/session-activity';
import type { ObservabilityTrajectoryHistoryPage, ObservabilityTrajectorySupplyEvent } from '@shared/types/observability';

function row(seq: number, phase: 'start' | 'end' = 'start', runId = 'run-1'): Extract<TrajectoryEventV2, { role: 'run' }> {
  return { traceSchema: 'openclaw-trajectory', schemaVersion: 2, traceId: 'trace-1', source: 'runtime',
    ts: new Date(Date.parse('2026-11-07T00:00:00Z') + seq * 1000).toISOString(), seq,
    type: phase === 'start' ? 'run/start' : 'run/end', role: 'run', phase, runId,
    state: { status: phase === 'start' ? 'running' : 'completed' } };
}
function page(fromSeq: number, events: TrajectoryEventV2[], extra: Partial<ObservabilityTrajectoryHistoryPage<TrajectoryEventV2>> = {}): ObservabilityTrajectoryHistoryPage<TrajectoryEventV2> {
  return { sessionKey: 'session-a', schemaVersion: 2, fromSeq, events, asOfSeq: events.at(-1)?.seq ?? fromSeq,
    hasMore: false, legacyFallback: false, rejected: 0, ...extra };
}
function setup(history: (input: { sessionKey: string; fromSeq: number; limit: number }) => Promise<ObservabilityTrajectoryHistoryPage<TrajectoryEventV2>>) {
  let receive: (event: ObservabilityTrajectorySupplyEvent<TrajectoryEventV2>) => void = () => {};
  let view!: TrajectoryView;
  const query = vi.fn(history);
  const feed = new TrajectoryViewFeed({ history: query, subscribe: (handler) => { receive = handler; return () => {}; } });
  const stop = feed.connect('session-a', (next) => { view = next; });
  return { feed, query, stop, view: () => view,
    emit: (events: TrajectoryEventV2[], sessionKey = 'session-a') => receive({ schemaVersion: 2, sessionKey, events }) };
}

describe('production trajectory view supply', () => {
  it.each([
    [{ status: 'interrupted', timedOut: true }, 'failed'],
    [{ status: 'interrupted', externalAbort: true }, 'aborted'],
    [{ status: 'success' }, 'completed'],
    [{ status: 'unclassified' }, 'idle'],
  ] as const)('uses the runtime terminal state %j without inventing completion', async (state, status) => {
    const h = setup(async () => page(0, [row(1), { ...row(2, 'end'), state: { ...state } }]));
    await h.feed.refresh('session-a');
    expect(sessionFromTrajectory(h.view()).status).toBe(status);
    h.stop();
  });
  it('joins paged history and buffered realtime at asOfSeq without applying a duplicate', async () => {
    let release!: (value: ObservabilityTrajectoryHistoryPage<TrajectoryEventV2>) => void;
    const pending = new Promise<ObservabilityTrajectoryHistoryPage<TrajectoryEventV2>>((resolve) => { release = resolve; });
    const h = setup(async ({ fromSeq }) => fromSeq === 0 ? pending : page(fromSeq, [row(2, 'end')]));
    h.emit([row(2, 'end')]);
    release(page(0, [row(1)], { hasMore: true }));
    await h.feed.refresh('session-a');
    h.emit([row(2, 'end')]);
    expect(h.query.mock.calls.map(([input]) => input.fromSeq)).toEqual([0, 1]);
    expect(h.view().lastSeq).toBe(2);
    expect(h.view().nodes).toHaveLength(1);
    expect(sessionFromTrajectory(h.view())).toMatchObject({ runId: 'run-1', status: 'completed',
      startedAt: Date.parse(row(1).ts), endedAt: Date.parse(row(2).ts) });
    h.stop();
  });

  it('repairs a realtime sequence gap through the existing history entrypoint', async () => {
    const h = setup(async ({ fromSeq }) => fromSeq === 0 ? page(0, [row(1)]) : page(fromSeq, [row(2, 'end'), row(3, 'start', 'run-2')]));
    await h.feed.refresh('session-a');
    h.emit([row(3, 'start', 'run-2')]);
    expect(h.view().lastSeq).toBe(1);
    await h.feed.refresh('session-a');
    expect(h.query.mock.calls[1][0].fromSeq).toBe(1);
    expect(h.view().lastSeq).toBe(3);
    expect(sessionFromTrajectory(h.view())).toMatchObject({ runId: 'run-2', status: 'running' });
    h.stop();
  });

  it('repairs a gap that arrives during the cold history request', async () => {
    let release!: (value: ObservabilityTrajectoryHistoryPage<TrajectoryEventV2>) => void;
    const pending = new Promise<ObservabilityTrajectoryHistoryPage<TrajectoryEventV2>>((resolve) => { release = resolve; });
    const h = setup(async ({ fromSeq }) => fromSeq === 0 ? pending : page(fromSeq, [row(2, 'end'), row(3, 'start', 'run-2')]));
    h.emit([row(3, 'start', 'run-2')]);
    release(page(0, [row(1)]));
    await h.feed.refresh('session-a');
    await vi.waitFor(() => expect(h.view().lastSeq).toBe(3));
    expect(h.query).toHaveBeenCalledTimes(2);
    h.stop();
  });

  it('assembles run, turn, step and tool identities from the original v2 rows', async () => {
    const base = row(1);
    const events: TrajectoryEventV2[] = [base,
      { ...base, seq: 2, type: 'turn/start', role: 'turn', phase: 'start', turnId: 'turn-1' },
      { ...base, seq: 3, type: 'step/start', role: 'step', phase: 'start', turnId: 'turn-1', stepId: 'step-1' },
      { ...base, seq: 4, type: 'tool/start', role: 'tool', phase: 'start', turnId: 'turn-1', stepId: 'step-1', toolCallId: 'tool-1' },
      { ...base, seq: 5, type: 'tool/end', role: 'tool', phase: 'end', turnId: 'turn-1', stepId: 'step-1', toolCallId: 'tool-1', state: { status: 'completed' } },
      row(6, 'end')];
    const h = setup(async () => page(0, events));
    await h.feed.refresh('session-a');
    expect(h.view().nodes.map((node) => [node.data.role, node.data.status])).toEqual([
      ['run', 'completed'], ['turn', 'running'], ['step', 'running'], ['tool', 'completed'],
    ]);
    h.stop();
  });

  it('does not apply another session or a response returned after disposal', async () => {
    let release!: (value: ObservabilityTrajectoryHistoryPage<TrajectoryEventV2>) => void;
    const pending = new Promise<ObservabilityTrajectoryHistoryPage<TrajectoryEventV2>>((resolve) => { release = resolve; });
    const h = setup(() => pending);
    h.emit([row(1)], 'session-b');
    expect(h.view().lastSeq).toBe(0);
    const loading = h.feed.refresh('session-a');
    h.stop();
    release(page(0, [row(1)]));
    await loading;
    expect(h.view().lastSeq).toBe(0);
  });

  it('keeps legacy or empty supply idle instead of reconstructing runtime lifecycle', async () => {
    const h = setup(async () => page(0, [], { legacyFallback: true }));
    await h.feed.refresh('session-a');
    expect(h.view().legacyFallback).toBe(true);
    expect(sessionFromTrajectory(h.view())).toMatchObject({ runId: null, status: 'idle', updatedAt: 0 });
    h.stop();
  });

  it('rejects a history response for the wrong session', async () => {
    const h = setup(async () => page(0, [row(1)], { sessionKey: 'session-b' }));
    await h.feed.refresh('session-a');
    expect(h.view()).toMatchObject({ error: true, lastSeq: 0 });
    expect(h.view().nodes).toEqual([]);
    h.stop();
  });

  it('does not skip an unresolved history gap or spin on a stuck pagination cursor', async () => {
    const h = setup(async ({ fromSeq }) => fromSeq === 0 ? page(0, [row(1)])
      : page(fromSeq, [], { hasMore: true, asOfSeq: fromSeq }));
    await h.feed.refresh('session-a');
    h.emit([row(3, 'end')]);
    await h.feed.refresh('session-a');
    expect(h.view()).toMatchObject({ lastSeq: 1, error: true, loading: false });
    expect(h.query).toHaveBeenCalledTimes(2);
    h.stop();
  });
});
