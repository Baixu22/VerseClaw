import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  runStage1GoldenCodingTurn,
} from "./stage1-golden-run.js";

const tempRoots: string[] = [];
let workspace = "";
let stateDir = "";

function stage1RealEvidencePath(): string {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(testDir, "../../..");
  return (
    process.env.STAGE1_REAL_EVIDENCE_PATH ??
    path.join(repoRoot, "artifacts", "context-control-plane", "stage1-real-run-evidence.json")
  );
}

function writeStage1RealEvidence(
  runId: string,
  result: Extract<Awaited<ReturnType<typeof runStage1GoldenCodingTurn>>, { ok: true }>,
): void {
  const evidencePath = stage1RealEvidencePath();
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  // Redacted evidence only: no API key, no prompt text, no tool arguments or output.
  fs.writeFileSync(
    evidencePath,
    `${JSON.stringify({
      schema: "Stage1RealRunEvidence/v1",
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage1-golden-"));
  tempRoots.push(root);
  workspace = path.join(root, "workspace");
  stateDir = path.join(root, "state");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
});

afterEach(async () => {
  const { closeOpenClawStateDatabase } = await import("../state/openclaw-state-db.js");
  closeOpenClawStateDatabase();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("stage1 golden runner preflight", () => {
  it("refuses to start without an API key without contacting the network", async () => {
    const original = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "";
    try {
      const result = await runStage1GoldenCodingTurn({
        sessionKey: "sess:golden-preflight",
        runId: "run:golden-preflight",
        workspaceRoot: workspace,
        sentinelPath: "sentinel.txt",
        sentinelContent: "no-key",
      });
      expect(result).toMatchObject({ ok: false, reason: "api-key-missing" });
    } finally {
      if (original === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = original;
    }
  });

  it("rejects workspace-escaped sentinel paths before any provider call", async () => {
    const result = await runStage1GoldenCodingTurn({
      apiKey: "fixture-key",
      sessionKey: "sess:golden-preflight",
      runId: "run:golden-preflight",
      workspaceRoot: workspace,
      sentinelPath: "../escape.txt",
      sentinelContent: "no-write",
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid-workspace-path" });
  });

  it.runIf(Boolean(process.env.DEEPSEEK_API_KEY))(
    "real DeepSeek golden run: write -> Tool Guard -> journal -> EffectReceipt",
    async () => {
      const runId = `run:golden-real:${Date.now()}`;
      const result = await runStage1GoldenCodingTurn({
        database: { env: process.env, path: path.join(stateDir, "openclaw-state.db") },
        sessionKey: "sess:golden-real",
        runId,
        workspaceRoot: workspace,
        sentinelPath: "stage1-sentinel.txt",
        sentinelContent: `stage1-real-${Date.now()}`,
      });
      if (!result.ok) {
        throw new Error(`real golden run failed: reason=${result.reason} message=${result.message ?? ""}`);
      }
      expect(result.model).toBe("deepseek/deepseek-v4-flash");
      expect(result.envelopeDigest).toBeDefined();
      expect(result.wireDigest).toBeDefined();
      expect(result.journalRef).toBeDefined();
      expect(result.census.acceptanceReady).toBe(true);
      expect(fs.readFileSync(path.join(workspace, "stage1-sentinel.txt"), "utf8"))
        .toMatch(/^stage1-real-/);
      writeStage1RealEvidence(runId, result);
    },
  );
});
