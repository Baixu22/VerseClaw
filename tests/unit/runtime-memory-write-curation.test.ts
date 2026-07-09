// @vitest-environment node
// Module A: AUDN write-time curation unit tests.
// Validates the decideAUDN decision logic (Add / Update / Delete / None) and
// the applyAUDNDecision pure helper, without a database.

import { describe, expect, it } from "vitest";
import {
  applyAUDNDecision,
  decideAUDN,
  DEFAULT_WRITE_CURATION_CONFIG,
  type AUDNDecision,
  type WriteCurationConfig,
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

describe("Module A: AUDN write-time curation", () => {
  it("ADD when no existing fact matches subject+predicate", () => {
    const candidate = makeCandidate("c1", "UserPref", "theme", "dark mode");
    const decision = decideAUDN(candidate, [], DEFAULT_WRITE_CURATION_CONFIG);
    expect(decision.action).toBe("ADD");
    if (decision.action === "ADD") {
      expect(decision.candidate.factId).toBe("c1");
    }
  });

  it("NONE on exact duplicate (same subject+predicate+normalized objectSummary)", () => {
    const existing = makeFact("e1", "UserPref", "theme", "Dark Mode.");
    const candidate = makeCandidate("c1", "UserPref", "theme", "dark mode", {
      confidence: 0.9,
    });
    const decision = decideAUDN(candidate, [existing]);
    expect(decision.action).toBe("NONE");
    if (decision.action === "NONE") {
      expect(decision.reason).toBe("exact_duplicate");
    }
  });

  it("NONE when same subject+predicate, different object, candidate confidence >= existing (UPDATE disabled per project_memory.md, signal layer returns NONE for low-similarity value mismatch)", () => {
    const existing = makeFact("e1", "UserPref", "theme", "dark mode", {
      confidence: 0.7,
    });
    const candidate = makeCandidate("c1", "UserPref", "theme", "light mode", {
      confidence: 0.9,
    });
    const decision = decideAUDN(candidate, [existing]);
    // UPDATE 已禁用 (project_memory.md Hard Constraint). "dark mode" vs "light mode"
    // 字面相似度低 (Jaccard ~0.33 < boundaryLow 0.75), 不触发矛盾检测, 走信号层
    // → NONE (signal_vote_lower_signal). 理想行为应为 SUPERSEDE (value mismatch),
    // 但需增强矛盾检测, 属已知局限.
    expect(decision.action).toBe("NONE");
  });

  it("NONE when same subject+predicate but candidate has lower confidence", () => {
    const existing = makeFact("e1", "UserPref", "theme", "dark mode", {
      confidence: 0.9,
    });
    const candidate = makeCandidate("c1", "UserPref", "theme", "light mode", {
      confidence: 0.5,
    });
    const decision = decideAUDN(candidate, [existing]);
    expect(decision.action).toBe("NONE");
    if (decision.action === "NONE") {
      // 信号层接管后 reason 变为 signal_vote_lower_signal (非旧版 lower_confidence_than_existing)
      expect(decision.reason).toBe("signal_vote_lower_signal");
    }
  });

  it("semantic dedupe via BM25+Jaccard: near-duplicate objectSummary → NONE", () => {
    // Same subject+predicate would already trigger exact-match path, so use
    // a different predicate but high text overlap to exercise stage 2/3.
    const existing = makeFact(
      "e1",
      "UserPref",
      "preferred_theme_setting",
      "user strongly prefers dark mode for the editor",
      { confidence: 0.9 },
    );
    const candidate = makeCandidate(
      "c1",
      "UserPref",
      "theme_choice",
      "user strongly prefers dark mode for the editor",
      { confidence: 0.6 },
    );
    const config: WriteCurationConfig = {
      semanticDedupeThreshold: 0.6,
      keywordOverlapThreshold: 0.4,
    };
    const decision = decideAUDN(candidate, [existing], config);
    // High Jaccard overlap, candidate confidence lower → NONE.
    expect(decision.action).toBe("NONE");
  });

  it("NONE on semantic dedupe when candidate confidence is higher (UPDATE disabled, signal layer returns NONE for verified-existing vs candidate)", () => {
    const existing = makeFact(
      "e1",
      "UserPref",
      "preferred_theme_setting",
      "user strongly prefers dark mode for the editor",
      { confidence: 0.5 },
    );
    const candidate = makeCandidate(
      "c1",
      "UserPref",
      "theme_choice",
      "user strongly prefers dark mode for the editor",
      { confidence: 0.95 },
    );
    const config: WriteCurationConfig = {
      semanticDedupeThreshold: 0.6,
      keywordOverlapThreshold: 0.4,
    };
    const decision = decideAUDN(candidate, [existing], config);
    // UPDATE 已禁用. BM25 高重叠 → 走 decideBySignal (bm25_signal_vote).
    // existing 为 verified, candidate 为 candidate → 信号层判定 candidateWins <= 1 → NONE.
    expect(decision.action).toBe("NONE");
  });

  it("ADD when subject differs and text overlap is below threshold", () => {
    const existing = makeFact(
      "e1",
      "SystemConfig",
      "log_level",
      "verbose logging enabled for the gateway subsystem",
    );
    const candidate = makeCandidate(
      "c1",
      "UserPref",
      "theme",
      "dark mode preferred",
    );
    const decision = decideAUDN(candidate, [existing]);
    expect(decision.action).toBe("ADD");
  });

  it("applyAUDNDecision: UPDATE removes superseded fact and queues candidate", () => {
    const existing1 = makeFact("e1", "UserPref", "theme", "dark mode");
    const existing2 = makeFact("e2", "UserPref", "lang", "typescript");
    const candidate = makeCandidate("c1", "UserPref", "theme", "light mode", {
      confidence: 0.9,
    });
    // 直接构造 UPDATE decision 测试 applyAUDNDecision 的纯逻辑.
    // (decideAUDN 已禁用 UPDATE 走信号层, 但 applyAUDNDecision 仍需正确处理 UPDATE)
    const decision: AUDNDecision = {
      action: "UPDATE",
      candidate,
      supersedes: "e1",
    };

    const result = applyAUDNDecision(decision, [existing1, existing2]);
    expect(result.action).toBe("UPDATE");
    expect(result.toAppend?.factId).toBe("c1");
    expect(result.toInvalidateFactId).toBe("e1");
    expect(result.invalidateReason).toBe("superseded");
    // Superseded fact removed from remaining; unrelated fact kept.
    expect(result.remainingFacts.map((f) => f.factId)).toEqual(["e2"]);
  });

  it("applyAUDNDecision: NONE keeps existing facts unchanged", () => {
    const existing = makeFact("e1", "UserPref", "theme", "dark mode", {
      confidence: 0.9,
    });
    const candidate = makeCandidate("c1", "UserPref", "theme", "dark mode");
    const decision = decideAUDN(candidate, [existing]);
    expect(decision.action).toBe("NONE");

    const result = applyAUDNDecision(decision, [existing]);
    expect(result.toAppend).toBeUndefined();
    expect(result.toInvalidateFactId).toBeUndefined();
    expect(result.remainingFacts.map((f) => f.factId)).toEqual(["e1"]);
  });
});
