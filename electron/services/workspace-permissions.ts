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
  'skills.status',
  'models.list',
  'chat.send',
  'chat.abort',
  'health',
  'wiki.index.status',
  'wiki.index.search',
  'wiki.embedding.status',
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
  'memory.surface',
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
  // TF-0240: pending runtime exec approvals are a pure read. An operator in
  // readOnly must be able to see what the runtime is waiting on; the decision
  // itself is a separate method with its own rule below.
  'exec.approval.list',
]);

/** Runtime exec-approval decision methods that answer a boundary the runtime
 * already raised. Unlike the workspace mutations around them, these carry a human
 * decision, so they stay reachable in every permission mode: blocking them in
 * readOnly leaves the runtime waiting forever with no in-app way to answer (the
 * J-04 hang). The runtime still enforces its own per-request decision vocabulary
 * and expiry, so this opens the answer channel, not the action. */
const RUNTIME_APPROVAL_DECISION_METHODS = new Set(['exec.approval.resolve']);

export function isRuntimeApprovalDecisionRpc(method: string): boolean {
  return RUNTIME_APPROVAL_DECISION_METHODS.has(method.trim());
}

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

/** Git global flags that take a separate value token, so the value must not be
 * mistaken for the subcommand (`git -C /repo status` → subcommand is `status`). */
const GIT_GLOBAL_FLAGS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--config-env',
  '--exec-path',
]);

/** Git global flags that can turn any read-only subcommand into arbitrary code
 * execution or move it outside the workspace. `-c core.pager=…`, `-c alias.…`
 * and `--config-env` run commands; `--exec-path` redirects git's own helper
 * binaries; `--git-dir`/`--work-tree`/`-C` escape the workspace boundary.
 * These are never safe on an agent-supplied command, whatever the subcommand. */
const GIT_UNSAFE_GLOBAL_FLAGS = new Set([
  '-c',
  '-C',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--config-env',
  '--exec-path',
]);

function isUnsafeGitGlobalFlag(token: string): boolean {
  const bare = token.includes('=') ? token.slice(0, token.indexOf('=')) : token;
  // -c is case-sensitive: -c sets config, -C changes directory. Both are unsafe.
  return GIT_UNSAFE_GLOBAL_FLAGS.has(bare);
}

/** True when a git command carries `--output`, which makes an otherwise
 * read-only subcommand write a file. `git diff --output=<path>` creates AND
 * truncates <path>, and the path is unconstrained, so it can overwrite a file
 * outside the workspace. Classified as read-only, readOnly mode allows it with
 * no further checks.
 *
 * Only `--output=<path>` and `--output <path>` write; `-o` is not an alias for
 * it, and `--output-indicator-new/old/context` merely pick a display character,
 * so nothing but an exact match on the bare flag may count. */
function hasGitOutputRedirect(tokens: string[]): boolean {
  return tokens.some((token) => token === '--output' || token.startsWith('--output='));
}

/** Rewrite `git <global flags> <subcommand> …` as `git <subcommand> …` so the
 * risk patterns below see the real subcommand. Without this, a leading global
 * flag hides it: `git -c x=y reset --hard` fails the `\bgit\s+reset\b` test and
 * silently downgrades from destructive to write. Returns null when the command
 * is not a plain git invocation, or when it carries an unsafe global flag. */
function normalizeGitCommand(normalized: string): { rewritten: string } | { unsafeFlag: string } | null {
  const tokens = normalized.split(' ');
  if (tokens.length === 0) return null;
  const binary = (tokens[0] ?? '').toLowerCase().replace(/\.exe$/, '');
  if (binary !== 'git' && !binary.endsWith('/git') && !binary.endsWith('\\git')) return null;

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (!token) continue;
    if (token === '--') {
      // Everything after -- is a pathspec, so there is no subcommand to expose.
      return null;
    }
    if (token.startsWith('-')) {
      if (isUnsafeGitGlobalFlag(token)) return { unsafeFlag: token };
      if (!token.includes('=') && GIT_GLOBAL_FLAGS_WITH_VALUE.has(token)) index += 1;
      continue;
    }
    return { rewritten: ['git', ...tokens.slice(index)].join(' ') };
  }
  return null;
}

const GIT_WORKTREE_ADD_VALUE_FLAGS = new Set(['-b', '-B', '--reason', '--track']);

function classifyGitWorktreeCommand(command: string): WorkspaceCommandRisk | null {
  const tokens = command.split(' ').filter(Boolean);
  if ((tokens[0] ?? '').toLowerCase() !== 'git' || (tokens[1] ?? '').toLowerCase() !== 'worktree') {
    return null;
  }
  const action = (tokens[2] ?? '').toLowerCase();
  if (action === 'list') return 'read';
  if (action === 'prune' || action === 'remove') return 'destructive';
  if (action !== 'add') return null;

  let index = 3;
  let rawPath: string | undefined;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token === '--') {
      rawPath = tokens[index + 1];
      break;
    }
    if (token.startsWith('-')) {
      index += GIT_WORKTREE_ADD_VALUE_FLAGS.has(token) ? 2 : 1;
      continue;
    }
    rawPath = token;
    break;
  }
  if (!rawPath) return 'write';
  const target = rawPath.replace(/^["']|["']$/g, '');
  const traversalSegments = target.split(/[\\/]/).filter((segment) => segment === '..').length;
  if (
    target.startsWith('~')
    || target.startsWith('/')
    || /^[A-Za-z]:[\\/]/.test(target)
    || traversalSegments > 1
  ) {
    return 'external-write';
  }
  return 'write';
}

export function classifyWorkspaceCommand(command: string): WorkspaceCommandRisk {
  const normalized = normalizeCommand(command);
  if (!normalized) return 'read';

  const git = normalizeGitCommand(normalized);
  // A config-injection or boundary-escaping flag is destructive regardless of
  // the subcommand: `git -c core.pager=… status` runs an arbitrary command.
  if (git && 'unsafeFlag' in git) return 'destructive';
  // Classify the flag-stripped form so global flags cannot mask the subcommand.
  const subject = git ? git.rewritten : normalized;

  if (DANGEROUS_PATTERNS.some((pattern) => pattern.test(subject))) return 'destructive';
  const worktreeRisk = classifyGitWorktreeCommand(subject);
  if (worktreeRisk) return worktreeRisk;
  if (NETWORK_PATTERNS.some((pattern) => pattern.test(subject))) return 'network';
  if (WRITE_PATTERNS.some((pattern) => pattern.test(subject))) return 'write';

  // A whitelisted read subcommand stops being read-only once it redirects its
  // output to a file, so it must not reach the whitelist below.
  if (git && 'rewritten' in git && hasGitOutputRedirect(subject.split(' '))) return 'write';

  const firstOne = firstWords(subject, 1);
  const firstTwo = firstWords(subject, 2);
  if (READ_ONLY_COMMANDS.has(firstOne) || READ_ONLY_COMMANDS.has(firstTwo)) return 'read';
  return 'write';
}

export function isApprovalRisk(risk: WorkspaceCommandRisk): risk is Exclude<WorkspaceCommandRisk, 'read' | 'write'> {
  return risk === 'network' || risk === 'destructive' || risk === 'external-write';
}

/** True when a path points at git repository metadata rather than project
 * content. Writing here is not an ordinary edit: `.git/hooks/*` executes on the
 * next commit, `.git/config` can point `core.pager`/`core.hooksPath`/`alias.*`
 * at an arbitrary command, and `.git/HEAD` or `.git/refs/*` rewrite history out
 * from under the user. These stay approval-gated even inside the workspace,
 * where ordinary edits are auto-accepted.
 *
 * Matches a `.git` segment anywhere in the path, so nested repositories,
 * submodules and linked worktrees are covered — including the bare `.git`
 * pointer file a worktree/submodule uses, which could otherwise be rewritten
 * to redirect the real gitdir elsewhere. */
export function isGitMetadataPath(path: string): boolean {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .some((segment) => segment.toLowerCase() === '.git');
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
  // Repository metadata is inside the workspace but is not project content:
  // a hook or config written here runs on the next git invocation, so it stays
  // gated instead of being auto-accepted with ordinary edits.
  if (isGitMetadataPath(path)) {
    return {
      allowed: false,
      requiresApproval: true,
      risk: 'destructive',
      reason: 'Write target is Git repository metadata (.git); hooks and config can execute commands, so this requires approval',
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
  if (isRuntimeApprovalDecisionRpc(method)) return { allowed: true, risk };
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
