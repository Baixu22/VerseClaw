// @vitest-environment node
// Real exec/SQLite/effect/archive integration with owner registry fixture only.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fsAsync from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { runTaskLoopVerificationCheck, readTaskLoopVerificationReceipt, taskLoopVerificationSandbox } from '../../openclaw_runtime/src/agents/task-loop-verification';
import type { SandboxContext } from '../../openclaw_runtime/src/agents/sandbox/types';
import { createSandboxFsBridge } from '../../openclaw_runtime/src/agents/sandbox/fs-bridge';
import { captureTaskLoopCompletionCheckpoint, readTaskLoopCompletionContext } from '../../openclaw_runtime/src/agents/task-loop-completion';
import { recordLongTaskCheckpoint } from '../../openclaw_runtime/src/agents/long-task-control/store';
import { updateSessionStore } from '../../openclaw_runtime/src/config/sessions/store';
import { closeSqliteSessionStoreDatabase } from '../../openclaw_runtime/src/config/sessions/store-sqlite';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { resetProcessRegistryForTests } from '../../openclaw_runtime/src/agents/bash-process-registry';
import { subagentRuns } from '../../openclaw_runtime/src/agents/subagent-registry-memory';
import type { SubagentRunRecord } from '../../openclaw_runtime/src/agents/subagent-registry.types';
import type { TaskLoopRunRecord } from '../../openclaw_runtime/src/agents/task-loop-controller';
import type { OpenClawConfig } from '../../openclaw_runtime/src/config/types.openclaw';
import { normalizeTaskCompletionCheckPlans } from '../../shared/task-ledger-completion';
import { readTaskCompletionCandidate, readTaskExecutionCandidate } from '../../shared/task-ledger-candidate';
import { taskLedgerDigest } from '../../shared/task-ledger-journal';
import { setRuntimeConfigSnapshot, clearRuntimeConfigSnapshot } from '../../openclaw_runtime/src/config/runtime-snapshot';

let temp: string, source: string, home: string;
const key = 'agent:main:a3-verification-parent', child = 'agent:main:a3-verification-reviewer';
beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), 'clawx-a3-verification-')); source = join(temp, 'source'); home = join(temp, 'home');
  mkdirSync(source); mkdirSync(home);
  vi.stubEnv('OPENCLAW_STATE_DIR', home); vi.stubEnv('OPENCLAW_CONFIG_DIR', home); vi.stubEnv('OPENCLAW_CONTEXT_ARCHIVE_DIR', join(home, 'archives'));
});
afterEach(() => { vi.restoreAllMocks(); clearRuntimeConfigSnapshot(); subagentRuns.clear(); resetProcessRegistryForTests(); closeOpenClawStateDatabaseForTest(); closeSqliteSessionStoreDatabase(join(home, 'sessions.json')); vi.unstubAllEnvs(); rmSync(temp, { recursive: true, force: true, maxRetries: 5 }); });

async function fixture(options: { script?: string; security?: 'full' | 'deny'; host?: 'gateway' | 'sandbox' | 'node';
  discordPolicy?: boolean; senderPolicy?: boolean; accountPolicy?: boolean; spawned?: boolean; separateWorktree?: boolean; providerPolicy?: 'global' | 'agent' | 'model' | 'override' } = {}) {
  const git = (args: string[]) => execFileSync('git', args, { cwd: source, windowsHide: true, stdio: 'pipe' });
  git(['init', '--initial-branch=main']); git(['config', 'user.email', 'agent@example.invalid']); git(['config', 'user.name', 'Agent']);
  writeFileSync(join(source, 'source.txt'), 'candidate-contract');
  writeFileSync(join(source, 'verify.cjs'), options.script ?? 'const fs=require("node:fs"); const assert=require("node:assert/strict"); assert.equal(fs.readFileSync("source.txt","utf8"),"candidate-contract"); fs.appendFileSync(process.argv[2],"run\\n"); console.log("A3 actual check passed");\n');
  if (options.spawned) { mkdirSync(join(source, 'checks')); writeFileSync(join(source, 'checks', 'source.txt'), 'candidate-contract'); }
  git(['add', '.']); git(['commit', '-m', 'isolated verification candidate']);
  if (options.separateWorktree) {
    git(['worktree', 'add', '--detach', join(home, 'task-worktree')]);
  }
  const taskCwd = options.separateWorktree ? join(home, 'task-worktree') : options.spawned ? join(source, 'checks') : source;
  const programRoot = options.separateWorktree ? taskCwd : source;
  const parentKey = options.discordPolicy ? 'agent:main:discord:channel:channel-17' : options.accountPolicy || options.senderPolicy ? 'agent:main:telegram:group:-100123' : key;
  const store = join(home, 'sessions.json');
  await updateSessionStore(store, entries => {
    entries[parentKey] = { sessionId: 'parent-generation-a3', updatedAt: Date.now(), workspaceDir: options.spawned ? home : source,
      ...(options.discordPolicy ? { space: 'guild-99', groupId: 'channel-17', groupChannel: '#restricted', origin: { provider: 'discord', accountId: 'work', chatType: 'channel' as const, senderId: 'sender-42' } } : {}),
      ...(options.accountPolicy || options.senderPolicy ? { origin: { provider: 'telegram', accountId: 'work', chatType: 'group' as const, to: '-100123', senderId: 'sender-42', senderUsername: 'current-sender' } } : {}),
      ...(options.spawned || options.separateWorktree ? { spawnedWorkspaceDir: source, spawnedCwd: taskCwd } : {}),
      ...(options.providerPolicy ? { modelProvider: options.providerPolicy === 'override' ? 'anthropic' : 'openai', model: 'gpt-4.1' } : {}),
      ...(options.providerPolicy === 'override' ? { providerOverride: 'openai', modelOverride: 'gpt-4.1' } : {}) };
    entries[child] = { sessionId: 'reviewer-generation-a3', updatedAt: Date.now(), workspaceDir: source,
      ...(options.spawned || options.separateWorktree ? { spawnedWorkspaceDir: source, spawnedCwd: taskCwd } : {}) };
  });
  const denyExec = { deny: ['exec'] };
  const cfg: OpenClawConfig = { session: { store }, agents: { defaults: { workspace: source },
      ...(options.providerPolicy === 'agent' ? { list: [{ id: 'main', tools: { byProvider: { openai: denyExec } } }] } : {}) },
    tools: { exec: { host: options.host ?? 'gateway', security: options.security ?? 'full', ask: 'off' },
      ...(options.providerPolicy && options.providerPolicy !== 'agent' ? { byProvider: { [options.providerPolicy === 'model' ? 'openai/gpt-4.1' : 'openai']: denyExec } } : {}) } };
  if (options.accountPolicy) cfg.channels = { telegram: { botToken: 'agent-fixture', groups: { '*': { tools: { allow: ['exec'] } } }, accounts: { work: { botToken: 'agent-fixture', groups: { '*': { tools: { deny: ['exec'] } } } } } } };
  if (options.discordPolicy) cfg.channels = { discord: { token: 'agent-fixture', guilds: { 'guild-99': { channels: { 'channel-17': { tools: { deny: ['exec'] } } } } } } };
  if (options.senderPolicy) cfg.tools!.toolsBySender = { 'channel:telegram:sender-42': { deny: ['exec'] }, '*': { allow: ['exec'] } };
  setRuntimeConfigSnapshot(cfg);
  const command = process.platform === 'win32' ? "& '" + process.execPath.replaceAll("'", "''") + "' '" + join(programRoot, 'verify.cjs').replaceAll("'", "''") + "' '" + join(home, 'executions.txt').replaceAll("'", "''") + "'; exit $LASTEXITCODE"
    : "'" + process.execPath + "' '" + join(programRoot, 'verify.cjs') + "' '" + join(home, 'executions.txt') + "'";
  const acceptance = ['source contract matches the candidate'];
  const context = await readTaskLoopCompletionContext({ workspaceId: 'verification-workspace', sessionKey: parentKey, acceptance, verificationChecks: [{ acceptanceIndex: 0, command }] }, cfg);
  const run = (id: string, verifier: boolean) => ({ runId: id, requesterSessionKey: parentKey, requesterSessionId: 'parent-generation-a3',
    childSessionKey: verifier ? child : 'agent:main:a3-worker', workspaceDir: source, endedAt: Date.now(), outcome: { status: 'ok' },
    orchestration: { orchestrationRunId: 'a3-orchestration', phase: verifier ? 'verifier' : 'worker', isVerifier: verifier,
      ...(verifier ? { expectedWorkerRunIds: ['a3-worker'], verificationVerdict: 'pass',
        completionReview: { state: 'pinned', workspaceRoot: source, executionWorkdir: context!.executionWorkdir,
          candidate: readTaskExecutionCandidate(source, context!.executionWorkdir, taskLedgerDigest(cfg)), capturedAt: Date.now() } } : {}) },
  }) as SubagentRunRecord;
  const reviewer = run('a3-reviewer', true); subagentRuns.set(reviewer.runId, reviewer);
  const record = { loopRunId: 'a3-loop', task: 'A3 verification task', sessionKey: parentKey, workspaceId: 'verification-workspace', taskLedgerRootId: 'a3-business-task',
    status: 'complete', evidenceGate: { status: 'pass' }, orchestrationRunIds: ['a3-orchestration'], completionContext: context } as TaskLoopRunRecord;
  const checkpoint = await captureTaskLoopCompletionCheckpoint({ record, checkpointId: 'actual-verification-checkpoint', cfg, subagents: [run('a3-worker', false), reviewer], selfCheck: { decision: 'complete' } as never, now: Date.now() });
  if (!checkpoint) throw new Error('Fixture completion context was unavailable');
  recordLongTaskCheckpoint({ id: checkpoint.checkpointId, sessionKey: parentKey, workspaceId: record.workspaceId!, runId: record.loopRunId, taskLedgerRootId: record.taskLedgerRootId,
    trigger: 'guide', status: 'complete', metadata: { taskCompletion: checkpoint, status: 'complete', evidenceGate: { status: 'pass' }, selfCheckDecision: 'complete' } });
  return { cfg, checkpoint, input: { workspaceId: 'verification-workspace', sessionKey: parentKey, checkpointId: checkpoint.checkpointId, checkId: checkpoint.requiredCheckIds[0], verificationRunId: 'persisted-verification-run' } };
}

describe('TF-0672 actual process verification producer', () => {
  it('waits for a real check longer than the default background yield window', async () => {
    const data = await fixture({ script: 'setTimeout(()=>{require("node:fs").appendFileSync(process.argv[2],"slow-run\\n");console.log("A3 delayed check finished");},12000);\n' });
    try {
      const result = await runTaskLoopVerificationCheck(data.input, data.cfg);
      expect(result, JSON.stringify(result)).toMatchObject({ state: 'completed', replayed: false, receipt: { status: 'verified', exitCode: 0 } });
      expect(readFileSync(join(home, 'executions.txt'), 'utf8')).toBe('slow-run\n');
    } finally {
      // If the desired assertion fails on the pre-fix factory, let that actual
      // 12-second child exit before the fixture removes its isolated directory.
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }, 90_000);
  it.each(['ro', 'rw'] as const)('retains actual exec/effect/archive for a %s sandbox adapter fixture', async workspaceAccess => {
    const data = await fixture({ host: 'sandbox' });
    const seen: string[] = [];
    // Agent-driven adapter simulation: an actual child runs the unchanged
    // frozen command, but this does not prove Docker isolation or mount setup.
    const sandbox: SandboxContext = { enabled: true, sessionKey: key, backendId: 'docker', runtimeId: 'agent-simulated-sandbox', runtimeLabel: 'agent-simulated-sandbox', browserAllowHostControl: false, containerName: 'agent-simulated-sandbox',
      workspaceAccess, workspaceDir: workspaceAccess === 'ro' ? home : source, agentWorkspaceDir: source, containerWorkdir: '/workspace',
      docker: { env: {}, image: 'agent-simulated-backend', containerPrefix: 'agent-simulated-', workdir: '/workspace', readOnlyRoot: true, tmpfs: [], network: 'none', capDrop: ['ALL'] }, tools: { allow: ['exec', 'process'], deny: [] }, backend: {
        id: 'docker', runtimeId: 'agent-simulated-sandbox', runtimeLabel: 'agent-simulated-sandbox', workdir: '/workspace',
        runShellCommand: async () => { throw new Error('Adapter fixture does not implement sandbox filesystem commands'); },
        buildExecSpec: async (input: { command: string; workdir?: string }) => {
          seen.push(input.workdir ?? '');
          const shell = process.platform === 'win32' ? join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : '/bin/sh';
          return { argv: [shell, ...(process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command'] : ['-c']), input.command], env: process.env, stdinMode: 'pipe-closed' as const };
        },
      },
    };
    sandbox.fsBridge = createSandboxFsBridge({ sandbox });
    const module = await import('../../openclaw_runtime/src/agents/sandbox');
    vi.spyOn(module, 'resolveSandboxContext').mockResolvedValue(sandbox);
    const result = await runTaskLoopVerificationCheck(data.input, data.cfg);
    expect(result, JSON.stringify(result)).toMatchObject({ state: 'completed', receipt: { status: 'verified', exitCode: 0 } });
    expect(seen).toEqual([workspaceAccess === 'ro' ? '/agent' : '/workspace']);
    const artifact = JSON.parse(readFileSync(fileURLToPath(result.receipt!.artifactRefs[0].path!), 'utf8'));
    expect(JSON.stringify(artifact)).toContain('agent-simulated-sandbox');
    expect(readFileSync(join(home, 'executions.txt'), 'utf8')).toBe('run\n');
  }, 90_000);
  it('uses the original rw or readonly project mount and rejects a copied/different candidate', () => {
    const base = { enabled: true, backendId: 'docker', workspaceAccess: 'rw', workspaceDir: source, agentWorkspaceDir: source, containerWorkdir: '/workspace' } as SandboxContext;
    expect(taskLoopVerificationSandbox(base, source)).toBe(base);
    const readonly = { ...base, workspaceAccess: 'ro' as const, workspaceDir: home };
    expect(taskLoopVerificationSandbox(readonly, source)).toMatchObject({ workspaceAccess: 'ro', workspaceDir: source, containerWorkdir: '/agent' });
    expect(readonly.workspaceDir).toBe(home);
    expect(() => taskLoopVerificationSandbox({ ...base, workspaceDir: home }, source)).toThrow('different candidate');
    expect(() => taskLoopVerificationSandbox({ ...base, workspaceAccess: 'none' }, source)).toThrow('exact local candidate');
    expect(() => taskLoopVerificationSandbox({ ...base, agentWorkspaceDir: home }, source)).toThrow('exact local candidate');
    expect(() => taskLoopVerificationSandbox({ ...base, backendId: 'ssh' }, source)).toThrow('exact local candidate');
  });
  it('runs the frozen program once, reopens its owner rows and invalidates a tampered artifact', async () => {
    const data = await fixture();
    const result = await runTaskLoopVerificationCheck(data.input, data.cfg);
    expect(result, JSON.stringify(result)).toMatchObject({ replayed: false, state: 'completed', receipt: { owner: 'task-loop-exec-effect', status: 'verified', exitCode: 0 } });
    expect(readFileSync(join(home, 'executions.txt'), 'utf8')).toBe('run\n');
    closeOpenClawStateDatabaseForTest();
    const reread = await readTaskLoopVerificationReceipt(data.input.verificationRunId, data.checkpoint);
    expect(reread).toEqual(result.receipt);
    expect((await runTaskLoopVerificationCheck(data.input, data.cfg)).replayed).toBe(true);
    expect(readFileSync(join(home, 'executions.txt'), 'utf8')).toBe('run\n');
    writeFileSync(fileURLToPath(reread!.artifactRefs[0].path!), 'tampered');
    expect(await readTaskLoopVerificationReceipt(data.input.verificationRunId, data.checkpoint)).toBeNull();
  }, 90_000);

  it('keeps the digest of the validated archive buffer when its file changes after the read', async () => {
    const data = await fixture();
    const executed = await runTaskLoopVerificationCheck(data.input, data.cfg);
    const file = fileURLToPath(executed.receipt!.artifactRefs[0].path!);
    const original = readFileSync(file);
    const read = fsAsync.readFile.bind(fsAsync);
    vi.spyOn(fsAsync, 'readFile').mockImplementation((async (...args: Parameters<typeof fsAsync.readFile>) => {
      const bytes = await read(...args);
      if (String(args[0]) === file) writeFileSync(file, 'replacement after validated read');
      return bytes;
    }) as never);
    const receipt = await readTaskLoopVerificationReceipt(data.input.verificationRunId, data.checkpoint);
    expect(receipt).not.toBeNull();
    expect(receipt!.artifactRefs[0].sha256).toBe(createHash('sha256').update(original).digest('hex'));
    expect(receipt!.artifactRefs[0].sha256).not.toBe(createHash('sha256').update(readFileSync(file)).digest('hex'));
  }, 90_000);

  it('rejects a missing or corrupt raw-output archive linked by the check owner', async () => {
    const data = await fixture();
    const executed = await runTaskLoopVerificationCheck(data.input, data.cfg);
    expect(executed.receipt!.artifactRefs).toHaveLength(2);
    const rawFile = fileURLToPath(executed.receipt!.artifactRefs[1].path!);
    const original = readFileSync(rawFile);
    writeFileSync(rawFile, 'corrupt raw output');
    expect(await readTaskLoopVerificationReceipt(data.input.verificationRunId, data.checkpoint)).toBeNull();
    writeFileSync(rawFile, original);
    expect(await readTaskLoopVerificationReceipt(data.input.verificationRunId, data.checkpoint)).not.toBeNull();
    rmSync(rawFile);
    expect(await readTaskLoopVerificationReceipt(data.input.verificationRunId, data.checkpoint)).toBeNull();
  }, 90_000);

  it('retains verbose output beyond the poll buffer without marking complete archives unavailable', async () => {
    const data = await fixture({ script: 'console.log("v".repeat(40000));\n' });
    const result = await runTaskLoopVerificationCheck(data.input, data.cfg);
    expect(result).toMatchObject({ state: 'completed', receipt: { status: 'verified', exitCode: 0 } });
    expect(result.receipt!.artifactRefs).toHaveLength(2);
  }, 90_000);

  it('keeps execution evidence out of resume and rollback checkpoint selection', async () => {
    const data = await fixture();
    const { getLatestLongTaskCheckpoint, listLongTaskCheckpoints } = await import('../../openclaw_runtime/src/agents/long-task-control/store');
    const before = getLatestLongTaskCheckpoint(key);
    await runTaskLoopVerificationCheck(data.input, data.cfg);
    expect(getLatestLongTaskCheckpoint(key)?.id).toBe(before?.id);
    expect(listLongTaskCheckpoints(key).every(row => !row.id.startsWith('task-loop-check:'))).toBe(true);
  }, 90_000);

  it('serializes two same-run requests without replaying the effect', async () => {
    const data = await fixture();
    const settled = await Promise.allSettled([runTaskLoopVerificationCheck(data.input, data.cfg), runTaskLoopVerificationCheck(data.input, data.cfg)]);
    const rejected = settled.filter(item => item.status === 'rejected').map(item => String((item as PromiseRejectedResult).reason));
    expect(rejected, JSON.stringify(rejected)).toEqual([]);
    const results = settled.map(item => (item as PromiseFulfilledResult<Awaited<ReturnType<typeof runTaskLoopVerificationCheck>>>).value);
    expect(results.filter(item => !item.replayed)).toHaveLength(1);
    expect(results.find(item => !item.replayed)?.receipt?.status).toBe('verified');
    expect(readFileSync(join(home, 'executions.txt'), 'utf8')).toBe('run\n');
  }, 90_000);

  it('keeps a real nonzero check failed and invalidates a changed policy candidate', async () => {
    const data = await fixture({ script: 'console.log("negative check"); process.exitCode=7;\n' });
    expect(await runTaskLoopVerificationCheck(data.input, data.cfg)).toMatchObject({ state: 'completed', receipt: { status: 'failed', exitCode: 7 } });
    expect(existsSync(join(home, 'executions.txt'))).toBe(false);
    const denied = { ...data.cfg, tools: { exec: { host: 'gateway' as const, security: 'deny' as const, ask: 'off' as const } } };
    setRuntimeConfigSnapshot(denied);
    await expect(runTaskLoopVerificationCheck({ ...data.input, verificationRunId: 'new-denied-run' }, denied)).rejects.toThrow('Candidate changed');
  }, 90_000);

  it('waits for approval and retains the approved foreground execution receipt', async () => {
    const data = await fixture();
    await updateSessionStore(join(home, 'sessions.json'), entries => { entries[key].execAsk = 'always'; });
    const gateway = await import('../../openclaw_runtime/src/agents/tools/gateway');
    let approve!: () => void;
    let waiting!: () => void;
    const decision = new Promise<void>(resolve => { approve = resolve; });
    const requested = new Promise<void>(resolve => { waiting = resolve; });
    vi.spyOn(gateway, 'callGatewayTool').mockImplementation((async (method: string, _options: unknown, params: { id: string }) => {
      if (method === 'exec.approval.request') return { id: params.id, expiresAtMs: Date.now() + 120_000 };
      if (method === 'exec.approval.waitDecision') { waiting(); await decision; return { decision: 'allow-once' }; }
      throw new Error('Unexpected approval method: ' + method);
    }) as never);
    const pending = runTaskLoopVerificationCheck(data.input, data.cfg);
    try {
      await Promise.race([requested, pending.then(result => { throw new Error('Verification did not wait for approval: ' + JSON.stringify(result)); })]);
      expect(existsSync(join(home, 'executions.txt'))).toBe(false);
      approve();
      const result = await pending;
      expect(result).toMatchObject({ state: 'completed', replayed: false, receipt: { status: 'verified', exitCode: 0 } });
      expect(readFileSync(join(home, 'executions.txt'), 'utf8')).toBe('run\n');
      expect((await runTaskLoopVerificationCheck(data.input, data.cfg)).replayed).toBe(true);
    } finally { approve(); await pending; }
  }, 90_000);

  it('uses the controller session denial instead of a permissive global policy', async () => {
    const data = await fixture();
    await updateSessionStore(join(home, 'sessions.json'), entries => {
      entries[key].execSecurity = 'deny'; entries[key].execAsk = 'always';
    });
    const result = await runTaskLoopVerificationCheck(data.input, data.cfg);
    expect(result.state).toBe('unavailable');
    expect(result.receipt).toBeNull();
    expect(existsSync(join(home, 'executions.txt'))).toBe(false);
  }, 90_000);

  it('preserves the existing exec denial policy and produces no process receipt', async () => {
    const data = await fixture({ security: 'deny' });
    const result = await runTaskLoopVerificationCheck(data.input, data.cfg);
    expect(result).toMatchObject({ state: 'unavailable', receipt: null });
    expect(result.reason).toContain('denied');
    expect(existsSync(join(home, 'executions.txt'))).toBe(false);
  }, 90_000);

  it('never runs a new program, a stale candidate or an unknown reviewer', async () => {
    const data = await fixture();
    await expect(runTaskLoopVerificationCheck({ ...data.input, checkId: 'caller-selected-check' }, data.cfg)).rejects.toThrow('not frozen');
    subagentRuns.clear(); await expect(runTaskLoopVerificationCheck(data.input, data.cfg)).rejects.toThrow('reviewer owner');
    subagentRuns.set('a3-reviewer', { requesterSessionKey: 'forged' } as SubagentRunRecord);
    await expect(runTaskLoopVerificationCheck(data.input, data.cfg)).rejects.toThrow('reviewer owner');
    writeFileSync(join(source, 'source.txt'), 'changed');
    await expect(runTaskLoopVerificationCheck(data.input, data.cfg)).rejects.toThrow('Candidate changed');
    expect(existsSync(join(home, 'executions.txt'))).toBe(false);
  });

  it('requires full checklist coverage when freezing verification programs', () => {
    expect(() => normalizeTaskCompletionCheckPlans([{ acceptanceIndex: 0, command: 'echo partial' }], ['a', 'b'])).toThrow('exactly once');
    expect(() => normalizeTaskCompletionCheckPlans([{ acceptanceIndex: 0, command: 'echo x', passed: true }], ['a'])).toThrow('only');
    expect(() => normalizeTaskCompletionCheckPlans([{ acceptanceIndex: 1, command: 'echo wrong' }], ['a'])).toThrow('existing acceptance');
  });
});

describe('TF-0672 frozen execution and session owners', () => {
  it.each(['command', 'workdir'])('rejects a hook changing frozen %s before an admitted receipt', async change => {
    const data = await fixture();
    writeFileSync(join(home, 'source.txt'), 'candidate-contract');
    const hooks = await import('../../openclaw_runtime/src/plugins/hook-runner-global');
    vi.spyOn(hooks, 'getGlobalHookRunner').mockReturnValue({
      hasHooks: (name: string) => name === 'before_tool_call',
      runBeforeToolCall: async (event: { params: Record<string, unknown> }) => ({ params: { ...event.params, ...(change === 'command' ? { command: process.platform === 'win32' ? 'exit 0' : 'true' } : { workdir: home }) } }),
    } as never);
    const result = await runTaskLoopVerificationCheck(data.input, data.cfg);
    expect(result, JSON.stringify(result)).toMatchObject({ receipt: null, state: 'unavailable' });
    expect(existsSync(join(home, 'executions.txt'))).toBe(false);
  }, 90_000);
  it('keeps the later resume task root after verifying a previous checkpoint', async () => {
    const data = await fixture();
    const store = await import('../../openclaw_runtime/src/agents/long-task-control/store');
    store.recordLongTaskCheckpoint({ id: 'newer-active-checkpoint', sessionKey: key, workspaceId: 'verification-workspace', taskLedgerRootId: 'newer-active-task', runId: 'newer-loop', trigger: 'guide', status: 'running' });
    expect(store.getLatestLongTaskLedgerRootId(key)).toBe('newer-active-task');
    const result = await runTaskLoopVerificationCheck(data.input, data.cfg);
    expect(result.receipt?.status, JSON.stringify(result)).toBe('verified');
    expect(store.getLatestLongTaskLedgerRootId(key)).toBe('newer-active-task');
  }, 90_000);
});

describe('TF-0672 effective controller context', () => {
  it.each(['global', 'agent', 'model', 'override'] as const)('preserves %s provider tool denial before dispatch', async providerPolicy => {
    const data = await fixture({ providerPolicy });
    const result = await runTaskLoopVerificationCheck(data.input, data.cfg);
    expect(result, JSON.stringify(result)).toMatchObject({ state: 'unavailable', receipt: null });
    expect(result.reason).toContain('controller tool policy');
    expect(existsSync(join(home, 'executions.txt'))).toBe(false);
  }, 90_000);
  it('rejects the unsupported remote target before calling its execution owner', async () => {
    const data = await fixture({ host: 'node' });
    const nodeHost = await import('../../openclaw_runtime/src/agents/bash-tools.exec-host-node');
    const execute = vi.spyOn(nodeHost, 'executeNodeHostCommand');
    const result = await runTaskLoopVerificationCheck(data.input, data.cfg);
    expect(result).toMatchObject({ state: 'unavailable', receipt: null });
    expect(result.reason).toContain('Remote verification');
    expect(execute).not.toHaveBeenCalled();
    expect(existsSync(join(home, 'executions.txt'))).toBe(false);
  }, 90_000);
  it('binds the spawned workspace and executes in its persisted task cwd', async () => {
    const data = await fixture({ spawned: true });
    const context = await readTaskLoopCompletionContext({ workspaceId: data.input.workspaceId, sessionKey: key }, data.cfg);
    expect(context).toMatchObject({ workspaceRoot: source, executionWorkdir: join(source, 'checks') });
    expect(data.checkpoint.executionWorkdir).toBe(join(source, 'checks'));
    const result = await runTaskLoopVerificationCheck(data.input, data.cfg);
    expect(result, JSON.stringify(result)).toMatchObject({ state: 'completed', receipt: { status: 'verified', exitCode: 0 } });
    expect(readFileSync(join(home, 'executions.txt'), 'utf8')).toBe('run\n');
    const archive = JSON.parse(readFileSync(fileURLToPath(result.receipt!.artifactRefs[0].path!), 'utf8'));
    expect(JSON.stringify(archive)).toContain('executionWorkdir');
  }, 90_000);
  it('rejects a changed execution cwd in the same physical session', async () => {
    const data = await fixture();
    await updateSessionStore(join(home, 'sessions.json'), entries => { entries[key].spawnedCwd = home; });
    await expect(runTaskLoopVerificationCheck(data.input, data.cfg)).rejects.toThrow('checkpoint is unavailable');
    expect(existsSync(join(home, 'executions.txt'))).toBe(false);
  });
});


describe('TF-0672 actual execution source binding', () => {
  it('retains the exact task worktree in the candidate and invalidates changed task bytes', async () => {
    const data = await fixture({ separateWorktree: true });
    const taskCwd = join(home, 'task-worktree');
    const workspaceOnly = readTaskCompletionCandidate(source, taskLedgerDigest(data.cfg));
    expect(data.checkpoint.candidate.inputSha256).not.toBe(workspaceOnly.inputSha256);
    const result = await runTaskLoopVerificationCheck(data.input, data.cfg);
    expect(result, JSON.stringify(result)).toMatchObject({ receipt: { status: 'verified' } });
    expect(data.checkpoint.candidate.source).toBe(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: taskCwd, encoding: 'utf8', windowsHide: true }).trim());
    writeFileSync(join(taskCwd, 'source.txt'), 'changed task source while bootstrap workspace stays unchanged');
    expect(readTaskCompletionCandidate(source, taskLedgerDigest(data.cfg))).toEqual(workspaceOnly);
    await expect(runTaskLoopVerificationCheck({ ...data.input, verificationRunId: 'changed-task-worktree' }, data.cfg)).rejects.toThrow('Candidate changed');
  }, 90_000);
  it('rejects a reviewer pinned only to the workspace when execution uses another tree', async () => {
    const data = await fixture({ separateWorktree: true });
    const reviewer = subagentRuns.get('a3-reviewer')!;
    reviewer.orchestration!.completionReview = { state: 'pinned', workspaceRoot: source,
      candidate: readTaskCompletionCandidate(source, taskLedgerDigest(data.cfg)), capturedAt: Date.now() };
    const context = await readTaskLoopCompletionContext({ workspaceId: data.input.workspaceId, sessionKey: key, acceptance: ['source contract matches the candidate'] }, data.cfg);
    const record = { loopRunId: 'a3-loop', task: 'A3 verification task', sessionKey: key, workspaceId: data.input.workspaceId,
      taskLedgerRootId: 'a3-business-task', status: 'complete', evidenceGate: { status: 'pass' }, orchestrationRunIds: ['a3-orchestration'], completionContext: context } as TaskLoopRunRecord;
    expect(await captureTaskLoopCompletionCheckpoint({ record, checkpointId: 'wrong-source-review', cfg: data.cfg,
      subagents: [{ ...reviewer, runId: 'a3-worker', orchestration: { ...reviewer.orchestration!, phase: 'worker', isVerifier: false } }, reviewer],
      selfCheck: { decision: 'complete' } as never, now: Date.now() })).toBeNull();
    expect(existsSync(join(home, 'executions.txt'))).toBe(false);
  });
});


describe('TF-0672 launch generation fence', () => {
  it('does not launch after approval replaces the controller session generation', async () => {
    const data = await fixture();
    await updateSessionStore(join(home, 'sessions.json'), entries => { entries[key].execAsk = 'always'; });
    const gateway = await import('../../openclaw_runtime/src/agents/tools/gateway');
    vi.spyOn(gateway, 'callGatewayTool').mockImplementation((async (method: string, _opts: unknown, params: { id: string }) => {
      if (method === 'exec.approval.request') return { id: params.id, expiresAtMs: Date.now() + 120_000 };
      if (method === 'exec.approval.waitDecision') {
        await updateSessionStore(join(home, 'sessions.json'), entries => { entries[key].sessionId = 'replacement-generation'; });
        return { decision: 'allow-once' };
      }
      throw new Error('Unexpected approval method');
    }) as never);
    const result = await runTaskLoopVerificationCheck(data.input, data.cfg);
    expect(result).toMatchObject({ state: 'unavailable', receipt: null });
    expect(existsSync(join(home, 'executions.txt'))).toBe(false);
  }, 90_000);
});

describe('approval policy owner drift', () => {
  it('rejects actual execution if inline approval reduces session exec policy', async () => {
    const data = await fixture();
    await updateSessionStore(join(home, 'sessions.json'), entries => { entries[key].execAsk = 'always'; });
    const gateway = await import('../../openclaw_runtime/src/agents/tools/gateway');
    vi.spyOn(gateway, 'callGatewayTool').mockImplementation((async (method: string, _opts: unknown, params: { id: string }) => {
      if (method === 'exec.approval.request') return { id: params.id, expiresAtMs: Date.now()+120000 };
      if (method === 'exec.approval.waitDecision') { await updateSessionStore(join(home, 'sessions.json'), entries => { entries[key].execSecurity='deny'; });return {decision:'allow-once'}; }
      throw Error('Unexpected approval method');
    }) as never);
    const result=await runTaskLoopVerificationCheck(data.input,data.cfg);
    expect(result,JSON.stringify(result)).toMatchObject({receipt:null,state:'unavailable'});
    expect(existsSync(join(home,'executions.txt'))).toBe(false);
  },90000);
});

describe('TF-0672 controller account policy', () => {
  it('retains the persisted account-specific exec denial', async () => {
    const data = await fixture({ accountPolicy: true });
    const result = await runTaskLoopVerificationCheck(data.input, data.cfg);
    expect(result, JSON.stringify(result)).toMatchObject({ state: 'unavailable', receipt: null });
    expect(result.reason).toContain('controller tool policy');
    expect(existsSync(join(home, 'executions.txt'))).toBe(false);
  }, 90_000);
});

describe('TF-0672 pending verification stop owner', () => {
  it('cancels inline approval before a successful session stop can return', async () => {
    const data = await fixture();
    await updateSessionStore(join(home,'sessions.json'), entries=>{entries[key].execAsk='always';});
    const controllers = new Map();
    const context = { getRuntimeConfig:()=>data.cfg, chatAbortControllers:controllers } as never;
    const rpc = await import('../../openclaw_runtime/src/gateway/server-methods/role-orchestration-methods');
    const stop = await import('../../openclaw_runtime/src/gateway/server-methods/sessions.run-control');
    const shared = await import('../../openclaw_runtime/src/gateway/server-methods/sessions.shared');
    const gateway = await import('../../openclaw_runtime/src/agents/tools/gateway');
    let approve!:()=>void, ready!:()=>void;
    const decision = new Promise<void>(resolve=>{approve=resolve;});
    const requested = new Promise<void>(resolve=>{ready=resolve;});
    vi.spyOn(gateway,'callGatewayTool').mockImplementation((async(method:string,_opts:unknown,params:{id:string})=>{
      if(method==='exec.approval.request')return{id:params.id,expiresAtMs:Date.now()+120000};
      if(method==='exec.approval.waitDecision'){ready();await decision;return{decision:'allow-once'};}
      throw Error('Unexpected method');
    }) as never);
    vi.spyOn(shared,'loadSessionsRuntimeModule').mockResolvedValue({stopSessionRuntime:async(input:{onFenced?:()=>void})=>{input.onFenced?.();return{ok:true,key,sessionId:'parent-generation-a3'};}} as never);
    const response = vi.fn(), stopResponse=vi.fn();
    const pending = Promise.resolve(rpc.roleOrchestrationHandlers['task_loop.verifyCompletion']({params:data.input,respond:response,context} as never));
    try {
      await Promise.race([requested,pending.then(()=>{throw Error('verification did not wait');})]);
      await stop.sessionsRunControlHandlers['sessions.stop']({params:{key},respond:stopResponse,context} as never);
      expect(stopResponse.mock.calls[0]?.[0]).toBe(true);
      approve();await pending;
      const result=response.mock.calls[0]?.[1];
      expect(response.mock.calls[0]?.[0]===false||result?.state==='unavailable').toBe(true);
      expect(existsSync(join(home,'executions.txt'))).toBe(false);
      expect(controllers.size).toBe(0);
    }finally{approve();await pending;}
  },90000);
});

describe('TF-0672 persisted sender policy', () => {
  it('retains channel-scoped sender tool denial during verification', async () => {
    const data = await fixture({ senderPolicy: true });
    const result = await runTaskLoopVerificationCheck(data.input, data.cfg);
    expect(result, JSON.stringify(result)).toMatchObject({ state: 'unavailable', receipt: null });
    expect(result.reason).toContain('controller tool policy');
    expect(existsSync(join(home, 'executions.txt'))).toBe(false);
  }, 90_000);
});

describe('TF-0672 persisted Discord policy owner', () => {
  it('retains actual guild/channel deny rules when constructing verification exec', async () => {
    const data = await fixture({ discordPolicy: true });
    const registry = await import('../../openclaw_runtime/src/channels/plugins');
    const { resolveDiscordGroupToolPolicy } = await import('../../openclaw_runtime/extensions/discord/src/group-policy');
    vi.spyOn(registry, 'getLoadedChannelPlugin').mockImplementation((id: string) => id === 'discord' ? {
      groups: { resolveToolPolicy: resolveDiscordGroupToolPolicy },
    } as never : undefined);
    const result = await runTaskLoopVerificationCheck(data.input, data.cfg);
    expect(result, JSON.stringify(result)).toMatchObject({ state: 'unavailable', receipt: null });
    expect(result.reason).toContain('controller tool policy');
    expect(existsSync(join(home, 'executions.txt'))).toBe(false);
  }, 90_000);
});

describe('TF-0672 filename and policy channel owners',()=>{
 it('preserves an actual leading BOM filename as source input in both candidate readers',async()=>{
   const data=await fixture();
   const file=join(source,'\uFEFFcheck.cjs');writeFileSync(file,'first physical program');
   const mod=await import('../../shared/task-ledger-candidate');
   const digest=taskLedgerDigest(data.cfg);const before=mod.readTaskCompletionCandidate(source,digest);
   expect(await mod.readTaskCompletionCandidateAsync(source,digest)).toEqual(before);
   writeFileSync(file,'different physical program');const after=mod.readTaskCompletionCandidate(source,digest);
   expect(after.dirtyDiffSha256).not.toBe(before.dirtyDiffSha256);
   expect(await mod.readTaskCompletionCandidateAsync(source,digest)).toEqual(after);
 });
 it('rejects the changed effective channel at the post-approval execution boundary',async()=>{
   const data=await fixture();
   await updateSessionStore(join(home,'sessions.json'),entries=>{entries[key].execAsk='always';entries[key].lastChannel='telegram';entries[key].lastTo='-100123';entries[key].route=undefined;entries[key].deliveryContext={channel:'telegram',to:'-100123'};});
   const gateway=await import('../../openclaw_runtime/src/agents/tools/gateway');
   vi.spyOn(gateway,'callGatewayTool').mockImplementation((async(method:string,_opts:unknown,params:{id:string})=>{
     if(method==='exec.approval.request')return{id:params.id,expiresAtMs:Date.now()+120000};
     if(method==='exec.approval.waitDecision'){await updateSessionStore(join(home,'sessions.json'),entries=>{entries[key].lastChannel='discord';entries[key].route=undefined;entries[key].deliveryContext={channel:'discord',to:'channel-17'};});return{decision:'allow-once'};}
     throw Error('Unexpected approval method');
   })as never);
   const result=await runTaskLoopVerificationCheck(data.input,data.cfg);
   expect(result,JSON.stringify(result)).toMatchObject({state:'unavailable',receipt:null});
   expect(existsSync(join(home,'executions.txt'))).toBe(false);
 },90000);
});
