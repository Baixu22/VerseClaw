import { describe, expect, it } from 'vitest';
import type { ChatRuntimeEvent } from '../../shared/chat-runtime-events';
import { applyRuntimeEventToRuns } from '../../src/stores/chat/runtime-graph';

describe('runtime stream sequence and terminal boundaries', () => {
  it('ignores non-adjacent duplicate sequence events before appending text', () => {
    const a: ChatRuntimeEvent = { type: 'assistant.delta', runId: 'run', seq: 1, delta: 'a' };
    let runs = applyRuntimeEventToRuns({}, a);
    runs = applyRuntimeEventToRuns(runs, { ...a, seq: 2, delta: 'b' });
    expect(applyRuntimeEventToRuns(runs, a)).toBe(runs);
    expect(runs.run.assistantText).toBe('ab');
  });
  it('keeps the latest cumulative text when an older sequence arrives', () => {
    const runs = applyRuntimeEventToRuns({}, { type: 'assistant.delta', runId: 'run', seq: 3, text: 'abc' });
    expect(applyRuntimeEventToRuns(runs, { type: 'assistant.delta', runId: 'run', seq: 2, text: 'ab' })).toBe(runs);
  });
  it('preserves repeated legitimate chunks without sequence identities', () => {
    const event: ChatRuntimeEvent = { type: 'assistant.delta', runId: 'run', delta: 'ha' };
    const runs = applyRuntimeEventToRuns(applyRuntimeEventToRuns({}, event), event);
    expect(runs.run.assistantText).toBe('haha');
  });
  it.each(['completed', 'error', 'aborted'] as const)('keeps %s runs terminal when delayed starts or deltas arrive', status => {
    const runs = applyRuntimeEventToRuns({}, { type: 'run.ended', runId: 'run', seq: 3, status });
    expect(applyRuntimeEventToRuns(runs, { type: 'run.started', runId: 'run', seq: 1 })).toBe(runs);
    expect(applyRuntimeEventToRuns(runs, { type: 'assistant.delta', runId: 'run', seq: 4, delta: 'late' })).toBe(runs);
  });
  it('allows an explicit empty cumulative replacement', () => {
    const runs = applyRuntimeEventToRuns({}, { type: 'assistant.delta', runId: 'run', seq: 1, text: 'old' });
    expect(applyRuntimeEventToRuns(runs, { type: 'assistant.delta', runId: 'run', seq: 2, text: '', replace: true }).run.assistantText).toBe('');
  });
});
