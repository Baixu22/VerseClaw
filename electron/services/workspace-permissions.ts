import { isPathInsideWorkspaceLexical, isResolvedPathInsideRoot } from './path-broker';
import type { WorkspacePermissionMode, WorkspaceProfile } from '@shared/types/workspace';
import { DEFAULT_WORKSPACE_PERMISSION_MODE } from '@shared/types/workspace';

export { DEFAULT_WORKSPACE_PERMISSION_MODE };

export type WorkspaceCommandRisk = 'read' | 'write' | 'network' | 'destructive' | 'external-write';

export type WorkspacePermissionDecision = {
  allowed: boolean;
  requiresApproval?: boolean;
  reason?: string;
  risk: WorkspaceCommandRisk;
};

const READ_ONLY_COMMANDS = new Set([
  'cat',
  'cd',
  'dir',
  'find',
  'findstr',
  'git status',
  'git diff',
  'git log',
  'git show',
  'ls',
  'pwd',
  'rg',
  'type',
  'where',
]);

const DANGEROUS_PATTERNS = [
  /\brm\s+.*(-r|-f|\/s|\/q)\b/i,
  /\bremove-item\b.*(-recurse|-force)\b/i,
  /\bdel\s+.*(\/s|\/q)\b/i,
  /\brmdir\b|\brd\s+/i,
  /\bgit\s+(reset|clean)\b/i,
  /\bgit\s+checkout\b.*\s(--|\*)/i,
  /\bmkfs\b|\bdiskpart\b|\bformat\s+[a-z]:/i,
  /\bshutdown\b|\brestart-computer\b/i,
  /\bchmod\s+-r\b|\bchown\s+-r\b/i,
];

const NETWORK_PATTERNS = [
  /\b(curl|wget)\b/i,
  /\b(invoke-webrequest|invoke-restmethod|iwr|irm)\b/i,
  /\b(npm|pnpm|yarn|bun)\s+(install|i|add|update|upgrade|exec|dlx|create|publish|login)\b/i,
  /\b(pip|pip3)\s+install\b/i,
  /\buv\s+(add|pip|sync|run)\b/i,
  /\bpoetry\s+(add|install|update|run)\b/i,
  /\bcargo\s+(install|update)\b/i,
  /\bgo\s+(get|install)\b/i,
  /\b(git)\s+(fetch|pull|push|clone)\b/i,
];

const WRITE_PATTERNS = [
  />|>>|\bset-content\b|\bout-file\b|\bnew-item\b|\bcopy-item\b|\bmove-item\b/i,
  /\bmkdir\b|\bmd\s+/i,
  /\bcargo\s+(build|run|test)\b|\bgo\s+(build|run|test)\b/i,
];

const SAFE_GATEWAY_METHODS = new Set([
  'chat.history',
  'sessions.list',
  'sessions.labels',
  'skills.list',
  'skills.status',
  'model.list',
  'models.list',
  'chat.send',
  'chat.abort',
  'health',
  'openclaw.health',
  // Role-first runtime read methods (registry/templates/planning are side-effect free).
  // orchestrator.run is intentionally NOT here: it spawns subagents and is gated as a
  // mutating request so it requires approval outside fullAccess mode.
  'roles.list',
  'roles.get',
  'teams.list',
  'orchestrator.plan',
  'clawgraph.listWorkflows',
  'clawgraph.compile',
  'clawgraph.status',
  'clawgraph.events',
  // Memory read + observability read: list/traces are side-effect free reads.
  // memory.store and observability.reportTrace remain write-gated (require approval).
  'memory.list',
  'memory.conflicts',
  'memory.conflictDetail',
  'memory.explainInjection',
  'memory.proposals',
  'memory.versions',
  'memory.audit',
  'memory.stats',
  'memory.policy',
  'memory.retentionCandidates',
  'memory.evidenceCheck',
  'memory.simulateInjection',
  'memory.health',
  'memory.utilityReport',
  'memory.evalReport',
  'memory.detail',
  'memory.previewProposal',
  'memory.feedbackList',
  'observability.traces',
  // FP-P0-04: child-runtime flag acknowledgement. Pure read — the child reports its
  // own resolved flags, pid, config source and turn-effect probe. It mutates
  // nothing, and the control plane must be able to read it in every permission mode
  // (an operator in readOnly still needs to see whether a flag actually applied).
  'runtime.flags.ack',
  'security.health',
  'security.policy.get',
  'security.policy.simulate',
  'security.intercepts.list',
  'verification.health',
  'verification.run',
  'verification.status',
  'verification.results.list',
  'verification.results.get',
]);

const DEV_ONLY_GATEWAY_METHODS = new Set<string>([]);

const MUTATING_GATEWAY_PATTERNS = [
  /\b(exec|shell|command|terminal|run)\b/i,
  /\b(write|patch|edit|apply|delete|remove|rename|move|create|mkdir)\b/i,
  /\btool\.(call|run|execute)\b/i,
  /\bfiles?\.(write|delete|move|rename|patch)\b/i,
];

export function isDevOnlyGatewayRpc(method: string): boolean {
  return DEV_ONLY_GATEWAY_METHODS.has(method.trim());
}

export function isDevOnlyGatewayRpcEnabled(method: string): boolean {
  if (!isDevOnlyGatewayRpc(method)) return true;
  return process.env.OPENCLAW_TEST_ENABLE_SESSION_MCP_WARM === '1'
    && typeof process.env.VERSE_CLAW_USER_DATA_DIR === 'string'
    && process.env.VERSE_CLAW_USER_DATA_DIR.trim().length > 0;
}

export function isPathInsideWorkspace(path: string, workspaceRoot: string): boolean {
  // Lexical-only. For IO authorization use isPathInsideWorkspaceResolved().
  return isPathInsideWorkspaceLexical(path, workspaceRoot);
}

export async function isPathInsideWorkspaceResolved(path: string, workspaceRoot: string): Promise<boolean> {
  return isResolvedPathInsideRoot(path, workspaceRoot);
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

function firstWords(command: string, count: number): string {
  return normalizeCommand(command)
    .split(' ')
    .slice(0, count)
    .join(' ')
    .toLowerCase();
}

export function classifyWorkspaceCommand(command: string): WorkspaceCommandRisk {
  const normalized = normalizeCommand(command);
  if (!normalized) return 'read';
  if (DANGEROUS_PATTERNS.some((pattern) => pattern.test(normalized))) return 'destructive';
  if (NETWORK_PATTERNS.some((pattern) => pattern.test(normalized))) return 'network';
  if (WRITE_PATTERNS.some((pattern) => pattern.test(normalized))) return 'write';

  const firstOne = firstWords(normalized, 1);
  const firstTwo = firstWords(normalized, 2);
  if (READ_ONLY_COMMANDS.has(firstOne) || READ_ONLY_COMMANDS.has(firstTwo)) return 'read';
  return 'write';
}

export function isApprovalRisk(risk: WorkspaceCommandRisk): risk is Exclude<WorkspaceCommandRisk, 'read' | 'write'> {
  return risk === 'network' || risk === 'destructive' || risk === 'external-write';
}

export function decideWorkspaceCommand(
  command: string,
  mode: WorkspacePermissionMode,
): WorkspacePermissionDecision {
  const risk = classifyWorkspaceCommand(command);
  if (!command.trim()) return { allowed: false, risk, reason: 'Command cannot be empty' };

  if (mode === 'fullAccess') return { allowed: true, risk };
  if (mode === 'plan') {
    return { allowed: false, risk, reason: 'Plan mode does not execute commands directly' };
  }
  if (mode === 'readOnly') {
    return risk === 'read'
      ? { allowed: true, risk }
      : { allowed: false, risk, reason: 'Read-only mode only allows inspection commands' };
  }
  if (isApprovalRisk(risk)) {
    return {
      allowed: false,
      requiresApproval: true,
      risk,
      reason: 'Accept-edits mode requires approval for high-risk commands',
    };
  }
  return { allowed: true, risk };
}

export function decideWorkspaceFileWrite(
  path: string,
  workspace: WorkspaceProfile,
  options: { insideWorkspace?: boolean } = {},
): WorkspacePermissionDecision {
  const insideWorkspace = options.insideWorkspace ?? isPathInsideWorkspace(path, workspace.rootPath);
  if (workspace.permissionMode === 'fullAccess') {
    return { allowed: true, risk: insideWorkspace ? 'write' : 'external-write' };
  }
  if (workspace.permissionMode === 'plan') {
    return { allowed: false, risk: 'write', reason: 'Plan mode does not write files directly' };
  }
  if (workspace.permissionMode === 'readOnly') {
    return { allowed: false, risk: 'write', reason: 'Read-only mode does not allow file writes' };
  }
  if (!insideWorkspace) {
    return {
      allowed: false,
      requiresApproval: true,
      risk: 'external-write',
      // FP-P1-02: name the actual boundary so the denial is self-explaining.
      reason: `Write target is outside the workspace boundary (${workspace.rootPath}); external writes require approval`,
    };
  }
  // acceptEdits: auto-accept in-workspace file edits only; high-risk shell/git remain gated elsewhere.
  return { allowed: true, risk: 'write', reason: 'Accept-edits mode auto-accepts in-workspace file edits' };
}

export async function decideWorkspaceFileWriteResolved(
  path: string,
  workspace: WorkspaceProfile,
): Promise<WorkspacePermissionDecision> {
  const insideWorkspace = await isPathInsideWorkspaceResolved(path, workspace.rootPath);
  return decideWorkspaceFileWrite(path, workspace, { insideWorkspace });
}

export function classifyGatewayRpcRisk(method: string, params?: unknown): WorkspaceCommandRisk {
  const normalizedMethod = method.trim();
  if (!normalizedMethod) return 'write';
  if (isDevOnlyGatewayRpc(normalizedMethod)) return 'destructive';
  if (SAFE_GATEWAY_METHODS.has(normalizedMethod)) return 'read';
  const haystack = `${normalizedMethod} ${JSON.stringify(params ?? {})}`;
  if (DANGEROUS_PATTERNS.some((pattern) => pattern.test(haystack))) return 'destructive';
  if (NETWORK_PATTERNS.some((pattern) => pattern.test(haystack))) return 'network';
  if (MUTATING_GATEWAY_PATTERNS.some((pattern) => pattern.test(haystack))) return 'destructive';
  return 'write';
}

export function decideGatewayRpc(
  method: string,
  mode: WorkspacePermissionMode,
  params?: unknown,
): WorkspacePermissionDecision {
  if (isDevOnlyGatewayRpc(method) && !isDevOnlyGatewayRpcEnabled(method)) {
    return {
      allowed: false,
      risk: 'destructive',
      reason: `${method.trim()} is a dev/test-only Gateway RPC and requires OPENCLAW_TEST_ENABLE_SESSION_MCP_WARM=1 with VERSE_CLAW_USER_DATA_DIR`,
    };
  }
  const risk = classifyGatewayRpcRisk(method, params);
  if (risk === 'read') return { allowed: true, risk };
  if (mode === 'fullAccess') return { allowed: true, risk };
  if (mode === 'plan') {
    return { allowed: false, risk, reason: 'Plan mode does not execute Gateway mutations' };
  }
  if (mode === 'readOnly') {
    return { allowed: false, risk, reason: 'Read-only mode does not allow Gateway mutations' };
  }
  return {
    allowed: false,
    requiresApproval: true,
    risk,
    reason: 'Gateway mutations require approval',
  };
}

export function requireWorkspace(workspace: WorkspaceProfile | null): WorkspaceProfile {
  if (!workspace) throw new Error('No active workspace');
  return workspace;
}
