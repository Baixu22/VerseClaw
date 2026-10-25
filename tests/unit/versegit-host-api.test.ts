import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHostInvokeDispatcher } from '../../electron/main/ipc/host-invoke';
import { createVerseGitApi } from '../../electron/services/versegit-api';

const binaryPath = process.env.VERSEGIT_BINARY ?? join(process.cwd(), 'resources/bin/win32-x64/vg.exe');
const workspacePath = process.env.VERSEGIT_PROVIDER_ROOT ?? process.cwd();
const sidecarManifest = JSON.parse(readFileSync(join(process.cwd(), 'resources/versegit/manifest.json'), 'utf8'));
const binaryDigest = createHash('sha256').update(readFileSync(binaryPath)).digest('hex');
const version = spawnSync(binaryPath, ['--version'], { cwd: workspacePath, encoding: 'utf8', windowsHide: true });
const caps = spawnSync(binaryPath, ['capabilities', '--json'], { cwd: workspacePath, encoding: 'buffer', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
if (version.status !== 0 || caps.status !== 0) throw new Error('real binary identity probe failed');
const capabilitiesDigest = createHash('sha256').update(caps.stdout).digest('hex');
const binding = { workspaceId: 'workspace-b2', sessionId: 'session-b2', worktreeId: 'worktree-b2', ownerId: 'agent:codex', epoch: 3, mode: 'M1' as const };
const baseConfig = {
  enabled: true,
  binaryPath,
  workspacePath,
  expectedBinarySha256: binaryDigest,
  expectedVersion: version.stdout.trim(),
  expectedCapabilitiesDigest: capabilitiesDigest,
  contractDigest: sidecarManifest.provider.contractDigest,
  allowed: { ...binding, repoId: 'repo-b2', authorizationId: 'grant-b2', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false },
  worktreeCount: 2,
  activeSessionCount: 1,
};

describe('B2 VerseGit host diagnostics API', () => {
  it('returns real frozen provider identity without exposing argv or private paths', async () => {
    const result = await createVerseGitApi({ config: baseConfig }).status(binding);
    expect(result).toMatchObject({
      schema: 'clawx.versegit.host-diagnostics/v1',
      enabled: true,
      mode: 'M1',
      status: 'observed',
      hostVerdict: 'unchanged',
      identity: { repoId: 'repo-b2', binarySha256: binaryDigest, version: version.stdout.trim(), capabilitiesSchema: 'versegit.capabilities/v1' },
      capabilities: { safety: { default_enable: false }, verdict: { single_green_light: false } },
      observation: { processStarted: true, exitCode: 0, timedOut: false, cancelled: false },
    });
    expect(result.coverage.declared).toEqual(['version', 'capabilities']);
    expect(result.coverage.unobserved).toEqual(expect.arrayContaining(['shell', 'direct-fs', 'network', 'mcp']));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(binaryPath);
    expect(serialized).not.toContain('argv');
  });

  it('keeps disabled, unauthorized binding and binary mismatch fail-closed without process', async () => {
    const disabled = await createVerseGitApi({ config: { enabled: false } }).status(binding);
    expect(disabled).toMatchObject({ status: 'not_applicable', reason: 'disabled', observation: null, hostVerdict: 'unchanged' });
    const api = createVerseGitApi({ config: baseConfig });
    const unauthorized = await api.status({ ...binding, workspaceId: 'other-workspace' });
    expect(unauthorized).toMatchObject({ status: 'rejected_by_policy', reason: 'identity_mismatch', observation: null });
    expect(unauthorized.issues).toContain('workspace binding is not authorized');
    const badBinary = await createVerseGitApi({ config: { ...baseConfig, expectedBinarySha256: '0'.repeat(64) } }).status(binding);
    expect(badBinary).toMatchObject({ status: 'rejected_by_policy', observation: { processStarted: false } });
  });

  it('rejects an unauthorized host sender before calling the service', async () => {
    const api = createVerseGitApi({ config: baseConfig });
    const dispatch = createHostInvokeDispatcher({ versegit: api }, { senderAuth: { allowedWebContentsIds: new Set([42]) } });
    const denied = await dispatch({ id: 'b2-sender-1', module: 'versegit', action: 'status', payload: binding }, { sender: { id: 99 } });
    expect(denied).toMatchObject({ id: 'b2-sender-1', ok: false, error: { code: 'VALIDATION', message: 'Host request sender is not authorized' } });
  });

  it('rejects revoked and expired grants before provider process start', async () => {
    const revokedApi = createVerseGitApi({ config: { ...baseConfig, allowed: { ...baseConfig.allowed, revoked: true } } });
    const revoked = await revokedApi.status(binding);
    expect(revoked.status).toBe('rejected_by_policy');
    expect(revoked.observation?.processStarted ?? false).toBe(false);
    const expiredApi = createVerseGitApi({ config: { ...baseConfig, allowed: { ...baseConfig.allowed, expiresAt: '2000-01-01T00:00:00.000Z' } } });
    const expired = await expiredApi.status(binding);
    expect(expired.status).toBe('rejected_by_policy');
    expect(expired.observation?.processStarted ?? false).toBe(false);
  });
});
