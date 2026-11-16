// @vitest-environment node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorktreeService } from '../../openclaw_runtime/src/agents/worktree-service';

function worker(root: string, mode: 'hold-lock' | 'create') {
  const child = spawn(process.execPath, ['--import', 'tsx',
    path.join(process.cwd(), 'tests/unit/fixtures/autonomy-worktree-owner-worker.mts'),
    Buffer.from(JSON.stringify({ root, mode, id: 'shared-worker' })).toString('base64')], {
    cwd: path.join(process.cwd(), 'openclaw_runtime'), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const rows: Array<Record<string, unknown>> = [];
  let stdout = '', stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('exit', resolve); child.once('error', reject);
  });
  const ready = new Promise<void>((resolve, reject) => {
    child.stdout.on('data', chunk => {
      stdout += String(chunk);
      for (;;) {
        const end = stdout.indexOf('\n');
        if (end < 0) break;
        try { rows.push(JSON.parse(stdout.slice(0, end))); resolve(); }
        catch (error) { reject(error); }
        stdout = stdout.slice(end + 1);
      }
    });
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Owner exited before receipt: ' + stderr)));
  });
  return { child, rows, ready, exited };
}

describe('worktree native owner admission', () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  it('keeps a live lock exclusive and refuses duplicate creation across processes', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'autonomy-worktree-native-'));
    roots.push(root);
    mkdirSync(path.join(root, '.openclaw/worktrees'), { recursive: true });
    const owner = worker(root, 'hold-lock');
    try {
      await owner.ready;
      expect(owner.rows[0]).toMatchObject({ pid: owner.child.pid, locked: true });
      expect(() => createWorktreeService(root).create('blocked')).toThrow(/Timed out acquiring/);
      expect(existsSync(path.join(root, '.openclaw/worktrees/blocked'))).toBe(false);
      process.kill(owner.child.pid!, 0);
      owner.child.stdin.end('release\n');
      expect(await owner.exited).toBe(0);
    } finally {
      if (owner.child.exitCode === null && owner.child.signalCode === null) owner.child.kill();
      await owner.exited.catch(() => undefined);
    }
    const contenders = [worker(root, 'create'), worker(root, 'create')];
    try {
      await Promise.all(contenders.map(entry => entry.ready));
      for (const entry of contenders) entry.child.stdin.end('create\n');
      expect(await Promise.all(contenders.map(entry => entry.exited))).toEqual([0, 0]);
      const receipts = contenders.map(entry => entry.rows[1]);
      expect(receipts.filter(entry => entry.status === 'created')).toHaveLength(1);
      expect(receipts.filter(entry => entry.status === 'rejected')).toMatchObject([{ error: expect.stringContaining('worktree_already_exists') }]);
      const retained = path.join(root, '.openclaw/worktrees/shared-worker/retained.txt');
      writeFileSync(retained, 'original-owner-effect');
      expect(() => createWorktreeService(root).create('shared-worker')).toThrow(/worktree_already_exists/);
      expect(readFileSync(retained, 'utf8')).toBe('original-owner-effect');
      const evidenceDir = path.join(process.cwd(), 'artifacts/runs/autonomy-resource-admission');
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(path.join(evidenceDir, `worktree-native-${randomUUID()}.json`), JSON.stringify({
        driven_by: 'agent', actor: 'codex-r1-worktree-native', liveOwner: owner.rows[0],
        liveLockRefused: true, ownerExit: owner.child.exitCode, contenders: receipts,
        retained: readFileSync(retained, 'utf8'),
        limits: ['local filesystem with two Node processes', 'does not prove full run-lifetime or budget admission'],
      }, null, 2) + '\n');
    } finally {
      for (const entry of contenders) if (entry.child.exitCode === null && entry.child.signalCode === null) entry.child.kill();
      await Promise.allSettled(contenders.map(entry => entry.exited));
    }
  }, 90_000);
});
