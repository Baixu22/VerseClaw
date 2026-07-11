import type { SessionCompactionStatus } from '@shared/host-api/contract';
import type { LongTaskControlStatus } from '@shared/types/long-task-control';
import type { WorkspaceContextRange } from '@shared/types/workspace';

export type RollbackPlanActionKind =
  | 'checkpoint-handoff'
  | 'drain-queue'
  | 'manual-compact'
  | 'review-git'
  | 'task-ledger-review'
  | 'memory-review'
  | 'terminal-control'
  | 'terminal-interrupt';

export type RollbackPlanAction = {
  kind: RollbackPlanActionKind;
  titleKey: string;
  detailKey: string;
  detailValues?: Record<string, string | number>;
  risk: 'safe' | 'review' | 'dangerous';
  command?: 'handoff' | 'queueDrain' | 'compact' | 'openGit' | 'openTaskLedger' | 'interruptTerminal' | 'createMemoryDraft';
};

export type RollbackPlanSignalKind =
  | 'checkpoint'
  | 'queue'
  | 'context'
  | 'terminal'
  | 'git'
  | 'task-ledger'
  | 'memory';

export type RollbackPlanSignal = {
  kind: RollbackPlanSignalKind;
  titleKey: string;
  active: boolean;
  risk: 'safe' | 'review' | 'dangerous';
};

export type RollbackPlan = {
  available: boolean;
  summaryKey: string;
  summaryValues?: Record<string, string | number>;
  riskCounts: Record<'safe' | 'review' | 'dangerous', number>;
  signals: RollbackPlanSignal[];
  actions: RollbackPlanAction[];
};

const SIDEBAR_TRIGGER_ACTIONS = new Set<RollbackPlanActionKind>([
  'checkpoint-handoff',
  'drain-queue',
  'manual-compact',
  'terminal-interrupt',
]);

function getRecordSize(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  return Object.values(value as Record<string, unknown>)
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .length;
}

function getArraySize(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function checkpointEvidenceCounts(checkpoint: LongTaskControlStatus['latestCheckpoint']): {
  fileCount: number;
  toolCount: number;
} {
  const checkpointRecord = checkpoint?.checkpoint as unknown as Record<string, unknown> | undefined;
  const metadata = checkpointRecord?.metadata as Record<string, unknown> | undefined;
  const fileCount = getRecordSize(checkpointRecord?.fileHashes) || getRecordSize(metadata?.fileHashes);
  const toolCount = getArraySize(checkpointRecord?.toolResults) || getArraySize(metadata?.toolResults);
  return { fileCount, toolCount };
}

export function hasRollbackPlanSidebarTrigger(plan: RollbackPlan): boolean {
  return plan.actions.some((action) => SIDEBAR_TRIGGER_ACTIONS.has(action.kind));
}

export type BuildRollbackPlanInput = {
  activeRun: boolean;
  gatewayAvailable: boolean;
  queueDrainBusy: boolean;
  compactionBusy: boolean;
  handoffDisabled: boolean;
  contextRange: WorkspaceContextRange | null;
  compactionStatus: SessionCompactionStatus | null;
  longTaskControlStatus: LongTaskControlStatus | null;
};

export function buildRollbackPlan(input: BuildRollbackPlanInput): RollbackPlan {
  const actions: RollbackPlanAction[] = [];
  const checkpoint = input.longTaskControlStatus?.latestCheckpoint;
  const queueCount = input.longTaskControlStatus?.queueCount ?? 0;
  const pressure = input.compactionStatus?.pressure;
  const truncated = input.compactionStatus?.truncatedMessageCount ?? input.contextRange?.truncatedMessageCount ?? 0;
  const gitRecoveryPressure = Boolean(
    input.activeRun
    || checkpoint
    || queueCount > 0
    || input.compactionStatus?.canCompact
    || pressure === 'high'
    || truncated > 0,
  );

  if (checkpoint && !input.handoffDisabled) {
    const evidence = checkpointEvidenceCounts(checkpoint);
    const hasCheckpointEvidence = evidence.fileCount > 0 && evidence.toolCount > 0;
    actions.push({
      kind: 'checkpoint-handoff',
      titleKey: 'composer.rollbackPlan.actions.checkpoint-handoff.title',
      detailKey: hasCheckpointEvidence
        ? 'composer.rollbackPlan.actions.checkpoint-handoff.detailEvidenceBacked'
        : 'composer.rollbackPlan.actions.checkpoint-handoff.detailNoEvidence',
      detailValues: { trigger: checkpoint.trigger, ...evidence },
      risk: 'safe',
      command: 'handoff',
    });
  }

  if (queueCount > 0) {
    actions.push({
      kind: 'drain-queue',
      titleKey: 'composer.rollbackPlan.actions.drain-queue.title',
      detailKey: 'composer.rollbackPlan.actions.drain-queue.detail',
      detailValues: { count: queueCount },
      risk: 'safe',
      command: 'queueDrain',
    });
  }

  if (!input.activeRun && input.compactionStatus?.canCompact) {
    actions.push({
      kind: 'manual-compact',
      titleKey: 'composer.rollbackPlan.actions.manual-compact.title',
      detailKey: pressure === 'high' || truncated > 0
        ? 'composer.rollbackPlan.actions.manual-compact.detailPressure'
        : 'composer.rollbackPlan.actions.manual-compact.detailDefault',
      risk: 'review',
      command: 'compact',
    });
  }

  actions.push({
    kind: 'terminal-control',
    titleKey: 'composer.rollbackPlan.actions.terminal-control.title',
    detailKey: 'composer.rollbackPlan.actions.terminal-control.detail',
    risk: 'review',
    command: 'interruptTerminal',
  });

  actions.push({
    kind: 'review-git',
    titleKey: 'composer.rollbackPlan.actions.review-git.title',
    detailKey: 'composer.rollbackPlan.actions.review-git.detail',
    risk: gitRecoveryPressure ? 'dangerous' : 'review',
    command: 'openGit',
  });

  actions.push({
    kind: 'task-ledger-review',
    titleKey: 'composer.rollbackPlan.actions.task-ledger-review.title',
    detailKey: 'composer.rollbackPlan.actions.task-ledger-review.detail',
    risk: 'review',
    command: 'openTaskLedger',
  });

  actions.push({
    kind: 'memory-review',
    titleKey: 'composer.rollbackPlan.actions.memory-review.title',
    detailKey: 'composer.rollbackPlan.actions.memory-review.detail',
    risk: 'review',
    command: 'createMemoryDraft',
  });

  if (input.activeRun) {
    actions.unshift({
      kind: 'terminal-interrupt',
      titleKey: 'composer.rollbackPlan.actions.terminal-interrupt.title',
      detailKey: 'composer.rollbackPlan.actions.terminal-interrupt.detail',
      risk: 'dangerous',
      command: 'interruptTerminal',
    });
  }

  const signals: RollbackPlanSignal[] = [
    {
      kind: 'checkpoint',
      titleKey: 'composer.rollbackPlan.signals.checkpoint',
      active: Boolean(checkpoint),
      risk: 'safe',
    },
    {
      kind: 'queue',
      titleKey: 'composer.rollbackPlan.signals.queue',
      active: queueCount > 0,
      risk: 'safe',
    },
    {
      kind: 'context',
      titleKey: 'composer.rollbackPlan.signals.context',
      active: Boolean(input.compactionStatus?.canCompact || pressure === 'high' || truncated > 0),
      risk: 'review',
    },
    {
      kind: 'terminal',
      titleKey: 'composer.rollbackPlan.signals.terminal',
      active: input.activeRun,
      risk: input.activeRun ? 'dangerous' : 'review',
    },
    {
      kind: 'git',
      titleKey: 'composer.rollbackPlan.signals.git',
      active: gitRecoveryPressure,
      risk: gitRecoveryPressure ? 'dangerous' : 'review',
    },
    {
      kind: 'task-ledger',
      titleKey: 'composer.rollbackPlan.signals.taskLedger',
      active: true,
      risk: 'review',
    },
    {
      kind: 'memory',
      titleKey: 'composer.rollbackPlan.signals.memory',
      active: true,
      risk: 'review',
    },
  ];

  const riskCounts = actions.reduce<Record<'safe' | 'review' | 'dangerous', number>>(
    (counts, action) => {
      counts[action.risk] += 1;
      return counts;
    },
    { safe: 0, review: 0, dangerous: 0 },
  );

  const available = input.gatewayAvailable || actions.length > 0;
  const summaryKey = checkpoint
    ? 'composer.rollbackPlan.summary.checkpoint'
    : queueCount > 0
      ? 'composer.rollbackPlan.summary.queue'
      : truncated > 0
        ? 'composer.rollbackPlan.summary.truncated'
        : 'composer.rollbackPlan.summary.default';
  let summaryValues: Record<string, string | number> | undefined;
  if (checkpoint) {
    summaryValues = { trigger: checkpoint.trigger };
  } else if (queueCount > 0) {
    summaryValues = { count: queueCount };
  } else if (truncated > 0) {
    summaryValues = { count: truncated };
  }

  return { available, summaryKey, summaryValues, riskCounts, signals, actions };
}
