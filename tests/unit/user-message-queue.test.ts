import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  completeDrainedUserMessages,
  drainUserMessages,
  enqueueUserMessage,
  peekUserMessageCount,
  restoreDrainingUserMessages,
} from '../../openclaw_runtime/src/agents/user-message-queue';
import {
  listLongTaskCheckpoints,
  listLongTaskInterventions,
  recordLongTaskCheckpoint,
  recordLongTaskInterventionEvent,
} from '../../openclaw_runtime/src/agents/long-task-control/store';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { resolveOpenClawStateSqlitePath } from '../../openclaw_runtime/src/state/openclaw-state-db.paths';

const ORIGINAL_STATE_DIR = process.env.OPENCLAW_STATE_DIR;

let testStateRoot: string | undefined;

beforeEach(() => {
  closeOpenClawStateDatabaseForTest();
  testStateRoot = mkdtempSync(path.join(tmpdir(), 'clawx-long-task-control-'));
  process.env.OPENCLAW_STATE_DIR = testStateRoot;
});

afterEach(() => {
  vi.restoreAllMocks();
  closeOpenClawStateDatabaseForTest();
  if (testStateRoot) {
    rmSync(testStateRoot, { recursive: true, force: true });
    testStateRoot = undefined;
  }
  if (ORIGINAL_STATE_DIR === undefined) {
    delete process.env.OPENCLAW_STATE_DIR;
  } else {
    process.env.OPENCLAW_STATE_DIR = ORIGINAL_STATE_DIR;
  }
});

describe('persistent user message queue', () => {
  it('deduplicates queued messages by idempotency key', () => {
    const sessionKey = 'agent:main:queue-idempotent';

    enqueueUserMessage(sessionKey, {
      text: 'first follow-up',
      source: 'queue',
      idempotencyKey: 'queue-idem-1',
    });
    enqueueUserMessage(sessionKey, {
      text: 'updated follow-up',
      source: 'queue',
      idempotencyKey: 'queue-idem-1',
    });

    expect(peekUserMessageCount(sessionKey)).toBe(1);
    expect(drainUserMessages(sessionKey)).toMatchObject([
      {
        text: 'updated follow-up',
        attempts: 1,
        source: 'queue',
      },
    ]);
  });

  it('keeps pending queue items after the state database is reopened', () => {
    const sessionKey = 'agent:main:queue-restart';

    enqueueUserMessage(sessionKey, {
      text: 'continue after gateway restart',
      agentId: 'main',
      workspaceId: 'workspace-owner',
      workspaceFingerprint: 'owner-fingerprint',
      source: 'queue',
      idempotencyKey: 'queue-restart-1',
    });

    expect(existsSync(resolveOpenClawStateSqlitePath(process.env))).toBe(true);
    closeOpenClawStateDatabaseForTest();

    expect(peekUserMessageCount(sessionKey)).toBe(1);
    const drained = drainUserMessages(sessionKey);

    expect(drained).toMatchObject([
      {
        text: 'continue after gateway restart',
        agentId: 'main',
        workspaceId: 'workspace-owner',
        workspaceFingerprint: 'owner-fingerprint',
        attempts: 1,
      },
    ]);
    expect(peekUserMessageCount(sessionKey)).toBe(0);
  });

  it.each(['workspaceId', 'workspaceFingerprint', 'agentId', 'taskLedgerRootId'] as const)('does not combine queued messages from different %s owners', (field) => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => ++now);
    const sessionKey = `agent:main:queue-owner-${field}`;
    const owner = { workspaceId: 'workspace-a', workspaceFingerprint: 'fingerprint-a', agentId: 'main', taskLedgerRootId: 'root-a' };
    enqueueUserMessage(sessionKey, { text: 'first owner', ...owner });
    enqueueUserMessage(sessionKey, { text: 'second owner', ...owner, [field]: 'other-owner' });
    enqueueUserMessage(sessionKey, { text: 'first owner again', ...owner });
    const first = drainUserMessages(sessionKey);
    expect(first.map(message => message.text)).toEqual(['first owner']);
    expect(peekUserMessageCount(sessionKey)).toBe(2);
    completeDrainedUserMessages(first);
    const second = drainUserMessages(sessionKey);
    expect(second.map(message => message.text)).toEqual(['second owner']);
    completeDrainedUserMessages(second);
    expect(drainUserMessages(sessionKey).map(message => message.text)).toEqual(['first owner again']);
  });

  it('restores failed drain attempts without losing the queued message', () => {
    const sessionKey = 'agent:main:queue-restore';

    enqueueUserMessage(sessionKey, {
      text: 'retry after transient send failure',
      source: 'queue',
      idempotencyKey: 'queue-restore-1',
    });

    const firstAttempt = drainUserMessages(sessionKey);
    expect(firstAttempt).toMatchObject([{ attempts: 1 }]);

    restoreDrainingUserMessages(firstAttempt, 'gateway unavailable');

    expect(peekUserMessageCount(sessionKey)).toBe(1);
    const retryAttempt = drainUserMessages(sessionKey);
    expect(retryAttempt).toMatchObject([
      {
        text: 'retry after transient send failure',
        attempts: 2,
        lastError: 'gateway unavailable',
      },
    ]);

    completeDrainedUserMessages(retryAttempt);
    expect(peekUserMessageCount(sessionKey)).toBe(0);
  });
});

describe('persistent long-task control records', () => {
  it('does not infer a Task Ledger root from prior records', () => {
    const sessionKey = 'agent:main:no-root-inference';

    const rootedCheckpoint = recordLongTaskCheckpoint({
      sessionKey,
      agentId: 'main',
      workspaceId: 'workspace',
      taskLedgerRootId: 'tlroot_loop',
      trigger: 'guide',
      activeTask: 'rooted loop checkpoint',
      idempotencyKey: 'checkpoint-rooted',
    });
    const detachedCheckpoint = recordLongTaskCheckpoint({
      sessionKey,
      agentId: 'main',
      workspaceId: 'workspace',
      trigger: 'guide',
      activeTask: 'ordinary chat must not borrow the loop root',
      idempotencyKey: 'checkpoint-detached',
    });
    const detachedIntervention = recordLongTaskInterventionEvent({
      sessionKey,
      agentId: 'main',
      workspaceId: 'workspace',
      trigger: 'guide',
      mode: 'guide',
      status: 'recorded',
      payload: { text: 'ordinary guidance without an explicit loop root' },
      checkpointId: detachedCheckpoint.id,
      idempotencyKey: 'intervention-detached',
    });
    const detachedQueueItem = enqueueUserMessage(sessionKey, {
      text: 'queued without an explicit loop root',
      source: 'queue',
      idempotencyKey: 'queue-detached',
    });

    expect(rootedCheckpoint.taskLedgerRootId).toBe('tlroot_loop');
    expect(detachedCheckpoint.taskLedgerRootId).toBeUndefined();
    expect(detachedCheckpoint.checkpoint.taskLedgerRootId).toBeUndefined();
    expect(detachedCheckpoint.checkpoint.evidenceRefs).not.toContainEqual(
      expect.objectContaining({ type: 'task_ledger', ref: 'tlroot_loop' }),
    );
    expect(detachedIntervention.taskLedgerRootId).toBeUndefined();
    expect(detachedIntervention.payload).not.toHaveProperty('taskLedgerRootId');
    expect(detachedQueueItem.taskLedgerRootId).toBeUndefined();
  });

  it('upserts checkpoints and intervention events by idempotency key', () => {
    const sessionKey = 'agent:main:checkpoint-idempotent';

    const firstCheckpoint = recordLongTaskCheckpoint({
      sessionKey,
      agentId: 'main',
      workspaceId: 'workspace',
      trigger: 'guide',
      activeTask: 'old steering note',
      idempotencyKey: 'checkpoint-idem-1',
    });
    const updatedCheckpoint = recordLongTaskCheckpoint({
      sessionKey,
      agentId: 'main',
      workspaceId: 'workspace',
      trigger: 'guide',
      activeTask: 'updated steering note',
      nextAction: 'resume with latest guidance',
      idempotencyKey: 'checkpoint-idem-1',
    });

    expect(updatedCheckpoint.id).toBe(firstCheckpoint.id);
    expect(listLongTaskCheckpoints(sessionKey)).toHaveLength(1);
    expect(listLongTaskCheckpoints(sessionKey)[0]?.checkpoint).toMatchObject({
      activeTask: 'updated steering note',
      nextAction: 'resume with latest guidance',
    });

    recordLongTaskInterventionEvent({
      sessionKey,
      agentId: 'main',
      workspaceId: 'workspace',
      trigger: 'guide',
      mode: 'guide',
      status: 'recorded',
      payload: { text: 'old guide' },
      checkpointId: updatedCheckpoint.id,
      idempotencyKey: 'intervention-idem-1',
    });
    recordLongTaskInterventionEvent({
      sessionKey,
      agentId: 'main',
      workspaceId: 'workspace',
      trigger: 'guide',
      mode: 'guide',
      status: 'steered',
      payload: { text: 'updated guide' },
      checkpointId: updatedCheckpoint.id,
      idempotencyKey: 'intervention-idem-1',
    });

    expect(listLongTaskInterventions(sessionKey)).toMatchObject([
      {
        status: 'steered',
        payload: { text: 'updated guide' },
      },
    ]);
  });
});
