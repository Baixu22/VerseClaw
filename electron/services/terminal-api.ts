import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  WorkspaceTerminalOpenPayload,
  WorkspaceTerminalListPayload,
  WorkspaceTerminalRunResult,
  WorkspaceTerminalStatusPayload,
} from '@shared/host-api/contract';
import type { WorkspaceProfile } from '@shared/types/workspace';
import { createSandboxDenialDetails, type SandboxDenialDetails } from '@shared/sandbox/errors';
import { capToolResultText } from '@shared/agent-resource-limits';
import type { GatewayManager } from '../gateway/manager';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { isRecord } from './payload-utils';
import {
  consumeApprovedPermissionApproval,
  createPermissionApproval,
  recordPermissionDecisionEvent,
  recordPermissionAudit,
} from './permissions-api';
import { TerminalSessionManager } from './terminal-session-manager';
import { isTerminalResourceLeaseTimeoutError, ResourceFabricTimeoutError, withWorkspaceExecLease } from './resource-fabric';
import { getHostDeadline } from '../utils/host-deadline-context';
import { findSessionDeleteGateBySession, tryWithSessionDeleteGateLock } from './session-delete-gate';
import { getActiveWorkspaceProfile } from './workspaces-api';
import { createWorkspacePermissionDecisionEvent } from './permission-decision-audit';
import {
  decideWorkspaceCommand,
  isApprovalRisk,
  isPathInsideWorkspace,
  requireWorkspace,
  type WorkspaceCommandRisk,
} from './workspace-permissions';
import {
  classifyTerminalRiskForSandboxGate,
  composeWithSandboxHighRiskGate,
  decideSandboxHighRiskAction,
  loadSandboxHighRiskPolicy,
} from '@electron/utils/sandbox-high-risk-gate';
import {
  createHostTraceDiagnosticsService,
  type HostTraceDiagnosticsEvidence,
  type HostTraceDiagnosticsService,
} from './host-trace-diagnostics';

type RunPayload = {
  command?: unknown;
  timeoutMs?: unknown;
  approvalId?: unknown;
};

type TerminalSessionPayload = {
  sessionId?: unknown;
  data?: unknown;
  cols?: unknown;
  rows?: unknown;
};

type TerminalExecutionOutcome = {
  result: WorkspaceTerminalRunResult;
  traceEvidence: HostTraceDiagnosticsEvidence;
};

const MAX_OUTPUT_CHARS = 80_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

const OPENCLAW_TERMINAL_RPC_METHODS = [
  'terminal.run',
  'shell.run',
  'exec.run',
  'tools.exec',
] as const;

function clampTimeout(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.floor(value), 1000), MAX_TIMEOUT_MS);
}

function requireCommand(payload: unknown): string {
  const command = isRecord(payload) ? (payload as RunPayload).command : payload;
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('command is required');
  }
  return command.trim();
}

function normalizeApprovalId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function trimOutput(value: string): string {
  return capToolResultText(value, MAX_OUTPUT_CHARS).text;
}

function isUnsupportedOpenClawExecRpc(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unknown method|method not found|not implemented|unsupported|unrecognized request/i.test(message);
}

function stringFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return String(value);
}

function numberFromUnknown(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function tracePhaseFromUnknown(value: unknown): TerminalExecutionOutcome['traceEvidence']['phase'] | undefined {
  return value === 'compile' || value === 'test' || value === 'tool' || value === 'permission'
    || value === 'environment' || value === 'runtime'
    ? value
    : undefined;
}

function traceEvidenceFromGatewayResult(
  result: Record<string, unknown>,
  normalized: WorkspaceTerminalRunResult,
): TerminalExecutionOutcome['traceEvidence'] {
  const status = result.status;
  const timedOut = result.timedOut === true || status === 'timeout' || status === 'timed_out';
  const cancelled = result.cancelled === true || status === 'cancelled' || status === 'aborted';
  const code = typeof result.errorCode === 'string'
    ? result.errorCode
    : typeof result.code === 'string'
      ? result.code
      : undefined;
  return {
    phase: tracePhaseFromUnknown(result.phase),
    code: code ?? (timedOut ? 'ETIMEDOUT' : cancelled ? 'ABORT_ERR' : 'RUNTIME_ERROR'),
    exitCode: normalized.exitCode ?? undefined,
    signal: typeof result.signal === 'string' ? result.signal : undefined,
    durationMs: normalized.durationMs,
    ...(timedOut ? { timedOut: true } : {}),
    ...(cancelled ? { cancelled: true } : {}),
  };
}

function traceEvidenceFromGatewayError(error: unknown, durationMs: number): TerminalExecutionOutcome['traceEvidence'] {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) {
    return { code: 'ETIMEDOUT', timedOut: true, durationMs };
  }
  if (/abort|cancel/i.test(message)) {
    return { code: 'ABORT_ERR', cancelled: true, durationMs };
  }
  if (/EACCES|EPERM|access denied|permission denied|not permitted/i.test(message)) {
    return { code: 'EACCES', durationMs };
  }
  if (/ENOENT|command not found|tool not found|cannot find module/i.test(message)) {
    return { code: 'ENOENT', durationMs };
  }
  if (/invalid (?:cwd|env)|workspace not found|config(?:uration)? not found/i.test(message)) {
    return { code: 'INVALID_CWD', durationMs };
  }
  return { code: 'RUNTIME_ERROR', durationMs };
}

function normalizeGatewayExecResult(input: {
  result: unknown;
  command: string;
  cwd: string;
  risk: WorkspaceCommandRisk | 'none' | 'dangerous';
  startedAt: number;
}): TerminalExecutionOutcome {
  const result = isRecord(input.result) ? input.result : {};
  const exitCode = numberFromUnknown(result.exitCode)
    ?? numberFromUnknown(result.code)
    ?? numberFromUnknown(result.status);
  const stdout = trimOutput(
    stringFromUnknown(result.stdout)
    || stringFromUnknown(result.output)
    || stringFromUnknown(result.text),
  );
  const stderr = trimOutput(
    stringFromUnknown(result.stderr)
    || stringFromUnknown(result.error),
  );
  const success = typeof result.success === 'boolean'
    ? result.success
    : typeof result.ok === 'boolean'
      ? result.ok
      : exitCode === null || exitCode === 0;

  const normalized: WorkspaceTerminalRunResult = {
    success,
    blocked: false,
    cwd: typeof result.cwd === 'string' ? result.cwd : input.cwd,
    command: typeof result.command === 'string' ? result.command : input.command,
    exitCode,
    stdout,
    stderr,
    durationMs: numberFromUnknown(result.durationMs) ?? Date.now() - input.startedAt,
    ...(result.timedOut === true ? { timedOut: true } : {}),
    risk: input.risk,
  };
  return {
    result: normalized,
    traceEvidence: traceEvidenceFromGatewayResult(result, normalized),
  };
}

function buildOpenClawExecPayload(command: string, cwd: string): Record<string, unknown> {
  return {
    command,
    cwd,
    workdir: cwd,
  };
}

function buildTerminalRequestHash(command: string, cwd: string): string {
  return `${cwd}:${command}`;
}

function buildTerminalOpenRequestHash(workspace: WorkspaceProfile, sessionKey: string, cwd: string): string {
  return `${workspace.id}:${sessionKey}:${cwd}:interactive-terminal`;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeDimension(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : undefined;
}

function requireSessionId(payload: unknown): string {
  const id = isRecord(payload) ? (payload as TerminalSessionPayload).sessionId : undefined;
  if (typeof id !== 'string' || !id.trim()) throw new Error('sessionId is required');
  return id.trim();
}

function requireWriteData(payload: unknown): string {
  const data = isRecord(payload) ? (payload as TerminalSessionPayload).data : undefined;
  if (typeof data !== 'string') throw new Error('data is required');
  return data;
}

function normalizeTerminalOpenPayload(payload: unknown): WorkspaceTerminalOpenPayload {
  return isRecord(payload) ? payload as WorkspaceTerminalOpenPayload : {};
}

function normalizeTerminalStatusPayload(payload: unknown): WorkspaceTerminalStatusPayload {
  return isRecord(payload) ? payload as WorkspaceTerminalStatusPayload : {};
}

function buildSessionResult(snapshot: ReturnType<TerminalSessionManager['status']>) {
  return {
    success: true,
    sessionId: snapshot.sessionId,
    workspaceId: snapshot.workspaceId,
    sessionKey: snapshot.sessionKey,
    expectedSessionId: snapshot.expectedSessionId ?? null,
    kind: snapshot.kind,
    cwd: snapshot.cwd,
    pid: snapshot.pid,
    cols: snapshot.cols,
    rows: snapshot.rows,
    status: snapshot.status,
    exitCode: snapshot.exitCode,
    scrollback: snapshot.scrollback,
  };
}

async function runViaOpenClawExec(input: {
  gatewayManager: GatewayManager;
  command: string;
  timeoutMs: number;
  deadline: number;
  cwd: string;
  risk: WorkspaceCommandRisk;
}): Promise<TerminalExecutionOutcome> {
  const startedAt = Date.now();
  let lastUnsupportedError: unknown = null;
  const payload = buildOpenClawExecPayload(input.command, input.cwd);

  for (const method of OPENCLAW_TERMINAL_RPC_METHODS) {
    const remaining = input.deadline - Date.now();
    if (remaining <= 0) throw new ResourceFabricTimeoutError({
      resource: 'workspaceExec', leaseKey: resolveWorkspaceLeaseKey(input.cwd), timeoutMs: input.timeoutMs,
    });
    try {
      const result = await input.gatewayManager.rpc(method, payload, remaining);
      return normalizeGatewayExecResult({
        result,
        command: input.command,
        cwd: input.cwd,
        risk: input.risk,
        startedAt,
      });
    } catch (error) {
      if (!isUnsupportedOpenClawExecRpc(error)) {
        const durationMs = Date.now() - startedAt;
        return {
          result: {
            success: false,
            blocked: false,
            cwd: input.cwd,
            command: input.command,
            exitCode: null,
            stdout: '',
            stderr: trimOutput(String(error)),
            durationMs,
            risk: input.risk,
          },
          traceEvidence: traceEvidenceFromGatewayError(error, durationMs),
        };
      }
      lastUnsupportedError = error;
    }
  }

  const durationMs = Date.now() - startedAt;
  return {
    result: {
      success: false,
      blocked: false,
      reason: '当前 OpenClaw 运行时未暴露直接终端执行 RPC；请通过对话中的 OpenClaw exec 工具执行，权限策略仍会通过 tools.exec.security/ask 生效。',
      cwd: input.cwd,
      command: input.command,
      exitCode: null,
      stdout: '',
      stderr: trimOutput(lastUnsupportedError ? String(lastUnsupportedError) : 'OpenClaw direct terminal RPC unavailable'),
      durationMs,
      risk: input.risk,
    },
    traceEvidence: { code: 'RUNTIME_ERROR', durationMs },
  };
}

/**
 * Normalizes a workspace path into a stable lease key.
 *
 * Windows path comparison is case-insensitive and treats `/` and `\` as the
 * same separator, so two spellings of the same workspace must map to one key.
 * Falls back to the resolved path when the target does not exist yet.
 */
function resolveWorkspaceLeaseKey(workspacePath: string): string {
  let resolved = resolve(workspacePath);
  try {
    resolved = realpathSync.native(resolved);
  } catch {
    // Target may not exist yet; the resolved path is still a stable key.
  }
  return process.platform === 'win32' ? resolved.replace(/\\/g, '/').toLowerCase() : resolved;
}

/**
 * Runs a Gateway exec RPC under the shared ResourceFabric workspace account so a
 * single workspace cannot exceed its adaptive concurrent exec limit.
 *
 * A lease timeout is reported as a stable, non-retryable terminal result with
 * `blocked: true` rather than surfacing as a raw rejection.
 */
async function runViaOpenClawExecWithLease(input: {
  gatewayManager: GatewayManager;
  command: string;
  timeoutMs: number;
  cwd: string;
  risk: WorkspaceCommandRisk;
}): Promise<TerminalExecutionOutcome> {
  const leaseKey = resolveWorkspaceLeaseKey(input.cwd);
  const deadline = Math.min(Date.now() + input.timeoutMs, getHostDeadline()?.deadlineAtMs ?? Infinity);
  try {
    return await withWorkspaceExecLease(leaseKey, input.timeoutMs, () =>
      runViaOpenClawExec({ ...input, deadline }),
      { deadline },
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'RESOURCE_QUEUE_FULL') {
      return {
        result: { success: false, blocked: true, reason: error.message, cwd: input.cwd,
          command: input.command, exitCode: null, stdout: '', stderr: '', durationMs: 0, risk: input.risk },
        traceEvidence: { code: 'RUNTIME_ERROR', durationMs: 0 },
      };
    }
    if (!isTerminalResourceLeaseTimeoutError(error)) {
      throw error;
    }
    return {
      result: {
        success: false,
        blocked: true,
        timedOut: true,
        reason: error.message,
        leaseKind: error.leaseKind,
        leaseKey: error.leaseKey,
        timeoutMs: error.timeoutMs,
        cwd: input.cwd,
        command: input.command,
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: error.timeoutMs,
        risk: input.risk,
      },
      traceEvidence: { timedOut: true, durationMs: error.timeoutMs },
    };
  }
}

export function createTerminalApi({
  gatewayManager,
  terminalManager = new TerminalSessionManager(),
  traceDiagnostics = createHostTraceDiagnosticsService(),
}: {
  gatewayManager: GatewayManager;
  terminalManager?: TerminalSessionManager;
  traceDiagnostics?: HostTraceDiagnosticsService;
}): CompleteHostServiceRegistry['terminal'] {
  return {
    run: async (payload) => {
      const body = isRecord(payload) ? payload as RunPayload : {};
      const command = requireCommand(payload);
      const timeoutMs = clampTimeout(body.timeoutMs);
      const approvalId = normalizeApprovalId(body.approvalId);
      const workspace = requireWorkspace(await getActiveWorkspaceProfile());
      let decision = decideWorkspaceCommand(command, workspace.permissionMode);
      let sandboxDenial: SandboxDenialDetails | undefined;
      const sandboxClass = classifyTerminalRiskForSandboxGate(decision.risk);
      if (sandboxClass) {
        const sandboxPolicy = await loadSandboxHighRiskPolicy();
        const sandboxDecision = decideSandboxHighRiskAction(sandboxPolicy, sandboxClass, { allowApproval: true });
        if (!sandboxDecision.allowed && !sandboxDecision.requiresApproval) {
          sandboxDenial = createSandboxDenialDetails({
            mechanism: 'sandbox-gate',
            operation: sandboxClass,
            requestedProviderId: sandboxPolicy.requestedProviderId,
            effectiveProviderId: sandboxPolicy.effectiveProviderId,
            runtimeLevel: sandboxPolicy.runtimeLevel,
          });
        }
        decision = composeWithSandboxHighRiskGate(decision, sandboxDecision);
        if (sandboxDecision.forceVisible || !sandboxDecision.allowed) {
          void recordPermissionDecisionEvent(createWorkspacePermissionDecisionEvent({
            workspaceMode: workspace.permissionMode,
            tool: 'terminal.run',
            boundary: 'sandbox-runtime',
            requestId: approvalId ?? buildTerminalRequestHash(command, workspace.rootPath),
            decision,
          }));
        }
      }
      void recordPermissionDecisionEvent(createWorkspacePermissionDecisionEvent({
        workspaceMode: workspace.permissionMode,
        tool: 'terminal.run',
        boundary: 'workspace-command',
        requestId: approvalId ?? buildTerminalRequestHash(command, workspace.rootPath),
        decision,
      }));

      if (!decision.allowed) {
        if (decision.requiresApproval && isApprovalRisk(decision.risk)) {
          if (approvalId) {
            const approved = await consumeApprovedPermissionApproval({
              id: approvalId,
              workspaceId: workspace.id,
              source: 'terminal',
              command,
              requestHash: buildTerminalRequestHash(command, workspace.rootPath),
            });
            if (approved) {
              const outcome = await runViaOpenClawExecWithLease({
                gatewayManager,
                command,
                timeoutMs,
                cwd: workspace.rootPath,
                risk: decision.risk,
              });
              if (!outcome.result.success) {
                traceDiagnostics.record({
                  approval: approved,
                  evidence: outcome.traceEvidence,
                });
              }
              return outcome.result;
            }
          }
          const approval = await createPermissionApproval({
            workspace,
            source: 'terminal',
            risk: decision.risk,
            command,
            cwd: workspace.rootPath,
            requestHash: buildTerminalRequestHash(command, workspace.rootPath),
            reason: decision.reason,
          });
          return {
            success: false,
            blocked: true,
            approvalRequired: true,
            approval,
            ...(sandboxDenial ? { sandboxDenial } : {}),
            reason: decision.reason ?? '命令需要审批',
            cwd: workspace.rootPath,
            command,
            exitCode: null,
            stdout: '',
            stderr: '',
            durationMs: 0,
            risk: decision.risk,
          };
        }
        return {
          success: false,
          blocked: true,
          ...(sandboxDenial ? { sandboxDenial } : {}),
          reason: decision.reason ?? '命令已被当前权限模式阻止',
          cwd: workspace.rootPath,
          command,
          exitCode: null,
          stdout: '',
          stderr: '',
          durationMs: 0,
          risk: decision.risk,
        };
      }

      if (!existsSync(workspace.rootPath)) {
        throw new Error('Workspace path does not exist');
      }
      if (workspace.permissionMode === 'fullAccess' && isApprovalRisk(decision.risk)) {
        void recordPermissionAudit({
          workspace,
          source: 'terminal',
          risk: decision.risk,
          command,
          cwd: workspace.rootPath,
          requestHash: buildTerminalRequestHash(command, workspace.rootPath),
          reason: '完全访问模式下执行高风险命令',
        });
      }

      const outcome = await runViaOpenClawExecWithLease({
        gatewayManager,
        command,
        timeoutMs,
        cwd: workspace.rootPath,
        risk: decision.risk,
      });
      return outcome.result;
    },
    open: async (payload) => {
      const body = normalizeTerminalOpenPayload(payload);
      const workspace = requireWorkspace(await getActiveWorkspaceProfile());
      if (body.workspaceId && body.workspaceId !== workspace.id) {
        throw new Error('Terminal workspace must match the active workspace');
      }
      const sessionKey = normalizeString(body.sessionKey) ?? workspace.activeSessionKey;
      let expectedSessionId = normalizeString(body.expectedSessionId);
      try {
        const described = await gatewayManager.rpc<{ session?: { sessionId?: string } | null }>(
          'sessions.describe',
          { key: sessionKey },
          10_000,
        );
        const currentSessionId = described?.session?.sessionId?.trim();
        if (expectedSessionId && currentSessionId && expectedSessionId !== currentSessionId) {
          return {
            success: false,
            blocked: true,
            reason: 'Terminal session generation changed before open',
            workspaceId: workspace.id,
            sessionKey,
            expectedSessionId: currentSessionId,
            cwd: normalizeString(body.cwd) ?? workspace.rootPath,
            status: 'blocked',
            exitCode: null,
          };
        }
        expectedSessionId = currentSessionId ?? expectedSessionId;
      } catch {
        // Gateway availability must not erase a caller-pinned generation.
      }
      const cwd = normalizeString(body.cwd) ?? workspace.rootPath;
      if (!isPathInsideWorkspace(cwd, workspace.rootPath)) {
        throw new Error('Terminal cwd must be inside the active workspace');
      }
      if (workspace.permissionMode === 'plan') {
        return {
          success: false,
          blocked: true,
          reason: '计划模式下不会启动交互式终端，请先完成方案确认',
          workspaceId: workspace.id,
          sessionKey,
          cwd,
          status: 'blocked',
          exitCode: null,
        };
      }
      if (workspace.permissionMode === 'readOnly') {
        return {
          success: false,
          blocked: true,
          reason: '只读模式不允许启动交互式终端',
          workspaceId: workspace.id,
          sessionKey,
          cwd,
          status: 'blocked',
          exitCode: null,
        };
      }

      const requestHash = buildTerminalOpenRequestHash(workspace, sessionKey, cwd);
      if (workspace.permissionMode === 'acceptEdits') {
        const approvalId = normalizeApprovalId(body.approvalId);
        if (approvalId) {
          const approved = await consumeApprovedPermissionApproval({
            id: approvalId,
            workspaceId: workspace.id,
            source: 'terminal',
            command: 'open interactive terminal',
            requestHash,
          });
          if (!approved) {
            return {
              success: false,
              blocked: true,
              reason: '终端审批无效或已过期',
              workspaceId: workspace.id,
              sessionKey,
              cwd,
              status: 'blocked',
              exitCode: null,
            };
          }
        } else {
          const approval = await createPermissionApproval({
            workspace,
            source: 'terminal',
            risk: 'dangerous',
            command: 'open interactive terminal',
            cwd,
            requestHash,
            reason: '接受修改模式需要先批准交互式终端会话',
          });
          return {
            success: false,
            blocked: true,
            approvalRequired: true,
            approval,
            reason: '接受修改模式需要先批准交互式终端会话',
            workspaceId: workspace.id,
            sessionKey,
            cwd,
            status: 'blocked',
            exitCode: null,
          };
        }
      }

      if (workspace.permissionMode === 'fullAccess') {
        void recordPermissionAudit({
          workspace,
          source: 'terminal',
          risk: 'dangerous',
          command: 'open interactive terminal',
          cwd,
          requestHash,
          reason: '完全访问模式下启动交互式终端',
        });
      }

      const openResult = tryWithSessionDeleteGateLock(sessionKey, async () => {
        if (await findSessionDeleteGateBySession(sessionKey)) {
          return {
            success: false,
            blocked: true,
            reason: 'Session lifecycle mutation is in progress; terminal admission is fenced',
            workspaceId: workspace.id,
            sessionKey,
            cwd,
            status: 'blocked' as const,
            exitCode: null,
          };
        }
        const snapshot = terminalManager.open({
          workspace,
          sessionKey,
          expectedSessionId,
          cwd,
          cols: normalizeDimension(body.cols),
          rows: normalizeDimension(body.rows),
          kind: body.kind,
          command: body.command,
          keepOnLeave: body.keepOnLeave,
        });
        return buildSessionResult(snapshot);
      });
      if (!openResult) {
        return {
          success: false,
          blocked: true,
          reason: 'Session lifecycle mutation is in progress; terminal admission is fenced',
          workspaceId: workspace.id,
          sessionKey,
          cwd,
          status: 'blocked' as const,
          exitCode: null,
        };
      }
      return openResult;
    },
    write: async (payload) => {
      terminalManager.write({
        sessionId: requireSessionId(payload),
        data: requireWriteData(payload),
      });
      return { success: true };
    },
    resize: async (payload) => {
      const body = isRecord(payload) ? payload as TerminalSessionPayload : {};
      const snapshot = terminalManager.resize({
        sessionId: requireSessionId(payload),
        cols: normalizeDimension(body.cols) ?? 80,
        rows: normalizeDimension(body.rows) ?? 24,
      });
      return buildSessionResult(snapshot);
    },
    interrupt: async (payload) => {
      terminalManager.interrupt(requireSessionId(payload));
      return { success: true };
    },
    close: async (payload) => {
      const snapshot = terminalManager.close(requireSessionId(payload));
      return buildSessionResult(snapshot);
    },
    status: async (payload) => {
      const body = normalizeTerminalStatusPayload(payload);
      const workspace = await getActiveWorkspaceProfile();
      const snapshot = terminalManager.status({
        workspaceId: normalizeString(body.workspaceId) ?? workspace?.id,
        sessionKey: normalizeString(body.sessionKey) ?? workspace?.activeSessionKey,
        sessionId: normalizeString(body.sessionId),
      });
      return buildSessionResult(snapshot);
    },
    list: async (payload) => {
      const body = isRecord(payload) ? payload as WorkspaceTerminalListPayload : {};
      // Global listing reuses terminal.list({}). Do not inject the active
      // workspace when the renderer omitted workspaceId.
      const sessions = terminalManager.list({
        workspaceId: body.workspaceId,
        sessionKey: body.sessionKey,
      });
      return {
        success: true,
        sessions: sessions.map((snapshot) => {
          const { success: _success, ...session } = buildSessionResult(snapshot);
          return session;
        }),
      };
    },
  };
}
