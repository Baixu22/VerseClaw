/**
 * E2 — long-session resource reclamation contract.
 *
 * This module only *describes* and *accounts for* cleanup across the existing
 * owners (terminals, browser sessions, managed background ports, delegated
 * Git worktrees, runtime admission permits). It never becomes a second resource
 * registry: each owner is asked to clean its own handles and the result is a
 * receipt. Nothing here decides product caps or defaults.
 */

export const RESOURCE_RECLAMATION_SCHEMA = 'LongSessionResourceReclamation/v1' as const;

export type ReclaimAction =
  | 'ui-unload'
  | 'run-cancel'
  | 'session-archive'
  | 'session-delete'
  | 'workspace-delete'
  | 'workspace-switch'
  | 'app-quit';

export type ReclaimOwnerKind = 'terminal' | 'browser' | 'background-port' | 'worktree' | 'admission-permit';

export type ReclaimOutcome = 'reclaimed' | 'kept' | 'not-owned' | 'unknown' | 'failed';

export type ReclaimScope = {
  workspaceId: string;
  sessionKey: string;
  /** Physical generation that owned the resources when they were created. */
  expectedSessionId?: string | null;
  rootPath?: string | null;
};

export type ReclaimOwnerDescriptor = {
  kind: ReclaimOwnerKind;
  owner: string;
  /** True when this owner can keep a resource alive across UI unload by policy. */
  supportsKeepOnLeave: boolean;
};

export const RECLAIM_OWNERS: readonly ReclaimOwnerDescriptor[] = [
  { kind: 'terminal', owner: 'TerminalSessionManager', supportsKeepOnLeave: true },
  { kind: 'browser', owner: 'HostAgentBrowserService', supportsKeepOnLeave: false },
  { kind: 'background-port', owner: 'ResourceTracker', supportsKeepOnLeave: false },
  { kind: 'worktree', owner: 'WorktreeService', supportsKeepOnLeave: false },
  { kind: 'admission-permit', owner: 'SessionAdmissionRegistry', supportsKeepOnLeave: false },
];

/** An action whose semantics differ from the other actions must say so here. */
export type ReclaimActionContract = {
  action: ReclaimAction;
  closesTerminals: boolean;
  closesBrowsers: boolean;
  stopsManagedPorts: boolean;
  cleansWorktrees: boolean;
  releasesAdmission: boolean;
  invalidatesBinding: boolean;
  description: string;
};

export const RECLAIM_ACTION_CONTRACTS: readonly ReclaimActionContract[] = [
  {
    action: 'ui-unload',
    closesTerminals: false,
    closesBrowsers: false,
    stopsManagedPorts: false,
    cleansWorktrees: false,
    releasesAdmission: false,
    invalidatesBinding: false,
    description: 'Renderer teardown only. Every owner keeps its handles; terminals flagged keep_on_leave stay alive.',
  },
  {
    action: 'run-cancel',
    closesTerminals: false,
    closesBrowsers: false,
    stopsManagedPorts: false,
    cleansWorktrees: false,
    releasesAdmission: true,
    invalidatesBinding: false,
    description: 'Aborts the current run and releases its admission permit; schedules and sessions are untouched.',
  },
  {
    action: 'session-archive',
    closesTerminals: false,
    closesBrowsers: false,
    stopsManagedPorts: false,
    cleansWorktrees: false,
    releasesAdmission: true,
    invalidatesBinding: true,
    description: 'Metadata archive invalidates the coordinator binding and releases run permits; it does not kill user resources.',
  },
  {
    action: 'session-delete',
    closesTerminals: true,
    closesBrowsers: true,
    stopsManagedPorts: true,
    cleansWorktrees: true,
    releasesAdmission: true,
    invalidatesBinding: true,
    description: 'Deletes the session and reclaims every managed resource owned by that session key.',
  },
  {
    action: 'workspace-delete',
    closesTerminals: true,
    closesBrowsers: true,
    stopsManagedPorts: true,
    cleansWorktrees: false,
    releasesAdmission: true,
    invalidatesBinding: true,
    description: 'Removes the workspace; managed worktrees are reported for explicit pruning instead of blind deletion.',
  },
  {
    action: 'workspace-switch',
    closesTerminals: false,
    closesBrowsers: false,
    stopsManagedPorts: false,
    cleansWorktrees: false,
    releasesAdmission: false,
    invalidatesBinding: false,
    description: 'Changes the active workspace only. No handle of the previous workspace is touched.',
  },
  {
    action: 'app-quit',
    closesTerminals: true,
    closesBrowsers: true,
    stopsManagedPorts: true,
    cleansWorktrees: false,
    releasesAdmission: true,
    invalidatesBinding: false,
    description: 'Releases process-scoped handles on quit; durable worktrees and user directories are preserved.',
  },
];

export type OwnerReclaimResult = {
  kind: ReclaimOwnerKind;
  owner: string;
  outcome: ReclaimOutcome;
  attempted: number;
  reclaimed: number;
  kept: number;
  detail?: string;
};

export type ReclaimReceipt = {
  schema: typeof RESOURCE_RECLAMATION_SCHEMA;
  action: ReclaimAction;
  scope: ReclaimScope;
  generatedAt: string;
  owners: OwnerReclaimResult[];
  activeResidue: number;
  keptOnLeave: number;
  recoveryRequired: boolean;
  recoveryId: string | null;
  retryable: boolean;
};

export type TerminalKeepPolicy = {
  /** Set when the user explicitly chose to keep this terminal across UI unload. */
  keepOnLeave?: boolean;
};

/** A `keep_on_leave` terminal is never swept by ui-unload or workspace-switch. */
export function shouldKeepTerminalOnLeave(
  action: ReclaimAction,
  policy: TerminalKeepPolicy | undefined,
): boolean {
  if (policy?.keepOnLeave !== true) return false;
  return action === 'ui-unload' || action === 'workspace-switch' || action === 'run-cancel' || action === 'session-archive';
}

/**
 * Turns owner results into one receipt. `recovery_required` is raised only when
 * an owner reports `failed` or `unknown`, and keeps a retry identity so a later
 * pass can resume the same cleanup instead of guessing.
 */
export function buildReclaimReceipt(params: {
  action: ReclaimAction;
  scope: ReclaimScope;
  owners: OwnerReclaimResult[];
  generatedAt?: string;
  recoveryId?: string | null;
}): ReclaimReceipt {
  const unresolved = params.owners.filter((owner) => owner.outcome === 'failed' || owner.outcome === 'unknown');
  const reclaimed = params.owners.reduce((total, owner) => total + owner.reclaimed, 0);
  const kept = params.owners.reduce((total, owner) => total + owner.kept, 0);
  // Unresolved owners (failed/unknown) still hold residue: count their attempts
  // so a receipt can never say "zero residue" while cleanup is unresolved.
  const unresolvedAttempts = unresolved.reduce((total, owner) => total + Math.max(owner.attempted, 1), 0);
  const handled = params.owners
    .filter((owner) => owner.outcome === 'reclaimed' || owner.outcome === 'kept')
    .reduce((total, owner) => total + owner.attempted, 0);
  return {
    schema: RESOURCE_RECLAMATION_SCHEMA,
    action: params.action,
    scope: params.scope,
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    owners: params.owners,
    activeResidue: unresolvedAttempts + Math.max(0, handled - reclaimed - kept),
    keptOnLeave: kept,
    recoveryRequired: unresolved.length > 0,
    recoveryId: unresolved.length > 0 ? (params.recoveryId ?? `recovery:${params.action}:${params.scope.sessionKey}`) : null,
    retryable: unresolved.length > 0,
  };
}

/** True when an action is allowed to touch terminals for this scope at all. */
export function actionClosesTerminals(action: ReclaimAction): boolean {
  return RECLAIM_ACTION_CONTRACTS.find((entry) => entry.action === action)?.closesTerminals === true;
}
export type ReclaimOwnerHandlers = {
  terminals?: {
    reclaim: (params: { sessionKey: string; workspaceId?: string; honorKeepOnLeave: boolean }) => { attempted: number; reclaimed: number; kept: number };
    count: (params: { sessionKey: string; workspaceId?: string }) => number;
  };
  browsers?: {
    reclaim: (params: { sessionKey: string; workspaceId?: string }) => Promise<{ attempted: number; reclaimed: number }> | { attempted: number; reclaimed: number };
  };
  backgroundPorts?: {
    reclaim: (params: { sessionKey: string }) => Promise<{ attempted: number; reclaimed: number; failed?: number }>;
  };
  worktrees?: {
    reclaim: (params: { sessionKey: string; workspaceId?: string }) => Promise<{ attempted: number; reclaimed: number; failed?: number; kept?: number }>;
  };
  admission?: {
    release: (params: { sessionKey: string; expectedSessionId?: string | null }) => Promise<number> | number;
  };
};

export type ReclaimRequest = {
  action: ReclaimAction;
  scope: ReclaimScope;
  owners: ReclaimOwnerHandlers;
  generatedAt?: string;
  recoveryId?: string | null;
};

function ownerResult(kind: ReclaimOwnerKind, outcome: ReclaimOutcome, attempted: number, reclaimed: number, kept: number, detail?: string): OwnerReclaimResult {
  return {
    kind,
    owner: RECLAIM_OWNERS.find((entry) => entry.kind === kind)?.owner ?? kind,
    outcome,
    attempted,
    reclaimed,
    kept,
    ...(detail ? { detail } : {}),
  };
}

/**
 * Runs the per-owner reclamation for one action and returns a receipt. Each
 * owner is called only when this action is contractually allowed to touch it;
 * a thrown owner call becomes failed (never silently zero) so the caller can
 * mark recovery_required with a retry identity.
 */
export async function reclaimLongSessionResources(request: ReclaimRequest): Promise<ReclaimReceipt> {
  const contract = RECLAIM_ACTION_CONTRACTS.find((entry) => entry.action === request.action);
  if (!contract) throw new Error('unknown reclamation action: ' + String(request.action));
  const results: OwnerReclaimResult[] = [];
  const now = request.generatedAt ?? new Date().toISOString();

  if (contract.closesTerminals && request.owners.terminals) {
    try {
      const result = request.owners.terminals.reclaim({
        sessionKey: request.scope.sessionKey,
        workspaceId: request.scope.workspaceId,
        honorKeepOnLeave: request.action !== 'session-delete',
      });
      const kept = result.kept ?? 0;
      const outcome = result.reclaimed > 0 ? 'reclaimed' : kept > 0 ? 'kept' : 'reclaimed';
      results.push(ownerResult('terminal', outcome, result.attempted, result.reclaimed, kept));
    } catch (error) {
      results.push(ownerResult('terminal', 'failed', 0, 0, 0, String(error)));
    }
  } else if (request.owners.terminals) {
    const keptOnLeave = request.owners.terminals.count({
      sessionKey: request.scope.sessionKey,
      workspaceId: request.scope.workspaceId,
    });
    results.push(ownerResult('terminal', 'kept', keptOnLeave, 0, keptOnLeave, 'action does not close terminals; keep_on_leave preserved'));
  }

  if (contract.closesBrowsers && request.owners.browsers) {
    try {
      const result = await request.owners.browsers.reclaim({
        sessionKey: request.scope.sessionKey,
        workspaceId: request.scope.workspaceId,
      });
      results.push(ownerResult('browser', 'reclaimed', result.attempted, result.reclaimed, 0));
    } catch (error) {
      results.push(ownerResult('browser', 'failed', 0, 0, 0, String(error)));
    }
  } else {
    results.push(ownerResult('browser', 'not-owned', 0, 0, 0, 'action does not close browser sessions'));
  }

  if (contract.stopsManagedPorts && request.owners.backgroundPorts) {
    try {
      const result = await request.owners.backgroundPorts.reclaim({ sessionKey: request.scope.sessionKey });
      const failed = result.failed ?? 0;
      results.push(
        failed > 0
          ? ownerResult('background-port', 'failed', result.attempted, result.reclaimed, 0, String(failed) + ' managed port(s) still reachable')
          : ownerResult('background-port', 'reclaimed', result.attempted, result.reclaimed, 0),
      );
    } catch (error) {
      results.push(ownerResult('background-port', 'failed', 0, 0, 0, String(error)));
    }
  } else {
    results.push(ownerResult('background-port', 'not-owned', 0, 0, 0, 'action does not stop managed ports'));
  }

  if (contract.cleansWorktrees && request.owners.worktrees) {
    try {
      const result = await request.owners.worktrees.reclaim({
        sessionKey: request.scope.sessionKey,
        workspaceId: request.scope.workspaceId,
      });
      const failed = result.failed ?? 0;
      const kept = result.kept ?? 0;
      results.push(
        failed > 0
          ? ownerResult('worktree', 'failed', result.attempted, result.reclaimed, kept, String(failed) + ' worktree(s) could not be cleaned')
          : ownerResult('worktree', kept > 0 ? 'kept' : 'reclaimed', result.attempted, result.reclaimed, kept),
      );
    } catch (error) {
      results.push(ownerResult('worktree', 'failed', 0, 0, 0, String(error)));
    }
  } else {
    results.push(ownerResult('worktree', 'not-owned', 0, 0, 0, 'action preserves worktrees'));
  }

  if (contract.releasesAdmission && request.owners.admission) {
    try {
      const released = await request.owners.admission.release({
        sessionKey: request.scope.sessionKey,
        expectedSessionId: request.scope.expectedSessionId,
      });
      results.push(ownerResult('admission-permit', 'reclaimed', released, released, 0));
    } catch (error) {
      results.push(ownerResult('admission-permit', 'failed', 0, 0, 0, String(error)));
    }
  } else {
    results.push(ownerResult('admission-permit', 'not-owned', 0, 0, 0, 'action does not release admission permits'));
  }

  return buildReclaimReceipt({
    action: request.action,
    scope: request.scope,
    owners: results,
    generatedAt: now,
    recoveryId: request.recoveryId ?? null,
  });
}