import type {
  WorkspaceWebPreviewStartPayload,
  WorkspaceWebPreviewStatusPayload,
  WorkspaceWebPreviewStopPayload,
} from '@shared/host-api/contract';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { isRecord } from './payload-utils';
import {
  consumeApprovedPermissionApproval,
  createPermissionApproval,
  recordPermissionAudit,
} from './permissions-api';
import { WebPreviewManager } from './web-preview-manager';
import { getActiveWorkspaceProfile } from './workspaces-api';
import { decideWorkspaceCommand, isApprovalRisk, requireWorkspace } from './workspace-permissions';
import type { GatewayManager } from '../gateway/manager';
import { tryWithSessionDeleteGateLock, findSessionDeleteGateBySession } from './session-delete-gate';

type WebPreviewApiContext = {
  webPreviewManager?: WebPreviewManager;
  gatewayManager?: GatewayManager;
};

function normalizeStartPayload(payload: unknown): WorkspaceWebPreviewStartPayload {
  return isRecord(payload) ? payload as WorkspaceWebPreviewStartPayload : {};
}

function normalizeStatusPayload(payload: unknown): WorkspaceWebPreviewStatusPayload {
  return isRecord(payload) ? payload as WorkspaceWebPreviewStatusPayload : {};
}

function normalizeStopPayload(payload: unknown): WorkspaceWebPreviewStopPayload {
  return isRecord(payload) ? payload as WorkspaceWebPreviewStopPayload : {};
}

function requestHashFor(command: string, cwd: string): string {
  return `${cwd}:${command}:web-preview-dev-server`;
}

function normalizeApprovalId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function createWebPreviewApi(ctx: WebPreviewApiContext = {}): CompleteHostServiceRegistry['webPreview'] {
  const manager = ctx.webPreviewManager ?? new WebPreviewManager();

  const start = async (payload?: unknown) => {
    const body = normalizeStartPayload(payload);
    const workspace = requireWorkspace(await getActiveWorkspaceProfile());
    const mode = body.mode ?? body.launchConfig?.mode ?? 'static';

    if (mode === 'devServer') {
      const startOwnedPreview = async (launchConfig: WorkspaceWebPreviewStartPayload['launchConfig']) => {
        const described = await ctx.gatewayManager?.rpc<{ session?: { sessionId?: string } }>('sessions.describe', { key: workspace.activeSessionKey }, 10_000);
        const generation = described?.session?.sessionId;
        if (!generation) return { success: false, blocked: true, status: 'error' as const, error: 'Preview session generation is unavailable' };
        const admitted = tryWithSessionDeleteGateLock(workspace.activeSessionKey, async () => {
          if (await findSessionDeleteGateBySession(workspace.activeSessionKey)) {
            return { success: false, blocked: true, status: 'error' as const, error: 'Preview session lifecycle is fenced' };
          }
          return manager.start({ ...body, workspace, mode, launchConfig, expectedSessionId: generation });
        });
        return admitted ?? { success: false, blocked: true, status: 'error' as const, error: 'Preview session lifecycle is fenced' };
      };
      const detected = body.launchConfig ?? (await manager.detect(workspace, body.targetPath)).preferred;
      const command = detected?.command;
      if (!command) {
        return { success: false, status: 'error' as const, error: 'No dev server launch config found' };
      }
      const cwd = detected.cwd ?? workspace.rootPath;
      const decision = decideWorkspaceCommand(command, workspace.permissionMode);
      if (!decision.allowed) {
        if (decision.requiresApproval && isApprovalRisk(decision.risk)) {
          const approvalId = normalizeApprovalId(body.approvalId);
          const requestHash = requestHashFor(command, cwd);
          if (approvalId) {
            const approved = await consumeApprovedPermissionApproval({
              id: approvalId,
              workspaceId: workspace.id,
              source: 'terminal',
              command,
              requestHash,
            });
            if (approved) {
              return await startOwnedPreview(detected);
            }
          }
          const approval = await createPermissionApproval({
            workspace,
            source: 'terminal',
            risk: decision.risk,
            command,
            cwd,
            requestHash,
            reason: decision.reason,
          });
          return {
            success: false,
            blocked: true,
            approvalRequired: true,
            approval,
            status: 'error' as const,
            error: decision.reason ?? '启动开发服务器需要审批',
          };
        }
        return {
          success: false,
          blocked: true,
          status: 'error' as const,
          error: decision.reason ?? '当前权限模式不允许启动开发服务器',
        };
      }
      if (workspace.permissionMode === 'fullAccess' && isApprovalRisk(decision.risk)) {
        void recordPermissionAudit({
          workspace,
          source: 'terminal',
          risk: decision.risk,
          command,
          cwd,
          requestHash: requestHashFor(command, cwd),
          reason: '完全访问模式下启动 Web 预览开发服务器',
        });
      }
      return await startOwnedPreview(detected);
    }

    return await manager.start({ ...body, workspace, mode });
  };

  return {
    detect: async (payload) => {
      const body = normalizeStartPayload(payload);
      const workspace = requireWorkspace(await getActiveWorkspaceProfile());
      const result = await manager.detect(workspace, body.targetPath);
      return { success: true, ...result };
    },
    start,
    startStatic: async (payload) => {
      const body = normalizeStartPayload(payload);
      return await start({ ...body, mode: 'static' });
    },
    stop: async (payload) => {
      const body = normalizeStopPayload(payload);
      const workspace = requireWorkspace(await getActiveWorkspaceProfile());
      await manager.stopForWorkspace(body.workspaceId ?? workspace.id, 'user-close');
      return { success: true };
    },
    status: async (payload) => {
      const body = normalizeStatusPayload(payload);
      const workspace = await getActiveWorkspaceProfile();
      const workspaceId = body.workspaceId ?? workspace?.id;
      if (!workspaceId) return { success: true, running: false, status: 'idle', url: null, previewUrl: null };
      return manager.status(workspaceId);
    },
  };
}
