// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskLedgerEventInput } from '../../shared/types/task-ledger';
import { withTaskEvents } from '../../shared/task-system/event-store';
import {
  appendTaskLedgerLifecycleEvents,
  getTaskLedgerEventsPath,
  readTaskLedgerEvents,
} from '../../electron/services/task-ledger-service';

let root: string;
vi.mock('../../electron/utils/paths', () => ({ getOpenClawConfigDir: () => root }));
vi.mock('../../electron/utils/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('../../electron/services/task-system-service', () => ({
  openTaskSystem: async () => null,
  listManagedTasks: async () => [],
}));

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'task-ledger-lifecycle-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function batch(family: 'mission' | 'task-loop', phase: string, progress: number, sessionKey = 'agent:main:ledger'): TaskLedgerEventInput[] {
  const prefix = `${family}:run-1`;
  const createdAt = new Date(1_800_000_000_000 + progress).toISOString();
  const taskId = `${prefix}:task`;
  return [
    { id: `${prefix}:task-created`, type: 'node_created', actor: 'system', taskId, sessionId: sessionKey,
      payload: { node: { id: taskId, title: family, kind: 'task', status: 'doing', progress,
        metadata: { phase }, createdAt, updatedAt: createdAt } } },
    { id: `${prefix}:session-linked`, type: 'session_linked', actor: 'system', taskId, sessionId: sessionKey,
      payload: { sessionLink: { id: `${prefix}:session`, nodeId: taskId, sessionKey, createdAt } } },
    { id: `${prefix}:progress:${phase}`, type: 'progress_changed', actor: 'system', taskId, sessionId: sessionKey,
      payload: { nodeId: taskId, progress } },
  ];
}

describe('runtime lifecycle writes through the existing SQLite event owner', () => {
  it.each(['mission', 'task-loop'] as const)('serializes %s updates and replays original creation facts', async family => {
    const initial = batch(family, 'running', 0);
    const completed = batch(family, 'complete', 100);
    const [, , latest] = await Promise.all([
      appendTaskLedgerLifecycleEvents('project-a', initial, `${family}:initial`),
      appendTaskLedgerLifecycleEvents('project-a', structuredClone(initial), `${family}:initial`),
      appendTaskLedgerLifecycleEvents('project-a', completed, `${family}:complete`),
    ]);
    expect(latest.nodes[0]).toMatchObject({ progress: 100, metadata: { phase: 'running' } });
    expect(latest.sessionLinks).toHaveLength(1);
    const before = (await readTaskLedgerEvents('project-a')).events;
    expect(before).toHaveLength(4);
    expect(before[0].payload.node?.createdAt).toBe(initial[0].payload.node?.createdAt);
    // No process-local Seen state is used: a fresh replay reads stored events.
    await appendTaskLedgerLifecycleEvents('project-a', structuredClone(initial), `${family}:initial`);
    await appendTaskLedgerLifecycleEvents('project-a', structuredClone(completed), `${family}:complete`);
    expect((await readTaskLedgerEvents('project-a')).events).toEqual(before);
  });

  it('retries the same batch after a failed transaction without partial events', async () => {
    const path = getTaskLedgerEventsPath('project-a');
    withTaskEvents(path, db => db.exec(`CREATE TRIGGER fail_lifecycle BEFORE INSERT ON events
      WHEN json_extract(NEW.json, '$.type') = 'progress_changed'
      BEGIN SELECT RAISE(ABORT, 'injected lifecycle failure'); END;`));
    const events = batch('mission', 'running', 0);
    await expect(appendTaskLedgerLifecycleEvents('project-a', events, 'failed-batch')).rejects.toThrow('injected lifecycle failure');
    expect((await readTaskLedgerEvents('project-a')).events).toEqual([]);
    withTaskEvents(path, db => {
      expect(db.prepare('SELECT count(*) AS count FROM batches').get()).toEqual({ count: 0 });
      db.exec('DROP TRIGGER fail_lifecycle');
    });
    const retried = await appendTaskLedgerLifecycleEvents('project-a', events, 'failed-batch');
    expect(retried.eventsCount).toBe(3);
    expect(retried.nodes).toHaveLength(1);
  });

  it('rejects session changes and changed updates sharing an event identity', async () => {
    await appendTaskLedgerLifecycleEvents('project-a', batch('mission', 'running', 0), 'initial');
    await expect(appendTaskLedgerLifecycleEvents('project-a', batch('mission', 'running', 0, 'agent:main:foreign'), 'foreign'))
      .rejects.toThrow('TASK_EVENT_ID_CONFLICT');
    await expect(appendTaskLedgerLifecycleEvents('project-a', batch('mission', 'running', 50), 'changed-update'))
      .rejects.toThrow('TASK_EVENT_ID_CONFLICT');
    expect((await readTaskLedgerEvents('project-a')).events).toHaveLength(3);
    await appendTaskLedgerLifecycleEvents('project-b', batch('mission', 'running', 0, 'agent:main:foreign'), 'other-project');
    expect((await readTaskLedgerEvents('project-b')).events[0].sessionId).toBe('agent:main:foreign');
  });

  it('requires stable identities instead of generating a new event on retry', async () => {
    const events = batch('mission', 'running', 0);
    events[0].id = undefined;
    await expect(appendTaskLedgerLifecycleEvents('project-a', events, 'missing-id'))
      .rejects.toThrow('TASK_LEDGER_LIFECYCLE_ID_REQUIRED');
    expect((await readTaskLedgerEvents('project-a')).events).toEqual([]);
  });
});
