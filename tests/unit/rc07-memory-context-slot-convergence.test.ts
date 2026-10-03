import { describe, expect, it } from 'vitest';

/**
 * RC-07 root acceptance test against the real plugin manifest registry and the
 * real activation planner (the runtime startup / plugin reload path):
 * - memory writers are counted from the bundled manifests' declared kind and
 *   the slot selection, not from hardcoded ids;
 * - the planner fails closed on a non-owner memory slot or a second context
 *   engine, and accepts any single memory owner such as memory-lancedb;
 * - Runtime Memory persistence cannot become a second writer beside the slot.
 * Delete/correction propagation is proven by tf0018-correction-propagation.
 */
import {
  assertRuntimeMemoryOwnerConvergence,
  buildRuntimeMemoryWriterCensus,
  buildSlotMechanismCensus,
  RC07_MEMORY_MECHANISMS,
} from '../../openclaw_runtime/src/agents/slot-convergence.js';
import { createAgentMapContextProvider } from '../../openclaw_runtime/src/context-engine/agent-map-context-provider.js';
import { resolveManifestActivationPlan } from '../../openclaw_runtime/src/plugins/activation-planner.js';
import { loadPluginManifestRegistryForPluginRegistry } from '../../openclaw_runtime/src/plugins/plugin-registry-contributions.js';

const trigger = { kind: 'capability', capability: 'anything' } as never;
const plan = (plugins: Record<string, unknown>, runtime?: Record<string, unknown>) =>
  resolveManifestActivationPlan({
    config: { plugins, ...(runtime ? { runtime } : {}) } as never,
    workspaceDir: process.cwd(),
    trigger,
  });

const bundledManifests = () =>
  loadPluginManifestRegistryForPluginRegistry({
    config: {} as never,
    workspaceDir: process.cwd(),
    env: process.env,
    includeDisabled: true,
  }).plugins;

describe('RC-07 memory/context slot convergence (root acceptance)', () => {
  it('the census counts memory writers from the real bundled manifest registry', () => {
    const manifests = bundledManifests();
    const memoryKind = manifests
      .filter((plugin) => (Array.isArray(plugin.kind) ? plugin.kind.includes('memory') : plugin.kind === 'memory'))
      .map((plugin) => plugin.id);
    expect(memoryKind).toEqual(expect.arrayContaining(['memory-core', 'memory-lancedb']));

    const byDefault = buildSlotMechanismCensus({ registeredPlugins: manifests, memorySlotId: 'memory-core' });
    expect(byDefault.memory.filter((m) => m.mayWriteMemory).map((m) => m.id)).toEqual(['memory-core']);
    expect(byDefault.parallelMemoryWriters).toBe(0);

    const lancedb = buildSlotMechanismCensus({ registeredPlugins: manifests, memorySlotId: 'memory-lancedb' });
    expect(lancedb.memory.filter((m) => m.mayWriteMemory).map((m) => m.id)).toEqual(['memory-lancedb']);
    expect(lancedb.memory.find((m) => m.id === 'memory-core')).toMatchObject({ role: 'candidate-producer', mayWriteMemory: false });
    expect(lancedb.parallelMemoryWriters).toBe(0);
    // Every memory-kind plugin in the registry is in the census; nothing else is.
    expect(lancedb.memory.map((m) => m.id).toSorted()).toEqual(memoryKind.toSorted());
  });

  it('the activation planner accepts any single memory owner from the real registry', () => {
    expect(Array.isArray(plan({ slots: { memory: 'memory-core', contextEngine: 'context-runtime-kit' } }).pluginIds)).toBe(true);
    expect(Array.isArray(plan({ slots: { memory: 'memory-lancedb' } }).pluginIds)).toBe(true);
    expect(Array.isArray(plan({ slots: { memory: 'none' } }).pluginIds)).toBe(true);
  });

  it('fail-closed: the activation planner rejects a non-owner memory slot and a second context engine', () => {
    for (const nonOwner of ['vtoken-packer', 'agent-map', 'sekb-governance', 'working-context']) {
      expect(() => plan({ slots: { memory: nonOwner } })).toThrow(/slot convergence rejected/);
    }
    expect(() => plan({ slots: { contextEngine: 'legacy-context-engine' } })).toThrow(/slot convergence rejected/);
  });

  it('non-plugin mechanisms never write memory and SEKB never writes back automatically', () => {
    for (const mechanism of RC07_MEMORY_MECHANISMS.filter((m) => m.id !== 'memory-core')) {
      expect(mechanism.mayWriteMemory).toBe(false);
    }
    expect(RC07_MEMORY_MECHANISMS.find((m) => m.id === 'sekb-governance')).toMatchObject({
      role: 'review-proposal',
      autoWriteback: false,
    });
    expect(RC07_MEMORY_MECHANISMS.find((m) => m.id === 'working-context')?.role).toBe('projection');
    expect(buildSlotMechanismCensus({ registeredPlugins: bundledManifests() }).autoWritebackCount).toBe(0);
  });

  it('diagnostics-off: the AgentMap arm performs zero query when its flag is off', async () => {
    let queries = 0;
    const provider = createAgentMapContextProvider({
      getResult: () => {
        queries += 1;
        return undefined;
      },
    });
    const query = { goal: 'map the workspace', workspace: process.cwd(), activeFiles: ['src/a.ts'] };
    const off = await provider.getContext(query);
    if (Array.isArray(off)) throw new Error('expected a full provider result');
    expect(off.contextItems).toEqual([]);
    expect(off.metadata?.enabled).toBe(false);
    expect(queries).toBe(0);

    await provider.getContext({ ...query, metadata: { config: { runtime: { agentMap: { provider: true } } } } });
    expect(queries).toBe(1);
  });
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

  it('runtime.memory.persist=true surfaces the owner drift on the default memory-core slot', () => {
    const census = buildRuntimeMemoryWriterCensus({ runtimeMemoryPersist: true });
    expect(census.parallelMemoryWriters).toBe(1);
    expect(census.authorities.filter((a) => a.mayWriteMemory).map((a) => a.id)).toEqual([
      'memory-core',
      'runtime-memory-persistence',
    ]);
  });

  it('accepts runtime.memory.persist=true when runtime-memory owns the memory slot', () => {
    const census = buildRuntimeMemoryWriterCensus({
      memorySlotId: 'runtime-memory',
      runtimeMemoryPersist: true,
    });
    expect(census.parallelMemoryWriters).toBe(0);
    expect(census.authorities.filter((a) => a.mayWriteMemory).map((a) => a.id)).toEqual([
      'runtime-memory-persistence',
    ]);
    expect(
      assertRuntimeMemoryOwnerConvergence({
        memorySlotId: 'runtime-memory',
        runtimeMemoryPersist: true,
      }),
    ).toEqual({ ok: true, errors: [] });
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

  it('fail-closed: the activation planner rejects an unconstrained writer and accepts the selected runtime-memory owner', () => {
    // Legal default: persist off (or omitted) normalizes without errors.
    const legal = resolveManifestActivationPlan({
      config: {
        plugins: { slots: { memory: 'memory-core' } },
        runtime: { memory: { persist: false } },
      } as never,
      workspaceDir: process.cwd(),
      trigger: { kind: 'capability', capability: 'anything' } as never,
      manifestRecords: [],
    });
    expect(Array.isArray(legal.pluginIds)).toBe(true);

    // E-1 ruling (a): the default memory-core slot remains fail-closed.
    expect(() =>
      resolveManifestActivationPlan({
        config: {
          plugins: { slots: { memory: 'memory-core' } },
          runtime: { memory: { persist: true } },
        } as never,
        workspaceDir: process.cwd(),
        trigger: { kind: 'capability', capability: 'anything' } as never,
        manifestRecords: [],
      }),
    ).toThrow(/slot convergence rejected/);

    const selected = resolveManifestActivationPlan({
      config: {
        plugins: { slots: { memory: 'runtime-memory' } },
        runtime: { memory: { persist: true } },
      } as never,
      workspaceDir: process.cwd(),
      trigger: { kind: 'capability', capability: 'anything' } as never,
      manifestRecords: [],
    });
    expect(selected.pluginIds).toEqual([]);
  });
});
