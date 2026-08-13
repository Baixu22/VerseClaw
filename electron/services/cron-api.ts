import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import {
  buildCronBrowserAutomationPrompt,
  CRON_BROWSER_AUTOMATION_TOOL_ALLOW,
  parseCronBrowserAutomationPrompt,
} from '@shared/cron-browser-automation';
import type { BrowserAutomationRunResult } from '@shared/host-api/contract';
import type { DeliveryChannelGroup } from '@shared/host-api/contract';
import type {
  CronBrowserAutomationConfig,
  CronJob,
  CronJobDelivery,
  CronJobCreateInput,
  CronJobSource,
  CronJobUpdateInput,
  CronSchedule,
} from '@shared/types/cron';
import type { GatewayManager } from '../gateway/manager';
import { getOpenClawConfigDir } from '../utils/paths';
import { resolveAgentIdFromChannel } from '../utils/agent-config';
import { toOpenClawChannelType, toUiChannelType } from '../utils/channel-alias';
import { resolveAccountIdFromSessionHistory } from '../utils/session-util';
import { isRecord } from './payload-utils';
import {
  classifyCronHostAction,
  decideSandboxHighRiskAction,
  loadSandboxHighRiskPolicy,
} from '@electron/utils/sandbox-high-risk-gate';
import {
  recordPermissionDecisionEvent,
} from './permissions-api';
import { createPermissionDecisionEvent } from '@shared/product-semantics';
import { getActiveWorkspaceProfile } from './workspaces-api';
import { DEFAULT_WORKSPACE_PERMISSION_MODE } from '@shared/types/workspace';

async function assertCronAllowedUnderSandbox(action: string): Promise<void> {
  const actionClass = classifyCronHostAction(action);
  if (!actionClass) return;
  const policy = await loadSandboxHighRiskPolicy();
  // Fail-closed on cron host API (no stepwise approval UI on this path).
  const decision = decideSandboxHighRiskAction(policy, actionClass, { allowApproval: false });
  if (decision.allowed) return;
  const workspace = await getActiveWorkspaceProfile();
  void recordPermissionDecisionEvent(createPermissionDecisionEvent({
    workspaceMode: workspace?.permissionMode ?? DEFAULT_WORKSPACE_PERMISSION_MODE,
    tool: `cron.${action}`,
    boundary: 'sandbox-runtime',
    decision: 'deny',
    reason: decision.reason,
  }));
  throw new Error(decision.reason ?? 'Cron action denied under degraded sandbox');
}


interface GatewayCronJob {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: { kind: string; expr?: string; everyMs?: number; at?: string; tz?: string };
  payload: { kind: string; message?: string; text?: string; toolsAllow?: string[] };
  delivery?: { mode: string; channel?: string; to?: string; accountId?: string };
  sessionTarget?: string;
  wakeMode?: string;
  state: {
    nextRunAtMs?: number;
    runningAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
    lastDurationMs?: number;
  };
  /** Set when an auto-repair (delivery/agentId) RPC failed — the gateway copy is unchanged. */
  repairDegraded?: boolean;
}

interface CronRunLogEntry {
  jobId?: string;
  action?: string;
  status?: string;
  error?: string;
  summary?: string;
  sessionId?: string;
  sessionKey?: string;
  ts?: number;
  runAtMs?: number;
  durationMs?: number;
  model?: string;
  provider?: string;
  browserAutomationResult?: BrowserAutomationRunResult;
}

interface CronSessionKeyParts {
  agentId: string;
  jobId: string;
  runSessionId?: string;
}

interface CronSessionFallbackMessage {
  id: string;
  role: 'assistant' | 'system';
  content: string;
  timestamp: number;
  isError?: boolean;
}

type JsonRecord = Record<string, unknown>;

function isBrowserAutomationInput(
  input: Pick<CronJobCreateInput, 'taskKind' | 'browserAutomation'> | Pick<CronJobUpdateInput, 'taskKind' | 'browserAutomation'>,
): input is { taskKind: 'browserAutomation'; browserAutomation: CronBrowserAutomationConfig } {
  return input.taskKind === 'browserAutomation' && !!input.browserAutomation;
}

function buildCronAgentPayload(input: Pick<
  CronJobCreateInput | CronJobUpdateInput,
  'message' | 'taskKind' | 'browserAutomation' | 'toolsAllow'
>): Record<string, unknown> | undefined {
  if (isBrowserAutomationInput(input)) {
    return {
      kind: 'agentTurn',
      message: buildCronBrowserAutomationPrompt(input.browserAutomation),
      toolsAllow: [...CRON_BROWSER_AUTOMATION_TOOL_ALLOW],
    };
  }
  if (typeof input.message === 'string') {
    return {
      kind: 'agentTurn',
      message: input.message,
      ...(Array.isArray(input.toolsAllow) ? { toolsAllow: input.toolsAllow } : {}),
    };
  }
  return undefined;
}

function parseCronSessionKey(sessionKey: string): CronSessionKeyParts | null {
  if (!sessionKey.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  if (parts.length < 4 || parts[2] !== 'cron') return null;
  const agentId = parts[1] || 'main';
  const jobId = parts[3];
  if (!jobId) return null;
  if (parts.length === 4) return { agentId, jobId };
  if (parts.length === 6 && parts[4] === 'run' && parts[5]) {
    return { agentId, jobId, runSessionId: parts[5] };
  }
  return null;
}

function normalizeTimestampMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function formatDuration(durationMs: number | undefined): string | null {
  if (!durationMs || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${Math.round(durationMs / 1000)}s`;
}

function buildCronRunMessage(entry: CronRunLogEntry, index: number): CronSessionFallbackMessage | null {
  const timestamp = normalizeTimestampMs(entry.ts) ?? normalizeTimestampMs(entry.runAtMs);
  if (!timestamp) return null;

  const status = typeof entry.status === 'string' ? entry.status.toLowerCase() : '';
  const summary = typeof entry.summary === 'string' ? entry.summary.trim() : '';
  const error = typeof entry.error === 'string' ? entry.error.trim() : '';
  let content = summary || error;
  if (!content) {
    content = status === 'error' ? 'Scheduled task failed.' : 'Scheduled task completed.';
  }
  if (status === 'error' && !content.toLowerCase().startsWith('run failed:')) {
    content = `Run failed: ${content}`;
  }
  if (entry.browserAutomationResult) {
    const result = entry.browserAutomationResult;
    const artifactCount = result.evidence?.artifacts?.length ?? 0;
    const lines = [
      `Browser automation: ${result.status}`,
      result.finalUrl ? `Final URL: ${result.finalUrl}` : '',
      result.title ? `Title: ${result.title}` : '',
      `Login state: ${result.loginState}`,
      `Steps: ${result.steps?.filter((step) => step.status === 'passed').length ?? 0}/${result.steps?.length ?? 0} passed`,
      artifactCount > 0 ? `Artifacts: ${artifactCount}` : '',
      result.error ? `Error: ${result.error}` : '',
    ].filter(Boolean);
    content = `${content}\n\n${lines.join('\n')}`;
  }

  const meta: string[] = [];
  const duration = formatDuration(entry.durationMs);
  if (duration) meta.push(`Duration: ${duration}`);
  if (entry.provider && entry.model) meta.push(`Model: ${entry.provider}/${entry.model}`);
  else if (entry.model) meta.push(`Model: ${entry.model}`);
  if (meta.length > 0) content = `${content}\n\n${meta.join(' | ')}`;

  return {
    id: `cron-run-${entry.sessionId ?? entry.ts ?? index}`,
    role: status === 'error' ? 'system' : 'assistant',
    content,
    timestamp,
    ...(status === 'error' ? { isError: true } : {}),
  };
}

async function readCronRunLog(
  gatewayManager: GatewayManager,
  jobId: string,
): Promise<CronRunLogEntry[]> {
  // Runtime persists run logs to SQLite (cron_run_logs); the legacy JSONL
  // path below has no producers. Prefer the cron.runs RPC so run history
  // actually shows up; fall back to the old file read (now effectively empty)
  // when the gateway is unreachable.
  try {
    const result = await gatewayManager.rpc(
      'cron.runs',
      { jobId, limit: 500, sortDir: 'asc' },
      8000,
    );
    const page = result as { entries?: CronRunLogEntry[] } | undefined;
    const entries = Array.isArray(page?.entries) ? page.entries : [];
    if (entries.length > 0) {
      return entries.filter(
        (entry) => entry && entry.jobId === jobId && (!entry.action || entry.action === 'finished'),
      );
    }
    // No entries from the RPC (mock, old gateway, or genuinely empty run log):
    // fall through to the legacy JSONL read so callers keep working.
  } catch {
    // fall through to legacy JSONL read (returns [] when absent)
  }
  const logPath = join(getOpenClawConfigDir(), 'cron', 'runs', `${jobId}.jsonl`);
  const raw = await readFile(logPath, 'utf8').catch(() => '');
  if (!raw.trim()) return [];

  const entries: CronRunLogEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as CronRunLogEntry;
      if (!entry || entry.jobId !== jobId) continue;
      if (entry.action && entry.action !== 'finished') continue;
      entries.push(entry);
    } catch {
      // Ignore malformed log lines.
    }
  }
  return entries;
}

async function readSessionStoreEntry(
  agentId: string,
  sessionKey: string,
): Promise<Record<string, unknown> | undefined> {
  const storePath = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', 'sessions.json');
  const raw = await readFile(storePath, 'utf8').catch(() => '');
  if (!raw.trim()) return undefined;

  try {
    const store = JSON.parse(raw) as Record<string, unknown>;
    const directEntry = store[sessionKey];
    if (directEntry && typeof directEntry === 'object') return directEntry as Record<string, unknown>;

    const sessions = (store as { sessions?: unknown }).sessions;
    if (Array.isArray(sessions)) {
      const arrayEntry = sessions.find((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const record = entry as Record<string, unknown>;
        return record.key === sessionKey || record.sessionKey === sessionKey;
      });
      if (arrayEntry && typeof arrayEntry === 'object') return arrayEntry as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function buildCronSessionFallbackMessages(params: {
  sessionKey: string;
  job?: Pick<GatewayCronJob, 'name' | 'payload' | 'state'>;
  runs: CronRunLogEntry[];
  sessionEntry?: { label?: string; updatedAt?: number };
  limit?: number;
}): CronSessionFallbackMessage[] {
  const parsed = parseCronSessionKey(params.sessionKey);
  if (!parsed) return [];

  const matchingRuns = params.runs
    .filter((entry) => {
      if (!parsed.runSessionId) return true;
      return entry.sessionId === parsed.runSessionId || entry.sessionKey === `${params.sessionKey}`;
    })
    .sort((a, b) => {
      const left = normalizeTimestampMs(a.ts) ?? normalizeTimestampMs(a.runAtMs) ?? 0;
      const right = normalizeTimestampMs(b.ts) ?? normalizeTimestampMs(b.runAtMs) ?? 0;
      return left - right;
    });

  const messages: CronSessionFallbackMessage[] = [];
  const prompt = params.job?.payload?.message || params.job?.payload?.text || '';
  const taskName = params.job?.name?.trim()
    || params.sessionEntry?.label?.replace(/^Cron:\s*/, '').trim()
    || '';
  const firstRelevantTimestamp = matchingRuns.length > 0
    ? (normalizeTimestampMs(matchingRuns[0]?.runAtMs) ?? normalizeTimestampMs(matchingRuns[0]?.ts))
    : (normalizeTimestampMs(params.job?.state?.runningAtMs) ?? params.sessionEntry?.updatedAt);

  if (taskName || prompt) {
    const lines = [taskName ? `Scheduled task: ${taskName}` : 'Scheduled task'];
    if (prompt) lines.push(`Prompt: ${prompt}`);
    messages.push({
      id: `cron-meta-${parsed.jobId}`,
      role: 'system',
      content: lines.join('\n'),
      timestamp: Math.max(0, (firstRelevantTimestamp ?? Date.now()) - 1),
    });
  }

  matchingRuns.forEach((entry, index) => {
    const message = buildCronRunMessage(entry, index);
    if (message) messages.push(message);
  });

  if (matchingRuns.length === 0) {
    const runningAt = normalizeTimestampMs(params.job?.state?.runningAtMs);
    if (runningAt) {
      messages.push({
        id: `cron-running-${parsed.jobId}`,
        role: 'system',
        content: 'This scheduled task is still running in OpenClaw, but no chat transcript is available yet.',
        timestamp: runningAt,
      });
    } else if (messages.length === 0) {
      messages.push({
        id: `cron-empty-${parsed.jobId}`,
        role: 'system',
        content: 'No chat transcript is available for this scheduled task yet.',
        timestamp: params.sessionEntry?.updatedAt ?? Date.now(),
      });
    }
  }

  const limit = typeof params.limit === 'number' && Number.isFinite(params.limit)
    ? Math.max(1, Math.floor(params.limit))
    : messages.length;
  return messages.slice(-limit);
}

function isBrowserAutomationRunResult(value: unknown): value is BrowserAutomationRunResult {
  return !!value
    && typeof value === 'object'
    && (value as { schemaVersion?: unknown }).schemaVersion === 1
    && typeof (value as { runId?: unknown }).runId === 'string'
    && ((value as { status?: unknown }).status === 'success' || (value as { status?: unknown }).status === 'failed');
}

function collectBrowserAutomationRuns(
  runs: CronRunLogEntry[],
  limit: number,
): BrowserAutomationRunResult[] {
  return runs
    .map((entry) => entry.browserAutomationResult)
    .filter(isBrowserAutomationRunResult)
    .slice(-limit);
}

function getUnsupportedCronDeliveryError(_channel: string | undefined): string | null {
  return null;
}

function normalizeCronDelivery(
  rawDelivery: unknown,
  fallbackMode: CronJobDelivery['mode'] = 'none',
): CronJobDelivery {
  if (!rawDelivery || typeof rawDelivery !== 'object') return { mode: fallbackMode };

  const delivery = rawDelivery as JsonRecord;
  const mode = delivery.mode === 'announce' ? 'announce' : fallbackMode;
  const channel = typeof delivery.channel === 'string' && delivery.channel.trim()
    ? toOpenClawChannelType(delivery.channel.trim())
    : undefined;
  const to = typeof delivery.to === 'string' && delivery.to.trim() ? delivery.to.trim() : undefined;
  const accountId = typeof delivery.accountId === 'string' && delivery.accountId.trim()
    ? delivery.accountId.trim()
    : undefined;

  if (mode === 'announce' && !channel) return { mode: 'none' };
  return {
    mode,
    ...(channel ? { channel } : {}),
    ...(to ? { to } : {}),
    ...(accountId ? { accountId } : {}),
  };
}

function normalizeCronSchedule(schedule: GatewayCronJob['schedule']): CronJob['schedule'] {
  if (schedule.kind === 'at' && typeof schedule.at === 'string') {
    return { kind: 'at', at: schedule.at };
  }
  if (schedule.kind === 'every' && typeof schedule.everyMs === 'number') {
    return {
      kind: 'every',
      everyMs: schedule.everyMs,
      ...(typeof (schedule as CronSchedule & { anchorMs?: unknown }).anchorMs === 'number'
        ? { anchorMs: (schedule as CronSchedule & { anchorMs: number }).anchorMs }
        : {}),
    };
  }
  if (schedule.kind === 'cron' && typeof schedule.expr === 'string') {
    return { kind: 'cron', expr: schedule.expr, ...(schedule.tz ? { tz: schedule.tz } : {}) };
  }
  return typeof schedule.expr === 'string' ? schedule.expr : '';
}

function normalizeCronDeliveryPatch(rawDelivery: unknown): Record<string, unknown> {
  if (!rawDelivery || typeof rawDelivery !== 'object') return {};

  const delivery = rawDelivery as JsonRecord;
  const patch: Record<string, unknown> = {};
  if ('mode' in delivery) {
    patch.mode = typeof delivery.mode === 'string' && delivery.mode.trim() ? delivery.mode.trim() : 'none';
  }
  if ('channel' in delivery) {
    patch.channel = typeof delivery.channel === 'string' && delivery.channel.trim()
      ? toOpenClawChannelType(delivery.channel.trim())
      : '';
  }
  if ('to' in delivery) patch.to = typeof delivery.to === 'string' ? delivery.to : '';
  if ('accountId' in delivery) patch.accountId = typeof delivery.accountId === 'string' ? delivery.accountId : '';
  return patch;
}

function buildCronUpdatePatch(input: Record<string, unknown>): Record<string, unknown> {
  const patch = { ...input };
  if (typeof patch.schedule === 'string') patch.schedule = { kind: 'cron', expr: patch.schedule };
  const payload = buildCronAgentPayload(patch as CronJobUpdateInput);
  if (payload) {
    patch.payload = payload;
    delete patch.message;
    delete patch.taskKind;
    delete patch.browserAutomation;
    delete patch.toolsAllow;
  }
  if ('delivery' in patch) patch.delivery = normalizeCronDeliveryPatch(patch.delivery);
  if ('agentId' in patch) {
    patch.agentId = typeof patch.agentId === 'string' && patch.agentId.trim() ? patch.agentId.trim() : 'main';
  }
  return patch;
}

function transformCronJob(job: GatewayCronJob, source: CronJobSource = 'gateway'): CronJob {
  const message = job.payload?.message || job.payload?.text || '';
  const browserAutomation = parseCronBrowserAutomationPrompt(message);
  const gatewayDelivery = normalizeCronDelivery(job.delivery);
  const channelType = gatewayDelivery.channel ? toUiChannelType(gatewayDelivery.channel) : undefined;
  const delivery = channelType ? { ...gatewayDelivery, channel: channelType } : gatewayDelivery;
  const target = channelType
    ? {
      channelType,
      channelId: delivery.accountId || gatewayDelivery.channel || channelType,
      channelName: channelType,
      recipient: delivery.to,
    }
    : undefined;
  const lastRun = job.state?.lastRunAtMs
    ? {
      time: new Date(job.state.lastRunAtMs).toISOString(),
      success: job.state.lastStatus === 'ok',
      error: job.state.lastError,
      duration: job.state.lastDurationMs,
    }
    : undefined;
  const nextRun = job.state?.nextRunAtMs ? new Date(job.state.nextRunAtMs).toISOString() : undefined;
  const agentId = (job as unknown as { agentId?: string }).agentId || 'main';

  return {
    id: job.id,
    name: job.name,
    message: browserAutomation?.config.objective || browserAutomation?.messageWithoutMarker || message,
    taskKind: browserAutomation ? 'browserAutomation' : 'agentTurn',
    ...(browserAutomation ? { browserAutomation: browserAutomation.config } : {}),
    ...(Array.isArray(job.payload?.toolsAllow) ? { toolsAllow: job.payload.toolsAllow } : {}),
    schedule: normalizeCronSchedule(job.schedule),
    source,
    runtime: {
      source,
      sessionTarget: job.sessionTarget || 'isolated',
      wakeMode: job.wakeMode || 'next-heartbeat',
      payloadKind: job.payload?.kind || 'agentTurn',
    },
    delivery,
    target,
    enabled: job.enabled,
    createdAt: new Date(job.createdAtMs).toISOString(),
    updatedAt: new Date(job.updatedAtMs).toISOString(),
    lastRun,
    nextRun,
    agentId,
    ...(job.repairDegraded ? { repairDegraded: true } : {}),
  };
}

async function listCronJobs(gatewayManager: GatewayManager): Promise<CronJob[]> {
  let jobs: GatewayCronJob[] = [];
  let usedFallback = false;

  try {
    const result = await gatewayManager.rpc('cron.list', { includeDisabled: true }, 8000);
    const data = result as { jobs?: GatewayCronJob[] };
    jobs = data?.jobs ?? (Array.isArray(result) ? result as GatewayCronJob[] : []);
  } catch {
    try {
      const cronJsonPath = join(getOpenClawConfigDir(), 'cron', 'cron.json');
      const raw = await readFile(cronJsonPath, 'utf-8');
      const parsed = JSON.parse(raw);
      jobs = (Array.isArray(parsed) ? parsed : (parsed?.jobs ?? [])) as GatewayCronJob[];
      usedFallback = true;
    } catch {
      // No fallback data available.
    }
  }

  if (!usedFallback && jobs.length > 0) {
    await repairCronJobs(gatewayManager, jobs);
  }

  return jobs.map((job) => transformCronJob(job, usedFallback ? 'config-fallback' : 'gateway'));
}

/**
 * Repair known gateway-side cron misconfigurations (announce delivery without
 * a channel, missing agentId). Each repair is an RPC round-trip: the local job
 * projection is only mutated AFTER the RPC succeeds. Failures leave the
 * gateway copy untouched and mark the job `repairDegraded` so the UI shows
 * the repair did not happen instead of a fake success.
 */
async function repairCronJobs(gatewayManager: GatewayManager, jobs: GatewayCronJob[]): Promise<void> {
  const jobsToRepairDelivery = jobs.filter((job) => {
    const isIsolatedAgent = (job.sessionTarget === 'isolated' || !job.sessionTarget)
      && job.payload?.kind === 'agentTurn';
    return isIsolatedAgent && job.delivery?.mode === 'announce' && !job.delivery?.channel;
  });

  await Promise.all(jobsToRepairDelivery.map(async (job) => {
    try {
      await gatewayManager.rpc('cron.update', {
        id: job.id,
        patch: { delivery: { mode: 'none' } },
      }, 8000);
      job.delivery = { mode: 'none' };
      if (job.state?.lastError?.includes('Channel is required')) {
        job.state.lastError = undefined;
        job.state.lastStatus = 'ok';
      }
    } catch (error) {
      job.repairDegraded = true;
      console.warn(`[cron] Failed to repair delivery for job "${job.id}":`, error);
    }
  }));

  const jobsToRepairAgent = jobs.filter((job) => {
    const jobAgentId = (job as unknown as { agentId?: string }).agentId;
    return (
      (job.sessionTarget === 'isolated' || !job.sessionTarget)
      && job.payload?.kind === 'agentTurn'
      && job.delivery?.mode === 'announce'
      && job.delivery?.channel
      && jobAgentId === undefined
    );
  });

  await Promise.all(jobsToRepairAgent.map(async (job) => {
    try {
      const channel = toOpenClawChannelType(job.delivery!.channel!);
      const accountId = job.delivery!.accountId;
      const toAddress = job.delivery!.to;
      let correctAgentId = await resolveAgentIdFromChannel(channel, accountId);
      let resolvedAccountId: string | null = null;
      if (!correctAgentId && !accountId && toAddress) {
        resolvedAccountId = await resolveAccountIdFromSessionHistory(toAddress, channel);
        if (resolvedAccountId) {
          correctAgentId = await resolveAgentIdFromChannel(channel, resolvedAccountId);
        }
      }
      if (correctAgentId) {
        const patch: Record<string, unknown> = { agentId: correctAgentId };
        if (resolvedAccountId && !accountId) patch.delivery = { accountId: resolvedAccountId };
        await gatewayManager.rpc('cron.update', { id: job.id, patch }, 8000);
        (job as unknown as { agentId: string }).agentId = correctAgentId;
        if (resolvedAccountId && !accountId && job.delivery) job.delivery.accountId = resolvedAccountId;
      }
    } catch (error) {
      job.repairDegraded = true;
      console.warn(`[cron] Failed to repair agentId for job "${job.id}":`, error);
    }
  }));
}

function getId(payload: unknown): string {
  const body = isRecord(payload) ? payload : {};
  const id = body.id;
  if (typeof id !== 'string' || !id.trim()) throw new Error('id is required');
  return id.trim();
}

export function createCronApi({ gatewayManager }: { gatewayManager: GatewayManager }): CompleteHostServiceRegistry['cron'] {
  return {
    list: async () => listCronJobs(gatewayManager),
    create: async (payload) => {
      await assertCronAllowedUnderSandbox('create');
      const input = payload;
      const agentId = typeof input.agentId === 'string' && input.agentId.trim() ? input.agentId.trim() : 'main';
      const delivery = normalizeCronDelivery(input.delivery);
      const unsupportedDeliveryError = getUnsupportedCronDeliveryError(delivery.channel);
      if (delivery.mode === 'announce' && unsupportedDeliveryError) {
        throw new Error(unsupportedDeliveryError);
      }
      const agentPayload = buildCronAgentPayload(input);
      if (!agentPayload) {
        throw new Error('Cron create requires a message or browser automation task');
      }
      const result = await gatewayManager.rpc('cron.add', {
        name: input.name,
        schedule: { kind: 'cron', expr: input.schedule },
        payload: agentPayload,
        enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
        wakeMode: 'next-heartbeat',
        sessionTarget: 'isolated',
        agentId,
        delivery,
      });
      if (!result || typeof result !== 'object') {
        throw new Error('Cron create returned an invalid job');
      }
      return transformCronJob(result as GatewayCronJob);
    },
    update: async (payload) => {
      await assertCronAllowedUnderSandbox('update');
      const body = payload;
      const id = getId(body);
      const input = isRecord(body.input) ? body.input : {};
      const patch = buildCronUpdatePatch(input);
      delete patch.id;
      delete patch.input;
      const deliveryPatch = patch.delivery && typeof patch.delivery === 'object'
        ? patch.delivery as Record<string, unknown>
        : undefined;
      const deliveryChannel = typeof deliveryPatch?.channel === 'string' && deliveryPatch.channel.trim()
        ? deliveryPatch.channel.trim()
        : undefined;
      const deliveryMode = typeof deliveryPatch?.mode === 'string' && deliveryPatch.mode.trim()
        ? deliveryPatch.mode.trim()
        : undefined;
      const unsupportedDeliveryError = getUnsupportedCronDeliveryError(deliveryChannel);
      if (unsupportedDeliveryError && deliveryMode !== 'none') {
        throw new Error(unsupportedDeliveryError);
      }
      const result = await gatewayManager.rpc('cron.update', { id, patch });
      if (!result || typeof result !== 'object') {
        throw new Error('Cron update returned an invalid job');
      }
      return transformCronJob(result as GatewayCronJob);
    },
    delete: async (payload) => {
      await assertCronAllowedUnderSandbox('delete');
      return gatewayManager.rpc('cron.remove', { id: getId(payload) });
    },
    toggle: async (payload) => {
      await assertCronAllowedUnderSandbox('toggle');
      const body = payload;
      return gatewayManager.rpc('cron.update', {
        id: getId(body),
        patch: { enabled: body.enabled === true },
      });
    },
    trigger: async (payload) => {
      await assertCronAllowedUnderSandbox('trigger');
      return gatewayManager.rpc('cron.run', { id: getId(payload), mode: 'force' });
    },
    sessionHistory: async (payload) => {
      const body = payload;
      const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : '';
      const parsedSession = parseCronSessionKey(sessionKey);
      if (!parsedSession) return { success: false, error: `Invalid cron sessionKey: ${sessionKey}` };

      const rawLimit = typeof body.limit === 'number' ? body.limit : Number(body.limit || 200);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 200) : 200;
      const [jobsResult, runs, sessionEntry] = await Promise.all([
        gatewayManager.rpc('cron.list', { includeDisabled: true }, 8000)
          .catch(() => ({ jobs: [] as GatewayCronJob[] })),
        readCronRunLog(gatewayManager, parsedSession.jobId),
        readSessionStoreEntry(parsedSession.agentId, sessionKey),
      ]);
      const jobs = (jobsResult as { jobs?: GatewayCronJob[] }).jobs ?? [];
      const job = jobs.find((item) => item.id === parsedSession.jobId);
      return {
        messages: buildCronSessionFallbackMessages({
          sessionKey,
          job,
          runs,
          sessionEntry: sessionEntry ? {
            label: typeof sessionEntry.label === 'string' ? sessionEntry.label : undefined,
            updatedAt: normalizeTimestampMs(sessionEntry.updatedAt),
          } : undefined,
          limit,
        }),
        browserAutomationRuns: collectBrowserAutomationRuns(runs, limit),
      };
    },
    deliveryTargets: async () => {
      try {
        const { readOpenClawConfig } = await import('../utils/channel-config');
        const config = await readOpenClawConfig();
        const channels = config.channels ?? {};
        const targets: DeliveryChannelGroup[] = [];
        for (const [channelType, section] of Object.entries(channels)) {
          if (!section || typeof section !== 'object') continue;
          const accounts = isRecord(section.accounts) ? section.accounts as Record<string, unknown> : {};
          const accountIds = Object.keys(accounts);
          if (accountIds.length === 0) continue;
          targets.push({
            channelType: toUiChannelType(channelType),
            defaultAccountId: accountIds[0],
            accounts: accountIds.map((accountId) => ({
              accountId,
              name: accountId,
              isDefault: accountId === accountIds[0],
            })),
          });
        }
        return { success: true, targets };
      } catch {
        // Config read failures degrade to empty target list, never throw.
        return { success: true, targets: [] };
      }
    },
  };
}
