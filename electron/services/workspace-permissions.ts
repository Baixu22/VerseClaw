import { isAbsolute, relative, resolve } from 'node:path';
import type { WorkspacePermissionMode, WorkspaceProfile } from '@shared/types/workspace';

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
  'memory.detail',
  'memory.previewProposal',
  'observability.traces',
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
    && typeof process.env.CLAWX_USER_DATA_DIR === 'string'
    && process.env.CLAWX_USER_DATA_DIR.trim().length > 0;
}

export function isPathInsideWorkspace(path: string, workspaceRoot: string): boolean {
  const child = resolve(path);
  const parent = resolve(workspaceRoot);
  const rel = relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
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
  if (!command.trim()) return { allowed: false, risk, reason: '命令不能为空' };

  if (mode === 'fullAccess') return { allowed: true, risk };
  if (mode === 'plan') {
    return { allowed: false, risk, reason: '计划模式下不会直接执行命令，请先完成方案确认' };
  }
  if (mode === 'readOnly') {
    return risk === 'read'
      ? { allowed: true, risk }
      : { allowed: false, risk, reason: '只读模式仅允许查看类命令' };
  }
  if (isApprovalRisk(risk)) {
    return {
      allowed: false,
      requiresApproval: true,
      risk,
      reason: '接受修改模式需要先批准高风险命令',
    };
  }
  return { allowed: true, risk };
}

export function decideWorkspaceFileWrite(
  path: string,
  workspace: WorkspaceProfile,
): WorkspacePermissionDecision {
  const insideWorkspace = isPathInsideWorkspace(path, workspace.rootPath);
  if (workspace.permissionMode === 'fullAccess') {
    return { allowed: true, risk: insideWorkspace ? 'write' : 'external-write' };
  }
  if (workspace.permissionMode === 'plan') {
    return { allowed: false, risk: 'write', reason: '计划模式下不会直接写入文件，请先完成方案确认' };
  }
  if (workspace.permissionMode === 'readOnly') {
    return { allowed: false, risk: 'write', reason: '只读模式不允许写入文件' };
  }
  if (!insideWorkspace) {
    return {
      allowed: false,
      requiresApproval: true,
      risk: 'external-write',
      reason: '写入工作区外文件需要批准',
    };
  }
  return { allowed: true, risk: 'write' };
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
      reason: `${method.trim()} is a dev/test-only Gateway RPC and requires OPENCLAW_TEST_ENABLE_SESSION_MCP_WARM=1 with CLAWX_USER_DATA_DIR`,
    };
  }
  const risk = classifyGatewayRpcRisk(method, params);
  if (risk === 'read') return { allowed: true, risk };
  if (mode === 'fullAccess') return { allowed: true, risk };
  if (mode === 'plan') {
    return { allowed: false, risk, reason: '计划模式下不会直接执行 Gateway 修改请求' };
  }
  if (mode === 'readOnly') {
    return { allowed: false, risk, reason: '只读模式不允许 Gateway 修改请求' };
  }
  return {
    allowed: false,
    requiresApproval: true,
    risk,
    reason: 'Gateway 修改请求需要批准',
  };
}

export function requireWorkspace(workspace: WorkspaceProfile | null): WorkspaceProfile {
  if (!workspace) throw new Error('No active workspace');
  return workspace;
}
