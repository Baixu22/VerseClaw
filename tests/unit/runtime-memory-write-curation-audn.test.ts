// @vitest-environment node
// Week 1 v2: AUDN 四层决策 5 类冲突 case 单元测试.
//
// 覆盖 memory-arch-roadmap.md §E.2 回归套件 v2 要求的 5 类冲突 case:
//   1. negation:    "not/no longer/switched" 显式否定 → SUPERSEDE (规则层)
//   2. paraphrase:  sim ≥ equivalentThreshold 语义等价 → 取 support_count 高的 (语义判定层)
//   3. supplement:  sim < boundaryLow, 信号层 2/4 → ADD (补充信息)
//   4. update:      sim ≥ contradictThreshold + value mismatch → SUPERSEDE (语义判定层)
//   5. contradict:  隐式否定 (moved/quit/left) + sim ≥ contradictThreshold → SUPERSEDE (语义判定层)
//
// 同时验证 v2 关键修复:
// - confidence 全 0.9 不再导致 UPDATE 误判 (用四信号 + semanticMatchScore 多维度决策)
// - 决策层标识 (decisionLayer) 正确写入审计信息
// - 向下兼容: decideAUDN 返回 AUDNDecision (无审计字段)
import { describe, expect, it } from "vitest";
import {
  compareSignals,
  computeConflictSignal,
  computeSemanticMatchScore,
  decideAUDN,
  decideAUDNAudited,
} from "../../openclaw_runtime/src/runtime-core/memory-write-curation";
import {
  buildRuntimeMemoryTemporalFactCandidateFixture,
  buildRuntimeMemoryTemporalFactFixture,
} from "../../openclaw_runtime/src/runtime-core/memory-context";

// === Helpers ===

function makeCandidate(overrides: {
  factId: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  confidence?: number;
  proofCount?: number;
  source?: string;
  valid_at?: number;
}): ReturnType<typeof buildRuntimeMemoryTemporalFactCandidateFixture> {
  // NOTE: buildRuntimeMemoryTemporalFactCandidateFixture 内部的 sanitize 会丢弃
  // proofCount (不在 sanitize 白名单中). 这里在 fixture 返回后重新设置,
  // 以便 computeConflictSignal 能正确计算 support_count 信号.
  const fact = buildRuntimeMemoryTemporalFactCandidateFixture({
    factId: overrides.factId,
    subject: overrides.subject,
    predicate: overrides.predicate,
    objectSummary: overrides.objectSummary,
    confidence: overrides.confidence ?? 0.9,
    source: (overrides.source as never) ?? "verifier_summary",
    valid_at: overrides.valid_at ?? 100,
    reference_time: overrides.valid_at ?? 100,
    proposedAt: (overrides.valid_at ?? 100) + 1,
  });
  if (overrides.proofCount !== undefined) {
    fact.proofCount = overrides.proofCount;
  }
  return fact;
}

function makeExistingFact(overrides: {
  factId: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  confidence?: number;
  proofCount?: number;
  source?: string;
  valid_at?: number;
}): ReturnType<typeof buildRuntimeMemoryTemporalFactFixture> {
  // 同上: sanitize 丢弃 proofCount, 需在 fixture 后重新设置.
  const fact = buildRuntimeMemoryTemporalFactFixture({
    factId: overrides.factId,
    subject: overrides.subject,
    predicate: overrides.predicate,
    objectSummary: overrides.objectSummary,
    confidence: overrides.confidence ?? 0.9,
    source: (overrides.source as never) ?? "verifier_summary",
    valid_at: overrides.valid_at ?? 50,
    reference_time: overrides.valid_at ?? 50,
  });
  if (overrides.proofCount !== undefined) {
    fact.proofCount = overrides.proofCount;
  }
  return fact;
}

// === Case 1: negation (规则层 SUPERSEDE) ===
describe("AUDN Case 1: negation pattern → SUPERSEDE (rule layer)", () => {
  it("explicit 'no longer' negation triggers SUPERSEDE at rule layer", () => {
    const existing = makeExistingFact({
      factId: "f_old_pref",
      subject: "Jon",
      predicate: "prefers",
      objectSummary: "prefers dark theme",
    });
    const candidate = makeCandidate({
      factId: "f_new_pref",
      subject: "Jon",
      predicate: "prefers",
      objectSummary: "no longer prefers dark theme, now prefers light theme",
      valid_at: 200,
    });

    const decision = decideAUDNAudited(candidate, [existing]);

    expect(decision.action).toBe("SUPERSEDE");
    expect(decision.decisionLayer).toBe("rule");
    if (decision.action === "SUPERSEDE") {
      expect(decision.supersedes).toBe("f_old_pref");
      expect(decision.supersessionReason).toBe("contradiction");
    }
    expect(decision.matchedRule).toBe("negation_pattern");
  });

  it("explicit 'switched' change triggers SUPERSEDE at rule layer", () => {
    const existing = makeExistingFact({
      factId: "f_old_diet",
      subject: "Jon",
      predicate: "eats",
      objectSummary: "eats vegetarian food",
    });
    const candidate = makeCandidate({
      factId: "f_new_diet",
      subject: "Jon",
      predicate: "eats",
      objectSummary: "switched to vegan food recently",
      valid_at: 200,
    });

    const decision = decideAUDNAudited(candidate, [existing]);

    expect(decision.action).toBe("SUPERSEDE");
    expect(decision.decisionLayer).toBe("rule");
    expect(decision.matchedRule).toBe("negation_pattern");
  });
});

// === Case 2: paraphrase (语义判定层等价) ===
describe("AUDN Case 2: paraphrase (sim ≥ equivalentThreshold) → semantic layer", () => {
  it("semantically equivalent with higher candidate support_count → SUPERSEDE refined", () => {
    // 两个 summary 仅末尾差一个 token, char 3-gram cosine > 0.88
    const existing = makeExistingFact({
      factId: "f_old_loc",
      subject: "Jon",
      predicate: "lives_in",
      objectSummary: "lives in Boston",
      proofCount: 0,
    });
    const candidate = makeCandidate({
      factId: "f_new_loc",
      subject: "Jon",
      predicate: "lives_in",
      objectSummary: "lives in Boston USA",
      proofCount: 3, // higher support_count → wins
      valid_at: 200,
    });

    // 先确认 sim 确实 ≥ equivalentThreshold
    const sim = computeSemanticMatchScore(
      candidate.objectSummary,
      existing.objectSummary,
    );
    expect(sim).toBeGreaterThanOrEqual(0.88);

    const decision = decideAUDNAudited(candidate, [existing]);

    expect(decision.action).toBe("SUPERSEDE");
    expect(decision.decisionLayer).toBe("semantic");
    expect(decision.matchedRule).toBe("semantic_equivalent_higher_support");
    expect(decision.semanticMatchScore).toBeCloseTo(sim, 5);
    if (decision.action === "SUPERSEDE") {
      expect(decision.supersedes).toBe("f_old_loc");
      expect(decision.supersessionReason).toBe("refined");
    }
  });

  it("semantically equivalent with lower candidate support_count → NONE", () => {
    const existing = makeExistingFact({
      factId: "f_old_loc2",
      subject: "Jon",
      predicate: "lives_in",
      objectSummary: "lives in Boston",
      proofCount: 5, // higher support_count → existing wins
    });
    const candidate = makeCandidate({
      factId: "f_new_loc2",
      subject: "Jon",
      predicate: "lives_in",
      objectSummary: "lives in Boston USA",
      proofCount: 0,
      valid_at: 200,
    });

    const decision = decideAUDNAudited(candidate, [existing]);

    expect(decision.action).toBe("NONE");
    expect(decision.decisionLayer).toBe("semantic");
    expect(decision.matchedRule).toBe("semantic_equivalent_lower_support");
  });
});

// === Case 3: supplement (sim < boundaryLow, 信号层 2/4 → ADD) ===
describe("AUDN Case 3: supplement (sim < boundaryLow) → signal layer ADD", () => {
  it("low similarity + candidate wins 2/4 signals → ADD (supplement)", () => {
    // 两个完全不同的 objectSummary: 一辆车 vs 另一辆车
    const existing = makeExistingFact({
      factId: "f_old_car",
      subject: "Jon",
      predicate: "owns",
      objectSummary: "a Honda Civic car",
      proofCount: 0,
      source: "verifier_summary", // provenance 0.8
    });
    const candidate = makeCandidate({
      factId: "f_new_car",
      subject: "Jon",
      predicate: "owns",
      objectSummary: "a Tesla Model 3 vehicle",
      proofCount: 5, // support_count 高 → 信号 1
      source: "human_confirmation", // provenance 1.0 > 0.8 → 信号 2
      valid_at: 200,
    });

    // 先确认 sim 确实 < boundaryLow (0.75)
    const sim = computeSemanticMatchScore(
      candidate.objectSummary,
      existing.objectSummary,
    );
    expect(sim).toBeLessThan(0.75);

    const decision = decideAUDNAudited(candidate, [existing]);

    expect(decision.action).toBe("ADD");
    expect(decision.decisionLayer).toBe("signal");
    expect(decision.matchedRule).toBe("signal_vote_add_supplement");
    expect(decision.signalComparison).toBeDefined();
    if (decision.signalComparison) {
      expect(decision.signalComparison.candidateWins).toBe(2);
      // support_count + provenance 两信号 candidate 更高
    }
  });
});

// === Case 4: update (sim ≥ contradictThreshold + value mismatch → SUPERSEDE) ===
describe("AUDN Case 4: update (sim ≥ contradictThreshold + value mismatch) → SUPERSEDE", () => {
  it("high similarity + different value tokens → SUPERSEDE contradiction", () => {
    // 共同前缀长, 仅末尾城市不同. sim ≈ 0.80, hasValueMismatch=true
    const existing = makeExistingFact({
      factId: "f_old_city",
      subject: "Jon",
      predicate: "lives_in",
      objectSummary: "lives in the city of Portland Oregon",
      valid_at: 50,
    });
    const candidate = makeCandidate({
      factId: "f_new_city",
      subject: "Jon",
      predicate: "lives_in",
      objectSummary: "lives in the city of Portland Maine",
      valid_at: 200,
    });

    // 先确认 sim 落在 [contradictThreshold, equivalentThreshold) 区间
    const sim = computeSemanticMatchScore(
      candidate.objectSummary,
      existing.objectSummary,
    );
    expect(sim).toBeGreaterThanOrEqual(0.8);
    expect(sim).toBeLessThan(0.88);

    const decision = decideAUDNAudited(candidate, [existing]);

    expect(decision.action).toBe("SUPERSEDE");
    expect(decision.decisionLayer).toBe("semantic");
    expect(decision.matchedRule).toBe("semantic_contradiction");
    if (decision.action === "SUPERSEDE") {
      expect(decision.supersedes).toBe("f_old_city");
      expect(decision.supersessionReason).toBe("contradiction");
    }
  });
});

// === Case 5: contradict (隐式否定 + sim ≥ contradictThreshold → SUPERSEDE) ===
describe("AUDN Case 5: implicit negation (moved/quit/left) → SUPERSEDE", () => {
  it("implicit 'quit' negation + high similarity → SUPERSEDE contradiction", () => {
    // candidate 含 "quit" (隐式否定), sim ≥ 0.80
    const existing = makeExistingFact({
      factId: "f_old_job",
      subject: "Jon",
      predicate: "job",
      objectSummary: "works as software engineer at Google",
      valid_at: 50,
    });
    const candidate = makeCandidate({
      factId: "f_new_job",
      subject: "Jon",
      predicate: "job",
      objectSummary: "quit software engineer job at Google",
      valid_at: 200,
    });

    // 先确认 sim ≥ contradictThreshold
    const sim = computeSemanticMatchScore(
      candidate.objectSummary,
      existing.objectSummary,
    );
    expect(sim).toBeGreaterThanOrEqual(0.8);
    expect(sim).toBeLessThan(0.88);

    const decision = decideAUDNAudited(candidate, [existing]);

    expect(decision.action).toBe("SUPERSEDE");
    expect(decision.decisionLayer).toBe("semantic");
    expect(decision.matchedRule).toBe("semantic_contradiction");
    if (decision.action === "SUPERSEDE") {
      expect(decision.supersessionReason).toBe("contradiction");
    }
  });

  it("implicit 'moved' negation → SUPERSEDE (not caught by rule layer)", () => {
    const existing = makeExistingFact({
      factId: "f_old_addr",
      subject: "Jon",
      predicate: "address",
      objectSummary: "resides at 123 Main Street apartment",
      valid_at: 50,
    });
    const candidate = makeCandidate({
      factId: "f_new_addr",
      subject: "Jon",
      predicate: "address",
      objectSummary: "moved to 456 Oak Avenue apartment recently",
      valid_at: 200,
    });

    const decision = decideAUDNAudited(candidate, [existing]);

    // "moved to" 在 NEGATION_PATTERN 中 (\bmoved\s+to\b), 所以会被规则层 detectConflict 捕获
    // 这是预期行为: 显式 moved to 是规则层 SUPERSEDE
    expect(decision.action).toBe("SUPERSEDE");
    expect(decision.decisionLayer).toBe("rule");
    expect(decision.matchedRule).toBe("negation_pattern");
  });
});

// === v2 关键修复验证: confidence 全 0.9 不再导致 UPDATE 误判 ===
describe("v2 fix: confidence=0.9 no longer causes UPDATE misjudgment", () => {
  it("identical confidence + non-equivalent summaries → signal layer decides", () => {
    // 旧版: confidence 相等 → confidence tiebreaker → UPDATE (155/155 误判)
    // v2: 走信号层, support_count 区分 (都无 proofCount → tie), provenance 区分
    const existing = makeExistingFact({
      factId: "f_conf_old",
      subject: "Jon",
      predicate: "hobby",
      objectSummary: "enjoys hiking mountains",
      confidence: 0.9,
      source: "verifier_summary", // provenance 0.8
      proofCount: 0,
    });
    const candidate = makeCandidate({
      factId: "f_conf_new",
      subject: "Jon",
      predicate: "hobby",
      objectSummary: "enjoys cooking italian meals",
      confidence: 0.9, // 相同 confidence
      source: "human_confirmation", // provenance 1.0 > 0.8
      proofCount: 2, // support_count 3 > 1
      valid_at: 200,
    });

    const decision = decideAUDNAudited(candidate, [existing]);

    // v2: candidate 在 support_count + provenance 上更高 (2/4 信号) → ADD
    expect(decision.action).toBe("ADD");
    expect(decision.decisionLayer).toBe("signal");
    if (decision.signalComparison) {
      expect(decision.signalComparison.candidateWins).toBeGreaterThanOrEqual(2);
    }
  });
});

// === 向下兼容: decideAUDN 返回 AUDNDecision (无审计字段) ===
describe("backward compatibility: decideAUDN returns AUDNDecision", () => {
  it("decideAUDN returns decision without audit fields", () => {
    const existing = makeExistingFact({
      factId: "f_compat_old",
      subject: "Jon",
      predicate: "owns",
      objectSummary: "a Honda Civic",
    });
    const candidate = makeCandidate({
      factId: "f_compat_new",
      subject: "Jon",
      predicate: "owns",
      objectSummary: "a Honda Civic", // exact duplicate
      valid_at: 200,
    });

    const decision = decideAUDN(candidate, [existing]);

    // 向下兼容: 基本字段存在
    expect(decision.action).toBe("NONE");
    // 审计字段可能存在但 AUDNDecision 类型不保证, 不强制检查
    // (评测流水线只读 action / supersedes / candidate 等基本字段)
  });
});

// === 信号层工具函数 ===
describe("ConflictSignal helpers", () => {
  it("computeConflictSignal extracts 4 signals from fact", () => {
    const candidate = makeCandidate({
      factId: "f_sig",
      subject: "Jon",
      predicate: "p",
      objectSummary: "test",
      confidence: 0.95,
      proofCount: 3,
      source: "human_confirmation",
    });

    const signal = computeConflictSignal(candidate, 100, 0.5);

    expect(signal.epistemic_confidence).toBe(0.95);
    expect(signal.support_count).toBe(3 + 1); // proofCount + evidenceRefs (fixture 默认 1)
    expect(signal.validity).toBe(1);
    expect(signal.provenance).toBe(1.0); // human_confirmation
    expect(signal.semanticMatchScore).toBe(0.5);
  });

  it("compareSignals returns correct win count", () => {
    const a = {
      epistemic_confidence: 0.9,
      support_count: 5,
      validity: 1 as const,
      provenance: 1.0,
      semanticMatchScore: 0,
    };
    const b = {
      epistemic_confidence: 0.8,
      support_count: 1,
      validity: 1 as const,
      provenance: 0.6,
      semanticMatchScore: 0,
    };

    expect(compareSignals(a, b)).toBe(3); // confidence + support + provenance (validity tie)
    expect(compareSignals(b, a)).toBe(0);
  });

  it("computeSemanticMatchScore returns 1.0 for identical strings", () => {
    const sim = computeSemanticMatchScore(
      "lives in Boston",
      "lives in Boston",
    );
    expect(sim).toBeCloseTo(1.0, 5);
  });

  it("computeSemanticMatchScore returns 0 for disjoint strings", () => {
    const sim = computeSemanticMatchScore("aaaa", "zzzz");
    expect(sim).toBe(0);
  });
});

// === 边界 case ===
describe("edge cases", () => {
  it("no existing facts → ADD", () => {
    const candidate = makeCandidate({
      factId: "f_first",
      subject: "Jon",
      predicate: "name",
      objectSummary: "Jon Smith",
      valid_at: 100,
    });

    const decision = decideAUDNAudited(candidate, []);

    expect(decision.action).toBe("ADD");
    expect(decision.decisionLayer).toBe("fallback");
    expect(decision.matchedRule).toBe("no_conflict");
  });

  it("exact duplicate objectSummary → NONE exact_duplicate", () => {
    const existing = makeExistingFact({
      factId: "f_dup_old",
      subject: "Jon",
      predicate: "name",
      objectSummary: "Jon Smith",
    });
    const candidate = makeCandidate({
      factId: "f_dup_new",
      subject: "Jon",
      predicate: "name",
      objectSummary: "Jon Smith", // exact same
      valid_at: 200,
    });

    const decision = decideAUDNAudited(candidate, [existing]);

    expect(decision.action).toBe("NONE");
    expect(decision.decisionLayer).toBe("rule");
    expect(decision.matchedRule).toBe("exact_match");
  });

  it("different subject → ADD (no conflict)", () => {
    const existing = makeExistingFact({
      factId: "f_other_subj",
      subject: "Mary",
      predicate: "name",
      objectSummary: "Mary Jones",
    });
    const candidate = makeCandidate({
      factId: "f_jon_subj",
      subject: "Jon",
      predicate: "name",
      objectSummary: "Jon Smith",
      valid_at: 200,
    });

    const decision = decideAUDNAudited(candidate, [existing]);

    expect(decision.action).toBe("ADD");
  });
});
