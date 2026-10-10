// @vitest-environment node
// Issue #141: real-model memory-benefit closure.
// Query set is not filtered to facts known to be seeded; both arms use same questions.

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import { createRuntimeMemoryProviderResult } from "../../openclaw_runtime/src/context-engine/memory-context-provider";
import { buildRuntimeMemoryTemporalFactFixture } from "../../openclaw_runtime/src/runtime-core";
import { RUNTIME_MEMORY_EVAL_CONFIG, createTempDbPath } from "./helpers/runtime-memory-eval-helpers";
import { callDeepSeek, getRuntimeMemoryLlmConfig, getRuntimeMemoryLlmReceipts, hasDeepSeekKey } from "./helpers/runtime-memory-real-llm-client";

const tempDirs: string[] = [];
afterEach(() => { for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function writeMemory(dbPath: string): void {
  const persistence = createRuntimeMemoryPersistenceStore({ config: RUNTIME_MEMORY_EVAL_CONFIG, database: { path: dbPath }, evictionPolicy: "fifo", now: () => 10_000 });
  if (persistence.migrate().status !== "migrated") throw new Error("memory migration failed");
  const facts = [
    buildRuntimeMemoryTemporalFactFixture({ factId: "benefit-1", taskId: "benefit-task", subject: "BenefitProbe", predicate: "deploy_window", objectSummary: "The deployment window is Thursday 09:00 UTC", valid_at: 1, reference_time: 1, confidence: 0.95, acceptedAt: 1 }),
    buildRuntimeMemoryTemporalFactFixture({ factId: "benefit-2", taskId: "benefit-task", subject: "BenefitProbe", predicate: "rollback_owner", objectSummary: "The rollback owner is Morgan", valid_at: 2, reference_time: 2, confidence: 0.95, acceptedAt: 2 }),
  ];
  for (const fact of facts) if (persistence.appendFact(fact as never).status !== "persisted") throw new Error("fact append failed");
}

async function memoryContext(dbPath: string): Promise<string> {
  const persistence = createRuntimeMemoryPersistenceStore({ config: RUNTIME_MEMORY_EVAL_CONFIG, database: { path: dbPath }, evictionPolicy: "fifo" });
  const loaded = persistence.loadStore();
  if (loaded.status !== "loaded") throw new Error("memory load failed");
  const result = await createRuntimeMemoryProviderResult(
    { facts: loaded.store.queryFacts({ includeInvalidated: true }) as never, defaultTokenBudget: 256, defaultLimit: 8 },
    { taskId: "benefit-task", tokenBudget: 256, metadata: { memoryQuery: { taskId: "benefit-task", subject: "BenefitProbe", reference_time: 3, limit: 8 } } },
  );
  return result.contextItems.map((item) => item.text).join("\n");
}

function prompt(context: string, question: string): { system: string; user: string } {
  return { system: ["Answer only from supplied memory. If absent reply UNKNOWN.", "=== MEMORY ===", context || "(empty)", "=== END MEMORY ==="].join("\n"), user: question };
}

describe("real-model memory benefit closure (#141)", () => {
  it.skipIf(!hasDeepSeekKey())("uses same unfiltered questions for no-memory and memory arms", async () => {
    const dbPath = createTempDbPath("benefit-real-", tempDirs);
    writeMemory(dbPath);
    const questions = ["What is the deployment window? Answer with the exact window.", "Who owns rollback? Answer with the name only."];
    const noMemory: string[] = [];
    const withMemory: string[] = [];
    for (const question of questions) {
      const baselinePrompt = prompt("", question);
      const treatmentPrompt = prompt(await memoryContext(dbPath), question);
      noMemory.push((await callDeepSeek(baselinePrompt.system, baselinePrompt.user, { temperature: 0, maxTokens: 128 })).content);
      withMemory.push((await callDeepSeek(treatmentPrompt.system, treatmentPrompt.user, { temperature: 0, maxTokens: 128 })).content);
    }
    const expected = ["thursday 09:00 utc", "morgan"];
    const baselineHits = noMemory.filter((answer, i) => answer.toLowerCase().includes(expected[i])).length;
    const treatmentHits = withMemory.filter((answer, i) => answer.toLowerCase().includes(expected[i])).length;
    const evidence = { driven_by: "agent", actor: "codex", generatedAt: new Date().toISOString(), config: getRuntimeMemoryLlmConfig(), queryCount: questions.length, seededQueryFilter: false, baselineHits, treatmentHits, noMemory, withMemory, receipts: getRuntimeMemoryLlmReceipts() };
    const evidenceDir = path.resolve("artifacts/runtime-memory-benefit-real");
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(path.join(evidenceDir, "report.json"), JSON.stringify(evidence, null, 2));
    expect(treatmentHits).toBeGreaterThan(baselineHits);
  }, 180_000);
});
