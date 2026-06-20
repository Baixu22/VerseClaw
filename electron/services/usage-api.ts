import { resolveContextWindow } from '../utils/context-window';
import { getRecentTokenUsageHistory, getSessionTokenUsageSummary } from '../utils/token-usage';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { isRecord } from './payload-utils';

type RecentTokenHistoryPayload = {
  limit?: unknown;
};

function getSafeLimit(payload: unknown): number | undefined {
  const value = isRecord(payload) ? (payload as RecentTokenHistoryPayload).limit : payload;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(Math.floor(value), 1);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(Math.floor(parsed), 1);
    }
  }
  return undefined;
}

export function createUsageApi(): CompleteHostServiceRegistry['usage'] {
  return {
    recentTokenHistory: async (payload) => getRecentTokenUsageHistory(getSafeLimit(payload)),
    live: async (payload) => {
      const sessionKey = isRecord(payload) && typeof payload.sessionKey === 'string'
        ? payload.sessionKey
        : 'agent:main:main';
      const runId = isRecord(payload) && typeof payload.runId === 'string'
        ? payload.runId
        : null;
      const streaming = isRecord(payload) && payload.streaming === true;
      const summary = await getSessionTokenUsageSummary(sessionKey);

      return {
        success: true,
        usage: {
          sessionKey,
          runId,
          inputTokens: summary.inputTokens,
          outputTokens: summary.outputTokens,
          cacheReadTokens: summary.cacheReadTokens,
          cacheWriteTokens: summary.cacheWriteTokens,
          totalTokens: summary.totalTokens,
          estimatedCostUsd: summary.estimatedCostUsd,
          updatedAt: Date.now(),
          status: streaming
            ? 'streaming'
            : summary.usageStatus === 'available'
              ? 'final'
              : 'idle',
        },
      };
    },
    contextRange: async (payload) => {
      const sessionKey = isRecord(payload) && typeof payload.sessionKey === 'string'
        ? payload.sessionKey
        : 'agent:main:main';
      const messageCount = isRecord(payload) && typeof payload.messageCount === 'number'
        ? Math.max(0, Math.floor(payload.messageCount))
        : 0;
      const explicitUsedTokens = isRecord(payload) && typeof payload.usedTokens === 'number'
        ? Math.max(0, Math.floor(payload.usedTokens))
        : null;
      const modelRef = isRecord(payload) && typeof payload.modelRef === 'string' ? payload.modelRef : null;
      const [summary, contextWindow] = await Promise.all([
        getSessionTokenUsageSummary(sessionKey),
        resolveContextWindow(modelRef),
      ]);
      const usedTokens = explicitUsedTokens ?? (summary.totalTokens > 0 ? summary.totalTokens : null);
      const status = contextWindow.maxTokens != null || usedTokens != null ? 'bestEffort' : 'unavailable';

      return {
        success: true,
        range: {
          sessionKey,
          modelRef: contextWindow.modelRef,
          maxTokens: contextWindow.maxTokens,
          usedTokens,
          visibleMessageStartIndex: messageCount > 0 ? 0 : null,
          visibleMessageEndIndex: messageCount > 0 ? messageCount - 1 : null,
          retainedMessageCount: messageCount,
          truncatedMessageCount: 0,
          summarizedMessageCount: 0,
          status,
        },
      };
    },
  };
}
