import type { GatewayManager } from '../gateway/manager';
import type { GatewayRpcBackpressure } from '../gateway/rpc-backpressure';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { PORTS } from '../utils/config';
import { scheduleControlUiDeviceAutoApproval } from '../utils/control-ui-device-pairing';
import { buildOpenClawControlUiUrl } from '../utils/openclaw-control-ui';
import { getSetting } from '../utils/store';
import { handleMockChatSend, handleMockSessionSend } from './mock-provider';
import { isRecord } from './payload-utils';
import {
  consumeApprovedPermissionApproval,
  createPermissionApproval,
  recordPermissionAudit,
} from './permissions-api';
import { getActiveWorkspaceProfile } from './workspaces-api';
import { decideGatewayRpc, isApprovalRisk } from './workspace-permissions';

type HealthPayload = {
  probe?: unknown;
};

type ControlUiPayload = {
  view?: unknown;
};

type RpcPayload = {
  method?: unknown;
  params?: unknown;
  timeoutMs?: unknown;
  approvalId?: unknown;
};

function parseTimeoutMs(timeoutMs: unknown): number | undefined {
  if (timeoutMs === undefined) return undefined;
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Invalid gateway RPC timeout');
  }
  return timeoutMs;
}

function normalizeApprovalId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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
  if (params === undefined) return undefined;
  const value = stableJson(params);
  return value.length > 1200 ? `${value.slice(0, 1200)}...` : value;
}

function runGatewayRpc(
  gatewayManager: GatewayManager,
  gatewayRpcBackpressure: GatewayRpcBackpressure,
  method: string,
  params: unknown,
  timeoutMs: number | undefined,
): Promise<unknown> {
  return gatewayRpcBackpressure.run(
    method,
    params,
    timeoutMs,
    (rpcMethod, rpcParams, rpcTimeoutMs) => gatewayManager.rpc(rpcMethod, rpcParams, rpcTimeoutMs),
  );
}

export function createGatewayApi(
  gatewayManager: GatewayManager,
  gatewayRpcBackpressure: GatewayRpcBackpressure,
): CompleteHostServiceRegistry['gateway'] {
  return {
    status: () => gatewayManager.getStatus(),
    start: async () => {
      await gatewayManager.start();
      return { success: true };
    },
    stop: async () => {
      await gatewayManager.stop();
      return { success: true };
    },
    restart: async () => {
      await gatewayManager.restart();
      return { success: true };
    },
    health: async (payload) => {
      const body = isRecord(payload) ? payload as HealthPayload : {};
      return gatewayManager.checkHealth({ probe: body.probe === true });
    },
    controlUi: async (payload) => {
      const body = isRecord(payload) ? payload as ControlUiPayload : {};
      const status = gatewayManager.getStatus();
      const token = await getSetting('gatewayToken');
      const port = status.port || PORTS.OPENCLAW_GATEWAY;
      const view = body.view === 'dreams' ? 'dreams' : undefined;
      const url = buildOpenClawControlUiUrl(port, token, { view });
      scheduleControlUiDeviceAutoApproval(gatewayManager);
      return { success: true, url, token, port };
    },
    rpc: async (payload) => {
      const body = isRecord(payload) ? payload as RpcPayload : {};
      const method = typeof body.method === 'string' ? body.method.trim() : '';
      if (!method) {
        throw new Error('Invalid gateway RPC method');
      }
      const timeoutMs = parseTimeoutMs(body.timeoutMs);
      const approvalId = normalizeApprovalId(body.approvalId);
      const workspace = await getActiveWorkspaceProfile();

      if (workspace) {
        const decision = decideGatewayRpc(method, workspace.permissionMode, body.params);
        if (!decision.allowed) {
          if (decision.requiresApproval && isApprovalRisk(decision.risk)) {
            const requestHash = buildGatewayRequestHash(method, body.params);
            if (approvalId) {
              const approved = await consumeApprovedPermissionApproval({
                id: approvalId,
                workspaceId: workspace.id,
                source: 'gateway',
                command: method,
                requestHash,
              });
              if (approved) {
                return runGatewayRpc(gatewayManager, gatewayRpcBackpressure, method, body.params, timeoutMs);
              }
            }

            const approval = await createPermissionApproval({
              workspace,
              source: 'gateway',
              risk: decision.risk,
              command: method,
              requestHash,
              paramsPreview: buildParamsPreview(body.params),
              reason: decision.reason,
            });
            return {
              success: false,
              blocked: true,
              approvalRequired: true,
              approval,
              error: decision.reason ?? 'Gateway 请求需要审批',
            };
          }
          return {
            success: false,
            blocked: true,
            error: decision.reason ?? 'Gateway 请求已被当前权限模式阻止',
          };
        }

        if (workspace.permissionMode === 'fullAccess' && isApprovalRisk(decision.risk)) {
          void recordPermissionAudit({
            workspace,
            source: 'gateway',
            risk: decision.risk,
            command: method,
            requestHash: buildGatewayRequestHash(method, body.params),
            paramsPreview: buildParamsPreview(body.params),
            reason: '完全访问模式下执行高风险 Gateway 请求',
          });
        }
      }

      if (method === 'chat.send') {
        const mockResult = handleMockChatSend(body.params);
        if (mockResult) return mockResult;
      }
      if (method === 'sessions.send') {
        const mockResult = handleMockSessionSend(body.params);
        if (mockResult) return mockResult;
      }

      return runGatewayRpc(gatewayManager, gatewayRpcBackpressure, method, body.params, timeoutMs);
    },
  };
}
