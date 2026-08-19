/**
 * Stage 5 L7 soak runner tests. Real provider path is default off and only
 * runs when DEEPSEEK_API_KEY is visible to this process. It never logs or
 * persists the key and writes digest/ref/metric-only evidence.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { runStage2GoldenCodingTurn } from "./stage2-golden-run.js";
import { runStage5GoldenCodingTurn } from "./stage5-golden-run.js";
import {
  projectStage5L7SoakMetrics,
  STAGE5_L7_SOAK_SCHEMA,
  type Stage5L7SoakSample,
} from "./stage5-l7-soak.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../../..");
const EVIDENCE_PATH = process.env.STAGE5_L7_SOAK_EVIDENCE_PATH
  ?? path.join(REPO_ROOT, "artifacts", "context-control-plane", "stage5-l7-soak-evidence.json");

const tempRoots: string[] = [];

function makePairRoot(pairId: string): {
  workspace: string;
  stateDir: string;
  archiveRoot: string;
  root: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `stage5-l7-soak-${pairId}-`));
  tempRoots.push(root);
  const workspace = path.join(root, "workspace");
  const stateDir = path.join(root, "state");
  const archiveRoot = path.join(root, "archive");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(archiveRoot, { recursive: true });
  return { root, workspace, stateDir, archiveRoot };
}

afterEach(async () => {
  const { closeOpenClawStateDatabase } = await import("../state/openclaw-state-db.js");
  closeOpenClawStateDatabase();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("stage5-l7-soak preflight", () => {
  it("refuses to start without api key", async () => {
    const result = await runStage5GoldenCodingTurn({
      apiKey: "",
      stage5Observations: true,
      sessionKey: "sess:soak-preflight",
      runId: "run:soak-preflight",
      workspaceRoot: "workspace",
      sentinelPath: "sentinel.txt",
      sentinelContent: "no-key",
    });
    expect(result).toMatchObject({ ok: false, reason: "api-key-missing" });
  });

  it("rejects workspace-escaped sentinel paths before network", async () => {
    const result = await runStage5GoldenCodingTurn({
      apiKey: "fixture-key",
      stage5Observations: true,
      sessionKey: "sess:soak-preflight",
      runId: "run:soak-preflight",
      workspaceRoot: "workspace",
      sentinelPath: "../escape.txt",
      sentinelContent: "no-write",
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid-workspace-path" });
  });
});

describe("stage5-l7-soak pure metrics", () => {
  it("computes p95 and retention, and rejects duplicate run ids / invalid values", () => {
    const samples: Stage5L7SoakSample[] = [];
    for (let i = 0; i < 10; i += 1) {
      samples.push({
        runId: `run:base:${i}`,
        pairId: `pair:${i}`,
        arm: "baseline",
        model: "deepseek/deepseek-v4-flash",
        effectReceiptId: `efx:${i}`,
        envelopeDigest: `sha256:${"a".repeat(64)}`,
        totalCompileLatencyMs: 10 + i,
        turnLatencyMs: 1_000 + i,
        totalTokens: 100 + i,
        invalidReasons: [],
      });
      samples.push({
        runId: `run:exp:${i}`,
        pairId: `pair:${i}`,
        arm: "experiment",
        model: "deepseek/deepseek-v4-flash",
        effectReceiptId: `efx:exp:${i}`,
        envelopeDigest: `sha256:${"a".repeat(64)}`,
        totalCompileLatencyMs: 12 + i,
        turnLatencyMs: 1_200 + i,
        totalTokens: 120 + i,
        packStatus: "ok",
        criticalPlanned: 1,
        criticalSelected: 1,
        constraintPlanned: 1,
        constraintSelected: 1,
        evidencePlanned: 1,
        evidenceSelected: 1,
        invalidReasons: [],
      });
    }
    const verdict = projectStage5L7SoakMetrics(samples);
    expect(verdict.pass).toBe(true);
    expect(verdict.summary.samples).toBe(20);
    expect(verdict.summary.pairs).toBe(10);
    expect(verdict.summary.experimentSamples).toBe(10);
    expect(verdict.summary.criticalRetention).toBe(1);
    expect(verdict.summary.constraintRetention).toBe(1);
    expect(verdict.summary.evidenceRetention).toBe(1);
    expect(verdict.summary.p95TotalCompileLatencyMs).toBe(20);

    expect(() => projectStage5L7SoakMetrics([...samples, samples[0]])).toThrow("duplicate-run-id");
    expect(() => projectStage5L7SoakMetrics([{ ...samples[0], runId: "run:negative", turnLatencyMs: -1 }])).toThrow("invalid-turn-latency");
  });

  it("fails closed when retention or thresholds are below owner baseline", () => {
    const verdict = projectStage5L7SoakMetrics([{
      runId: "run:exp:only",
      pairId: "pair:only",
      arm: "experiment",
      model: "deepseek/deepseek-v4-flash",
      effectReceiptId: "efx:only",
      envelopeDigest: `sha256:${"a".repeat(64)}`,
      totalCompileLatencyMs: 150,
      turnLatencyMs: 10_000,
      totalTokens: 4_500,
      packStatus: "failed",
      criticalPlanned: 1,
      criticalSelected: 0,
      constraintPlanned: 1,
      constraintSelected: 1,
      evidencePlanned: 1,
      evidenceSelected: 1,
      invalidReasons: ["critical-over-window:stage5:user-intent"],
    }]);
    expect(verdict.pass).toBe(false);
    expect(verdict.failures).toEqual(expect.arrayContaining([
      expect.stringContaining("min-pairs"),
      expect.stringContaining("min-experiment-samples"),
      expect.stringContaining("invalid-samples"),
      expect.stringContaining("critical-retention"),
      expect.stringContaining("p95-compile-latency"),
      expect.stringContaining("p95-turn-tokens"),
    ]));
  });
});

describe("stage5-l7-soak real provider path", () => {
  it.runIf(Boolean(process.env.DEEPSEEK_API_KEY))(
    "10 paired baseline/experiment real DeepSeek turns meet owner baseline",
    async () => {
      const apiKey = (process.env.DEEPSEEK_API_KEY ?? "").trim();
      const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? "https://z30.top/v1").trim();
      const modelId = (process.env.DEEPSEEK_MODEL_ID ?? "deepseek-v4-flash").trim();
      const samples: Stage5L7SoakSample[] = [];
      const usages = new Map<string, { prompt_tokens?: number; completion_tokens?: number }>();
      let activeRunId = "";
      const originalFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = (async (input, init) => {
        const response = await originalFetch(input, init);
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : String(input);
        if (url.includes("/chat/completions")) {
          try {
            const body = await response.clone().json() as { usage?: { prompt_tokens?: number; completion_tokens?: number } };
            if (body.usage) usages.set(activeRunId, body.usage);
          } catch {
            // usage is optional; metrics remain token-null and fail closed if required.
          }
        }
        return response;
      }) as typeof fetch;

      try {
        for (let pairIndex = 1; pairIndex <= 10; pairIndex += 1) {
          const pairId = `pair-${pairIndex}`;
          const { workspace, stateDir, archiveRoot } = makePairRoot(pairId);
          const common = {
            apiKey,
            baseUrl,
            modelId,
            collectTimings: true,
            database: { env: process.env, path: path.join(stateDir, "openclaw-state.db") },
            sessionKey: `sess:soak:${pairIndex}`,
            workspaceRoot: workspace,
            taskLedgerWorkspaceId: `stage5-l7-soak:${pairIndex}`,
            taskLedgerStateDir: stateDir,
            toolResultArchiveRoot: archiveRoot,
          };

          // Baseline arm: accepted Stage 2 chain, Stage 5 flag off.
          const baselineRunId = `run:soak:base:${Date.now()}:${pairIndex}`;
          activeRunId = baselineRunId;
          const baselineStartedAt = Date.now();
          const baseline = await runStage2GoldenCodingTurn({
            ...common,
            runId: baselineRunId,
            stage2Dcs: true,
            sentinelPath: `soak-${pairIndex}-baseline.txt`,
            sentinelContent: `soak-baseline-${pairIndex}-${Date.now()}`,
            prompt: `Call the write tool exactly once. path must be ${JSON.stringify(`soak-${pairIndex}-baseline.txt`)} and content must start with ${JSON.stringify(`soak-baseline-${pairIndex}`)}. Do not call any other tool.`,
          });
          const baselineLatencyMs = Date.now() - baselineStartedAt;
          if (!baseline.ok) throw new Error(`baseline pair ${pairIndex} failed: ${baseline.reason} ${baseline.message ?? ""}`);
          const baselineUsage = usages.get(baselineRunId);
          samples.push({
            runId: baselineRunId,
            pairId,
            arm: "baseline",
            model: baseline.model,
            toolCallId: baseline.toolCallId,
            effectReceiptId: baseline.effectReceiptId,
            journalRef: baseline.journalRef,
            envelopeDigest: baseline.envelopeDigest,
            prePlanDigest: baseline.prePlanDigest,
            postPlanDigest: baseline.postPlanDigest,
            preCompileLatencyMs: baseline.timings?.preCompileLatencyMs,
            postCompileLatencyMs: baseline.timings?.postCompileLatencyMs,
            totalCompileLatencyMs: baseline.timings?.totalCompileLatencyMs,
            turnLatencyMs: baselineLatencyMs,
            promptTokens: baselineUsage?.prompt_tokens,
            completionTokens: baselineUsage?.completion_tokens,
            totalTokens: baselineUsage ? (baselineUsage.prompt_tokens ?? 0) + (baselineUsage.completion_tokens ?? 0) : undefined,
            invalidReasons: baseline.envelopeDigest && baseline.journalRef && baseline.timings ? [] : ["baseline-invalid"],
          });

          // Experiment arm: same chain + Stage 5 observation/packer/facade.
          const experimentRunId = `run:soak:exp:${Date.now()}:${pairIndex}`;
          activeRunId = experimentRunId;
          const experimentStartedAt = Date.now();
          const experiment = await runStage5GoldenCodingTurn({
            ...common,
            runId: experimentRunId,
            stage5Observations: true,
            sentinelPath: `soak-${pairIndex}-experiment.txt`,
            sentinelContent: `soak-experiment-${pairIndex}-${Date.now()}`,
            prompt: `Call the write tool exactly once. path must be ${JSON.stringify(`soak-${pairIndex}-experiment.txt`)} and content must start with ${JSON.stringify(`soak-experiment-${pairIndex}`)}. Do not call any other tool.`,
          });
          const experimentLatencyMs = Date.now() - experimentStartedAt;
          if (!experiment.ok) throw new Error(`experiment pair ${pairIndex} failed: ${experiment.reason} ${experiment.message ?? ""}`);
          const experimentUsage = usages.get(experimentRunId);
          const pack = experiment.observation.pack;
          const invalidReasons: string[] = [];
          if (pack.status !== "ok") invalidReasons.push(`pack:${pack.status}`);
          if (!experiment.stage2.effectReceiptId || !experiment.stage2.toolCallId || !experiment.stage2.journalRef || !experiment.stage2.envelopeDigest) invalidReasons.push("experiment-invalid");
          samples.push({
            runId: experimentRunId,
            pairId,
            arm: "experiment",
            model: experiment.model,
            toolCallId: experiment.stage2.toolCallId,
            effectReceiptId: experiment.stage2.effectReceiptId,
            journalRef: experiment.stage2.journalRef,
            envelopeDigest: experiment.stage2.envelopeDigest,
            prePlanDigest: experiment.stage2.prePlanDigest,
            postPlanDigest: experiment.stage2.postPlanDigest,
            preCompileLatencyMs: experiment.timings?.preCompileLatencyMs,
            postCompileLatencyMs: experiment.timings?.postCompileLatencyMs,
            totalCompileLatencyMs: experiment.timings?.totalCompileLatencyMs,
            turnLatencyMs: experimentLatencyMs,
            promptTokens: experimentUsage?.prompt_tokens,
            completionTokens: experimentUsage?.completion_tokens,
            totalTokens: experimentUsage ? (experimentUsage.prompt_tokens ?? 0) + (experimentUsage.completion_tokens ?? 0) : undefined,
            packStatus: pack.status,
            criticalPlanned: 1,
            criticalSelected: pack.selected.includes("stage5:user-intent") ? 1 : 0,
            constraintPlanned: 1,
            constraintSelected: pack.selected.includes("stage5:write-tool-schema") ? 1 : 0,
            evidencePlanned: 1,
            evidenceSelected: pack.selected.includes("stage5:effect-receipt") ? 1 : 0,
            invalidReasons,
          });

          expect(fs.readFileSync(path.join(workspace, `soak-${pairIndex}-baseline.txt`), "utf8")).toMatch(new RegExp(`^soak-baseline-${pairIndex}`));
          expect(fs.readFileSync(path.join(workspace, `soak-${pairIndex}-experiment.txt`), "utf8")).toMatch(new RegExp(`^soak-experiment-${pairIndex}`));

          const { closeOpenClawStateDatabase } = await import("../state/openclaw-state-db.js");
          closeOpenClawStateDatabase();
          const pairRoot = path.dirname(stateDir);
          fs.rmSync(pairRoot, { recursive: true, force: true });
          tempRoots.splice(tempRoots.indexOf(pairRoot), 1);
        }

        const verdict = projectStage5L7SoakMetrics(samples);
        const evidence = {
          schema: STAGE5_L7_SOAK_SCHEMA,
          generatedAt: new Date().toISOString(),
          model: `deepseek/${modelId}`,
          runId: `run:stage5-l7-soak:${Date.now()}`,
          samples: samples.map((sample) => ({
            runId: sample.runId,
            pairId: sample.pairId,
            arm: sample.arm,
            model: sample.model,
            toolCallId: sample.toolCallId ?? null,
            effectReceiptId: sample.effectReceiptId ?? null,
            journalRef: sample.journalRef ?? null,
            envelopeDigest: sample.envelopeDigest ?? null,
            prePlanDigest: sample.prePlanDigest ?? null,
            postPlanDigest: sample.postPlanDigest ?? null,
            preCompileLatencyMs: sample.preCompileLatencyMs ?? null,
            postCompileLatencyMs: sample.postCompileLatencyMs ?? null,
            totalCompileLatencyMs: sample.totalCompileLatencyMs ?? null,
            turnLatencyMs: sample.turnLatencyMs,
            promptTokens: sample.promptTokens ?? null,
            completionTokens: sample.completionTokens ?? null,
            totalTokens: sample.totalTokens ?? null,
            packStatus: sample.packStatus ?? null,
            criticalPlanned: sample.criticalPlanned ?? null,
            criticalSelected: sample.criticalSelected ?? null,
            constraintPlanned: sample.constraintPlanned ?? null,
            constraintSelected: sample.constraintSelected ?? null,
            evidencePlanned: sample.evidencePlanned ?? null,
            evidenceSelected: sample.evidenceSelected ?? null,
            invalidReasons: [...sample.invalidReasons],
          })),
          verdict,
        };
        fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
        fs.writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
        expect(verdict.pass).toBe(true);
        if (!verdict.pass) throw new Error(`soak verdict failed: ${verdict.failures.join(", ")}`);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
    600_000,
  );
});
