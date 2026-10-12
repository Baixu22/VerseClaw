/**
 * The registry read path is deliberately fail-open: `query()` yields [] and
 * `get()` yields undefined when the store (or id normalization) throws. That
 * keeps callers working, but it made "the read failed" indistinguishable from
 * "there is nothing" — the silent absence this batch removes elsewhere. The
 * counter is what distinguishes them.
 */
import { describe, expect, it } from 'vitest';
import { dcsObservability } from '../dcs-observability.js';
import { ContextItemRegistry, type ContextItemStore } from './context-item-registry.js';

function throwingStore(): ContextItemStore {
  return {
    queryItems: async () => {
      throw new Error('query failed');
    },
    getItem: async () => {
      throw new Error('get failed');
    },
  } as unknown as ContextItemStore;
}

describe('context item registry read failures', () => {
  it('keeps the fail-open result but counts query and get failures', async () => {
    const registry = new ContextItemRegistry({ store: throwingStore() });
    const before = dcsObservability.snapshot().contextItemReadFailures;

    await expect(registry.query({})).resolves.toEqual([]);
    await expect(registry.get('ctx:item-1')).resolves.toBeUndefined();

    expect(dcsObservability.snapshot().contextItemReadFailures - before).toBe(2);
  });

  it('does not count successful reads', async () => {
    const registry = new ContextItemRegistry();
    const before = dcsObservability.snapshot().contextItemReadFailures;

    await registry.query({});
    // A valid id form the store simply has no row for: not a failure.\n    await registry.get('ctx:missing-item');

    expect(dcsObservability.snapshot().contextItemReadFailures - before).toBe(0);
  });
});