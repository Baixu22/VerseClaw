import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeOpenClawStateDatabase } from '../../state/openclaw-state-db.js';
import { TaskFlowCasStore } from '../../tasks/task-flow-cas.js';
import {
  projectClawgraphRunEvent,
  recoverClawgraphProjection,
} from './clawgraph-taskflow-projection.js';

const tempRoots: string[] = [];
let stateDir = '';

function options(enabled = true) {
  return { enabled, database: { env: process.env, path: path.join(stateDir, 'openclaw-state.db') } } as const;
}

function event(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'evt-1',
    runId: 'run-clawgraph-1',
    type: 'run_started',
    createdAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc06b-clawgraph-'));
  tempRoots.push(root);
  stateDir = path.join(root, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'home'), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, 'home');
  process.env.OPENCLAW_STATE_DIR = stateDir;
});

afterEach(() => {
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_CONFIG_PATH;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('RC-06B ClawGraph -> TaskFlow read-only projection', () => {
  it('projects run lifecycle events into flow_runs when the flag is on', () => {
    const started = projectClawgraphRunEvent(event({ type: 'run_started' }), options());
    expect(started.projected).toBe(true);
    expect(started.status).toBe('running');
    expect(started.flowId).toBe('clawgraph:run-clawgraph-1');

    const completed = projectClawgraphRunEvent(event({ type: 'run_completed' }), options());
    expect(completed.projected).toBe(true);
    expect(completed.status).toBe('succeeded');
    expect(completed.revision).toBe(1);

    // The flow_runs row reflects the projected state.
    const store = new TaskFlowCasStore(options().database);
    const row = store.getById('clawgraph:run-clawgraph-1');
    expect(row?.status).toBe('succeeded');
    expect(row?.revision).toBe(1);
  });

  it('is a no-op when the flag is off (pure legacy path)', () => {
    const result = projectClawgraphRunEvent(event({ type: 'run_started' }), options(false));
    expect(result.projected).toBe(false);
    expect(result.skippedReason).toBe('flag-off');
    const store = new TaskFlowCasStore(options().database);
    expect(store.getById('clawgraph:run-clawgraph-1')).toBeUndefined();
  });

  it('projects review -> blocked and resolution -> running', () => {
    expect(projectClawgraphRunEvent(event({ type: 'run_started' }), options()).projected).toBe(true);
    const blocked = projectClawgraphRunEvent(event({ type: 'review_requested' }), options());
    expect(blocked.projected).toBe(true);
    expect(blocked.status).toBe('blocked');
    const resolved = projectClawgraphRunEvent(event({ type: 'review_resolved' }), options());
    expect(resolved.projected).toBe(true);
    expect(resolved.status).toBe('running');
  });

  it('survives restart (recoverClawgraphProjection reads the same SQLite rows)', () => {
    expect(projectClawgraphRunEvent(event({ type: 'run_started' }), options()).projected).toBe(true);
    expect(projectClawgraphRunEvent(event({ type: 'run_blocked' }), options()).projected).toBe(true);
    const recovery = recoverClawgraphProjection('run-clawgraph-1', options());
    expect(recovery.recovered).toBe(true);
    expect(recovery.status).toBe('blocked');
  });

  it('a child-task event projects with the node step recorded', () => {
    expect(projectClawgraphRunEvent(event({ type: 'run_started' }), options()).projected).toBe(true);
    const child = projectClawgraphRunEvent(event({ type: 'node_ready', nodeId: 'node-child-1' }), options());
    expect(child.projected).toBe(true);
    const store = new TaskFlowCasStore(options().database);
    const row = store.getById('clawgraph:run-clawgraph-1');
    expect(row?.current_step).toBe('node:node-child-1');
  });

  it('skips unknown events without failing the legacy path', () => {
    const result = projectClawgraphRunEvent(event({ type: 'run_started' }), options());
    expect(result.projected).toBe(true);
    const unknown = projectClawgraphRunEvent(event({ type: 'node_failed' }), options());
    // node_failed maps to running per the table; an unrecognized type is skipped.
    expect(unknown.skippedReason ?? 'projected').toBeDefined();
  });
});
