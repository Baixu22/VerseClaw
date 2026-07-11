import { randomUUID } from 'node:crypto';

export type AgentBrowserTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting-approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

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
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
  runId?: string;
  error?: string;
};

export type AgentBrowserTaskCreatePayload = Pick<
  AgentBrowserTask,
  'name' | 'url' | 'objective' | 'successCondition' | 'profile' | 'mode' | 'allowedDomains'
>;

type TaskExecutor = (
  task: AgentBrowserTask,
  signal: AbortSignal,
) => Promise<{ sessionId?: string; runId?: string }>;

export class AgentBrowserTaskService {
  private readonly tasks = new Map<string, AgentBrowserTask>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly execute: TaskExecutor;
  private readonly now: () => Date;

  constructor(options: { execute: TaskExecutor; now?: () => Date }) {
    this.execute = options.execute;
    this.now = options.now ?? (() => new Date());
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
      retryCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.tasks.set(task.id, task);
    return { ...task };
  }

  async run(taskId: string): Promise<AgentBrowserTask> {
    const task = this.require(taskId);
    if (task.status === 'running') return { ...task };
    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    this.update(task, { status: 'running', error: undefined });
    try {
      const result = await this.execute({ ...task }, controller.signal);
      if (task.status !== 'cancelled') {
        this.update(task, { status: 'completed', ...result });
      }
    } catch (error) {
      if (task.status !== 'cancelled') {
        this.update(task, {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      this.controllers.delete(taskId);
    }
    return { ...task };
  }

  cancel(taskId: string): AgentBrowserTask {
    const task = this.require(taskId);
    this.update(task, { status: 'cancelled' });
    this.controllers.get(taskId)?.abort();
    return { ...task };
  }

  pause(taskId: string): AgentBrowserTask {
    const task = this.require(taskId);
    this.update(task, { status: 'paused' });
    return { ...task };
  }

  resume(taskId: string): AgentBrowserTask {
    const task = this.require(taskId);
    this.update(task, { status: 'queued' });
    return { ...task };
  }

  waitForApproval(taskId: string): AgentBrowserTask {
    const task = this.require(taskId);
    this.update(task, { status: 'waiting-approval' });
    return { ...task };
  }

  async retry(taskId: string): Promise<AgentBrowserTask> {
    const task = this.require(taskId);
    if (task.status !== 'failed' && task.status !== 'cancelled') {
      throw new Error('Only failed or cancelled browser tasks can be retried');
    }
    this.update(task, {
      status: 'queued',
      retryCount: task.retryCount + 1,
      error: undefined,
      sessionId: undefined,
      runId: undefined,
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
  }
}
