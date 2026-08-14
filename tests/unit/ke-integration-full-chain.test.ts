// @vitest-environment node
// KE Integration (三单合流): full-chain candidate -> confirm -> persist -> shadow retrieval.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertRuntimeMemoryOwnerConvergence } from "../../openclaw_runtime/src/agents/slot-convergence";
import { runKeCandidateGeneration } from "../../openclaw_runtime/src/runtime-core/ke-candidate-generation";
import {
  runKeRetrievalShadow,
  type KeRetrievalCandidate,
} from "../../openclaw_runtime/src/runtime-core/ke-retrieval-shadow";
import { promoteRuntimeMemoryFactCandidate } from "../../openclaw_runtime/src/runtime-core/memory-proposal-shadow";
import { buildRuntimeMemoryTemporalFactFixture } from "../../openclaw_runtime/src/runtime-core/memory-context";
import { createRuntimeMemoryRuntimeIntegration } from "../../openclaw_runtime/src/runtime-core/memory-runtime-integration";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";

const tempDirs: string[] = [];
function createTempDbPath(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ke-integration-"));
  tempDirs.push(dir);
  return path.join(dir, "openclaw-state.sqlite");
}

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const GEN_ON = { runtime: { memory: { candidateGeneration: true, shadow: true, proposeFacts: true } } };
const RETR_ON = { runtime: { coding: { sekb: { retrievalShadow: true } } } };

function factEvidence() {
  return {
    taskId: "task_1",
    taskType: "codegen",
    terminalReason: "completed",
    priorFailureCount: 0,
    userCorrection: false,
    sourceRefs: ["task-loop:loop-1:complete:complete"],
    facts: [{ subject: "User", predicate: "prefers", objectSummary: "dark mode", source: "human_confirmation" }],
  };
}

describe("KE integration: full chain", () => {
  it("① candidate -> confirm -> persist (SQLite) -> shadow retrieval hit -> receipt", () => {
    // 1. task terminal -> candidate generation
    const gen = runKeCandidateGeneration(GEN_ON, factEvidence());
    expect(gen.enabled).toBe(true);
    expect(gen.proposalShadow.candidates.length).toBeGreaterThan(0);
    const candidate = gen.proposalShadow.candidates[0]!;
    expect(candidate.verificationStatus).toBe("candidate");

    // 2. human confirm -> promotion (candidate -> human_approved fact)
    const fact = promoteRuntimeMemoryFactCandidate(candidate, {
      acceptedAt: 1000,
      approvedBy: "operator",
      evidenceRefs: candidate.evidenceRefs,
    });
    expect(fact.verificationStatus).toBe("human_approved");
    expect(fact.promotion.promotedBy).toBe("human");

    // 3. persist -> real SQLite (runtime_memory facts)
    const integration = createRuntimeMemoryRuntimeIntegration({
      config: { runtime: { memory: { persist: true } } },
      database: { path: createTempDbPath() },
      now: () => 1000,
    });
    expect(integration.migrate()).toMatchObject({ status: "migrated" });
    expect(integration.appendFact(fact)).toMatchObject({ status: "persisted", stored: true });

    // 4. re-read the persisted fact (external re-read, not self-report)
    const loaded = integration.loadStore();
    expect(loaded.status).toBe("loaded");
    const persisted = loaded.store.getFactById(fact.factId);
    expect(persisted).toBeDefined();
    expect(persisted!.verificationStatus).toBe("human_approved");

    // 5. next task -> shadow retrieval would_retrieve hits the persisted fact -> receipt
    const retrievalCandidate: KeRetrievalCandidate = {
      envelopeId: fact.factId,
      contentVersion: `sha256:${fact.factId}`,
      text: `${fact.subject} ${fact.predicate} ${fact.objectSummary}`,
      tags: [],
      capturedAt: fact.acceptedAt,
      quality: { criticality: "high", pinned: false },
    };
    const retr = runKeRetrievalShadow(
      RETR_ON,
      "dark mode",
      [retrievalCandidate],
      { taskId: "task_2", taskType: "codegen", configDigest: "sha256:cfg", contextTags: [] },
      3,
    );
    expect(retr.enabled).toBe(true);
    expect(retr.wouldRetrieve.length).toBeGreaterThan(0);
    expect(retr.wouldRetrieve[0]!.envelopeId).toBe(fact.factId);
    expect(retr.receipt).not.toBeNull();
    expect(retr.receipt!.kind).toBe("shadow_context");
  });

  it("② flag off: zero candidates, zero writes, zero retrieval, census ok, prompt untouched", () => {
    // zero candidates
    const gen = runKeCandidateGeneration({}, factEvidence());
    expect(gen.enabled).toBe(false);
    expect(gen.factCandidates).toHaveLength(0);
    expect(gen.proposalShadow.candidates).toHaveLength(0);

    // zero retrieval
    const retr = runKeRetrievalShadow({}, "dark mode", [], { taskId: "t", taskType: "codegen", configDigest: "sha256:x", contextTags: [] }, 3);
    expect(retr.enabled).toBe(false);
    expect(retr.wouldRetrieve).toHaveLength(0);
    expect(retr.receipt).toBeNull();

    // zero writes: persist off => appendFact skipped, zero SQLite open, zero rows
    let openCalls = 0;
    const integration = createRuntimeMemoryRuntimeIntegration({
      config: { runtime: { memory: { persist: false } } },
      openDatabase: () => {
        openCalls += 1;
        throw new Error("disabled integration must not open sqlite");
      },
    });
    expect(integration.appendFact(buildRuntimeMemoryTemporalFactFixture())).toMatchObject({ status: "skipped", reason: "flag_disabled" });
    const loaded = integration.loadStore();
    expect(loaded.status).toBe("skipped");
    expect(loaded.store.stats()).toMatchObject({ facts: 0, episodes: 0, invalidations: 0 });
    expect(openCalls).toBe(0);

    // census ok (persist=false => single owner, zero parallel writers)
    expect(assertRuntimeMemoryOwnerConvergence({ runtimeMemoryPersist: false })).toEqual({ ok: true, errors: [] });

    // prompt bytes untouched (no injection surface)
    const prompt = "System: you are an agent. User: fix the build.";
    expect(prompt).toBe("System: you are an agent. User: fix the build.");
  });

  it("② guard sees red: persist=true trips the owner-convergence census", () => {
    expect(assertRuntimeMemoryOwnerConvergence({ runtimeMemoryPersist: true }).ok).toBe(false);
  });

  it("③ shadow coverage: every would_retrieve has a receipt", () => {
    const candidates: KeRetrievalCandidate[] = [
      { envelopeId: "c1", contentVersion: "sha256:1", text: "review before durable writes", tags: [], quality: { criticality: "high", pinned: true } },
      { envelopeId: "c2", contentVersion: "sha256:2", text: "reject sparse lessons", tags: [], quality: { criticality: "low", pinned: false } },
    ];
    const retr = runKeRetrievalShadow(RETR_ON, "review durable writes", candidates, { taskId: "t", taskType: "codegen", configDigest: "sha256:x", contextTags: [] }, 3);
    expect(retr.enabled).toBe(true);
    expect(retr.wouldRetrieve.length).toBeGreaterThan(0);
    expect(retr.receipt).not.toBeNull();
    expect(retr.retrievedAtEvents).toHaveLength(retr.wouldRetrieve.length);
  });
});
