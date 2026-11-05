/**
 * P2-004 / F-ISO-001: High-risk action gate when strong sandbox is degraded
 * to policy-light. Degraded mode forces per-action approval (or fail-closed
 * where no approval path exists). Intentionally choosing policy-light
 * (degraded=false) is treated as acknowledged light isolation.
 */

export type SandboxHighRiskActionClass = 'exec' | 'browser' | 'cron';

export type SandboxHighRiskPolicySnapshot = {
  degraded: boolean;
  degradeReason?: string;
  requestedProviderId?: string;
  effectiveProviderId?: string;
  runtimeLevel?: string;
  /**
   * True when the active profile explicitly requested a strong provider
   * (docker-strong / ssh-strong). When set and the effective runtime level is
   * not `strong`, high-risk actions must fail closed instead of silently
   * executing on the host/policy-light path (issue #156). Unlike `degraded`,
   * this is never satisfied by a per-action approval.
   */
  strengthRequired?: boolean;
};

export type SandboxHighRiskGateDecision = {
  allowed: boolean;
  requiresApproval: boolean;
  actionClass: SandboxHighRiskActionClass;
  risk: 'write' | 'network' | 'destructive';
  reason?: string;
  forceVisible: boolean;
};

const CRON_METHOD_RE = /^cron\.(add|update|remove|run)\b/i;
const BROWSER_METHOD_RE =
  /\b(browser|agent[_-]?browser|playwright|puppeteer)\b/i;
const EXEC_METHOD_RE =
  /\b(exec|shell|terminal|command|process\.run|tools?\.exec)\b/i;

export function isHighRiskSandboxActionClass(
  actionClass: string,
): actionClass is SandboxHighRiskActionClass {
  return actionClass === 'exec' || actionClass === 'browser' || actionClass === 'cron';
}

/**
 * Map Gateway RPC method names onto high-risk classes that must be gated
 * under degraded sandbox. Returns null for non-high-risk methods.
 */
export function classifyGatewayMethodForSandboxGate(
  method: string,
): SandboxHighRiskActionClass | null {
  const normalized = method.trim();
  if (!normalized) return null;
  if (CRON_METHOD_RE.test(normalized)) return 'cron';
  if (BROWSER_METHOD_RE.test(normalized)) return 'browser';
  // This refs-only RPC still executes the frozen shell check in its owner.
  if (normalized === 'task_loop.verifyCompletion') return 'exec';
  if (EXEC_METHOD_RE.test(normalized)) return 'exec';
  return null;
}

/**
 * Terminal commands: under degraded sandbox, any non-read command is treated
 * as high-risk exec (shell can escalate outside policy-light controls).
 */
export function classifyTerminalRiskForSandboxGate(
  risk: 'read' | 'write' | 'network' | 'destructive' | 'external-write',
): SandboxHighRiskActionClass | null {
  if (risk === 'read') return null;
  return 'exec';
}

export function classifyAgentBrowserAction(
  action: string,
): SandboxHighRiskActionClass | null {
  const normalized = action.trim().toLowerCase();
  // Status/list/profile reads stay ungated.
  if (
    normalized === 'status'
    || normalized === 'profiles'
    || normalized === 'tasks'
    || normalized === 'vault'
    || normalized === 'validate'
    || normalized === 'list'
    || normalized === 'takeSnapshot'
    || normalized === 'takesnapshot'
    || normalized === 'close'
  ) {
    return null;
  }
  return 'browser';
}

export function classifyCronHostAction(
  action: string,
): SandboxHighRiskActionClass | null {
  const normalized = action.trim().toLowerCase();
  if (normalized === 'list' || normalized === 'sessionhistory') return null;
  if (
    normalized === 'create'
    || normalized === 'update'
    || normalized === 'delete'
    || normalized === 'toggle'
    || normalized === 'trigger'
  ) {
    return 'cron';
  }
  return 'cron';
}

function defaultRiskFor(actionClass: SandboxHighRiskActionClass): SandboxHighRiskGateDecision['risk'] {
  switch (actionClass) {
    case 'browser':
      return 'network';
    case 'cron':
      return 'destructive';
    case 'exec':
    default:
      return 'destructive';
  }
}

/**
 * Decide whether a high-risk action may proceed under the active sandbox policy.
 * When strong sandbox is unavailable (degraded), high-risk actions require
 * stepwise approval (or fail-closed for paths without an approval consumer).
 */
export function decideSandboxHighRiskAction(
  policy: SandboxHighRiskPolicySnapshot | null | undefined,
  actionClass: SandboxHighRiskActionClass,
  options: { allowApproval?: boolean } = {},
): SandboxHighRiskGateDecision {
  const allowApproval = options.allowApproval !== false;
  const risk = defaultRiskFor(actionClass);

  // Explicit-strong fail-closed boundary (issue #156). A profile that asked for
  // strong isolation but resolved to a weaker runtime must never execute a
  // high-risk action on the host/policy-light path. This is stricter than the
  // degraded gate: a per-action approval is not enough to authorize a fallback
  // the operator did not request, so it denies outright.
  if (policy?.strengthRequired && policy.runtimeLevel !== 'strong') {
    const strengthReason = [
      `Sandbox strength requirement unmet: high-risk ${actionClass} is denied because strong isolation was requested but is not active.`,
      policy.degradeReason?.trim()
        || 'Strong sandbox is unavailable; refusing to fall back to policy-light controls.',
      policy.requestedProviderId
        ? `requested=${policy.requestedProviderId}; effective=${policy.effectiveProviderId ?? 'policy-light'}; runtimeLevel=${policy.runtimeLevel ?? 'unknown'}`
        : undefined,
    ].filter(Boolean).join(' ');
    return {
      allowed: false,
      requiresApproval: false,
      actionClass,
      risk,
      reason: strengthReason,
      forceVisible: true,
    };
  }

  if (!policy || !policy.degraded) {
    return {
      allowed: true,
      requiresApproval: false,
      actionClass,
      risk,
      forceVisible: false,
    };
  }

  const degradeReason = policy.degradeReason?.trim()
    || 'Strong sandbox is unavailable; runtime degraded to policy-light controls.';
  const reason = [
    `Sandbox degraded: high-risk ${actionClass} requires per-action approval or is denied.`,
    degradeReason,
    policy.requestedProviderId
      ? `requested=${policy.requestedProviderId}; effective=${policy.effectiveProviderId ?? 'policy-light'}`
      : undefined,
  ].filter(Boolean).join(' ');

  if (allowApproval) {
    return {
      allowed: false,
      requiresApproval: true,
      actionClass,
      risk,
      reason,
      forceVisible: true,
    };
  }

  return {
    allowed: false,
    requiresApproval: false,
    actionClass,
    risk,
    reason,
    forceVisible: true,
  };
}

/**
 * Compose workspace-mode decision with sandbox degraded gate.
 * Harder denies win; sandbox can upgrade allow → approval-required / deny.
 */
export function composeWithSandboxHighRiskGate<T extends {
  allowed: boolean;
  requiresApproval?: boolean;
  reason?: string;
  risk: string;
}>(
  base: T,
  sandbox: SandboxHighRiskGateDecision | null | undefined,
): T {
  if (!sandbox || sandbox.allowed) return base;
  // Existing hard deny without approval path is already fail-closed.
  if (!base.allowed && !base.requiresApproval) return base;
  return {
    ...base,
    allowed: false,
    requiresApproval: sandbox.requiresApproval,
    reason: sandbox.reason ?? base.reason,
    risk: sandbox.risk as T['risk'],
  };
}

/** Build a stable, force-visible degraded summary for status/UI surfaces. */
export function buildForcedDegradedVisibility(
  policy: SandboxHighRiskPolicySnapshot | null | undefined,
): {
  degraded: boolean;
  forceVisible: boolean;
  label: string;
  reason?: string;
  warnings: string[];
} {
  if (!policy?.degraded) {
    return {
      degraded: false,
      forceVisible: true,
      label: 'healthy',
      warnings: [],
    };
  }
  const reason = policy.degradeReason?.trim()
    || 'Strong sandbox backend unavailable; using policy-light controls.';
  const strengthUnmet = policy.strengthRequired === true && policy.runtimeLevel !== 'strong';
  return {
    degraded: true,
    forceVisible: true,
    label: strengthUnmet ? 'unavailable' : 'degraded',
    reason,
    warnings: [
      reason,
      strengthUnmet
        ? 'Strong isolation was explicitly requested but is not active; high-risk exec/browser/cron actions are denied until a strong sandbox is available. Selecting policy-light explicitly acknowledges the weaker boundary.'
        : 'High-risk exec/browser/cron actions require per-action approval or are denied until a strong sandbox is available or policy-light is explicitly selected.',
    ],
  };
}


/** Optional override for tests; production uses active-sandbox-high-risk-policy. */
export type SandboxHighRiskPolicyLoader = () => Promise<SandboxHighRiskPolicySnapshot>;

let sandboxHighRiskPolicyLoader: SandboxHighRiskPolicyLoader | null = null;

export function setSandboxHighRiskPolicyLoader(loader: SandboxHighRiskPolicyLoader | null): void {
  sandboxHighRiskPolicyLoader = loader;
}

/**
 * Resolve active sandbox snapshot for high-risk gates.
 * Never throws to callers: resolution failures fail-closed as degraded.
 */
export async function loadSandboxHighRiskPolicy(): Promise<SandboxHighRiskPolicySnapshot> {
  try {
    if (sandboxHighRiskPolicyLoader) {
      return await sandboxHighRiskPolicyLoader();
    }
    const mod = await import('@electron/utils/active-sandbox-high-risk-policy');
    return await mod.getActiveSandboxHighRiskPolicy();
  } catch {
    return {
      degraded: true,
      degradeReason: 'Unable to resolve sandbox status; treating runtime as degraded policy-light.',
      requestedProviderId: 'policy-light',
      effectiveProviderId: 'policy-light',
      runtimeLevel: 'policy',
    };
  }
}
