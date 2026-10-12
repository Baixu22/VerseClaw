import type { SessionCompactionStatus } from '@shared/host-api/contract';
import type { LongTaskControlStatus } from '@shared/types/long-task-control';
import type { LiveTokenUsage, WorkspaceContextRange } from '@shared/types/workspace';

export type SessionContinuityAction = 'fork' | 'handoff';

export type SessionContinuityReason =
  | 'default'
  | 'gateway_unavailable'
  | 'high_pressure'
  | 'truncated_context'
  | 'compaction_warning'
  | 'recovery_checkpoint'
  | 'recovery_context'
  | 'active_run';

export type SessionContinuityRecommendation = {
  action: SessionContinuityAction;
  reason: SessionContinuityReason;
  disabled: boolean;
};

export type SessionContinuityAvailability = {
  disabled: boolean;
  reasons: SessionContinuityReason[];
};

export type SessionContinuityHealth = {
  status: 'healthy' | 'risky' | 'blocked';
  reasons: SessionContinuityReason[];
};

export type SessionContinuityPreflight = {
  fork: SessionContinuityAvailability;
  handoff: SessionContinuityAvailability;
  recommendation: SessionContinuityRecommendation;
  health: SessionContinuityHealth;
};

export type SessionContinuityErrorKind =
  | 'active_run'
  | 'gateway_unavailable'
  | 'parent_too_large'
  | 'transcript_unavailable'
  | 'handoff_depth_exceeded'
  | 'handoff_cycle_detected'
  | 'unknown';

const HIGH_CONTEXT_PRESSURE_RATIO = 0.85;
const RECOVERY_CHECKPOINT_TRIGGERS = new Set([
  'compaction',
  'interrupt',
  'run_abort',
  'manual_review',
  'session_rotation',
]);

export function resolveSessionContinuityPreflight(input: {
  gatewayAvailable: boolean;
  activeRun: boolean;
  contextRange?: WorkspaceContextRange | null;
  liveUsage?: LiveTokenUsage | null;
  compactionStatus?: SessionCompactionStatus | null;
  longTaskControlStatus?: LongTaskControlStatus | null;
}): SessionContinuityPreflight {
  const forkReasons: SessionContinuityReason[] = [];
  const handoffReasons: SessionContinuityReason[] = [];

  if (input.activeRun || input.longTaskControlStatus?.latestIntervention?.status === 'draining') {
    return {
      fork: { disabled: true, reasons: ['active_run'] },
      handoff: { disabled: true, reasons: ['active_run'] },
      recommendation: { action: 'fork', reason: 'active_run', disabled: true },
      health: { status: 'blocked', reasons: ['active_run'] },
    };
  }

  if (!input.gatewayAvailable) {
    forkReasons.push('gateway_unavailable');
    handoffReasons.push('gateway_unavailable');
  }

  const truncatedMessageCount = Math.max(
    input.contextRange?.truncatedMessageCount ?? 0,
    input.compactionStatus?.truncatedMessageCount ?? 0,
  );
  if (truncatedMessageCount > 0) {
    forkReasons.push('truncated_context');
    handoffReasons.push('truncated_context');
  }

  if ((input.compactionStatus?.warnings?.length ?? 0) > 0 || input.compactionStatus?.canCompact === false) {
    forkReasons.push('compaction_warning');
    handoffReasons.push('compaction_warning');
  }

  const checkpointTrigger = input.longTaskControlStatus?.latestCheckpoint?.trigger;
  if (checkpointTrigger && RECOVERY_CHECKPOINT_TRIGGERS.has(checkpointTrigger)) {
    forkReasons.push('recovery_checkpoint');
    handoffReasons.push('recovery_checkpoint');
  }

  const recoveryWarnings = input.longTaskControlStatus?.warnings ?? [];
  if (recoveryWarnings.some((warning) => /recovery|context[_ -]?pack|compression[_ -]?artifact/i.test(warning))) {
    forkReasons.push('recovery_context');
    handoffReasons.push('recovery_context');
  }

  if (input.compactionStatus?.pressure === 'high') {
    forkReasons.push('high_pressure');
    handoffReasons.push('high_pressure');
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
    forkReasons.push('high_pressure');
    handoffReasons.push('high_pressure');
  }

  const firstHandoffReason = handoffReasons.find((reason) => reason !== 'gateway_unavailable') ?? handoffReasons[0];
  const recommendation: SessionContinuityRecommendation = firstHandoffReason
    ? { action: 'handoff', reason: firstHandoffReason, disabled: false }
    : { action: 'fork', reason: 'default', disabled: false };
  const riskReasons = uniqueReasons([
    ...forkReasons,
    ...handoffReasons,
  ]);

  return {
    fork: {
      disabled: !input.gatewayAvailable,
      reasons: uniqueReasons(forkReasons),
    },
    handoff: {
      disabled: false,
      reasons: uniqueReasons(handoffReasons),
    },
    recommendation,
    health: {
      status: riskReasons.length > 0 ? 'risky' : 'healthy',
      reasons: riskReasons,
    },
  };
}

export function resolveSessionContinuityRecommendation(input: Parameters<typeof resolveSessionContinuityPreflight>[0]): SessionContinuityRecommendation {
  return resolveSessionContinuityPreflight(input).recommendation;
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
  if (/handoff[_ -]?cycle[_ -]?detected|handoff cycle detected|appears in its own handoff ancestry/.test(text)) {
    return 'handoff_cycle_detected';
  }
  if (/handoff[_ -]?depth[_ -]?exceeded|handoff depth \d+ exceeds/.test(text)) {
    return 'handoff_depth_exceeded';
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

function uniqueReasons(reasons: SessionContinuityReason[]): SessionContinuityReason[] {
  return Array.from(new Set(reasons));
}
