import {
  COMPONENT_AUTHORITY_MANIFEST,
} from "../../../shared/component-authority-manifest.js";

export const PERMISSION_CONTRACT_SCHEMA_VERSION = "PermissionContract/v1" as const;

export const PERMISSION_SIDE_EFFECT_SURFACES = [
  "browser",
  "exec",
  "knowledge-apply",
  "fact-tools",
  "memory",
  "coding-control",
] as const;

export type PermissionSideEffectSurface = typeof PERMISSION_SIDE_EFFECT_SURFACES[number];

export type PermissionDecisionKind = "authorize" | "approve";

export type PermissionSurfaceContract = {
  surface: PermissionSideEffectSurface;
  consumerComponentId: string;
  authorityComponentId: "permission-approval-authority";
  decision: PermissionDecisionKind;
  action: string;
  resourcePattern: string;
  scope: "action";
  requireActorBinding: true;
  requireSessionBinding: true;
  requireTaskBranchBinding: true;
  requireExpiry: true;
  requireRevocation: true;
  requireFinalExecutionCheck: true;
  finalCheckpoint: string;
  checkpointEvidence: readonly string[];
};

export type PermissionContract = {
  schemaVersion: typeof PERMISSION_CONTRACT_SCHEMA_VERSION;
  authorityComponentId: "permission-approval-authority";
  surfaces: readonly PermissionSurfaceContract[];
  denyByDefault: true;
  componentManifestCanGrantPermission: false;
  executionBackendCanSelfAuthorize: false;
  grantStore: "existing-stage4-process-local";
  approvalStore: "existing-approval-ledger";
  restartPolicy: "explicit-invalid";
};

const SURFACE_CONTRACTS: Record<PermissionSideEffectSurface, Omit<PermissionSurfaceContract, "surface" | "authorityComponentId">> = {
  browser: {
    consumerComponentId: "browser-session-owner",
    decision: "authorize",
    action: "browser.click",
    resourcePattern: "browser-session/*",
    checkpointEvidence: ["electron/services/agent-browser-api.ts#ensureAgentBrowserControlForOwnedSession", "openclaw_runtime/src/agents/tools/agent-browser-tool.ts#assertSessionEffectAllowed"],
    finalCheckpoint: "electron/services/agent-browser-api.ts#ensureAgentBrowserControlForOwnedSession",
    scope: "action",
    requireActorBinding: true,
    requireSessionBinding: true,
    requireTaskBranchBinding: true,
    requireExpiry: true,
    requireRevocation: true,
    requireFinalExecutionCheck: true,
  },
  exec: {
    consumerComponentId: "coding-execution-backend",
    decision: "approve",
    action: "exec",
    resourcePattern: "exec/*",
    checkpointEvidence: ["openclaw_runtime/src/agents/verseshell/governed-exec.ts#executeGovernedVerseShell", "openclaw_runtime/src/agents/stage4-tool-guard.ts#wrapToolWithStage4ToolGuard"],
    finalCheckpoint: "openclaw_runtime/src/agents/verseshell/governed-exec.ts#executeGovernedVerseShell",
    scope: "action",
    requireActorBinding: true,
    requireSessionBinding: true,
    requireTaskBranchBinding: true,
    requireExpiry: true,
    requireRevocation: true,
    requireFinalExecutionCheck: true,
  },
  "knowledge-apply": {
    consumerComponentId: "knowledge-review-authority",
    decision: "approve",
    action: "knowledge.apply",
    resourcePattern: "knowledge/*",
    checkpointEvidence: ["electron/services/knowledge-api.ts#applyReviewedChange", "openclaw_runtime/src/knowledge/governance-store.ts#transitionProposal"],
    finalCheckpoint: "electron/services/knowledge-api.ts#applyReviewedChange",
    scope: "action",
    requireActorBinding: true,
    requireSessionBinding: true,
    requireTaskBranchBinding: true,
    requireExpiry: true,
    requireRevocation: true,
    requireFinalExecutionCheck: true,
  },
  "fact-tools": {
    consumerComponentId: "dcs-fact-view-and-tools",
    decision: "authorize",
    action: "fact.read",
    resourcePattern: "fact/*",
    checkpointEvidence: ["openclaw_runtime/src/agents/agent-tools.before-tool-call.ts#runBeforeToolCallHook", "openclaw_runtime/src/agents/tool-policy.ts#collectExplicitAllowlist"],
    finalCheckpoint: "openclaw_runtime/src/agents/agent-tools.before-tool-call.ts#runBeforeToolCallHook",
    scope: "action",
    requireActorBinding: true,
    requireSessionBinding: true,
    requireTaskBranchBinding: true,
    requireExpiry: true,
    requireRevocation: true,
    requireFinalExecutionCheck: true,
  },
  memory: {
    consumerComponentId: "role-memory-card-governance",
    decision: "approve",
    action: "memory.accept",
    resourcePattern: "memory/*",
    checkpointEvidence: ["openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts#confirmRuntimeMemoryFactProposal", "openclaw_runtime/src/memory/memory-store.ts#reviewMemoryProposalRecord"],
    finalCheckpoint: "openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts#confirmRuntimeMemoryFactProposal",
    scope: "action",
    requireActorBinding: true,
    requireSessionBinding: true,
    requireTaskBranchBinding: true,
    requireExpiry: true,
    requireRevocation: true,
    requireFinalExecutionCheck: true,
  },
  "coding-control": {
    consumerComponentId: "coding-execution-backend",
    decision: "authorize",
    action: "coding.write",
    resourcePattern: "workspace/*",
    checkpointEvidence: ["openclaw_runtime/src/agents/stage4-tool-guard.ts#wrapToolWithStage4ToolGuard", "openclaw_runtime/src/agents/approval-ledger.ts#ApprovalLedger"],
    finalCheckpoint: "openclaw_runtime/src/agents/stage4-tool-guard.ts#wrapToolWithStage4ToolGuard",
    scope: "action",
    requireActorBinding: true,
    requireSessionBinding: true,
    requireTaskBranchBinding: true,
    requireExpiry: true,
    requireRevocation: true,
    requireFinalExecutionCheck: true,
  },
};

export function findPermissionSurfaceForAction(action: string): PermissionSurfaceContract | undefined {
  return PERMISSION_CONTRACT.surfaces.find((entry) => entry.action === action);
}

export function assertPermissionFinalCheckpoint(input: {
  surface: PermissionSideEffectSurface;
  contract?: PermissionContract;
}): { ok: true; checkpoint: string } {
  const contract = input.contract ?? PERMISSION_CONTRACT;
  const surface = contract.surfaces.find((entry) => entry.surface === input.surface);
  if (!surface) throw new Error("No permission contract for " + input.surface);
  if (surface.authorityComponentId !== contract.authorityComponentId) {
    throw new Error("Second final permission authority for " + input.surface);
  }
  if (!surface.requireFinalExecutionCheck || !surface.finalCheckpoint.trim()) {
    throw new Error("Missing final execution checkpoint for " + input.surface);
  }
  return { ok: true, checkpoint: surface.finalCheckpoint };
}

export const PERMISSION_CONTRACT: PermissionContract = {
  schemaVersion: PERMISSION_CONTRACT_SCHEMA_VERSION,
  authorityComponentId: "permission-approval-authority",
  surfaces: PERMISSION_SIDE_EFFECT_SURFACES.map((surface) => ({
    surface,
    authorityComponentId: "permission-approval-authority",
    ...SURFACE_CONTRACTS[surface],
  })),
  denyByDefault: true,
  componentManifestCanGrantPermission: false,
  executionBackendCanSelfAuthorize: false,
  grantStore: "existing-stage4-process-local",
  approvalStore: "existing-approval-ledger",
  restartPolicy: "explicit-invalid",
};

export type PermissionContractValidationIssue = {
  code: string;
  message: string;
  path?: string;
};

export function validatePermissionContract(
  contract: PermissionContract = PERMISSION_CONTRACT,
): { ok: boolean; issues: PermissionContractValidationIssue[]; finalAuthoritiesPerSurface: number } {
  const issues: PermissionContractValidationIssue[] = [];
  const componentById = new Map(
    COMPONENT_AUTHORITY_MANIFEST.components.map((component) => [component.id, component]),
  );
  const authority = componentById.get(contract.authorityComponentId);
  if (!authority?.effects.includes("authorize") || !authority.effects.includes("approve")) {
    issues.push({ code: "permission_authority_missing", message: "permission-approval-authority cannot authorize/approve", path: "authorityComponentId" });
  }
  if (authority?.authorizationRole !== "owner") {
    issues.push({ code: "permission_authority_not_owner", message: "permission-approval-authority must be the sole permission owner", path: "authorityComponentId" });
  }
  if (new Set(contract.surfaces.map((entry) => entry.surface)).size !== contract.surfaces.length) {
    issues.push({ code: "duplicate_surface_contract", message: "each side-effect surface must have exactly one contract", path: "surfaces" });
  }
  for (const entry of contract.surfaces) {
    const consumer = componentById.get(entry.consumerComponentId);
    if (!consumer) {
      issues.push({ code: "consumer_missing", message: "Missing side-effect consumer " + entry.consumerComponentId, path: entry.surface });
      continue;
    }
    if (consumer.effects.includes("authorize") || consumer.effects.includes("approve")) {
      issues.push({ code: "consumer_self_authorizes", message: entry.consumerComponentId + " declares authorize/approve", path: entry.surface });
    }
    if (entry.authorityComponentId !== contract.authorityComponentId) {
      issues.push({ code: "second_final_authority", message: entry.surface + " names a second final permission authority", path: entry.surface });
    }
    if (!entry.requireActorBinding || !entry.requireSessionBinding || !entry.requireTaskBranchBinding) {
      issues.push({ code: "binding_requirement_missing", message: entry.surface + " must bind actor/session/task branch", path: entry.surface });
    }
    if (entry.checkpointEvidence.length === 0) {
      issues.push({ code: "checkpoint_evidence_missing", message: entry.surface + " has no checkpoint evidence", path: entry.surface });
    }
    if (!entry.requireExpiry || !entry.requireRevocation || !entry.requireFinalExecutionCheck) {
      issues.push({ code: "final_gate_requirement_missing", message: entry.surface + " must require expiry, revocation and final execution checks", path: entry.surface });
    }
  }
  for (const surface of PERMISSION_SIDE_EFFECT_SURFACES) {
    if (!contract.surfaces.some((entry) => entry.surface === surface)) {
      issues.push({ code: "surface_uncovered", message: "No permission contract for " + surface, path: surface });
    }
  }
  if (!contract.denyByDefault) issues.push({ code: "deny_by_default_disabled", message: "Permission contract must deny by default", path: "denyByDefault" });
  if (contract.componentManifestCanGrantPermission) {
    issues.push({ code: "manifest_can_grant", message: "Component manifests may describe a consumer but cannot grant a permission", path: "componentManifestCanGrantPermission" });
  }
  if (contract.executionBackendCanSelfAuthorize) {
    issues.push({ code: "executor_self_authorization", message: "Execution backends cannot self-authorize", path: "executionBackendCanSelfAuthorize" });
  }
  const finalAuthoritiesPerSurface = contract.surfaces.filter(
    (entry) => entry.authorityComponentId === contract.authorityComponentId,
  ).length;
  return { ok: issues.length === 0, issues, finalAuthoritiesPerSurface };
}

export function assertComponentManifestCannotGrantPermission(): { ok: true } {
  const issues = COMPONENT_AUTHORITY_MANIFEST.components.flatMap((component) => {
    const effectProblems = component.effects.includes("authorize") && component.authorizationRole !== "owner"
      ? [component.id + " has authorize without owner role"]
      : [];
    const approvalProblems = component.effects.includes("approve") && component.authorizationRole !== "owner"
      ? [component.id + " has approve without owner role"]
      : [];
    return [...effectProblems, ...approvalProblems];
  });
  if (issues.length > 0) throw new Error(issues.join("; "));
  return { ok: true };
}
