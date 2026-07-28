import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

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

export type AgentBrowserTask = {
  id: string;
  name: string;
  url: string;
  objective: string;
  successCondition?: string;
  profile: string;
  mode: 'headless' | 'visible';
  allowedDomains?: string[];
  status: AgentBrowserTaskStatus;
  /** Human-readable status explanation (UI / restart recovery). */
  statusExplain?: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
  runId?: string;
  error?: string;
  recovery?: AgentBrowserTaskRecovery;
};

export type AgentBrowserTaskCreatePayload = Pick<
  AgentBrowserTask,
  'name' | 'url' | 'objective' | 'successCondition' | 'profile' | 'mode' | 'allowedDomains'
>;

type TaskExecutor = (
  task: AgentBrowserTask,
  signal: AbortSignal,
) => Promise<{ sessionId?: string; runId?: string }>;

export type AgentBrowserTaskServiceOptions = {
  execute: TaskExecutor;
  now?: () => Date;
  /** When set, tasks are persisted as JSON and recovered after process restart. */
  storagePath?: string;
};

type TaskStoreFile = {
  version: 1;
  tasks: AgentBrowserTask[];
};

const EPHEMERAL_ON_RESTART: ReadonlySet<AgentBrowserTaskStatus> = new Set(['running']);

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
    return [...this.tasks.values()].map((task) => ({ ...task }));
  }

  get(taskId: string): AgentBrowserTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Agent browser task not found: ${taskId}`);
    return { ...task };
  }

  create(payload: AgentBrowserTaskCreatePayload): AgentBrowserTask {
    const timestamp = this.now().toISOString();
    const task: AgentBrowserTask = {
      ...payload,
      id: randomUUID(),
      status: 'queued',
      statusExplain: statusExplainFor('queued'),
      retryCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.tasks.set(task.id, task);
    this.persist();
    return { ...task };
  }

  async run(taskId: string): Promise<AgentBrowserTask> {
    const task = this.require(taskId);
    if (task.status === 'running') return { ...task };
    if (task.status === 'waiting-approval') {
      throw new Error('Task is waiting for approval; approve before run');
    }
    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    this.update(task, {
      status: 'running',
      error: undefined,
      statusExplain: statusExplainFor('running'),
      recovery: undefined,
    });
    try {
      const result = await this.execute({ ...task }, controller.signal);
      if (task.status !== 'cancelled') {
        this.update(task, {
          status: 'completed',
          statusExplain: statusExplainFor('completed'),
          ...result,
        });
      }
    } catch (error) {
      if (task.status !== 'cancelled') {
        const message = error instanceof Error ? error.message : String(error);
        this.update(task, {
          status: 'failed',
          error: message,
          statusExplain: statusExplainFor('failed', message),
        });
      }
    } finally {
      this.controllers.delete(taskId);
    }
    return { ...task };
  }

  cancel(taskId: string): AgentBrowserTask {
    const task = this.require(taskId);
    this.update(task, {
      status: 'cancelled',
      statusExplain: statusExplainFor('cancelled'),
    });
    this.controllers.get(taskId)?.abort();
    return { ...task };
  }

  pause(taskId: string): AgentBrowserTask {
    const task = this.require(taskId);
    this.update(task, {
      status: 'paused',
      statusExplain: statusExplainFor('paused'),
    });
    return { ...task };
  }

  resume(taskId: string): AgentBrowserTask {
    const task = this.require(taskId);
    this.update(task, {
      status: 'queued',
      statusExplain: statusExplainFor('queued'),
      error: undefined,
    });
    return { ...task };
  }

  waitForApproval(taskId: string): AgentBrowserTask {
    const task = this.require(taskId);
    this.update(task, {
      status: 'waiting-approval',
      statusExplain: statusExplainFor('waiting-approval'),
    });
    return { ...task };
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
    });
    return { ...task };
  }

  async retry(taskId: string): Promise<AgentBrowserTask> {
    const task = this.require(taskId);
    if (task.status !== 'failed' && task.status !== 'cancelled' && task.status !== 'interrupted') {
      throw new Error('Only failed, cancelled, or interrupted browser tasks can be retried');
    }
    this.update(task, {
      status: 'queued',
      statusExplain: statusExplainFor('queued'),
      retryCount: task.retryCount + 1,
      error: undefined,
      sessionId: undefined,
      runId: undefined,
      recovery: undefined,
    });
    return await this.run(taskId);
  }

  private require(taskId: string): AgentBrowserTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Agent browser task not found: ${taskId}`);
    return task;
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
      const recovered = recoverTasksAfterRestart(list, recoveredAt);
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
      version: 1,
      tasks: this.list(),
    };
    mkdirSync(dirname(this.storagePath), { recursive: true });
    writeFileSync(this.storagePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  }
}
