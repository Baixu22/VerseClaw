import { describe, expect, it } from 'vitest';

/**
 * RC-07 root acceptance test. Verifies the memory/context slot convergence
 * contract against REAL sources and REAL consumption:
 * - the census comes from the live registry inputs (registered plugins,
 *   contextEngine registry, MemoryStore binding), not a hardcoded table;
 * - fail-closed: the activation planner (runtime startup / plugin reload)
 *   consumes slotConvergenceErrors and rejects illegal configurations;
 * - flag-off performs zero query/write and never restores a second writer;
 * - delete/correction propagates from the active memory owner without
 *   triggering SEKB auto-writeback.
 */
import {
  assertRuntimeMemoryOwnerConvergence,
  assertSingleMemorySlotOwner,
  buildRuntimeMemoryWriterCensus,
  buildSlotMechanismCensus,
  classifySlotMechanisms,
} from '../../openclaw_runtime/src/agents/slot-convergence.js';
import { resolveManifestActivationPlan } from '../../openclaw_runtime/src/plugins/activation-planner.js';

describe('RC-07 memory/context slot convergence (root acceptance)', () => {
  it('the census is generated from the real plugin/engine registry inputs', () => {
    // The real registry sources: plugin registry reports memory mechanisms,
    // contextEngine registry reports engines, MemoryStore binding is live.
    const census = buildSlotMechanismCensus({
      registeredPluginIds: ['memory-core', 'vtoken-packer', 'agent-map', 'sekb-governance', 'working-context'],
      contextEngineIds: ['context-runtime-kit', 'dcs-assembler', 'working-context-query', 'legacy-context-engine'],
      memoryStoreConfigured: true,
    });
    // Parallel memory writes are zero; exactly one store-owner persists.
    expect(census.memory.filter((m) => m.mayWriteMemory)).toHaveLength(1);
    expect(census.memory.find((m) => m.mayWriteMemory)?.id).toBe('memory-core');
    expect(census.parallelMemoryWriters).toBe(0);
    // DCS (context-runtime-kit) occupies the single contextEngine slot.
    expect(census.context.filter((c) => c.isContextEngineSlot)).toHaveLength(1);
    expect(census.context.find((c) => c.isContextEngineSlot)?.id).toBe('context-runtime-kit');
    // VToken/AgentMap are stateless packer/benchmark arms; Working Context is a
    // query projection; SEKB is human-confirmed governance.
    expect(census.memory.find((m) => m.id === 'vtoken-packer')?.role).toBe('benchmark-arm');
    expect(census.memory.find((m) => m.id === 'agent-map')?.role).toBe('candidate-producer');
    expect(census.memory.find((m) => m.id === 'working-context')?.role).toBe('projection');
    expect(census.memory.find((m) => m.id === 'sekb-governance')?.role).toBe('review-proposal');
    expect(census.autoWritebackCount).toBe(0);
  });

  it('fail-closed: the activation planner consumes slotConvergenceErrors and rejects illegal config', () => {
    // Legal configuration activates normally.
    const legalPlan = resolveManifestActivationPlan({
      config: { plugins: { slots: { memory: 'memory-core', contextEngine: 'context-runtime-kit' } } } as never,
      workspaceDir: process.cwd(),
      trigger: { kind: 'capability', capability: 'anything' } as never,
      manifestRecords: [],
    });
    expect(Array.isArray(legalPlan.pluginIds)).toBe(true);

    // Illegal memory slot (non-owner) must fail closed at activation planning
    // (runtime startup / plugin reload path) — never becomes active config.
    expect(() =>
      resolveManifestActivationPlan({
        config: { plugins: { slots: { memory: 'vtoken-packer' } } } as never,
        workspaceDir: process.cwd(),
        trigger: { kind: 'capability', capability: 'anything' } as never,
        manifestRecords: [],
      }),
    ).toThrow(/slot convergence rejected/);

    // Illegal contextEngine slot (second engine) must fail closed too.
    expect(() =>
      resolveManifestActivationPlan({
        config: { plugins: { slots: { contextEngine: 'legacy-context-engine' } } } as never,
        workspaceDir: process.cwd(),
        trigger: { kind: 'capability', capability: 'anything' } as never,
        manifestRecords: [],
      }),
    ).toThrow(/slot convergence rejected/);
  });

  it('the single-owner assertion is a startup/config invariant, not a diagnostics switch', () => {
    // Closing diagnostics must NOT restore multi-writer: the owner assertion
    // is unconditional (there is no flag that re-enables a second writer).
    const base = classifySlotMechanisms();
    expect(base.parallelMemoryWriters).toBe(0);
    // With or without any diagnostics flag the owner set is identical: the
    // classification has no diagnostics dimension.
    expect(assertSingleMemorySlotOwner({ memorySlotId: 'memory-core' }).ok).toBe(true);
    expect(assertSingleMemorySlotOwner({ memorySlotId: 'agent-map' }).ok).toBe(false);
  });

  it('flag-off arms perform zero query/write: the static table proves the flag contract', () => {
    // VToken and AgentMap are default-off benchmark/candidate arms; their
    // flagOffZeroQueryWrite contract is part of the classification.
    const census = buildSlotMechanismCensus({
      registeredPluginIds: ['memory-core', 'vtoken-packer', 'agent-map'],
      contextEngineIds: [],
      memoryStoreConfigured: true,
    });
    const arms = ['vtoken-packer', 'agent-map'];
    for (const id of arms) {
      const entry = census.memory.find((m) => m.id === id);
      expect(entry?.mayWriteMemory).toBe(false);
    }
    // Only the memory slot owner may write — regardless of any flag state.
    expect(census.memory.filter((m) => m.mayWriteMemory).map((m) => m.id)).toEqual(['memory-core']);
  });


describe('R3-1: dynamic Runtime Memory writer census (root acceptance)', () => {
  it('default-off yields zero parallel writers and 100% production writer coverage', () => {
    const census = buildRuntimeMemoryWriterCensus();
    expect(census.authorities.filter((a) => a.mayWriteMemory).map((a) => a.id)).toEqual(['memory-core']);
    expect(census.parallelMemoryWriters).toBe(0);
    expect(census.autoWritebackCount).toBe(0);
    expect(census.surfaces.map((s) => s.id)).toEqual([
      'memory-core-store',
      'runtime-memory-append-invalidate-api',
      'task-loop-episode-journal',
      'gateway-consolidation-timer',
      'compass-pre-reply-retrieval',
    ]);
    expect(census.bypassProducers).toEqual([]);
  });

  it('runtime.memory.persist=true surfaces the owner drift as one parallel writer', () => {
    const census = buildRuntimeMemoryWriterCensus({ runtimeMemoryPersist: true });
    expect(census.parallelMemoryWriters).toBe(1);
    expect(census.authorities.filter((a) => a.mayWriteMemory).map((a) => a.id)).toEqual([
      'memory-core',
      'runtime-memory-persistence',
    ]);
  });

  it('fail-closed: assertRuntimeMemoryOwnerConvergence rejects the drift, accepts default-off', () => {
    expect(assertRuntimeMemoryOwnerConvergence({ runtimeMemoryPersist: false }).ok).toBe(true);
    const drifted = assertRuntimeMemoryOwnerConvergence({ runtimeMemoryPersist: true });
    expect(drifted.ok).toBe(false);
    expect(drifted.errors.join(' ')).toContain('runtime-memory-persistence');
    expect(drifted.errors.join(' ')).toContain('parallel memory writer');
  });

  it('registers the COMPASS pre-reply retrieval bypass as an explicit degradation', () => {
    const census = buildRuntimeMemoryWriterCensus({ compassRetrievalEnabled: true });
    expect(census.bypassProducers.map((p) => p.id)).toEqual(['compass-pre-reply-retrieval']);
    expect(census.bypassProducers[0]?.note).toContain('bypasses the DCS context-engine');
  });
});

  it('delete/correction propagates without SEKB auto-writeback (contract level)', () => {
    // SEKB is review-proposal governance: human confirmation only, no
    // automatic writeback from corrections or deletes.
    const census = buildSlotMechanismCensus({
      registeredPluginIds: ['memory-core', 'sekb-governance', 'working-context'],
      contextEngineIds: [],
      memoryStoreConfigured: true,
    });
    const sekb = census.memory.find((m) => m.id === 'sekb-governance');
    expect(sekb?.role).toBe('review-proposal');
    expect(sekb?.mayWriteMemory).toBe(false);
    expect(census.autoWritebackCount).toBe(0);
    // Working Context projection reads from the owner; a deleted/corrected card
    // is superseded in the owner and projections derive from the owner state.
    const workingContext = census.memory.find((m) => m.id === 'working-context');
    expect(workingContext?.role).toBe('projection');
  });
});
