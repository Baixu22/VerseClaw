import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  runStage2GoldenCodingTurn,
  type Stage2GoldenRunResult,
} from "./stage2-golden-run.js";

const tempRoots: string[] = [];
let workspace = "";
let stateDir = "";
let archiveRoot = "";

function stage2RealEvidencePath(): string {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(testDir, "../../..");
  return (
    process.env.STAGE2_REAL_EVIDENCE_PATH ??
    path.join(repoRoot, "artifacts", "context-control-plane", "stage2-real-run-evidence.json")
  );
}

function writeStage2RealEvidence(
  runId: string,
  result: Extract<Stage2GoldenRunResult, { ok: true }>,
): void {
  const evidencePath = stage2RealEvidencePath();
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(
    evidencePath,
    `${JSON.stringify({
      schema: "Stage2RealRunEvidence/v1",
      generatedAt: new Date().toISOString(),
      model: result.model,
      runId,
      toolCallId: result.toolCallId,
      approvalId: result.approvalId,
      effectReceiptId: result.effectReceiptId,
      journalRef: result.journalRef ?? null,
      envelopeDigest: result.envelopeDigest ?? null,
      envelopeRef: result.envelopeRef ?? null,
      wireReceiptId: result.wireReceiptId ?? null,
      wireDigest: result.wireDigest ?? null,
      preSnapshotId: result.preSnapshotId,
      preSnapshotDigest: result.preSnapshotDigest,
      prePlanId: result.prePlanId,
      prePlanDigest: result.prePlanDigest,
      postSnapshotId: result.postSnapshotId,
      postSnapshotDigest: result.postSnapshotDigest,
      postPlanId: result.postPlanId,
      postPlanDigest: result.postPlanDigest,
      postContextRefKinds: result.postContextRefKinds,
      postSelectedRefIds: result.postSelectedRefIds,
      census: {
        failedWrites: result.census.failedWrites,
        acceptanceReady: result.census.acceptanceReady,
      },
    }, null, 2)}
`,
    "utf8",
  );
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage2-golden-"));
  tempRoots.push(root);
  workspace = path.join(root, "workspace");
  stateDir = path.join(root, "state");
  archiveRoot = path.join(root, "archive");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(archiveRoot, { recursive: true });
});

afterEach(async () => {
  const { closeOpenClawStateDatabase } = await import("../state/openclaw-state-db.js");
  closeOpenClawStateDatabase();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("stage2 golden runner preflight", () => {
  it("defaults flag off and refuses to start without API key", async () => {
    const original = process.env.OPENCLAW_STAGE2_DCS;
    delete process.env.OPENCLAW_STAGE2_DCS;
    try {
      const off = await runStage2GoldenCodingTurn({
        sessionKey: "sess:stage2-preflight",
        runId: "run:stage2-preflight",
        workspaceRoot: workspace,
        sentinelPath: "sentinel.txt",
        sentinelContent: "off",
      });
      expect(off).toMatchObject({ ok: false, reason: "stage2-flag-off" });
    } finally {
      if (original === undefined) delete process.env.OPENCLAW_STAGE2_DCS;
      else process.env.OPENCLAW_STAGE2_DCS = original;
    }
  });

  it("refuses missing key and workspace escape before network", async () => {
    const missingKey = await runStage2GoldenCodingTurn({
      apiKey: "",
      stage2Dcs: true,
      sessionKey: "sess:stage2-preflight",
      runId: "run:stage2-preflight",
      workspaceRoot: workspace,
      sentinelPath: "sentinel.txt",
      sentinelContent: "no-key",
    });
    expect(missingKey).toMatchObject({ ok: false, reason: "api-key-missing" });

    const escaped = await runStage2GoldenCodingTurn({
      apiKey: "fixture-key",
      stage2Dcs: true,
      sessionKey: "sess:stage2-preflight",
      runId: "run:stage2-preflight",
      workspaceRoot: workspace,
      sentinelPath: "../escape.txt",
      sentinelContent: "no-write",
    });
    expect(escaped).toMatchObject({ ok: false, reason: "invalid-workspace-path" });
  });
});

describe("stage2 golden runner real DeepSeek path", () => {
  it.runIf(Boolean(process.env.DEEPSEEK_API_KEY))(
    "real run: three ContextRef kinds -> pre/post DCS compile -> real write effect",
    async () => {
      const runId = `run:stage2-golden:${Date.now()}`;
      const result = await runStage2GoldenCodingTurn({
        apiKey: process.env.DEEPSEEK_API_KEY,
        stage2Dcs: true,
        database: { env: process.env, path: path.join(stateDir, "openclaw-state.db") },
        sessionKey: "sess:stage2-golden",
        runId,
        workspaceRoot: workspace,
        sentinelPath: "stage2-sentinel.txt",
        sentinelContent: `stage2-real-${Date.now()}`,
        taskLedgerWorkspaceId: "stage2-golden",
        taskLedgerStateDir: stateDir,
        toolResultArchiveRoot: archiveRoot,
      });
      if (!result.ok) {
        throw new Error(
          `stage2 real golden run failed: reason=${result.reason} message=${result.message ?? ""}`,
        );
      }
      expect(result.model).toBe("deepseek/deepseek-v4-flash");
      expect(result.envelopeDigest).toBeDefined();
      expect(result.wireDigest).toBeDefined();
      expect(result.journalRef).toBeDefined();
      expect(result.census.acceptanceReady).toBe(true);
      expect(result.preSnapshotDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.postSnapshotDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.postContextRefKinds).toEqual([
        "task_ledger",
        "tool_result",
        "user_intent",
      ]);
      expect(result.postSelectedRefIds).toHaveLength(3);
      expect(result.preEvidenceRecovered).toBe(true);
      expect(result.postEvidenceRecovered).toBe(true);
      expect(
        fs.readFileSync(path.join(workspace, "stage2-sentinel.txt"), "utf8"),
      ).toMatch(/^stage2-real-/);
      writeStage2RealEvidence(runId, result);
    },
    120_000,
  );
});
