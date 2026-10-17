import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { AgentBrowserTaskService, type AgentBrowserTask } from '@verse-claw/versebrowser';


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

class FakeWebContents extends EventEmitter {
  readonly id = Math.floor(Math.random() * 100000) + 1;
  url = '';
  title = '';
  async executeJavaScript() { return ''; }
  async capturePage() { return { toDataURL: () => 'data:image/png;base64,abc' }; }
  getURL() { return this.url; }
  getTitle() { return this.title; }
}
class FakeWindow {
  readonly webContents = new FakeWebContents();
  closed = false;
  async loadURL(url: string) {
    this.webContents.url = url;
    this.webContents.title = 'Loaded page';
    queueMicrotask(() => {
      this.webContents.emit('dom-ready');
      this.webContents.emit('did-finish-load');
    });
  }
  close() { this.closed = true; }
  isDestroyed() { return this.closed; }
  show() {}
  hide() {}
  setBounds() {}
}

describe('VerseBrowser task and session conservation (M05)', () => {
  it('preserves every task identity and lifecycle field across a version-2 store restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vb-m05-restart-'));
    const storagePath = join(root, 'tasks.json');
    const execute = vi.fn(async (task: AgentBrowserTask) => passedExecution(task, 'run-before'));
    const before = new AgentBrowserTaskService({ execute, storagePath, now: () => new Date('2026-10-15T10:00:00.000Z') });
    const waiting = before.create({
      name: 'Waiting', url: 'https://example.com/wait', objective: 'wait', profile: 'work', mode: 'headless',
      steps: [{ action: 'wait-for-selector', selector: 'h1' }],
      successCriteria: { kind: 'text-includes', value: 'Ready' },
      workspaceId: 'workspace-a', sessionKey: 'agent:main:main', agentId: 'main',
    });
    const completed = before.create({ name: 'Completed', url: 'https://example.com/done', objective: 'done', profile: 'work', mode: 'headless' });
    before.approve(completed.id);
    await before.run(completed.id);
    const completedSnapshot = before.get(completed.id);
    const running = before.create({ name: 'Running', url: 'https://example.com/run', objective: 'run', profile: 'work', mode: 'headless' });
    before.approve(running.id);
    // Simulate process exit while running by serializing a clone with running state.
    const rawBefore = JSON.parse(await readFile(storagePath, 'utf8')) as { version: 2; tasks: AgentBrowserTask[] };
    rawBefore.tasks = rawBefore.tasks.map((task) => task.id === running.id ? { ...task, status: 'running', sessionId: 's-run' } : task);
    await writeFile(storagePath, JSON.stringify(rawBefore, null, 2) + '\n', 'utf8');
    const after = new AgentBrowserTaskService({ execute, storagePath, now: () => new Date('2026-10-15T10:01:00.000Z') });
    const waitingAfter = after.get(waiting.id);
    expect(waitingAfter).toMatchObject(waiting);
    const completedAfter = after.get(completed.id);
    expect({ ...completedAfter, errorCode: completedAfter.errorCode ?? undefined, error: completedAfter.error ?? undefined }).toMatchObject(completedSnapshot);
    const runningAfter = after.get(running.id);
    expect(runningAfter).toMatchObject({ id: running.id, status: 'interrupted', sessionId: undefined, runId: undefined, recovery: { recoveredFrom: 'running', reason: 'app-restart-while-running' } });
    await rm(root, { recursive: true, force: true });
  });

  it('keeps completed and cancelled outcomes unchanged when late lifecycle calls arrive', async () => {
    const execute = vi.fn(async (task: AgentBrowserTask) => passedExecution(task, 'run-late'));
    const service = new AgentBrowserTaskService({ execute });
    const completed = service.create({ name: 'Done', url: 'https://example.com', objective: 'o', profile: 'work', mode: 'headless' });
    service.approve(completed.id);
    await service.run(completed.id);
    const completedSnapshot = service.get(completed.id);
    expect(service.cancel(completed.id)).toMatchObject({ status: 'completed' });
    expect(service.pause(completed.id)).toMatchObject({ status: 'completed' });
    expect(() => service.resume(completed.id)).toThrow(/Only a paused task/);
    expect(service.get(completed.id)).toMatchObject(completedSnapshot);
  });

  it('rejects unknown steps before persisting a task', () => {
    const service = new AgentBrowserTaskService({ execute: vi.fn() });
    expect(() => service.create({
      name: 'Bad', url: 'https://example.com', objective: 'o', profile: 'work', mode: 'headless',
      steps: [{ action: 'submit-form' as never, selector: 'button' }],
    })).toThrow(/unknown/);
  });

  it('keeps other sessions alive when one owned session is unloaded', async () => {
    const windows: FakeWindow[] = [];
    const { AgentBrowserService } = await import('@verse-claw/versebrowser');
    const service = new AgentBrowserService({
      createWindow: () => {
        const win = new FakeWindow();
        windows.push(win);
        return win as never;
      },
      now: () => new Date('2026-10-15T10:00:00.000Z'),
    });
    const first = await service.open({ url: 'https://a.example', workspaceId: 'workspace-a' });
    const second = await service.open({ url: 'https://b.example', workspaceId: 'workspace-b' });
    const firstPages = await service.newPage({ sessionId: first.session.id, url: 'https://a.example/page' });
    expect(firstPages.pages.map((page) => page.url)).toEqual(['https://a.example/', 'https://a.example/page']);
    service.close(first.session.id);
    expect(service.list().map((session) => session.id)).toEqual([second.session.id]);
    expect(windows[0].closed).toBe(true);
    expect(windows[1].closed).toBe(false);
    await expect(service.listPages({ sessionId: second.session.id })).resolves.toMatchObject({ success: true });
  });
});
