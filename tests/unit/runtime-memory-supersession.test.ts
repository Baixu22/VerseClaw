// @vitest-environment node
// Phase 2.1: Supersession conflict detection unit tests.
// Validates the SUPERSEDE AUDN action — when a new fact contradicts an existing
// fact (same subject+predicate, low word overlap, explicit negation/change
// signal), the old fact is invalidated with reason "contradicted" and the new
// fact is added.
//
// This is the Zep-inspired supersession mechanism: resolve semantic conflicts
// at write time instead of leaving contradictory facts to coexist.

import { describe, expect, it } from "vitest";
import {
  applyAUDNDecision,
  decideAUDN,
  DEFAULT_WRITE_CURATION_CONFIG,
  detectConflict,
  type AUDNDecision,
} from "../../openclaw_runtime/src/runtime-core/memory-write-curation";
import type {
  RuntimeMemoryTemporalFact,
  RuntimeMemoryTemporalFactCandidate,
} from "../../openclaw_runtime/src/runtime-core/memory-context";

function makeCandidate(
  id: string,
  subject: string,
  predicate: string,
  objectSummary: string,
  overrides: Partial<RuntimeMemoryTemporalFactCandidate> = {},
): RuntimeMemoryTemporalFactCandidate {
  return {
    schemaVersion: 1,
    factId: id,
    subject,
    predicate,
    objectSummary,
    confidence: 0.7,
    source: "tool_result",
    verificationStatus: "candidate",
    valid_at: 100,
    reference_time: 100,
    sourceEpisodeRefs: [],
    evidenceRefs: [],
    proposedAt: 100,
    ...overrides,
  };
}

function makeFact(
  id: string,
  subject: string,
  predicate: string,
  objectSummary: string,
  overrides: Partial<RuntimeMemoryTemporalFact> = {},
): RuntimeMemoryTemporalFact {
  return {
    schemaVersion: 1,
    factId: id,
    subject,
    predicate,
    objectSummary,
    confidence: 0.7,
    source: "tool_result",
    verificationStatus: "verified",
    valid_at: 100,
    reference_time: 100,
    sourceEpisodeRefs: [],
    evidenceRefs: [],
    acceptedAt: 100,
    promotion: { promotedBy: "verifier", evidenceRefs: [] },
    ...overrides,
  };
}

describe("Phase 2.1: Supersession conflict detection", () => {
  // === detectConflict unit tests ===

  describe("detectConflict", () => {
    it("returns true for low overlap + negation pattern", () => {
      const existing = "User prefers dark theme for the editor";
      const candidate = "User now prefers light theme for the editor";
      expect(detectConflict(candidate, existing)).toBe(true);
    });

    it("returns true for explicit 'no longer' negation", () => {
      const existing = "User likes Python for scripting";
      const candidate = "User no longer uses Python, switched to Rust";
      expect(detectConflict(candidate, existing)).toBe(true);
    });

    it("returns false for high overlap (refinement, not contradiction)", () => {
      const existing = "User prefers dark mode for the editor";
      const candidate = "User prefers dark mode for the editor and terminal";
      // High overlap — this is a refinement, not a contradiction
      expect(detectConflict(candidate, existing)).toBe(false);
    });

    it("returns false for low overlap but no negation pattern", () => {
      const existing = "User prefers dark theme";
      const candidate = "User enjoys outdoor hiking";
      // Low overlap but no negation/change signal — just unrelated
      expect(detectConflict(candidate, existing)).toBe(false);
    });

    it("returns false for identical summaries", () => {
      const existing = "User prefers dark theme";
      const candidate = "User prefers dark theme";
      expect(detectConflict(candidate, existing)).toBe(false);
    });

    it("respects custom overlap threshold", () => {
      const existing = "User prefers TypeScript";
      const candidate = "User now prefers JavaScript";
      // differenceRatio = 1 - Jaccard = 1 - (2/5) = 0.6
      // With threshold 0.3: 0.6 >= 0.3 + "now" → true
      expect(detectConflict(candidate, existing, 0.3)).toBe(true);
      // With threshold 0.7: 0.6 < 0.7 → false (not different enough)
      expect(detectConflict(candidate, existing, 0.7)).toBe(false);
    });

    it("detects 'changed' negation pattern", () => {
      const existing = "User primary language is Python";
      const candidate = "User changed primary language to Go";
      expect(detectConflict(candidate, existing)).toBe(true);
    });

    it("detects 'replaced' negation pattern", () => {
      const existing = "User uses PostgreSQL database";
      const candidate = "User replaced PostgreSQL with SQLite";
      expect(detectConflict(candidate, existing)).toBe(true);
    });
  });

  // === decideAUDN SUPERSEDE tests ===

  describe("decideAUDN SUPERSEDE", () => {
    it("returns SUPERSEDE when contradiction detected on same subject+predicate", () => {
      const existing = makeFact(
        "e1",
        "UserPref",
        "theme_preference",
        "user prefers dark theme for the editor",
      );
      const candidate = makeCandidate(
        "c1",
        "UserPref",
        "theme_preference",
        "user now prefers light theme for the editor",
      );
      const decision = decideAUDN(candidate, [existing]);
      expect(decision.action).toBe("SUPERSEDE");
      if (decision.action === "SUPERSEDE") {
        expect(decision.supersedes).toBe("e1");
        expect(decision.supersessionReason).toBe("contradiction");
        expect(decision.candidate.factId).toBe("c1");
      }
    });

    it("returns NONE (not UPDATE) for non-contradictory refinement (UPDATE disabled per project_memory.md, signal layer conservatively drops)", () => {
      const existing = makeFact(
        "e1",
        "UserPref",
        "theme_preference",
        "user prefers dark mode",
        { confidence: 0.5 },
      );
      const candidate = makeCandidate(
        "c1",
        "UserPref",
        "theme_preference",
        "user prefers dark mode for the editor and terminal",
        { confidence: 0.9 },
      );
      // UPDATE 已禁用 (project_memory.md). High overlap 但非矛盾 → 走信号层.
      // existing 为 verified, candidate 为 candidate → 信号层保守返回 NONE.
      // 理想行为应为 SUPERSEDE (refined) 或 ADD (supplement), 属已知局限.
      const decision = decideAUDN(candidate, [existing]);
      expect(decision.action).toBe("NONE");
    });

    it("returns SUPERSEDE even when candidate has lower confidence", () => {
      const existing = makeFact(
        "e1",
        "UserPref",
        "theme_preference",
        "user prefers dark theme",
        { confidence: 0.95 },
      );
      const candidate = makeCandidate(
        "c1",
        "UserPref",
        "theme_preference",
        "user no longer prefers dark theme, switched to light",
        { confidence: 0.3 },
      );
      // Contradiction detected → SUPERSEDE regardless of confidence
      // (without SUPERSEDE, this would be NONE: lower_confidence_than_existing)
      const decision = decideAUDN(candidate, [existing]);
      expect(decision.action).toBe("SUPERSEDE");
    });

    it("returns NONE for exact duplicate (not SUPERSEDE)", () => {
      const existing = makeFact(
        "e1",
        "UserPref",
        "theme_preference",
        "user prefers dark theme",
      );
      const candidate = makeCandidate(
        "c1",
        "UserPref",
        "theme_preference",
        "user prefers dark theme",
      );
      const decision = decideAUDN(candidate, [existing]);
      expect(decision.action).toBe("NONE");
    });

    it("respects custom contradictionOverlapThreshold", () => {
      const existing = makeFact(
        "e1",
        "UserPref",
        "language",
        "user prefers TypeScript for backend",
      );
      const candidate = makeCandidate(
        "c1",
        "UserPref",
        "language",
        "user now prefers JavaScript for backend",
      );
      // differenceRatio = 1 - Jaccard(4/7) = 1 - 0.571 = 0.429
      // With default threshold 0.3: 0.429 >= 0.3 → SUPERSEDE
      const decisionDefault = decideAUDN(candidate, [existing]);
      expect(decisionDefault.action).toBe("SUPERSEDE");

      // With threshold 0.5: 0.429 < 0.5 → not different enough → falls through
      // to signal layer → NONE (UPDATE disabled per project_memory.md,
      // existing verified vs candidate → signal layer conservatively drops)
      const configHigh = {
        ...DEFAULT_WRITE_CURATION_CONFIG,
        contradictionOverlapThreshold: 0.5,
      };
      const decisionHigh = decideAUDN(candidate, [existing], configHigh);
      expect(decisionHigh.action).toBe("NONE");

      // With threshold 0.0: 0.429 >= 0.0 → always triggers (if negation present)
      const configZero = {
        ...DEFAULT_WRITE_CURATION_CONFIG,
        contradictionOverlapThreshold: 0.0,
      };
      const decisionZero = decideAUDN(candidate, [existing], configZero);
      expect(decisionZero.action).toBe("SUPERSEDE");
    });
  });

  // === applyAUDNDecision SUPERSEDE tests ===

  describe("applyAUDNDecision SUPERSEDE", () => {
    it("invalidates old fact with 'contradicted' reason and appends new", () => {
      const existing = makeFact(
        "e1",
        "UserPref",
        "theme",
        "user prefers dark theme",
      );
      const candidate = makeCandidate(
        "c1",
        "UserPref",
        "theme",
        "user now prefers light theme",
      );
      const decision: AUDNDecision = {
        action: "SUPERSEDE",
        candidate,
        supersedes: "e1",
        supersessionReason: "contradiction",
      };

      const result = applyAUDNDecision(decision, [existing]);
      expect(result.action).toBe("SUPERSEDE");
      expect(result.toInvalidateFactId).toBe("e1");
      expect(result.invalidateReason).toBe("contradicted");
      expect(result.toAppend).toBe(candidate);
      // Old fact removed from remaining facts
      expect(result.remainingFacts.find((f) => f.factId === "e1")).toBeUndefined();
    });

    it("preserves other facts when superseding", () => {
      const fact1 = makeFact("e1", "UserPref", "theme", "dark theme");
      const fact2 = makeFact("e2", "UserPref", "language", "TypeScript");
      const fact3 = makeFact("e3", "Project", "name", "ClawX");
      const candidate = makeCandidate(
        "c1",
        "UserPref",
        "theme",
        "now prefers light theme",
      );
      const decision: AUDNDecision = {
        action: "SUPERSEDE",
        candidate,
        supersedes: "e1",
        supersessionReason: "contradiction",
      };

      const result = applyAUDNDecision(decision, [fact1, fact2, fact3]);
      expect(result.remainingFacts).toHaveLength(2);
      expect(result.remainingFacts.map((f) => f.factId)).toContain("e2");
      expect(result.remainingFacts.map((f) => f.factId)).toContain("e3");
      expect(result.remainingFacts.map((f) => f.factId)).not.toContain("e1");
    });
  });

  // === Multi-level supersession chain ===

  describe("supersession chain A→B→C", () => {
    it("multi-level supersession: only latest fact survives", () => {
      // A: initial fact
      const factA = makeFact(
        "a",
        "UserPref",
        "theme",
        "user prefers dark theme",
        { confidence: 0.8, valid_at: 100 },
      );

      // B: contradicts A
      const candidateB = makeCandidate(
        "b",
        "UserPref",
        "theme",
        "user now prefers light theme",
        { confidence: 0.7, valid_at: 200, proposedAt: 200, reference_time: 200 },
      );

      // Step 1: B supersedes A
      const decisionB = decideAUDN(candidateB, [factA]);
      expect(decisionB.action).toBe("SUPERSEDE");
      const resultB = applyAUDNDecision(
        decisionB.action === "SUPERSEDE" ? decisionB : { action: "NONE", reason: "test" },
        [factA],
      );
      // After B: A is invalidated, B should be appended
      expect(resultB.toInvalidateFactId).toBe("a");
      expect(resultB.invalidateReason).toBe("contradicted");

      // Simulate B being promoted to a fact (accepted)
      const factB: RuntimeMemoryTemporalFact = {
        ...candidateB,
        verificationStatus: "verified",
        acceptedAt: 200,
        promotion: { promotedBy: "verifier", evidenceRefs: [] },
      };

      // C: contradicts B (switched back to dark)
      const candidateC = makeCandidate(
        "c",
        "UserPref",
        "theme",
        "user changed back to dark theme",
        { confidence: 0.75, valid_at: 300, proposedAt: 300, reference_time: 300 },
      );

      // Step 2: C supersedes B
      const decisionC = decideAUDN(candidateC, [factB]);
      expect(decisionC.action).toBe("SUPERSEDE");
      const resultC = applyAUDNDecision(
        decisionC.action === "SUPERSEDE" ? decisionC : { action: "NONE", reason: "test" },
        [factB],
      );
      expect(resultC.toInvalidateFactId).toBe("b");
      expect(resultC.invalidateReason).toBe("contradicted");

      // After C: B is invalidated. Only C survives (A was already invalidated in step 1).
      // In a real system, A would already have invalid_at set, so it wouldn't
      // be in the existingFacts list for step 2.
      expect(resultC.remainingFacts.map((f) => f.factId)).not.toContain("b");
    });
  });
});
