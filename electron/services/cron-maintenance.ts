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

const CRON_AGENT_REPAIR_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const REPAIR_ERROR_LOG_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export type CronRepairStats = {
  lastRunAt: number | null;
  repairsAttempted: number;
  repairsApplied: number;
  failures: number;
  lastError: string | null;
};

type CronRepairJob = {
  id: string;
  name: string;
  sessionTarget?: string;
  payload?: { kind: string };
  delivery?: { mode: string; channel?: string; to?: string; accountId?: string };
  state?: Record<string, unknown>;
};

let repairTimer: ReturnType<typeof setInterval> | null = null;
let lastRepairErrorLogAt = 0;

const stats: CronRepairStats = {
  lastRunAt: null,
  repairsAttempted: 0,
  repairsApplied: 0,
  failures: 0,
  lastError: null,
};

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

export function startCronAgentRepair(gatewayManager: GatewayManager): void {
  if (repairTimer) return;
  repairTimer = setInterval(() => {
    void runRepairTick(gatewayManager).catch((error) => {
      stats.failures += 1;
      stats.lastError = String(error);
      const now = Date.now();
      if (now - lastRepairErrorLogAt >= REPAIR_ERROR_LOG_INTERVAL_MS) {
        lastRepairErrorLogAt = now;
        logger.warn('Periodic cron repair error:', error);
      }
    });
  }, CRON_AGENT_REPAIR_INTERVAL_MS);
  repairTimer.unref?.();
}

export function disposeCronMaintenance(): void {
  if (repairTimer) {
    clearInterval(repairTimer);
    repairTimer = null;
  }
}
