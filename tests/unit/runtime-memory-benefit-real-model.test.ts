// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createRuntimeMemoryPersistenceStore } from '../../openclaw_runtime/src/runtime-core/memory-persistence';
import { createRuntimeMemoryContextProvider } from '../../openclaw_runtime/src/context-engine/memory-context-provider';
import { buildRuntimeMemoryTemporalFactFixture } from '../../openclaw_runtime/src/runtime-core';

it('keeps both arms of the retired memory-benefit path empty without database or provider calls', async () => {
  const root = mkdtempSync(join(tmpdir(), 'memory-benefit-retired-'));
  try {
    const fact = buildRuntimeMemoryTemporalFactFixture({ factId: 'benefit-1', taskId: 'benefit-task',
      subject: 'BenefitProbe', predicate: 'rollback_owner', objectSummary: 'The rollback owner is Morgan',
      valid_at: 1, reference_time: 1, confidence: 0.95, acceptedAt: 1 });
    const openDatabase = vi.fn(() => { throw new Error('retired persistence opened sqlite'); });
    const queryFacts = vi.fn(() => [fact]);
    const path = join(root, 'memory.sqlite');
    const config = { runtime: { memory: { persist: true, provider: true } } };
    const store = createRuntimeMemoryPersistenceStore({ config, database: { path }, openDatabase: openDatabase as never });
    expect(store.migrate()).toMatchObject({ status: 'skipped', reason: 'flag_disabled' });
    expect(store.appendFact(fact)).toMatchObject({ status: 'skipped', reason: 'flag_disabled' });
    const results = [];
    for (const facts of [[], [fact]]) {
      const provider = createRuntimeMemoryContextProvider({ config, facts, queryFacts });
      for (const question of ['What is the deployment window?', 'Who owns rollback?', 'What is the staging database password?']) {
        const result = await provider.getContext({ taskId: 'benefit-task', tokenBudget: 128, metadata: { question } });
        if (Array.isArray(result)) throw new Error('retired provider must return its disabled diagnostic');
        expect(result).toMatchObject({ status: 'fallback', contextItems: [], metadata: { enabled: false } });
        results.push(result.contextItems);
      }
    }
    expect(results).toEqual([[], [], [], [], [], []]);
    expect(queryFacts).not.toHaveBeenCalled();
    expect(openDatabase).not.toHaveBeenCalled();
    expect(existsSync(path)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
