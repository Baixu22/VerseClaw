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

export type ReclaimAuthority = 'managed' | 'observed' | 'unknown';

export type OwnerReclaimResult = {
  kind: ReclaimOwnerKind;
  owner: string;
  outcome: ReclaimOutcome;
  authority: ReclaimAuthority;
  generation: string | null;
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

export type LongSessionCoordinationPolicy = {
  maxProcesses: number | null;
  maxRssMb: number | null;
  maxBackgroundTerminals: number | null;
  maxWorktrees: number | null;
  idleTtlMs: number | null;
  keepOnLeave: boolean | null;
};

export type LongSessionCoordinationUsage = {
  processCount: number | null;
  rssKb: number | null;
  backgroundTerminals: number | null;
  worktreeCount: number | null;
};

export type LongSessionCoordinationDecision = {
  allowed: boolean;
  requested: number;
  reasons: Array<{
    dimension: 'maxProcesses' | 'maxRssMb' | 'maxBackgroundTerminals' | 'maxWorktrees';
    observed: number | null;
    limit: number;
    reason: 'limit-exceeded' | 'measurement-unknown';
  }>;
};

export type SessionOwnerInventoryKind = ReclaimOwnerKind | 'process' | 'provider' | 'durable-helper' | 'shared-gateway';

export type SessionOwnerInventory = {
  kind: SessionOwnerInventoryKind;
  owner: string;
  authority: ReclaimAuthority;
  generation: string | null;
  state: 'known' | 'unknown';
  observationScope?: 'session' | 'shared';
  sampledAt?: number;
  count: number | null;
  pids: number[] | null;
  processTreePids: number[] | null;
  rssKb: number | null;
  cpuPercent: number | null;
  activePermits: number | null;
  waiters: number | null;
  helperRefs: number | null;
  worktreeIds: string[] | null;
  sessionIds: string[] | null;
  reservedPorts?: number[];
  detail?: string;
  /** Read directly from provider owner records; never used as an admission authority. */
  spend?: Array<{
    scope: 'host' | 'project' | 'session'; spentTokens: number; spentCostMicros: number;
    heldTokens: number; heldCostMicros: number; activeCalls: number; unknownTokenCalls: number; unknownCostCalls: number;
  }>;
};

export type LongSessionResourceInventory = {
  schema: 'LongSessionResourceInventory/v1';
  scope: ReclaimScope;
  capturedAt: string;
  owners: SessionOwnerInventory[];
};

export const LONG_SESSION_POLICY_ENV = {
  maxProcesses: 'OPENCLAW_LONG_SESSION_MAX_PROCESSES',
  maxRssMb: 'OPENCLAW_LONG_SESSION_MAX_RSS_MB',
  maxBackgroundTerminals: 'OPENCLAW_LONG_SESSION_MAX_BACKGROUND_TERMINALS',
  maxWorktrees: 'OPENCLAW_LONG_SESSION_MAX_WORKTREES',
  idleTtlMs: 'OPENCLAW_LONG_SESSION_IDLE_TTL_MS',
  keepOnLeave: 'OPENCLAW_LONG_SESSION_KEEP_ON_LEAVE',
} as const;

function readPositiveInteger(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/u.test(value.trim())) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Explicit policy only; unset values stay null and do not become product defaults. */
export function resolveLongSessionCoordinationPolicy(
  env: Record<string, string | undefined> = process.env,
): LongSessionCoordinationPolicy {
  const keepRaw = env[LONG_SESSION_POLICY_ENV.keepOnLeave]?.trim().toLowerCase();
  return {
    maxProcesses: readPositiveInteger(env[LONG_SESSION_POLICY_ENV.maxProcesses]),
    maxRssMb: readPositiveInteger(env[LONG_SESSION_POLICY_ENV.maxRssMb]),
    maxBackgroundTerminals: readPositiveInteger(env[LONG_SESSION_POLICY_ENV.maxBackgroundTerminals]),
    maxWorktrees: readPositiveInteger(env[LONG_SESSION_POLICY_ENV.maxWorktrees]),
    idleTtlMs: readPositiveInteger(env[LONG_SESSION_POLICY_ENV.idleTtlMs]),
    keepOnLeave: keepRaw === undefined || keepRaw === '' ? null : keepRaw !== 'false',
  };
}

export class LongSessionCoordinationError extends Error {
  readonly decision: LongSessionCoordinationDecision;

  constructor(decision: LongSessionCoordinationDecision) {
    super(`long-session resource budget rejected: ${decision.reasons.map((entry) => `${entry.dimension}:${entry.reason}`).join(', ')}`);
    this.name = 'LongSessionCoordinationError';
    this.decision = decision;
  }
}
export function decideLongSessionCoordination(params: {
  policy: LongSessionCoordinationPolicy;
  usage: LongSessionCoordinationUsage;
  request: { processes?: number; rssKb?: number | null; backgroundTerminals?: number; worktrees?: number };
}): LongSessionCoordinationDecision {
  const reasons: LongSessionCoordinationDecision['reasons'] = [];
  const checks: Array<{
    dimension: keyof Pick<LongSessionCoordinationPolicy, 'maxProcesses' | 'maxRssMb' | 'maxBackgroundTerminals' | 'maxWorktrees'>;
    usage: number | null;
    limit: number | null;
    requested: number;
  }> = [
    { dimension: 'maxProcesses', usage: params.usage.processCount, limit: params.policy.maxProcesses, requested: params.request.processes ?? 0 },
    { dimension: 'maxRssMb', usage: params.usage.rssKb, limit: params.policy.maxRssMb === null ? null : params.policy.maxRssMb * 1024, requested: params.request.rssKb ?? 0 },
    { dimension: 'maxBackgroundTerminals', usage: params.usage.backgroundTerminals, limit: params.policy.maxBackgroundTerminals, requested: params.request.backgroundTerminals ?? 0 },
    { dimension: 'maxWorktrees', usage: params.usage.worktreeCount, limit: params.policy.maxWorktrees, requested: params.request.worktrees ?? 0 },
  ];
  for (const check of checks) {
    if (check.limit === null || check.requested <= 0) continue;
    if (check.usage === null) {
      reasons.push({ dimension: check.dimension, observed: null, limit: check.limit, reason: 'measurement-unknown' });
    } else if (check.usage + check.requested > check.limit) {
      reasons.push({ dimension: check.dimension, observed: check.usage, limit: check.limit, reason: 'limit-exceeded' });
    }
  }
  return {
    allowed: reasons.length === 0,
    requested: Math.max(params.request.processes ?? 0, params.request.backgroundTerminals ?? 0, params.request.worktrees ?? 0),
    reasons,
  };
}
export type TerminalKeepPolicy = {
  /** Set when the user explicitly chose to keep this terminal across UI unload. */
  keepOnLeave?: boolean;
};

/** A `keep_on_leave` terminal is never swept by ui-unload or workspace-switch. */
export function shouldKeepTerminalOnLeave(
  action: ReclaimAction,
  policy: TerminalKeepPolicy | undefined,
): boolean {
  if (policy?.keepOnLeave === false) return false;
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
    reclaim: (params: { sessionKey: string; workspaceId?: string; expectedSessionId?: string | null; honorKeepOnLeave: boolean }) => { attempted: number; reclaimed: number; kept: number; failed?: number } | Promise<{ attempted: number; reclaimed: number; kept: number; failed?: number }>;
    count: (params: { sessionKey: string; workspaceId?: string; expectedSessionId?: string | null }) => number;
  };
  browsers?: {
    reclaim: (params: { sessionKey: string; workspaceId?: string; expectedSessionId?: string | null }) => Promise<{ attempted: number; reclaimed: number; detail?: string }> | { attempted: number; reclaimed: number; detail?: string };
  };
  backgroundPorts?: {
    reclaim: (params: { sessionKey: string; expectedSessionId?: string | null }) => Promise<{ attempted: number; reclaimed: number; failed?: number; detail?: string }>;
  };
  worktrees?: {
    reclaim: (params: { sessionKey: string; workspaceId?: string; expectedSessionId?: string | null }) => Promise<{ attempted: number; reclaimed: number; failed?: number; kept?: number; detail?: string }>;
  };
  admission?: {
    release: (params: { sessionKey: string; expectedSessionId?: string | null }) => Promise<number | { released: number; detail?: string }> | number | { released: number; detail?: string };
  };
};

export type ReclaimRequest = {
  action: ReclaimAction;
  scope: ReclaimScope;
  owners: ReclaimOwnerHandlers;
  generatedAt?: string;
  recoveryId?: string | null;
};

function ownerResult(
  kind: ReclaimOwnerKind,
  outcome: ReclaimOutcome,
  attempted: number,
  reclaimed: number,
  kept: number,
  detail?: string,
  authority: ReclaimAuthority = 'unknown',
  generation: string | null = null,
): OwnerReclaimResult {
  return {
    kind,
    owner: RECLAIM_OWNERS.find((entry) => entry.kind === kind)?.owner ?? kind,
    outcome,
    authority,
    generation,
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
  const generation = request.scope.expectedSessionId ?? null;

  if (contract.closesTerminals && !request.owners.terminals) {
    results.push(ownerResult('terminal', 'unknown', 0, 0, 0, 'terminal owner is unavailable', 'unknown', generation));
  } else if (contract.closesTerminals && request.owners.terminals) {
    try {
      const result = await request.owners.terminals.reclaim({
        sessionKey: request.scope.sessionKey,
        workspaceId: request.scope.workspaceId,
        expectedSessionId: request.scope.expectedSessionId,
        honorKeepOnLeave: request.action !== 'session-delete',
      });
      const kept = result.kept ?? 0;
      const failed = result.failed ?? 0;
      const outcome = failed > 0 ? 'failed' : result.attempted === 0 ? 'not-owned' : result.reclaimed > 0 ? 'reclaimed' : kept > 0 ? 'kept' : 'failed';
      results.push(ownerResult('terminal', outcome, result.attempted, result.reclaimed, kept,
        failed ? `${failed} terminal owner(s) remain` : undefined, 'managed', generation));
    } catch (error) {
      results.push(ownerResult('terminal', 'failed', 0, 0, 0, String(error), 'managed', generation));
    }
  } else if (request.owners.terminals) {
    const keptOnLeave = request.owners.terminals.count({
      sessionKey: request.scope.sessionKey,
      workspaceId: request.scope.workspaceId,
      expectedSessionId: request.scope.expectedSessionId,
    });
    results.push(ownerResult('terminal', keptOnLeave > 0 ? 'kept' : 'not-owned', keptOnLeave, 0, keptOnLeave, 'action does not close terminals; keep_on_leave preserved', 'managed', generation));
  }

  if (contract.closesBrowsers && !request.owners.browsers) {
    results.push(ownerResult('browser', 'unknown', 0, 0, 0, 'browser owner is unavailable', 'unknown', generation));
  } else if (contract.closesBrowsers && request.owners.browsers) {
    try {
      const result = await request.owners.browsers.reclaim({
        sessionKey: request.scope.sessionKey,
        workspaceId: request.scope.workspaceId,
        expectedSessionId: request.scope.expectedSessionId,
      });
      const failed = result.attempted - result.reclaimed;
      results.push(ownerResult(
        'browser',
        result.attempted === 0 ? 'not-owned' : failed > 0 ? 'failed' : 'reclaimed',
        result.attempted,
        result.reclaimed,
        0,
        failed > 0 ? `${failed} browser session(s) remain` : result.detail,
        'managed',
        generation,
      ));
    } catch (error) {
      results.push(ownerResult('browser', 'failed', 0, 0, 0, String(error), 'managed', generation));
    }
  } else {
    results.push(ownerResult('browser', 'not-owned', 0, 0, 0, 'action does not close browser sessions', 'observed', generation));
  }

  if (contract.stopsManagedPorts && !request.owners.backgroundPorts) {
    results.push(ownerResult('background-port', 'unknown', 0, 0, 0, 'managed-port owner is unavailable', 'unknown', generation));
  } else if (contract.stopsManagedPorts && request.owners.backgroundPorts) {
    try {
      const result = await request.owners.backgroundPorts.reclaim({
        sessionKey: request.scope.sessionKey,
        expectedSessionId: request.scope.expectedSessionId,
      });
      const failed = result.failed ?? 0;
      results.push(
        failed > 0
          ? ownerResult('background-port', 'failed', result.attempted, result.reclaimed, 0, `${failed} managed port(s) still reachable`, 'managed', generation)
          : ownerResult('background-port', result.attempted === 0 ? 'not-owned' : 'reclaimed', result.attempted, result.reclaimed, 0, result.detail, 'managed', generation),
      );
    } catch (error) {
      results.push(ownerResult('background-port', 'failed', 0, 0, 0, String(error), 'managed', generation));
    }
  } else {
    results.push(ownerResult('background-port', 'not-owned', 0, 0, 0, 'action does not stop managed ports', 'observed', generation));
  }

  if (contract.cleansWorktrees && !request.owners.worktrees) {
    results.push(ownerResult('worktree', 'unknown', 0, 0, 0, 'worktree owner is unavailable; paths retained', 'unknown', generation));
  } else if (contract.cleansWorktrees && request.owners.worktrees) {
    try {
      const result = await request.owners.worktrees.reclaim({
        sessionKey: request.scope.sessionKey,
        workspaceId: request.scope.workspaceId,
        expectedSessionId: request.scope.expectedSessionId,
      });
      const failed = result.failed ?? 0;
      const kept = result.kept ?? 0;
      results.push(
        failed > 0
          ? ownerResult('worktree', 'failed', result.attempted, result.reclaimed, kept, `${failed} worktree(s) could not be cleaned`, 'managed', generation)
          : result.attempted === 0
            ? ownerResult('worktree', 'not-owned', 0, 0, 0, result.detail, 'managed', generation)
            : ownerResult('worktree', kept > 0 ? 'kept' : 'reclaimed', result.attempted, result.reclaimed, kept, result.detail, 'managed', generation),
      );
    } catch (error) {
      results.push(ownerResult('worktree', 'failed', 0, 0, 0, String(error), 'managed', generation));
    }
  } else {
    results.push(ownerResult('worktree', 'not-owned', 0, 0, 0, 'action preserves worktrees', 'observed', generation));
  }

  if (contract.releasesAdmission && !request.owners.admission) {
    results.push(ownerResult('admission-permit', 'unknown', 0, 0, 0, 'runtime admission owner is unavailable', 'unknown', generation));
  } else if (contract.releasesAdmission && request.owners.admission) {
    try {
      const result = await request.owners.admission.release({
        sessionKey: request.scope.sessionKey,
        expectedSessionId: request.scope.expectedSessionId,
      });
      const released = typeof result === 'number' ? result : result.released;
      const detail = typeof result === 'number' ? undefined : result.detail;
      results.push(ownerResult('admission-permit', released === 0 ? 'not-owned' : 'reclaimed', released, released, 0, detail, 'managed', generation));
    } catch (error) {
      results.push(ownerResult('admission-permit', 'failed', 0, 0, 0, String(error), 'managed', generation));
    }
  } else {
    results.push(ownerResult('admission-permit', 'not-owned', 0, 0, 0, 'action does not release admission permits', 'observed', generation));
  }

  return buildReclaimReceipt({
    action: request.action,
    scope: request.scope,
    owners: results,
    generatedAt: now,
    recoveryId: request.recoveryId ?? null,
  });
}
