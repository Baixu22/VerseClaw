// Phase 4: Unified Judge 单元测试
//
// 覆盖：
// 1. buildUnifiedJudgePrompt — base rules + category-specific rules
// 2. getCategorySpecificPrompt — 5 类 category 各自的规则
// 3. parseUnifiedJudgeVerdict — CORRECT/WRONG/ambiguous 解析
// 4. deterministicJudge — 子串匹配 / 数字匹配 / 不匹配
// 5. compareJudgeResults — sanity check 工具
// 6. judgeWithUnifiedPrompt — 无 key 时回退到 deterministicJudge

import { describe, expect, it } from "vitest";
import {
  buildUnifiedJudgePrompt,
  compareJudgeResults,
  deterministicJudge,
  getCategorySpecificPrompt,
  judgeWithUnifiedPrompt,
  parseUnifiedJudgeVerdict,
  UNIFIED_JUDGE_CONFIG,
} from "./unified-judge";

// === buildUnifiedJudgePrompt ===

describe("Unified Judge — buildUnifiedJudgePrompt", () => {
  it("包含 base rules（partial credit, time tolerance, paraphrases）", () => {
    const { system } = buildUnifiedJudgePrompt(
      "test question",
      "gold answer",
      "predicted answer",
    );
    // P0 #5: 升级到 7 规则全大写命名（PARTIAL CREDIT / PARAPHRASES COUNT / DATE TOLERANCE / TIME TOLERANCE）
    expect(system).toMatch(/PARTIAL CREDIT/i);
    expect(system).toContain("14 days");
    expect(system).toMatch(/PARAPHRASES/i);
    expect(system).toContain("CORRECT");
    expect(system).toContain("WRONG");
    // 新增的 generous 规则
    expect(system).toMatch(/EXTRA DETAIL IS FINE/i);
    expect(system).toMatch(/SEMANTIC OVERLAP/i);
    expect(system).toMatch(/SAME REFERENT/i);
    expect(system).toMatch(/FOCUS ON KNOWLEDGE/i);
    expect(system).toMatch(/UNANSWERABLE/i);
  });

  it("无 category 时不包含 category-specific rules", () => {
    const { system } = buildUnifiedJudgePrompt(
      "test",
      "gold",
      "predicted",
    );
    expect(system).not.toContain("Temporal-reasoning");
    expect(system).not.toContain("Multi-hop reasoning");
    expect(system).not.toContain("Open-domain");
  });

  it("temporal category 包含 off-by-one day tolerance", () => {
    const { system } = buildUnifiedJudgePrompt(
      "When did Alice start?",
      "2023-05",
      "May 2023",
      "temporal",
    );
    expect(system).toContain("off-by-one day tolerance");
    expect(system).toContain("Year-only matches");
  });

  it("multi_hop category 包含 intermediate hops rule", () => {
    const { system } = buildUnifiedJudgePrompt(
      "Compare Alice and Bob",
      "Both engineers",
      "They are engineers",
      "multi_hop",
    );
    expect(system).toContain("Multi-hop reasoning");
    expect(system).toContain("Intermediate hops");
  });

  it("adversarial category 包含 refuse-to-answer rule", () => {
    const { system } = buildUnifiedJudgePrompt(
      "What color is the sky?",
      "I don't know",
      "Blue",
      "adversarial",
    );
    expect(system).toContain("refuse to answer");
    expect(system).toContain("unanswerable");
  });

  it("user prompt 包含 question/ground truth/predicted answer", () => {
    const { user } = buildUnifiedJudgePrompt(
      "What is Alice's job?",
      "Engineer",
      "Software engineer",
      "single_hop",
    );
    expect(user).toContain("What is Alice's job?");
    expect(user).toContain("Engineer");
    expect(user).toContain("Software engineer");
    expect(user).toContain("CORRECT/WRONG");
  });
});

// === getCategorySpecificPrompt ===

describe("Unified Judge — getCategorySpecificPrompt", () => {
  it("temporal 包含 off-by-one day", () => {
    const prompt = getCategorySpecificPrompt("temporal");
    expect(prompt).toContain("off-by-one day");
  });

  it("open_domain 包含 30% coverage", () => {
    const prompt = getCategorySpecificPrompt("open_domain");
    expect(prompt).toContain("30%");
  });

  it("adversarial 包含 refuse-to-answer", () => {
    const prompt = getCategorySpecificPrompt("adversarial");
    expect(prompt).toContain("refuse to answer");
  });
});

// === parseUnifiedJudgeVerdict ===

describe("Unified Judge — parseUnifiedJudgeVerdict", () => {
  it("解析 CORRECT（多种格式）", () => {
    expect(parseUnifiedJudgeVerdict("CORRECT").verdict).toBe("CORRECT");
    expect(parseUnifiedJudgeVerdict("Correct").verdict).toBe("CORRECT");
    expect(parseUnifiedJudgeVerdict("correct").verdict).toBe("CORRECT");
    expect(parseUnifiedJudgeVerdict("yes").verdict).toBe("CORRECT");
    expect(parseUnifiedJudgeVerdict("YES").verdict).toBe("CORRECT");
    expect(parseUnifiedJudgeVerdict("true").verdict).toBe("CORRECT");
  });

  it("解析 WRONG（多种格式）", () => {
    expect(parseUnifiedJudgeVerdict("WRONG").verdict).toBe("WRONG");
    expect(parseUnifiedJudgeVerdict("Wrong").verdict).toBe("WRONG");
    expect(parseUnifiedJudgeVerdict("wrong").verdict).toBe("WRONG");
    expect(parseUnifiedJudgeVerdict("no").verdict).toBe("WRONG");
    expect(parseUnifiedJudgeVerdict("NO").verdict).toBe("WRONG");
    expect(parseUnifiedJudgeVerdict("false").verdict).toBe("WRONG");
    expect(parseUnifiedJudgeVerdict("incorrect").verdict).toBe("WRONG");
  });

  it("模糊响应默认 WRONG 且低 confidence", () => {
    const result = parseUnifiedJudgeVerdict("maybe?");
    expect(result.verdict).toBe("WRONG");
    expect(result.confidence).toBe(0.5);
  });

  it("带前后空白的响应正确解析", () => {
    expect(parseUnifiedJudgeVerdict("  CORRECT  ").verdict).toBe("CORRECT");
    expect(parseUnifiedJudgeVerdict("\nWRONG\n").verdict).toBe("WRONG");
  });
});

// === deterministicJudge ===

describe("Unified Judge — deterministicJudge", () => {
  it("子串匹配 → CORRECT（双向）", () => {
    // gold 是 pred 的子串
    expect(deterministicJudge("Alice is an engineer", "engineer").verdict).toBe("CORRECT");
    // pred 是 gold 的子串
    expect(deterministicJudge("engineer", "Alice is an engineer").verdict).toBe("CORRECT");
  });

  it("大小写不敏感", () => {
    expect(deterministicJudge("ENGINEER", "engineer").verdict).toBe("CORRECT");
    expect(deterministicJudge("Alice", "ALICE").verdict).toBe("CORRECT");
  });

  it("数字匹配 → CORRECT（≥50% gold 数字）", () => {
    expect(deterministicJudge("20 days", "20").verdict).toBe("CORRECT");
    expect(deterministicJudge("It was 2023", "2023").verdict).toBe("CORRECT");
  });

  it("不匹配 → WRONG", () => {
    expect(deterministicJudge("Alice is a teacher", "Bob is an engineer").verdict).toBe("WRONG");
    expect(deterministicJudge("hello", "world").verdict).toBe("WRONG");
  });

  it("空输入 → WRONG", () => {
    expect(deterministicJudge("", "gold").verdict).toBe("WRONG");
    expect(deterministicJudge("pred", "").verdict).toBe("WRONG");
  });
});

// === compareJudgeResults ===

describe("Unified Judge — compareJudgeResults", () => {
  it("计算一致率", () => {
    const unified = [
      { verdict: "CORRECT" as const, confidence: 1.0 },
      { verdict: "WRONG" as const, confidence: 1.0 },
      { verdict: "CORRECT" as const, confidence: 1.0 },
    ];
    const frozen = [
      { score: 1 },
      { score: 0 },
      { score: 0 }, // 不一致：unified=CORRECT, frozen=WRONG
    ];

    const result = compareJudgeResults(unified, frozen);
    expect(result.total).toBe(3);
    expect(result.agreementRate).toBeCloseTo(2 / 3, 5);
    expect(result.unifiedMoreGenerous).toBe(1); // unified=CORRECT, frozen=WRONG
    expect(result.unifiedMoreStrict).toBe(0);
  });

  it("空数组返回 0", () => {
    const result = compareJudgeResults([], []);
    expect(result.total).toBe(0);
    expect(result.agreementRate).toBe(0);
  });

  it("unified 更严格 case 计数", () => {
    const unified = [
      { verdict: "WRONG" as const, confidence: 1.0 },
      { verdict: "CORRECT" as const, confidence: 1.0 },
    ];
    const frozen = [
      { score: 1 }, // unified=WRONG, frozen=CORRECT → unified 更严格
      { score: 1 }, // 一致
    ];

    const result = compareJudgeResults(unified, frozen);
    expect(result.unifiedMoreStrict).toBe(1);
    expect(result.unifiedMoreGenerous).toBe(0);
    expect(result.agreementRate).toBeCloseTo(0.5, 5);
  });
});

// === judgeWithUnifiedPrompt（无 key 时回退） ===

describe("Unified Judge — judgeWithUnifiedPrompt", () => {
  // CI 环境无 DEEPSEEK_API_KEY，应回退到 deterministicJudge
  it("无 API key 时回退到 deterministicJudge（子串匹配 → CORRECT）", async () => {
    const result = await judgeWithUnifiedPrompt(
      "What is Alice's job?",
      "engineer",
      "Alice is an engineer",
      "single_hop",
    );
    expect(result.verdict).toBe("CORRECT");
  });

  it("无 API key 时回退到 deterministicJudge（不匹配 → WRONG）", async () => {
    const result = await judgeWithUnifiedPrompt(
      "What is Alice's job?",
      "engineer",
      "teacher",
      "single_hop",
    );
    expect(result.verdict).toBe("WRONG");
  });

  it("空 query 或 predictedAnswer → WRONG", async () => {
    const r1 = await judgeWithUnifiedPrompt("", "gold", "pred");
    expect(r1.verdict).toBe("WRONG");
    const r2 = await judgeWithUnifiedPrompt("question", "gold", "");
    expect(r2.verdict).toBe("WRONG");
  });

  it("config 覆盖 votingEnabled=false 不影响无 key 时的回退", async () => {
    const result = await judgeWithUnifiedPrompt(
      "What is Alice's job?",
      "engineer",
      "engineer",
      "single_hop",
      { votingEnabled: false },
    );
    expect(result.verdict).toBe("CORRECT");
  });
});

// === UNIFIED_JUDGE_CONFIG 常量 ===

describe("Unified Judge — UNIFIED_JUDGE_CONFIG", () => {
  it("默认配置正确", () => {
    expect(UNIFIED_JUDGE_CONFIG.promptVersion).toBe("unified-v2-generous-7rules-2026-07-05");
    expect(UNIFIED_JUDGE_CONFIG.temperature).toBe(0);
    expect(UNIFIED_JUDGE_CONFIG.votingEnabled).toBe(true);
    expect(UNIFIED_JUDGE_CONFIG.voteCount).toBe(3);
    expect(UNIFIED_JUDGE_CONFIG.voteAgreementThreshold).toBe(2);
  });
});
