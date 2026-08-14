// @vitest-environment node
// KE-P1-2: shadow receipt persistence (ReceiptStore -> runtime_receipts SQLite, re-read).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReceiptStore } from "../../openclaw_runtime/src/agents/receipt-store";
import { closeOpenClawStateDatabase } from "../../openclaw_runtime/src/state/openclaw-state-db";
import {
  persistKeRetrievalShadowReceipt,
  runKeRetrievalShadow,
  type KeRetrievalCandidate,
} from "../../openclaw_runtime/src/runtime-core/ke-retrieval-shadow";

const RETR_ON = { runtime: { coding: { sekb: { retrievalShadow: true } } } };

const tempRoots: string[] = [];
let stateDir = "";

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ke-receipt-"));
  tempRoots.push(root);
  stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, "home");
  process.env.OPENCLAW_STATE_DIR = stateDir;
});

afterEach(() => {
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_CONFIG_PATH;
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function candidates(): KeRetrievalCandidate[] {
  return [
    { envelopeId: "sekb:principle:pr_1", contentVersion: "sha256:1", text: "review before durable writes", tags: [], quality: { criticality: "high", pinned: true } },
  ];
}

function context() {
  return {
    taskId: "task_1",
    taskType: "codegen",
    runId: "run_1",
    sessionKey: "session_1",
    configDigest: "sha256:cfg",
    contextTags: [],
  };
}

describe("KE-P1-2 shadow receipt persistence", () => {
  it("persists the shadow_context receipt to runtime_receipts and re-reads it", () => {
    const receiptStore = new ReceiptStore({ env: process.env, path: path.join(stateDir, "openclaw-state.db") });
    const result = runKeRetrievalShadow(RETR_ON, "review durable writes", candidates(), context(), 3);
    expect(result.receipt).not.toBeNull();

    const outcome = persistKeRetrievalShadowReceipt(result, receiptStore);
    expect(outcome).toMatchObject({ ok: true, inserted: true });

    // Re-read from SQLite (external re-read, not self-report).
    const reRead = receiptStore.getByIdempotencyKey(result.receipt!.idempotencyKey);
    expect(reRead).toBeDefined();
    expect(reRead!.kind).toBe("shadow_context");
    expect(reRead!.run_id).toBe("run_1");
    // selected refs persisted (digest/refs only, no raw body).
    expect(reRead!.selected_json).toContain("ref:context:sekb:principle:pr_1:1");
    expect(reRead!.content_digest).toBeTruthy();
  });

  it("returns null and writes nothing when the shadow produced no receipt", () => {
    const receiptStore = new ReceiptStore({ env: process.env, path: path.join(stateDir, "openclaw-state.db") });
    const off = runKeRetrievalShadow({}, "review durable writes", candidates(), context(), 3);
    expect(off.receipt).toBeNull();
    expect(persistKeRetrievalShadowReceipt(off, receiptStore)).toBeNull();
    // zero rows written for the shadow kind.
    expect(receiptStore.list({ kind: "shadow_context" })).toHaveLength(0);
  });
});
