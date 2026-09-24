import { describe, expect, it } from 'vitest';

import {
  assertSingleContextEngineSlot,
  assertSingleMemorySlotOwner,
  buildSlotMechanismCensus,
  RC07_CONTEXT_MECHANISMS,
  RC07_MEMORY_MECHANISMS,
} from './slot-convergence.js';

const MEMORY_PLUGINS = [
  { id: 'memory-core', kind: 'memory' },
  { id: 'memory-lancedb', kind: 'memory' },
  { id: 'dual-memory-context', kind: ['memory', 'context-engine'] },
  { id: 'browser', kind: undefined },
] as const;

describe('RC-07 memory/context slot convergence', () => {
  it('classifies the non-plugin memory mechanisms into non-owner roles', () => {
    const role = (id: string) => RC07_MEMORY_MECHANISMS.find((m) => m.id === id);
    expect(role('vtoken-packer')).toMatchObject({ role: 'benchmark-arm', mayWriteMemory: false, flagOffZeroQueryWrite: true });
    expect(role('agent-map')).toMatchObject({ role: 'candidate-producer', mayWriteMemory: false, flagOffZeroQueryWrite: true });
    expect(role('sekb-governance')).toMatchObject({ role: 'review-proposal', mayWriteMemory: false, autoWriteback: false });
    expect(role('working-context')).toMatchObject({ role: 'projection', mayWriteMemory: false });
  });

  it('the memory slot accepts any single store owner and rejects classified non-owners', () => {
    expect(assertSingleMemorySlotOwner({ memorySlotId: 'memory-core' }).ok).toBe(true);
    expect(assertSingleMemorySlotOwner({ memorySlotId: 'memory-lancedb' }).ok).toBe(true);
    expect(assertSingleMemorySlotOwner({ memorySlotId: null }).ok).toBe(true);
    for (const id of ['vtoken-packer', 'agent-map', 'sekb-governance', 'working-context']) {
      const result = assertSingleMemorySlotOwner({ memorySlotId: id });
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain('must select a store owner');
    }
    expect(assertSingleMemorySlotOwner({ memorySlotId: 'runtime-memory' }).ok).toBe(false);
    expect(assertSingleMemorySlotOwner({ memorySlotId: 'runtime-memory', runtimeMemoryPersist: true }).ok).toBe(true);
  });

  it('the census derives writers from declared kind and the slot selection', () => {
    const lancedb = buildSlotMechanismCensus({ registeredPlugins: MEMORY_PLUGINS, memorySlotId: 'memory-lancedb' });
    expect(lancedb.memory.map((m) => m.id)).toEqual(['memory-core', 'memory-lancedb', 'dual-memory-context']);
    expect(lancedb.memory.filter((m) => m.mayWriteMemory).map((m) => m.id)).toEqual(['memory-lancedb']);
    expect(lancedb.memory.find((m) => m.id === 'memory-core')?.role).toBe('candidate-producer');
    expect(lancedb.parallelMemoryWriters).toBe(0);

    const dual = buildSlotMechanismCensus({ registeredPlugins: MEMORY_PLUGINS, memorySlotId: 'dual-memory-context' });
    expect(dual.memory.filter((m) => m.mayWriteMemory).map((m) => m.id)).toEqual(['dual-memory-context']);

    const disabled = buildSlotMechanismCensus({ registeredPlugins: MEMORY_PLUGINS, memorySlotId: null });
    expect(disabled.memory.filter((m) => m.mayWriteMemory)).toEqual([]);
    expect(disabled.parallelMemoryWriters).toBe(0);

    const defaultSlot = buildSlotMechanismCensus({ registeredPlugins: MEMORY_PLUGINS });
    expect(defaultSlot.memory.filter((m) => m.mayWriteMemory).map((m) => m.id)).toEqual(['memory-core']);
  });

  it('runtime-memory owns the slot only with persistence on', () => {
    const on = buildSlotMechanismCensus({ registeredPlugins: MEMORY_PLUGINS, memorySlotId: 'runtime-memory', runtimeMemoryPersist: true });
    expect(on.memory.filter((m) => m.mayWriteMemory).map((m) => m.id)).toEqual(['runtime-memory']);
    const off = buildSlotMechanismCensus({ registeredPlugins: MEMORY_PLUGINS, memorySlotId: 'runtime-memory' });
    expect(off.memory.filter((m) => m.mayWriteMemory)).toEqual([]);
  });

  it('SEKB auto-writeback is zero (human-confirmed governance only)', () => {
    expect(buildSlotMechanismCensus({ registeredPlugins: [] }).autoWritebackCount).toBe(0);
  });

  it('asserts the single contextEngine slot (CRK default, DCS assembly inside it)', () => {
    const ok = assertSingleContextEngineSlot({});
    expect(ok.ok).toBe(true);
    expect(ok.resolvedId).toBe('context-runtime-kit');
    expect(assertSingleContextEngineSlot({ contextEngineId: 'context-runtime-kit' }).ok).toBe(true);
    const rejected = assertSingleContextEngineSlot({ contextEngineId: 'legacy-context-engine' });
    expect(rejected.ok).toBe(false);
    expect(rejected.errors.join(' ')).toContain('non-owner');
    expect(RC07_CONTEXT_MECHANISMS.filter((c) => c.isContextEngineSlot).map((c) => c.id)).toEqual(['context-runtime-kit']);
  });

  it('the census classifies the configured context engine', () => {
    const census = buildSlotMechanismCensus({ registeredPlugins: [], contextEngineIds: ['context-runtime-kit'] });
    expect(census.context).toEqual([{ id: 'context-runtime-kit', role: 'store-owner', isContextEngineSlot: true }]);
  });
});
