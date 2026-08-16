// @vitest-environment node
// R3-1 E-1 decision (a): runtime.memory.persist=true is legal only when the
// runtime-memory owner is selected under plugins.slots.memory. This test proves
// that the legal surface is not just a planner-level formality: the exact
// loadStore() primitive used by the inject-pilot runtime-memory provider reads
// the real persisted facts, and the provider emits them as context items.
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertRuntimeMemoryOwnerConvergence,
} from '../../openclaw_runtime/src/agents/slot-convergence.js';
import { createRuntimeMemoryContextProvider } from '../../openclaw_runtime/src/context-engine/memory-context-provider.js';
import { resolveManifestActivationPlan } from '../../openclaw_runtime/src/plugins/activation-planner.js';
import {
  buildRuntimeMemoryTemporalFactFixture,
  type RuntimeContextProviderResult,
  type RuntimeMemoryQueryableFact,
} from '../../openclaw_runtime/src/runtime-core/index.js';
import { createRuntimeMemoryRuntimeIntegration } from '../../openclaw_runtime/src/runtime-core/memory-runtime-integration.js';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db.js';

const tempDirs: string[] = [];

function createTempDbPath(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'r3-1-legal-surface-'));
  tempDirs.push(dir);
  return path.join(dir, 'openclaw-state.sqlite');
}

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('R3-1 E-1 legal runtime-memory surface', () => {
  it('owner convergence and activation planning accept the selected runtime-memory owner', () => {
    expect(
      assertRuntimeMemoryOwnerConvergence({
        memorySlotId: 'runtime-memory',
        runtimeMemoryPersist: true,
      }),
    ).toEqual({ ok: true, errors: [] });

    const plan = resolveManifestActivationPlan({
      config: {
        plugins: { slots: { memory: 'runtime-memory' } },
        runtime: { memory: { persist: true } },
      } as never,
      workspaceDir: process.cwd(),
      trigger: { kind: 'capability', capability: 'anything' } as never,
      manifestRecords: [],
    });
    expect(Array.isArray(plan.pluginIds)).toBe(true);

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
  });

  it('loadStore reads real persisted facts for the inject-pilot runtime-memory provider', async () => {
    const cfg = {
      plugins: { slots: { memory: 'runtime-memory' } },
      runtime: { memory: { persist: true, provider: true } },
    };
    const integration = createRuntimeMemoryRuntimeIntegration({
      config: cfg,
      database: { path: createTempDbPath() },
      now: () => Date.now(),
    });
    expect(integration.migrate()).toMatchObject({ status: 'migrated' });

    const fact = buildRuntimeMemoryTemporalFactFixture({
      factId: 'r3-1-persisted-fact',
      subject: 'runtime-memory',
      predicate: 'serves persisted facts to',
      objectSummary: 'the inject-pilot provider',
      valid_at: Date.now(),
      reference_time: Date.now(),
    });
    expect(integration.appendFact(fact)).toMatchObject({
      status: 'persisted',
      stored: true,
    });

    // This is the same loadStore() call shape used by
    // run/attempt.ts queryFacts for providers=["runtime-memory"].
    const loaded = integration.loadStore();
    expect(loaded.status).toBe('loaded');
    expect(
      loaded.store.queryFacts({ limit: 24 }).filter((row) => row.factId === fact.factId),
    ).toHaveLength(1);

    const provider = createRuntimeMemoryContextProvider({
      config: cfg,
      queryFacts: (query) =>
        integration.loadStore().store.queryFacts(query) as readonly RuntimeMemoryQueryableFact[],
    });
    const result = (await provider.getContext(
      { taskId: fact.taskId, tokenBudget: 512, activeFiles: [] },
      {},
    )) as RuntimeContextProviderResult;
    expect(result.status).toBe('success');
    expect(result.contextItems).toHaveLength(1);
    expect(result.contextItems[0]?.metadata).toMatchObject({
      providerId: 'runtime-memory',
      factId: fact.factId,
    });
  });
});
