import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { VerseGitFactAdapter, type VerseGitFactGrant, type VerseGitFactIdentity, type VerseGitFactTrigger } from '../../electron/services/versegit-fact-adapter';
import { VerseGitModule, contractDigestOf } from '../../electron/services/versegit-module';

const binaryPath = process.env.VERSEGIT_BINARY ?? 'D:/Projects/VerseGit/target/debug/vg.exe';
const workspacePath = process.env.VERSEGIT_PROVIDER_ROOT ?? 'D:/Projects/VerseGit';
const contract = JSON.parse(readFileSync('harness/specs/fixtures/versegit-planning-correction/mc1-evidence/contract.json', 'utf8'));
const binaryBytes = readFileSync(binaryPath);
const binaryDigest = createHash('sha256').update(binaryBytes).digest('hex');
const version = spawnSync(binaryPath, ['--version'], { cwd: workspacePath, encoding: 'utf8', windowsHide: true });
const capabilities = spawnSync(binaryPath, ['capabilities', '--json'], { cwd: workspacePath, encoding: 'buffer', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
if (version.status !== 0 || capabilities.status !== 0) throw new Error('real VG binary identity probe failed');
const capabilitiesDigest = createHash('sha256').update(capabilities.stdout).digest('hex');
const capabilityDocument = JSON.parse(capabilities.stdout.toString('utf8'));
const contractDigest = contractDigestOf(contract);
const identity: VerseGitFactIdentity = { repoId: 'repo-b1', worktreeId: 'worktree-b1', ownerId: 'agent:codex', epoch: 7, sessionId: 'agent-session-b1', vgSessionId: 'vg-session-b1' };
const trigger: VerseGitFactTrigger = { reason: 'two-worktrees', enabled: true, worktreeCount: 2, activeSessionCount: 1 };
const grant = (overrides: Partial<VerseGitFactGrant> = {}): VerseGitFactGrant => ({ mode: 'M1', authorizationId: 'grant-b1', ownerId: identity.ownerId, epoch: identity.epoch, repoId: identity.repoId, worktreeId: identity.worktreeId, capabilityDigest: capabilitiesDigest, expiresAt: '2099-01-01T00:00:00.000Z', revoked: false, ...overrides });

function adapter(options: { timeoutMs?: number; maxOutputBytes?: number; expectedBinarySha256?: string } = {}) {
  return new VerseGitFactAdapter({ binaryPath, workspacePath, expectedBinarySha256: binaryDigest, expectedVersion: version.stdout.trim(), expectedCapabilitiesDigest: capabilitiesDigest, contractDigest, ...options });
}

describe('B1 bounded VerseGit fact adapter', () => {
  it('TF-0775 confirms a silent native observation and reads back its session basis', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vg-observe-ack-'));
    const run = (args: string[]) => {
      const result = spawnSync(binaryPath, args, { cwd: root, encoding: 'utf8', windowsHide: true });
      expect(result.status).toBe(0);
      return result.stdout;
    };
    try {
      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'src/api.ts'), 'export const api = 1;\n');
      run(['init','--json']);
      const started = JSON.parse(run(['session','start','--actor','agent:codex','--worktree',root,'--client','codex-cli','--json']));
      const boundIdentity = { ...identity, vgSessionId: started.session_id };
      const facts = new VerseGitFactAdapter({ binaryPath, workspacePath: root, expectedBinarySha256: binaryDigest,
        expectedVersion: version.stdout.trim(), expectedCapabilitiesDigest: capabilitiesDigest, contractDigest });
      const observed = await facts.execute('observeRead', boundIdentity, grant({ mode: 'M2' }), trigger, { path: 'src/api.ts', lineStart: 1, lineEnd: 1 });
      expect(observed).toMatchObject({ status: 'observed', document: { acknowledgement: 'recorded', operation: 'observeRead' },
        observation: { exit_code: 0, stdout: { bytes: 0 }, effects: { fileRead: false, domainStateWrite: true } } });
      const shown = await facts.execute('sessionShow', boundIdentity, grant({ mode: 'M2' }), trigger);
      expect(shown.status).toBe('observed');
      expect(JSON.stringify(shown.document)).toContain('src/api.ts');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('matches the fixed binary through the production module for version and capabilities', async () => {
    const factAdapter = adapter();
    const module = new VerseGitModule({ binaryPath, contractDigest, expectedCapabilitiesDigest: capabilitiesDigest, factAdapter });
    expect(module.attach('M1', { mode: 'M1', authorizationId: 'grant-b1' }).ok).toBe(true);
    const versionResult = await module.readFact('version', identity, grant(), trigger);
    const capabilityResult = await module.readFact('capabilities', identity, grant(), trigger);
    expect(versionResult).toMatchObject({ status: 'observed', value: version.stdout.trim(), host_verdict: 'unchanged' });
    expect(versionResult.observation).toMatchObject({ process_started: true, pid: expect.any(Number), exit_code: 0, cwd_role: 'provider-workspace', effects: { domainStateWrite: false, workspaceWrite: false, execute: false } });
    expect(capabilityResult.status).toBe('observed');
    expect(capabilityResult.document).toEqual(capabilityDocument);
    expect(capabilityResult.observation.stdout.sha256).toBe(capabilitiesDigest);
    expect(capabilityResult.observation.pid_alive_after).toBe(false);
    expect(factAdapter.processCount).toBe(2);
  });

  it('rejects disabled, non-concurrent and malformed authority before any process starts', async () => {
    const factAdapter = adapter();
    const cases = [
      { name: 'disabled', operation: 'version' as const, trigger: { ...trigger, enabled: false }, grant: grant() },
      { name: 'no-concurrency', operation: 'version' as const, trigger: { ...trigger, worktreeCount: 1, activeSessionCount: 1 }, grant: grant() },
      { name: 'missing-auth', operation: 'version' as const, trigger, grant: grant({ authorizationId: '' }) },
      { name: 'owner-mismatch', operation: 'version' as const, trigger, grant: grant({ ownerId: 'other-owner' }) },
      { name: 'epoch-mismatch', operation: 'version' as const, trigger, grant: grant({ epoch: 8 }) },
      { name: 'repo-mismatch', operation: 'version' as const, trigger, grant: grant({ repoId: 'other-repo' }) },
      { name: 'expired', operation: 'version' as const, trigger, grant: grant({ expiresAt: '2000-01-01T00:00:00.000Z' }) },
      { name: 'revoked', operation: 'version' as const, trigger, grant: grant({ revoked: true }) },
      { name: 'capability-mismatch', operation: 'version' as const, trigger, grant: grant({ capabilityDigest: '0'.repeat(64) }) },
      { name: 'm1-m2-operation', operation: 'doctor' as const, trigger, grant: grant() },
    ];
    for (const entry of cases) {
      const result = await factAdapter.execute(entry.operation, identity, entry.grant, entry.trigger);
      expect(result.status, entry.name).not.toBe('observed');
      expect(result.observation.process_started, entry.name).toBe(false);
      expect(result.observation.pid, entry.name).toBeNull();
      expect(result.observation.effects.domainStateWrite, entry.name).toBe(false);
    }
    const badBinary = adapter({ expectedBinarySha256: '0'.repeat(64) });
    const digestResult = await badBinary.execute('version', identity, grant(), trigger);
    expect(digestResult).toMatchObject({ status: 'rejected_by_policy', observation: { process_started: false } });
  });

  it('kills timed-out and cancelled provider processes and leaves no owned PID alive', async () => {
    const timeoutAdapter = adapter({ timeoutMs: 1 });
    const timedOut = await timeoutAdapter.execute('capabilities', identity, grant(), trigger);
    expect(timedOut.status).toBe('degraded');
    expect(timedOut.observation.process_started).toBe(true);
    expect(timedOut.observation.timed_out || timedOut.observation.cancelled).toBe(true);
    expect(timedOut.observation.pid_alive_after).toBe(false);

    const cancelAdapter = adapter({ timeoutMs: 30000 });
    const controller = new AbortController();
    queueMicrotask(() => controller.abort());
    const cancelled = await cancelAdapter.execute('capabilities', identity, grant(), trigger, {}, controller.signal);
    expect(cancelled.status).toBe('degraded');
    expect(cancelled.observation.cancelled).toBe(true);
    expect(cancelled.observation.pid_alive_after).toBe(false);
  });

  it('bounds output and preserves unchanged host verdict plus fixed mode effects', async () => {
    const result = await adapter({ maxOutputBytes: 512 }).execute('capabilities', identity, grant(), trigger);
    expect(result.status).toBe('partial');
    expect(result.observation.stdout.truncated).toBe(true);
    expect(result.observation.stdout.bytes).toBeLessThanOrEqual(512);
    expect(result.host_verdict).toBe('unchanged');
    expect(result.observation.effects).toMatchObject({ process: true, domainStateWrite: false, workspaceWrite: false, gitObjectWrite: false, execute: false });
  });
});
