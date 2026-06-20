import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import type {
  ClawGraphCompileHostResult,
  ClawGraphCompilePayload,
  ClawGraphRunPayload,
} from '@shared/host-api/contract';
import type { PermissionApprovalEvent } from '@shared/types/workspace';
import type {
  ClawGraphCompileResult,
  ClawGraphRunEvent,
  ClawGraphRunSnapshot,
  ClawGraphWorkflowFile,
} from '@shared/types/clawgraph';
import type { WorkspaceProfile } from '@shared/types/workspace';
import { isRecord } from './payload-utils';
import { getActiveWorkspaceProfile } from './workspaces-api';
import { decideGatewayRpc, isApprovalRisk, isPathInsideWorkspace, requireWorkspace } from './workspace-permissions';
import {
  consumeApprovedPermissionApproval,
  createPermissionApproval,
  recordPermissionAudit,
} from './permissions-api';

type ClawGraphApiContext = {
  gatewayManager?: GatewayManager;
};

type GatewayCompileResponse = {
  ok?: boolean;
  ir?: unknown;
  diagnostics?: unknown[];
};

type GatewayRunResponse = {
  compile?: ClawGraphCompileResult;
  snapshot?: ClawGraphRunSnapshot | null;
};

type GatewayStatusResponse = {
  snapshot?: ClawGraphRunSnapshot | null;
};

type GatewayEventsResponse = {
  events?: ClawGraphRunEvent[];
};

function gatewayUnavailableCompile(error = 'Gateway unavailable'): ClawGraphCompileResult {
  return {
    ok: false,
    diagnostics: [{ severity: 'error', code: 'gateway_unavailable', message: error }],
  };
}

function getWorkflowDir(workspace: WorkspaceProfile): string {
  return resolve(workspace.rootPath, '.clawx', 'clawgraph');
}

function normalizeWorkflowPath(workspace: WorkspaceProfile, sourcePath: string): string {
  const candidate = isAbsolute(sourcePath)
    ? resolve(sourcePath)
    : resolve(workspace.rootPath, sourcePath);
  const workflowDir = getWorkflowDir(workspace);
  if (!isPathInsideWorkspace(candidate, workspace.rootPath) || !isPathInsideWorkspace(candidate, workflowDir)) {
    throw new Error(`Workflow path must be inside ${relative(workspace.rootPath, workflowDir).split(sep).join('/')}`);
  }
  const extension = extname(candidate).toLowerCase();
  if (extension !== '.yaml' && extension !== '.yml') {
    throw new Error('Workflow source must be a YAML file');
  }
  return candidate;
}

function workflowFileFromPath(workspace: WorkspaceProfile, path: string, info?: { size?: number; mtimeMs?: number }): ClawGraphWorkflowFile {
  return {
    name: basename(path),
    path,
    relativePath: relative(workspace.rootPath, path).split(sep).join('/'),
    ...(typeof info?.size === 'number' ? { size: info.size } : {}),
    ...(typeof info?.mtimeMs === 'number' ? { mtime: info.mtimeMs } : {}),
  };
}

async function resolveWorkflowSource(
  workspace: WorkspaceProfile,
  payload: ClawGraphCompilePayload,
): Promise<{ workflowYaml: string; sourcePath?: string; workflow?: ClawGraphWorkflowFile }> {
  if (typeof payload.workflowYaml === 'string' && payload.workflowYaml.trim()) {
    return {
      workflowYaml: payload.workflowYaml,
      ...(payload.sourcePath ? { sourcePath: normalizeWorkflowPath(workspace, payload.sourcePath) } : {}),
    };
  }
  if (typeof payload.sourcePath !== 'string' || !payload.sourcePath.trim()) {
    throw new Error('workflowYaml or sourcePath is required');
  }
  const sourcePath = normalizeWorkflowPath(workspace, payload.sourcePath);
  const [workflowYaml, info] = await Promise.all([
    readFile(sourcePath, 'utf8'),
    stat(sourcePath),
  ]);
  return {
    workflowYaml,
    sourcePath,
    workflow: workflowFileFromPath(workspace, sourcePath, info),
  };
}

async function listWorkflowFiles(workspace: WorkspaceProfile): Promise<ClawGraphWorkflowFile[]> {
  const dir = getWorkflowDir(workspace);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: ClawGraphWorkflowFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = extname(entry.name).toLowerCase();
    if (extension !== '.yaml' && extension !== '.yml') continue;
    const path = join(dir, entry.name);
    const info = await stat(path).catch(() => null);
    files.push(workflowFileFromPath(workspace, path, info ?? undefined));
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

function requireActiveWorkspace(payloadWorkspaceId?: string | null): Promise<WorkspaceProfile> {
  return getActiveWorkspaceProfile().then((workspace) => {
    const active = requireWorkspace(workspace);
    if (payloadWorkspaceId && payloadWorkspaceId !== active.id) {
      throw new Error(`Workspace "${payloadWorkspaceId}" is not active`);
    }
    return active;
  });
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

function buildGatewayRequestHash(method: string, params: unknown): string {
  return `${method}:${stableJson(params ?? null)}`;
}

function buildParamsPreview(params: unknown): string | undefined {
  const value = stableJson(params);
  return value.length > 1200 ? `${value.slice(0, 1200)}...` : value;
}

async function rpcWithWorkspacePermission<T>(
  gatewayManager: GatewayManager,
  method: string,
  params: unknown,
  timeoutMs: number,
  workspace: WorkspaceProfile,
  approvalId?: string,
): Promise<T | { success: false; blocked: true; approvalRequired?: boolean; approval?: PermissionApprovalEvent; error?: string }> {
  const decision = decideGatewayRpc(method, workspace.permissionMode, params);
  if (!decision.allowed) {
    if (decision.requiresApproval && isApprovalRisk(decision.risk)) {
      const requestHash = buildGatewayRequestHash(method, params);
      if (approvalId) {
        const approved = await consumeApprovedPermissionApproval({
          id: approvalId,
          workspaceId: workspace.id,
          source: 'gateway',
          command: method,
          requestHash,
        });
        if (approved) {
          return await gatewayManager.rpc<T>(method, params, timeoutMs);
        }
      }
      const approval = await createPermissionApproval({
        workspace,
        source: 'gateway',
        risk: decision.risk,
        command: method,
        requestHash,
        paramsPreview: buildParamsPreview(params),
        reason: decision.reason,
      });
      return {
        success: false,
        blocked: true,
        approvalRequired: true,
        approval,
        error: decision.reason ?? 'Gateway request requires approval',
      };
    }
    return {
      success: false,
      blocked: true,
      error: decision.reason ?? 'Gateway request blocked by workspace permission mode',
    };
  }

  if (workspace.permissionMode === 'fullAccess' && isApprovalRisk(decision.risk)) {
    void recordPermissionAudit({
      workspace,
      source: 'gateway',
      risk: decision.risk,
      command: method,
      requestHash: buildGatewayRequestHash(method, params),
      paramsPreview: buildParamsPreview(params),
      reason: 'High-risk Gateway request executed in full access mode',
    });
  }

  return await gatewayManager.rpc<T>(method, params, timeoutMs);
}

function isBlockedResult(value: unknown): value is { success: false; blocked: true; approvalRequired?: boolean; approval?: PermissionApprovalEvent; error?: string } {
  return isRecord(value) && value.success === false && value.blocked === true;
}

export function createClawGraphApi(ctx: ClawGraphApiContext = {}): CompleteHostServiceRegistry['clawGraph'] {
  return {
    listWorkflows: async (payload) => {
      const workspace = await requireActiveWorkspace(payload?.workspaceId);
      return {
        success: true,
        available: ctx.gatewayManager?.isConnected() === true,
        workflows: await listWorkflowFiles(workspace),
        workspaceId: workspace.id,
        workspaceRoot: workspace.rootPath,
      };
    },

    compile: async (payload): Promise<ClawGraphCompileHostResult> => {
      const workspace = await requireActiveWorkspace(payload.workspaceId);
      const source = await resolveWorkflowSource(workspace, payload);
      if (!ctx.gatewayManager?.isConnected()) {
        return {
          success: false,
          available: false,
          compile: gatewayUnavailableCompile(),
          workflow: source.workflow,
          error: 'Gateway unavailable',
        };
      }
      const compile = await ctx.gatewayManager.rpc<GatewayCompileResponse>('clawgraph.compile', {
        workflowYaml: source.workflowYaml,
        sourcePath: source.sourcePath,
        workspaceId: workspace.id,
        workspaceRoot: workspace.rootPath,
      }, 15_000);
      return {
        success: true,
        available: true,
        compile: compile as ClawGraphCompileResult,
        workflow: source.workflow,
      };
    },

    run: async (payload: ClawGraphRunPayload) => {
      const workspace = await requireActiveWorkspace(payload.workspaceId);
      const source = await resolveWorkflowSource(workspace, payload);
      if (!ctx.gatewayManager?.isConnected()) {
        return {
          success: false,
          available: false,
          compile: gatewayUnavailableCompile(),
          snapshot: null,
          error: 'Gateway unavailable',
        };
      }
      const params = {
        workflowYaml: source.workflowYaml,
        sourcePath: source.sourcePath,
        workspaceId: workspace.id,
        workspaceRoot: workspace.rootPath,
        sessionKey: payload.sessionKey,
        ...(payload.agentId ? { agentId: payload.agentId } : {}),
      };
      const result = await rpcWithWorkspacePermission<GatewayRunResponse>(
        ctx.gatewayManager,
        'clawgraph.run',
        params,
        30_000,
        workspace,
        payload.approvalId,
      );
      if (isBlockedResult(result)) {
        return { available: true, compile: undefined, snapshot: null, ...result };
      }
      return {
        success: true,
        available: true,
        compile: result.compile,
        snapshot: result.snapshot ?? null,
      };
    },

    status: async (payload) => {
      if (!ctx.gatewayManager?.isConnected()) {
        return { success: false, available: false, snapshot: null, error: 'Gateway unavailable' };
      }
      const result = await ctx.gatewayManager.rpc<GatewayStatusResponse>('clawgraph.status', {
        runId: payload.runId,
      }, 10_000);
      return { success: true, available: true, snapshot: result.snapshot ?? null };
    },

    events: async (payload) => {
      if (!ctx.gatewayManager?.isConnected()) {
        return { success: false, available: false, events: [], error: 'Gateway unavailable' };
      }
      const result = await ctx.gatewayManager.rpc<GatewayEventsResponse>('clawgraph.events', {
        runId: payload.runId,
        limit: payload.limit,
      }, 10_000);
      return { success: true, available: true, events: Array.isArray(result.events) ? result.events : [] };
    },

    abort: async (payload) => {
      const workspace = await requireActiveWorkspace(null);
      if (!ctx.gatewayManager?.isConnected()) {
        return { success: false, available: false, snapshot: null, error: 'Gateway unavailable' };
      }
      const params = { runId: payload.runId, reason: payload.reason };
      const result = await rpcWithWorkspacePermission<GatewayStatusResponse>(
        ctx.gatewayManager,
        'clawgraph.abort',
        params,
        10_000,
        workspace,
        payload.approvalId,
      );
      if (isBlockedResult(result)) {
        return { available: true, snapshot: null, ...result };
      }
      return { success: true, available: true, snapshot: result.snapshot ?? null };
    },

    review: async (payload) => {
      const workspace = await requireActiveWorkspace(null);
      if (!ctx.gatewayManager?.isConnected()) {
        return { success: false, available: false, snapshot: null, error: 'Gateway unavailable' };
      }
      const params = {
        runId: payload.runId,
        reviewId: payload.reviewId,
        decision: payload.decision,
        reason: payload.reason,
      };
      const result = await rpcWithWorkspacePermission<GatewayStatusResponse>(
        ctx.gatewayManager,
        'clawgraph.review',
        params,
        10_000,
        workspace,
        payload.approvalId,
      );
      if (isBlockedResult(result)) {
        return { available: true, snapshot: null, ...result };
      }
      return { success: true, available: true, snapshot: result.snapshot ?? null };
    },
  };
}
