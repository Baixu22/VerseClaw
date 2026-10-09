/**
 * #121 — the owner read is where the failure used to disappear.
 *
 * `readGoalWakeRowsForSession` degrades a failed query to empty arrays, so the
 * activity snapshot could not tell "this session has nothing waiting" from "the
 * owner could not be read" and rendered the second as the first. The read state
 * is part of the result now, and the owner-view contract carries it
 * (`goalWakeRead`) so an activity snapshot can reflect it.
 *
 * The state database is redirected at a temp state dir, so nothing here touches
 * a developer's real OpenClaw state.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { stateDb } = vi.hoisted(() => ({ stateDb: { failOpenDatabase: false } }));

vi.mock('../../openclaw_runtime/src/state/openclaw-state-db.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../openclaw_runtime/src/state/openclaw-state-db.js')
  >();
  return {
    ...actual,
    openOpenClawStateDatabase: (...args: Parameters<typeof actual.openOpenClawStateDatabase>) => {
      if (stateDb.failOpenDatabase) {
        throw new Error('owner state database unavailable');
      }
      return actual.openOpenClawStateDatabase(...args);
    },
  };
});

import { closeOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db.js';
import {
  collectSessionLifecycleOwnerViews,
  readGoalWakeRowsForSession,
} from '../../openclaw_runtime/src/gateway/server-methods/session-lifecycle-owner-views.js';

const SESSION_KEY = 'agent:main:main';
const tempRoots: string[] = [];

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-activity-owner-read-'));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  fs.mkdirSync(path.join(root, 'home'), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, 'home');
  process.env.OPENCLAW_STATE_DIR = path.join(root, 'state');
});

afterEach(() => {
  stateDb.failOpenDatabase = false;
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  for (const root of tempRoots.splice(0)) {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // Windows WAL close race; the evidence does not depend on cleanup.
    }
  }
});

const READ_CASES = [
  {
    name: 'an owner read exception reports unknown instead of an empty result',
    failOpenDatabase: true,
    expected: 'unknown' as const,
  },
  {
    name: 'a completed read that found nothing reports known',
    failOpenDatabase: false,
    expected: 'known' as const,
  },
];

describe('goal-wake owner read state', () => {
  it.each(READ_CASES)('$name', ({ failOpenDatabase, expected }) => {
    stateDb.failOpenDatabase = failOpenDatabase;

    const result = readGoalWakeRowsForSession(SESSION_KEY);

    expect(result.read).toBe(expected);
    expect(result.flows).toEqual([]);
    expect(result.tasks).toEqual([]);
  });

  it('carries the read state on the owner views the activity snapshot is built from', () => {
    stateDb.failOpenDatabase = true;

    const views = collectSessionLifecycleOwnerViews(SESSION_KEY, {
      supervisor: { snapshotRunsForSession: () => [] },
    });

    expect(views.goalWakeRead).toBe('unknown');
    expect(views.flows).toEqual([]);
    expect(views.tasks).toEqual([]);
  });

  it('reports a known read for a session key that cannot exist', () => {
    /* No key means no rows to read, which is an answer, not a failure. */
    expect(readGoalWakeRowsForSession('')).toEqual({ flows: [], tasks: [], read: 'known' });
  });
});
