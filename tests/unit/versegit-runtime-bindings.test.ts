import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VerseGitBindingBridge, resolveVerseGitRepoIdentity } from '../../electron/gateway/versegit-bridge';
import { createVerseGitRuntimeBindingPortFromEnv } from '../../openclaw_runtime/src/plugin-sdk/versegit-binding-port';
import { clearVerseGitRuntimeBindingsForTest, endVerseGitRuntimeBindingForRun } from '../../openclaw_runtime/src/plugin-sdk/versegit-binding-registry';
import { runOrchestrationObserved } from '../../openclaw_runtime/src/agents/orchestrator-run-observed';
import { getRuntimeTraceBuffer } from '../../openclaw_runtime/src/observability/trace-buffer';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { clearVerseGitRuntimeBindingsForTest(); while (cleanup.length) await cleanup.pop()!(); });

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('no port'));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}
function git(cwd: string, args: string[]) { return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim(); }
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'versegit-c1-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'agent@example.invalid']);
  git(root, ['config', 'user.name', 'Agent']);
  writeFileSync(join(root, 'base.txt'), 'base\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'base']);
  const worktrees = [join(root, 'wt-a'), join(root, 'wt-b')];
  for (const path of worktrees) git(root, ['worktree', 'add', '--detach', path, 'HEAD']);
  return { root, worktrees };
}
async function startBridge(repoRoot: string, ownerId = 'agent:codex', epoch = 4) {
  const port = await freePort();
  const eventsPath = join(repoRoot, `events-${port}.jsonl`);
  const bridge = new VerseGitBindingBridge({ enabled: true, port, token: 'secret-token', ownerId, epoch, repoRoot, eventsPath });
  const address = await bridge.start();
  cleanup.push(() => bridge.stop());
  const env = { CLAWX_VERSGIT_BINDING_ENABLED: '1', CLAWX_VERSGIT_RUNTIME_BINDING_URL: address!, CLAWX_VERSGIT_BINDING_TOKEN: 'secret-token', CLAWX_VERSGIT_OWNER_ID: ownerId, CLAWX_VERSGIT_EPOCH: String(epoch) };
  return { bridge, runtime: createVerseGitRuntimeBindingPortFromEnv(env)!, eventsPath, address: address!, token: 'secret-token' };
}

describe('C1 VerseGit runtime binding lifecycle', () => {
  it('recognizes a C-drive junction and D-drive path as the same repository', () => {
    if (process.platform !== 'win32') return;
    const c = 'C:/Users/27933/Desktop/clawx/ClawX';
    const d = 'D:/ClawX';
    expect(existsSync(c)).toBe(true);
    expect(existsSync(d)).toBe(true);
    expect(resolveVerseGitRepoIdentity(c).repoId).toBe(resolveVerseGitRepoIdentity(d).repoId);
  });

  it('binds two worktrees through the production orchestrator and records attach/end', async () => {
    const { root } = makeRepo();
    const { runtime, eventsPath } = await startBridge(root);
    const spawned: string[] = [];
    const result = await runOrchestrationObserved(
      { task: 'implement two isolated changes', templateId: 'quick-development', maxWorkers: 2, graphMode: 'auto', isolation: 'worktree', orchestrationRunId: 'orch_c1', verseGitBindingPort: runtime },
      { agentSessionKey: 'agent:main:c1', workspaceDir: root },
      { spawn: (async (params: { cwd?: string }) => {
        const cwd = String(params.cwd);
        spawnSync(process.execPath, ['-e', 'process.stdout.write(process.cwd())'], { cwd, encoding: 'utf8', windowsHide: true });
        spawned.push(cwd); return { status: 'accepted', runId: `run_${spawned.length}`, childSessionKey: `child_${spawned.length}` };
      }) as never },
      { runId: 'trace_c1', sessionKey: 'agent:main:c1' },
    );
    expect(result.failures).toEqual([]);
    expect(spawned.length).toBeGreaterThanOrEqual(2);
    for (const outcome of result.outcomes) {
      const childRunId = outcome.verseGitBinding?.childRunId;
      if (childRunId) expect(await endVerseGitRuntimeBindingForRun(childRunId, 'completed')).toBeNull();
    }
    const events = readFileSync(eventsPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(events.filter((event) => event.kind === 'bound').length).toBeGreaterThanOrEqual(2);
    expect(events.filter((event) => event.kind === 'attached').length).toBeGreaterThanOrEqual(2);
    expect(events.filter((event) => event.kind === 'ended').length).toBeGreaterThanOrEqual(2);
    expect(new Set(events.filter((event) => event.kind === 'bound').map((event) => event.repoId)).size).toBe(1);
  });

  it('keeps the host flow running and records explicit degradation when VG is unavailable', async () => {
    const { root } = makeRepo();
    let spawned = 0;
    const unavailablePort = {
      bind: async () => { throw new Error('binding bridge unavailable'); },
      attach: async () => { throw new Error('binding bridge unavailable'); },
      end: async () => { throw new Error('binding bridge unavailable'); },
    };
    const result = await runOrchestrationObserved(
      { task: 'implement two isolated changes', templateId: 'quick-development', maxWorkers: 2, graphMode: 'auto', isolation: 'worktree', orchestrationRunId: 'orch_c1_degraded', verseGitBindingPort: unavailablePort },
      { agentSessionKey: 'agent:main:c1-degraded', workspaceDir: root },
      { spawn: (async () => { spawned += 1; return { status: 'accepted', runId: `degraded_run_${spawned}`, childSessionKey: `degraded_child_${spawned}` }; }) as never },
      { runId: 'trace_c1_degraded', sessionKey: 'agent:main:c1-degraded' },
    );
    expect(result.failures).toEqual([]);
    expect(spawned).toBeGreaterThanOrEqual(2);
    expect(result.outcomes.every((outcome) => outcome.verseGitBinding === undefined)).toBe(true);
    const trace = getRuntimeTraceBuffer().find((candidate) => candidate.runId === 'trace_c1_degraded');
    expect(trace?.events.some((event) => event.type === 'versegit.binding.unavailable')).toBe(true);
  });
  it('is idempotent for retry and rejects duplicate session, wrong owner/epoch/repo before binding', async () => {
    const { root, worktrees } = makeRepo();
    const { runtime, eventsPath, address, token } = await startBridge(root);
    const first = worktrees[0]!;
    const second = worktrees[1]!;
    const request = { requestId: 'retry-request', runId: 'run-c1', traceId: 'trace-c1', worktreePath: first, agentSessionId: 'agent-session-1', mode: 'M1' as const };
    const bound = await runtime.bind(request);
    const retried = await runtime.bind(request);
    expect(retried.bindingId).toBe(bound.bindingId);
    await expect(runtime.bind({ ...request, runId: 'run-c1-conflict' })).rejects.toMatchObject({ code: 'REQUEST_ID_CONFLICT' });
    await expect(runtime.bind({ ...request, requestId: 'duplicate-session', worktreePath: second })).rejects.toMatchObject({ code: 'DUPLICATE_SESSION' });
    await expect(runtime.bind({ ...request, requestId: 'unsupported-mode', agentSessionId: 'agent-session-mode', mode: 'M4' as never })).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' });
    await expect(runtime.attach({ bindingId: 'missing-binding', childSessionKey: 'missing-child', childRunId: 'missing-run' })).rejects.toMatchObject({ code: 'BINDING_MISMATCH' });

    const otherRepo = makeRepo();
    const other = await startBridge(otherRepo.root);
    await expect(other.runtime.bind({ ...request, requestId: 'cross-repo', worktreePath: second })).rejects.toMatchObject({ code: 'WORKSPACE_MISMATCH' });

    const wrongOwner = createVerseGitRuntimeBindingPortFromEnv({ CLAWX_VERSGIT_BINDING_ENABLED: '1', CLAWX_VERSGIT_RUNTIME_BINDING_URL: address, CLAWX_VERSGIT_BINDING_TOKEN: token, CLAWX_VERSGIT_OWNER_ID: 'agent:other', CLAWX_VERSGIT_EPOCH: '4' })!;
    await expect(wrongOwner.bind({ ...request, requestId: 'wrong-owner', agentSessionId: 'agent-session-2' })).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' });

    const wrongEpoch = createVerseGitRuntimeBindingPortFromEnv({ CLAWX_VERSGIT_BINDING_ENABLED: '1', CLAWX_VERSGIT_RUNTIME_BINDING_URL: address, CLAWX_VERSGIT_BINDING_TOKEN: token, CLAWX_VERSGIT_OWNER_ID: 'agent:codex', CLAWX_VERSGIT_EPOCH: '99' })!;
    await expect(wrongEpoch.bind({ ...request, requestId: 'wrong-epoch', agentSessionId: 'agent-session-3' })).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' });

    const attached = await runtime.attach({ bindingId: bound.bindingId, childSessionKey: 'child-session-1', childRunId: 'child-run-1' });
    expect(attached).toMatchObject({ bindingId: bound.bindingId, phase: 'attached', childSessionKey: 'child-session-1', childRunId: 'child-run-1' });
    const attachedRetry = await runtime.attach({ bindingId: bound.bindingId, childSessionKey: 'child-session-1', childRunId: 'child-run-1' });
    expect(attachedRetry.bindingId).toBe(bound.bindingId);
    await expect(runtime.attach({ bindingId: bound.bindingId, childSessionKey: 'child-session-2', childRunId: 'child-run-2' })).rejects.toMatchObject({ code: 'ALREADY_ATTACHED' });
    await expect(runtime.end({ bindingId: bound.bindingId, reason: 'unsupported' as never })).rejects.toMatchObject({ code: 'INVALID_END_REASON' });
    const ended = await runtime.end({ bindingId: bound.bindingId, reason: 'cancelled' });
    expect(ended.reason).toBe('cancelled');
    await expect(runtime.end({ bindingId: bound.bindingId, reason: 'cancelled' })).rejects.toMatchObject({ code: 'BINDING_ENDED' });
    await expect(runtime.attach({ bindingId: bound.bindingId, childSessionKey: 'child-session-1', childRunId: 'child-run-1' })).rejects.toMatchObject({ code: 'BINDING_ENDED' });
    await expect(runtime.bind(request)).rejects.toMatchObject({ code: 'BINDING_ENDED' });
    const events = readFileSync(eventsPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(events.filter((event) => event.kind === 'end_requested').length).toBeGreaterThanOrEqual(3);
    expect(events.some((event) => event.kind === 'ended' && event.reason === 'cancelled')).toBe(true);
    expect(events.some((event) => event.reason === 'idempotent-retry')).toBe(true);
    expect(events.some((event) => event.kind === 'end_rejected' && event.error === 'binding has already ended')).toBe(true);
  });
});
