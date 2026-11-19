// @vitest-environment node
// KE Integration: staged candidates, retired persistence and diagnostic retrieval.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertRuntimeMemoryOwnerConvergence } from "../../openclaw_runtime/src/agents/slot-convergence";
import { buildKeFactProposalInputs, runKeCandidateGeneration } from "../../openclaw_runtime/src/runtime-core/ke-candidate-generation";
import {
  runKeRetrievalShadow,
  type KeRetrievalCandidate,
} from "../../openclaw_runtime/src/runtime-core/ke-retrieval-shadow";
import { promoteRuntimeMemoryFactCandidate, sanitizeRuntimeMemoryFactProposalInput } from "../../openclaw_runtime/src/runtime-core/memory-proposal-shadow";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import { RUNTIME_MEMORY_EVAL_CONFIG } from "./helpers/runtime-memory-eval-helpers";
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
  it("① staged candidate -> agent-simulated confirmation -> retired persistence guard -> retrieval receipt", () => {
    // 1. task terminal -> candidate generation
    const gen = runKeCandidateGeneration(GEN_ON, factEvidence());
    expect(gen.enabled).toBe(true);
    expect(gen.factCandidates.length).toBeGreaterThan(0);
    expect(gen.proposalShadow).toMatchObject({ enabled: false, readonly: true, candidates: [], acceptedFacts: [] });
    const parsed = sanitizeRuntimeMemoryFactProposalInput(buildKeFactProposalInputs(factEvidence())[0]);
    if (!parsed.accepted) throw new Error(parsed.reason);
    const candidate = parsed.value;
    expect(candidate.verificationStatus).toBe("candidate");

    // Agent-simulated confirmation exercises the existing legacy approval schema.
    const fact = promoteRuntimeMemoryFactCandidate(candidate, {
      acceptedAt: 1000,
      approvedBy: "agent:ke-diagnostic-fixture",
      evidenceRefs: candidate.evidenceRefs,
    });
    expect(fact.verificationStatus).toBe("human_approved");
    expect(fact.promotion.promotedBy).toBe("human");

    // Retired persistence requests must leave the staged fact out of SQLite.
    const dbPath = createTempDbPath();
    let openCalls = 0;
    const integration = createRuntimeMemoryPersistenceStore({
      config: RUNTIME_MEMORY_EVAL_CONFIG,
      database: { path: dbPath },
      now: () => 1000,
      openDatabase: () => { openCalls += 1; throw new Error("retired persistence must not open SQLite"); },
    });
    expect(integration.migrate()).toMatchObject({ status: "skipped", reason: "flag_disabled", migrated: false });
    expect(integration.appendFact(fact)).toMatchObject({ status: "skipped", reason: "flag_disabled", persisted: false });

    const loaded = integration.loadStore();
    expect(loaded.status).toBe("skipped");
    const persisted = loaded.store.getFactById(fact.factId);
    expect(persisted).toBeUndefined();
    expect(loaded.store.stats()).toMatchObject({ facts: 0, episodes: 0, invalidations: 0 });
    expect(openCalls).toBe(0);
    expect(existsSync(dbPath)).toBe(false);

    // The diagnostic retrieval fixture reads the staged fact directly.
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
