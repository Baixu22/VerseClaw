import { describe, expect, it } from 'vitest';
import { clearRuntimeTraceBuffer, getRuntimeTraceBuffer, storeRuntimeTrace } from '../../openclaw_runtime/src/observability/trace-buffer';
import type { ObservabilityTrace } from '../../openclaw_runtime/src/observability/types';

function trace(id: string, startedAt: number): ObservabilityTrace {
  return {
    id,
    name: id,
    status: 'completed',
    startedAt,
    spans: [],
    events: [],
    tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 },
    metrics: {},
    tags: [],
  };
}

describe('runtime observability trace buffer', () => {
  it('returns newest traces first by startedAt', () => {
    clearRuntimeTraceBuffer();

    storeRuntimeTrace(trace('older', 100));
    storeRuntimeTrace(trace('newest', 300));
    storeRuntimeTrace(trace('middle', 200));

    expect(getRuntimeTraceBuffer().map((item) => item.id)).toEqual(['newest', 'middle', 'older']);
    clearRuntimeTraceBuffer();
  });
});
