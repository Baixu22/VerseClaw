/**
 * Area 4 §3.3: Typed memory facade.
 *
 * Forwards renderer calls to the existing gateway `memory.*` RPCs through the
 * same `gatewayManager.rpc(...)` path used by `RolesOrchestrationPanel.tsx`
 * today. Reads stay SAFE-listed (workspace-permissions.ts), writes stay
 * approval-gated — this facade adds no new permission surface, only type
 * safety and a single entry point per the Renderer/Main boundary rule.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MEMORY_CONTROL_PLANE_MANIFEST } from '@shared/memory/control-plane';
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
  MemorySurfacePayload,
  MemorySurfaceResult,
  MemoryApproveCandidatePayload,
  MemoryApproveCandidateResult,
  MemoryDeletePayload,
  MemoryDeleteResult,
  MemoryRememberPayload,
  MemoryRememberResult,
  MemoryExportPayload,
  MemoryExportResult,
} from '@shared/host-api/contract';

export type MemoryApiContext = {
  gatewayManager: GatewayManager | null;
  exportDir?: string;
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

    surface: async (payload: MemorySurfacePayload = {}): Promise<MemorySurfaceResult> => {
      if (!ctx.gatewayManager) return errorResult('Gateway manager unavailable');
      try {
        const raw = await ctx.gatewayManager.rpc('memory.surface', payload, RPC_TIMEOUT_MS);
        const result = unwrapResult<MemorySurfaceResult>(raw);
        if (!result.success) return result;
        return {
          ...result,
          model: {
            ...result.model,
            productDescription: MEMORY_CONTROL_PLANE_MANIFEST.productConcept.modelSafeDescription,
            approvalBoundary: MEMORY_CONTROL_PLANE_MANIFEST.productConcept.approvalBoundary,
          },
        };
      } catch (err) {
        logger.warn('[memory:surface] failed', { err: String(err) });
        return errorResult(String(err));
      }
    },

    approveCandidate: async (
      payload: MemoryApproveCandidatePayload,
    ): Promise<MemoryApproveCandidateResult> => {
      if (!ctx.gatewayManager) return errorResult('Gateway manager unavailable');
      try {
        if (payload.source === 'runtime-fact') {
          const raw = await ctx.gatewayManager.rpc(
            'memory.proposeFacts.confirm',
            { factId: payload.id, approvedBy: 'agent:clawx-memory-surface' },
            RPC_TIMEOUT_MS,
          );
          const result = unwrapResult<{
            success: boolean;
            error?: string;
            confirmed?: boolean;
            message?: string;
            factId?: string;
          }>(raw);
          if (!result.success) return result as MemoryApproveCandidateResult;
          return {
            success: true,
            approved: result.confirmed === true,
            ...(result.factId ? { acceptedId: result.factId } : {}),
            ...(result.message ? { reason: result.message } : {}),
          };
        }
        const raw = await ctx.gatewayManager.rpc(
          'memory.review',
          { id: payload.id, action: 'approve' },
          RPC_TIMEOUT_MS,
        );
        const result = unwrapResult<{
          success: boolean;
          error?: string;
          accepted?: boolean;
          reason?: string;
          card?: { id?: string };
        }>(raw);
        if (!result.success) return result as MemoryApproveCandidateResult;
        return {
          success: true,
          approved: result.accepted === true,
          ...(result.card?.id ? { acceptedId: result.card.id } : {}),
          ...(result.reason ? { reason: result.reason } : {}),
        };
      } catch (err) {
        logger.warn('[memory:approveCandidate] failed', { err: String(err) });
        return errorResult(String(err));
      }
    },

    delete: async (payload: MemoryDeletePayload): Promise<MemoryDeleteResult> => {
      if (!ctx.gatewayManager) return errorResult('Gateway manager unavailable');
      try {
        const raw = await ctx.gatewayManager.rpc('memory.delete', payload, RPC_TIMEOUT_MS);
        return unwrapResult<MemoryDeleteResult>(raw);
      } catch (err) {
        logger.warn('[memory:delete] failed', { err: String(err) });
        return errorResult(String(err));
      }
    },

    remember: async (payload: MemoryRememberPayload): Promise<MemoryRememberResult> => {
      if (!ctx.gatewayManager) return errorResult('Gateway manager unavailable');
      const content = payload.content.trim();
      if (!content) return errorResult('Memory content is required');
      try {
        const proposal: MemoryProposal = {
          type: payload.type ?? 'fact',
          scope: payload.scope,
          ...(payload.scopeKey !== undefined ? { scopeKey: payload.scopeKey } : {}),
          ...(payload.roleTags?.length ? { roleTags: payload.roleTags } : {}),
          content,
          confidence: 0.9,
          importance: 0.7,
          sensitivity: payload.sensitivity ?? 'normal',
          source: 'user',
          evidenceRefs: [{ type: 'manual', ref: 'memory-surface:explicit-remember' }],
          ...(payload.expiresAt !== undefined ? { expiresAt: payload.expiresAt } : {}),
        };
        const raw = await ctx.gatewayManager.rpc('memory.propose', { proposal }, RPC_TIMEOUT_MS);
        const result = unwrapResult<MemoryProposeResult>(raw);
        if (!result.success) return result as MemoryRememberResult;
        return {
          success: true,
          accepted: result.accepted === true,
          reviewRequired: result.accepted !== true,
          ...(result.card?.id ? { cardId: result.card.id } : {}),
          ...(result.proposal?.id ? { proposalId: result.proposal.id } : {}),
          ...(result.reason ? { reason: result.reason } : {}),
        };
      } catch (err) {
        logger.warn('[memory:remember] failed', { err: String(err) });
        return errorResult(String(err));
      }
    },

    export: async (payload: MemoryExportPayload = {}): Promise<MemoryExportResult> => {
      if (payload.format && payload.format !== 'json') {
        return errorResult('Only JSON Memory export is supported');
      }
      if (!ctx.exportDir) return errorResult('Memory export directory unavailable');
      if (!ctx.gatewayManager) return errorResult('Gateway manager unavailable');
      let surfaceResult: MemorySurfaceResult;
      try {
        const raw = await ctx.gatewayManager.rpc('memory.surface', { limit: 200 }, RPC_TIMEOUT_MS);
        surfaceResult = unwrapResult<MemorySurfaceResult>(raw);
      } catch (err) {
        return errorResult(String(err));
      }
      if (!surfaceResult.success) return surfaceResult as unknown as MemoryExportResult;
      const { success: _surfaceSuccess, ...surfaceSnapshot } = surfaceResult;
      const describedSurface = {
        ...surfaceSnapshot,
        model: {
          ...surfaceSnapshot.model,
          productDescription: MEMORY_CONTROL_PLANE_MANIFEST.productConcept.modelSafeDescription,
          approvalBoundary: MEMORY_CONTROL_PLANE_MANIFEST.productConcept.approvalBoundary,
        },
      };
      const redact = <T extends { sensitivity: string; content: string }>(entry: T): { entry: T; redacted: number } => {
        if (entry.sensitivity !== 'secret' && entry.sensitivity !== 'secret_adjacent') {
          return { entry, redacted: 0 };
        }
        return { entry: { ...entry, content: '[redacted]' }, redacted: 1 };
      };
      let redacted = 0;
      const accepted = describedSurface.accepted.map((entry) => {
        const next = redact(entry);
        redacted += next.redacted;
        return next.entry;
      });
      const candidates = describedSurface.candidates.map((entry) => {
        const next = redact(entry);
        redacted += next.redacted;
        return next.entry;
      });
      const generatedAt = new Date().toISOString();
      const snapshot = {
        ...describedSurface,
        generatedAt,
        accepted,
        candidates,
        model: {
          ...describedSurface.model,
          acceptedKeys: accepted.filter((entry) => entry.modelVisible).map((entry) => entry.key),
          candidateKeysExcluded: candidates.map((entry) => entry.key),
        },
        counts: {
          accepted: accepted.length,
          candidates: candidates.length,
          modelVisible: accepted.filter((entry) => entry.modelVisible).length,
        },
      };
      const json = JSON.stringify({ schemaVersion: 'MemoryExport/v1', snapshot }, null, 2) + '\n';
      const exportDir = ctx.exportDir;
      mkdirSync(exportDir, { recursive: true, mode: 0o700 });
      const safeTimestamp = generatedAt.replace(/[:.]/g, '-');
      const outputPath = join(exportDir, 'memory-export-' + safeTimestamp + '.json');
      writeFileSync(outputPath, json, { encoding: 'utf8', mode: 0o600 });
      const sha256 = createHash('sha256').update(json).digest('hex');
      return {
        success: true,
        path: outputPath,
        sha256,
        generatedAt,
        counts: {
          accepted: accepted.length,
          candidates: candidates.length,
          redacted,
        },
      };
    },
  };
}
