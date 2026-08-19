import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  runStage3GoldenCodingTurn,
  type Stage3GoldenRunResult,
} from "./stage3-golden-run.js";

const tempRoots: string[] = [];
let workspace = "";
let stateDir = "";
let archiveRoot = "";

function evidencePath(): string {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(testDir, "../../../..");
  return (
    process.env.STAGE3_REAL_EVIDENCE_PATH ??
    path.join(repoRoot, "artifacts", "context-control-plane", "stage3-real-run-evidence.json")
  );
}

function writeEvidence(runId: string, result: Extract<Stage3GoldenRunResult, { ok: true }>): void {
  const target = evidencePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    `${JSON.stringify({
      schema: "Stage3RealRunEvidence/v1",
      generatedAt: new Date().toISOString(),
      model: result.model,
      runId,
      taskLedgerRootId: result.taskLedgerRootId,
      proposalId: result.proposalId,
      revisionBefore: result.revisionBefore ?? null,
      revisionAfter: result.revisionAfter ?? null,
      stage2: result.stage2,
    }, null, 2)}
`,
    "utf8",
  );
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage3-golden-"));
  tempRoots.push(root);
  workspace = path.join(root, "workspace");
  stateDir = path.join(root, "state");
  archiveRoot = path.join(root, "archive");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(archiveRoot, { recursive: true });
});

afterEach(async () => {
  const { closeOpenClawStateDatabase } = await import("../../state/openclaw-state-db.js");
  closeOpenClawStateDatabase();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("stage3 golden runner preflight", () => {
  it("defaults flag off and refuses missing key before network", async () => {
    const original = process.env.OPENCLAW_STAGE3_TASK_LEDGER_WC;
    delete process.env.OPENCLAW_STAGE3_TASK_LEDGER_WC;
    try {
      const off = await runStage3GoldenCodingTurn({
        sessionKey: "sess:stage3-preflight",
        runId: "run:stage3-preflight",
        workspaceRoot: workspace,
        sentinelPath: "sentinel.txt",
        sentinelContent: "off",
      });
      expect(off).toMatchObject({ ok: false, reason: "stage3-flag-off" });

      const missingKey = await runStage3GoldenCodingTurn({
        apiKey: "",
        stage3WorkingContext: true,
        sessionKey: "sess:stage3-preflight",
        runId: "run:stage3-preflight",
        workspaceRoot: workspace,
        sentinelPath: "sentinel.txt",
        sentinelContent: "no-key",
      });
      expect(missingKey).toMatchObject({ ok: false, reason: "api-key-missing" });
    } finally {
      if (original === undefined) delete process.env.OPENCLAW_STAGE3_TASK_LEDGER_WC;
      else process.env.OPENCLAW_STAGE3_TASK_LEDGER_WC = original;
    }
  });

  it("refuses workspace escape before network", async () => {
    const escaped = await runStage3GoldenCodingTurn({
      apiKey: "fixture-key",
      stage3WorkingContext: true,
      sessionKey: "sess:stage3-preflight",
      runId: "run:stage3-preflight",
      workspaceRoot: workspace,
      sentinelPath: "../escape.txt",
      sentinelContent: "no-write",
    });
    expect(escaped).toMatchObject({ ok: false, reason: "invalid-workspace-path" });
  });
});

describe("stage3 golden runner real DeepSeek path", () => {
  it.runIf(Boolean(process.env.DEEPSEEK_API_KEY))(
    "real run: Stage 2 chain -> real ledger proposal/accept -> redacted evidence",
    async () => {
      const runId = `run:stage3-golden:${Date.now()}`;
      const result = await runStage3GoldenCodingTurn({
        apiKey: process.env.DEEPSEEK_API_KEY,
        stage3WorkingContext: true,
        database: { env: process.env, path: path.join(stateDir, "openclaw-state.db") },
        sessionKey: "sess:stage3-golden",
        runId,
        workspaceRoot: workspace,
        sentinelPath: "stage3-sentinel.txt",
        sentinelContent: `stage3-real-${Date.now()}`,
        taskLedgerWorkspaceId: "stage3-golden",
        taskLedgerStateDir: stateDir,
        toolResultArchiveRoot: archiveRoot,
      });
      if (!result.ok) {
        throw new Error(
          `stage3 real golden run failed: reason=${result.reason} message=${result.message ?? ""}`,
        );
      }
      expect(result.model).toBe("deepseek/deepseek-v4-flash");
      expect(result.revisionBefore?.eventCount).toBeGreaterThanOrEqual(2);
      expect(result.revisionAfter?.eventCount).toBe((result.revisionBefore?.eventCount ?? 0) + 2);
      expect(result.revisionAfter?.revision).toMatch(/^rev_\d+_[a-f0-9]{16}$/);
      expect(result.stage2.toolCallId).toBeTruthy();
      expect(result.stage2.effectReceiptId).toBeTruthy();
      expect(
        fs.readFileSync(path.join(workspace, "stage3-sentinel.txt"), "utf8"),
      ).toMatch(/^stage3-real-/);
      writeEvidence(runId, result);
    },
    120_000,
  );
});
