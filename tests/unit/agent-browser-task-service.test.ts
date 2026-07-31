import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AgentBrowserTaskService,
  recoverTasksAfterRestart,
  type AgentBrowserTask,
} from '@electron/services/agent-browser-task-service';

function passedExecution(task: AgentBrowserTask, runId = 'run-1') {
  const steps = task.steps.map((step) => ({ ...step, status: 'passed' as const }));
  const successCriteria = task.successCriteria ?? { kind: 'text-includes' as const, value: 'ok' };
  return {
    sessionId: 'session-1',
    runId,
    steps,
    counters: { totalSteps: steps.length, passedSteps: steps.length, failedSteps: 0 },
    verification: {
      ...successCriteria,
      status: 'passed' as const,
      reasonCode: 'SUCCESS_CRITERIA_MET',
      message: 'Success criteria met',
      checkedAt: '2026-07-29T10:00:00.000Z',
    },
  };
}

describe('agent browser task service', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  async function tempDir(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'agent-browser-tasks-'));
    tempRoots.push(root);
    return root;
  }

  it('runs a task through queued -> running -> completed', async () => {
    const execute = vi.fn(async (task: AgentBrowserTask) => passedExecution(task));
    const service = new AgentBrowserTaskService({ execute });
    const task = service.create({
      name: 'Checkout docs',
      url: 'https://example.com',
      objective: 'Open docs',
      profile: 'default',
      mode: 'headless',
    });

    expect(task.status).toBe('waiting-approval');
    service.approve(task.id);
    await expect(service.run(task.id)).resolves.toMatchObject({
      status: 'completed',
      sessionId: 'session-1',
      runId: 'run-1',
      statusExplain: 'Completed successfully.',
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('cancels an in-flight task and aborts the executor', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const execute = vi.fn(async (currentTask: AgentBrowserTask, signal: AbortSignal) => {
      await new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        void gate.then(() => resolve());
      });
      return passedExecution(currentTask);
    });
    const service = new AgentBrowserTaskService({ execute });
    const task = service.create({
      name: 'Long task',
      url: 'https://example.com',
      objective: 'Wait',
      profile: 'default',
      mode: 'headless',
    });
    service.approve(task.id);
    const running = service.run(task.id);
    service.cancel(task.id);
    finish();
    await running;

    expect(service.get(task.id).status).toBe('cancelled');
  });

  it('retries failed tasks with a clean queued lifecycle', async () => {
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockImplementationOnce(async (currentTask: AgentBrowserTask) => passedExecution(currentTask, 'run-2'));
    const service = new AgentBrowserTaskService({ execute });
    const task = service.create({
      name: 'Retry task',
      url: 'https://example.com',
      objective: 'Read',
      profile: 'default',
      mode: 'headless',
    });
    service.approve(task.id);
    await service.run(task.id);
    expect(service.get(task.id)).toMatchObject({ status: 'failed', error: 'temporary failure' });

    await expect(service.retry(task.id)).resolves.toMatchObject({
      status: 'waiting-approval',
      retryCount: 1,
    });
    service.approve(task.id);
    await expect(service.run(task.id)).resolves.toMatchObject({ status: 'completed', runId: 'run-2' });
  });

  it('approval gate: waitForApproval blocks run until approve', async () => {
    const execute = vi.fn(async (currentTask: AgentBrowserTask) => passedExecution(currentTask, 'run-ok'));
    const service = new AgentBrowserTaskService({ execute });
    const task = service.create({
      name: 'Needs approval',
      url: 'https://example.com',
      objective: 'Gate',
      profile: 'default',
      mode: 'headless',
    });
    const waiting = service.waitForApproval(task.id);
    expect(waiting).toMatchObject({
      status: 'waiting-approval',
      statusExplain: 'Paused for user approval before continuing.',
    });
    await expect(service.run(task.id)).rejects.toThrow('waiting for approval');
    expect(service.approve(task.id)).toMatchObject({ status: 'queued' });
    await expect(service.run(task.id)).resolves.toMatchObject({ status: 'completed', runId: 'run-ok' });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('approve rejects non-waiting tasks', () => {
    const service = new AgentBrowserTaskService({ execute: async (task) => passedExecution(task) });
    const task = service.create({
      name: 'No gate',
      url: 'https://example.com',
      objective: 'x',
      profile: 'default',
      mode: 'headless',
    });
    service.approve(task.id);
    expect(() => service.approve(task.id)).toThrow('waiting for approval');
  });

  it('persists tasks and recovers running as interrupted with explainable status', async () => {
    const root = await tempDir();
    const storagePath = join(root, 'tasks.json');
    const execute = vi.fn(async (task: AgentBrowserTask) => passedExecution(task, 'never'));
    const serviceA = new AgentBrowserTaskService({
      execute,
      storagePath,
      now: () => new Date('2026-07-19T10:00:00.000Z'),
    });
    const created = serviceA.create({
      name: 'Persist me',
      url: 'https://example.com/docs',
      objective: 'Stay running across restart',
      profile: 'default',
      mode: 'headless',
    });

    // Simulate crash while running by writing a running snapshot after create.
    const disk = JSON.parse(await readFile(storagePath, 'utf8')) as { version: 2; tasks: AgentBrowserTask[] };
    disk.tasks = disk.tasks.map((t) =>
      t.id === created.id
        ? {
            ...t,
            status: 'running' as const,
            statusExplain: 'Running in the current process.',
            sessionId: 'sess-live',
            runId: 'run-live',
            updatedAt: '2026-07-19T10:00:01.000Z',
          }
        : t,
    );
    await writeFile(storagePath, `${JSON.stringify(disk, null, 2)}\n`, 'utf8');

    const serviceB = new AgentBrowserTaskService({
      execute,
      storagePath,
      now: () => new Date('2026-07-19T10:05:00.000Z'),
    });
    const recovered = serviceB.get(created.id);
    expect(recovered).toMatchObject({
      status: 'interrupted',
      sessionId: undefined,
      runId: undefined,
      recovery: {
        recoveredFrom: 'running',
        reason: 'app-restart-while-running',
        recoveredAt: '2026-07-19T10:05:00.000Z',
      },
    });
    expect(recovered.statusExplain).toMatch(/Interrupted by app restart/i);
    expect(recovered.error).toMatch(/Interrupted by app restart/i);

    // Second load must not re-apply recovery from running.
    const serviceC = new AgentBrowserTaskService({
      execute,
      storagePath,
      now: () => new Date('2026-07-19T10:06:00.000Z'),
    });
    expect(serviceC.get(created.id).status).toBe('interrupted');
    expect(serviceC.get(created.id).recovery?.recoveredAt).toBe('2026-07-19T10:05:00.000Z');

    await expect(serviceC.retry(created.id)).resolves.toMatchObject({
      status: 'waiting-approval',
      retryCount: 1,
    });
    serviceC.approve(created.id);
    await expect(serviceC.run(created.id)).resolves.toMatchObject({ status: 'completed' });
  });

  it('recoverTasksAfterRestart leaves waiting-approval explainable and does not clear it', () => {
    const tasks: AgentBrowserTask[] = [
      {
        id: 't1',
        name: 'Wait',
        url: 'https://example.com',
        objective: 'o',
        profile: 'default',
        mode: 'headless',
        status: 'waiting-approval',
        retryCount: 0,
        createdAt: '2026-07-19T10:00:00.000Z',
        updatedAt: '2026-07-19T10:00:00.000Z',
      },
      {
        id: 't2',
        name: 'Run',
        url: 'https://example.com',
        objective: 'o',
        profile: 'default',
        mode: 'headless',
        status: 'running',
        retryCount: 0,
        createdAt: '2026-07-19T10:00:00.000Z',
        updatedAt: '2026-07-19T10:00:00.000Z',
        sessionId: 's1',
      },
    ];
    const recovered = recoverTasksAfterRestart(tasks, '2026-07-19T11:00:00.000Z');
    expect(recovered[0]).toMatchObject({
      status: 'waiting-approval',
      statusExplain: 'Paused for user approval before continuing.',
    });
    expect(recovered[1]).toMatchObject({
      status: 'interrupted',
      recovery: { recoveredFrom: 'running', reason: 'app-restart-while-running' },
    });
  });

  it('persists approval state to disk', async () => {
    const root = await tempDir();
    const storagePath = join(root, 'tasks.json');
    const service = new AgentBrowserTaskService({
      execute: async (task) => passedExecution(task),
      storagePath,
    });
    service.create({
      name: 'Disk gate',
      url: 'https://example.com',
      objective: 'o',
      profile: 'default',
      mode: 'headless',
    });
    const raw = await readFile(storagePath, 'utf8');
    expect(raw).toContain('waiting-approval');
    await mkdir(join(root, 'nested'), { recursive: true }); // ensure path ops ok
  });

  it('rejects before execution and requires a fresh approval after retry', async () => {
    const execute = vi.fn(async (task: AgentBrowserTask) => passedExecution(task));
    const service = new AgentBrowserTaskService({ execute });
    const task = service.create({
      name: 'Review first',
      url: 'https://example.com',
      objective: 'Read public content',
      profile: 'default',
      mode: 'headless',
      steps: [{ action: 'wait-for-selector', selector: 'h1' }],
      successCriteria: { kind: 'text-includes', value: 'Example Domain' },
    });

    expect(service.reject(task.id)).toMatchObject({
      status: 'cancelled',
      errorCode: 'APPROVAL_REJECTED',
      approval: { status: 'rejected' },
    });
    expect(execute).not.toHaveBeenCalled();
    await expect(service.retry(task.id)).resolves.toMatchObject({ status: 'waiting-approval', approval: { status: 'pending' } });
    await expect(service.run(task.id)).rejects.toThrow('waiting for approval');
    service.approve(task.id);
    await expect(service.run(task.id)).resolves.toMatchObject({ status: 'completed' });
  });
});
