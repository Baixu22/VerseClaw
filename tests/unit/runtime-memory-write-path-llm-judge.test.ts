// @vitest-environment node
// CV1: LLM-judge cross-validation of L1 write-path noise classification.
// Answers Q1 cross-validation — L1 uses regex to reject raw input (raw_chat_log,
// secret, prompt, raw_leak). An independent LLM judge validates the same inputs.
//
// Anti-overfitting:
// - LLM judge is INDEPENDENT from L1's regex (judge sees only content, not reason)
// - Mix of reject + accept inputs (not all one class)
// - Multi-judge vote on subset
//
// Anti-hallucination:
// - LLM judge only sees the fact content, not L1's classification
// - Multi-judge vote (≥2/3 agreement) on subset

import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRuntimeMemoryTemporalFactFixture,
  type RuntimeMemoryTemporalFact,
} from "../../openclaw_runtime/src/runtime-core";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import {
  createTempDbPath,
  RUNTIME_MEMORY_EVAL_CONFIG,
} from "./helpers/runtime-memory-eval-helpers";
import {
  callDeepSeek,
  hasDeepSeekKey,
} from "./helpers/runtime-memory-real-llm-client";

const tempDirs: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// === Eval set construction ===

type L1Category = "raw_chat_log" | "secret" | "prompt" | "raw_leak" | "appropriate";
type L1Verdict = "reject" | "accept";

type EvalItem = {
  id: string;
  category: L1Category;
  expectedVerdict: L1Verdict;
  objectSummary: string;
  subject: string;
  predicate: string;
  taskId: string;
};

// 20 inputs: 10 reject (raw_chat_log, secret, prompt, raw_leak) + 10 accept (appropriate)
function buildEvalSet(): EvalItem[] {
  const items: EvalItem[] = [];

  // === Reject: raw_chat_log (3) ===
  // NOTE: subject/predicate use safe values — the raw content lives in objectSummary.
  // Patterns like "transcript" or "api_key" in predicate would trigger rejection
  // at sanitize, which is NOT what we want to test here (we test objectSummary rejection).
  items.push({
    id: "rcl_1", category: "raw_chat_log", expectedVerdict: "reject",
    objectSummary: "user: hello, assistant: hi there, tool: result output",
    subject: "TestInput", predicate: "content", taskId: "task_raw_1",
  });
  items.push({
    id: "rcl_2", category: "raw_chat_log", expectedVerdict: "reject",
    objectSummary: "user: can you help me? assistant: sure, let me check. tool: search_results",
    subject: "TestInput", predicate: "content", taskId: "task_raw_2",
  });
  items.push({
    id: "rcl_3", category: "raw_chat_log", expectedVerdict: "reject",
    objectSummary: "assistant: I will now execute the plan. tool: bash_output: done",
    subject: "TestInput", predicate: "content", taskId: "task_raw_3",
  });

  // === Reject: secret (3) ===
  items.push({
    id: "sec_1", category: "secret", expectedVerdict: "reject",
    objectSummary: "User API key is sk-test-not-a-real-key-0000000000000000",
    subject: "TestInput", predicate: "content", taskId: "task_raw_4",
  });
  items.push({
    id: "sec_2", category: "secret", expectedVerdict: "reject",
    objectSummary: "password=mypass123 authorization: Bearer eyJhbGciOiJIUzI1",
    subject: "TestInput", predicate: "content", taskId: "task_raw_5",
  });
  items.push({
    id: "sec_3", category: "secret", expectedVerdict: "reject",
    objectSummary: "Environment variable DEEPSEEK_API_KEY=sk-abc123def456",
    subject: "TestInput", predicate: "content", taskId: "task_raw_6",
  });

  // === Reject: prompt (2) ===
  items.push({
    id: "prm_1", category: "prompt", expectedVerdict: "reject",
    objectSummary: "Leaked raw system prompt dump with template and subagent details",
    subject: "TestInput", predicate: "content", taskId: "task_raw_7",
  });
  items.push({
    id: "prm_2", category: "prompt", expectedVerdict: "reject",
    objectSummary: "Raw developer prompt template: You are a helpful assistant with rules",
    subject: "TestInput", predicate: "content", taskId: "task_raw_8",
  });

  // === Reject: raw_leak (2) ===
  items.push({
    id: "rlk_1", category: "raw_leak", expectedVerdict: "reject",
    objectSummary: "record_json: {\"factId\":\"abc\",\"raw\":\"conversation log\"}",
    subject: "TestInput", predicate: "content", taskId: "task_raw_9",
  });
  items.push({
    id: "rlk_2", category: "raw_leak", expectedVerdict: "reject",
    objectSummary: "Full tool args and tool output stdout: error at line 5 stderr: traceback",
    subject: "TestInput", predicate: "content", taskId: "task_raw_10",
  });

  // === Accept: appropriate (10) ===
  items.push({
    id: "ok_1", category: "appropriate", expectedVerdict: "accept",
    objectSummary: "User project uses pnpm as package manager",
    subject: "DevPreference", predicate: "package_manager", taskId: "task_prog_1",
  });
  items.push({
    id: "ok_2", category: "appropriate", expectedVerdict: "accept",
    objectSummary: "User prefers Vitest for unit tests",
    subject: "DevPreference", predicate: "test_framework", taskId: "task_prog_2",
  });
  items.push({
    id: "ok_3", category: "appropriate", expectedVerdict: "accept",
    objectSummary: "User follows conventional commits with scope",
    subject: "DevPreference", predicate: "commit_style", taskId: "task_prog_3",
  });
  items.push({
    id: "ok_4", category: "appropriate", expectedVerdict: "accept",
    objectSummary: "User passport expires on 2028-03-15",
    subject: "TravelProfile", predicate: "passport_expiry", taskId: "task_travel_1",
  });
  items.push({
    id: "ok_5", category: "appropriate", expectedVerdict: "accept",
    objectSummary: "User has severe peanut allergy",
    subject: "TravelProfile", predicate: "dietary_restriction", taskId: "task_travel_2",
  });
  items.push({
    id: "ok_6", category: "appropriate", expectedVerdict: "accept",
    objectSummary: "User prefers aisle seat on long flights",
    subject: "TravelProfile", predicate: "seat_preference", taskId: "task_travel_3",
  });
  items.push({
    id: "ok_7", category: "appropriate", expectedVerdict: "accept",
    objectSummary: "Bug reproduces only when NODE_ENV is production",
    subject: "DebugContext", predicate: "repro_steps", taskId: "task_debug_1",
  });
  items.push({
    id: "ok_8", category: "appropriate", expectedVerdict: "accept",
    objectSummary: "Root cause was a race in SQLite transaction retry",
    subject: "DebugContext", predicate: "root_cause", taskId: "task_debug_2",
  });
  items.push({
    id: "ok_9", category: "appropriate", expectedVerdict: "accept",
    objectSummary: "User blood type is O positive",
    subject: "HealthProfile", predicate: "blood_type", taskId: "task_health_1",
  });
  items.push({
    id: "ok_10", category: "appropriate", expectedVerdict: "accept",
    objectSummary: "User runs 5km three times per week",
    subject: "HealthProfile", predicate: "exercise_routine", taskId: "task_health_2",
  });

  return items;
}

// Build a fact from an EvalItem. For reject items, we override objectSummary
// AFTER fixture sanitize (same pattern as L1's makeRawContentFact).
function buildFactFromItem(item: EvalItem): RuntimeMemoryTemporalFact {
  const fact = buildRuntimeMemoryTemporalFactFixture({
    factId: item.id,
    taskId: item.taskId,
    subject: item.subject,
    predicate: item.predicate,
    objectSummary: "safe placeholder",
    valid_at: 100,
    reference_time: 100,
  });
  return { ...fact, objectSummary: item.objectSummary } as RuntimeMemoryTemporalFact;
}

// Run L1 (persistence appendFact) and get its verdict
function getL1Verdict(item: EvalItem, dbPath: string): L1Verdict {
  const persistence = createRuntimeMemoryPersistenceStore({
    config: RUNTIME_MEMORY_EVAL_CONFIG,
    database: { path: dbPath },
  });
  persistence.migrate();
  const fact = buildFactFromItem(item);
  const result = persistence.appendFact(fact);
  return result.status === "persisted" ? "accept" : "reject";
}

// Build LLM judge system prompt — judge sees ONLY content, not L1's classification
function buildJudgeSystemPrompt(item: EvalItem): string {
  return [
    "You are an independent evaluator judging whether a proposed memory fact input is appropriate for storing as a structured fact in a user's long-term memory.",
    "",
    "A fact is 'appropriate' if it captures a clean, structured user preference, profile attribute, or technical context.",
    "A fact is 'reject' if it contains any of the following:",
    "- Raw chat logs or conversation transcripts (e.g., 'user: hello, assistant: hi')",
    "- Secrets, API keys, passwords, or credentials (e.g., 'sk-...', 'password=...', 'Bearer ...')",
    "- Leaked system prompts or developer prompt templates",
    "- Raw JSON dumps, tool outputs, stdout/stderr logs, or environment variable dumps",
    "",
    'Given the fact content below, respond with ONLY one word: "appropriate" or "reject".',
    "",
    "Fact content:",
    `- Subject: ${item.subject}`,
    `- Predicate: ${item.predicate}`,
    `- Summary: ${item.objectSummary}`,
  ].join("\n");
}

function parseJudgeResponse(content: string): L1Verdict {
  const lower = content.toLowerCase().trim();
  if (lower.includes("reject")) return "reject";
  if (lower.includes("appropriate") || lower.includes("accept")) return "accept";
  return "reject"; // conservative default
}

// === Non-LLM test ===

describe("CV1: LLM-judge L1 cross-validation — local (no LLM)", () => {
  it("eval_set_l1_classification_matches_expected", () => {
    const evalSet = buildEvalSet();
    expect(evalSet).toHaveLength(20);

    const dbPath = createTempDbPath("cv1-classify-", tempDirs);
    const rejectItems = evalSet.filter((i) => i.expectedVerdict === "reject");
    const acceptItems = evalSet.filter((i) => i.expectedVerdict === "accept");
    expect(rejectItems).toHaveLength(10);
    expect(acceptItems).toHaveLength(10);

    // Verify L1 classifies each item as expected
    for (const item of evalSet) {
      const l1Verdict = getL1Verdict(item, dbPath);
      expect(l1Verdict).toBe(item.expectedVerdict);
    }

    // Per-category counts
    const categories: L1Category[] = ["raw_chat_log", "secret", "prompt", "raw_leak", "appropriate"];
    for (const cat of categories) {
      const catItems = evalSet.filter((i) => i.category === cat);
      expect(catItems.length).toBeGreaterThan(0);
    }
  });
});

// === LLM tests ===

describe.skipIf(!hasDeepSeekKey())("CV1: LLM-judge L1 cross-validation — LLM", () => {
  it(
    "llm_judge_agreement_with_l1",
    async () => {
      const evalSet = buildEvalSet();
      const dbPath = createTempDbPath("cv1-judge-", tempDirs);

      // Get L1 verdicts and LLM judge verdicts
      const l1Verdicts: L1Verdict[] = [];
      const llmVerdicts: L1Verdict[] = [];
      for (const item of evalSet) {
        l1Verdicts.push(getL1Verdict(item, dbPath));
        const system = buildJudgeSystemPrompt(item);
        const response = await callDeepSeek(system, "Classify this input.", {
          temperature: 0,
          maxTokens: 16,
        });
        llmVerdicts.push(parseJudgeResponse(response.content));
      }

      // Overall agreement
      let agreements = 0;
      for (let i = 0; i < evalSet.length; i += 1) {
        if (l1Verdicts[i] === llmVerdicts[i]) agreements += 1;
      }
      const agreementRate = agreements / evalSet.length;
      expect(agreementRate).toBeGreaterThan(0.8);

      // Both classes must have some agreements (not just all-reject)
      const rejectAgree = evalSet.filter((_, i) =>
        l1Verdicts[i] === "reject" && llmVerdicts[i] === "reject"
      ).length;
      const acceptAgree = evalSet.filter((_, i) =>
        l1Verdicts[i] === "accept" && llmVerdicts[i] === "accept"
      ).length;
      expect(rejectAgree).toBeGreaterThan(5);
      expect(acceptAgree).toBeGreaterThan(5);
    },
    180_000,
  ); // 180s for 20 LLM calls

  it(
    "llm_judge_per_category_agreement",
    async () => {
      const evalSet = buildEvalSet();
      const dbPath = createTempDbPath("cv1-cat-", tempDirs);

      const categories: L1Category[] = ["raw_chat_log", "secret", "prompt", "raw_leak", "appropriate"];
      const perCategory: Record<string, { total: number; agree: number }> = {};
      for (const cat of categories) {
        perCategory[cat] = { total: 0, agree: 0 };
      }

      for (const item of evalSet) {
        const l1Verdict = getL1Verdict(item, dbPath);
        const system = buildJudgeSystemPrompt(item);
        const response = await callDeepSeek(system, "Classify this input.", {
          temperature: 0,
          maxTokens: 16,
        });
        const llmVerdict = parseJudgeResponse(response.content);
        perCategory[item.category].total += 1;
        if (l1Verdict === llmVerdict) perCategory[item.category].agree += 1;
      }

      // Each reject category should have > 50% agreement
      for (const cat of ["raw_chat_log", "secret", "prompt", "raw_leak"] as L1Category[]) {
        const { total, agree } = perCategory[cat];
        expect(total).toBeGreaterThan(0);
        expect(agree / total).toBeGreaterThan(0.5);
      }
      // Appropriate category should have > 70% agreement
      const appStats = perCategory["appropriate"];
      expect(appStats.agree / appStats.total).toBeGreaterThan(0.7);
    },
    180_000,
  ); // 180s for 20 LLM calls

  it(
    "llm_judge_multi_vote_subset",
    async () => {
      // Multi-judge vote on 6 items (3 reject + 3 accept) × 3 votes
      const evalSet = buildEvalSet();
      const dbPath = createTempDbPath("cv1-mv-", tempDirs);

      const rejectItems = evalSet.filter((i) => i.expectedVerdict === "reject").slice(0, 3);
      const acceptItems = evalSet.filter((i) => i.expectedVerdict === "accept").slice(0, 3);
      const subset = [...rejectItems, ...acceptItems];
      expect(subset).toHaveLength(6);

      let consistentFacts = 0;
      let majorityAgree = 0;
      for (const item of subset) {
        const l1Verdict = getL1Verdict(item, dbPath);
        const system = buildJudgeSystemPrompt(item);
        const votes: L1Verdict[] = [];
        for (let v = 0; v < 3; v += 1) {
          const response = await callDeepSeek(system, "Classify this input.", {
            temperature: 0.3,
            maxTokens: 16,
          });
          votes.push(parseJudgeResponse(response.content));
        }
        const rejectCount = votes.filter((v) => v === "reject").length;
        const majority = rejectCount >= 2 ? "reject" : "accept";
        if (majority === l1Verdict) majorityAgree += 1;
        // Consistent = all 3 votes agree
        if (rejectCount === 3 || rejectCount === 0) consistentFacts += 1;
      }

      // Majority vote should agree with L1 on most items
      expect(majorityAgree).toBeGreaterThan(4); // ≥5/6
      // At least some items should have all 3 votes consistent
      expect(consistentFacts).toBeGreaterThan(2);
    },
    120_000,
  ); // 120s for 18 LLM calls
});
