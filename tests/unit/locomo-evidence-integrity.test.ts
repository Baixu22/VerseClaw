// @vitest-environment node
// Synthetic payloads below exercise the validator only. They are NOT benchmark runs or adopted baselines.
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { assertLocomoReportConsistency, assertVerifiedLocomoReport, collectLocomoSources, createLocomoProvenance, expectedLocomoQuestions, sha256, verifyLocomoEvidenceFile, writeLocomoReport } from "../../scripts/check-locomo-evidence.mjs";
import { buildSotaComparison, computeEscalationMetrics } from "./helpers/locomo-pipeline";
import { FROZEN_JUDGE_CONFIG, FROZEN_JUDGE_INTERPRETATION } from "./helpers/runtime-memory-judge-freeze";
import { DEFAULT_SAMPLE_SEED, DEFAULT_SAMPLE_SIZES } from "./helpers/runtime-memory-dev-slice";
import { loadBaselineReport } from "./helpers/locomo-report-comparator";

const root = process.cwd();
const output = mkdtempSync(join(tmpdir(), "locomo-synthetic-validator-"));
afterAll(() => {
  if (dirname(resolve(output)) !== resolve(tmpdir()) || !basename(output).startsWith("locomo-synthetic-validator-")) throw new Error("Unsafe test cleanup target");
  rmSync(output, { recursive: true, force: true });
});
const now = Date.now();
const provider = { endpoint: "https://synthetic-provider.invalid/v1/chat/completions", model: FROZEN_JUDGE_CONFIG.model };
const provenance = { ...createLocomoProvenance(provider, root), actor: "synthetic-unit-test-fixture-not-a-run", startedAt: new Date(now - 1000).toISOString() };
const questionResults = expectedLocomoQuestions(root).map((row, index) => ({ ...row, predictedAnswer: row.groundTruth, judgeScore: 1, recall5: 0, contextRecall: 0, retrievedFactSummaries: [], assembledContext: "", escalationLevel: index < 50 ? 2 : index < 100 ? 1 : 0 }));
const partitions = computeEscalationMetrics(questionResults);
const modelReceipts = Array.from({ length: 1000 }, (_, index) => ({
  completedAt: new Date(now).toISOString(), endpoint: provider.endpoint, requestedModel: provider.model, returnedModel: provider.model,
  responseId: "synthetic-response-" + index, requestSha256: sha256("synthetic request " + index), responseSha256: sha256("synthetic response " + index), status: 200, attempts: 1,
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
}));
function fixture() {
  return structuredClone({
    schemaVersion: 2, evidenceClass: "synthetic", provenance, dataset: "locomo", version: "11.0-measurement-integrity",
    totalQuestions: 500, retrievalMode: "Synthetic validator input only; not a retrieval experiment.", judgeModel: provider.model,
    judgeConfig: FROZEN_JUDGE_CONFIG, judgeInterpretation: FROZEN_JUDGE_INTERPRETATION,
    scoreAttribution: "Overall includes L2; the L0+L1 subset is selection-biased.",
    metric: "Synthetic values for validator unit coverage only.", metricDefinitions: { context_recall: "gold-turn-lexical-coverage-v2-empty-as-miss" },
    sampleSeed: DEFAULT_SAMPLE_SEED, sampleSizes: DEFAULT_SAMPLE_SIZES,
    metrics: { overall: { j_score: 1, recall_at_5: 0, context_recall: 0, escalation_rate: 0.2, full_conversation_rate: 0.1, cost_per_run_estimate_usd: 0 },
      byCategory: Object.fromEntries(Object.entries(DEFAULT_SAMPLE_SIZES).map(([category, count]) => [category, { j_score: 1, recall_at_5: 0, context_recall: 0, count }])),
      memory_only: partitions.memoryOnly, by_escalation_level: partitions.byLevel },
    escalation: { totalQuestions: 500, level0: 400, level1: 50, level2: 50, level0_rate: 0.8, level1_rate: 0.1, level2_rate: 0.1, full_conversation_rate: 0.1, capped: 0, fullConversationCapped: 0, maxEscalations: 125, maxFullConversationEscalations: 75, escalationRate: 0.2, fullConversationRate: 0.1 },
    errorTaxonomy: { overall: { not_retrieved: 0, retrieved_not_used: 0, used_but_misreasoned: 0, judge_error: 0 }, byCategory: {} },
    extraction: { factsCachePath: "synthetic-fixture-only", cachedConversations: 0, freshConversations: 0, totalChunks: 0, parseFailures: 0, parseSuccessRate: 0, conversations: [] },
    cost: { estimateUsd: 0, projectedFullRunEstimateUsd: 0, deepSeekUsage: { calls: 1000, promptTokens: 1000, completionTokens: 1000, totalTokens: 2000 } },
    comparison: buildSotaComparison(1), sampleResults: questionResults.slice(0, 20), judgeSanityCandidates: [], questionResults, modelReceipts,
    cacheUsage: { judgeCacheHits: 0, judgeCacheMisses: 500, cachedRetrieval: false }, generatedAt: new Date(now).toISOString(),
  });
}

describe("LoCoMo run evidence integrity (#138)", () => {
  it("checks a fully populated synthetic input structurally without claiming a real run occurred", () => {
    expect(assertLocomoReportConsistency(fixture(), { root, now })).toMatchObject({ consistent: true, totalQuestions: 500, modelCalls: 1000 });
    expect(() => assertVerifiedLocomoReport(fixture(), { root, now })).toThrow("Not a measured");
    expect(expectedLocomoQuestions(root)).toHaveLength(500);
    expect(collectLocomoSources(root)).toHaveProperty("tests/unit/helpers/runtime-memory-context-recall.ts");
  });
  it.each(["locomo-full-500-report.json", "locomo-full-500-report-phase3-baseline.json", "locomo-full-500-report-phase4.0-regression.json"])("rejects historical aggregate %s", (file) => {
    const old = JSON.parse(readFileSync(join(root, "tests/fixtures/runtime-memory-eval", file), "utf8"));
    expect(() => assertVerifiedLocomoReport(old, { root, now })).toThrow("Not a measured");
  });
  it("rejects an artifact whose sources have changed", () => {
    const report = fixture();
    report.provenance.sources["tests/unit/helpers/runtime-memory-context-recall.ts"] = "0".repeat(64);
    expect(() => assertLocomoReportConsistency(report, { root, now })).toThrow("source freshness");
  });
  it("rejects stale timestamps and dataset substitutions", () => {
    expect(() => assertLocomoReportConsistency(fixture(), { root, now: now + 31 * 86400000 })).toThrow("Stale");
    const report = fixture(); report.provenance.dataset.sha256 = "0".repeat(64);
    expect(() => assertLocomoReportConsistency(report, { root, now })).toThrow("dataset provenance");
  });
  it("rejects missing, duplicate or cherry-picked question rows", () => {
    const short = fixture(); short.questionResults.pop();
    expect(() => assertLocomoReportConsistency(short, { root, now })).toThrow("Every sampled");
    const duplicate = fixture(); duplicate.questionResults[1] = duplicate.questionResults[0];
    expect(() => assertLocomoReportConsistency(duplicate, { root, now })).toThrow("Duplicate");
    const swapped = fixture(); swapped.questionResults[0].groundTruth = "invented ground truth";
    expect(() => assertLocomoReportConsistency(swapped, { root, now })).toThrow("dataset question groundTruth");
  });
  it("recomputes retrieval and context metrics instead of trusting score literals", () => {
    const retrieval = fixture(); retrieval.questionResults[0].recall5 = 1;
    expect(() => assertLocomoReportConsistency(retrieval, { root, now })).toThrow("retrieval proxy");
    const context = fixture(); context.questionResults[0].contextRecall = 1;
    expect(() => assertLocomoReportConsistency(context, { root, now })).toThrow("resolved context recall");
  });
  it("rejects missing, duplicated, mixed-model or unrelated-run receipts", () => {
    const missing = fixture(); missing.modelReceipts = [];
    expect(() => assertLocomoReportConsistency(missing, { root, now })).toThrow("model request receipts");
    const duplicate = fixture(); duplicate.modelReceipts[1] = duplicate.modelReceipts[0];
    expect(() => assertLocomoReportConsistency(duplicate, { root, now })).toThrow("duplicated model receipt");
    const mixed = fixture(); mixed.modelReceipts[0].returnedModel = "other-model";
    expect(() => assertLocomoReportConsistency(mixed, { root, now })).toThrow("model receipt");
    const previous = fixture(); previous.modelReceipts[0].completedAt = new Date(now - 5000).toISOString();
    expect(() => assertLocomoReportConsistency(previous, { root, now })).toThrow("outside this run");
  });
  it("keeps write failures visible and verifies the on-disk digest before baseline adoption", () => {
    const file = join(output, "synthetic-fixture.json");
    writeLocomoReport(fixture(), file);
    expect(() => writeLocomoReport(fixture(), file)).toThrow();
    expect(readFileSync(file + ".sha256", "utf8")).toContain(sha256(readFileSync(file)));
    expect(() => verifyLocomoEvidenceFile(file, { root, now })).toThrow("Not a measured");
    expect(() => loadBaselineReport(output, "synthetic-fixture.json")).toThrow("Not a measured");
    // A forged classification must still fail the unchanged digest; no synthetic file is adopted.
    writeFileSync(file, readFileSync(file, "utf8").replace('"evidenceClass": "synthetic"', '"evidenceClass": "real-model-evaluation"'));
    expect(() => verifyLocomoEvidenceFile(file, { root, now })).toThrow("SHA256");
  });
  it("makes the full-run command fail instead of silently skipping when embedding credentials are absent", () => {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/run-locomo-full-evaluation.mjs"], { cwd: root, windowsHide: true, encoding: "utf8", env: { ...process.env,
      RUNTIME_MEMORY_LLM_API_KEY: "synthetic-not-a-credential", RUNTIME_MEMORY_LLM_BASE_URL: "https://synthetic-provider.invalid/v1", SILICONFLOW_API_KEY: "", DEEPSEEK_API_KEY: "" } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SILICONFLOW_API_KEY required");
  });
});
