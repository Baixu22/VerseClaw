import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorktreeService, normalizeWorktreeRelPath } from '../../openclaw_runtime/src/agents/worktree-service';
import * as worktrees from '../../openclaw_runtime/src/agents/worktree-service';
import * as registry from '../../openclaw_runtime/src/agents/worktree-registry';
import * as writers from '../../openclaw_runtime/src/agents/worktree-writer';
import * as mergeFiles from '../../openclaw_runtime/src/agents/worktree-merge-files';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { freezeOrchestrationWorktreeCandidate, mergeOrchestrationWorktrees } from '../../openclaw_runtime/src/agents/orchestration-worktree-merge';
import { journaledGitApply } from '../../openclaw_runtime/src/plugin-sdk/journaled-git-apply';
import * as journal from '../../openclaw_runtime/src/agents/tools/write-journal-core';

describe('R4 durable worktree integration', () => {
  let fixture: string;
  let root: string;
  beforeEach(() => {
    fixture = mkdtempSync(path.join(tmpdir(), 'autonomy-r4-'));
    root = path.join(fixture, 'repo'); mkdirSync(root);
    vi.stubEnv('OPENCLAW_STATE_DIR', path.join(fixture, 'state'));
  });
  afterEach(() => {
    vi.restoreAllMocks(); closeOpenClawStateDatabaseForTest(); vi.unstubAllEnvs();
    rmSync(fixture, { recursive: true, force: true });
  });
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  function proof(name: string, value: unknown) {
    const directory = process.env.CLAWX_R4_EVIDENCE_DIR;
    if (!directory) return;
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, name + '.json'), JSON.stringify({ driven_by: 'agent', actor: 'r4-integration-runtime-test', value }, null, 2));
  }
  function nativeRepository() {
    git('init', '-q');
    writeFileSync(path.join(root, '.gitignore'), '.openclaw/\n');
    writeFileSync(path.join(root, 'original.bin'), Buffer.from([0, 1, 255, 4]));
    writeFileSync(path.join(root, 'other.txt'), 'original other');
    git('add', '.');
    git('-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'base');
  }
  it.each(['inprocess', 'git'] as const)('preserves deletion and rename through the actual %s owner', async backend => {
    if (backend === 'git') nativeRepository();
    else writeFileSync(path.join(root, 'original.bin'), Buffer.from([0, 1, 255, 4]));
    const service = createWorktreeService(root, { backend });
    const worker = service.create('worker', { seedFiles: ['original.bin'], writeSet: ['original.bin', 'renamed.bin'] });
    renameSync(path.join(worker.root, 'original.bin'), path.join(worker.root, 'renamed.bin'));
    service.enqueueMerge({ worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['original.bin', 'renamed.bin'] });
    const result = await service.processMergeQueue();
    expect(result[0].status).toBe('merged');
    expect(existsSync(path.join(root, 'original.bin'))).toBe(false);
    expect(readFileSync(path.join(root, 'renamed.bin'))).toEqual(Buffer.from([0, 1, 255, 4]));
    expect(result[0]).toMatchObject({ journalRef: expect.stringMatching(/^write-journal:/) });
  });
  it.each(['inprocess', 'git'] as const)('refuses concurrent target content instead of overwriting it for %s', async backend => {
    if (backend === 'git') nativeRepository();
    else writeFileSync(path.join(root, 'original.bin'), 'base');
    const service = createWorktreeService(root, { backend });
    const worker = service.create('worker', { seedFiles: ['original.bin'], writeSet: ['original.bin'] });
    writeFileSync(path.join(worker.root, 'original.bin'), 'worker change');
    writeFileSync(path.join(root, 'original.bin'), 'concurrent owner');
    service.enqueueMerge({ worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['original.bin'] });
    const result = await service.processMergeQueue();
    expect(result[0]).toMatchObject({ status: 'conflict', reason: expect.stringContaining('base_content_changed') });
    expect(readFileSync(path.join(root, 'original.bin'), 'utf8')).toBe('concurrent owner');
  });
  it('serializes duplicate completion and retains the same journal receipt after restart', async () => {
    nativeRepository();
    const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'worker result');
    const request = { worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['other.txt'] };
    service.enqueueMerge(request); service.enqueueMerge(request);
    expect(service.getMergeQueue()).toHaveLength(1);
    const merged = (await service.processMergeQueue())[0];
    expect(merged.status).toBe('merged');
    closeOpenClawStateDatabaseForTest();
    const restarted = createWorktreeService(root, { backend: 'git' });
    expect(restarted.enqueueMerge(request)).toEqual(merged);
    expect(restarted.getMergeQueue()).toHaveLength(0);
    expect(readFileSync(path.join(root, 'other.txt'), 'utf8')).toBe('worker result');
  });
  it('retains the captured preimages across a real registry reload', async () => {
    nativeRepository();
    const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'worker result');
    service.enqueueMerge({ worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['other.txt'] });
    closeOpenClawStateDatabaseForTest();
    const result = await createWorktreeService(root, { backend: 'git' }).processMergeQueue();
    expect(result[0]).toMatchObject({ status: 'merged', journalRef: expect.stringMatching(/^write-journal:/) });
    expect(readFileSync(path.join(root, 'other.txt'), 'utf8')).toBe('worker result');
  });
  it('shares in-flight duplicate callbacks and reuses their durable terminal result', async () => {
    nativeRepository();
    const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'worker result');
    const request = { baseRoot: root, workers: [{ taskNodeId: 'task-worker', worktreeId: worker.id,
      worktreeGeneration: worker.generation, declaredWriteSet: ['other.txt'] }] };
    const [first, second] = await Promise.all([mergeOrchestrationWorktrees(request), mergeOrchestrationWorktrees(request)]);
    expect(first).toEqual(second);
    expect(first[0]).toMatchObject({ status: 'merged', journalRef: expect.stringMatching(/^write-journal:/) });
    expect(await mergeOrchestrationWorktrees(request)).toEqual(first);
  });
  it('serializes different worker callbacks on the same target without blocking the active merge', async () => {
    nativeRepository();
    const service = createWorktreeService(root, { backend: 'git' });
    const first = service.create('first', { writeSet: ['other.txt'] });
    const second = service.create('second', { writeSet: ['new.txt'] });
    writeFileSync(path.join(first.root, 'other.txt'), 'first result');
    writeFileSync(path.join(second.root, 'new.txt'), 'second result');
    const request = (worker: typeof first, file: string) => ({ baseRoot: root, workers: [{ taskNodeId: worker.id,
      worktreeId: worker.id, worktreeGeneration: worker.generation, declaredWriteSet: [file] }] });
    const [a, b] = await Promise.all([mergeOrchestrationWorktrees(request(first, 'other.txt')),
      mergeOrchestrationWorktrees(request(second, 'new.txt'))]);
    expect(a[0].status).toBe('merged'); expect(b[0].status).toBe('merged');
  });
  it('refuses sync cleanup promptly while the same process holds an async merge lock', async () => {
    writeFileSync(path.join(root, 'original.bin'), 'base');
    const service = createWorktreeService(root);
    const worker = service.create('worker', { seedFiles: ['original.bin'], writeSet: ['original.bin'] });
    writeFileSync(path.join(worker.root, 'original.bin'), 'worker result');
    service.enqueueMerge({ worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['original.bin'] });
    const apply = mergeFiles.applyWorktreeFiles;
    let release!: () => void, reached!: () => void;
    const started = new Promise<void>(resolve => { reached = resolve; });
    vi.spyOn(mergeFiles, 'applyWorktreeFiles').mockImplementation(async input => {
      reached(); await new Promise<void>(resolve => { release = resolve; }); return apply(input);
    });
    const running = service.processMergeQueue(); await started;
    try {
      const began = Date.now();
      expect(() => service.cleanup(worker.id)).toThrow('worktree_merge_busy');
      expect(Date.now() - began).toBeLessThan(500);
    } finally { release(); await running; }
  });
  it('retains permission-only worker results during cleanup', () => {
    writeFileSync(path.join(root, 'original.bin'), 'base');
    const service = createWorktreeService(root);
    const worker = service.create('worker', { seedFiles: ['original.bin'], writeSet: ['original.bin'] });
    chmodSync(path.join(worker.root, 'original.bin'), 0o444);
    expect(() => service.cleanup(worker.id)).toThrow('worktree_cleanup_unretained_mode');
    expect(readFileSync(path.join(worker.root, 'original.bin'), 'utf8')).toBe('base');
  });
  it('freezes a candidate with the actual filesystem spelling for an equivalent declared path', () => {
    nativeRepository();
    const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['OTHER.TXT'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'case alias result');
    const result = freezeOrchestrationWorktreeCandidate({ baseRoot: root, workers: [{ taskNodeId: 'case-alias',
      worktreeId: worker.id, worktreeGeneration: worker.generation, declaredWriteSet: ['OTHER.TXT'] }] });
    const aliases = existsSync(path.join(worker.root, 'OTHER.TXT'));
    expect(result.status).toBe(aliases ? 'frozen' : 'rejected');
    if (result.status === 'frozen') expect(result.manifest!.workerSnapshots[0].changedFiles).toEqual(['other.txt']);
  });
  it('refuses a Git executable-mode change instead of reporting the unapplied metadata as merged', async () => {
    nativeRepository();
    const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['other.txt'] });
    execFileSync('git', ['update-index', '--chmod=+x', 'other.txt'], { cwd: worker.root, windowsHide: true });
    const results = await mergeOrchestrationWorktrees({ baseRoot: root, workers: [{ taskNodeId: 'mode-worker',
      worktreeId: worker.id, worktreeGeneration: worker.generation, declaredWriteSet: ['other.txt'] }] });
    expect(results[0]).toMatchObject({ status: 'conflict', reason: expect.stringContaining('mode_unsupported') });
    expect(() => service.cleanup(worker.id)).toThrow('worktree_cleanup_user_content_present');
    expect(execFileSync('git', ['diff', '--cached', '--raw'], { cwd: worker.root, encoding: 'utf8', windowsHide: true })).toContain('100755');
    expect(git('diff', '--name-only')).toBe('');
  });
  it('allows a preflight-only rework attempt once the original target is restored', async () => {
    writeFileSync(path.join(root, 'original.bin'), 'base');
    const service = createWorktreeService(root, { conflictPolicy: 'return_worker' });
    const worker = service.create('worker', { seedFiles: ['original.bin'], writeSet: ['original.bin'] });
    writeFileSync(path.join(worker.root, 'original.bin'), 'worker result');
    writeFileSync(path.join(root, 'original.bin'), 'concurrent owner');
    const request = { worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['original.bin'] };
    service.enqueueMerge(request);
    expect((await service.processMergeQueue())[0].status).toBe('rework');
    writeFileSync(path.join(root, 'original.bin'), 'base');
    expect(service.enqueueMerge(request).status).toBe('pending');
    expect((await service.processMergeQueue())[0].status).toBe('merged');
    expect(readFileSync(path.join(root, 'original.bin'), 'utf8')).toBe('worker result');
  });
  it.each(['crash-before-journal', 'crash-after-journal-ref'])('recovers an exited pre-effect merge without replaying an unknown filesystem effect (%s)', async crashPoint => {
    nativeRepository(); const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'worker result'); closeOpenClawStateDatabaseForTest();
    const runtimeRequire = createRequire(path.resolve('openclaw_runtime/package.json'));
    const command = [runtimeRequire.resolve('tsx/cli'), '--tsconfig', path.resolve('openclaw_runtime/tsconfig.json'),
      path.resolve('tests/fixtures/worktree-integration-process.ts'), root, worker.id, worker.generation, JSON.stringify(['other.txt']), crashPoint];
    const exited = spawnSync(process.execPath, command, { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
    expect(exited.status, exited.stderr).toBe(crashPoint === 'crash-before-journal' ? 29 : 30);
    expect(readFileSync(path.join(root, 'other.txt'), 'utf8')).toBe('original other');
    const restarted = createWorktreeService(root, { backend: 'git' });
    restarted.enqueueMerge({ worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['other.txt'] });
    expect((await restarted.processMergeQueue())[0].status).toBe('merged');
    expect(readFileSync(path.join(root, 'other.txt'), 'utf8')).toBe('worker result');
    proof('pre-effect-crash-recovery-' + crashPoint, { childExit: exited.status, remaining: restarted.getMergeQueue() });
  });
  it('reconstructs a legacy Git baseline from its recorded commit before integration', async () => {
    nativeRepository(); const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'legacy worker result');
    const stored = registry.loadWorktreeRegistryScope(root); delete stored.records.get(worker.id)!.mergeBaseline;
    registry.saveWorktreeRegistryScope(stored); closeOpenClawStateDatabaseForTest();
    const restarted = createWorktreeService(root, { backend: 'git' });
    writeFileSync(path.join(root, 'other.txt'), 'concurrent base');
    restarted.enqueueMerge({ worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['other.txt'] });
    expect((await restarted.processMergeQueue())[0].status).toBe('conflict');
    writeFileSync(path.join(root, 'other.txt'), 'original other');
    writeFileSync(path.join(worker.root, 'original.bin'), 'later existing-file result');
    restarted.enqueueMerge({ worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['original.bin', 'other.txt'] });
    expect((await restarted.processMergeQueue())[0].status).toBe('merged');
    expect(readFileSync(path.join(root, 'other.txt'), 'utf8')).toBe('legacy worker result');
    expect(readFileSync(path.join(root, 'original.bin'), 'utf8')).toBe('later existing-file result');
  });
  it('cleans an unchanged legacy inprocess checkout only when the retained target proves its content and modes', () => {
    writeFileSync(path.join(root, 'original.bin'), 'base'); const service = createWorktreeService(root);
    const worker = service.create('worker', { seedFiles: ['original.bin'], writeSet: ['original.bin'] });
    const stored = registry.loadWorktreeRegistryScope(root); delete stored.records.get(worker.id)!.mergeBaseline;
    registry.saveWorktreeRegistryScope(stored); closeOpenClawStateDatabaseForTest();
    createWorktreeService(root).cleanup(worker.id); expect(existsSync(worker.root)).toBe(false);
    expect(readFileSync(path.join(root, 'original.bin'), 'utf8')).toBe('base');
  });
  it('integrates a new native directory using the verified platform mode', async () => {
    nativeRepository(); const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['new-directory/receipt.txt'] });
    mkdirSync(path.join(worker.root, 'new-directory')); writeFileSync(path.join(worker.root, 'new-directory', 'receipt.txt'), 'new directory result');
    const result = await mergeOrchestrationWorktrees({ baseRoot: root, workers: [{ taskNodeId: 'native-directory',
      worktreeId: worker.id, worktreeGeneration: worker.generation, declaredWriteSet: ['new-directory/receipt.txt'] }] });
    expect(result[0].status).toBe('merged');
    expect(readFileSync(path.join(root, 'new-directory', 'receipt.txt'), 'utf8')).toBe('new directory result');
    proof('native-new-directory-merge', { platform: process.platform,
      workerMode: mergeFiles.captureWorktreeModes(worker.root).get('new-directory'),
      targetMode: mergeFiles.captureWorktreeModes(root).get('new-directory'), result });
  });
  it('reuses a verified frozen candidate after an interrupted publication retry', () => {
    nativeRepository(); vi.stubEnv('GIT_AUTHOR_DATE', '2026-11-11T00:00:00+08:00'); vi.stubEnv('GIT_COMMITTER_DATE', '2026-11-11T00:00:00+08:00');
    const service = createWorktreeService(root, { backend: 'git' }), worker = service.create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'frozen worker result');
    const input = { baseRoot: root, workers: [{ taskNodeId: 'retry-candidate', worktreeId: worker.id,
      worktreeGeneration: worker.generation, declaredWriteSet: ['other.txt'] }] };
    const first = freezeOrchestrationWorktreeCandidate(input);
    vi.stubEnv('GIT_AUTHOR_DATE', '2026-11-12T00:00:00+08:00'); vi.stubEnv('GIT_COMMITTER_DATE', '2026-11-12T00:00:00+08:00');
    const second = freezeOrchestrationWorktreeCandidate(input);
    expect(first.status).toBe('frozen'); expect(second.status).toBe('frozen');
    if (first.status !== 'frozen' || second.status !== 'frozen') throw new Error(JSON.stringify({ first, second }));
    expect(second.manifest).toEqual(first.manifest); expect(second.materializedPath).toBe(first.materializedPath);
    proof('candidate-publication-retry', { first, second });
  });
  it('refuses worker bytes that changed after the immutable candidate was frozen', async () => {
    nativeRepository(); const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['other.txt'] }); writeFileSync(path.join(worker.root, 'other.txt'), 'frozen worker result');
    const request = { taskNodeId: 'frozen-input', worktreeId: worker.id, worktreeGeneration: worker.generation, declaredWriteSet: ['other.txt'] };
    const candidate = freezeOrchestrationWorktreeCandidate({ baseRoot: root, workers: [request] });
    if (candidate.status !== 'frozen') throw new Error(JSON.stringify(candidate));
    const { orchestrationCandidatePostimages, inspectOrchestrationCandidate } = await import('../../openclaw_runtime/src/agents/orchestration-candidate');
    const expectedPostimages = orchestrationCandidatePostimages(root, candidate.manifest, ['other.txt']);
    writeFileSync(path.join(worker.root, 'other.txt'), 'later worker bytes');
    const result = await mergeOrchestrationWorktrees({ baseRoot: root, workers: [{ ...request, expectedPostimages }] });
    expect(result[0]).toMatchObject({ status: 'conflict', reason: expect.stringContaining('frozen_candidate_changed') });
    expect(readFileSync(path.join(root, 'other.txt'), 'utf8')).toBe('original other');
    expect(inspectOrchestrationCandidate(candidate)).toBe(true);
    expect(service.writer(worker.id)?.operations.at(-1)?.receipt?.outcome).toBe('not-applied');
    proof('frozen-postimage-refusal', { candidate, expectedPostimages, result });
  });
  it('retains an already-started verifier decision when the disposable candidate later disappears', async () => {
    const { testing, addSubagentRunForTests, releaseSubagentRun } = await import('../../openclaw_runtime/src/agents/subagent-registry');
    const row = { runId: 'started-verifier-worker', childSessionKey: 'agent:r4:worker', requesterSessionKey: 'agent:r4:main',
      workspaceDir: root, createdAt: Date.now(), endedAt: Date.now(), outcome: { status: 'ok' },
      orchestration: { orchestrationRunId: 'started-verifier-run', originalTask: 'verify preserved decision', phase: 'worker',
        isolation: 'worktree', worktreeId: 'gone-worker', worktreeGeneration: 'original-generation',
        worktreeMergeProcessedAt: Date.now(), worktreeMergeStatus: 'merged', verifierStartedRunId: 'original-verifier' } } as unknown as import('../../openclaw_runtime/src/agents/subagent-registry.types').SubagentRunRecord;
    testing.setDepsForTest({ persistSubagentRunsToDiskOrThrow: () => {} }); addSubagentRunForTests(row);
    try {
      const original = structuredClone(row.orchestration);
      await testing.maybeStartDeferredOrchestrationVerifier(row.runId);
      expect(row.orchestration).toEqual(original);
    } finally { releaseSubagentRun(row.runId); testing.setDepsForTest(); }
  });
  it.each(['id', 'generation'])('refuses completion metadata outside the registered worker scope (%s)', async mismatch => {
    nativeRepository(); const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['other.txt'] }); writeFileSync(path.join(worker.root, 'other.txt'), 'worker result');
    const { testing } = await import('../../openclaw_runtime/src/agents/subagent-registry');
    const row = { runId: 'scope-worker', workspaceDir: worker.root, outcome: { status: 'ok' },
      orchestration: { isolation: 'worktree', taskNodeId: 'scope-task', worktreeWriteSet: ['other.txt'],
        worktreeId: mismatch === 'id' ? 'different-worker' : worker.id,
        worktreeGeneration: mismatch === 'generation' ? 'stale-generation' : worker.generation } } as unknown as import('../../openclaw_runtime/src/agents/subagent-registry.types').SubagentRunRecord;
    testing.setDepsForTest({ persistSubagentRunsToDiskOrThrow: () => {} });
    try {
      await testing.processCompletedOrchestrationWorktrees([row]);
      expect(row.orchestration?.worktreeMergeStatus).toBe('error');
      expect(row.orchestration?.worktreeMergeReason).toContain('worktree_completion_scope_mismatch');
      expect(readFileSync(path.join(root, 'other.txt'), 'utf8')).toBe('original other');
    } finally { testing.setDepsForTest(); }
  });
  it.each(['base', 'worker'] as const)('persists a real candidate in production completion metadata and names it in the verifier task (%s workspace)', async location => {
    nativeRepository(); const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'production worker result');
    const { testing } = await import('../../openclaw_runtime/src/agents/subagent-registry');
    const { inspectOrchestrationCandidate } = await import('../../openclaw_runtime/src/agents/orchestration-candidate');
    const row = { runId: 'candidate-worker', workspaceDir: location === 'worker' ? worker.root : root, outcome: { status: 'ok' },
      orchestration: { isolation: 'worktree', worktreeId: worker.id, worktreeGeneration: worker.generation,
        taskNodeId: 'candidate-task', worktreeWriteSet: ['other.txt'] } } as unknown as import('../../openclaw_runtime/src/agents/subagent-registry.types').SubagentRunRecord;
    testing.setDepsForTest({ persistSubagentRunsToDiskOrThrow: () => {} });
    try {
      await testing.processCompletedOrchestrationWorktrees([row]);
      expect(row.orchestration?.worktreeMergeStatus).toBe('merged');
      const candidate = row.orchestration!.worktreeVerificationCandidate!;
      expect(inspectOrchestrationCandidate(candidate)).toBe(true);
      const task = testing.buildVerifierTask({ originalTask: 'verify worker result', workers: [row] });
      expect(task).toContain(candidate.manifest.candidateCommitOid); expect(task).toContain(candidate.manifest.inputDigest);
      expect(readFileSync(path.join(candidate.materializedPath, 'other.txt'), 'utf8')).toBe('production worker result');
      const originalJournalRef = row.orchestration!.worktreeMergeJournalRef;
      delete row.orchestration!.worktreeMergeProcessedAt;
      await testing.processCompletedOrchestrationWorktrees([row]);
      expect(row.orchestration?.worktreeMergeStatus).toBe('merged');
      expect(row.orchestration?.worktreeVerificationCandidate).toEqual(candidate);
      expect(row.orchestration?.worktreeMergeJournalRef).toBe(originalJournalRef);
      execFileSync('git', ['add', 'other.txt'], { cwd: worker.root, windowsHide: true });
      execFileSync('git', ['-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'retained verifier result'], { cwd: worker.root, windowsHide: true });
      execFileSync('git', ['update-ref', 'refs/heads/retained-verifier-result', 'HEAD'], { cwd: worker.root, windowsHide: true });
      service.cleanup(worker.id); expect(existsSync(worker.root)).toBe(false);
      delete row.orchestration!.worktreeMergeProcessedAt;
      await testing.processCompletedOrchestrationWorktrees([row]);
      expect(row.orchestration?.worktreeMergeStatus).toBe('merged');
      expect(row.orchestration?.worktreeMergeJournalRef).toBe(originalJournalRef);
      writeFileSync(path.join(candidate.materializedPath, 'other.txt'), 'later drift');
      expect(inspectOrchestrationCandidate(candidate)).toBe(false);
      proof('production-candidate-binding', { candidate, task, driftRefused: true });
    } finally { testing.setDepsForTest(); }
  });
  it.each(['base', 'worker'] as const)('completes an inprocess worker and verifies the registered base (%s workspace)', async location => {
    writeFileSync(path.join(root, 'other.txt'), 'original other');
    const service = createWorktreeService(root);
    const worker = service.create('worker', { seedFiles: ['other.txt'], writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'inprocess worker result');
    const { testing, addSubagentRunForTests, releaseSubagentRun } = await import('../../openclaw_runtime/src/agents/subagent-registry');
    const roles = await import('../../openclaw_runtime/src/agents/role-spawn');
    const row = { runId: 'inprocess-completion-worker-' + location, childSessionKey: 'agent:r4:inprocess-worker-' + location, requesterSessionKey: 'agent:r4:main',
      createdAt: Date.now(), endedAt: Date.now(), workspaceDir: location === 'worker' ? worker.root : root, outcome: { status: 'ok' },
      orchestration: { orchestrationRunId: 'inprocess-completion-run-' + location, originalTask: 'verify integrated content', phase: 'worker',
        isolation: 'worktree', worktreeId: worker.id, worktreeGeneration: worker.generation, worktreeBackend: 'git',
        taskNodeId: 'inprocess-completion-task', worktreeWriteSet: ['other.txt'], verifierRole: 'verifier' },
    } as unknown as import('../../openclaw_runtime/src/agents/subagent-registry.types').SubagentRunRecord;
    testing.setDepsForTest({ persistSubagentRunsToDiskOrThrow: () => {}, getRuntimeConfig: () => ({}) });
    const dispatch = vi.spyOn(roles, 'spawnRoleSubagent').mockImplementation(async (request, context) => {
      expect(registry.canonicalWorktreePath(context.workspaceDir!)).toBe(registry.canonicalWorktreePath(root));
      expect(request.task).toContain('worktreeIntegration: merged');
      expect(request.task).toContain('worktreeBackend: inprocess');
      expect(request.task).not.toContain('exact materialized candidate directory');
      expect(readFileSync(path.join(context.workspaceDir!, 'other.txt'), 'utf8')).toBe('inprocess worker result');
      return { status: 'accepted', result: { status: 'accepted', runId: 'inprocess-verifier' } };
    });
    addSubagentRunForTests(row);
    try {
      await testing.maybeStartDeferredOrchestrationVerifier(row.runId);
      expect(row.orchestration?.worktreeMergeStatus, row.orchestration?.worktreeMergeReason).toBe('merged');
      expect(row.orchestration?.worktreeBackend).toBe('inprocess');
      expect(row.orchestration?.worktreeVerificationCandidate).toBeUndefined();
      expect(row.orchestration?.verifierStartedRunId, JSON.stringify(row.orchestration)).toBe('inprocess-verifier');
      expect(dispatch).toHaveBeenCalledTimes(1);
      proof('inprocess-production-completion-' + location, { metadata: row.orchestration, roleDispatch: 'injected' });
    } finally { releaseSubagentRun(row.runId); testing.setDepsForTest(); }
  });
  it('records a per-worker conflict when shared output changes the Git candidate baseline', async () => {
    nativeRepository(); const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'isolated worker result');
    writeFileSync(path.join(root, 'original.bin'), 'shared worker result');
    const { testing } = await import('../../openclaw_runtime/src/agents/subagent-registry');
    const isolated = { runId: 'dirty-base-isolated', workspaceDir: worker.root, outcome: { status: 'ok' }, orchestration: {
      isolation: 'worktree', worktreeId: worker.id, worktreeGeneration: worker.generation, taskNodeId: 'dirty-base-task', worktreeWriteSet: ['other.txt'],
    } } as unknown as import('../../openclaw_runtime/src/agents/subagent-registry.types').SubagentRunRecord;
    const shared = { runId: 'dirty-base-shared', workspaceDir: root, outcome: { status: 'ok' }, orchestration: { isolation: 'shared' } } as typeof isolated;
    const originalShared = structuredClone(shared);
    testing.setDepsForTest({ persistSubagentRunsToDiskOrThrow: () => {} });
    try {
      await testing.processCompletedOrchestrationWorktrees([shared, isolated]);
      expect(isolated.orchestration?.worktreeMergeStatus).toBe('conflict');
      expect(isolated.orchestration?.worktreeMergeReason).toBe('worktree_candidate_unavailable:main_worktree_dirty');
      expect(isolated.orchestration?.worktreeVerificationCandidate).toBeUndefined();
      expect(shared).toEqual(originalShared);
      expect(readFileSync(path.join(root, 'original.bin'), 'utf8')).toBe('shared worker result');
      expect(readFileSync(path.join(root, 'other.txt'), 'utf8')).toBe('original other');
      expect(readFileSync(path.join(worker.root, 'other.txt'), 'utf8')).toBe('isolated worker result');
      proof('shared-output-candidate-conflict', { isolated: isolated.orchestration, shared: shared.orchestration, workerRetained: existsSync(worker.root) });
    } finally { testing.setDepsForTest(); }
  });
  it('requires a candidate for a completed worktree with unknown backend provenance', async () => {
    const { testing, addSubagentRunForTests, releaseSubagentRun } = await import('../../openclaw_runtime/src/agents/subagent-registry');
    const roles = await import('../../openclaw_runtime/src/agents/role-spawn');
    const row = { runId: 'unknown-backend-worker', childSessionKey: 'agent:r4:unknown-backend', requesterSessionKey: 'agent:r4:main',
      createdAt: Date.now(), endedAt: Date.now(), workspaceDir: root, outcome: { status: 'ok' }, orchestration: {
        orchestrationRunId: 'unknown-backend-run', originalTask: 'verify legacy completion', phase: 'worker', verifierRole: 'verifier',
        isolation: 'worktree', worktreeId: 'unavailable-worker', worktreeGeneration: 'legacy-generation',
        worktreeMergeProcessedAt: Date.now(), worktreeMergeStatus: 'merged',
      },
    } as unknown as import('../../openclaw_runtime/src/agents/subagent-registry.types').SubagentRunRecord;
    testing.setDepsForTest({ persistSubagentRunsToDiskOrThrow: () => {}, getRuntimeConfig: () => ({}) });
    const dispatch = vi.spyOn(roles, 'spawnRoleSubagent'); addSubagentRunForTests(row);
    try {
      await testing.maybeStartDeferredOrchestrationVerifier(row.runId);
      expect(dispatch).not.toHaveBeenCalled();
      expect(row.orchestration?.verifierSkippedReason).toBe('worktree-candidate-unavailable');
    } finally { releaseSubagentRun(row.runId); testing.setDepsForTest(); }
  });
  it.each(['git-first', 'inprocess-first'] as const)('integrates mixed registry backends without sending inprocess to Git freeze (%s)', async order => {
    nativeRepository();
    const copied = createWorktreeService(root).create('copied', { seedFiles: ['original.bin'], writeSet: ['original.bin'] });
    const native = createWorktreeService(root, { backend: 'git' }).create('native', { writeSet: ['other.txt'] });
    writeFileSync(path.join(copied.root, 'original.bin'), 'copied result'); writeFileSync(path.join(native.root, 'other.txt'), 'native result');
    const { testing, addSubagentRunForTests, releaseSubagentRun } = await import('../../openclaw_runtime/src/agents/subagent-registry');
    const roles = await import('../../openclaw_runtime/src/agents/role-spawn');
    const rows = [native, copied].map(worker => ({ runId: 'mixed-backend-' + order + '-' + worker.id,
      childSessionKey: 'agent:r4:' + order + '-' + worker.id, requesterSessionKey: 'agent:r4:main', createdAt: Date.now(), endedAt: Date.now(),
      workspaceDir: worker.root, outcome: { status: 'ok' }, orchestration: {
        orchestrationRunId: 'mixed-backend-run-' + order, originalTask: 'verify both integrated worker outputs', phase: 'worker', verifierRole: 'verifier',
        isolation: 'worktree', worktreeId: worker.id, worktreeGeneration: worker.generation, taskNodeId: 'mixed-' + worker.id,
        worktreeWriteSet: worker.id === 'native' ? ['other.txt'] : ['original.bin'],
      },
    })) as unknown as import('../../openclaw_runtime/src/agents/subagent-registry.types').SubagentRunRecord[];
    if (order === 'inprocess-first') rows.reverse();
    testing.setDepsForTest({ persistSubagentRunsToDiskOrThrow: () => {}, getRuntimeConfig: () => ({}) });
    const dispatch = vi.spyOn(roles, 'spawnRoleSubagent').mockImplementation(async (request, context) => {
      const candidate = rows.find(row => row.orchestration?.worktreeBackend === 'git')!.orchestration!.worktreeVerificationCandidate!;
      expect(context.workspaceDir).toBe(candidate.materializedPath);
      expect(request.task).toContain('worktreeBackend: inprocess'); expect(request.task).toContain('worktreeIntegrationBaseRoot:');
      expect(request.task).toContain('copied'); expect(request.task).toContain('native');
      expect(readFileSync(path.join(candidate.materializedPath, 'other.txt'), 'utf8')).toBe('native result');
      expect(readFileSync(path.join(root, 'original.bin'), 'utf8')).toBe('copied result');
      return { status: 'accepted', result: { status: 'accepted', runId: 'mixed-backend-verifier' } };
    });
    for (const row of rows) addSubagentRunForTests(row);
    try {
      await testing.maybeStartDeferredOrchestrationVerifier(rows[0].runId);
      for (const row of rows) expect(row.orchestration?.worktreeMergeStatus, row.orchestration?.worktreeMergeReason).toBe('merged');
      const candidate = rows.find(row => row.orchestration?.worktreeBackend === 'git')!.orchestration!.worktreeVerificationCandidate!;
      expect(candidate.manifest.workerSnapshots.map(snapshot => snapshot.worktreeRole)).toEqual(['native']);
      expect(rows.find(row => row.orchestration?.worktreeBackend === 'inprocess')!.orchestration!.worktreeVerificationCandidate).toBeUndefined();
      expect(dispatch).toHaveBeenCalledTimes(1);
      proof('mixed-registry-backends-' + order, { workers: rows.map(row => row.orchestration), roleDispatch: 'injected' });
    } finally { for (const row of rows) releaseSubagentRun(row.runId); testing.setDepsForTest(); }
  });
  it('preserves a successful completion when an overlapping callback waits on the same target', async () => {
    nativeRepository(); const service = createWorktreeService(root, { backend: 'git' });
    const first = service.create('first', { writeSet: ['other.txt'] }), second = service.create('second', { writeSet: ['new.txt'] });
    writeFileSync(path.join(first.root, 'other.txt'), 'first result'); writeFileSync(path.join(second.root, 'new.txt'), 'second result');
    const rows = [first, second].map(worker => ({ runId: 'overlap-' + worker.id, workspaceDir: worker.root, outcome: { status: 'ok' }, orchestration: {
      isolation: 'worktree', worktreeId: worker.id, worktreeGeneration: worker.generation, taskNodeId: 'overlap-' + worker.id,
      worktreeWriteSet: worker.id === 'first' ? ['other.txt'] : ['new.txt'],
    } })) as unknown as import('../../openclaw_runtime/src/agents/subagent-registry.types').SubagentRunRecord[];
    const { testing } = await import('../../openclaw_runtime/src/agents/subagent-registry');
    const apply = mergeFiles.applyWorktreeFiles;
    let release!: () => void, reached!: () => void, held = false;
    const started = new Promise<void>(resolve => { reached = resolve; });
    vi.spyOn(mergeFiles, 'applyWorktreeFiles').mockImplementation(async input => {
      if (!held) { held = true; reached(); await new Promise<void>(resolve => { release = resolve; }); }
      return apply(input);
    });
    testing.setDepsForTest({ persistSubagentRunsToDiskOrThrow: () => {} });
    try {
      const a = testing.processCompletedOrchestrationWorktrees([rows[0]]); await started;
      const b = testing.processCompletedOrchestrationWorktrees(rows);
      release(); await Promise.all([a, b]);
      expect(rows[0].orchestration?.worktreeMergeStatus, JSON.stringify(rows.map(row => row.orchestration))).toBe('merged');
      expect(rows[0].orchestration?.worktreeMergeJournalRef).toMatch(/^write-journal:/);
      expect(rows[1].orchestration?.worktreeMergeStatus).toBe('conflict');
      expect(rows[1].orchestration?.worktreeMergeReason).toBe('worktree_candidate_unavailable:main_worktree_dirty');
      expect(readFileSync(path.join(root, 'other.txt'), 'utf8')).toBe('first result');
      expect(readFileSync(path.join(second.root, 'new.txt'), 'utf8')).toBe('second result');
      proof('overlapping-production-completion', { workers: rows.map(row => row.orchestration), targetQueue: 'original-owner' });
    } finally { testing.setDepsForTest(); }
  });
  it('does not publish a completed receipt onto metadata whose generation changed in flight', async () => {
    nativeRepository(); const service = createWorktreeService(root, { backend: 'git' }), worker = service.create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'valid generation result');
    const row = { runId: 'late-generation-worker', workspaceDir: worker.root, outcome: { status: 'ok' }, orchestration: {
      isolation: 'worktree', worktreeId: worker.id, worktreeGeneration: worker.generation, taskNodeId: 'late-generation-task', worktreeWriteSet: ['other.txt'],
    } } as unknown as import('../../openclaw_runtime/src/agents/subagent-registry.types').SubagentRunRecord;
    const { testing } = await import('../../openclaw_runtime/src/agents/subagent-registry');
    const apply = mergeFiles.applyWorktreeFiles; let release!: () => void, reached!: () => void;
    const reachedEffect = new Promise<void>(resolve => { reached = resolve; });
    vi.spyOn(mergeFiles, 'applyWorktreeFiles').mockImplementation(async input => {
      reached(); await new Promise<void>(resolve => { release = resolve; }); return apply(input);
    });
    testing.setDepsForTest({ persistSubagentRunsToDiskOrThrow: () => {} });
    try {
      const running = testing.processCompletedOrchestrationWorktrees([row]); await reachedEffect;
      row.orchestration!.worktreeGeneration = 'stale-or-different-generation'; release(); await running;
      expect(service.list().find(record => record.id === worker.id)?.mergeResult?.status).toBe('merged');
      expect(row.orchestration?.worktreeMergeStatus).toBeUndefined();
      expect(row.orchestration?.worktreeMergeProcessedAt).toBeUndefined();
      expect(row.orchestration?.worktreeMergeJournalRef).toBeUndefined();
      proof('late-generation-metadata-not-adopted', { validGeneration: worker.generation, metadata: row.orchestration });
    } finally { testing.setDepsForTest(); }
  });
  it.each(['processing', 'preparation', 'preparation-conflict'] as const)('retains completed prefix receipts and retries unfinished workers after batch %s fails', async phase => {
    nativeRepository(); const service = createWorktreeService(root, { backend: 'git' });
    const first = service.create('first', { writeSet: ['other.txt'] }), second = service.create('second', { writeSet: ['new.txt'] });
    writeFileSync(path.join(first.root, 'other.txt'), 'first result'); writeFileSync(path.join(second.root, 'new.txt'), 'second result');
    const rows = [first, second].map(worker => ({ runId: 'prefix-' + worker.id, workspaceDir: worker.root, outcome: { status: 'ok' }, orchestration: {
      isolation: 'worktree', worktreeId: worker.id, worktreeGeneration: worker.generation, taskNodeId: 'prefix-' + worker.id,
      worktreeWriteSet: worker.id === 'first' ? ['other.txt'] : ['new.txt'],
    } })) as unknown as import('../../openclaw_runtime/src/agents/subagent-registry.types').SubagentRunRecord[];
    const originalFactory = worktrees.createWorktreeService; let inject = true;
    vi.spyOn(worktrees, 'createWorktreeService').mockImplementation((base, options) => {
      const instance = originalFactory(base, options);
      const enqueue = instance.enqueueMerge.bind(instance), process = instance.processMergeQueue.bind(instance);
      if (phase !== 'processing') instance.enqueueMerge = input => {
        if (inject && input.worktreeId === second.id) {
          inject = false;
          if (phase === 'preparation-conflict') writeFileSync(path.join(first.root, 'undeclared.txt'), 'late worker drift');
          throw new Error('injected second worker queue validation failure');
        }
        return enqueue(input);
      };
      else instance.processMergeQueue = async (store, options) => {
        if (inject) {
          inject = false; await process(store, { ...options, worktreeIds: [first.id] });
          throw new Error('injected second writer busy after completed prefix');
        }
        return process(store, options);
      };
      return instance;
    });
    const { testing } = await import('../../openclaw_runtime/src/agents/subagent-registry');
    testing.setDepsForTest({ persistSubagentRunsToDiskOrThrow: () => {} });
    try {
      await testing.processCompletedOrchestrationWorktrees(rows);
      if (phase === 'preparation-conflict') {
        expect(rows[0].orchestration?.worktreeMergeStatus, JSON.stringify(rows.map(row => row.orchestration))).toBe('conflict');
        expect(rows[0].orchestration?.worktreeMergeReason).toContain('worker_changes_not_in_merge_request');
        expect(rows[0].orchestration?.worktreeMergeProcessedAt).toEqual(expect.any(Number));
        expect(rows[1].orchestration?.worktreeMergeProcessedAt).toBeUndefined();
        expect(service.getMergeQueue().some(item => item.status === 'pending')).toBe(false);
        expect(readFileSync(path.join(root, 'other.txt'), 'utf8')).toBe('original other');
        proof('completed-prefix-preparation-conflict', { workers: rows.map(row => row.orchestration), faults: 'injected', writesAndRegistry: 'native' });
        return;
      }
      expect(rows[0].orchestration?.worktreeMergeStatus, JSON.stringify(rows.map(row => row.orchestration))).toBe('merged');
      expect(rows[0].orchestration?.worktreeMergeReason).toBeUndefined();
      expect(rows[0].orchestration?.worktreeMergeProcessedAt).toEqual(expect.any(Number));
      const receipt = rows[0].orchestration?.worktreeMergeJournalRef;
      expect(receipt).toMatch(/^write-journal:/);
      expect(rows[1].orchestration?.worktreeMergeStatus).toBe('error');
      expect(rows[1].orchestration?.worktreeMergeProcessedAt).toBeUndefined();
      if (phase === 'preparation') expect(service.getMergeQueue().some(item => item.status === 'pending')).toBe(false);
      await testing.processCompletedOrchestrationWorktrees(rows);
      expect(rows.every(row => row.orchestration?.worktreeMergeStatus === 'merged')).toBe(true);
      expect(rows[1].orchestration?.worktreeMergeReason).toBeUndefined();
      expect(rows[0].orchestration?.worktreeMergeJournalRef).toBe(receipt);
      expect(readFileSync(path.join(root, 'new.txt'), 'utf8')).toBe('second result');
      proof('completed-prefix-' + phase, { phase, workers: rows.map(row => row.orchestration), faults: 'injected', writesAndRegistry: 'native' });
    } finally { testing.setDepsForTest(); }
  });
  it.each(['unlisted-file', 'allowed-state', 'prefix-neighbor'] as const)('checks ignored candidate files against its frozen allowlist (%s)', async state => {
    nativeRepository(); writeFileSync(path.join(root, '.gitignore'), '.openclaw/\ncache-*/\n*.runtime-config\n');
    git('add', '.gitignore'); git('-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'ignored runtime paths');
    const worker = createWorktreeService(root, { backend: 'git' }).create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'candidate result');
    const input = { baseRoot: root, workers: [{ taskNodeId: 'ignored-candidate', worktreeId: worker.id, worktreeGeneration: worker.generation,
      declaredWriteSet: ['other.txt'] }], allowedRuntimeIgnorePaths: ['cache-ok/'] };
    const candidate = freezeOrchestrationWorktreeCandidate(input);
    if (candidate.status !== 'frozen') throw new Error(JSON.stringify(candidate));
    const { inspectOrchestrationCandidate } = await import('../../openclaw_runtime/src/agents/orchestration-candidate');
    const name = state === 'unlisted-file' ? 'extra.runtime-config' : state === 'allowed-state' ? 'cache-ok/state.json' : 'cache-ok-extra/state.json';
    mkdirSync(path.dirname(path.join(candidate.materializedPath, name)), { recursive: true }); writeFileSync(path.join(candidate.materializedPath, name), 'generated or unlisted bytes');
    expect(execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: candidate.materializedPath, windowsHide: true, encoding: 'utf8' }).trim()).toBe('');
    expect(inspectOrchestrationCandidate(candidate)).toBe(state === 'allowed-state');
    const repeat = freezeOrchestrationWorktreeCandidate(input);
    expect(repeat.status).toBe(state === 'allowed-state' ? 'frozen' : 'rejected');
    proof('candidate-ignored-allowlist-' + state, { candidate, repeat, ignoredPath: name });
  });
  it.each(['tracked', 'untracked', 'staged-only', 'reset-after-merged'] as const)('rejects extra target dirty writes before saved candidate reuse (%s)', async kind => {
    nativeRepository(); const worker = createWorktreeService(root, { backend: 'git' }).create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'candidate result');
    const { testing } = await import('../../openclaw_runtime/src/agents/subagent-registry');
    const row = { runId: 'extra-target-worker', workspaceDir: worker.root, outcome: { status: 'ok' }, orchestration: {
      isolation: 'worktree', worktreeId: worker.id, worktreeGeneration: worker.generation, taskNodeId: 'extra-target-task', worktreeWriteSet: ['other.txt'],
    } } as unknown as import('../../openclaw_runtime/src/agents/subagent-registry.types').SubagentRunRecord;
    testing.setDepsForTest({ persistSubagentRunsToDiskOrThrow: () => {} });
    try {
      await testing.processCompletedOrchestrationWorktrees([row]); expect(row.orchestration?.worktreeMergeStatus).toBe('merged');
      const candidate = row.orchestration!.worktreeVerificationCandidate!, receipt = row.orchestration!.worktreeMergeJournalRef;
      const extra = kind === 'untracked' ? 'external-extra.txt' : 'original.bin';
      if (kind === 'reset-after-merged') git('restore', '--source=HEAD', '--worktree', '--', 'other.txt');
      else writeFileSync(path.join(root, extra), 'external target bytes');
      if (kind === 'staged-only') { git('add', '--', extra); writeFileSync(path.join(root, extra), Buffer.from([0, 1, 255, 4])); }
      delete row.orchestration!.worktreeMergeProcessedAt;
      await testing.processCompletedOrchestrationWorktrees([row]);
      expect(row.orchestration?.worktreeMergeStatus).toBe('conflict');
      expect(row.orchestration?.worktreeMergeReason).toContain('saved_candidate_target_changed');
      expect(row.orchestration?.worktreeVerificationCandidate).toEqual(candidate);
      expect(row.orchestration?.worktreeMergeJournalRef).toBe(receipt);
      if (kind === 'reset-after-merged') expect(readFileSync(path.join(root, 'other.txt'), 'utf8')).toBe('original other');
      else if (kind === 'staged-only') expect(readFileSync(path.join(root, extra))).toEqual(Buffer.from([0, 1, 255, 4]));
      else expect(readFileSync(path.join(root, extra), 'utf8')).toBe('external target bytes');
      proof('saved-candidate-extra-target-' + kind, { candidate, metadata: row.orchestration });
    } finally { testing.setDepsForTest(); }
  });
  it('keeps the native parent spelling when the final declared component was deleted', async () => {
    if (process.platform !== 'win32') return;
    nativeRepository(); mkdirSync(path.join(root, 'src')); writeFileSync(path.join(root, 'src', 'a.ts'), 'base source');
    git('add', 'src/a.ts'); git('-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'nested source');
    const worker = createWorktreeService(root, { backend: 'git' }).create('nested-delete', { writeSet: ['src/a.ts'] });
    unlinkSync(path.join(worker.root, 'src', 'a.ts'));
    expect(mergeFiles.nativeFilename(worker.root, 'SRC/a.ts')).toBe('src/a.ts');
    expect(mergeFiles.nativeFilename(worker.root, 'SRC/missing/next.ts')).toBe('src/missing/next.ts');
    const input = { taskNodeId: 'nested-delete', worktreeId: worker.id, worktreeGeneration: worker.generation, declaredWriteSet: ['SRC/a.ts'] };
    const candidate = freezeOrchestrationWorktreeCandidate({ baseRoot: root, workers: [input] }); expect(candidate.status).toBe('frozen');
    const result = await mergeOrchestrationWorktrees({ baseRoot: root, workers: [input] }); expect(result[0].status).toBe('merged');
    expect(existsSync(path.join(root, 'src', 'a.ts'))).toBe(false);
    proof('native-missing-final-spelling', { result, candidate });
  });
  it.each(['assume-unchanged', 'skip-worktree'] as const)('rejects hidden worker index edits before freeze and native merge (%s)', async flag => {
    nativeRepository(); const service = createWorktreeService(root, { backend: 'git' }), worker = service.create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'declared worker result');
    execFileSync('git', ['update-index', '--' + flag, '--', 'original.bin'], { cwd: worker.root, windowsHide: true });
    writeFileSync(path.join(worker.root, 'original.bin'), 'hidden undeclared worker result');
    const input = { taskNodeId: 'hidden-worker', worktreeId: worker.id, worktreeGeneration: worker.generation, declaredWriteSet: ['other.txt'] };
    expect(() => freezeOrchestrationWorktreeCandidate({ baseRoot: root, workers: [input] })).toThrow('hidden_index_flags');
    service.enqueueMerge({ worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['other.txt'] });
    const results = await service.processMergeQueue();
    expect(results[0].status).toBe('conflict'); expect(results[0].reason).toContain('hidden_index_flags');
    expect(readFileSync(path.join(root, 'other.txt'), 'utf8')).toBe('original other');
    proof('worker-hidden-index-' + flag, { results, workerGeneration: worker.generation, hiddenWorkerBytesRetained: true });
  });
  it.each(['assume-unchanged', 'skip-worktree'] as const)('rejects hidden index flags on untouched candidate files (%s)', async flag => {
    nativeRepository(); const worker = createWorktreeService(root, { backend: 'git' }).create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'candidate result');
    const input = { baseRoot: root, workers: [{ taskNodeId: 'hidden-candidate', worktreeId: worker.id, worktreeGeneration: worker.generation, declaredWriteSet: ['other.txt'] }] };
    const candidate = freezeOrchestrationWorktreeCandidate(input); if (candidate.status !== 'frozen') throw new Error(JSON.stringify(candidate));
    const { inspectOrchestrationCandidate } = await import('../../openclaw_runtime/src/agents/orchestration-candidate');
    execFileSync('git', ['update-index', '--' + flag, '--', 'original.bin'], { cwd: candidate.materializedPath, windowsHide: true });
    writeFileSync(path.join(candidate.materializedPath, 'original.bin'), 'unverified untouched file');
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: candidate.materializedPath, windowsHide: true, encoding: 'utf8' }).trim()).toBe('');
    expect(inspectOrchestrationCandidate(candidate)).toBe(false);
    expect(freezeOrchestrationWorktreeCandidate(input).status).toBe('rejected');
    proof('candidate-hidden-index-' + flag, { candidate, hiddenIndexRejected: true });
  });
  it.each(['.openclaw', 'candidates'] as const)('rejects a redirected candidate parent before external materialization (%s)', async directory => {
    nativeRepository(); const outside = path.join(fixture, 'outside'); mkdirSync(outside);
    if (directory === 'candidates') mkdirSync(path.join(root, '.openclaw'));
    symlinkSync(outside, directory === '.openclaw' ? path.join(root, '.openclaw') : path.join(root, '.openclaw', 'candidates'), 'junction');
    const { freezeOrchestrationCandidate } = await import('../../openclaw_runtime/src/agents/orchestration-candidate');
    expect(() => freezeOrchestrationCandidate({ baseRoot: root, workers: [] })).toThrow('candidate_parent_redirected');
    expect(readdirSync(outside)).toEqual([]);
    proof('candidate-parent-boundary-' + directory, { outsideUnchanged: true, actor: 'native-root-boundary-test' });
  });
  it('records journal preparation before actual writer effect admission', async () => {
    nativeRepository(); const service = createWorktreeService(root, { backend: 'git' }), worker = service.create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'actual writer result');
    const apply = mergeFiles.applyWorktreeFiles; const order: string[] = [];
    vi.spyOn(mergeFiles, 'applyWorktreeFiles').mockImplementation(input => apply({ ...input,
      beforeApply: (ref, hashes) => {
        input.beforeApply?.(ref, hashes); order.push('journal');
        expect(service.writer(null)?.operations.at(-1)?.effectPrepared).toBe(false);
      },
      beforeEffect: () => {
        input.beforeEffect?.(); order.push('effect');
        expect(service.writer(null)?.operations.at(-1)?.effectPrepared).toBe(true);
      },
    }));
    service.enqueueMerge({ worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['other.txt'] });
    expect((await service.processMergeQueue())[0].status).toBe('merged');
    expect(order).toEqual(['journal', 'effect']);
    proof('production-journal-effect-order', { order, writer: service.writer(null) });
  });
  it.each(['junction', 'replacement-worktree', 'backpointer', 'environment-worktree'] as const)('rejects candidate identity replacement with unchanged commit and bytes (%s)', async change => {
    nativeRepository(); const worker = createWorktreeService(root, { backend: 'git' }).create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'candidate result');
    const candidate = freezeOrchestrationWorktreeCandidate({ baseRoot: root, workers: [{ taskNodeId: 'identity-task', worktreeId: worker.id,
      worktreeGeneration: worker.generation, declaredWriteSet: ['other.txt'] }] });
    if (candidate.status !== 'frozen') throw new Error(JSON.stringify(candidate));
    const { inspectOrchestrationCandidate } = await import('../../openclaw_runtime/src/agents/orchestration-candidate');
    expect(inspectOrchestrationCandidate(candidate)).toBe(true);
    const missingIdentity = structuredClone(candidate); delete missingIdentity.manifest.materializedIdentity;
    expect(inspectOrchestrationCandidate(missingIdentity)).toBe(false);
    const retained = candidate.materializedPath + '-retained', replacement = candidate.materializedPath + '-replacement';
    if (change === 'environment-worktree') {
      git('worktree', 'add', '--detach', replacement, candidate.manifest.candidateCommitOid);
      const previous = process.env.GIT_WORK_TREE; vi.stubEnv('GIT_WORK_TREE', replacement);
      try {
        expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidate.materializedPath, windowsHide: true, encoding: 'utf8' }).trim()).toBe(candidate.manifest.candidateCommitOid);
        expect(registry.canonicalWorktreePath(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: candidate.materializedPath, windowsHide: true, encoding: 'utf8' }).trim())).toBe(registry.canonicalWorktreePath(replacement));
        expect(inspectOrchestrationCandidate(candidate)).toBe(false);
      } finally { vi.stubEnv('GIT_WORK_TREE', previous); }
    } else if (change === 'backpointer') {
      const privateGit = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: candidate.materializedPath, windowsHide: true, encoding: 'utf8' }).trim();
      const pointer = path.join(privateGit, 'gitdir'), original = readFileSync(pointer);
      try {
        writeFileSync(pointer, path.join(worker.root, '.git') + '\n');
        expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidate.materializedPath, windowsHide: true, encoding: 'utf8' }).trim()).toBe(candidate.manifest.candidateCommitOid);
        expect(inspectOrchestrationCandidate(candidate)).toBe(false);
      } finally { writeFileSync(pointer, original); }
    } else {
      git('worktree', 'add', '--detach', replacement, candidate.manifest.candidateCommitOid);
      renameSync(candidate.materializedPath, retained);
      if (change === 'junction') symlinkSync(replacement, candidate.materializedPath, 'junction');
      else renameSync(replacement, candidate.materializedPath);
      try {
        expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidate.materializedPath, windowsHide: true, encoding: 'utf8' }).trim()).toBe(candidate.manifest.candidateCommitOid);
        expect(readFileSync(path.join(candidate.materializedPath, 'other.txt'), 'utf8')).toBe('candidate result');
        expect(inspectOrchestrationCandidate(candidate)).toBe(false);
      } finally {
        if (change === 'junction') unlinkSync(candidate.materializedPath);
        else renameSync(candidate.materializedPath, replacement);
        renameSync(retained, candidate.materializedPath);
      }
    }
    expect(inspectOrchestrationCandidate(candidate)).toBe(true);
    proof('candidate-native-identity-' + change, { identity: candidate.manifest.materializedIdentity, unchangedCommit: candidate.manifest.candidateCommitOid, replacementRejected: true });
  });
  it('dispatches the original verifier into the immutable candidate directory', async () => {
    nativeRepository(); const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['other.txt'] }); writeFileSync(path.join(worker.root, 'other.txt'), 'verified candidate bytes');
    const { testing, addSubagentRunForTests, releaseSubagentRun } = await import('../../openclaw_runtime/src/agents/subagent-registry');
    const roleSpawn = await import('../../openclaw_runtime/src/agents/role-spawn');
    const row = { runId: 'actual-candidate-worker', childSessionKey: 'agent:r4:candidate-child', requesterSessionKey: 'agent:r4:main',
      createdAt: Date.now(), endedAt: Date.now(), workspaceDir: worker.root, outcome: { status: 'ok' },
      orchestration: { orchestrationRunId: 'actual-candidate-verifier', originalTask: 'verify immutable result', phase: 'worker',
        isolation: 'worktree', worktreeId: worker.id, worktreeGeneration: worker.generation, taskNodeId: 'actual-candidate-task',
        worktreeWriteSet: ['other.txt'], verifierRole: 'verifier' } } as unknown as import('../../openclaw_runtime/src/agents/subagent-registry.types').SubagentRunRecord;
    testing.setDepsForTest({ persistSubagentRunsToDiskOrThrow: () => {}, getRuntimeConfig: () => ({}) });
    let verifierProof: { executionDirectory?: string; checkExit: number | null } | undefined;
    try {
      await testing.processCompletedOrchestrationWorktrees([row]);
      expect(row.orchestration?.worktreeMergeStatus).toBe('merged');
      const candidate = row.orchestration!.worktreeVerificationCandidate!;
      writeFileSync(path.join(root, 'other.txt'), 'later mutable base bytes');
      const spawn = vi.spyOn(roleSpawn, 'spawnRoleSubagent').mockImplementation(async (request, context) => {
        expect(context.workspaceDir).toBe(candidate.materializedPath);
        expect(request.task).toContain(candidate.manifest.candidateCommitOid);
        const check = spawnSync(process.execPath, ['-e', 'const fs=require("node:fs"),a=require("node:assert/strict");a.equal(fs.readFileSync("other.txt","utf8"),"verified candidate bytes");'],
          { cwd: context.workspaceDir, windowsHide: true, encoding: 'utf8' });
        verifierProof = { executionDirectory: context.workspaceDir, checkExit: check.status };
        expect(check.status, check.stderr).toBe(0);
        return { status: 'accepted', result: { status: 'accepted', runId: 'actual-candidate-verifier-run' } };
      });
      addSubagentRunForTests(row);
      await testing.maybeStartDeferredOrchestrationVerifier(row.runId);
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(row.orchestration?.verifierStartedRunId).toBe('actual-candidate-verifier-run');
      expect(verifierProof?.checkExit).toBe(0);
      expect(readFileSync(path.join(root, 'other.txt'), 'utf8')).toBe('later mutable base bytes');
      proof('actual-verifier-candidate-directory', { candidate, verifierProof, roleDispatch: 'injected', checkProcess: 'native Node in dispatched candidate cwd' });
    } finally { releaseSubagentRun(row.runId); testing.setDepsForTest(); }
  });
  it.each(['new-file', 'unstaged-rename'] as const)('includes all declared disk paths in production candidate postimages (%s)', async scenario => {
    nativeRepository(); const paths = scenario === 'new-file' ? ['new-output.txt'] : ['other.txt', 'renamed-output.txt'];
    const service = createWorktreeService(root, { backend: 'git' }); const worker = service.create('worker', { writeSet: paths });
    if (scenario === 'new-file') writeFileSync(path.join(worker.root, 'new-output.txt'), 'new result');
    else renameSync(path.join(worker.root, 'other.txt'), path.join(worker.root, 'renamed-output.txt'));
    const { testing } = await import('../../openclaw_runtime/src/agents/subagent-registry');
    const row = { runId: 'new-path-worker', workspaceDir: worker.root, outcome: { status: 'ok' },
      orchestration: { isolation: 'worktree', worktreeId: worker.id, worktreeGeneration: worker.generation,
        taskNodeId: 'new-path-task', worktreeWriteSet: paths } } as unknown as import('../../openclaw_runtime/src/agents/subagent-registry.types').SubagentRunRecord;
    testing.setDepsForTest({ persistSubagentRunsToDiskOrThrow: () => {} });
    try {
      await testing.processCompletedOrchestrationWorktrees([row]);
      expect(row.orchestration?.worktreeMergeStatus, row.orchestration?.worktreeMergeReason).toBe('merged');
      const candidate = row.orchestration!.worktreeVerificationCandidate!;
      expect(candidate.manifest.workerSnapshots[0].changedFiles.toSorted()).toEqual(paths.toSorted());
      const resultPath = paths.at(-1)!;
      expect(readFileSync(path.join(root, resultPath), 'utf8')).toBe(scenario === 'new-file' ? 'new result' : 'original other');
      if (scenario === 'unstaged-rename') expect(existsSync(path.join(root, 'other.txt'))).toBe(false);
      expect(row.orchestration?.worktreeMergeHashes).toHaveProperty([resultPath]);
      proof('production-all-candidate-paths-' + scenario, { candidate, paths, hashes: row.orchestration?.worktreeMergeHashes });
    } finally { testing.setDepsForTest(); }
  });
  it.each(['new-file-removed', 'tracked-restored', 'unexpected-path'] as const)('rejects any frozen candidate path-set change (%s)', async state => {
    nativeRepository(); const service = createWorktreeService(root, { backend: 'git' });
    const target = state === 'new-file-removed' ? 'new-result.txt' : 'other.txt';
    const worker = service.create('worker', { writeSet: [target, 'extra-result.txt'] });
    writeFileSync(path.join(worker.root, target), 'frozen result');
    const input = { taskNodeId: 'frozen-paths', worktreeId: worker.id, worktreeGeneration: worker.generation, declaredWriteSet: [target] };
    const candidate = freezeOrchestrationWorktreeCandidate({ baseRoot: root, workers: [input] });
    if (candidate.status !== 'frozen') throw new Error(JSON.stringify(candidate));
    const { orchestrationCandidatePostimages } = await import('../../openclaw_runtime/src/agents/orchestration-candidate');
    const expectedPostimages = orchestrationCandidatePostimages(root, candidate.manifest, [target]);
    if (state === 'new-file-removed') unlinkSync(path.join(worker.root, target));
    else if (state === 'tracked-restored') writeFileSync(path.join(worker.root, target), 'original other');
    else writeFileSync(path.join(worker.root, 'extra-result.txt'), 'unexpected later path');
    const result = await mergeOrchestrationWorktrees({ baseRoot: root, workers: [{ ...input, expectedPostimages }] });
    expect(result[0].status).toBe('conflict'); expect(result[0].reason).toContain('frozen_candidate_changed');
    expect(readFileSync(path.join(root, 'other.txt'), 'utf8')).toBe('original other');
    expect(existsSync(path.join(root, 'new-result.txt'))).toBe(false); expect(existsSync(path.join(root, 'extra-result.txt'))).toBe(false);
    proof('frozen-path-set-' + state, { candidate, expectedPostimages, result });
  });
  it('preserves raw CRLF postimages and detects byte drift hidden by Git normalization', async () => {
    nativeRepository(); git('config', 'core.autocrlf', 'true');
    writeFileSync(path.join(root, '.gitattributes'), '*.txt text eol=crlf\n'); writeFileSync(path.join(root, 'other.txt'), 'original other\r\n');
    git('add', '.gitattributes', 'other.txt'); git('-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'CRLF baseline');
    const service = createWorktreeService(root, { backend: 'git' }), worker = service.create('worker', { writeSet: ['other.txt'] });
    const wanted = Buffer.from('first\r\nsecond\r\n'); writeFileSync(path.join(worker.root, 'other.txt'), wanted);
    const { testing } = await import('../../openclaw_runtime/src/agents/subagent-registry');
    const { inspectOrchestrationCandidate } = await import('../../openclaw_runtime/src/agents/orchestration-candidate');
    const row = { runId: 'crlf-worker', workspaceDir: worker.root, outcome: { status: 'ok' }, orchestration: {
      isolation: 'worktree', worktreeId: worker.id, worktreeGeneration: worker.generation, taskNodeId: 'crlf-task', worktreeWriteSet: ['other.txt'],
    } } as unknown as import('../../openclaw_runtime/src/agents/subagent-registry.types').SubagentRunRecord;
    testing.setDepsForTest({ persistSubagentRunsToDiskOrThrow: () => {} });
    try {
      await testing.processCompletedOrchestrationWorktrees([row]);
      expect(row.orchestration?.worktreeMergeStatus, row.orchestration?.worktreeMergeReason).toBe('merged');
      const candidate = row.orchestration!.worktreeVerificationCandidate!;
      expect(readFileSync(path.join(root, 'other.txt'))).toEqual(wanted);
      expect(readFileSync(path.join(candidate.materializedPath, 'other.txt'))).toEqual(wanted);
      expect(git('show', candidate.manifest.candidateCommitOid + ':other.txt')).toBe('first\nsecond');
      writeFileSync(path.join(candidate.materializedPath, 'other.txt'), 'first\nsecond\n');
      // Refresh index stat data for the same normalized blob; the Git tree stays unchanged.
      execFileSync('git', ['add', '--', 'other.txt'], { cwd: candidate.materializedPath, windowsHide: true });
      expect(execFileSync('git', ['write-tree'], { cwd: candidate.materializedPath, windowsHide: true, encoding: 'utf8' }).trim()).toBe(candidate.manifest.candidateTreeOid);
      expect(execFileSync('git', ['status', '--porcelain'], { cwd: candidate.materializedPath, windowsHide: true, encoding: 'utf8' }).trim()).toBe('');
      expect(inspectOrchestrationCandidate(candidate)).toBe(false);
      proof('raw-crlf-candidate', { candidate, integratedRawSha256: mergeFiles.worktreeContentHash(wanted), normalizedDriftRefused: true });
    } finally { testing.setDepsForTest(); }
  });
  it.each(['failed-first', 'failed-last', 'all-failed', 'failed-worktree-shared-success'] as const)('keeps the original verifier decision for mixed worker outcomes (%s)', async order => {
    nativeRepository(); const service = createWorktreeService(root, { backend: 'git' }), worker = service.create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'successful worker');
    const { testing, addSubagentRunForTests, releaseSubagentRun } = await import('../../openclaw_runtime/src/agents/subagent-registry');
    const roles = await import('../../openclaw_runtime/src/agents/role-spawn');
    const good = { runId: 'mixed-good', childSessionKey: 'agent:r4:mixed-good', requesterSessionKey: 'agent:r4:main', createdAt: Date.now(), endedAt: Date.now(),
      workspaceDir: worker.root, outcome: { status: order === 'all-failed' ? 'error' : 'ok' }, orchestration: {
        orchestrationRunId: 'mixed-result-run', originalTask: 'Verify all worker outcomes', phase: 'worker', verifierRole: 'verifier',
        isolation: 'worktree', worktreeId: worker.id, worktreeGeneration: worker.generation, taskNodeId: 'mixed-good-task', worktreeWriteSet: ['other.txt'],
      } } as unknown as import('../../openclaw_runtime/src/agents/subagent-registry.types').SubagentRunRecord;
    const bad = { ...good, runId: 'mixed-bad', childSessionKey: 'agent:r4:mixed-bad', outcome: { status: 'error', error: 'worker failed' },
      orchestration: { ...good.orchestration!, taskNodeId: 'mixed-bad-task', worktreeId: 'failed-worker' } } as typeof good;
    if (order === 'failed-worktree-shared-success') { good.workspaceDir = root; good.orchestration = { ...good.orchestration!, isolation: 'shared', worktreeId: undefined, worktreeGeneration: undefined }; }
    const rows = order === 'failed-first' || order === 'failed-worktree-shared-success' ? [bad, good] : [good, bad];
    testing.setDepsForTest({ persistSubagentRunsToDiskOrThrow: () => {}, getRuntimeConfig: () => ({}) });
    const spawn = vi.spyOn(roles, 'spawnRoleSubagent').mockImplementation(async (request, context) => {
      expect(context.workspaceDir).toBe(good.orchestration!.worktreeVerificationCandidate?.materializedPath ?? root);
      expect(request.task).toContain('mixed-bad'); expect(request.task).toContain('worker failed');
      return { status: 'accepted', result: { status: 'accepted', runId: 'mixed-verifier' } };
    });
    for (const row of rows) addSubagentRunForTests(row);
    try {
      await testing.maybeStartDeferredOrchestrationVerifier(rows[0].runId);
      if (order === 'all-failed') { expect(spawn).not.toHaveBeenCalled(); expect(good.orchestration?.verifierSkippedReason).toBe('all-workers-failed'); }
      else { expect(spawn).toHaveBeenCalledTimes(1); expect(good.orchestration?.verifierStartedRunId).toBe('mixed-verifier'); expect(bad.orchestration?.verifierStartedRunId).toBe('mixed-verifier'); }
      proof('mixed-worker-verifier-' + order, { order, good: good.orchestration, bad: bad.orchestration, roleDispatch: 'injected' });
    } finally { for (const row of rows) releaseSubagentRun(row.runId); testing.setDepsForTest(); }
  });
  it('reads the persisted baseline and returns the original receipt from a fresh native process', () => {
    nativeRepository();
    const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'worker result');
    service.enqueueMerge({ worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['other.txt'] });
    closeOpenClawStateDatabaseForTest();
    const runtimeRequire = createRequire(path.resolve('openclaw_runtime/package.json'));
    const command = [runtimeRequire.resolve('tsx/cli'), '--tsconfig', path.resolve('openclaw_runtime/tsconfig.json'),
      path.resolve('tests/fixtures/worktree-integration-process.ts'), root, worker.id, worker.generation, JSON.stringify(['other.txt'])];
    const first = spawnSync(process.execPath, command, { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
    expect(first.status, first.stderr).toBe(0);
    const firstProof = JSON.parse(first.stdout);
    expect(firstProof.processed[0]).toMatchObject({ status: 'merged', journalRef: expect.stringMatching(/^write-journal:/) });
    const second = spawnSync(process.execPath, command, { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
    expect(second.status, second.stderr).toBe(0);
    const secondProof = JSON.parse(second.stdout);
    expect(secondProof.pid).not.toBe(firstProof.pid);
    expect(secondProof.queued).toEqual(firstProof.processed[0]);
    expect(secondProof.processed).toEqual([]);
    expect(secondProof.remaining).toEqual([]);
    expect(readFileSync(path.join(root, 'other.txt'), 'utf8')).toBe('worker result');
    proof('native-restart', { first: firstProof, second: secondProof });
  });
  it('verifies two real worker results on the newly frozen candidate instead of the old base', async () => {
    nativeRepository();
    const service = createWorktreeService(root, { backend: 'git' });
    const first = service.create('first', { writeSet: ['other.txt'] });
    const second = service.create('second', { writeSet: ['new.txt'] });
    writeFileSync(path.join(first.root, 'other.txt'), 'first result');
    writeFileSync(path.join(second.root, 'new.txt'), 'second result');
    const workers = [
      { taskNodeId: 'task-first', worktreeId: first.id, worktreeGeneration: first.generation, declaredWriteSet: ['other.txt'] },
      { taskNodeId: 'task-second', worktreeId: second.id, worktreeGeneration: second.generation, declaredWriteSet: ['new.txt'] },
    ];
    const oldHead = git('rev-parse', 'HEAD');
    const candidate = freezeOrchestrationWorktreeCandidate({ baseRoot: root, workers, expectedBaseOid: oldHead });
    expect(candidate.status).toBe('frozen');
    if (candidate.status !== 'frozen') throw new Error(JSON.stringify(candidate));
    const verify = 'const fs=require("node:fs"),a=require("node:assert/strict");a.equal(fs.readFileSync("other.txt","utf8"),"first result");a.equal(fs.readFileSync("new.txt","utf8"),"second result");';
    expect(spawnSync(process.execPath, ['-e', verify], { cwd: root, windowsHide: true }).status).not.toBe(0);
    const checked = spawnSync(process.execPath, ['-e', verify], { cwd: candidate.materializedPath, encoding: 'utf8', windowsHide: true });
    expect(checked.status, checked.stderr).toBe(0);
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidate.materializedPath, encoding: 'utf8', windowsHide: true }).trim())
      .toBe(candidate.manifest.candidateCommitOid);
    for (const worker of workers) service.enqueueMerge({ ...worker, changedFiles: worker.declaredWriteSet });
    const merged = await service.processMergeQueue();
    expect(merged.map(item => item.status)).toEqual(['merged', 'merged']);
    expect(git('rev-parse', 'HEAD')).toBe(oldHead);
    expect(readFileSync(path.join(root, 'other.txt'), 'utf8')).toBe('first result');
    expect(readFileSync(path.join(root, 'new.txt'), 'utf8')).toBe('second result');
    proof('two-worktree-candidate', { candidate, checks: { verificationCwd: candidate.materializedPath, exitCode: checked.status,
      originalHead: oldHead, integrated: merged, candidateCommitOid: candidate.manifest.candidateCommitOid } });
  });
  it('retains unknown journal completion after restart and forbids replay or cleanup', async () => {
    nativeRepository();
    const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'worker result');
    const request = { worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['other.txt'] };
    service.enqueueMerge(request);
    vi.spyOn(journal, 'setWriteJournalBatchState').mockReturnValueOnce(false);
    await expect(service.processMergeQueue()).rejects.toThrow('reconciliation_required');
    vi.restoreAllMocks(); closeOpenClawStateDatabaseForTest();
    const restarted = createWorktreeService(root, { backend: 'git' });
    expect(restarted.getMergeQueue()[0]).toMatchObject({ status: 'conflict', recoveryRequired: true });
    expect(() => restarted.enqueueMerge(request)).toThrow('reconciliation_required');
    expect(() => restarted.cleanup(worker.id)).toThrow('reconciliation_required');
    expect(readFileSync(path.join(root, 'other.txt'), 'utf8')).toBe('worker result');
    const writer = restarted.writer(worker.id);
    proof('unknown-effect', { queue: restarted.getMergeQueue(), writer: writer && { state: writer.state, epoch: writer.epoch,
      operations: writer.operations.map(operation => ({ id: operation.id, state: operation.state })) }, replayRefused: true, cleanupRefused: true });
  });
  it('carries recovery references on a rejected orchestration result for the existing verifier', async () => {
    nativeRepository();
    const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'worker result');
    vi.spyOn(journal, 'setWriteJournalBatchState').mockReturnValueOnce(false);
    const result = mergeOrchestrationWorktrees({ baseRoot: root, workers: [{ taskNodeId: 'task-worker',
      worktreeId: worker.id, worktreeGeneration: worker.generation, declaredWriteSet: ['other.txt'] }] });
    await expect(result).rejects.toMatchObject({ worktreeMergeResults: [expect.objectContaining({
      worktreeGeneration: worker.generation, recoveryRequired: true, journalRef: expect.stringMatching(/^write-journal:/),
      hashes: { 'other.txt': expect.stringMatching(/^[a-f0-9]{64}$/) } })] });
  });
  it('includes both paths from a real staged Git rename at the orchestration entry', async () => {
    nativeRepository();
    const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['original.bin', 'renamed file.bin'] });
    execFileSync('git', ['mv', 'original.bin', 'renamed file.bin'], { cwd: worker.root, windowsHide: true });
    const result = await mergeOrchestrationWorktrees({ baseRoot: root, workers: [{ taskNodeId: 'rename-task',
      worktreeId: worker.id, worktreeGeneration: worker.generation, declaredWriteSet: ['original.bin', 'renamed file.bin'] }] });
    expect(result[0]).toMatchObject({ status: 'merged', changedFiles: ['original.bin', 'renamed file.bin'],
      worktreeGeneration: worker.generation });
    expect(existsSync(path.join(root, 'original.bin'))).toBe(false);
    expect(readFileSync(path.join(root, 'renamed file.bin'))).toEqual(Buffer.from([0, 1, 255, 4]));
  });
  it('retains journal references when the process fails before the writer release', async () => {
    writeFileSync(path.join(root, 'original.bin'), 'base');
    const service = createWorktreeService(root);
    const worker = service.create('worker', { seedFiles: ['original.bin'], writeSet: ['original.bin'] });
    writeFileSync(path.join(worker.root, 'original.bin'), 'worker result');
    service.enqueueMerge({ worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['original.bin'] });
    const save = registry.saveWorktreeRegistryScope;
    vi.spyOn(registry, 'saveWorktreeRegistryScope').mockImplementation(scope => {
      save(scope);
      if (scope.queue.some(item => item.reason === 'merge_outcome_unknown' && item.journalRef)
        && readFileSync(path.join(root, 'original.bin'), 'utf8') === 'worker result') throw new Error('crash before writer release');
    });
    await expect(service.processMergeQueue()).rejects.toThrow('crash before writer release');
    vi.restoreAllMocks(); closeOpenClawStateDatabaseForTest();
    const stored = createWorktreeService(root).getMergeQueue()[0];
    expect(stored).toMatchObject({ reason: 'merge_outcome_unknown', journalRef: expect.stringMatching(/^write-journal:/),
      hashes: { 'original.bin': expect.stringMatching(/^[a-f0-9]{64}$/) } });
    expect(readFileSync(path.join(root, 'original.bin'), 'utf8')).toBe('worker result');
  });
  it('reads a completed native process receipt when the local queued copy is stale', async () => {
    nativeRepository();
    const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'worker result');
    const create = worktrees.createWorktreeService;
    vi.spyOn(worktrees, 'createWorktreeService').mockImplementation((base, options) => {
      const owner = create(base, options);
      const processQueue = owner.processMergeQueue;
      owner.processMergeQueue = async (...args) => {
        const runtimeRequire = createRequire(path.resolve('openclaw_runtime/package.json'));
        const remote = spawnSync(process.execPath, [runtimeRequire.resolve('tsx/cli'), '--tsconfig', path.resolve('openclaw_runtime/tsconfig.json'),
          path.resolve('tests/fixtures/worktree-integration-process.ts'), root, worker.id, worker.generation, JSON.stringify(['other.txt'])],
        { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
        expect(remote.status, remote.stderr).toBe(0);
        return processQueue.apply(owner, args);
      };
      return owner;
    });
    const results = await mergeOrchestrationWorktrees({ baseRoot: root, workers: [{ taskNodeId: 'task-worker',
      worktreeId: worker.id, worktreeGeneration: worker.generation, declaredWriteSet: ['other.txt'] }] });
    expect(results[0]).toMatchObject({ status: 'merged', worktreeGeneration: worker.generation, journalRef: expect.stringMatching(/^write-journal:/) });
  });
  it('does not change a new generation while rejecting an older queued item', async () => {
    const service = createWorktreeService(root);
    service.enqueueMerge({ worktreeId: 'future', changedFiles: ['a.txt'] });
    const current = service.create('future');
    const result = await service.processMergeQueue();
    expect(result[0]).toMatchObject({ status: 'conflict', reason: 'stale-generation' });
    expect(service.list().find(record => record.id === current.id)?.status).toBe('active');
  });
  it('does not resurrect a cleaned record when a late merge request arrives', async () => {
    const service = createWorktreeService(root);
    const worker = service.create('worker'); service.cleanup(worker.id);
    service.enqueueMerge({ worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: [] });
    expect((await service.processMergeQueue())[0].status).toBe('conflict');
    expect(service.list()[0].status).toBe('cleaned');
    expect(service.create(worker.id).generation).not.toBe(worker.generation);
  });
  it('returns a pre-journal target drift as known not-applied instead of unknown', async () => {
    writeFileSync(path.join(root, 'original.bin'), 'base');
    const service = createWorktreeService(root);
    const worker = service.create('worker', { seedFiles: ['original.bin'], writeSet: ['original.bin'] });
    writeFileSync(path.join(worker.root, 'original.bin'), 'worker result');
    service.enqueueMerge({ worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['original.bin'] });
    const maintenance = writers.withAsyncCheckoutMaintenance;
    vi.spyOn(writers, 'withAsyncCheckoutMaintenance').mockImplementation((bases, operation, effect, prepare, outcome, publish, journalPrepared) =>
      maintenance(bases, operation, async admit => { writeFileSync(path.join(worker.root, 'late.txt'), 'late'); return effect(admit); }, prepare, outcome, publish, journalPrepared));
    expect((await service.processMergeQueue())[0]).toMatchObject({ status: 'conflict' });
    expect(service.getMergeQueue()).toEqual([]);
    expect(service.writer(worker.id)?.state).toBe('released');
    expect(readFileSync(path.join(root, 'original.bin'), 'utf8')).toBe('base');
  });
  it('preserves a leading space in actual Git paths through orchestration', async () => {
    nativeRepository();
    const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: [' leading.txt'] });
    writeFileSync(path.join(worker.root, ' leading.txt'), 'worker result');
    const result = await mergeOrchestrationWorktrees({ baseRoot: root, workers: [{ taskNodeId: 'space-task',
      worktreeId: worker.id, worktreeGeneration: worker.generation, declaredWriteSet: [' leading.txt'] }] });
    expect(result[0]).toMatchObject({ status: 'merged', changedFiles: [' leading.txt'] });
    expect(readFileSync(path.join(root, ' leading.txt'), 'utf8')).toBe('worker result');
    expect(existsSync(path.join(root, 'leading.txt'))).toBe(false);
  });
  it('preserves an undeclared file in the default inprocess checkout during cleanup', () => {
    const service = createWorktreeService(root);
    const worker = service.create('worker', { writeSet: ['declared.txt'] });
    writeFileSync(path.join(worker.root, 'user notes.txt'), 'keep this');
    expect(() => service.cleanup(worker.id)).toThrow(/worktree_cleanup_(user|ignored)_content_present/);
    expect(readFileSync(path.join(worker.root, 'user notes.txt'), 'utf8')).toBe('keep this');
  });
  it('merges declared Git changes while retaining ignored files from cleanup', async () => {
    nativeRepository();
    writeFileSync(path.join(root, '.gitignore'), '.openclaw/\n.env\n');
    git('add', '.gitignore');
    git('-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'ignore fixture');
    const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, '.env'), 'keep local fixture');
    writeFileSync(path.join(worker.root, 'other.txt'), 'worker result');
    const result = await mergeOrchestrationWorktrees({ baseRoot: root, workers: [{ taskNodeId: 'task-worker',
      worktreeId: worker.id, worktreeGeneration: worker.generation, declaredWriteSet: ['other.txt'] }] });
    expect(result[0].status).toBe('merged');
    expect(() => service.cleanup(worker.id)).toThrow(/worktree_cleanup_(user|ignored)_content_present/);
    expect(readFileSync(path.join(worker.root, '.env'), 'utf8')).toBe('keep local fixture');
  });
  it('does not replace a genuine empty Git status with a declared ignored file', async () => {
    nativeRepository();
    writeFileSync(path.join(root, '.gitignore'), '.openclaw/\n.env\n');
    git('add', '.gitignore');
    git('-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'ignore fixture');
    const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['.env'] });
    writeFileSync(path.join(worker.root, '.env'), 'local fixture stays local');
    expect(service.listChangedFiles(worker.id, worker.generation)).toEqual({ files: [], source: 'git-status' });
    const result = await mergeOrchestrationWorktrees({ baseRoot: root, workers: [{ taskNodeId: 'task-worker',
      worktreeId: worker.id, worktreeGeneration: worker.generation, declaredWriteSet: ['.env'] }] });
    expect(result[0].changedFiles).toEqual([]);
    expect(existsSync(path.join(root, '.env'))).toBe(false);
    expect(readFileSync(path.join(worker.root, '.env'), 'utf8')).toBe('local fixture stays local');
  });
  it('preserves ignored local content even when its path was declared in the write set', () => {
    nativeRepository();
    writeFileSync(path.join(root, '.gitignore'), '.openclaw/\n.env\n'); git('add', '.gitignore');
    git('-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'ignore fixture');
    const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['.env'] });
    writeFileSync(path.join(worker.root, '.env'), 'local fixture stays local');
    expect(() => service.cleanup(worker.id)).toThrow('worktree_cleanup_ignored_content_present');
    expect(readFileSync(path.join(worker.root, '.env'), 'utf8')).toBe('local fixture stays local');
  });
  it('rejects a direct queue request containing only an ignored Git file', () => {
    nativeRepository(); writeFileSync(path.join(root, '.gitignore'), '.openclaw/\n.env\n'); git('add', '.gitignore');
    git('-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'ignore fixture');
    const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['.env'] });
    writeFileSync(path.join(worker.root, '.env'), 'do not integrate');
    expect(() => service.enqueueMerge({ worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['.env'] }))
      .toThrow('worktree_merge_paths_not_observed');
    expect(existsSync(path.join(root, '.env'))).toBe(false);
  });
  it('does not leave unknown when the checkout writer refuses before any effect', async () => {
    writeFileSync(path.join(root, 'original.bin'), 'base');
    const service = createWorktreeService(root);
    const worker = service.create('worker', { seedFiles: ['original.bin'], writeSet: ['original.bin'] });
    writeFileSync(path.join(worker.root, 'original.bin'), 'worker result');
    service.enqueueMerge({ worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['original.bin'] });
    const maintenance = writers.withAsyncCheckoutMaintenance;
    const instance = registry.filesystemInstance;
    vi.spyOn(writers, 'withAsyncCheckoutMaintenance').mockImplementation((bases, operation, effect, prepare, outcome, publish) =>
      maintenance(bases, operation, effect, () => {
        prepare?.(); vi.spyOn(registry, 'filesystemInstance').mockImplementationOnce(value => instance(value) + ':replaced');
      }, outcome, publish));
    await expect(service.processMergeQueue()).rejects.toThrow('checkout_writer_incarnation_changed');
    expect(service.getMergeQueue()[0]).toMatchObject({ status: 'pending' });
    vi.restoreAllMocks();
    expect((await service.processMergeQueue())[0].status).toBe('merged');
  });
  it('returns a nonempty historical merge receipt after its original checkout is cleaned', async () => {
    writeFileSync(path.join(root, 'original.bin'), 'base');
    const service = createWorktreeService(root);
    const worker = service.create('worker', { seedFiles: ['original.bin'], writeSet: ['original.bin'] });
    writeFileSync(path.join(worker.root, 'original.bin'), 'worker result');
    const request = { worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['original.bin'] };
    service.enqueueMerge(request); const result = (await service.processMergeQueue())[0];
    service.cleanup(worker.id);
    expect(service.enqueueMerge(request)).toEqual(result);
    expect(service.list()[0].status).toBe('cleaned');
  });
  it('uses Windows filename identity for duplicate requests and cleanup', async () => {
    if (process.platform !== 'win32') return;
    nativeRepository();
    const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['OTHER.TXT'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'worker result');
    service.enqueueMerge({ worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['OTHER.TXT'] });
    const result = (await service.processMergeQueue())[0];
    expect(service.enqueueMerge({ worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['other.txt'] })).toEqual(result);
    expect(() => service.cleanup(worker.id)).toThrow('worktree_cleanup_user_content_present');
    execFileSync('git', ['add', 'other.txt'], { cwd: worker.root, windowsHide: true });
    execFileSync('git', ['-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'retained result'], { cwd: worker.root, windowsHide: true });
    execFileSync('git', ['update-ref', 'refs/heads/retained-case-result', 'HEAD'], { cwd: worker.root, windowsHide: true });
    expect(service.enqueueMerge({ worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['other.txt'] })).toEqual(result);
    service.cleanup(worker.id); expect(existsSync(worker.root)).toBe(false);
  });
  it('applies a real Windows case-only filename rename at the production entry', async () => {
    if (process.platform !== 'win32') return;
    nativeRepository();
    const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['other.txt', 'OTHER.TXT'] });
    execFileSync('git', ['mv', 'other.txt', 'OTHER.TXT'], { cwd: worker.root, windowsHide: true });
    const result = await mergeOrchestrationWorktrees({ baseRoot: root, workers: [{ taskNodeId: 'case-rename',
      worktreeId: worker.id, worktreeGeneration: worker.generation, declaredWriteSet: ['other.txt', 'OTHER.TXT'] }] });
    expect(result[0].status).toBe('merged');
    expect(readdirSync(root)).toContain('OTHER.TXT');
    expect(readdirSync(root)).not.toContain('other.txt');
    expect(readFileSync(path.join(root, 'OTHER.TXT'), 'utf8')).toBe('original other');
  });
  it('integrates a clean committed worker delta instead of treating status as no work', async () => {
    nativeRepository();
    const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['other.txt'] });
    writeFileSync(path.join(worker.root, 'other.txt'), 'committed worker result');
    execFileSync('git', ['add', 'other.txt'], { cwd: worker.root, windowsHide: true });
    execFileSync('git', ['-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'worker result'], { cwd: worker.root, windowsHide: true });
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: worker.root, encoding: 'utf8', windowsHide: true }).trim()).toBe('');
    const workers = [{ taskNodeId: 'committed-worker', worktreeId: worker.id, worktreeGeneration: worker.generation, declaredWriteSet: ['other.txt'] }];
    const candidate = freezeOrchestrationWorktreeCandidate({ baseRoot: root, workers });
    expect(candidate.status).toBe('frozen');
    const result = await mergeOrchestrationWorktrees({ baseRoot: root, workers });
    expect(result[0]).toMatchObject({ status: 'merged', changedFiles: ['other.txt'], journalRef: expect.stringMatching(/^write-journal:/) });
    expect(readFileSync(path.join(root, 'other.txt'), 'utf8')).toBe('committed worker result');
  });
  it('applies case-only directory metadata without losing any contained file', async () => {
    if (process.platform !== 'win32') return;
    nativeRepository(); mkdirSync(path.join(root, 'lower')); writeFileSync(path.join(root, 'lower', 'a.txt'), 'kept');
    git('add', 'lower'); git('-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'directory fixture');
    const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker', { writeSet: ['lower/a.txt', 'UPPER/a.txt'] });
    execFileSync('git', ['mv', 'lower', 'case-intermediate'], { cwd: worker.root, windowsHide: true });
    execFileSync('git', ['mv', 'case-intermediate', 'LOWER'], { cwd: worker.root, windowsHide: true });
    const result = await mergeOrchestrationWorktrees({ baseRoot: root, workers: [{ taskNodeId: 'case-directory',
      worktreeId: worker.id, worktreeGeneration: worker.generation, declaredWriteSet: ['lower/a.txt', 'LOWER/a.txt'] }] });
    expect(result[0].status).toBe('merged');
    expect(readdirSync(root)).toContain('LOWER'); expect(readdirSync(root)).not.toContain('lower');
    expect(readFileSync(path.join(root, 'LOWER', 'a.txt'), 'utf8')).toBe('kept');
  });
  it('preserves a successful receipt when an older different request was already pending', async () => {
    writeFileSync(path.join(root, 'a.txt'), 'a'); writeFileSync(path.join(root, 'b.txt'), 'b');
    const service = createWorktreeService(root);
    const worker = service.create('worker', { seedFiles: ['a.txt', 'b.txt'], writeSet: ['a.txt', 'b.txt'] });
    writeFileSync(path.join(worker.root, 'a.txt'), 'new a'); writeFileSync(path.join(worker.root, 'b.txt'), 'new b');
    const original = { worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['a.txt', 'b.txt'] };
    service.enqueueMerge(original); service.enqueueMerge({ ...original, changedFiles: ['a.txt'] });
    const outcomes = await service.processMergeQueue();
    expect(outcomes[0].status).toBe('merged'); expect(outcomes[1].status).toBe('conflict');
    closeOpenClawStateDatabaseForTest();
    expect(createWorktreeService(root).enqueueMerge(original)).toEqual(outcomes[0]);
  });
  it('retains a successful empty receipt when a different no-effect request was already queued', async () => {
    writeFileSync(path.join(root, 'a.txt'), 'a'); const service = createWorktreeService(root);
    const worker = service.create('worker', { seedFiles: ['a.txt'], writeSet: ['a.txt'] });
    const original = { worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: [] as string[] };
    service.enqueueMerge(original); service.enqueueMerge({ ...original, changedFiles: ['a.txt'] });
    const outcomes = await service.processMergeQueue();
    expect(outcomes[0].status).toBe('merged'); expect(outcomes[1].status).toBe('conflict');
    expect(createWorktreeService(root).enqueueMerge(original)).toEqual(outcomes[0]);
  });
  it('retains the first successful receipt when later requests change the same generation write set', async () => {
    writeFileSync(path.join(root, 'original.bin'), 'base');
    const service = createWorktreeService(root);
    const worker = service.create('worker', { seedFiles: ['original.bin'], writeSet: ['original.bin', 'new.txt'] });
    writeFileSync(path.join(worker.root, 'original.bin'), 'worker result');
    const original = { worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['original.bin'] };
    service.enqueueMerge(original); const first = (await service.processMergeQueue())[0];
    writeFileSync(path.join(worker.root, 'new.txt'), 'another intent');
    expect(() => service.enqueueMerge({ ...original, changedFiles: ['original.bin', 'new.txt'] })).toThrow('worktree_merge_request_conflict');
    closeOpenClawStateDatabaseForTest();
    expect(createWorktreeService(root).enqueueMerge(original)).toEqual(first);
  });
  it('does not reinterpret a POSIX backslash filename as a directory separator', () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
    try {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      expect(normalizeWorktreeRelPath('a\\b.txt')).toBe('a\\b.txt');
    } finally { Object.defineProperty(process, 'platform', descriptor); }
  });
  it('recovers the terminal registry receipt after the writer completion was committed', async () => {
    writeFileSync(path.join(root, 'original.bin'), 'base');
    const service = createWorktreeService(root);
    const worker = service.create('worker', { seedFiles: ['original.bin'], writeSet: ['original.bin'] });
    writeFileSync(path.join(worker.root, 'original.bin'), 'worker result');
    const request = { worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['original.bin'] };
    service.enqueueMerge(request);
    const maintenance = writers.withAsyncCheckoutMaintenance;
    vi.spyOn(writers, 'withAsyncCheckoutMaintenance').mockImplementation(async (...args) => {
      await maintenance(...args); throw new Error('crash after owner commit');
    });
    await expect(service.processMergeQueue()).rejects.toThrow('crash after owner commit');
    vi.restoreAllMocks(); closeOpenClawStateDatabaseForTest();
    const restarted = createWorktreeService(root);
    expect(restarted.writer(worker.id)?.state).toBe('released');
    expect(restarted.enqueueMerge(request)).toMatchObject({ status: 'merged', journalRef: expect.stringMatching(/^write-journal:/) });
    expect(readFileSync(path.join(root, 'original.bin'), 'utf8')).toBe('worker result');
  });
  it.each(['inprocess', 'git'] as const)('retains unintegrated conflicting worktree bytes during cleanup: %s', async backend => {
    if (backend === 'git') nativeRepository(); else writeFileSync(path.join(root, 'original.bin'), 'base');
    const service = createWorktreeService(root, { backend });
    const worker = service.create('worker', { seedFiles: ['original.bin'], writeSet: ['original.bin'] });
    writeFileSync(path.join(worker.root, 'original.bin'), 'worker result');
    writeFileSync(path.join(root, 'original.bin'), 'other owner');
    service.enqueueMerge({ worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['original.bin'] });
    expect((await service.processMergeQueue())[0].status).toBe('conflict');
    expect(() => service.cleanup(worker.id)).toThrow(backend === 'git' ? 'worktree_cleanup_user_content_present' : 'worktree_cleanup_unretained_content');
    expect(readFileSync(path.join(worker.root, 'original.bin'), 'utf8')).toBe('worker result');
  });
  it('rechecks newly created ignored content after cleanup admission', () => {
    nativeRepository(); writeFileSync(path.join(root, '.gitignore'), '.openclaw/\n.env\n'); git('add', '.gitignore');
    git('-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'ignore fixture');
    const service = createWorktreeService(root, { backend: 'git' });
    const worker = service.create('worker');
    const maintenance = writers.withCheckoutMaintenance;
    vi.spyOn(writers, 'withCheckoutMaintenance').mockImplementation((bases, operation, effect, prepare, outcome) => maintenance(bases, operation,
      () => { writeFileSync(path.join(worker.root, '.env'), 'late local file'); return effect(); }, prepare, outcome));
    expect(() => service.cleanup(worker.id)).toThrow('worktree_cleanup_ignored_content_present');
    expect(readFileSync(path.join(worker.root, '.env'), 'utf8')).toBe('late local file');
    expect(service.writer(worker.id)?.state).toBe('released');
    expect(service.inventory().find(item => item.id === worker.id)?.availability).toBe('ready');
    vi.restoreAllMocks(); unlinkSync(path.join(worker.root, '.env'));
    service.cleanup(worker.id); expect(existsSync(worker.root)).toBe(false);
  });
  it('retains a replacement directory introduced after cleanup admission', () => {
    const service = createWorktreeService(root);
    const worker = service.create('worker');
    const maintenance = writers.withCheckoutMaintenance;
    vi.spyOn(writers, 'withCheckoutMaintenance').mockImplementation((bases, operation, effect, prepare, outcome) => maintenance(bases, operation,
      () => { renameSync(worker.root, worker.root + '-original'); mkdirSync(worker.root); writeFileSync(path.join(worker.root, 'user.txt'), 'keep replacement'); return effect(); }, prepare, outcome));
    expect(() => service.cleanup(worker.id)).toThrow('worktree_cleanup_identity_changed');
    expect(readFileSync(path.join(worker.root, 'user.txt'), 'utf8')).toBe('keep replacement');
  });
  it('retains the prepared journal reference if the process fails as soon as applying returns', async () => {
    writeFileSync(path.join(root, 'original.bin'), 'base');
    const service = createWorktreeService(root);
    const worker = service.create('worker', { seedFiles: ['original.bin'], writeSet: ['original.bin'] });
    writeFileSync(path.join(worker.root, 'original.bin'), 'worker result');
    service.enqueueMerge({ worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['original.bin'] });
    const apply = mergeFiles.applyWorktreeFiles;
    vi.spyOn(mergeFiles, 'applyWorktreeFiles').mockImplementation(async input => { await apply(input); throw new Error('crash on returning effect'); });
    await expect(service.processMergeQueue()).rejects.toThrow('crash on returning effect');
    vi.restoreAllMocks(); closeOpenClawStateDatabaseForTest();
    expect(createWorktreeService(root).getMergeQueue()[0]).toMatchObject({ reason: 'merge_outcome_unknown',
      journalRef: expect.stringMatching(/^write-journal:/), hashes: { 'original.bin': expect.stringMatching(/^[a-f0-9]{64}$/) } });
  });
  it('releases a rejected hardlink preflight without marking an unknown filesystem effect', async () => {
    writeFileSync(path.join(root, 'original.bin'), 'base');
    const outside = path.join(fixture, 'outside.txt'); writeFileSync(outside, 'keep outside');
    const service = createWorktreeService(root);
    const worker = service.create('worker', { seedFiles: ['original.bin'], writeSet: ['original.bin'] });
    const source = path.join(worker.root, 'original.bin'); unlinkSync(source); linkSync(outside, source);
    const request = { worktreeId: worker.id, worktreeGeneration: worker.generation, changedFiles: ['original.bin'] };
    service.enqueueMerge(request);
    const result = await service.processMergeQueue();
    expect(result[0]).toMatchObject({ status: 'conflict', reason: expect.stringContaining('preflight') });
    expect(service.getMergeQueue()).toEqual([]);
    expect(service.writer(worker.id)).toMatchObject({ state: 'released', operations: [expect.objectContaining({ state: 'settled',
      receipt: expect.objectContaining({ outcome: 'not-applied' }) })] });
    expect(readFileSync(path.join(root, 'original.bin'), 'utf8')).toBe('base');
    unlinkSync(source); writeFileSync(source, 'worker result');
    service.enqueueMerge(request);
    expect((await service.processMergeQueue())[0].status).toBe('merged');
    expect(readFileSync(outside, 'utf8')).toBe('keep outside');
  });
  it.each([false, true])('rolls back a failed journal application while preserving concurrent bytes: %s', async concurrent => {
    const target = path.join(root, 'target.txt');
    writeFileSync(target, 'original');
    const result = await journaledGitApply({ workspaceRoot: root, sessionKey: 'r4-rollback', paths: [target],
      expectedPostimages: new Map([[target, Buffer.from('intended')]]), validate: async () => {},
      preflight: async () => ({ success: true }), apply: async () => {
        writeFileSync(target, concurrent ? 'concurrent owner' : 'intended');
        throw new Error('application interrupted');
      } });
    expect(result.error).toContain('application interrupted');
    expect(result.recoveryRequired).toBe(concurrent);
    expect(readFileSync(target, 'utf8')).toBe(concurrent ? 'concurrent owner' : 'original');
  });
  it.each([false, true])('does not roll back an unwritten file with a matching external postimage: %s', async deletion => {
    const first = path.join(root, 'first.txt'), second = path.join(root, 'second.txt');
    writeFileSync(first, 'base first'); writeFileSync(second, 'base second');
    const appliedPaths = new Set<string>();
    const result = await journaledGitApply({ workspaceRoot: root, sessionKey: 'r4-rollback-own-effects', paths: [first, second],
      expectedPostimages: new Map([[first, Buffer.from('wanted first')], [second, deletion ? null : Buffer.from('wanted second')]]),
      appliedPaths, validate: async () => {}, preflight: async () => ({ success: true }), apply: async () => {
        writeFileSync(first, 'wanted first'); appliedPaths.add(first);
        if (deletion) unlinkSync(second); else writeFileSync(second, 'wanted second');
        throw new Error('external owner changed the second file before our write');
      } });
    expect(result.recoveryRequired).toBe(true);
    expect(deletion ? existsSync(second) : readFileSync(second, 'utf8')).toBe(deletion ? false : 'wanted second');
  });
  it('retains the original journal when filename metadata cannot be safely rolled back', async () => {
    const target = path.join(root, 'case-name.txt'); writeFileSync(target, 'same bytes');
    const result = await journaledGitApply({ workspaceRoot: root, sessionKey: 'r4-filename-rollback', paths: [target],
      expectedPostimages: new Map([[target, Buffer.from('same bytes')]]), canRollback: () => false,
      validate: async () => {}, preflight: async () => ({ success: true }), apply: async () => {
        throw new Error('filename effect unconfirmed');
      } });
    expect(result).toMatchObject({ recoveryRequired: true, journalRef: expect.stringMatching(/^write-journal:/) });
    expect(readFileSync(target, 'utf8')).toBe('same bytes');
  });
});
