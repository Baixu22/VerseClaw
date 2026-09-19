/**
 * Area 4 §3.3: Typed memory facade.
 *
 * Forwards renderer calls to the existing gateway `memory.*` RPCs through the
 * same `gatewayManager.rpc(...)` path used by `RolesOrchestrationPanel.tsx`
 * today. Reads stay SAFE-listed (workspace-permissions.ts), writes stay
 * approval-gated — this facade adds no new permission surface, only type
 * safety and a single entry point per the Renderer/Main boundary rule.
 */
import type { GatewayManager } from '../gateway/manager';
import { logger } from '../utils/logger';
import { isRecord } from './payload-utils';
import type {
  MemoryExplainInjectionPayload,
  MemoryExplainInjectionResult,
  MemoryInjectionReceiptsPayload,
  MemoryInjectionReceiptsResult,
  MemoryProposeFactsListPayload,
  MemoryProposeFactsListResult,
  MemoryProposeFactsConfirmPayload,
  MemoryProposeFactsConfirmResult,
  MemoryDetailPayload,
  MemoryDetailResult,
  MemoryHealthReportResult,
  MemoryListPayload,
  MemoryListResult,
  MemoryProposeResult,
  MemoryProposalPreviewResult,
  MemorySearchPayload,
  MemoryUpdatePayload,
  MemoryUpdateResult,
  MemoryProposal,
} from '@shared/host-api/contract';

export type MemoryApiContext = {
  gatewayManager: GatewayManager | null;
};

const RPC_TIMEOUT_MS = 15_000;

function unwrapResult<T>(raw: unknown): T {
  // Gateway RPCs return either `{ success, cards/decision/... }` or the bare
  // object. Normalize to HostSuccess & T.
  if (isRecord(raw)) {
    if (typeof raw.success === 'boolean') {
      return raw as T;
    }
    // Bare success — wrap.
    return { success: true, ...raw } as unknown as T;
  }
  return { success: false, error: 'Unexpected gateway response' } as unknown as T;
}

function errorResult<T>(error: string): T {
  return { success: false, error } as unknown as T;
}

export function createMemoryApi(ctx: MemoryApiContext) {
  return {
    list: async (payload: MemoryListPayload): Promise<MemoryListResult> => {
      if (!ctx.gatewayManager) return errorResult('Gateway manager unavailable');
      try {
        const raw = await ctx.gatewayManager.rpc('memory.list', payload, RPC_TIMEOUT_MS);
        return unwrapResult<MemoryListResult>(raw);
      } catch (err) {
        logger.warn('[memory:list] failed', { err: String(err) });
        return errorResult(String(err));
      }
    },

    search: async (payload: MemorySearchPayload): Promise<MemoryListResult> => {
      if (!ctx.gatewayManager) return errorResult('Gateway manager unavailable');
      try {
        // memory.search is an alias of memory.list with a query field.
        const raw = await ctx.gatewayManager.rpc('memory.list', payload, RPC_TIMEOUT_MS);
        return unwrapResult<MemoryListResult>(raw);
      } catch (err) {
        logger.warn('[memory:search] failed', { err: String(err) });
        return errorResult(String(err));
      }
    },

    detail: async (payload: MemoryDetailPayload): Promise<MemoryDetailResult> => {
      if (!ctx.gatewayManager) return errorResult('Gateway manager unavailable');
      try {
        const raw = await ctx.gatewayManager.rpc('memory.detail', payload, RPC_TIMEOUT_MS);
        return unwrapResult<MemoryDetailResult>(raw);
      } catch (err) {
        logger.warn('[memory:detail] failed', { err: String(err) });
        return errorResult(String(err));
      }
    },

    previewProposal: async (payload: MemoryProposal): Promise<MemoryProposalPreviewResult> => {
      if (!ctx.gatewayManager) return errorResult('Gateway manager unavailable');
      try {
        const raw = await ctx.gatewayManager.rpc(
          'memory.previewProposal',
          { proposal: payload },
          RPC_TIMEOUT_MS,
        );
        return unwrapResult<MemoryProposalPreviewResult>(raw);
      } catch (err) {
        logger.warn('[memory:previewProposal] failed', { err: String(err) });
        return errorResult(String(err));
      }
    },

    propose: async (payload: MemoryProposal): Promise<MemoryProposeResult> => {
      if (!ctx.gatewayManager) return errorResult('Gateway manager unavailable');
      try {
        // memory.propose is approval-gated; the gateway's permission path
        // applies the same gating as a direct RPC.
        const raw = await ctx.gatewayManager.rpc('memory.propose', { proposal: payload }, RPC_TIMEOUT_MS);
        return unwrapResult<MemoryProposeResult>(raw);
      } catch (err) {
        logger.warn('[memory:propose] failed', { err: String(err) });
        return errorResult(String(err));
      }
    },

    update: async (payload: MemoryUpdatePayload): Promise<MemoryUpdateResult> => {
      if (!ctx.gatewayManager) return errorResult('Gateway manager unavailable');
      try {
        const raw = await ctx.gatewayManager.rpc('memory.update', payload, RPC_TIMEOUT_MS);
        return unwrapResult<MemoryUpdateResult>(raw);
      } catch (err) {
        logger.warn('[memory:update] failed', { err: String(err) });
        return errorResult(String(err));
      }
    },

    health: async (): Promise<MemoryHealthReportResult> => {
      if (!ctx.gatewayManager) return errorResult('Gateway manager unavailable');
      try {
        // Gateway returns { success, health: MemoryHealthReport }; flatten so
        // the typed result IS the report (callers read result.ok, result.checks
        // directly, not result.health.ok).
        const raw = await ctx.gatewayManager.rpc('memory.health', {}, RPC_TIMEOUT_MS);
        const envelope = unwrapResult<{ success: boolean; error?: string; health?: unknown }>(raw);
        if (!envelope.success) {
          return errorResult(envelope.error ?? 'Gateway request failed');
        }
        const health = isRecord(envelope.health) ? envelope.health : {};
        return { success: true, ...health } as unknown as MemoryHealthReportResult;
      } catch (err) {
        logger.warn('[memory:health] failed', { err: String(err) });
        return errorResult(String(err));
      }
    },

    explainInjection: async (payload: MemoryExplainInjectionPayload): Promise<MemoryExplainInjectionResult> => {
      if (!ctx.gatewayManager) return errorResult('Gateway manager unavailable');
      try {
        const raw = await ctx.gatewayManager.rpc('memory.explainInjection', payload, RPC_TIMEOUT_MS);
        return unwrapResult<MemoryExplainInjectionResult>(raw);
      } catch (err) {
        logger.warn('[memory:explainInjection] failed', { err: String(err) });
        return errorResult(String(err));
      }
    },

    // R3-2.2 "本轮注入了什么": read sanitized COMPASS memory-injection receipts.
    injectionReceipts: async (
      payload: MemoryInjectionReceiptsPayload,
    ): Promise<MemoryInjectionReceiptsResult> => {
      if (!ctx.gatewayManager) return errorResult('Gateway manager unavailable');
      try {
        const raw = await ctx.gatewayManager.rpc('memory.injectionReceipts', payload, RPC_TIMEOUT_MS);
        return unwrapResult<MemoryInjectionReceiptsResult>(raw);
      } catch (err) {
        logger.warn('[memory:injectionReceipts] failed', { err: String(err) });
        return errorResult(String(err));
      }
    },

    // R3-2.4 proposeFacts manual-confirm queue (read).
    proposeFactsList: async (
      payload: MemoryProposeFactsListPayload,
    ): Promise<MemoryProposeFactsListResult> => {
      if (!ctx.gatewayManager) return errorResult('Gateway manager unavailable');
      try {
        const raw = await ctx.gatewayManager.rpc('memory.proposeFacts.list', payload, RPC_TIMEOUT_MS);
        return unwrapResult<MemoryProposeFactsListResult>(raw);
      } catch (err) {
        logger.warn('[memory:proposeFactsList] failed', { err: String(err) });
        return errorResult(String(err));
      }
    },

    // R3-2.4 proposeFacts confirm (write). Routes through the E-1 owner-
    // convergence + promote + appendFact composition on the runtime.
    proposeFactsConfirm: async (
      payload: MemoryProposeFactsConfirmPayload,
    ): Promise<MemoryProposeFactsConfirmResult> => {
      if (!ctx.gatewayManager) return errorResult('Gateway manager unavailable');
      try {
        const raw = await ctx.gatewayManager.rpc('memory.proposeFacts.confirm', payload, RPC_TIMEOUT_MS);
        return unwrapResult<MemoryProposeFactsConfirmResult>(raw);
      } catch (err) {
        logger.warn('[memory:proposeFactsConfirm] failed', { err: String(err) });
        return errorResult(String(err));
      }
    },
  };
}
