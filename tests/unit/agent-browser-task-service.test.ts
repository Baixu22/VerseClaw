import { describe, expect, it, vi } from 'vitest';
import { AgentBrowserTaskService } from '@electron/services/agent-browser-task-service';

describe('agent browser task service', () => {
  it('runs an immediate task through queued, running, and completed states', async () => {
    const execute = vi.fn(async () => ({ sessionId: 'session-1', runId: 'run-1' }));
    const service = new AgentBrowserTaskService({ execute });
    const task = service.create({
      name: 'Check dashboard',
      url: 'https://example.com',
      objective: 'Read the current status',
      profile: 'work',
      mode: 'headless',
    });

    expect(task.status).toBe('queued');
    await expect(service.run(task.id)).resolves.toMatchObject({
      id: task.id,
      status: 'completed',
      sessionId: 'session-1',
      runId: 'run-1',
    });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ id: task.id }), expect.any(AbortSignal));
  });

  it('cancels a running task and does not let completion overwrite cancellation', async () => {
    let finish!: () => void;
    const execute = vi.fn(async (_task, signal: AbortSignal) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
        signal.addEventListener('abort', resolve, { once: true });
      });
      return {};
    });
    const service = new AgentBrowserTaskService({ execute });
    const task = service.create({
      name: 'Long task',
      url: 'https://example.com',
      objective: 'Wait',
      profile: 'default',
      mode: 'headless',
    });
    const running = service.run(task.id);
    service.cancel(task.id);
    finish();
    await running;

    expect(service.get(task.id).status).toBe('cancelled');
  });

  it('retries failed tasks with a clean queued lifecycle', async () => {
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ runId: 'run-2' });
    const service = new AgentBrowserTaskService({ execute });
    const task = service.create({
      name: 'Retry task',
      url: 'https://example.com',
      objective: 'Read',
      profile: 'default',
      mode: 'headless',
    });
    await service.run(task.id);
    expect(service.get(task.id)).toMatchObject({ status: 'failed', error: 'temporary failure' });

    await expect(service.retry(task.id)).resolves.toMatchObject({
      status: 'completed',
      runId: 'run-2',
      retryCount: 1,
    });
  });
});
