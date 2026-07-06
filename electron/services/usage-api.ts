import { resolveContextWindow } from '../utils/context-window';
import { assessPromptCacheStatus } from '../utils/prompt-cache-status';
import { getSetting, setSetting } from '../utils/store';
import { getRecentTokenUsageHistory, getSessionTokenUsageSummary } from '../utils/token-usage';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { isRecord } from './payload-utils';
import type {
  PromptCacheRiskAction,
  PromptCacheRiskDecision,
  PromptCacheRiskEvent,
  PromptCacheRiskSeverity,
  PromptCacheStatus,
} from '@shared/types/workspace';

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

const PROMPT_CACHE_RISK_LEDGER_LIMIT = 200;
const PROMPT_CACHE_RISK_ACTIONS = new Set<PromptCacheRiskAction>([
  'model-switch',
  'manual-compaction',
  'skill-enable',
  'mcp-register',
  'mcp-reload',
  'system-prompt-change',
  'context-reset',
]);
const PROMPT_CACHE_RISK_SEVERITIES = new Set<PromptCacheRiskSeverity>([
  'none',
  'low',
  'medium',
  'high',
  'unknown',
]);
const PROMPT_CACHE_STATUSES = new Set<PromptCacheStatus>([
  'warm',
  'warming',
  'cold',
  'at-risk',
  'ineligible',
  'unknown',
]);
const PROMPT_CACHE_RISK_DECISIONS = new Set<PromptCacheRiskDecision>([
  'continued',
  'cancelled',
]);

async function readPromptCacheRiskLedger(): Promise<PromptCacheRiskEvent[]> {
  try {
    const ledger = await getSetting('promptCacheRiskLedger');
    return Array.isArray(ledger) ? ledger : [];
  } catch {
    return [];
  }
}

async function appendPromptCacheRiskEvent(event: PromptCacheRiskEvent): Promise<PromptCacheRiskEvent> {
  const ledger = await readPromptCacheRiskLedger();
  const next = [event, ...ledger]
    .filter((entry) => entry && typeof entry.sessionKey === 'string')
    .slice(0, PROMPT_CACHE_RISK_LEDGER_LIMIT);
  await setSetting('promptCacheRiskLedger', next);
  return event;
}

function readString(payload: unknown, key: string): string | null {
  if (!isRecord(payload)) return null;
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(payload: unknown, key: string): number | null {
  if (!isRecord(payload)) return null;
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
          lastTurnHitRate: summary.lastTurnHitRate,
          warmTurnHitRate: summary.warmTurnHitRate,
          lastTurnCacheReadTokens: summary.lastTurnCacheReadTokens,
          lastTurnCacheMissTokens: summary.lastTurnCacheMissTokens,
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
    promptCacheStatus: async (payload) => {
      const sessionKey = readString(payload, 'sessionKey') ?? 'agent:main:main';
      const modelRef = readString(payload, 'modelRef');
      const targetModelRef = readString(payload, 'targetModelRef');
      const action = readString(payload, 'action') as PromptCacheRiskAction | null;
      const usedTokens = readNumber(payload, 'usedTokens');
      const [summary, ledger] = await Promise.all([
        getSessionTokenUsageSummary(sessionKey),
        readPromptCacheRiskLedger(),
      ]);

      return {
        success: true,
        assessment: assessPromptCacheStatus({
          summary,
          modelRef,
          targetModelRef,
          action: action && PROMPT_CACHE_RISK_ACTIONS.has(action) ? action : undefined,
          usedTokens,
          ledger,
        }),
      };
    },
    recordPromptCacheRiskEvent: async (payload) => {
      const sessionKey = readString(payload, 'sessionKey') ?? 'agent:main:main';
      const action = readString(payload, 'action') as PromptCacheRiskAction | null;
      const severity = readString(payload, 'severity') as PromptCacheRiskSeverity | null;
      const status = readString(payload, 'status') as PromptCacheStatus | null;
      const decision = readString(payload, 'decision') as PromptCacheRiskDecision | null;
      const hitRate = readNumber(payload, 'hitRate');
      const promptTokens = Math.max(0, Math.floor(readNumber(payload, 'promptTokens') ?? 0));
      const estimatedExtraCostUsd = readNumber(payload, 'estimatedExtraCostUsd');
      const reason = readString(payload, 'reason');

      if (
        !action || !PROMPT_CACHE_RISK_ACTIONS.has(action)
        || !severity || !PROMPT_CACHE_RISK_SEVERITIES.has(severity)
        || !status || !PROMPT_CACHE_STATUSES.has(status)
        || !decision || !PROMPT_CACHE_RISK_DECISIONS.has(decision)
      ) {
        return {
          success: false,
          error: 'Invalid prompt cache risk event',
          event: undefined,
        };
      }

      const event = await appendPromptCacheRiskEvent({
        sessionKey,
        action,
        severity,
        status,
        decision,
        hitRate,
        promptTokens,
        ...(estimatedExtraCostUsd != null ? { estimatedExtraCostUsd } : {}),
        ...(reason ? { reason } : {}),
        updatedAt: Date.now(),
      });
      return { success: true, event };
    },
  };
}
