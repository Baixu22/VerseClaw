import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { normalizeCapabilityGrant } from "../../../shared/types/context-control-plane/artifacts.js";
import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { ApprovalLedger } from "./approval-ledger.js";
import {
  deriveStage4CapabilityGrant,
  verifyStage4CapabilityGrant,
  type Stage4GrantActor,
  type Stage4GrantScope,
} from "./stage4-capability-grant.js";

const tempRoots: string[] = [];
let stateDir = "";
let ledger: ApprovalLedger;

function options() {
  return { env: process.env, path: path.join(stateDir, "openclaw-state.db") };
}

function actor(overrides: Partial<Stage4GrantActor> = {}): Stage4GrantActor {
  return {
    sessionKey: "sess-grant",
    runId: "run-grant",
    attemptIndex: 0,
    modelCallIndex: 0,
    actorKind: "principal",
    ...overrides,
  };
}

function scope(): Stage4GrantScope {
  return {
    taskBranchId: "run-grant",
    resource: "workspace:sentinel.txt",
    action: "write",
    purpose: "stage4 grant test",
  };
}

function approvedRow(now = Date.now()) {
  const reserved = ledger.reserve({
    idempotencyKey: `aprv-grant-${now}`,
    request: { tool: "write" },
    expiresAtMs: now + 120_000,
    requestedByClientId: "owner:stage4",
    createdAt: now,
  });
  if (!reserved.ok) throw new Error("reserve failed");
  const approved = ledger.resolve({
    approvalId: reserved.row.approval_id,
    decision: "approved",
    resolvedBy: "owner:stage4",
    resolvedAtMs: now,
  });
  if (!approved.ok) throw new Error("resolve failed");
  const started = ledger.markExecutionStarted(approved.row.approval_id);
  if (!started.ok) throw new Error("start failed");
  return started.row;
}

function approvedButNotStartedRow(now = Date.now()) {
  const reserved = ledger.reserve({
    idempotencyKey: `aprv-grant-not-started-${now}`,
    request: { tool: "write" },
    expiresAtMs: now + 120_000,
    requestedByClientId: "owner:stage4",
    createdAt: now,
  });
  if (!reserved.ok) throw new Error("reserve failed");
  const approved = ledger.resolve({
    approvalId: reserved.row.approval_id,
    decision: "approved",
    resolvedBy: "owner:stage4",
    resolvedAtMs: now,
  });
  if (!approved.ok) throw new Error("resolve failed");
  return approved.row;
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage4-grant-"));
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

describe("stage4 unified CapabilityGrant over durable ApprovalLedger", () => {
  it("derives a schema-valid active grant only after execution_started", () => {
    const now = Date.now();
    const row = approvedRow(now);
    const derived = deriveStage4CapabilityGrant({
      approvalRow: row,
      actor: actor(),
      scope: scope(),
      policyDigest: `sha256:${"a".repeat(64)}`,
      toolCallId: "tool-1",
      issuedAtMs: row.updated_at,
      nowMs: row.updated_at,
    });
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(() => normalizeCapabilityGrant(derived.grant)).not.toThrow();
    expect(derived.grant.status).toBe("active");
    expect(derived.grant.approvalRef.approvalId).toBe(row.approval_id);
    expect(
      verifyStage4CapabilityGrant({
        grant: derived.grant,
        call: {
          toolCallId: "tool-1",
          toolName: "write",
          resource: derived.grant.scope.resource,
          action: derived.grant.scope.action,
          purpose: derived.grant.scope.purpose,
          actor: derived.grant.actor,
          approvalId: derived.grant.approvalRef.approvalId,
          policyDigest: derived.grant.derivation.policyDigest,
          resolvedBy: derived.grant.approvalRef.resolvedBy,
        },
        nowMs: row.updated_at + 1,
      }).allow,
    ).toBe(true);
  });

  it("rejects an approved approval that has not reached execution_started", () => {
    const now = Date.now();
    const row = approvedButNotStartedRow(now);
    expect(row.state).toBe("approved");
    const derived = deriveStage4CapabilityGrant({
      approvalRow: row,
      actor: actor(),
      scope: scope(),
      policyDigest: `sha256:${"a".repeat(64)}`,
      toolCallId: "tool-not-started",
      nowMs: now,
    });
    expect(derived.ok).toBe(false);
    if (derived.ok) return;
    expect(derived.reason).toBe("approval-not-execution-started");
  });

  it("rejects a denied approval before any grant is derived", () => {
    const now = Date.now();
    const reserved = ledger.reserve({
      idempotencyKey: "aprv-denied-stage4",
      request: { tool: "write" },
      expiresAtMs: now + 120_000,
      requestedByClientId: "owner:stage4",
      createdAt: now,
    });
    if (!reserved.ok) throw new Error("reserve failed");
    ledger.resolve({
      approvalId: reserved.row.approval_id,
      decision: "denied",
      resolvedBy: "owner:stage4",
      resolvedAtMs: now,
    });
    const row = ledger.getById(reserved.row.approval_id)!;
    const derived = deriveStage4CapabilityGrant({
      approvalRow: row,
      actor: actor(),
      scope: scope(),
      policyDigest: `sha256:${"a".repeat(64)}`,
      toolCallId: "tool-denied",
      nowMs: now,
    });
    expect(derived.ok).toBe(false);
    if (derived.ok) return;
    expect(derived.reason).toBe("approval-not-approved");
  });
});
