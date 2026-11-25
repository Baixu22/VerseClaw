import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { isSensitiveUrlQueryParamName } from '../security/net-policy/redact-sensitive-url.ts';

export type AgentBrowserTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting-approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  /** Ephemeral run interrupted by process exit; recoverable via retry after restart. */
  | 'interrupted';

export type AgentBrowserTaskRecovery = {
  recoveredFrom: AgentBrowserTaskStatus;
  reason: 'app-restart-while-running';
  recoveredAt: string;
};

export type AgentBrowserTaskStepAction = 'navigate' | 'wait-for-selector' | 'click';
export type AgentBrowserTaskStepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'cancelled';
export type AgentBrowserTaskStepInput = {
  action: AgentBrowserTaskStepAction;
  url?: string;
  selector?: string;
  timeoutMs?: number;
};
export type AgentBrowserTaskStep = AgentBrowserTaskStepInput & {
  id: string;
  status: AgentBrowserTaskStepStatus;
  startedAt?: string;
  endedAt?: string;
  errorCode?: string;
  error?: string;
};
export type AgentBrowserTaskSuccessCriteria = {
  kind: 'url-includes' | 'text-includes' | 'selector-visible';
  value: string;
  timeoutMs?: number;
};
export type AgentBrowserTaskVerification = AgentBrowserTaskSuccessCriteria & {
  status: 'passed' | 'failed';
  reasonCode: string;
  message: string;
  checkedAt: string;
};
export type AgentBrowserTaskApproval = {
  status: 'pending' | 'approved' | 'consumed' | 'rejected';
  requestedAt: string;
  decidedAt?: string;
  consumedAt?: string;
};
export type AgentBrowserTaskCounters = {
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
};

export type AgentBrowserTask = {
  id: string;
  name: string;
  url: string;
  objective: string;
  successCondition?: string;
  profile: string;
  mode: 'headless' | 'visible';
  allowedDomains: string[];
  permissionScope: Array<'navigate' | 'read-page' | 'interact-page'>;
  steps: AgentBrowserTaskStep[];
  successCriteria?: AgentBrowserTaskSuccessCriteria;
  verification?: AgentBrowserTaskVerification;
  approval: AgentBrowserTaskApproval;
  counters: AgentBrowserTaskCounters;
  status: AgentBrowserTaskStatus;
  /** Human-readable status explanation (UI / restart recovery). */
  statusExplain?: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
  runId?: string;
  errorCode?: string;
  error?: string;
  recovery?: AgentBrowserTaskRecovery;
};

export type AgentBrowserTaskCreatePayload = Pick<
  AgentBrowserTask,
  'name' | 'url' | 'objective' | 'successCondition' | 'profile' | 'mode'
> & {
  allowedDomains?: string[];
  steps?: AgentBrowserTaskStepInput[];
  successCriteria?: AgentBrowserTaskSuccessCriteria;
  workspaceId?: string;
  sessionKey?: string;
  agentId?: string;
};

export type AgentBrowserTaskExecutionResult = {
  sessionId?: string;
  runId: string;
  steps: AgentBrowserTaskStep[];
  verification: AgentBrowserTaskVerification;
  counters: AgentBrowserTaskCounters;
};

export type AgentBrowserTaskProgress = Pick<AgentBrowserTask, 'steps' | 'counters'> & {
  sessionId?: string;
  runId?: string;
};

type TaskExecutor = (
  task: AgentBrowserTask,
  signal: AbortSignal,
  report: (progress: AgentBrowserTaskProgress) => void,
) => Promise<AgentBrowserTaskExecutionResult>;

export type AgentBrowserTaskServiceOptions = {
  execute: TaskExecutor;
  now?: () => Date;
  /** When set, tasks are persisted as JSON and recovered after process restart. */
  storagePath?: string;
};

type TaskStoreFile = {
  version: 2;
  tasks: AgentBrowserTask[];
};

const EPHEMERAL_ON_RESTART: ReadonlySet<AgentBrowserTaskStatus> = new Set(['running']);

/** States where the run has ended: a late cancel must not rewrite the recorded outcome. */
const TERMINAL_TASK_STATUSES: ReadonlySet<AgentBrowserTaskStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);
// C96/TF-0123: the local anchored list keeps the extras this guard has always had (`key`,
// `sig`, `signature`) while the canonical URL check adds the network-alias names it was
// missing. Measured 2026-10-14: private_key / cookie / csrf / xsrf / passwd /
// auth_token were accepted and kept in the stored task URL.
const SENSITIVE_QUERY_KEY = /^(?:access[_-]?token|api[_-]?key|authorization|auth|credential|key|password|passwd|secret|session|sig|signature|token|otp|pin)$/i;

function cloneTask(task: AgentBrowserTask): AgentBrowserTask {
  return {
    ...task,
    allowedDomains: [...task.allowedDomains],
    permissionScope: [...task.permissionScope],
    steps: task.steps.map((step) => ({ ...step })),
    successCriteria: task.successCriteria ? { ...task.successCriteria } : undefined,
    verification: task.verification ? { ...task.verification } : undefined,
    approval: { ...task.approval },
    counters: { ...task.counters },
    recovery: task.recovery ? { ...task.recovery } : undefined,
  };
}

function normalizeTaskUrl(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error('Agent browser task URL is required');
  const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Agent browser task URL must use http or https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Agent browser task URL must not contain credentials; use Vault references');
  }
  for (const key of parsed.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEY.test(key) || isSensitiveUrlQueryParamName(key)) {
      throw new Error(`Agent browser task URL must not contain sensitive query parameter: ${key}`);
    }
  }
  parsed.hash = '';
  return parsed.toString();
}

function normalizeContextValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, 200) : undefined;
}

function normalizeDomain(value: string): string {
  const raw = value.trim().toLowerCase().replace(/^\*\./, '');
  if (!raw || raw.includes('/') || raw.includes(':') || raw === '*') {
    throw new Error(`Invalid agent browser allowed domain: ${value}`);
  }
  return raw.replace(/\.$/, '');
}

function normalizeAllowedDomains(url: string, values?: string[]): string[] {
  const initialHostname = new URL(url).hostname.toLowerCase();
  const domains = [...new Set((values?.length ? values : [initialHostname]).map(normalizeDomain))];
  const initialAllowed = domains.some((domain) => initialHostname === domain || initialHostname.endsWith(`.${domain}`));
  if (!initialAllowed) {
    throw new Error(`Initial task host is outside allowed domains: ${initialHostname}`);
  }
  return domains;
}

function normalizeTimeoutMs(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) throw new Error('Agent browser task timeout must be finite');
  return Math.min(30_000, Math.max(250, Math.round(value)));
}

function normalizeSuccessCriteria(
  criteria: AgentBrowserTaskSuccessCriteria | undefined,
  legacy: string | undefined,
): AgentBrowserTaskSuccessCriteria | undefined {
  const source = criteria ?? (legacy?.trim() ? { kind: 'text-includes' as const, value: legacy } : undefined);
  if (!source) return undefined;
  const value = source.value.trim();
  if (!value) throw new Error('Agent browser success criteria value is required');
  return { kind: source.kind, value, ...(normalizeTimeoutMs(source.timeoutMs) ? { timeoutMs: normalizeTimeoutMs(source.timeoutMs) } : {}) };
}

const TASK_STEP_ACTIONS: ReadonlySet<string> = new Set(['navigate', 'wait-for-selector', 'click']);

function normalizeSteps(url: string, inputs: AgentBrowserTaskStepInput[] | undefined): AgentBrowserTaskStep[] {
  const steps: AgentBrowserTaskStepInput[] = [{ action: 'navigate', url }];
  for (const input of inputs ?? []) {
    // A runtime caller (host IPC / JSON) is not bound by the TS union, and the executor used to
    // treat any action outside its three branches as a successful no-op - a typo'd step came back
    // `passed`. Reject it at creation instead of storing a step nothing can execute.
    if (!TASK_STEP_ACTIONS.has(input.action)) {
      throw new Error(`Agent browser task step action is unknown: ${String(input.action)}`);
    }
    if (input.action === 'navigate') {
      steps.push({ action: input.action, url: normalizeTaskUrl(input.url ?? '') });
      continue;
    }
    const selector = input.selector?.trim();
    if (!selector) throw new Error(`Agent browser ${input.action} step requires a selector`);
    steps.push({ action: input.action, selector, ...(normalizeTimeoutMs(input.timeoutMs) ? { timeoutMs: normalizeTimeoutMs(input.timeoutMs) } : {}) });
  }
  if (steps.length > 20) throw new Error('Agent browser task supports at most 20 steps');
  return steps.map((step, index) => ({ ...step, id: `step-${index + 1}`, status: 'pending' }));
}

function permissionScopeFor(steps: AgentBrowserTaskStep[], criteria?: AgentBrowserTaskSuccessCriteria): AgentBrowserTask['permissionScope'] {
  const scope = new Set<AgentBrowserTask['permissionScope'][number]>(['navigate']);
  if (steps.some((step) => step.action === 'wait-for-selector') || criteria?.kind !== 'url-includes') scope.add('read-page');
  if (steps.some((step) => step.action === 'click')) scope.add('interact-page');
  return [...scope];
}

function countersFor(steps: AgentBrowserTaskStep[]): AgentBrowserTaskCounters {
  return {
    totalSteps: steps.length,
    passedSteps: steps.filter((step) => step.status === 'passed').length,
    failedSteps: steps.filter((step) => step.status === 'failed').length,
  };
}

function resetSteps(steps: AgentBrowserTaskStep[]): AgentBrowserTaskStep[] {
  return steps.map((step) => ({
    id: step.id,
    action: step.action,
    ...(step.url ? { url: step.url } : {}),
    ...(step.selector ? { selector: step.selector } : {}),
    ...(step.timeoutMs ? { timeoutMs: step.timeoutMs } : {}),
    status: 'pending',
  }));
}

function errorCodeFor(error: unknown): string {
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }
  return 'TASK_EXECUTION_FAILED';
}

function statusExplainFor(status: AgentBrowserTaskStatus, error?: string): string {
  switch (status) {
    case 'queued':
      return 'Queued; waiting to start.';
    case 'running':
      return 'Running in the current process.';
    case 'waiting-approval':
      return 'Paused for user approval before continuing.';
    case 'paused':
      return 'Paused by user; resume to re-queue.';
    case 'completed':
      return 'Completed successfully.';
    case 'failed':
      return error ? `Failed: ${error}` : 'Failed.';
    case 'cancelled':
      return 'Cancelled by user.';
    case 'interrupted':
      return error
        ?? 'Interrupted by app restart while running; review and retry if needed.';
    default:
      return String(status);
  }
}

/** Recover persisted tasks after process restart so status remains explainable. */
export function recoverTasksAfterRestart(
  tasks: AgentBrowserTask[],
  recoveredAt: string,
): AgentBrowserTask[] {
  return tasks.map((task) => {
    if (!EPHEMERAL_ON_RESTART.has(task.status)) {
      return {
        ...task,
        statusExplain: task.statusExplain ?? statusExplainFor(task.status, task.error),
      };
    }
    const recoveredFrom = task.status;
    const error = 'Interrupted by app restart while task was running';
    return {
      ...task,
      status: 'interrupted',
      error,
      statusExplain: statusExplainFor('interrupted', error),
      sessionId: undefined,
      runId: undefined,
      recovery: {
        recoveredFrom,
        reason: 'app-restart-while-running',
        recoveredAt,
      },
      updatedAt: recoveredAt,
    };
  });
}

export class AgentBrowserTaskService {
  private readonly tasks = new Map<string, AgentBrowserTask>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly execute: TaskExecutor;
  private readonly now: () => Date;
  private readonly storagePath?: string;

  constructor(options: AgentBrowserTaskServiceOptions) {
    this.execute = options.execute;
    this.now = options.now ?? (() => new Date());
    this.storagePath = options.storagePath;
    if (this.storagePath) {
      this.loadFromDisk();
    }
  }

  list(): AgentBrowserTask[] {
    return [...this.tasks.values()].map(cloneTask);
  }

  get(taskId: string): AgentBrowserTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Agent browser task not found: ${taskId}`);
    return cloneTask(task);
  }

  create(payload: AgentBrowserTaskCreatePayload): AgentBrowserTask {
    const timestamp = this.now().toISOString();
    const name = payload.name.trim();
    const objective = payload.objective.trim();
    const profile = payload.profile.trim().toLowerCase();
    if (!name) throw new Error('Agent browser task name is required');
    if (!objective) throw new Error('Agent browser task objective is required');
    if (!profile || !/^[a-z0-9._-]+$/.test(profile)) throw new Error('Agent browser task profile is invalid');
    if (payload.mode !== 'headless' && payload.mode !== 'visible') throw new Error('Agent browser task mode is invalid');
    const url = normalizeTaskUrl(payload.url);
    const allowedDomains = normalizeAllowedDomains(url, payload.allowedDomains);
    const successCriteria = normalizeSuccessCriteria(payload.successCriteria, payload.successCondition);
    const steps = normalizeSteps(url, payload.steps);
    const workspaceId = normalizeContextValue(payload.workspaceId);
    const sessionKey = normalizeContextValue(payload.sessionKey);
    const agentId = normalizeContextValue(payload.agentId);
    const task: AgentBrowserTask = {
      ...payload,
      name,
      url,
      objective,
      profile,
      allowedDomains,
      steps,
      successCriteria,
      permissionScope: permissionScopeFor(steps, successCriteria),
      approval: { status: 'pending', requestedAt: timestamp },
      counters: countersFor(steps),
      id: randomUUID(),
      status: 'waiting-approval',
      statusExplain: statusExplainFor('waiting-approval'),
      retryCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(workspaceId ? { workspaceId } : {}),
      ...(sessionKey ? { sessionKey } : {}),
      ...(agentId ? { agentId } : {}),
    };
    this.tasks.set(task.id, task);
    this.persist();
    return cloneTask(task);
  }

  async run(taskId: string): Promise<AgentBrowserTask> {
    const task = this.require(taskId);
    if (task.status === 'running') return cloneTask(task);
    if (task.status === 'waiting-approval') {
      throw new Error('Task is waiting for approval; approve before run');
    }
    if (task.status !== 'queued' || task.approval.status !== 'approved') {
      throw new Error('Task does not have an unused approval for this run');
    }
    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    const runId = randomUUID();
    const steps = resetSteps(task.steps);
    this.update(task, {
      status: 'running',
      runId,
      steps,
      counters: countersFor(steps),
      approval: { ...task.approval, status: 'consumed', consumedAt: this.now().toISOString() },
      verification: undefined,
      errorCode: undefined,
      error: undefined,
      statusExplain: statusExplainFor('running'),
      recovery: undefined,
    });
    try {
      const result = await this.execute(cloneTask(task), controller.signal, (progress) => {
        if (!this.isRunning(taskId, runId)) return;
        this.update(task, {
          ...progress,
          runId,
          steps: progress.steps.map((step) => ({ ...step })),
          counters: { ...progress.counters },
        });
      });
      if (this.isRunning(taskId, runId)) {
        const passed = result.verification.status === 'passed';
        const error = passed ? undefined : result.verification.message;
        this.update(task, {
          ...result,
          runId,
          status: passed ? 'completed' : 'failed',
          statusExplain: statusExplainFor(passed ? 'completed' : 'failed', error),
          errorCode: passed ? undefined : result.verification.reasonCode,
          error,
        });
      }
    } catch (error) {
      if (this.isRunning(taskId, runId)) {
        const message = error instanceof Error ? error.message : String(error);
        this.update(task, {
          status: 'failed',
          errorCode: errorCodeFor(error),
          error: message,
          statusExplain: statusExplainFor('failed', message),
        });
      }
    } finally {
      if (this.controllers.get(taskId) === controller) this.controllers.delete(taskId);
    }
    return cloneTask(task);
  }

  cancel(taskId: string): AgentBrowserTask {
    const task = this.require(taskId);
    // A blanket/late cancel used to overwrite *any* status, so cancelling a finished task rewrote a
    // recorded outcome (`completed` -> `cancelled`) and moved it into the retryable set - unlocking
    // `retry` for a run that had already succeeded. Nothing is left to stop once the run has ended,
    // so report the task as-is instead of rewriting history.
    if (TERMINAL_TASK_STATUSES.has(task.status)) return cloneTask(task);
    this.update(task, {
      status: 'cancelled',
      statusExplain: statusExplainFor('cancelled'),
    });
    this.controllers.get(taskId)?.abort();
    return cloneTask(task);
  }

  pause(taskId: string): AgentBrowserTask {
    const task = this.require(taskId);
    // Same lifecycle rule as cancel(): a run that has ended cannot be paused. Overwriting a
    // completed task with 'paused' also cleared the path back to it (resume() re-queues), so a
    // finished run could be walked back into the approval gate and re-executed.
    if (TERMINAL_TASK_STATUSES.has(task.status)) return cloneTask(task);
    this.update(task, {
      status: 'paused',
      statusExplain: statusExplainFor('paused'),
    });
    this.controllers.get(taskId)?.abort();
    return cloneTask(task);
  }

  resume(taskId: string): AgentBrowserTask {
    const task = this.require(taskId);
    // Only a run that was paused before starting may resume. A terminal task (completed / failed /
    // cancelled / interrupted) must not be resurrected: resume() used to set `waiting-approval` for
    // *any* status, so a finished run could be approved and executed a second time. Retrying a
    // failed/cancelled/interrupted run is what retry() is for, and it is the only route back.
    if (task.status !== 'paused') {
      throw new Error('Only a paused task can resume; use retry for failed, cancelled, or interrupted tasks');
    }
    const timestamp = this.now().toISOString();
    this.update(task, {
      status: 'waiting-approval',
      statusExplain: statusExplainFor('waiting-approval'),
      approval: { status: 'pending', requestedAt: timestamp },
      error: undefined,
    });
    return cloneTask(task);
  }

  waitForApproval(taskId: string): AgentBrowserTask {
    const task = this.require(taskId);
    if (task.status === 'waiting-approval') return cloneTask(task);
    if (task.status !== 'queued' && task.status !== 'paused') {
      throw new Error('Only queued or paused tasks can request approval');
    }
    const timestamp = this.now().toISOString();
    this.update(task, {
      status: 'waiting-approval',
      statusExplain: statusExplainFor('waiting-approval'),
      approval: { status: 'pending', requestedAt: timestamp },
    });
    return cloneTask(task);
  }

  /** Explicit user approval gate: leave waiting-approval and re-queue. */
  approve(taskId: string): AgentBrowserTask {
    const task = this.require(taskId);
    if (task.status !== 'waiting-approval') {
      throw new Error('Only tasks waiting for approval can be approved');
    }
    this.update(task, {
      status: 'queued',
      statusExplain: statusExplainFor('queued'),
      approval: { ...task.approval, status: 'approved', decidedAt: this.now().toISOString() },
    });
    return cloneTask(task);
  }

  async approveAndRun(taskId: string): Promise<AgentBrowserTask> {
    this.approve(taskId);
    return await this.run(taskId);
  }

  reject(taskId: string): AgentBrowserTask {
    const task = this.require(taskId);
    if (task.status !== 'waiting-approval') {
      throw new Error('Only tasks waiting for approval can be rejected');
    }
    this.update(task, {
      status: 'cancelled',
      statusExplain: statusExplainFor('cancelled'),
      approval: { ...task.approval, status: 'rejected', decidedAt: this.now().toISOString() },
      errorCode: 'APPROVAL_REJECTED',
      error: 'Task was rejected before browser execution',
    });
    return cloneTask(task);
  }

  async retry(taskId: string): Promise<AgentBrowserTask> {
    const task = this.require(taskId);
    if (task.status !== 'failed' && task.status !== 'cancelled' && task.status !== 'interrupted') {
      throw new Error('Only failed, cancelled, or interrupted browser tasks can be retried');
    }
    this.update(task, {
      status: 'waiting-approval',
      statusExplain: statusExplainFor('waiting-approval'),
      approval: { status: 'pending', requestedAt: this.now().toISOString() },
      retryCount: task.retryCount + 1,
      steps: resetSteps(task.steps),
      counters: countersFor(resetSteps(task.steps)),
      verification: undefined,
      errorCode: undefined,
      error: undefined,
      sessionId: undefined,
      runId: undefined,
      recovery: undefined,
    });
    return cloneTask(task);
  }

  private require(taskId: string): AgentBrowserTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Agent browser task not found: ${taskId}`);
    return task;
  }

  /**
   * Late callbacks may settle after retry has started a new run of the same task.
   */
  private isRunning(taskId: string, runId: string): boolean {
    const task = this.tasks.get(taskId);
    return task?.status === 'running' && task.runId === runId;
  }

  private update(task: AgentBrowserTask, patch: Partial<AgentBrowserTask>): void {
    Object.assign(task, patch, { updatedAt: this.now().toISOString() });
    this.persist();
  }

  private loadFromDisk(): void {
    if (!this.storagePath || !existsSync(this.storagePath)) return;
    try {
      const raw = readFileSync(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<TaskStoreFile>;
      const list = Array.isArray(parsed.tasks) ? parsed.tasks : [];
      const recoveredAt = this.now().toISOString();
      const migrated = list.map((stored) => {
        const url = normalizeTaskUrl(stored.url);
        const steps = Array.isArray(stored.steps) && stored.steps.length > 0
          ? stored.steps.map((step, index) => ({ ...step, id: step.id || `step-${index + 1}`, status: step.status ?? 'pending' }))
          : normalizeSteps(url, []);
        const successCriteria = normalizeSuccessCriteria(stored.successCriteria, stored.successCondition);
        const waiting = stored.status === 'queued' ? 'waiting-approval' : stored.status;
        return {
          ...stored,
          url,
          status: waiting,
          allowedDomains: normalizeAllowedDomains(url, stored.allowedDomains),
          steps,
          successCriteria,
          permissionScope: stored.permissionScope ?? permissionScopeFor(steps, successCriteria),
          approval: stored.approval ?? {
            status: waiting === 'waiting-approval' ? 'pending' : 'consumed',
            requestedAt: stored.createdAt,
          },
          counters: countersFor(steps),
        } satisfies AgentBrowserTask;
      });
      const recovered = recoverTasksAfterRestart(migrated, recoveredAt);
      this.tasks.clear();
      for (const task of recovered) {
        this.tasks.set(task.id, task);
      }
      // Persist recovered statuses so a second restart does not re-apply from running.
      this.persist();
    } catch (error) {
      // Fail-closed: do not wipe store on corrupt read; surface via empty map + log-friendly throw on next write.
      throw new Error(
        `Agent browser task store could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  private persist(): void {
    if (!this.storagePath) return;
    const file: TaskStoreFile = {
      version: 2,
      tasks: this.list(),
    };
    mkdirSync(dirname(this.storagePath), { recursive: true });
    writeFileSync(this.storagePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  }
}
