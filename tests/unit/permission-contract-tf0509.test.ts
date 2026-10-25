// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COMPONENT_AUTHORITY_MANIFEST,
  validateComponentAuthorityManifest,
} from "../../shared/component-authority-manifest";
import {
  PERMISSION_CONTRACT,
  PERMISSION_SIDE_EFFECT_SURFACES,
  assertComponentManifestCannotGrantPermission,
  assertPermissionFinalCheckpoint,
  findPermissionSurfaceForAction,
  validatePermissionContract,
} from "../../openclaw_runtime/src/agents/permission-contract";
import { closeOpenClawStateDatabase } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { ApprovalLedger } from "../../openclaw_runtime/src/agents/approval-ledger";
import {
  deriveStage4CapabilityGrant,
  recoverStage4GrantAfterRestart,
  revokeStage4CapabilityGrant,
  verifyStage4CapabilityGrant,
  type Stage4GrantActor,
  type Stage4GrantScope,
} from "../../openclaw_runtime/src/agents/stage4-capability-grant";

const tempRoots: string[] = [];
let ledger: ApprovalLedger;
let stateDir = "";

function ledgerOptions() {
  return { env: process.env, path: path.join(stateDir, "openclaw-state.db") };
}
function actor(overrides: Partial<Stage4GrantActor> = {}): Stage4GrantActor {
  return {
    sessionKey: "tf0509-session",
    runId: "tf0509-run",
    attemptIndex: 0,
    modelCallIndex: 0,
    actorKind: "principal",
    ...overrides,
  };
}
function scope(overrides: Partial<Stage4GrantScope> = {}): Stage4GrantScope {
  return {
    taskBranchId: "tf0509-branch",
    resource: "workspace:src/app.ts",
    action: "write",
    purpose: "tf0509 permission contract",
    ...overrides,
  };
}
function approvedStartedRow(now: number, idempotencyKey: string) {
  const reserved = ledger.reserve({
    idempotencyKey,
    request: { tool: "write", resource: scope().resource, action: scope().action },
    expiresAtMs: now + 120_000,
    requestedByClientId: "owner:tf0509",
    createdAt: now,
  });
  if (!reserved.ok) throw new Error("permission contract fixture reserve failed");
  const approved = ledger.resolve({
    approvalId: reserved.row.approval_id,
    decision: "approved",
    resolvedBy: "owner:tf0509",
    resolvedAtMs: now,
  });
  if (!approved.ok) throw new Error("permission contract fixture resolve failed");
  const started = ledger.markExecutionStarted(approved.row.approval_id);
  if (!started.ok) throw new Error("permission contract fixture execution_started failed");
  return started.row;
}
function deriveFixture(now: number, key = "tf0509-approval") {
  const row = approvedStartedRow(now, key);
  const derived = deriveStage4CapabilityGrant({
    approvalRow: row,
    actor: actor(),
    scope: scope(),
    policyDigest: "sha256:" + "a".repeat(64),
    toolCallId: "tf0509-tool-call",
    issuedAtMs: row.updated_at,
    nowMs: now,
  });
  if (!derived.ok) throw new Error("permission contract grant derivation failed: " + derived.reason);
  return { row, grant: derived.grant };
}
function callFor(grant: ReturnType<typeof deriveFixture>["grant"], overrides: Record<string, unknown> = {}) {
  return {
    toolCallId: "tf0509-tool-call",
    toolName: "write",
    resource: grant.scope.resource,
    action: grant.scope.action,
    purpose: grant.scope.purpose,
    taskBranchId: grant.scope.taskBranchId,
    actor: grant.actor,
    approvalId: grant.approvalRef.approvalId,
    policyDigest: grant.derivation.policyDigest,
    resolvedBy: grant.approvalRef.resolvedBy,
    ...overrides,
  } as Parameters<typeof verifyStage4CapabilityGrant>[0]["call"];
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tf0509-permission-"));
  tempRoots.push(root);
  stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  process.env.OPENCLAW_STATE_DIR = stateDir;
  ledger = new ApprovalLedger(ledgerOptions());
});
afterEach(() => {
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_STATE_DIR;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("TF-0509 permission authority contract", () => {
  it("maps every side-effect surface to the one permission authority", () => {
    expect(PERMISSION_CONTRACT.surfaces.map((entry) => entry.surface)).toEqual([...PERMISSION_SIDE_EFFECT_SURFACES]);
    expect(validatePermissionContract()).toMatchObject({
      ok: true,
      issues: [],
      finalAuthoritiesPerSurface: PERMISSION_SIDE_EFFECT_SURFACES.length,
    });
    expect(assertComponentManifestCannotGrantPermission()).toEqual({ ok: true });
    expect(validateComponentAuthorityManifest(COMPONENT_AUTHORITY_MANIFEST)).toMatchObject({ ok: true, issues: [] });
  });

  it("does not allow component descriptors to expand permission authority", () => {
    const mutated = structuredClone(PERMISSION_CONTRACT) as unknown as { surfaces: Array<{ authorityComponentId: string }> };
    mutated.surfaces[0]!.authorityComponentId = "browser-session-owner";
    const result = validatePermissionContract(mutated as never);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "second_final_authority")).toBe(true);
  });

  it("rejects actor, session, task-branch, resource, and action mismatches", () => {
    const now = Date.now();
    const { grant } = deriveFixture(now);
    const cases = [
      ["actor session", { actor: actor({ sessionKey: "other-session" }) }],
      ["actor run", { actor: actor({ runId: "other-run" }) }],
      ["task branch", { taskBranchId: "other-branch" }],
      ["resource", { resource: "workspace:other.ts" }],
      ["action", { action: "delete" }],
    ] as const;
    for (const [label, overrides] of cases) {
      const verdict = verifyStage4CapabilityGrant({
        grant,
        call: callFor(grant, overrides),
        nowMs: now + 1,
      });
      expect(verdict.allow, label).toBe(false);
    }
  });

  it("rejects expiry, revocation, and restart recovery", () => {
    const now = Date.now();
    const { grant } = deriveFixture(now);

    const expiredVerdict = verifyStage4CapabilityGrant({
      grant,
      call: callFor(grant),
      nowMs: Date.parse(grant.ttl.expiresAt) + 1,
    });
    expect(expiredVerdict).toMatchObject({ allow: false, reason: "ttl-expired" });

    const revoked = revokeStage4CapabilityGrant(grant, { reason: "user revoked", revokedAtMs: now + 10 });
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(verifyStage4CapabilityGrant({
      grant: revoked.grant,
      call: callFor(grant),
      nowMs: now + 11,
    })).toMatchObject({ allow: false, reason: "revoked" });

    expect(recoverStage4GrantAfterRestart(grant.grantId)).toEqual({
      ok: false,
      reason: "grant-not-recoverable-after-restart",
      grantId: grant.grantId,
    });
  });

  it("rejects a grant revoked after its snapshot at the final execution check", () => {
    const now = Date.now();
    const { grant } = deriveFixture(now, "tf0509-final-check");
    const snapshotCall = callFor(grant);
    const snapshotVerdict = verifyStage4CapabilityGrant({ grant, call: snapshotCall, nowMs: Date.parse(grant.ttl.issuedAt) });
    expect(snapshotVerdict.allow, String((snapshotVerdict as { reason?: unknown }).reason)).toBe(true);

    const revoked = revokeStage4CapabilityGrant(grant, { reason: "revoked after preflight", revokedAtMs: now + 2 });
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    const finalVerdict = verifyStage4CapabilityGrant({
      grant,
      call: snapshotCall,
      nowMs: now + 3,
      revokedGrantIds: new Set([grant.grantId]),
    });
    expect(finalVerdict).toMatchObject({ allow: false, reason: "revoked" });
  });

  it("covers Browser, exec, knowledge apply, fact tools, memory, and coding control", () => {
    const bySurface = new Map(PERMISSION_CONTRACT.surfaces.map((entry) => [entry.surface, entry]));
    const expectedConsumers: Record<string, string> = {
      browser: "browser-session-owner",
      exec: "coding-execution-backend",
      "knowledge-apply": "knowledge-review-authority",
      "fact-tools": "dcs-fact-view-and-tools",
      memory: "role-memory-card-governance",
      "coding-control": "coding-execution-backend",
    };
    for (const [surface, consumer] of Object.entries(expectedConsumers)) {
      const contract = bySurface.get(surface as never);
      expect(contract, surface).toBeDefined();
      expect(contract?.consumerComponentId, surface).toBe(consumer);
      expect(contract?.authorityComponentId, surface).toBe("permission-approval-authority");
      expect(contract?.requireFinalExecutionCheck, surface).toBe(true);
      expect(contract?.finalCheckpoint, surface).toMatch(/^(electron|openclaw_runtime)\/.+\.ts#.+$/);
      expect(fs.existsSync(path.resolve(process.cwd(), contract!.finalCheckpoint.split('#')[0])), surface).toBe(true);
      expect(assertPermissionFinalCheckpoint({ surface: surface as never })).toMatchObject({ ok: true });
      expect(findPermissionSurfaceForAction(contract!.action)).toEqual(contract);
      expect(contract?.checkpointEvidence.length, surface).toBeGreaterThanOrEqual(2);
      for (const evidence of contract!.checkpointEvidence) {
        expect(fs.existsSync(path.resolve(process.cwd(), evidence.split("#")[0]!)), evidence).toBe(true);
      }
    }
  });
});
