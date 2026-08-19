import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { normalizeEffectReceipt } from "../../../shared/types/context-control-plane/artifacts.js";
import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { ApprovalLedger } from "./approval-ledger.js";
import {
  EffectReceiptStore,
  serializeStage1EffectContext,
} from "./effect-receipt.js";
import { projectStage1EffectReceipt } from "./stage1-effect-projection.js";

const tempRoots: string[] = [];
let stateDir = "";

function options() {
  return { env: process.env, path: path.join(stateDir, "openclaw-state.db") };
}

function stage1Input(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: "efx:stage1:key-1",
    approvalId: "aprv-stage1",
    proposal: { effect: { toolCallId: "tool-1", toolName: "write" } },
    approvalDecision: "approved" as const,
    domainExecutor: "stage1-write-tool-guard",
    outcome: "applied" as const,
    journalRef: "write-journal:sess:1",
    recoverability: "none-needed",
    stage1Context: {
      approvalPolicyDigest: "sha256:" + "a".repeat(64),
      actor: {
        sessionKey: "sess-stage1",
        runId: "run-stage1",
        attemptIndex: 0,
        modelCallIndex: 0,
        actorKind: "principal" as const,
      },
      effect: {
        toolCallId: "tool-1",
        toolName: "write",
        resource: "workspace:sentinel.txt",
        action: "write",
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage1-effect-"));
  tempRoots.push(root);
  stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  process.env.OPENCLAW_STATE_DIR = stateDir;
});

afterEach(() => {
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_STATE_DIR;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("stage1 EffectReceipt projection", () => {
  it("runtime-sanitizes effect_context_json so raw proposal/arguments/output cannot persist", () => {
    const serialized = serializeStage1EffectContext({
      approvalPolicyDigest: "sha256:" + "a".repeat(64),
      actor: {
        sessionKey: "sess-stage1",
        runId: "run-stage1",
        attemptIndex: 0,
        modelCallIndex: 0,
        actorKind: "principal",
      },
      effect: {
        toolCallId: "tool-1",
        toolName: "write",
        resource: "workspace:sentinel.txt",
        action: "write",
      },
      // These fields exist only to prove the runtime allowlist strips them.
      rawProposal: { content: "secret prompt" },
      toolArguments: { path: "sentinel.txt", content: "secret body" },
      toolOutput: "secret output",
    } as never);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      "actor",
      "approvalPolicyDigest",
      "effect",
    ]);
    expect(parsed.rawProposal).toBeUndefined();
    expect(parsed.toolArguments).toBeUndefined();
    expect(parsed.toolOutput).toBeUndefined();
    expect(parsed.effect).toMatchObject({ toolCallId: "tool-1", toolName: "write" });
  });

  it("projects a contract-valid EffectReceipt/v1 from digest-only row facts", () => {
    const store = new EffectReceiptStore(options());
    const recorded = store.record(stage1Input());
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    const row = store.getById(recorded.effectReceiptId);
    const projected = projectStage1EffectReceipt(row);
    expect(projected).toBeDefined();
    expect(() => normalizeEffectReceipt(projected)).not.toThrow();
    expect(projected?.effect.toolName).toBe("write");
    expect(projected?.journalRef).toBe("write-journal:sess:1");
  });

  it("keeps identical-content idempotency and rejects content-conflict", () => {
    const store = new EffectReceiptStore(options());
    const first = store.record(stage1Input());
    expect(first.ok).toBe(true);
    const same = store.record(stage1Input());
    expect(same).toMatchObject({ ok: true, duplicate: true, reason: "identical-content" });
    const conflict = store.record(stage1Input({ outcome: "unknown" }));
    expect(conflict).toMatchObject({ ok: false, duplicate: true, reason: "content-conflict" });
  });

  it("projects unknown outcomes without auto-replay semantics", () => {
    const store = new EffectReceiptStore(options());
    const recorded = store.record(stage1Input({ outcome: "unknown", journalRef: undefined, recoverability: "reconcile-from-journal" }));
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    const projected = projectStage1EffectReceipt(store.getById(recorded.effectReceiptId));
    expect(projected?.outcome).toBe("unknown");
    expect(projected?.recoverability).toBe("reconcile-from-journal");
  });

  it("restart reopen keeps rows queryable and old legacy rows do not project", () => {
    const store = new EffectReceiptStore(options());
    const recorded = store.record(stage1Input());
    if (!recorded.ok) throw new Error("record failed");
    const reopened = new EffectReceiptStore(options());
    expect(projectStage1EffectReceipt(reopened.getById(recorded.effectReceiptId))).toBeDefined();
    const legacy = reopened.record({
      idempotencyKey: "efx:legacy",
      approvalId: "aprv-legacy",
      proposal: { legacy: true },
      approvalDecision: "approved",
      domainExecutor: "legacy",
      outcome: "applied",
      recoverability: "none-needed",
    });
    if (!legacy.ok) throw new Error("legacy record failed");
    expect(projectStage1EffectReceipt(reopened.getById(legacy.effectReceiptId))).toBeUndefined();
  });

  it("records unknown outcome in the durable approval ledger without auto-replay", () => {
    const ledger = new ApprovalLedger(options());
    const reserved = ledger.reserve({
      idempotencyKey: "aprv-stage1-unknown",
      request: { effect: "unknown" },
      expiresAtMs: Date.now() + 60_000,
    });
    if (!reserved.ok) throw new Error("reserve failed");
    ledger.resolve({ approvalId: reserved.row.approval_id, decision: "approved", resolvedBy: "owner:stage1" });
    ledger.markExecutionStarted(reserved.row.approval_id);
    const recorded = new EffectReceiptStore(options()).record(stage1Input({
      idempotencyKey: "efx:stage1:unknown",
      approvalId: reserved.row.approval_id,
      outcome: "unknown",
      journalRef: undefined,
      recoverability: "reconcile-from-journal",
    }));
    if (!recorded.ok) throw new Error("receipt record failed");
    ledger.recordEffectOutcome({
      approvalId: reserved.row.approval_id,
      outcome: "unknown",
      effectReceiptId: recorded.effectReceiptId,
    });
    expect(ledger.getById(reserved.row.approval_id)?.state).toBe("needs_reconciliation");
  });
});
