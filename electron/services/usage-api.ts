import { resolveContextWindow } from '../utils/context-window';
import { assessPromptCacheStatus } from '../utils/prompt-cache-status';
import { getSetting, setSetting } from '../utils/store';
import { getRecentTokenUsageHistory, getSessionTokenUsageSummary, getUsageAggregateSummary } from '../utils/token-usage';
import type { UsageAggregateWindow } from '@shared/host-api/contract';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { isRecord } from './payload-utils';
import type {
  PromptCacheChangeCode,
  PromptCacheRiskAction,
  PromptCacheRiskDecision,
  PromptCacheRiskDecisionEvent,
  PromptCacheRiskEvent,
  PromptCacheRiskObservation,
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

function readAggregateWindow(payload: unknown): UsageAggregateWindow {
  const value = isRecord(payload) ? payload.window : undefined;
  if (value === '7d' || value === '30d' || value === 'all') {
    return value;
  }
  return '30d';
}

const PROMPT_CACHE_RISK_LEDGER_LIMIT = 200;
const PROMPT_CACHE_CHANGE_CODES = new Set<PromptCacheChangeCode>([
  'cacheRetention',
  'model',
  'streamStrategy',
  'systemPrompt',
  'tools',
  'transport',
]);
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

/**
 * Reads the persisted ledger, labelling legacy rows (which predate the
 * `source` field) as confirmed decisions so observed and confirmed records stay
 * distinguishable after a schema upgrade.
 */
async function readPromptCacheRiskLedger(): Promise<PromptCacheRiskEvent[]> {
  let ledger: unknown;
  try {
    ledger = await getSetting('promptCacheRiskLedger');
  } catch {
    return [];
  }
  if (!Array.isArray(ledger)) return [];
  const entries: PromptCacheRiskEvent[] = [];
  for (const row of ledger) {
    const normalized = normalizePromptCacheRiskEvent(row);
    if (normalized) entries.push(normalized);
  }
  return entries;
}

function normalizePromptCacheRiskEvent(row: unknown): PromptCacheRiskEvent | null {
  if (!isRecord(row) || typeof row.sessionKey !== 'string' || !row.sessionKey) {
    return null;
  }
  if (row.source === 'observed') {
    return isRecord(row) && typeof row.eventId === 'string'
      ? (row as unknown as PromptCacheRiskObservation)
      : null;
  }
  // Legacy rows and confirmed decisions share the decision shape.
  return { ...(row as unknown as PromptCacheRiskDecisionEvent), source: 'confirmed' };
}

/**
 * Serializes every ledger mutation. Reads and writes are read-modify-write over
 * a single electron-store key, so without a queue concurrent observed/confirmed
 * appends would drop each other.
 */
let promptCacheLedgerQueue: Promise<unknown> = Promise.resolve();

function withPromptCacheLedgerLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = promptCacheLedgerQueue.then(operation, operation);
  // Keep the chain alive regardless of individual failures.
  promptCacheLedgerQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// Only observed frames can be dropped as replays, so the confirmed overload
// returns a non-null decision event.
async function appendPromptCacheRiskEvent(
  event: PromptCacheRiskObservation,
): Promise<PromptCacheRiskObservation | null>;
async function appendPromptCacheRiskEvent(
  event: PromptCacheRiskDecisionEvent,
): Promise<PromptCacheRiskDecisionEvent>;
async function appendPromptCacheRiskEvent(
  event: PromptCacheRiskEvent,
): Promise<PromptCacheRiskEvent | null> {
  return withPromptCacheLedgerLock(async () => {
    const ledger = await readPromptCacheRiskLedger();
    // Replayed observed frames carry a stable eventId; drop exact duplicates so
    // a Gateway reconnect does not inflate the ledger.
    if (event.source === 'observed') {
      const duplicate = ledger.some(
        (entry) => entry.source === 'observed' && entry.eventId === event.eventId,
      );
      if (duplicate) return null;
    }
    const next = [event, ...ledger]
      .filter((entry) => entry && typeof entry.sessionKey === 'string')
      .slice(0, PROMPT_CACHE_RISK_LEDGER_LIMIT);
    await setSetting('promptCacheRiskLedger', next);
    return event;
  });
}

/** Records an agent-observed cache-read break; bounded, deduplicated metadata. */
async function recordObservedPromptCacheBreak(input: {
  sessionKey: string;
  eventId: string;
  previousCacheRead: number;
  cacheRead: number;
  changes: PromptCacheChangeCode[];
}): Promise<PromptCacheRiskObservation | null> {
  const observation: PromptCacheRiskObservation = {
    sessionKey: input.sessionKey,
    source: 'observed',
    eventId: input.eventId,
    previousCacheRead: Math.max(0, Math.floor(input.previousCacheRead)),
    cacheRead: Math.max(0, Math.floor(input.cacheRead)),
    changes: input.changes,
    updatedAt: Date.now(),
  };
  const stored = await appendPromptCacheRiskEvent(observation);
  return stored && stored.source === 'observed' ? stored : null;
}

/**
 * Public entry used by the runtime-observation bridge in Main. Unlike the
 * renderer-facing `recordPromptCacheRiskEvent` (which always labels a confirmed
 * decision), this path only ever writes observed break evidence.
 */
export async function recordPromptCacheObservation(payload: unknown): Promise<PromptCacheRiskObservation | null> {
  const sessionKey = readString(payload, 'sessionKey');
  const eventId = readString(payload, 'eventId');
  const previousCacheRead = readNumber(payload, 'previousCacheRead');
  const cacheRead = readNumber(payload, 'cacheRead');
  if (!sessionKey || !eventId || previousCacheRead == null || cacheRead == null) {
    return null;
  }
  const rawChanges = isRecord(payload) && Array.isArray(payload.changes) ? payload.changes : [];
  const changes: PromptCacheChangeCode[] = [];
  for (const code of rawChanges) {
    if (typeof code === 'string' && PROMPT_CACHE_CHANGE_CODES.has(code as PromptCacheChangeCode)) {
      const typed = code as PromptCacheChangeCode;
      if (!changes.includes(typed)) changes.push(typed);
    }
  }
  return recordObservedPromptCacheBreak({
    sessionKey,
    eventId,
    previousCacheRead,
    cacheRead,
    changes,
  });
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
    aggregateSummary: async (payload) => getUsageAggregateSummary(readAggregateWindow(payload)),
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
          scope: 'session',
          runId: null,
          requestedRunId: runId,
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
        source: 'confirmed',
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
