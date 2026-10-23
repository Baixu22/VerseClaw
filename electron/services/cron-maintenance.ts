/**
 * Cron maintenance — periodic agentId repair for gateway cron jobs created
 * outside the app (e.g. via the openclaw CLI).
 *
 * R0-3: the interval handle is saved and unref'd, the loop is disposable
 * from the app quit path, and failure counts are exposed through the
 * diagnostics surface instead of a console.debug that nobody sees.
 */

import type { GatewayManager } from '../gateway/manager';
import { logger } from '../utils/logger';
import { resolveAgentIdFromChannel } from '../utils/agent-config';
import { resolveAccountIdFromSessionHistory } from '../utils/session-util';
import { getTimerAligner } from '../../shared/resources';
import { resolveCronCoordinatorStatus } from './cron-api';

const CRON_AGENT_REPAIR_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const REPAIR_ERROR_LOG_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
/**
 * E1: how often coordinator-bound schedules are re-checked and suppressed when
 * their binding/generation went stale. The runtime fence already refuses a
 * stale delivery in the meantime; this pass makes the suppression durable and
 * visible without deleting the schedule.
 */
const CRON_COORDINATOR_RECONCILE_INTERVAL_MS = 60 * 1000;
const COORDINATOR_RECEIPT_LIMIT = 50;

export type CronCoordinatorSuppressionReceipt = {
  jobId: string;
  jobName: string;
  workspaceId: string;
  coordinatorSessionKey: string;
  state: string;
  reason: string;
  expectedSessionId?: string;
  observedSessionId?: string | null;
  at: string;
  suppressed: boolean;
  alreadyDisabled: boolean;
};

export type CronCoordinatorReconciliationStats = {
  lastRunAt: number | null;
  checked: number;
  suppressed: number;
  alreadyDisabled: number;
  allowed: number;
  failures: number;
  lastError: string | null;
  receipts: CronCoordinatorSuppressionReceipt[];
};

export type CronRepairStats = {
  lastRunAt: number | null;
  repairsAttempted: number;
  repairsApplied: number;
  failures: number;
  lastError: string | null;
};

type CronRepairJob = {
  id: string;
  enabled?: boolean;
  name: string;
  sessionTarget?: string;
  payload?: { kind: string };
  delivery?: { mode: string; channel?: string; to?: string; accountId?: string };
  state?: Record<string, unknown>;
};

let repairUnregister: (() => void) | null = null;
let coordinatorUnregister: (() => void) | null = null;
let lastRepairErrorLogAt = 0;

const stats: CronRepairStats = {
  lastRunAt: null,
  repairsAttempted: 0,
  repairsApplied: 0,
  failures: 0,
  lastError: null,
};

const coordinatorStats: CronCoordinatorReconciliationStats = {
  lastRunAt: null,
  checked: 0,
  suppressed: 0,
  alreadyDisabled: 0,
  allowed: 0,
  failures: 0,
  lastError: null,
  receipts: [],
};

export function getCronCoordinatorReconciliationStats(): CronCoordinatorReconciliationStats {
  return { ...coordinatorStats, receipts: coordinatorStats.receipts.map((entry) => ({ ...entry })) };
}

function recordCoordinatorReceipt(receipt: CronCoordinatorSuppressionReceipt): void {
  coordinatorStats.receipts.push(receipt);
  if (coordinatorStats.receipts.length > COORDINATOR_RECEIPT_LIMIT) {
    coordinatorStats.receipts.splice(0, coordinatorStats.receipts.length - COORDINATOR_RECEIPT_LIMIT);
  }
}

export function getCronRepairStats(): CronRepairStats {
  return { ...stats };
}

async function runRepairTick(gatewayManager: GatewayManager): Promise<void> {
  stats.lastRunAt = Date.now();
  const status = gatewayManager.getStatus();
  if (status.state !== 'running') return;

  const result = await gatewayManager.rpc('cron.list', { includeDisabled: true });
  const jobs = Array.isArray(result)
    ? result
    : (result as { jobs?: Array<CronRepairJob> })?.jobs ?? [];

  for (const job of jobs) {
    const jobAgentId = (job as unknown as { agentId?: string }).agentId;
    if (
      (job.sessionTarget === 'isolated' || !job.sessionTarget) &&
      job.payload?.kind === 'agentTurn' &&
      job.delivery?.mode === 'announce' &&
      job.delivery?.channel &&
      jobAgentId === undefined
    ) {
      const channel = job.delivery.channel;
      const accountId = job.delivery.accountId;
      const toAddress = job.delivery.to;

      let correctAgentId = await resolveAgentIdFromChannel(channel, accountId);

      // If no accountId, try to resolve it from session history
      let resolvedAccountId: string | null = null;
      if (!correctAgentId && !accountId && toAddress) {
        resolvedAccountId = await resolveAccountIdFromSessionHistory(toAddress, channel);
        if (resolvedAccountId) {
          correctAgentId = await resolveAgentIdFromChannel(channel, resolvedAccountId);
        }
      }

      if (correctAgentId) {
        stats.repairsAttempted += 1;
        logger.info(`Periodic cron repair: job "${job.name}" agentId undefined -> "${correctAgentId}"`);
        // When accountId was resolved via to address, include it in the patch
        const patch: Record<string, unknown> = { agentId: correctAgentId };
        if (resolvedAccountId && !accountId) {
          patch.delivery = { accountId: resolvedAccountId };
        }
        await gatewayManager.rpc('cron.update', { id: job.id, patch });
        stats.repairsApplied += 1;
      }
    }
  }
}

type CronCoordinatorJob = CronRepairJob & {
  coordinator?: {
    workspaceId?: string;
    coordinatorSessionKey?: string;
    expectedSessionId?: string;
  } | null;
  jobName?: string;
};

/**
 * E1 reconciliation: a coordinator-bound schedule whose binding is invalidated,
 * whose deadline passed, or whose physical generation rotated is *suppressed*
 * (enabled=false with an explicit reason), never silently deleted. Cancel stays
 * an explicit operator action, and stop-current-turn stays a session control.
 */
export async function reconcileCronCoordinatorScopes(gatewayManager: GatewayManager): Promise<void> {
  const status = gatewayManager.getStatus();
  if (status.state !== 'running') return;
  coordinatorStats.lastRunAt = Date.now();
  const result = await gatewayManager.rpc('cron.list', { includeDisabled: true });
  const jobs: CronCoordinatorJob[] = Array.isArray(result)
    ? (result as CronCoordinatorJob[])
    : ((result as { jobs?: CronCoordinatorJob[] })?.jobs ?? []);

  for (const job of jobs) {
    if (!job?.coordinator || typeof job.id !== 'string') continue;
    coordinatorStats.checked += 1;
    const jobStatus = await resolveCronCoordinatorStatus(gatewayManager, job.coordinator);
    const baseReceipt = {
      jobId: job.id,
      jobName: job.name,
      workspaceId: job.coordinator.workspaceId ?? '',
      coordinatorSessionKey: job.coordinator.coordinatorSessionKey ?? '',
      state: jobStatus.state,
      reason: jobStatus.reason,
      ...(jobStatus.expectedSessionId ? { expectedSessionId: jobStatus.expectedSessionId } : {}),
      observedSessionId: jobStatus.observedSessionId ?? null,
      at: jobStatus.checkedAt,
    };
    if (jobStatus.state === 'allowed' || jobStatus.state === 'unbound') {
      coordinatorStats.allowed += 1;
      recordCoordinatorReceipt({ ...baseReceipt, suppressed: false, alreadyDisabled: job.enabled === false });
      continue;
    }
    if (job.enabled === false) {
      coordinatorStats.alreadyDisabled += 1;
      recordCoordinatorReceipt({ ...baseReceipt, suppressed: false, alreadyDisabled: true });
      continue;
    }
    await gatewayManager.rpc('cron.update', { id: job.id, patch: { enabled: false } });
    coordinatorStats.suppressed += 1;
    recordCoordinatorReceipt({ ...baseReceipt, suppressed: true, alreadyDisabled: false });
    logger.info(
      `Coordinator follow-up "${job.name}" suppressed (${jobStatus.state}): ${jobStatus.reason}`,
    );
  }
}

export function startCronAgentRepair(gatewayManager: GatewayManager): void {
  if (repairUnregister) return;
  repairUnregister = getTimerAligner().register({
    id: 'cron-agent-repair',
    intervalMs: CRON_AGENT_REPAIR_INTERVAL_MS,
    priority: 'background',
    run: () => runRepairTick(gatewayManager).catch((error) => {
      stats.failures += 1;
      stats.lastError = String(error);
      const now = Date.now();
      if (now - lastRepairErrorLogAt >= REPAIR_ERROR_LOG_INTERVAL_MS) {
        lastRepairErrorLogAt = now;
        logger.warn('Periodic cron repair error:', error);
      }
    }),
  });
  coordinatorUnregister = getTimerAligner().register({
    id: 'cron-coordinator-reconcile',
    intervalMs: CRON_COORDINATOR_RECONCILE_INTERVAL_MS,
    priority: 'background',
    run: () => reconcileCronCoordinatorScopes(gatewayManager).catch((error) => {
      coordinatorStats.failures += 1;
      coordinatorStats.lastError = String(error);
      logger.warn('Coordinator scope reconciliation error:', error);
    }),
  });
}

export function disposeCronMaintenance(): void {
  if (repairUnregister) {
    repairUnregister();
    repairUnregister = null;
  }
  if (coordinatorUnregister) {
    coordinatorUnregister();
    coordinatorUnregister = null;
  }
}
