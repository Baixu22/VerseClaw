import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginPromptCacheObservation,
  completePromptCacheObservation,
  readAggregatedPromptCacheHitRate,
  recordPromptCacheHitRateSample,
  resetPromptCacheObservabilityForTest,
} from '../../openclaw_runtime/src/agents/embedded-agent-runner/prompt-cache-observability';

/**
 * TF-0447 AC2: a repeatable command that produces a hit-rate / attribution
 * artifact on a FIXED task set stored in the repository.
 *
 * The task set lives in
 *   harness/specs/fixtures/tf0447-prompt-cache-benchmark/tasks.json
 * and this run writes
 *   harness/specs/fixtures/tf0447-prompt-cache-benchmark/result.json
 *
 * Reproduce with:
 *   vitest run tests/unit/tf0447-prompt-cache-benchmark.test.ts
 *
 * No model is called: the fixture replays a recorded usage shape so the result
 * is deterministic. That boundary is stated in the artifact itself.
 */

type FixtureTask = {
  id: string;
  provider: string;
  modelId: string;
  cacheRetention: 'none' | 'short' | 'long';
  streamStrategy: string;
  systemPrompt: string;
  toolNames: string[];
  usage: { input?: number; cacheRead?: number };
};

const fixtureDir = resolve(__dirname, '../../harness/specs/fixtures/tf0447-prompt-cache-benchmark');
const tasksFile = resolve(fixtureDir, 'tasks.json');
const resultFile = resolve(fixtureDir, 'result.json');

function loadTasks(): FixtureTask[] {
  const parsed = JSON.parse(readFileSync(tasksFile, 'utf8')) as { tasks: FixtureTask[] };
  return parsed.tasks;
}

describe('TF-0447 prompt-cache benchmark on a fixed repo task set', () => {
  beforeEach(() => {
    resetPromptCacheObservabilityForTest();
  });

  it('produces a hit-rate and break-attribution artifact', () => {
    const tasks = loadTasks();
    const perTask: Array<Record<string, unknown>> = [];

    for (const task of tasks) {
      // Same session key for every task in a provider/model family: the
      // benchmark is about prefix reuse, not about isolation.
      const sessionId = `${task.provider}:${task.modelId}`;
      beginPromptCacheObservation({
        sessionId,
        provider: task.provider,
        modelId: task.modelId,
        cacheRetention: task.cacheRetention,
        streamStrategy: task.streamStrategy,
        systemPrompt: task.systemPrompt,
        toolNames: task.toolNames,
      });
      const broke = completePromptCacheObservation({ sessionId, usage: task.usage });
      const window = recordPromptCacheHitRateSample({
        sessionId,
        usage: task.usage,
        broke: Boolean(broke),
      });
      perTask.push({
        id: task.id,
        cacheReadTokens: window?.cacheReadTokens ?? 0,
        totalPromptTokens: window?.totalPromptTokens ?? 0,
        hitRate: window?.hitRate ?? null,
        breaks: window?.breaks ?? 0,
        breakChanges: broke?.changes?.map((change) => change.code) ?? null,
      });
    }

    const aggregate = readAggregatedPromptCacheHitRate();
    const artifact = {
      schemaVersion: 1,
      taskId: 'TF-0447',
      driven_by: 'agent',
      generatedBy: 'tests/unit/tf0447-prompt-cache-benchmark.test.ts',
      command: 'vitest run tests/unit/tf0447-prompt-cache-benchmark.test.ts',
      taskSet: 'harness/specs/fixtures/tf0447-prompt-cache-benchmark/tasks.json',
      taskCount: tasks.length,
      boundary:
        'Replays a recorded usage shape; no model is called and no provider bill is verified. '
        + 'The number proves the accounting and attribution path, not production cost.',
      aggregate,
      perTask,
    };

    mkdirSync(dirname(resultFile), { recursive: true });
    writeFileSync(resultFile, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

    // Assertions make a silent regression fail the gate rather than quietly
    // rewriting the artifact with worse numbers.
    expect(tasks.length).toBeGreaterThanOrEqual(7);
    expect(aggregate.observations).toBe(tasks.length);
    expect(aggregate.totalPromptTokens).toBeGreaterThan(0);
    expect(aggregate.hitRate).not.toBeNull();
    expect(aggregate.breaks).toBeGreaterThanOrEqual(1);

    const warmTasks = perTask.filter((entry) => String(entry.id).startsWith('code-warm'));
    expect(warmTasks.length).toBe(3);
    for (const entry of warmTasks) {
      expect(Number(entry.hitRate)).toBeGreaterThan(0.9);
    }

    const breakTask = perTask.find((entry) => entry.id === 'code-break-system');
    expect(breakTask?.breakChanges).toContain('systemPrompt');
  });
});
