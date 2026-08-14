// R3-2.1: memory-injection receipt actually lands in the ReceiptStore (SQLite).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistMemoryInjectionReceipt } from "../../openclaw_runtime/src/context-engine/memory-injection-receipt";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";

const tempRoots: string[] = [];
let stateDir = "";

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "r3-2-receipt-"));
  tempRoots.push(root);
  stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, "home");
  process.env.OPENCLAW_STATE_DIR = stateDir;
});

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const DIGEST = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("R3-2: memory injection receipt persistence", () => {
  it("persists a sanitized receipt and reports persisted:true", () => {
    const result = persistMemoryInjectionReceipt({
      identity: {
        runtimeMode: "source",
        sessionKey: "s1",
        runId: "r1",
        providerId: "compass",
        adapterId: "compass-pre-reply-retrieval",
      },
      callIndex: { attemptIndex: 0, modelCallIndex: 0, wireAttemptIndex: 0 },
      correlationDigest: DIGEST,
      summary: {
        selectedFactIds: ["fact-a"],
        omittedFactIds: ["fact-b"],
        selectedChars: 40,
        requestedChars: 40,
        source: "compass-pre-reply-retrieval",
      },
      database: { env: process.env, path: path.join(stateDir, "openclaw-state.db") },
    });
    expect(result.persisted).toBe(true);
  });

  it("returns persisted:false when the database cannot open (observational, no throw)", () => {
    // A regular file as the parent directory makes SQLite open fail.
    const blocker = path.join(stateDir, "blocker");
    fs.writeFileSync(blocker, "x");
    const result = persistMemoryInjectionReceipt({
      identity: {
        runtimeMode: "source",
        providerId: "compass",
        adapterId: "compass-pre-reply-retrieval",
      },
      callIndex: { attemptIndex: 0, modelCallIndex: 0, wireAttemptIndex: 0 },
      correlationDigest: DIGEST,
      summary: {
        selectedFactIds: [],
        omittedFactIds: [],
        selectedChars: 0,
        requestedChars: 0,
        source: "compass-pre-reply-retrieval",
      },
      database: { env: process.env, path: path.join(blocker, "nope.db") },
    });
    expect(result.persisted).toBe(false);
  });
});
