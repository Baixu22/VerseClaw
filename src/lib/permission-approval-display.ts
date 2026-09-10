import type { PermissionApprovalEvent } from '@shared/types/workspace';

/**
 * External process writes need a bounded product projection, not raw inputs.
 *
 * Two things this classification does NOT mean, because the wording invites both
 * mistakes. It is not the VerseShell runtime's `externalWritePolicy`: that lives
 * on the host-owned command plan, no renderer code reads it, and the two cover
 * disjoint command populations. And it is not a severity ranking — an
 * external write is the one class ClawX cannot undo, which is why callers must
 * not present it as milder than `dangerous`.
 */
export function isExternalWriteApproval(approval: Pick<PermissionApprovalEvent, 'risk'>): boolean {
  return approval.risk === 'external-write';
}

/**
 * True when an approval's effect is outside the ClawX write journal or is
 * otherwise destructive, i.e. the cases whose surface must not read as routine.
 */
export function isIrreversibleApproval(approval: Pick<PermissionApprovalEvent, 'risk'>): boolean {
  return approval.risk === 'external-write'
    || approval.risk === 'dangerous'
    || approval.risk === 'destructive';
}

export function stripSensitiveApprovalDetails(approval: PermissionApprovalEvent): PermissionApprovalEvent {
  if (!isExternalWriteApproval(approval)) return approval;
  const safeApproval = { ...approval };
  delete safeApproval.command;
  delete safeApproval.cwd;
  delete safeApproval.paths;
  delete safeApproval.paramsPreview;
  delete safeApproval.reason;
  // requestHash is built from the request itself (`${cwd}:${command}`,
  // `${path}:${bytes}`, `${method}:${params}`), so keeping it would re-admit
  // exactly the content the deletes above remove.
  delete safeApproval.requestHash;
  return safeApproval;
}

export function approvalDisplayDetails(approval: PermissionApprovalEvent): {
  title?: string;
  description?: string;
  command?: string;
  cwd?: string;
  paths?: string[];
  paramsPreview?: string;
  reason?: string;
} {
  if (isExternalWriteApproval(approval)) return {};
  return {
    title: approval.reason || approval.command || approval.paths?.[0] || approval.source,
    description: approval.paramsPreview,
    command: approval.command,
    cwd: approval.cwd,
    paths: approval.paths,
    paramsPreview: approval.paramsPreview,
    reason: approval.reason,
  };
}
