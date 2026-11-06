// @vitest-environment node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireSymbolLease, releaseSymbolLease, type SymbolLease } from '../../openclaw_runtime/src/context-engine/factstore/symbol-lease';

describe('TF-0679 native lease owner fencing', () => {
  it('retains an expired live owner, then reclaims only after its actual process exits', async () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'autonomy-r1-owner-'));
    const effectsPath = path.join(workspaceRoot, 'effects.txt');
    const fixture = path.join(process.cwd(), 'tests/unit/fixtures/autonomy-resource-lease-worker.mts');
    const child = spawn(process.execPath, ['--import', 'tsx', fixture,
      Buffer.from(JSON.stringify({ workspaceRoot, effectsPath }), 'utf8').toString('base64')], {
      cwd: path.join(process.cwd(), 'openclaw_runtime'), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });
    let replacement: SymbolLease | undefined;
    try {
      const started = await new Promise<{ pid: number; result: { ok: true; lease: SymbolLease } }>((resolve, reject) => {
        let output = '';
        child.stdout.on('data', chunk => {
          output += String(chunk);
          if (!output.includes('\n')) return;
          try { resolve(JSON.parse(output.split('\n')[0])); } catch (error) { reject(error); }
        });
        child.once('error', reject);
        child.once('exit', () => reject(new Error('Owner exited before its receipt: ' + stderr)));
      });
      expect(started.pid).toBe(child.pid);
      process.kill(started.pid, 0);
      const blocked = acquireSymbolLease({ workspaceRoot, holderId: 'replacement', symbolName: 'shared', mode: 'wal', nowMs: 111 });
      expect(blocked).toMatchObject({ ok: false, reason: 'fenced' });
      const forgedRelease = releaseSymbolLease({ workspaceRoot, holderId: 'native-owner', symbolName: 'shared',
        mode: 'wal', leaseId: started.result.lease.leaseId });
      expect(forgedRelease).toBe(false);
      const beforeExitWal = readFileSync(path.join(workspaceRoot, '.openclaw/leases/symbol-leases.wal.jsonl'), 'utf8');
      expect(beforeExitWal).toContain('"op":"fence"');
      expect(readFileSync(effectsPath, 'utf8')).toBe('native-owner-started\n');
      child.stdin.end('exit\n');
      const exitCode = await exited;
      expect(exitCode, stderr).toBe(0);
      const admitted = acquireSymbolLease({ workspaceRoot, holderId: 'replacement', symbolName: 'shared', mode: 'wal', nowMs: 112 });
      expect(admitted.ok).toBe(true);
      if (!admitted.ok) throw new Error('Exited owner was not reclaimed');
      replacement = admitted.lease;
      expect(replacement.leaseId).not.toBe(started.result.lease.leaseId);
      expect(replacement.owner?.pid).toBe(process.pid);
      const oldRelease = releaseSymbolLease({ workspaceRoot, holderId: 'native-owner', symbolName: 'shared',
        mode: 'wal', leaseId: started.result.lease.leaseId });
      expect(oldRelease).toBe(false);
      const afterExitWal = readFileSync(path.join(workspaceRoot, '.openclaw/leases/symbol-leases.wal.jsonl'), 'utf8');
      const evidenceDir = path.join(process.cwd(), 'artifacts/runs/autonomy-resource-admission');
      mkdirSync(evidenceDir, { recursive: true });
      const evidencePath = path.join(evidenceDir, 'native-owner-' + randomUUID() + '.json');
      writeFileSync(evidencePath, JSON.stringify({ driven_by: 'agent', actor: 'codex-r1-native-owner-test',
        nativeOwner: started, liveOwnerRefused: blocked, forgedRelease, exitCode, admitted,
        oldRelease, beforeExitWal, afterExitWal, effects: readFileSync(effectsPath, 'utf8'),
        limits: ['agent-injected expiry clock; actual native process and WAL', 'this case does not measure aggregate provider budgets or full TF-0679'],
      }, null, 2) + '\n');
      console.log('R1 native lease evidence: ' + evidencePath);
    } finally {
      if (replacement) releaseSymbolLease({ workspaceRoot, holderId: 'replacement', symbolName: 'shared', mode: 'wal', leaseId: replacement.leaseId });
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited.catch(() => undefined);
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  }, 90_000);
});
