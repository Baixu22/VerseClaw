import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { normalizeCapabilityGrant } from "../../../shared/types/context-control-plane/artifacts.js";
import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { ApprovalLedger } from "./approval-ledger.js";
import {
  deriveStage1MinimalGrant,
  verifyStage1MinimalGrant,
} from "./stage1-minimal-grant.js";

const tempRoots: string[] = [];
let stateDir = "";
let ledger: ApprovalLedger;

function options() {
  return { env: process.env, path: path.join(stateDir, "openclaw-state.db") };
}

function actor(overrides: Partial<Parameters<typeof deriveStage1MinimalGrant>[0]["actor"]> = {}) {
  return {
    sessionKey: "sess-grant",
    runId: "run-grant",
    attemptIndex: 0,
    modelCallIndex: 0,
    actorKind: "principal" as const,
    ...overrides,
  };
}

function scope() {
  return {
    taskBranchId: "run-grant",
    resource: "workspace:sentinel.txt",
    action: "write",
    purpose: "stage1 grant test",
  };
}

function approvedRow(now = Date.now()) {
  const reserved = ledger.reserve({
    idempotencyKey: "aprv-grant-1",
    request: { tool: "write" },
    expiresAtMs: now + 120_000,
    requestedByClientId: "owner:stage1",
    createdAt: now,
  });
  if (!reserved.ok) throw new Error("reserve failed");
  const approved = ledger.resolve({
    approvalId: reserved.row.approval_id,
    decision: "approved",
    resolvedBy: "owner:stage1",
    resolvedAtMs: now,
  });
  if (!approved.ok) throw new Error("resolve failed");
  const started = ledger.markExecutionStarted(approved.row.approval_id);
  if (!started.ok) throw new Error("start failed");
  return started.row;
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage1-grant-"));
  tempRoots.push(root);
  stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  process.env.OPENCLAW_STATE_DIR = stateDir;
  ledger = new ApprovalLedger(options());
});

afterEach(() => {
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_STATE_DIR;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("stage1 temporary minimal grant", () => {
  it("derives an active CapabilityGrant/v1 only after execution_started", () => {
    const row = approvedRow();
    const derived = deriveStage1MinimalGrant({
      approvalRow: row,
      actor: actor(),
      scope: scope(),
      policyDigest: "sha256:" + "a".repeat(64),
      toolCallId: "tool-1",
      issuedAtMs: row.updated_at,
      nowMs: row.updated_at,
    });
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(() => normalizeCapabilityGrant(derived.grant)).not.toThrow();
    expect(derived.grant.status).toBe("active");
    expect(derived.grant.scope.action).toBe("write");
    expect(derived.grant.effectIdempotency.key).toContain("tool-1");
  });

  it("rejects denied, expired, and wildcard derivations", () => {
    const denied = ledger.reserve({
      idempotencyKey: "aprv-denied",
      request: { tool: "write" },
      expiresAtMs: Date.now() + 60_000,
    });
    if (!denied.ok) throw new Error("reserve failed");
    ledger.resolve({ approvalId: denied.row.approval_id, decision: "denied", resolvedBy: "owner:stage1" });
    const deniedRow = ledger.getById(denied.row.approval_id)!;
    expect(
      deriveStage1MinimalGrant({
        approvalRow: deniedRow,
        actor: actor(),
        scope: scope(),
        policyDigest: "sha256:" + "a".repeat(64),
        toolCallId: "tool-denied",
      }).ok,
    ).toBe(false);

    const row = approvedRow();
    expect(
      deriveStage1MinimalGrant({
        approvalRow: row,
        actor: actor(),
        scope: { ...scope(), action: "*" },
        policyDigest: "sha256:" + "a".repeat(64),
        toolCallId: "tool-wildcard",
      }).ok,
    ).toBe(false);
    expect(
      deriveStage1MinimalGrant({
        approvalRow: { ...row, expires_at_ms: 0 },
        actor: actor(),
        scope: scope(),
        policyDigest: "sha256:" + "a".repeat(64),
        toolCallId: "tool-expired",
      }).ok,
    ).toBe(false);
  });

  it("Tool Guard verdicts cover actor, scope, approval, TTL, and idempotency mismatches", () => {
    const now = Date.now();
    const row = approvedRow(now);
    const derived = deriveStage1MinimalGrant({
      approvalRow: row,
      actor: actor(),
      scope: scope(),
      policyDigest: "sha256:" + "b".repeat(64),
      toolCallId: "tool-verify",
      issuedAtMs: now,
      nowMs: now,
    });
    if (!derived.ok) throw new Error("derive failed");
    const base = {
      toolCallId: "tool-verify",
      toolName: "write",
      resource: "workspace:sentinel.txt",
      action: "write",
      purpose: "stage1 grant test",
      actor: actor(),
      approvalId: row.approval_id,
      policyDigest: "sha256:" + "b".repeat(64),
      resolvedBy: "owner:stage1",
      nowMs: now + 1,
    };
    expect(verifyStage1MinimalGrant(derived.grant, base).allow).toBe(true);
    expect(verifyStage1MinimalGrant(derived.grant, { ...base, actor: actor({ sessionKey: "other" }) }))
      .toMatchObject({ allow: false, reason: "actor-mismatch" });
    expect(verifyStage1MinimalGrant(derived.grant, { ...base, resource: "workspace:other.txt" }))
      .toMatchObject({ allow: false, reason: "scope-resource-mismatch" });
    expect(verifyStage1MinimalGrant(derived.grant, { ...base, action: "read" }))
      .toMatchObject({ allow: false, reason: "scope-action-mismatch" });
    expect(verifyStage1MinimalGrant(derived.grant, { ...base, approvalId: "aprv-other" }))
      .toMatchObject({ allow: false, reason: "approval-mismatch" });
    expect(verifyStage1MinimalGrant(derived.grant, { ...base, nowMs: now + 120_000 }))
      .toMatchObject({ allow: false, reason: "ttl-expired" });
    expect(verifyStage1MinimalGrant(derived.grant, { ...base, toolCallId: "tool-other" }))
      .toMatchObject({ allow: false, reason: "effect-idempotency-mismatch" });
    expect(verifyStage1MinimalGrant(null, base)).toMatchObject({ allow: false, reason: "grant-missing" });
  });

  it("approval rows survive a reopened ledger handle (restart evidence)", () => {
    const row = approvedRow();
    const reopened = new ApprovalLedger(options());
    expect(reopened.getById(row.approval_id)?.state).toBe("execution_started");
  });
});
