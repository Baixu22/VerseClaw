import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatRuntimeEvent } from '../../shared/chat-runtime-events';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/stores/gateway', () => ({ useGatewayStore: { getState: () => ({ rpc, status: { state: 'running' } }) } }));
vi.mock('@/stores/agents', () => ({ useAgentsStore: { getState: () => ({ agents: [] }) } }));
vi.mock('@/lib/host-api', () => ({ hostApi: { taskLedger: { appendEvents: vi.fn() } } }));

const sessionKey = 'agent:main:stream-publication';
let store: typeof import('@/stores/chat').useChatStore;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
const subscriptions: Array<() => void> = [];
function observe() { const listener = vi.fn(); subscriptions.push(store.subscribe(listener)); return listener; }
function frame() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(16)); }
function delta(seq: number, text = String(seq)) {
  store.getState().handleRuntimeEvent({ type: 'assistant.delta', sessionKey, runId: 'live', seq, delta: text });
}

beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); window.localStorage.clear();
  frames = new Map(); nextFrame = 0; rpc.mockReset().mockResolvedValue({ aborted: true, runIds: ['live'] });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  store = (await import('@/stores/chat')).useChatStore;
  store.setState({ currentSessionKey: sessionKey, messages: [{ role: 'user', content: 'Run' }],
    sending: true, activeRunId: 'live', runtimeRuns: {}, error: null, runError: null,
    loadHistory: vi.fn().mockResolvedValue(undefined) });
  store.getState().handleRuntimeEvent({ type: 'run.started', sessionKey, runId: 'live', seq: 0 });
});
afterEach(() => { subscriptions.splice(0).forEach(unsubscribe => unsubscribe()); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('production chat stream publication', () => {
  it('publishes a burst once per frame while reads see every delta immediately', () => {
    const listener = observe();
    for (let seq = 1; seq <= 200; seq++) delta(seq, 'x');
    expect(store.getState().runtimeRuns.live.assistantText).toBe('x'.repeat(200));
    expect(listener).not.toHaveBeenCalled(); expect(frames.size).toBe(1);
    frame(); expect(listener).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('coalesces legacy cumulative text without losing the latest snapshot', () => {
    const listener = observe();
    for (let seq = 1; seq <= 2; seq++) store.getState().handleChatEvent({ state: 'delta', sessionKey, runId: 'live', seq,
      message: { role: 'assistant', content: 'x'.repeat(seq) } });
    expect(store.getState().streamingMessage).toMatchObject({ content: 'xx' });
    expect(listener).not.toHaveBeenCalled(); frame(); expect(listener).toHaveBeenCalledOnce();
  });

  it.each<ChatRuntimeEvent>([
    { type: 'approval.updated', runId: 'live', sessionKey, seq: 2, status: 'pending', toolCallId: 'approval' },
    { type: 'run.ended', runId: 'live', sessionKey, seq: 2, status: 'completed' },
    { type: 'run.ended', runId: 'live', sessionKey, seq: 2, status: 'error', error: 'failure' },
    { type: 'run.ended', runId: 'live', sessionKey, seq: 2, status: 'aborted' },
  ])('immediately publishes $type $status with the pending text included', event => {
    const listener = observe(); delta(1, 'before control');
    store.getState().handleRuntimeEvent(event);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].runtimeRuns.live.assistantText).toBe('before control');
    expect(frames.size).toBe(0); frame(); expect(listener).toHaveBeenCalledOnce();
  });

  it('publishes confirmed abort immediately and cancels a pending frame', async () => {
    const listener = observe(); delta(1);
    await store.getState().abortRun();
    expect(rpc).toHaveBeenCalledWith('chat.abort', { sessionKey });
    expect(listener).toHaveBeenCalledOnce(); expect(store.getState().sending).toBe(false);
    expect(frames.size).toBe(0); frame(); expect(store.getState().activeRunId).toBeNull();
    delta(2, 'late runtime text'); frame();
    expect(store.getState().sending).toBe(false); expect(store.getState().activeRunId).toBeNull();
    expect(store.getState().runtimeRuns.live.status).toBe('aborted');
    expect(store.getState().runtimeRuns.live.assistantText).toBe('1');
  });

  it('does not revive a terminal owner through a delayed legacy delta', () => {
    store.getState().handleRuntimeEvent({ type: 'run.ended', sessionKey, runId: 'live', seq: 2, status: 'aborted' });
    const listener = observe();
    store.getState().handleChatEvent({ state: 'delta', sessionKey, runId: 'live', seq: 3,
      message: { role: 'assistant', content: 'late' } });
    expect(listener).not.toHaveBeenCalled(); expect(store.getState().streamingMessage).toBeNull();
    expect(store.getState().activeRunId).toBeNull(); expect(frames.size).toBe(0);
  });

  it('keeps a newly selected run intact while an earlier abort resolves', async () => {
    let resolve!: (result: unknown) => void;
    rpc.mockImplementation(() => new Promise(result => { resolve = result; }));
    const abort = store.getState().abortRun();
    store.setState({ currentSessionKey: 'agent:main:other', activeRunId: 'new', sending: true });
    resolve({ aborted: true, runIds: ['live'] }); await abort;
    expect(store.getState().activeRunId).toBe('new'); expect(store.getState().sending).toBe(true);
    expect(store.getState().runtimeRuns.live.status).toBe('aborted');
  });

  it('does not replace an owner result that arrives before the abort acknowledgement', async () => {
    let resolve!: (result: unknown) => void;
    rpc.mockImplementation(() => new Promise(result => { resolve = result; }));
    const abort = store.getState().abortRun();
    store.getState().handleRuntimeEvent({ type: 'run.ended', sessionKey, runId: 'live', seq: 1, status: 'completed' });
    resolve({ aborted: true, runIds: ['live'] }); await abort;
    expect(store.getState().runtimeRuns.live.status).toBe('completed');
  });

  it('retains running ownership when an abort request fails', async () => {
    rpc.mockRejectedValue(new Error('abort unavailable'));
    await store.getState().abortRun();
    expect(store.getState().sending).toBe(true);
    expect(store.getState().runtimeRuns.live.status).toBe('running');
  });

  it('publishes a session change immediately and retains foreign-run ownership', () => {
    const listener = observe(); delta(1);
    store.setState({ currentSessionKey: 'agent:main:other', activeRunId: null, sending: false });
    expect(listener).toHaveBeenCalledOnce(); expect(frames.size).toBe(0);
    delta(2); frame();
    expect(store.getState().runtimeRuns.live.sessionKey).toBe(sessionKey);
    expect(store.getState().currentSessionKey).toBe('agent:main:other');
    expect(store.getState().activeRunId).toBeNull(); expect(store.getState().sending).toBe(false);
  });

  it('publishes within the fallback bound when animation frames are suspended', async () => {
    const listener = observe(); delta(1);
    expect(listener).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(100);
    expect(listener).toHaveBeenCalledOnce(); expect(frames.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels pending publication when the final subscriber leaves', () => {
    const listener = observe(); delta(1); subscriptions.pop()!();
    expect(frames.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
    frame(); expect(listener).not.toHaveBeenCalled();
  });
  it('does not schedule unused publication work without subscribers', () => {
    delta(1); expect(store.getState().runtimeRuns.live.assistantText).toBe('1');
    expect(frames.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
});
