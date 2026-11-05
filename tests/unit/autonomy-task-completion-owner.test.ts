// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { awaitTaskLoopCompletionChildren, captureTaskLoopCompletionCheckpoint, readTaskLoopCompletionContext, readTaskLoopCompletionEvidence, taskLoopReviewerPassed } from '../../openclaw_runtime/src/agents/task-loop-completion';
import { subagentRuns } from '../../openclaw_runtime/src/agents/subagent-registry-memory';
import type { OrchestrationRunResult } from '../../openclaw_runtime/src/agents/orchestrator-run-observed';
import { normalizeRuntimeLineage } from '../../openclaw_runtime/src/runtime-core/lineage';
import { updateSessionStore } from '../../openclaw_runtime/src/config/sessions/store';
import { closeSqliteSessionStoreDatabase } from '../../openclaw_runtime/src/config/sessions/store-sqlite';
import { recordLongTaskCheckpoint } from '../../openclaw_runtime/src/agents/long-task-control/store';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { runTaskLoop, type TaskLoopRunRecord } from '../../openclaw_runtime/src/agents/task-loop-controller';
import { createMission } from '../../openclaw_runtime/src/agents/mission-control/controller';
import type { SubagentRunRecord } from '../../openclaw_runtime/src/agents/subagent-registry.types';
import { readTaskCompletionCandidate, readTaskCompletionCandidateAsync, readTaskExecutionCandidate, readTaskExecutionCandidateAsync } from '../../shared/task-ledger-candidate';
import { parseTaskLedgerJournal, taskLedgerDigest } from '../../shared/task-ledger-journal';
import { taskCompletionCandidateMatches } from '../../shared/task-ledger-completion';
import { setRuntimeConfigSnapshot, clearRuntimeConfigSnapshot } from '../../openclaw_runtime/src/config/runtime-snapshot';
import { appendLongTaskLedgerEvents, ensureLongTaskLedgerRoot, readLongTaskLedgerRevision, taskLedgerEventsPath } from '../../openclaw_runtime/src/agents/long-task-control/task-ledger';
import { trackTaskLoopCompletionWorkspace } from '../../openclaw_runtime/src/agents/task-loop-completion-fence';

let root: string;
const key = 'agent:main:completion-owner';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'autonomy-a3-owner-'));
  vi.stubEnv('OPENCLAW_STATE_DIR', root); vi.stubEnv('OPENCLAW_CONFIG_DIR', root);
});
afterEach(() => { subagentRuns.clear(); clearRuntimeConfigSnapshot(); closeOpenClawStateDatabaseForTest(); closeSqliteSessionStoreDatabase(join(root, 'sessions.json')); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true, maxRetries: 5 }); });
const git = (args: string[]) => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' }).trim();

async function fixture() {
  git(['init', '--initial-branch=main']); git(['config', 'user.email', 'agent@example.invalid']); git(['config', 'user.name', 'Agent']);
  writeFileSync(join(root, '.gitignore'), 'state/\nagents/\nsessions.json*\ntask-ledgers/\nopenclaw-session-store-*.sqlite*\n');
  writeFileSync(join(root, 'source.txt'), 'candidate one'); git(['add', '.']); git(['commit', '-m', 'isolated source candidate']);
  const store = join(root, 'sessions.json');
  await updateSessionStore(store, entries => { entries[key] = { sessionId: 'physical-generation-a3', updatedAt: Date.now(), workspaceDir: root };
    entries['agent:main:actual-reviewer'] = { sessionId: 'reviewer-generation-a3', updatedAt: Date.now(), workspaceDir: root }; });
  const cfg = { session: { store }, agents: { defaults: { workspace: root } } };
  setRuntimeConfigSnapshot(cfg);
  const context = await readTaskLoopCompletionContext({ workspaceId: 'project-a3', sessionKey: key, acceptance: ['the candidate passes its full contract'] }, cfg);
  expect(context).not.toBeNull();
  const record = { loopRunId: 'owner-loop', sessionKey: key, workspaceId: 'project-a3', taskLedgerRootId: 'business-task', task: 'Owner task',
    status: 'complete', evidenceGate: { status: 'pass' }, completionContext: context, orchestrationRunIds: ['owner-orchestration'] } as TaskLoopRunRecord;
  const run = (id: string, verifier: boolean): SubagentRunRecord => ({
    runId: id, requesterSessionKey: key, requesterSessionId: context!.scope.sessionGeneration,
    childSessionKey: 'agent:main:' + id, workspaceDir: root, endedAt: Date.now(), outcome: { status: 'ok' },
    orchestration: { orchestrationRunId: 'owner-orchestration', phase: verifier ? 'verifier' : 'worker', isVerifier: verifier,
      ...(verifier ? { expectedWorkerRunIds: ['actual-worker'], verificationVerdict: 'pass',
        completionReview: { state: 'pinned', workspaceRoot: root, candidate: readTaskCompletionCandidate(root, taskLedgerDigest(cfg)), capturedAt: Date.now() } } : {}) },
  }) as SubagentRunRecord;
  return { store, cfg, context: context!, record, subagents: [run('actual-worker', false), run('actual-reviewer', true)] };
}

describe('TF-0672 actual checkpoint/provenance owners (unit integration)', () => {
  it('hashes source bytes behind a consumed junction and rejects core.worktree redirection', async () => {
    const data = await fixture();
    const external = mkdtempSync(join(tmpdir(), 'a3-linked-source-'));
    try {
      writeFileSync(join(external, 'module.cjs'), 'original consumed module');
      symlinkSync(external, join(root, 'linked-source'), process.platform === 'win32' ? 'junction' : 'dir');
      const config = taskLedgerDigest(data.cfg);
      const before = readTaskCompletionCandidate(root, config);
      expect(await readTaskCompletionCandidateAsync(root, config)).toEqual(before);
      writeFileSync(join(external, 'module.cjs'), 'changed consumed module behind same link');
      const after = readTaskCompletionCandidate(root, config);
      expect(after.inputSha256 === before.inputSha256 && after.dirtyDiffSha256 === before.dirtyDiffSha256).toBe(false);
      expect(await readTaskCompletionCandidateAsync(root, config)).toEqual(after);
      git(['config', 'core.worktree', external]);
      expect(() => readTaskCompletionCandidate(root, config)).toThrow('different physical source tree');
      await expect(readTaskCompletionCandidateAsync(root, config)).rejects.toThrow('different physical source tree');
    } finally { rmSync(external, { recursive: true, force: true }); }
  });
  it('does not let inherited Git variables redirect physical task provenance', async () => {
    const data = await fixture();
    const other = join(root, '.foreign-owner'); mkdirSync(other);
    writeFileSync(join(root, '.git', 'info', 'exclude'), '.foreign-owner/\n');
    const foreignGit = (args: string[]) => execFileSync('git', args, { cwd: other, windowsHide: true, stdio: 'pipe' });
    foreignGit(['init', '--initial-branch=main']); writeFileSync(join(other, 'foreign.cjs'), 'unrelated candidate');
    foreignGit(['add', '.']); foreignGit(['-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', 'commit', '-m', 'foreign source']);
    const config = taskLedgerDigest(data.cfg), expected = readTaskExecutionCandidate(root, root, config);
    vi.stubEnv('GIT_DIR', join(other, '.git')); vi.stubEnv('GIT_WORK_TREE', other); vi.stubEnv('GIT_INDEX_FILE', join(other, '.git', 'index'));
    expect(readTaskExecutionCandidate(root, root, config)).toEqual(expected);
    expect(await readTaskExecutionCandidateAsync(root, root, config)).toEqual(expected);
    writeFileSync(join(root, 'source.txt'), 'actual source changes under foreign Git environment');
    expect(readTaskExecutionCandidate(root, root, config).inputSha256).not.toBe(expected.inputSha256);
    expect(await readTaskExecutionCandidateAsync(root, root, config)).toEqual(readTaskExecutionCandidate(root, root, config));
  });
  it('binds tracked siblings when the execution cwd is a nested repository directory', async () => {
    const data = await fixture();
    const nested = join(root, 'task'); mkdirSync(nested);
    writeFileSync(join(nested, 'verify.cjs'), 'require("../source.txt");');
    git(['add', 'task']); git(['commit', '-m', 'nested task program']);
    const config = taskLedgerDigest(data.cfg);
    const before = readTaskExecutionCandidate(nested, nested, config);
    expect(before).toEqual(readTaskCompletionCandidate(root, config));
    expect(await readTaskExecutionCandidateAsync(nested, nested, config)).toEqual(before);
    writeFileSync(join(root, 'source.txt'), 'modified sibling consumed by the task');
    expect(readTaskExecutionCandidate(nested, nested, config).inputSha256).not.toBe(before.inputSha256);
    expect(await readTaskExecutionCandidateAsync(nested, nested, config)).toEqual(readTaskExecutionCandidate(nested, nested, config));
  });

  it('rejects a populated unresolved gitlink and hashes a junction gitlink physical tree', async () => {
    const data = await fixture();
    const child = join(root, '.module-owner'); mkdirSync(child);
    writeFileSync(join(root, '.git', 'info', 'exclude'), '.module-owner/\n');
    const childGit = (args: string[]) => execFileSync('git', args, { cwd: child, windowsHide: true, encoding: 'utf8' }).trim();
    childGit(['init', '--initial-branch=main']); writeFileSync(join(child, 'module.cjs'), 'first module source');
    childGit(['add', '.']); childGit(['-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', 'commit', '-m', 'module source']);
    const sha = childGit(['rev-parse', 'HEAD']);
    git(['update-index', '--add', '--cacheinfo', '160000,' + sha + ',vendor']);
    const vendor = join(root, 'vendor'); mkdirSync(vendor); writeFileSync(join(vendor, 'module.cjs'), 'unowned consumed source');
    const config = taskLedgerDigest(data.cfg);
    expect(() => readTaskCompletionCandidate(root, config)).toThrow('populated without its repository owner');
    await expect(readTaskCompletionCandidateAsync(root, config)).rejects.toThrow('populated without its repository owner');
    rmSync(vendor, { recursive: true, force: true });
    symlinkSync(child, vendor, process.platform === 'win32' ? 'junction' : 'dir');
    const before = readTaskCompletionCandidate(root, config);
    expect(await readTaskCompletionCandidateAsync(root, config)).toEqual(before);
    writeFileSync(join(child, 'module.cjs'), 'changed physical source behind the same link');
    const after = readTaskCompletionCandidate(root, config);
    expect(after.inputSha256).not.toBe(before.inputSha256);
    expect(await readTaskCompletionCandidateAsync(root, config)).toEqual(after);
  });
  it('binds task worktree and bootstrap inputs with identical sync/async provenance', async () => {
    const data = await fixture();
    const worktree = join(root, '.execution-worktree');
    const git = (args: string[], cwd = root) => execFileSync('git', args, { cwd, windowsHide: true, stdio: 'pipe' });
    writeFileSync(join(root, '.git', 'info', 'exclude'), '.execution-worktree/\n');
    git(['worktree', 'add', '--detach', worktree]);
    const config = taskLedgerDigest(data.cfg);
    const before = readTaskExecutionCandidate(root, worktree, config);
    expect(await readTaskExecutionCandidateAsync(root, worktree, config)).toEqual(before);
    expect(readTaskExecutionCandidate(root, root, config)).toEqual(readTaskCompletionCandidate(root, config));
    writeFileSync(join(worktree, 'source.txt'), 'different execution source');
    const changedExecution = readTaskExecutionCandidate(root, worktree, config);
    expect(changedExecution.inputSha256).not.toBe(before.inputSha256);
    expect(await readTaskExecutionCandidateAsync(root, worktree, config)).toEqual(changedExecution);
    writeFileSync(join(root, 'source.txt'), 'different bootstrap source');
    const changedBoth = readTaskExecutionCandidate(root, worktree, config);
    expect(changedBoth.inputSha256).not.toBe(changedExecution.inputSha256);
    expect(await readTaskExecutionCandidateAsync(root, worktree, config)).toEqual(changedBoth);
  });
  const pending = () => ({ expectedWorkerRunIds: ['worker'], pendingVerifier: true, outcomes: [] }) as unknown as OrchestrationRunResult;
  const waitScope = { sessionKey: key, sessionGeneration: 'physical-wait', orchestrationRunId: 'wait-orchestration', cancelled: () => false };
  const childRun = (id: string, verifier: boolean): SubagentRunRecord => ({
    runId: id, childSessionKey: 'agent:main:' + id, requesterSessionKey: key, requesterSessionId: waitScope.sessionGeneration,
    task: 'Owner wait fixture', createdAt: Date.now(), runTimeoutSeconds: 1,
    orchestration: { orchestrationRunId: waitScope.orchestrationRunId, roleName: verifier ? 'reviewer' : 'worker',
      phase: verifier ? 'verifier' : 'worker', isVerifier: verifier, leadRole: 'planner', originalTask: 'Owner wait fixture' },
  }) as SubagentRunRecord;

  it('returns a terminal failed verifier instead of waiting for nonexistent success text', async () => {
    const worker = childRun('worker', false), verifier = childRun('verifier', true);
    Object.assign(worker, { endedAt: Date.now(), outcome: { status: 'ok' }, completion: { required: true, resultText: 'Worker finished', capturedAt: Date.now() } });
    worker.orchestration!.verifierStartedRunId = verifier.runId;
    Object.assign(verifier, { endedAt: Date.now(), outcome: { status: 'error' }, completion: { required: true, resultText: null, capturedAt: Date.now() } });
    subagentRuns.set(worker.runId, worker); subagentRuns.set(verifier.runId, verifier);
    const result = await awaitTaskLoopCompletionChildren(pending(), waitScope);
    expect(result.pendingVerifier).toBe(false);
    expect(result.outcomes.at(-1)?.spawn.result?.runId).toBe(verifier.runId);
  });

  it('waits for a later-started verifier under its own child deadline', async () => {
    const worker = childRun('worker', false);
    subagentRuns.set(worker.runId, worker);
    let verifierTimer: ReturnType<typeof setTimeout> | undefined;
    const workerTimer = setTimeout(() => {
      Object.assign(worker, { endedAt: Date.now(), outcome: { status: 'ok' }, completion: { required: true, resultText: 'Worker finished', capturedAt: Date.now() } });
      const verifier = childRun('verifier', true);
      worker.orchestration!.verifierStartedRunId = verifier.runId;
      subagentRuns.set(verifier.runId, verifier);
      verifierTimer = setTimeout(() => {
        Object.assign(verifier, { endedAt: Date.now(), outcome: { status: 'ok' }, completion: { required: true, resultText: 'verificationVerdict=pass', capturedAt: Date.now() } });
      }, 600);
    }, 600);
    try {
      const result = await awaitTaskLoopCompletionChildren(pending(), waitScope);
      expect(result.pendingVerifier).toBe(false);
      expect(result.outcomes.at(-1)?.spawn.result?.runId).toBe('verifier');
    } finally { clearTimeout(workerTimer); if (verifierTimer) clearTimeout(verifierTimer); }
  });

  it('starts an inner TaskLoop under its recorded Mission root without replacing the owner', async () => {
    const cfg = { session: { store: join(root, 'sessions.json') }, agents: { defaults: { workspace: root } } };
    const mission = createMission({ objective: 'Shared Mission root', sessionKey: key, workspaceId: 'project-a3' }, cfg,
      { idFactory: () => 'recorded-parent-mission' });
    const rootId = mission.metadata?.taskLedgerRootId;
    expect(typeof rootId).toBe('string');
    const taskLedgerRootId = String(rootId);
    const journal = taskLedgerEventsPath(mission.workspaceId);
    const before = readFileSync(journal, 'utf8');
    // Stop after root admission: the workers and review are injected fixtures,
    // while Mission storage, root ownership and TaskLoop startup are real.
    const runObserved = vi.fn(async () => ({ plan: { mode: 'lead-workers', leadRole: 'planner', workers: [], reasons: [] },
      outcomes: [], spawnedRunIds: [], expectedWorkerRunIds: [], pendingVerifier: false,
      failures: [{ roleName: 'fixture', status: 'error', error: 'Stop after root admission' }] }));
    const deps = { runObserved: runObserved as never,
      selfCheck: (async () => ({ decision: 'blocked', confidence: 1, missingEvidence: [], verificationGaps: ['No fixture worker execution'],
        risks: [], contextSummary: 'Root admission only' })) as never,
      recordCheckpoint: vi.fn() as never, storeTrace: vi.fn() as never };
    const request = { task: mission.objective, sessionKey: key, workspaceId: 'project-a3', taskLedgerRootId,
      lineage: normalizeRuntimeLineage({ sessionId: key, missionId: mission.missionId, missionTick: mission.tick, taskLedgerRootId })! };
    const result = await runTaskLoop(request, cfg, deps);
    expect(result.taskLedgerRootId).toBe(taskLedgerRootId);
    expect(runObserved).toHaveBeenCalled();
    expect(readFileSync(journal, 'utf8')).toBe(before);
    runObserved.mockClear();
    await expect(runTaskLoop({ ...request, lineage: { ...request.lineage, missionId: 'caller-invented-mission' } }, cfg, deps)).rejects.toThrow('another owner');
    await expect(runTaskLoop({ ...request, workspaceId: 'foreign-workspace' }, cfg, deps)).rejects.toThrow('another owner');
    expect(runObserved).not.toHaveBeenCalled();
    expect(readFileSync(journal, 'utf8')).toBe(before);
  });

  it('does not append invalidations for identical config activations but fences an in-place changed object', () => {
    const cfg = { agents: { defaults: { workspace: root } } };
    setRuntimeConfigSnapshot(cfg);
    const at = new Date().toISOString();
    appendLongTaskLedgerEvents('config-workspace', [{ type: 'node_created', actor: 'system', payload: { node: {
      id: 'config-task', title: 'Config owner', kind: 'task', status: 'doing', createdAt: at, updatedAt: at,
    } } }]);
    trackTaskLoopCompletionWorkspace('config-workspace');
    const journal = taskLedgerEventsPath('config-workspace');
    const before = readFileSync(journal, 'utf8');
    for (let attempt = 0; attempt < 5; attempt++) setRuntimeConfigSnapshot(structuredClone(cfg));
    expect(readFileSync(journal, 'utf8')).toBe(before);
    setRuntimeConfigSnapshot(cfg);
    cfg.agents.defaults.workspace = join(root, 'changed-config-root');
    setRuntimeConfigSnapshot(cfg);
    const after = parseTaskLedgerJournal(readFileSync(journal, 'utf8'));
    expect(after.events).toHaveLength(2);
    expect(after.events[1]).toMatchObject({ type: 'completion_evidence_changed', payload: { note: 'runtime-config-before-mutation' } });
  });

  it('returns equivalent fresh provenance asynchronously while allowing event-loop progress', async () => {
    const data = await fixture();
    for (let index = 0; index < 20; index++) writeFileSync(join(root, 'input-' + index + '.txt'), 'x'.repeat(65536));
    const config = taskLedgerDigest(data.cfg);
    const expected = readTaskCompletionCandidate(root, config);
    let responsive = false;
    setImmediate(() => { responsive = true; });
    expect(await readTaskCompletionCandidateAsync(root, config)).toEqual(expected);
    expect(responsive).toBe(true);
    writeFileSync(join(root, 'source.txt'), 'changed after first snapshot');
    const changed = await readTaskCompletionCandidateAsync(root, config);
    expect(changed).toEqual(readTaskCompletionCandidate(root, config));
    expect(changed.inputSha256).not.toBe(expected.inputSha256);
    git(['add', 'source.txt']);
    expect(await readTaskCompletionCandidateAsync(root, config)).toEqual(readTaskCompletionCandidate(root, config));
    const staged = await readTaskCompletionCandidateAsync(root, config);
    const file = join(root, 'source.txt'), stat = statSync(file);
    writeFileSync(file, 'Changed after first snapshot');
    utimesSync(file, stat.atime, stat.mtime);
    const restoredMtime = await readTaskCompletionCandidateAsync(root, config);
    expect(statSync(file).size).toBe(stat.size);
    expect(restoredMtime.inputSha256).not.toBe(staged.inputSha256);
    expect(restoredMtime).toEqual(readTaskCompletionCandidate(root, config));
  });
  it('refuses a caller-selected manual root and preserves the committed prefix', () => {
    const now = new Date().toISOString();
    appendLongTaskLedgerEvents('root-workspace', [{ type: 'node_created', actor: 'user', taskId: 'manual-root', payload: { node: {
      id: 'manual-root', title: 'Manual task', kind: 'task', status: 'done', owner: 'user', createdAt: now, updatedAt: now,
    } } }]);
    const input = { workspaceId: 'root-workspace', taskLedgerRootId: 'manual-root', sessionKey: key, runId: 'new-loop', source: 'task_loop' as const, title: 'Replacement' };
    const before = readLongTaskLedgerRevision(input);
    expect(() => ensureLongTaskLedgerRoot(input)).toThrow('already belongs');
    expect(readLongTaskLedgerRevision(input)).toEqual(before);
    const owned = { ...input, taskLedgerRootId: 'new-owned-root' };
    expect(ensureLongTaskLedgerRoot(owned)).toBe(owned.taskLedgerRootId);
    const revision = readLongTaskLedgerRevision(owned);
    expect(ensureLongTaskLedgerRoot(owned)).toBe(owned.taskLedgerRootId);
    expect(readLongTaskLedgerRevision(owned)).toEqual(revision);
    expect(() => ensureLongTaskLedgerRoot({ ...owned, sessionKey: 'agent:main:other' })).toThrow('already belongs');
    expect(() => ensureLongTaskLedgerRoot({ ...owned, runId: 'other-run' })).toThrow('already belongs');
    expect(readLongTaskLedgerRevision(owned)).toEqual(revision);
  });
  it('hashes initialized gitlinks and detects their dirty source in both candidate readers', async () => {
    await fixture();
    const childRoot = mkdtempSync(join(tmpdir(), 'a3-submodule-source-'));
    try {
      const childGit = (args: string[]) => execFileSync('git', args, { cwd: childRoot, windowsHide: true, stdio: 'pipe' });
      childGit(['init', '--initial-branch=main']);
      writeFileSync(join(childRoot, 'nested.txt'), 'submodule candidate');
      childGit(['add', '.']); childGit(['-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', 'commit', '-m', 'submodule source']);
      git(['-c', 'protocol.file.allow=always', 'submodule', 'add', childRoot, 'vendor']);
      git(['commit', '-m', 'record gitlink']);
      const config = taskLedgerDigest({ fixture: 'submodule' });
      const before = readTaskCompletionCandidate(root, config);
      expect(await readTaskCompletionCandidateAsync(root, config)).toEqual(before);
      writeFileSync(join(root, 'vendor', 'nested.txt'), 'changed submodule source');
      const changed = readTaskCompletionCandidate(root, config);
      expect(changed.inputSha256).not.toBe(before.inputSha256);
      expect(await readTaskCompletionCandidateAsync(root, config)).toEqual(changed);
    } finally { rmSync(childRoot, { recursive: true, force: true }); }
  });

  it('reads physical candidate and index state without executing repository Git helpers', async () => {
    git(['init', '--initial-branch=main']); git(['config', 'user.email', 'agent@example.invalid']); git(['config', 'user.name', 'Agent']);
    writeFileSync(join(root, 'source.txt'), 'initial'); git(['add', '.']); git(['commit', '-m', 'helper isolation candidate']);
    const marker = join(root, '.git', 'helper-executed');
    const script = join(root, '.git', 'helper.cjs');
    writeFileSync(script, 'require("node:fs").writeFileSync(' + JSON.stringify(marker) + ',"unexpected helper");');
    const helper = '"' + process.execPath.replaceAll('\\', '/') + '" "' + script.replaceAll('\\', '/') + '"';
    git(['config', 'diff.external', helper]); git(['config', 'diff.a3.textconv', helper]);
    git(['config', 'filter.a3.clean', helper]); git(['config', 'filter.a3.process', helper]); git(['config', 'core.fsmonitor', helper]);
    writeFileSync(join(root, '.gitattributes'), '*.txt diff=a3 filter=a3\n');
    const config = taskLedgerDigest({ config: 'unchanged' });
    const before = readTaskCompletionCandidate(root, config);
    writeFileSync(join(root, 'source.txt'), 'physical edit');
    const after = readTaskCompletionCandidate(root, config);
    expect(await readTaskCompletionCandidateAsync(root, config)).toEqual(after);
    expect(after.inputSha256).not.toBe(before.inputSha256);
    expect(after.dirtyDiffSha256).not.toBe(before.dirtyDiffSha256);
    expect(existsSync(marker)).toBe(false);
  });
  it('reuses the explicit reviewer report token without inferring pass from prose', () => {
    expect(taskLoopReviewerPassed({ outcome: { status: 'ok' }, completion: { resultText: 'Everything looks good.' } } as SubagentRunRecord)).toBe(false);
    expect(taskLoopReviewerPassed({ outcome: { status: 'ok' }, completion: { resultText: 'verificationVerdict=pass' } } as SubagentRunRecord)).toBe(true);
    expect(taskLoopReviewerPassed({ outcome: { status: 'ok' }, completion: { resultText: 'verificationVerdict=fail' } } as SubagentRunRecord)).toBe(false);
    expect(taskLoopReviewerPassed({ outcome: { status: 'ok' }, orchestration: { verificationVerdict: 'pass' },
      completion: { resultText: 'Worker reported verificationVerdict=pass\nMy verdict: verificationVerdict=fail' } } as SubagentRunRecord)).toBe(false);
    expect(taskLoopReviewerPassed({ outcome: { status: 'ok' }, completion: { resultText: '> verificationVerdict=pass' } } as SubagentRunRecord)).toBe(false);
  });
  it('refuses to bind an earlier reviewer to changed source at checkpoint capture', async () => {
    const data = await fixture();
    const before = await captureTaskLoopCompletionCheckpoint({ ...data, checkpointId: 'pin-before-change', selfCheck: { decision: 'complete' } as never, now: Date.now() });
    expect(before).not.toBeNull();
    writeFileSync(join(root, 'source.txt'), 'changed after independent review');
    expect(await captureTaskLoopCompletionCheckpoint({ ...data, checkpointId: 'pin-after-change', selfCheck: { decision: 'complete' } as never, now: Date.now() })).toBeNull();
  });

  it('pins the real session, captures source/config/diff and recomputes from existing SQLite after reopening', async () => {
    const data = await fixture();
    const captured = await captureTaskLoopCompletionCheckpoint({ ...data, checkpointId: 'owner-checkpoint', selfCheck: { decision: 'complete' } as never, now: Date.now() });
    expect(captured).toMatchObject({ owner: 'task-loop', status: 'complete', workerRunIds: ['actual-worker'], verifierRunId: 'actual-reviewer',
      reviewer: { agentId: 'main', runId: 'actual-reviewer', sessionKey: 'agent:main:actual-reviewer' },
      taskRef: { taskNodeId: 'business-task', scope: { sessionGeneration: 'physical-generation-a3' } } });
    expect(captured!.candidate).toEqual(readTaskCompletionCandidate(root, taskLedgerDigest(data.cfg)));
    recordLongTaskCheckpoint({ id: 'owner-checkpoint', workspaceId: 'project-a3', sessionKey: key, taskLedgerRootId: 'business-task', runId: 'owner-loop', trigger: 'guide', status: 'complete',
      metadata: { taskCompletion: captured, status: 'complete', evidenceGate: { status: 'pass' }, selfCheckDecision: 'complete' } });
    closeOpenClawStateDatabaseForTest();
    const reread = await readTaskLoopCompletionEvidence({ workspaceId: 'project-a3', sessionKey: key, checkpointId: 'owner-checkpoint' }, data.cfg);
    expect(reread.checkpoint).toEqual(captured);
    const { ownerRevision, ...facts } = captured!; expect(ownerRevision).toBe(taskLedgerDigest(facts));
    await updateSessionStore(data.store, entries => { entries[key].sessionId = 'replaced-generation'; });
    await expect(readTaskLoopCompletionEvidence({ workspaceId: 'project-a3', sessionKey: key, checkpointId: 'owner-checkpoint' }, data.cfg)).rejects.toThrow('sessionGeneration mismatch');
    await expect(captureTaskLoopCompletionCheckpoint({ ...data, checkpointId: 'after-reset', now: Date.now() })).rejects.toThrow('sessionGeneration mismatch');
  });

  it('does not manufacture an independent reviewer from reported text or a worker identity', async () => {
    const data = await fixture();
    const input = { ...data, checkpointId: 'reference-checkpoint', now: Date.now() };
    expect(await captureTaskLoopCompletionCheckpoint({ ...input, subagents: data.subagents.slice(0, 1) })).toBeNull();
    for (const mutate of [
      (run: SubagentRunRecord) => { run.requesterSessionId = 'retired'; },
      (run: SubagentRunRecord) => { run.orchestration!.isVerifier = false; },
      (run: SubagentRunRecord) => { run.orchestration!.expectedWorkerRunIds = ['unrelated-worker']; },
      (run: SubagentRunRecord) => { run.runId = 'actual-worker'; },
    ]) {
      const subagents = structuredClone(data.subagents); mutate(subagents[1]);
      expect(await captureTaskLoopCompletionCheckpoint({ ...input, subagents })).toBeNull();
    }
    expect(await captureTaskLoopCompletionCheckpoint({ ...input, record: { ...data.record, completionContext: { ...data.context, acceptance: [] } } })).toBeNull();
  });

  it('invalidates the exact candidate on tracked edits, staging, untracked input, config or integrated HEAD', async () => {
    const data = await fixture();
    const base = readTaskCompletionCandidate(root, taskLedgerDigest(data.cfg));
    const matches = () => taskCompletionCandidateMatches(base, readTaskCompletionCandidate(root, taskLedgerDigest(data.cfg)));
    expect(matches()).toBe(true);
    writeFileSync(join(root, 'source.txt'), 'changed tracked candidate'); expect(matches()).toBe(false);
    expect(readTaskCompletionCandidate(root, taskLedgerDigest(data.cfg)).inputSha256).not.toBe(base.inputSha256);
    const unstaged = readTaskCompletionCandidate(root, taskLedgerDigest(data.cfg));
    git(['add', 'source.txt']); expect(readTaskCompletionCandidate(root, taskLedgerDigest(data.cfg)).dirtyDiffSha256).not.toBe(unstaged.dirtyDiffSha256);
    git(['commit', '-m', 'new integrated candidate']); expect(matches()).toBe(false);
    const integrated = readTaskCompletionCandidate(root, taskLedgerDigest(data.cfg));
    writeFileSync(join(root, 'untracked-source.txt'), 'unreviewed source');
    expect(readTaskCompletionCandidate(root, taskLedgerDigest(data.cfg)).dirtyDiffSha256).not.toBe(integrated.dirtyDiffSha256);
    expect(readTaskCompletionCandidate(root, taskLedgerDigest({ ...data.cfg, changed: true })).configSha256).not.toBe(integrated.configSha256);
  });
});
