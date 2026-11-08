#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOrchestrationObserved } from '../openclaw_runtime/src/agents/orchestrator-run-observed';
import { createVerseGitRuntimeBindingPortFromEnv } from '../openclaw_runtime/src/plugin-sdk/versegit-binding-port';
import { endVerseGitRuntimeBindingForRun } from '../openclaw_runtime/src/plugin-sdk/versegit-binding-registry';
import { getRuntimeTraceBuffer } from '../openclaw_runtime/src/observability/trace-buffer';
import { resolveVerseGitRepoIdentity } from '../electron/gateway/versegit-bridge';
import type { OpenClawConfig } from '../openclaw_runtime/src/config/types.openclaw';

const repoRoot = process.env.VERSEGIT_C1_REPO_ROOT!;
const reportPath = process.env.VERSEGIT_C1_REPORT_PATH!;
const runtime = createVerseGitRuntimeBindingPortFromEnv(process.env);
if (!runtime) throw new Error('runtime binding port is unavailable');
const spawnedCwds: string[] = [];
const configured = { runtime: { coding: { worktree: { backend: 'git' } } } } as OpenClawConfig;
const result = await runOrchestrationObserved(
  { task: 'implement two isolated changes', templateId: 'quick-development', maxWorkers: 2, graphMode: 'auto', isolation: 'worktree', orchestrationRunId: 'orch_c1_e2e', verseGitBindingPort: runtime, cfg: configured },
  { agentSessionKey: 'agent:main:c1', workspaceDir: repoRoot },
  { spawn: (async (params: { cwd?: string }) => {
    const cwd = String(params.cwd);
    if (execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', windowsHide: true }).trim().replaceAll('\\','/').toLowerCase() !== cwd.replaceAll('\\','/').toLowerCase()) throw new Error('worker is not in its own Git checkout');
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(process.cwd())'], { cwd, encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    if (child.status !== 0) throw new Error(`worker process failed in ${cwd}`);
    spawnedCwds.push(cwd);
    return { status: 'accepted', runId: `run_${spawnedCwds.length}`, childSessionKey: `child_${spawnedCwds.length}` };
  }) as never },
  { runId: 'trace_c1_e2e', sessionKey: 'agent:main:c1' },
);

const childBindings = result.outcomes
  .map((outcome) => outcome.verseGitBinding)
  .filter((binding): binding is NonNullable<typeof binding> => Boolean(binding?.childRunId));
const childBindingEndErrors: string[] = [];
for (const binding of childBindings) {
  const error = await endVerseGitRuntimeBindingForRun(binding.childRunId!, 'completed');
  if (error) childBindingEndErrors.push(error.message);
}

const degradedSpawnedCwds: string[] = [];
const unavailablePort = {
  bind: async () => { throw new Error('binding bridge unavailable'); },
  attach: async () => { throw new Error('binding bridge unavailable'); },
  end: async () => { throw new Error('binding bridge unavailable'); },
};
const degradedResult = await runOrchestrationObserved(
  { task: 'confirm host fallback when VerseGit is unavailable', templateId: 'quick-development', maxWorkers: 2, graphMode: 'auto', isolation: 'worktree', orchestrationRunId: 'orch_c1_degraded', verseGitBindingPort: unavailablePort, cfg: configured },
  { agentSessionKey: 'agent:main:c1-degraded', workspaceDir: repoRoot },
  { spawn: (async (params: { cwd?: string }) => {
    const cwd = String(params.cwd);
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(process.cwd())'], { cwd, encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    if (child.status !== 0) throw new Error(`degraded worker process failed in ${cwd}`);
    degradedSpawnedCwds.push(cwd);
    return { status: 'accepted', runId: `degraded_run_${degradedSpawnedCwds.length}`, childSessionKey: `degraded_child_${degradedSpawnedCwds.length}` };
  }) as never },
  { runId: 'trace_c1_degraded', sessionKey: 'agent:main:c1-degraded' },
);
const degradedTrace = getRuntimeTraceBuffer().find((trace) => trace.runId === 'trace_c1_degraded');
const degradationRecorded = degradedTrace?.events.some((event) => event.type === 'versegit.binding.unavailable') === true;
const vgUnavailableDegradesHost = degradedResult.failures.length === 0 && degradedSpawnedCwds.length >= 2 && degradationRecorded;

const manualRequest = { requestId: 'manual-retry', runId: 'manual-run', traceId: 'manual-trace', worktreePath: repoRoot, agentSessionId: 'manual-session', mode: 'M1' as const };
const manual = await runtime.bind(manualRequest);
const retry = await runtime.bind(manualRequest);
let duplicateSession = false;
try { await runtime.bind({ ...manualRequest, requestId: 'manual-duplicate' }); } catch (error) { duplicateSession = (error as { code?: string }).code === 'DUPLICATE_SESSION'; }
const attached = await runtime.attach({ bindingId: manual.bindingId, childSessionKey: 'manual-child', childRunId: 'manual-child-run' });
const ended = await runtime.end({ bindingId: manual.bindingId, reason: 'cancelled' });
let duplicateEndRejected = false;
try { await runtime.end({ bindingId: manual.bindingId, reason: 'cancelled' }); } catch (error) { duplicateEndRejected = (error as { code?: string }).code === 'BINDING_ENDED'; }

let unboundEndRejected = false;
try { await runtime.end({ bindingId: 'missing-binding', reason: 'completed' }); } catch (error) { unboundEndRejected = (error as { code?: string }).code === 'BINDING_MISMATCH'; }

const otherRepo = mkdtempSync(join(tmpdir(), 'versegit-c1-other-'));
let crossRepoRejected = false;
try {
  execFileSync('git', ['init', '--initial-branch=main'], { cwd: otherRepo, windowsHide: true });
  writeFileSync(join(otherRepo, 'README.md'), 'other repo\n', 'utf8');
  execFileSync('git', ['config', 'user.email', 'agent@example.invalid'], { cwd: otherRepo, windowsHide: true });
  execFileSync('git', ['config', 'user.name', 'Agent'], { cwd: otherRepo, windowsHide: true });
  execFileSync('git', ['add', '.'], { cwd: otherRepo, windowsHide: true });
  execFileSync('git', ['commit', '-m', 'other repo'], { cwd: otherRepo, windowsHide: true });
  await runtime.bind({ ...manualRequest, requestId: 'cross-repo', worktreePath: otherRepo, agentSessionId: 'cross-repo-session' });
} catch (error) { crossRepoRejected = (error as { code?: string }).code === 'WORKSPACE_MISMATCH'; }
finally { rmSync(otherRepo, { recursive: true, force: true }); }

const wrongOwner = createVerseGitRuntimeBindingPortFromEnv({ ...process.env, CLAWX_VERSGIT_OWNER_ID: 'agent:other' })!;
let wrongOwnerRejected = false;
try { await wrongOwner.bind({ ...manualRequest, requestId: 'wrong-owner', agentSessionId: 'wrong-owner-session' }); } catch (error) { wrongOwnerRejected = (error as { code?: string }).code === 'IDENTITY_MISMATCH'; }
const wrongEpoch = createVerseGitRuntimeBindingPortFromEnv({ ...process.env, CLAWX_VERSGIT_EPOCH: '999' })!;
let staleEpochRejected = false;
try { await wrongEpoch.bind({ ...manualRequest, requestId: 'wrong-epoch', agentSessionId: 'wrong-epoch-session' }); } catch (error) { staleEpochRejected = (error as { code?: string }).code === 'IDENTITY_MISMATCH'; }

const junctionRoot = mkdtempSync(join(tmpdir(), 'versegit-c1-junction-'));
const junctionPath = join(junctionRoot, 'repo-alias');
let sameRepoAcrossJunction = false;
try {
  if (process.platform === 'win32') {
    execFileSync('cmd', ['/d', '/c', 'mklink', '/J', junctionPath, repoRoot], { cwd: junctionRoot, windowsHide: true });
    sameRepoAcrossJunction = resolveVerseGitRepoIdentity(junctionPath).repoId === resolveVerseGitRepoIdentity(repoRoot).repoId;
  }
} finally {
  rmSync(junctionRoot, { recursive: true, force: true });
}
const report = {
  schema: 'clawx.versegit.c1-runtime-probe/v1', generated_at: new Date().toISOString(), driven_by: 'agent', actor: 'codex',
  orchestration: { runId: 'orch_c1_e2e', failures: result.failures.length, outcomes: result.outcomes.length, spawned: spawnedCwds.length, bindings: result.outcomes.filter((outcome) => outcome.verseGitBinding).length },
  retry: { sameBinding: retry.bindingId === manual.bindingId }, duplicateSession, duplicateEndRejected, attach: attached.phase === 'attached', cancelled: ended.reason === 'cancelled', childBindingsEnded: childBindings.length >= 2 && childBindingEndErrors.length === 0,
  authority: { vgUnavailableDegradesHost, degradedWorkers: degradedSpawnedCwds.length, degradationRecorded },
  negatives: { crossRepoRejected, wrongOwnerRejected, staleEpochRejected, unboundEndRejected, sameRepoAcrossJunction },
  passed: result.failures.length === 0 && spawnedCwds.length >= 2 && result.outcomes.filter((outcome) => outcome.verseGitBinding).length >= 2 && childBindings.length >= 2 && childBindingEndErrors.length === 0 && vgUnavailableDegradesHost && retry.bindingId === manual.bindingId && duplicateSession && duplicateEndRejected && attached.phase === 'attached' && ended.reason === 'cancelled' && crossRepoRejected && wrongOwnerRejected && staleEpochRejected && unboundEndRejected && sameRepoAcrossJunction,
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report)}\n`);
if (!report.passed) process.exitCode = 1;
