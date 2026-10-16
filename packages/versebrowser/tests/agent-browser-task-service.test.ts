import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AgentBrowserTaskService,
  recoverTasksAfterRestart,
  type AgentBrowserTask,
} from '../src/engine/task-service';

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

  it('refuses sensitive query parameters in the task URL', () => {
    const service = new AgentBrowserTaskService({ execute: async (task) => passedExecution(task) });
    const keys = ['token', 'api_key', 'private_key', 'cookie', 'csrf', 'xsrf', 'passwd', 'auth_token', 'otp', 'pin'];
    for (const key of keys) {
      expect(
        () => service.create({ name: 'probe', url: `https://example.com/?${key}=secret`, objective: 'o', profile: 'default', mode: 'headless' }),
        key,
      ).toThrow(new RegExp(`sensitive query parameter: ${key}`, 'u'));
    }
    // An ordinary parameter is still accepted and kept verbatim.
    const ok = service.create({
      name: 'probe',
      url: 'https://example.com/items?page=2&q=hello',
      objective: 'o',
      profile: 'default',
      mode: 'headless',
    });
    expect(ok.url).toBe('https://example.com/items?page=2&q=hello');
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

  it('does not let an in-flight result overwrite a task paused mid-run', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const execute = vi.fn(async (currentTask: AgentBrowserTask) => {
      await gate;
      return passedExecution(currentTask);
    });
    const service = new AgentBrowserTaskService({ execute });
    const task = service.create({
      name: 'Pausable task',
      url: 'https://example.com',
      objective: 'Pause mid-run',
      profile: 'default',
      mode: 'headless',
    });
    service.approve(task.id);
    const running = service.run(task.id);
    service.pause(task.id);
    finish();
    await running;

    // The progress callback already refuses to update a task that is no longer `running`; the
    // completion path must use the same guard, or pause() is silently ignored and the paused task
    // is flipped back to `completed` by the still-in-flight executor result.
    expect(service.get(task.id).status).toBe('paused');
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
      } as never,
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
      } as never,
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

  it('persists workspace context as metadata without changing its approval gate', () => {
    const service = new AgentBrowserTaskService({ execute: async (task) => passedExecution(task) });
    const task = service.create({
      name: 'Workspace health check',
      url: 'https://example.com/status',
      objective: 'Confirm the status page is available',
      profile: 'default',
      mode: 'headless',
      workspaceId: 'workspace-demo',
      sessionKey: 'agent:main:main',
      agentId: 'main',
    });

    expect(task).toMatchObject({
      workspaceId: 'workspace-demo',
      sessionKey: 'agent:main:main',
      agentId: 'main',
      status: 'waiting-approval',
      approval: { status: 'pending' },
    });
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

  /**
   * The step executor used to treat any action outside its three branches as a successful no-op, and
   * create() stored the action verbatim - so a runtime caller (host IPC / JSON, not bound by the TS
   * union) could create a task whose misspelled step came back `passed`. Refuse it at creation.
   */
  it('refuses a step whose action is not one it can execute', () => {
    const execute = vi.fn(async (task: AgentBrowserTask) => passedExecution(task));
    const service = new AgentBrowserTaskService({ execute });

    expect(() => service.create({
      name: 'Typo step',
      url: 'https://example.com',
      objective: 'Read public content',
      profile: 'default',
      mode: 'headless',
      steps: [{ action: 'clic' as never, selector: '#a' }],
    })).toThrow('Agent browser task step action is unknown: clic');
  });

  /**
   * cancel() overwrote any status, so a blanket/late cancel turned a completed task into
   * 'cancelled': the recorded success was destroyed and the task entered the retryable set, which
   * unlocked `retry` for a run that had already succeeded.
   */
  it('does not let a late cancel rewrite a completed outcome or unlock retry', async () => {
    const execute = vi.fn(async (task: AgentBrowserTask) => passedExecution(task));
    const service = new AgentBrowserTaskService({ execute });
    const task = service.create({
      name: 'Already done',
      url: 'https://example.com',
      objective: 'Read public content',
      profile: 'default',
      mode: 'headless',
      steps: [{ action: 'click', selector: '#ok' }],
      successCriteria: { kind: 'text-includes', value: 'Example Domain' },
    });
    service.approve(task.id);
    await expect(service.run(task.id)).resolves.toMatchObject({ status: 'completed' });

    expect(service.cancel(task.id)).toMatchObject({ status: 'completed' });
    expect(service.get(task.id).status).toBe('completed');
    await expect(service.retry(task.id)).rejects.toThrow('Only failed, cancelled, or interrupted');
  });

  /**
   * pause()/resume() were the same family as cancel(): pause() overwrote any status, and resume()
   * re-queued any status. Together they walked a completed run back into the approval gate, where one
   * more approve() re-executed it - a finished run could be run a second time by resuming it.
   */
  it('does not pause or resume a finished task back into the approval gate', async () => {
    const execute = vi.fn(async (task: AgentBrowserTask) => passedExecution(task));
    const service = new AgentBrowserTaskService({ execute });
    const task = service.create({
      name: 'Finished once',
      url: 'https://example.com',
      objective: 'Read public content',
      profile: 'default',
      mode: 'headless',
      steps: [{ action: 'click', selector: '#ok' }],
      successCriteria: { kind: 'text-includes', value: 'Example Domain' },
    });
    service.approve(task.id);
    await expect(service.run(task.id)).resolves.toMatchObject({ status: 'completed' });
    expect(execute).toHaveBeenCalledOnce();

    expect(service.pause(task.id)).toMatchObject({ status: 'completed' });
    expect(service.get(task.id).status).toBe('completed');
    expect(() => service.resume(task.id)).toThrow('Only a paused task can resume');
    expect(service.get(task.id).status).toBe('completed');
    await expect(service.retry(task.id)).rejects.toThrow('Only failed, cancelled, or interrupted');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('still pauses a queued task and resumes it through the approval gate', async () => {
    const execute = vi.fn(async (task: AgentBrowserTask) => passedExecution(task));
    const service = new AgentBrowserTaskService({ execute });
    const task = service.create({
      name: 'Pause then run',
      url: 'https://example.com',
      objective: 'Read public content',
      profile: 'default',
      mode: 'headless',
      steps: [{ action: 'click', selector: '#ok' }],
      successCriteria: { kind: 'text-includes', value: 'Example Domain' },
    });
    expect(service.pause(task.id)).toMatchObject({ status: 'paused' });
    expect(service.resume(task.id)).toMatchObject({ status: 'waiting-approval', approval: { status: 'pending' } });
    service.approve(task.id);
    await expect(service.run(task.id)).resolves.toMatchObject({ status: 'completed' });
  });
});
