// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSubagentRegistryFromSqlite, saveSubagentRegistryToSqlite } from '../../openclaw_runtime/src/agents/subagent-registry.store.sqlite';
import { closeOpenClawStateDatabase, openOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';
import type { SubagentRunRecord } from '../../openclaw_runtime/src/agents/subagent-registry.types';

const record = (id: string): SubagentRunRecord => ({ runId: id, childSessionKey: 'agent:main:subagent:' + id,
  requesterSessionKey: 'agent:main:controller', controllerSessionKey: 'agent:main:controller', requesterDisplayKey: 'agent:main:controller',
  requesterSessionId: 'controller-generation',
  task: 'controlled owner entry', cleanup: 'keep', createdAt: Date.now(), execution: { status: 'pending' }, dispatchPending: true });

describe('subagent SQLite concurrency', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'r1-registry-')); vi.stubEnv('OPENCLAW_STATE_DIR', root); });
  afterEach(() => { closeOpenClawStateDatabase(); vi.unstubAllEnvs(); });

  it('preserves records absent from another gateway snapshot', () => {
    const a = new Map([['a', record('a')]]), b = new Map([['b', record('b')]]);
    saveSubagentRegistryToSqlite(a); saveSubagentRegistryToSqlite(b);
    expect([...loadSubagentRegistryFromSqlite().keys()].sort()).toEqual(['a', 'b']);
    saveSubagentRegistryToSqlite(new Map());
    expect(loadSubagentRegistryFromSqlite().size).toBe(2);
    a.delete('a'); saveSubagentRegistryToSqlite(a);
    expect([...loadSubagentRegistryFromSqlite().keys()]).toEqual(['b']);
  });

  it('rejects a stale update that would resurrect an ended run and rolls back sibling changes', () => {
    saveSubagentRegistryToSqlite(new Map([['a', record('a')], ['b', record('b')]]));
    const stale = loadSubagentRegistryFromSqlite(), current = loadSubagentRegistryFromSqlite();
    current.get('b')!.endedAt = Date.now(); current.get('b')!.outcome = { status: 'ok' };
    saveSubagentRegistryToSqlite(current);
    stale.get('a')!.label = 'must roll back'; stale.get('b')!.label = 'stale';
    expect(() => saveSubagentRegistryToSqlite(stale)).toThrow(/conflict/);
    const saved = loadSubagentRegistryFromSqlite();
    expect(saved.get('a')!.label).toBeUndefined();
    expect(saved.get('b')!.endedAt).toBe(current.get('b')!.endedAt);
  });

  it('rebases unchanged owner facts and rejects stale deletion', () => {
    saveSubagentRegistryToSqlite(new Map([['a', record('a')]]));
    const stale = loadSubagentRegistryFromSqlite(), current = loadSubagentRegistryFromSqlite();
    current.get('a')!.endedAt = Date.now(); current.get('a')!.outcome = { status: 'ok' };
    saveSubagentRegistryToSqlite(current); saveSubagentRegistryToSqlite(stale);
    expect(stale.get('a')!.endedAt).toBe(current.get('a')!.endedAt);
    const deletion = loadSubagentRegistryFromSqlite();
    current.get('a')!.label = 'new owner metadata'; saveSubagentRegistryToSqlite(current);
    deletion.delete('a');
    expect(() => saveSubagentRegistryToSqlite(deletion)).toThrow(/conflict/);
    expect(loadSubagentRegistryFromSqlite().get('a')!.label).toBe('new owner metadata');
  });

  it('refuses an unrelated record with a colliding run id', () => {
    saveSubagentRegistryToSqlite(new Map([['a', record('a')]]));
    expect(() => saveSubagentRegistryToSqlite(new Map([['a', { ...record('a'), childSessionKey: 'agent:other:child' }]]))).toThrow(/conflict/);
    expect(loadSubagentRegistryFromSqlite().get('a')!.childSessionKey).toBe('agent:main:subagent:a');
  });

  it('keeps the original child and controller identity when metadata changes', () => {
    saveSubagentRegistryToSqlite(new Map([['a', record('a')]]));
    for (const field of ['childSessionKey', 'controllerSessionKey', 'requesterSessionKey', 'requesterSessionId'] as const) {
      const runs = loadSubagentRegistryFromSqlite(); runs.get('a')![field] = 'agent:other:scope';
      expect(() => saveSubagentRegistryToSqlite(runs)).toThrow(/scope conflict/);
      expect(loadSubagentRegistryFromSqlite().get('a')![field]).toBe(record('a')[field]);
    }
  });

  it('preserves active sweep iterator positions when records are saved', () => {
    const runs = new Map([['a', record('a')], ['b', record('b')]]);
    saveSubagentRegistryToSqlite(runs);
    const visited: string[] = [];
    for (const [id, entry] of runs) {
      visited.push(id); if (visited.length > 2) break;
      entry.label = 'observed'; saveSubagentRegistryToSqlite(runs);
    }
    expect(visited).toEqual(['a', 'b']);
  });

  it('includes typed owner columns in conflict detection', () => {
    saveSubagentRegistryToSqlite(new Map([['a', record('a')]]));
    const stale = loadSubagentRegistryFromSqlite();
    openOpenClawStateDatabase().db.prepare('UPDATE subagent_runs SET ended_at = ?, outcome_json = ? WHERE run_id = ?')
      .run(Date.now(), JSON.stringify({ status: 'ok' }), 'a');
    stale.get('a')!.label = 'stale projection';
    expect(() => saveSubagentRegistryToSqlite(stale)).toThrow(/conflict/);
    expect(loadSubagentRegistryFromSqlite().get('a')!.endedAt).toBeTypeOf('number');
  });

  it.each(['reserve', 'queue'] as const)('allows only one %s when two real processes share a child cap of one', async mode => {
    openOpenClawStateDatabase();
    if (mode === 'queue') {
      const queued: SubagentRunRecord = { ...record('queued-shared'), dispatchPending: undefined, execution: { status: 'queued' as const },
        queuedDispatch: { params: { message: 'controlled queue', sessionKey: 'agent:main:subagent:queued-shared', idempotencyKey: 'queued-shared' },
          maxChildren: 1, controllerSessionId: 'controller-generation', timeoutMs: 1000 },
        orchestration: { orchestrationRunId: 'shared-orchestration', taskNodeId: 'one', executionWave: 1,
          roleName: 'implementer', isVerifier: false, phase: 'worker', leadRole: 'implementer', originalTask: 'controlled queue',
          executionWaves: [{ wave: 1, taskNodeIds: ['one'], roles: ['implementer'] }],
          taskGraph: { graphRunId: 'shared-graph', mode: 'auto' as const, status: 'planned' as const, edges: [], nodes: [{
            taskNodeId: 'one', roleName: 'implementer', task: 'controlled queue', phase: 'implementation' as const, dependsOn: [],
            scope: 'controlled queue', requiredCapabilities: [], status: 'ready' as const,
            attemptPolicy: { maxRepairAttempts: 0, maxRedoAttempts: 0 },
          }] },
        } };
      saveSubagentRegistryToSqlite(new Map([[queued.runId, queued]]));
    }
    function start(id: string) {
      const child = spawn(process.execPath, ['--import', 'tsx', path.join(process.cwd(), 'tests/unit/fixtures/autonomy-subagent-reservation-worker.mts'), id, mode], {
        cwd: path.join(process.cwd(), 'openclaw_runtime'), windowsHide: true,
        env: { ...process.env, OPENCLAW_STATE_DIR: root, OPENCLAW_TEST_READ_SUBAGENT_RUNS_FROM_DISK: '1', NODE_ENV: 'test' }, stdio: ['pipe', 'pipe', 'pipe'] });
      const rows: Array<{ ready?: boolean; admitted?: boolean }> = []; let output = '', stderr = '';
      child.stderr.on('data', data => { stderr += data; });
      const exited = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
      const ready = new Promise<void>((resolve, reject) => {
        child.stdout.on('data', data => { output += data; let index: number;
          while ((index = output.indexOf('\n')) >= 0) { const line = output.slice(0, index); output = output.slice(index + 1);
            try { const row = JSON.parse(line); rows.push(row); if (row.ready) resolve(); } catch { /* runtime diagnostics */ } }
        });
        child.once('error', reject); child.once('close', () => reject(new Error(stderr || 'owner closed before ready')));
      });
      return { child, rows, exited, ready };
    }
    const processes: Array<ReturnType<typeof start>> = [];
    try {
      for (const id of ['native-a', 'native-b']) { const owner = start(id); processes.push(owner); await owner.ready; }
      processes.forEach(owner => owner.child.stdin.end('reserve\n'));
      const exits = await Promise.all(processes.map(owner => owner.exited));
      expect(exits).toEqual([0, 0]);
      expect(processes.filter(owner => owner.rows.some(row => row.admitted))).toHaveLength(1);
      const saved = loadSubagentRegistryFromSqlite();
      expect(saved.size).toBe(1); expect([...saved.values()][0].dispatchPending).toBe(true);
      if (mode === 'queue') expect([...saved.values()][0].execution?.status).toBe('interrupted');
      const evidence = path.join(process.cwd(), 'artifacts/runs/autonomy-resource-admission/registry-' + path.basename(root));
      mkdirSync(evidence, { recursive: true });
      writeFileSync(path.join(evidence, 'owner.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex-r1-registry-native',
        processes: processes.map((owner, i) => ({ pid: owner.child.pid, events: owner.rows, exit: exits[i] })),
        saved: [...saved.values()], databasePath: openOpenClawStateDatabase().path }, null, 2) + '\n');
    } finally { for (const owner of processes) if (owner.child.exitCode === null) owner.child.kill(); await Promise.allSettled(processes.map(owner => owner.exited)); }
  }, 120000);
});
