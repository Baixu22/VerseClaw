import type { GatewayManager } from '../gateway/manager';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type {
  RuntimeApprovalListResult,
  RuntimeApprovalPendingEntry,
  RuntimeApprovalResolvePayload,
  RuntimeApprovalResolveResult,
} from '@shared/host-api/contract';

/**
 * TF-0240: the ClawX side of the runtime exec-approval boundary.
 *
 * The runtime owns the approval record, the decision vocabulary, and expiry; this
 * service only lists what is pending and forwards exactly one decision the runtime
 * already offered. It never invents a decision, never widens the vocabulary, and
 * never answers on the user's behalf — a request with no approval id or an
 * unknown decision fails closed.
 */
const RUNTIME_APPROVAL_DECISIONS = new Set(['allow-once', 'allow-always', 'deny']);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Project one runtime `exec.approval.list` entry; entries without an id are dropped. */
export function toPendingApprovalEntry(raw: unknown): RuntimeApprovalPendingEntry | null {
  const entry = asRecord(raw);
  const approvalId = readString(entry.id);
  if (!approvalId) return null;
  const request = asRecord(entry.request);
  return {
    approvalId,
    command: readString(request.command) || readString(request.commandPreview),
    commandPreview: readOptionalString(request.commandPreview),
    cwd: readOptionalString(request.cwd),
    host: readOptionalString(request.host),
    agentId: readOptionalString(request.agentId),
    sessionKey: readOptionalString(request.sessionKey),
    allowedDecisions: Array.isArray(request.allowedDecisions)
      ? request.allowedDecisions.filter((value): value is string => typeof value === 'string')
      : [],
    createdAtMs: readNumber(entry.createdAtMs),
    expiresAtMs: readNumber(entry.expiresAtMs),
  };
}

export function createRuntimeApprovalsApi(
  gatewayManager: GatewayManager,
): CompleteHostServiceRegistry['runtimeApprovals'] {
  return {
    list: async (): Promise<RuntimeApprovalListResult> => {
      const raw = await gatewayManager.rpc<unknown>('exec.approval.list', {});
      const entries = Array.isArray(raw) ? raw : [];
      const pending = entries
        .map(toPendingApprovalEntry)
        .filter((entry): entry is RuntimeApprovalPendingEntry => entry !== null);
      return { pending };
    },
    resolve: async (payload: RuntimeApprovalResolvePayload): Promise<RuntimeApprovalResolveResult> => {
      const approvalId = readString(payload?.approvalId).trim();
      const decision = readString(payload?.decision).trim();
      if (!approvalId) {
        return { success: false, error: 'approvalId is required' };
      }
      if (!RUNTIME_APPROVAL_DECISIONS.has(decision)) {
        return { success: false, error: `Unsupported approval decision: ${decision || '(empty)'}` };
      }
      await gatewayManager.rpc('exec.approval.resolve', { id: approvalId, decision });
      return { success: true, approvalId, decision };
    },
  };
}
