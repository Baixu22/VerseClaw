import type { SessionCompactionStatus } from '@shared/host-api/contract';
import type { LiveTokenUsage, WorkspaceContextRange } from '@shared/types/workspace';

export type SessionContinuityAction = 'fork' | 'handoff';

export type SessionContinuityReason =
  | 'default'
  | 'gateway_unavailable'
  | 'high_pressure'
  | 'truncated_context'
  | 'compaction_warning'
  | 'active_run';

export type SessionContinuityRecommendation = {
  action: SessionContinuityAction;
  reason: SessionContinuityReason;
  disabled: boolean;
};

export type SessionContinuityErrorKind =
  | 'active_run'
  | 'gateway_unavailable'
  | 'parent_too_large'
  | 'transcript_unavailable'
  | 'unknown';

const HIGH_CONTEXT_PRESSURE_RATIO = 0.85;

export function resolveSessionContinuityRecommendation(input: {
  gatewayAvailable: boolean;
  activeRun: boolean;
  contextRange?: WorkspaceContextRange | null;
  liveUsage?: LiveTokenUsage | null;
  compactionStatus?: SessionCompactionStatus | null;
}): SessionContinuityRecommendation {
  if (input.activeRun) {
    return { action: 'fork', reason: 'active_run', disabled: true };
  }

  if (!input.gatewayAvailable) {
    return { action: 'handoff', reason: 'gateway_unavailable', disabled: false };
  }

  const truncatedMessageCount = Math.max(
    input.contextRange?.truncatedMessageCount ?? 0,
    input.compactionStatus?.truncatedMessageCount ?? 0,
  );
  if (truncatedMessageCount > 0) {
    return { action: 'handoff', reason: 'truncated_context', disabled: false };
  }

  if ((input.compactionStatus?.warnings?.length ?? 0) > 0 || input.compactionStatus?.canCompact === false) {
    return { action: 'handoff', reason: 'compaction_warning', disabled: false };
  }

  if (input.compactionStatus?.pressure === 'high') {
    return { action: 'handoff', reason: 'high_pressure', disabled: false };
  }

  const maxTokens = input.compactionStatus?.maxTokens ?? input.contextRange?.maxTokens ?? null;
  const usedTokens = input.compactionStatus?.usedTokens
    ?? input.liveUsage?.totalTokens
    ?? input.contextRange?.usedTokens
    ?? null;
  if (
    typeof maxTokens === 'number'
    && maxTokens > 0
    && typeof usedTokens === 'number'
    && usedTokens / maxTokens >= HIGH_CONTEXT_PRESSURE_RATIO
  ) {
    return { action: 'handoff', reason: 'high_pressure', disabled: false };
  }

  return { action: 'fork', reason: 'default', disabled: false };
}

export function classifySessionContinuityError(error: unknown): SessionContinuityErrorKind {
  const text = extractErrorText(error).toLowerCase();
  if (!text) return 'unknown';

  if (/(active|current).{0,24}run|run.{0,24}(active|running)|sending|streaming|pending final|cannot fork while/.test(text)) {
    return 'active_run';
  }
  if (/gateway[_ -]?unavailable|gateway manager unavailable|gateway unavailable|gateway.*not.*available|gateway.*down/.test(text)) {
    return 'gateway_unavailable';
  }
  if (/too large|parent context|context.*exceed|exceed.*fork|fork limit|parent-too-large/.test(text)) {
    return 'parent_too_large';
  }
  if (/transcript.*(unavailable|missing|not found|unparseable|invalid)|failed to fork source transcript|unknown source session|no_transcript/.test(text)) {
    return 'transcript_unavailable';
  }

  return 'unknown';
}

function extractErrorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== 'object') return '';
  const record = error as Record<string, unknown>;
  return [record.error, record.message, record.reason, record.warning]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
}
