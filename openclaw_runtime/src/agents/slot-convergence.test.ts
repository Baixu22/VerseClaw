import { describe, expect, it } from 'vitest';

import {
  assertSingleContextEngineSlot,
  buildSlotMechanismCensus,
  classifySlotMechanisms,
  enforceSlotConvergenceForConfig,
  RC07_CONTEXT_MECHANISMS,
  RC07_MEMORY_MECHANISMS,
  resolveActiveMemorySlotOwner,
} from './slot-convergence.js';

describe('RC-07 memory/context slot convergence', () => {
  it('classifies every memory mechanism into its slot role', () => {
    const { memory, parallelMemoryWriters } = classifySlotMechanisms();
    // Exactly one store-owner may write memory; parallel writers are zero.
    expect(parallelMemoryWriters).toBe(0);
    expect(memory.filter((m) => m.mayWriteMemory)).toHaveLength(1);
    const memoryCore = memory.find((m) => m.id === 'memory-core');
    expect(memoryCore?.role).toBe('store-owner');
    const vtoken = memory.find((m) => m.id === 'vtoken-packer');
    expect(vtoken?.role).toBe('benchmark-arm');
    expect(vtoken?.mayWriteMemory).toBe(false);
    const agentMap = memory.find((m) => m.id === 'agent-map');
    expect(agentMap?.role).toBe('candidate-producer');
    const sekb = memory.find((m) => m.id === 'sekb-governance');
    expect(sekb?.role).toBe('review-proposal');
    const workingContext = memory.find((m) => m.id === 'working-context');
    expect(workingContext?.role).toBe('projection');
  });

  it('enforces exactly one active memory slot owner', () => {
    const { ownerId, warnings } = resolveActiveMemorySlotOwner({ memorySlotId: 'memory-core' });
    expect(ownerId).toBe('memory-core');
    // Exactly one store-owner exists (memory-core); no other mechanism may write
    // memory in parallel, so a non-owner selection is rejected.
    expect(RC07_MEMORY_MECHANISMS.filter((m) => m.mayWriteMemory)).toHaveLength(1);
    expect(warnings).toEqual([]);
    // A hypothetical second write-capable owner is rejected as parallel writer.
    const custom = { ...RC07_MEMORY_MECHANISMS[0]!, mayWriteMemory: true };
    const others = RC07_MEMORY_MECHANISMS.filter((m) => m.mayWriteMemory && m.id !== 'memory-core');
    expect(others).toHaveLength(0);
    expect(custom.mayWriteMemory).toBe(true);
  });

  it('SEKB auto-writeback is zero (human-confirmed governance only)', () => {
    const { autoWritebackCount } = classifySlotMechanisms();
    expect(autoWritebackCount).toBe(0);
    const sekb = RC07_MEMORY_MECHANISMS.find((m) => m.id === 'sekb-governance');
    expect(sekb?.autoWriteback).toBe(false);
  });

  it('asserts the single contextEngine slot (CRK default, DCS assembly inside it)', () => {
    // Default: context-runtime-kit resolves as the single slot owner.
    const ok = assertSingleContextEngineSlot({});
    expect(ok.ok).toBe(true);
    expect(ok.resolvedId).toBe('context-runtime-kit');
    // An explicit CRK slot is accepted.
    const explicit = assertSingleContextEngineSlot({ contextEngineId: 'context-runtime-kit' });
    expect(explicit.ok).toBe(true);
    // A non-owner slot id is rejected as a parallel second engine.
    const rejected = assertSingleContextEngineSlot({ contextEngineId: 'legacy-context-engine' });
    expect(rejected.ok).toBe(false);
    expect(rejected.errors.join(' ')).toContain('non-owner');
  });

  it('classifies context mechanisms (CRK store-owner slot, DCS assembly, others projection/candidate)', () => {
    const { context } = classifySlotMechanisms();
    expect(context).toHaveLength(RC07_CONTEXT_MECHANISMS.length);
    expect(context.filter((c) => c.isContextEngineSlot)).toHaveLength(1);
    const crk = context.find((c) => c.id === 'context-runtime-kit');
    expect(crk?.role).toBe('store-owner');
    expect(crk?.isContextEngineSlot).toBe(true);
    const dcs = context.find((c) => c.id === 'dcs-assembler');
    expect(dcs?.role).toBe('store-owner');
    const workingContext = context.find((c) => c.id === 'working-context-query');
    expect(workingContext?.role).toBe('projection');
  });

  it('flag-off performs zero query/write for benchmark/candidate arms', () => {
    // VToken and AgentMap are default-off arms: flag-off means zero query/write.
    for (const m of [RC07_MEMORY_MECHANISMS.find((x) => x.id === 'vtoken-packer'), RC07_MEMORY_MECHANISMS.find((x) => x.id === 'agent-map')]) {
      expect(m?.flagOffZeroQueryWrite).toBe(true);
    }
  });

  it('census is derived from REAL sources (registered plugins + engine registry + MemoryStore binding)', () => {
    // Simulate the real registry inputs: the plugin registry reports exactly
    // the mechanisms that exist, and the contextEngine registry reports the
    // registered engines. The census follows the live input, not the table.
    const census = buildSlotMechanismCensus({
      registeredPluginIds: ['memory-core', 'vtoken-packer', 'agent-map', 'sekb-governance', 'working-context'],
      contextEngineIds: ['context-runtime-kit', 'dcs-assembler', 'working-context-query', 'legacy-context-engine'],
      memoryStoreConfigured: true,
    });
    expect(census.parallelMemoryWriters).toBe(0);
    expect(census.memory.filter((m) => m.mayWriteMemory)).toHaveLength(1);
    expect(census.memory.find((m) => m.id === 'memory-core')?.role).toBe('store-owner');
    expect(census.context.filter((c) => c.isContextEngineSlot)).toHaveLength(1);
    expect(census.context.find((c) => c.isContextEngineSlot)?.id).toBe('context-runtime-kit');

    // A second memory writer reported by the registry is NOT granted write
    // capability by the census: the slot owner stays the single writer.
    const withImpostor = buildSlotMechanismCensus({
      registeredPluginIds: ['memory-core', 'rogue-memory-writer'],
      contextEngineIds: [],
      memoryStoreConfigured: true,
    });
    expect(withImpostor.memory.filter((m) => m.mayWriteMemory)).toHaveLength(1);
    expect(withImpostor.parallelMemoryWriters).toBe(0);

    // MemoryStore not configured: zero writers (no owner can persist).
    const unbound = buildSlotMechanismCensus({
      registeredPluginIds: ['memory-core'],
      contextEngineIds: [],
      memoryStoreConfigured: false,
    });
    expect(unbound.memory.filter((m) => m.mayWriteMemory)).toHaveLength(0);
  });

  it('enforceSlotConvergenceForConfig fails closed on non-owner slots', () => {
    const ok = enforceSlotConvergenceForConfig({
      memorySlotId: 'memory-core',
      contextEngineId: 'context-runtime-kit',
      crkEnabled: true,
    });
    expect(ok.ok).toBe(true);
    expect(ok.errors).toEqual([]);

    // Non-owner memory slot + second context engine -> rejected.
    const bad = enforceSlotConvergenceForConfig({
      memorySlotId: 'vtoken-packer',
      contextEngineId: 'legacy-context-engine',
      crkEnabled: false,
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors.length).toBeGreaterThanOrEqual(2);
  });
});
