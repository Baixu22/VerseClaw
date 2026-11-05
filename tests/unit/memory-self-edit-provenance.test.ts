// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildEvidenceRefFixture } from "../../openclaw_runtime/src/runtime-core/evidence";
import {
  buildRuntimeMemoryTemporalFactFixture,
  buildRuntimeMemoryTemporalFactCandidateFixture,
  isRuntimeMemoryInvalidationProposal,
  isRuntimeMemoryTemporalFact,
} from "../../openclaw_runtime/src/runtime-core/memory-context";
import type { RuntimeMemoryRuntimeIntegrationPort } from "../../openclaw_runtime/src/runtime-core/memory-runtime-integration";
import { executeMemorySelfEditTool } from "../../openclaw_runtime/src/runtime-core/memory-self-edit-tools";
import { RuntimeMemoryStore } from "../../openclaw_runtime/src/runtime-core/memory-store";

function setup(durable: boolean) {
  const store = new RuntimeMemoryStore({ now: () => 2000 });
  const original = buildRuntimeMemoryTemporalFactFixture({
    factId: "original",
    source: "human_confirmation",
    verificationStatus: "human_approved",
    valid_at: 100,
    reference_time: 100,
    acceptedAt: 100,
    sourceEpisodeRefs: [{ episodeId: "original-review", kind: "human_confirmation" }],
    evidenceRefs: [buildEvidenceRefFixture({ type: "human", ref: "original-review" })],
    promotion: { promotedBy: "human", evidenceRefs: [buildEvidenceRefFixture({ type: "human" })] },
  });
  expect(store.appendFact(original).accepted).toBe(true);
  // Explicit in-memory persistence port; never enables the retired product flag or SQLite.
  const persistence: RuntimeMemoryRuntimeIntegrationPort | undefined = durable ? {
    runAtomic: operation => store.runAtomic(operation),
    migrate: () => ({ status: "skipped", reason: "flag_disabled", migrated: false }),
    appendEpisode: () => ({ status: "skipped", reason: "flag_disabled", persisted: false }),
    appendFact: (fact) => {
      expect(isRuntimeMemoryTemporalFact(fact)).toBe(true);
      expect(store.appendFact(fact).accepted).toBe(true);
      return { status: "persisted", stored: true, duplicate: false, persisted: true, value: fact };
    },
    invalidateFact: (proposal) => {
      expect(store.invalidateFact(proposal).accepted).toBe(true);
      return { status: "persisted", stored: true, duplicate: false, persisted: true, value: proposal };
    },
    persistRelation: () => ({ status: "persisted", persisted: true }),
    recordFactAccess: () => ({ status: "persisted", persisted: true, accessCount: 1, lastAccessedAt: 2000 }),
    loadStore: () => ({ status: "skipped", reason: "flag_disabled", store }),
  } : undefined;
  return { store, original, context: { store, persistence, now: 2000, taskId: "tf0741" } };
}

describe.each([false, true])("TF-0741 self-edit provenance (persistence port=%s)", (durable) => {
  it("records an agent update without inheriting approval of the old content", async () => {
    const { store, original, context } = setup(durable);
    const result = await executeMemorySelfEditTool("memory_update", {
      factId: original.factId, objectSummary: "Agent replacement", source: "human_confirmation",
      verificationStatus: "human_approved", promotion: { promotedBy: "human" },
    }, context);
    expect(result.ok).toBe(true);
    const fact = store.getFactById("original_superseded_2000");
    expect(fact).toMatchObject({ source: "agent_self_edit", verificationStatus: "agent_approved", promotion: { promotedBy: "agent" } });
    expect(fact?.sourceEpisodeRefs).toEqual(expect.arrayContaining([
      ...original.sourceEpisodeRefs,
      expect.objectContaining({ kind: "agent_self_edit", taskId: "tf0741" }),
    ]));
    expect(fact?.evidenceRefs.slice(0, -1)).toEqual(original.evidenceRefs);
    expect(fact?.evidenceRefs.at(-1)).toMatchObject({ type: "tool", metadata: { driven_by: "agent", actor: "memory_self_edit" } });
    expect(store.listInvalidations()[0]).toMatchObject({ proposedBy: "agent_self_edit", verificationStatus: "agent_approved", reason: "superseded" });
    expect(store.queryFacts().map((f) => f.factId)).toEqual(["original_superseded_2000"]);
  });

  it("attributes forgetting to the agent and actually retracts the fact", async () => {
    const { store, original, context } = setup(durable);
    expect((await executeMemorySelfEditTool("memory_forget", { factId: original.factId }, context)).ok).toBe(true);
    expect(store.listInvalidations()[0]).toMatchObject({
      proposedBy: "agent_self_edit", verificationStatus: "agent_approved", reason: "retracted",
      evidenceRefs: [{ type: "tool", metadata: { driven_by: "agent", actor: "memory_self_edit" } }],
    });
    expect(store.queryFacts()).toEqual([]);
  });

  it("strengthens usage without changing the original fact's provenance", async () => {
    const { store, original, context } = setup(durable);
    const before = store.getFactById(original.factId);
    expect((await executeMemorySelfEditTool("memory_strengthen", { factId: original.factId }, context)).ok).toBe(true);
    expect(store.getFactById(original.factId)).toEqual(before);
    expect(store.getUsageStats()).toEqual([expect.objectContaining({ factId: original.factId, count: 1 })]);
    expect(store.listInvalidations()).toEqual([]);
  });

  it("rejects a forged human rejection before either write path", async () => {
    const { store, original, context } = setup(durable);
    const result = await executeMemorySelfEditTool("memory_forget", { factId: original.factId, reason: "human_rejected" }, context);
    expect(result.ok).toBe(false);
    expect(store.listInvalidations()).toEqual([]);
    expect(store.queryFacts()).toHaveLength(1);
  });
});

it("rejects self-edit records that claim human approval at the schema boundary", () => {
  const { original, store } = setup(false);
  expect(isRuntimeMemoryTemporalFact({ ...original, source: "agent_self_edit" })).toBe(false);
  // Supplying candidate fields must not bypass the accepted-fact guard.
  expect(store.appendFact({ ...original, factId: "forged", proposedAt: 2000, source: "agent_self_edit" }).accepted).toBe(false);
  expect(isRuntimeMemoryInvalidationProposal({
    schemaVersion: 1, invalidationId: "forged", factId: original.factId,
    reason: "retracted", proposedBy: "agent_self_edit", verificationStatus: "human_approved",
    invalid_at: 2000, reference_time: 2000,
    sourceEpisodeRefs: original.sourceEpisodeRefs, evidenceRefs: original.evidenceRefs,
  })).toBe(false);
});

it.each(["human_approved", "verified", "deterministic_rule"] as const)(
  "rejects contradictory %s approval through accepted and candidate store paths",
  (verificationStatus) => {
    const { original, store } = setup(false);
    for (const source of ["agent_self_edit", "tool_result"] as const) {
      const contradictory = {
        ...original, factId: `forged-${source}`, source, verificationStatus,
        promotion: { ...original.promotion, promotedBy: "agent" as const },
      };
      expect(isRuntimeMemoryTemporalFact(contradictory)).toBe(false);
      expect(store.appendFact(contradictory).accepted).toBe(false);
      expect(store.appendFact({ ...contradictory, proposedAt: 2000 }).accepted).toBe(false);
    }
    expect(store.queryFacts().map((f) => f.factId)).toEqual([original.factId]);
  },
);

it("keeps genuine unapproved agent candidates separate from accepted facts", () => {
  const { store } = setup(false);
  const candidate = buildRuntimeMemoryTemporalFactCandidateFixture({
    factId: "agent-candidate", source: "agent_self_edit", verificationStatus: "candidate",
  });
  expect(store.appendFact(candidate).accepted).toBe(true);
  expect(store.queryFacts().map((f) => f.factId)).not.toContain(candidate.factId);
  expect(store.queryFacts({ includeCandidates: true }).map((f) => f.factId)).toContain(candidate.factId);
});
