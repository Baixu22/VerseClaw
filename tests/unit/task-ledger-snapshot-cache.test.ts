// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { appendPersistentTaskEvents } from '../../shared/task-system/event-store';
import { readSessionTaskContainer } from '../../src/lib/session-read-model';
import {
  createTaskLedgerEvent,
  getTaskLedgerEventsPath,
  getTaskLedgerSnapshotPath,
  loadTaskLedgerSnapshot,
  normalizeTaskLedgerWorkspaceId,
} from '../../electron/services/task-ledger-service';
import { writeJsonAtomic } from '../../electron/utils/atomic-write';

const fixture = vi.hoisted(() => ({ configDir: '', workspaceRoot: '', warn: vi.fn() }));
vi.mock('../../electron/utils/paths', () => ({
  getOpenClawConfigDir: () => fixture.configDir,
}));
vi.mock('../../electron/utils/logger', () => ({ logger: { warn: fixture.warn } }));
vi.mock('../../electron/services/workspaces-api', () => ({
  getWorkspaceRootPathById: async () => fixture.workspaceRoot,
  getPersistedCoordinatorBinding: async () => null,
}));
vi.mock('../../electron/utils/atomic-write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../electron/utils/atomic-write')>();
  return { ...actual, writeJsonAtomic: vi.fn(actual.writeJsonAtomic) };
});

const workspaceId = 'worker-project';
const sessionKey = 'agent:independent-coordinator:main';
const generation = 'generation-1';
const timestamp = '2026-11-09T00:00:00.000Z';
const cacheWrite = vi.mocked(writeJsonAtomic);
const realAtomic = await vi.importActual<typeof import('../../electron/utils/atomic-write')>(
  '../../electron/utils/atomic-write',
);
let root: string;
let taskId: string;

beforeEach(() => {
  cacheWrite.mockReset().mockImplementation(realAtomic.writeJsonAtomic);
  fixture.warn.mockClear();
  root = mkdtempSync(join(tmpdir(), 'task-snapshot-cache-'));
  fixture.configDir = join(root, 'state');
  fixture.workspaceRoot = join(root, 'workspace');
  mkdirSync(fixture.workspaceRoot);
  const store = new TaskSystemStore(resolveTaskDomain(fixture.workspaceRoot));
  try {
    const task = store.start({ contract: {
      objective: 'Independent coordinator task',
      target: 'Read the recorded transcript',
      constraints: ['Preserve the project coordinator'],
      acceptance: [{
        id: 'verify',
        description: 'Recorded evidence',
        verification: { kind: 'owner-receipt', owner: 'evidence-verifier', requires: ['test'] },
      }],
    } }, sessionKey, generation, 'start');
    taskId = task.contract.taskNodeId;
  } finally {
    store.close();
  }
  const ownerKey = normalizeTaskLedgerWorkspaceId(workspaceId);
  appendPersistentTaskEvents(getTaskLedgerEventsPath(workspaceId), [
    createTaskLedgerEvent(ownerKey, {
      id: 'event-task',
      type: 'node_created',
      actor: 'user',
      createdAt: timestamp,
      payload: { node: {
        id: 'event-task', title: 'Recorded task', kind: 'task', status: 'todo',
        createdAt: timestamp, updatedAt: timestamp,
      } },
    }),
    createTaskLedgerEvent(ownerKey, {
      id: 'event-link',
      type: 'session_linked',
      actor: 'user',
      createdAt: timestamp,
      payload: { sessionLink: {
        id: 'event-link', nodeId: 'event-task', sessionKey, sessionGeneration: generation,
        relation: 'related', createdAt: timestamp,
      } },
    }),
  ]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('Task Ledger derived snapshot cache', () => {
  it('returns real event and owner records after EPERM and releases the cache lock for retry', async () => {
    const cachePath = getTaskLedgerSnapshotPath(workspaceId);
    writeFileSync(cachePath, '{invalid-cache');
    const error = Object.assign(new Error('EPERM: snapshot cache rename denied'), { code: 'EPERM' });
    cacheWrite.mockRejectedValueOnce(error);

    const snapshot = await loadTaskLedgerSnapshot(workspaceId);

    expect(snapshot.sourceWorkspaceId).toBe(workspaceId);
    expect(snapshot.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'event-task', title: 'Recorded task' }),
      expect.objectContaining({ id: taskId, title: 'Independent coordinator task', status: 'doing' }),
    ]));
    expect(snapshot.sessionLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'event-task', sessionKey, sessionGeneration: generation }),
      expect.objectContaining({ nodeId: taskId, sessionKey, sessionGeneration: generation }),
    ]));
    expect(snapshot.warnings).toEqual([]);
    const container = readSessionTaskContainer({
      workspaceId, session: { key: sessionKey, sessionId: generation },
      read: { workspaceId, sessionKey, generation, snapshot },
    });
    expect(container.status).toBe('ready');
    expect(container.nodes.map((node) => node.id).sort()).toEqual(['event-task', taskId].sort());
    expect(fixture.warn).toHaveBeenCalledTimes(1);
    expect(fixture.warn).toHaveBeenCalledWith(
      '[task-ledger] snapshot cache write failed', { workspaceId, error: String(error) },
    );
    expect(readFileSync(cachePath, 'utf8')).toBe('{invalid-cache');

    const retried = await loadTaskLedgerSnapshot(workspaceId);
    expect(cacheWrite).toHaveBeenCalledTimes(2);
    expect(fixture.warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(cachePath, 'utf8'))).toEqual(retried);
  });

  it('rejects corrupt event history even when a valid JSON snapshot exists', async () => {
    await loadTaskLedgerSnapshot(workspaceId);
    cacheWrite.mockClear();
    writeFileSync(getTaskLedgerEventsPath(workspaceId), '{corrupt-event');

    await expect(loadTaskLedgerSnapshot(workspaceId)).rejects.toThrow();
    expect(cacheWrite).not.toHaveBeenCalled();
    expect(fixture.warn).not.toHaveBeenCalled();
  });

  it('rejects a failed TaskSystemStore read instead of returning the prior JSON snapshot', async () => {
    await loadTaskLedgerSnapshot(workspaceId);
    cacheWrite.mockClear();
    writeFileSync(resolveTaskDomain(fixture.workspaceRoot).database, 'not a SQLite database');

    await expect(loadTaskLedgerSnapshot(workspaceId)).rejects.toThrow();
    expect(cacheWrite).not.toHaveBeenCalled();
    expect(fixture.warn).not.toHaveBeenCalled();
  });

  it('serializes overlapping writes to the same snapshot using the existing file lock', async () => {
    let active = 0;
    let peak = 0;
    cacheWrite.mockImplementation(async (...args) => {
      active += 1;
      peak = Math.max(peak, active);
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
        return await realAtomic.writeJsonAtomic(...args);
      } finally {
        active -= 1;
      }
    });

    const snapshots = await Promise.all(Array.from({ length: 3 }, () => loadTaskLedgerSnapshot(workspaceId)));
    expect(cacheWrite).toHaveBeenCalledTimes(3);
    expect(peak).toBe(1);
    expect(fixture.warn).not.toHaveBeenCalled();
    for (const snapshot of snapshots) {
      expect(snapshot.sessionLinks).toContainEqual(expect.objectContaining({
        nodeId: taskId, sessionKey, sessionGeneration: generation,
      }));
    }
    expect(JSON.parse(readFileSync(getTaskLedgerSnapshotPath(workspaceId), 'utf8')).nodes)
      .toContainEqual(expect.objectContaining({ id: taskId, title: 'Independent coordinator task' }));
  });
});
