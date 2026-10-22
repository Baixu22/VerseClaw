import { createHash } from "node:crypto";

import {
  assertPermissionEffectAtFinalCheckpoint,
  buildPermissionEffectOwnerCheckpoint,
  permissionEffectBindingFor,
  type PermissionEffectOwnerCheckpointInput,
} from "../../../shared/permission-effect-contract.js";

export type ExecPermissionEffectInput = {
  /** Stable id supplied by the exec policy/approval owner after it allowed this call. */
  ownerDecisionRef: string;
  command: string;
  execCommand?: string;
  host: string;
  workdir: string;
  agentId?: string;
  sessionKey?: string;
  expectedSessionId?: string;
  traceId?: string;
  scopeKey?: string;
  nowMs?: number;
};

function hashId(prefix: string, value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 24);
  return `${prefix}-${digest}`;
}

/** Serialize an existing exec policy decision into the shared final checkpoint. */
export function createExecPermissionEffect(
  input: ExecPermissionEffectInput,
): PermissionEffectOwnerCheckpointInput {
  const binding = permissionEffectBindingFor("exec");
  if (!binding) throw new Error("permission-effect-binding-missing");
  const nowMs = input.nowMs ?? Date.now();
  const effectDigest = createHash("sha256")
    .update([
      input.ownerDecisionRef,
      input.host,
      input.agentId ?? "",
      input.sessionKey ?? "",
      input.expectedSessionId ?? "",
      input.workdir,
      input.command,
      input.execCommand ?? "",
    ].join("\0"))
    .digest("hex");
  const policyDigest = `sha256:${createHash("sha256")
    .update(`exec-policy:v1\0${input.host}\0${input.agentId ?? "local"}\0${input.workdir}`)
    .digest("hex")}`;
  return {
    componentId: "exec",
    subject: {
      sessionKey: hashId("exec-session", input.sessionKey ?? input.agentId ?? "local"),
      runId: hashId(
        "exec-run",
        input.traceId ?? input.expectedSessionId ?? input.ownerDecisionRef,
      ),
      attemptIndex: 0,
      modelCallIndex: 0,
      actorKind: "principal",
      workspaceId: input.workdir,
      taskBranchId: hashId(
        "exec-task",
        input.scopeKey ?? input.expectedSessionId ?? input.ownerDecisionRef,
      ),
    },
    request: {
      requestId: `exec-request-${effectDigest.slice(0, 24)}`,
      action: input.host,
      resource: `workspace:${effectDigest.slice(0, 24)}/command`,
      purpose: "launch a process approved under the existing exec policy",
      idempotencyKey: `exec-effect-${effectDigest.slice(0, 32)}`,
    },
    authorityOwner: binding.finalAuthorityOwner,
    decisionRef: hashId("exec-decision", input.ownerDecisionRef),
    policyDigest,
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + 30_000,
    nowMs,
    revocationEpoch: "exec-approval-revocation:v1",
    policyEpoch: policyDigest,
    catalogEpoch: "exec-host-catalog:v1",
  };
}
/** Recheck owner evidence at the final executor boundary with a fresh clock. */
export function assertExecPermissionEffect(input: PermissionEffectOwnerCheckpointInput): void {
  const checkpoint = buildPermissionEffectOwnerCheckpoint(input);
  assertPermissionEffectAtFinalCheckpoint({
    ...checkpoint,
    current: {
      ...checkpoint.current,
      nowMs: Date.now(),
    },
  });
}