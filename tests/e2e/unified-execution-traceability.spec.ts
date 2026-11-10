import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import type { TaskArtifactReference, TaskArtifactRetentionReceipt } from '../../shared/task-system/artifact-retention';
import type { TaskSystemStore } from '../../shared/task-system/store';
import type { TaskCredential, TaskEvidence, TaskSystemCommand, TaskView } from '../../shared/task-system/types';
import type { ExecutionMigrationOperation, SessionExecutionMigrationReceipt } from '../../shared/types/execution-migration';
import type { WorkspaceProfile } from '../../shared/types/workspace';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider, createSessionChainProject, createSessionChainTask } from './fixtures/session-task-chain';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const checkpointBytes = 'TF0867 checkpoint produced by A\n';
const finalBytes = 'TF0867 result continued by B\n';
const faultMessage = 'TF0867 injected after durable binding-committed';
const toolIds = { aWrite: 'tf0867awrite', bRead: 'tf0867bread', bCopy: 'tf0867bcopy', bWrite: 'tf0867bwrite' } as const;
type Reply<T> = { success: boolean; result: T; error?: string };
type Changes = ReturnType<TaskSystemStore['changes']>;
type TaskHistory = ReturnType<TaskSystemStore['history']>;
type RetainedArtifactPage = ReturnType<TaskSystemStore['readRetainedArtifactPage']>;
type BuildManifest = { schema_version: 1; driven_by: 'agent'; side: 'baseline' | 'candidate'; source_head: string;
  built_at: string; main_sha256: string; renderer_sha256: string; runtime_entry_sha256: string };
const driverRelativePath = 'tests/e2e/unified-execution-traceability.spec.ts';
const helperNames = ['electron.ts', 'fp-p1-harness.ts', 'session-task-chain.ts', 'electron-process-cleanup.ts', 'windows-process.ts'] as const;
const requiredEnv = (name: string) => {
  const value = process.env[name]?.trim(); if (!value) throw new Error(`Missing frozen input: ${name}`); return value;
};
const pathKey = (value: string) => process.platform === 'win32' ? value.replace(/\\/g, '/').toLowerCase() : value;
async function readBuildManifest(repoRoot: string, head: string) {
  const input = requiredEnv('CLAWX_TF0867_BUILD_MANIFEST');
  const raw = await readFile(input), manifest = JSON.parse(raw.toString('utf8')) as BuildManifest;
  const side = requiredEnv('CLAWX_TF0867_SIDE');
  expect(['baseline', 'candidate']).toContain(side);
  expect(manifest.schema_version).toBe(1); expect(manifest.driven_by).toBe('agent');
  expect(manifest.side).toBe(side); expect(manifest.source_head).toBe(head);
  expect(Number.isFinite(Date.parse(manifest.built_at))).toBe(true);
  const actual = { main_sha256: sha(await readFile(join(repoRoot, 'dist-electron/main/index.js'))),
    renderer_sha256: sha(await readFile(join(repoRoot, 'dist/index.html'))),
    runtime_entry_sha256: sha(await readFile(join(repoRoot, 'openclaw_runtime/dist/entry.js'))) };
  for (const key of ['main_sha256', 'renderer_sha256', 'runtime_entry_sha256'] as const) {
    expect(manifest[key]).toMatch(/^[a-f0-9]{64}$/); expect(actual[key]).toBe(manifest[key]);
  }
  return { manifest_path: input, manifest_sha256: sha(raw), manifest, actual };
}
async function readFrozenInputs(driverFile: string) {
  const repoRoot = await realpath(process.cwd());
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repoRoot, windowsHide: true, encoding: 'utf8' }).trim();
  expect(pathKey(await realpath(git('rev-parse', '--show-toplevel')))).toBe(pathKey(repoRoot));
  expect(pathKey(await realpath(driverFile))).toBe(pathKey(await realpath(join(repoRoot, driverRelativePath))));
  const head = git('rev-parse', 'HEAD');
  expect(requiredEnv('CLAWX_TF0867_EXPECTED_HEAD')).toMatch(/^[a-f0-9]{40}$/);
  expect(head).toBe(requiredEnv('CLAWX_TF0867_EXPECTED_HEAD'));
  expect(git('status', '--porcelain=v1', '--untracked-files=all', '--',
    'src', 'electron', 'openclaw_runtime', 'shared', 'tests/e2e/fixtures')).toBe('');
  const driverSha256 = sha(await readFile(driverFile));
  expect(requiredEnv('CLAWX_TF0867_DRIVER_SHA256')).toMatch(/^[a-f0-9]{64}$/);
  expect(driverSha256).toBe(requiredEnv('CLAWX_TF0867_DRIVER_SHA256'));
  const expectedHelpers = JSON.parse(requiredEnv('CLAWX_TF0867_HELPER_HASHES')) as Record<string, string>;
  const helpers = Object.fromEntries(await Promise.all(helperNames.map(async name =>
    [name, sha(await readFile(join(repoRoot, 'tests/e2e/fixtures', name)))])));
  expect(helpers).toEqual(expectedHelpers);
  return { repoRoot, head, driverSha256, helpers, build: await readBuildManifest(repoRoot, head) };
}

// 只抛出故障；先调用真实 electron-store 写入，绝不代写 owner 状态或成功回执。
async function failAfterBindingCommit(app: ElectronApplication, operationId: string) {
  const storeModule = createRequire(resolve('package.json')).resolve('electron-store');
  await app.evaluate(({ app: electronApp }, input) => {
    const module = process.mainModule!.require(input.storeModule), Store = module.default ?? module;
    const path = process.mainModule!.require('node:path') as typeof import('node:path');
    const fs = process.mainModule!.require('node:fs') as typeof import('node:fs');
    const expectedPath = path.resolve(electronApp.getPath('userData'), 'workspaces.json');
    const descriptor = Object.getOwnPropertyDescriptor(Store.prototype, 'set'), original = Store.prototype.set;
    Object.defineProperty(Store.prototype, 'set', { configurable: true, writable: true,
      value: function (this: { path?: string }, ...args: unknown[]) {
        const result = Reflect.apply(original, this, args);
        if (this.path && path.resolve(this.path) === expectedPath && args[0] === 'profiles') {
          const saved = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
          const operation = saved.profiles?.flatMap((p: { executionMigrations?: Record<string, { id: string; phase: string }> }) =>
            Object.values(p.executionMigrations ?? {})).find((o: { id: string; phase: string }) => o.id === input.operationId && o.phase === 'binding-committed');
          if (operation) {
            if (descriptor) Object.defineProperty(Store.prototype, 'set', descriptor); else delete Store.prototype.set;
            throw new Error(input.faultMessage);
          }
        }
        return result;
      },
    });
  }, { storeModule, operationId, faultMessage });
}

test('TF0867: exclusive claim, real writes, durable migration restart, acceptance and source cleanup', async ({ launchElectronApp, userDataDir }, info) => {
  test.skip(process.env.CLAWX_TF0867_TRACEABILITY !== '1', '由主 agent 串行显式启动');
  test.setTimeout(420_000);
  const root = info.outputPath('fixture'), hub = join(root, 'repository'), state = join(root, 'execution-state.sqlite');
  const oldState = process.env.CLAWX_EXECUTION_STATE_PATH;
  const evidence: Record<string, unknown> = { schema: 'clawx.tf0867.traceability/v1', status: 'running', driven_by: 'agent',
    actor: 'playwright-tf0867', requested_route: 'ccs-workbuddy/deepseek-v4.1-flash', requestmodel: 'ccs-workbuddy/deepseek-v4.1-flash',
    backend_identity: null, provider: 'local-scripted', fixtureRoot: root, stages: {}, timings: [], gaps: [],
    attempt: { testId: info.testId, retry: info.retry, repeatEachIndex: info.repeatEachIndex, workerIndex: info.workerIndex },
    resources: { scope: 'Main memoryUsage plus Electron app.getAppMetrics at named stages; Gateway and test-worker RSS excluded',
      cadence: 'stage snapshots', wholeRunPeak: 'unknown', samples: [] } };
  const stages = evidence.stages as Record<string, unknown>;
  const record = async (name: string, value: unknown) => {
    stages[name] = value; await writeFile(info.outputPath('traceability.json'), JSON.stringify(evidence, null, 2));
  };
  let app: ElectronApplication | undefined, llm: Awaited<ReturnType<typeof startScriptedLlm>> | undefined;
  let closeOwnerDatabase: (() => void) | undefined;
  const call = <T,>(module: string, action: string, payload: Record<string, unknown> = {}) => hostInvoke<T>(app!, module, action, payload);
  const command = async <T,>(workspaceId: string, input: TaskSystemCommand) => {
    const response = await call<Reply<T>>('taskLedger', 'command', { workspaceId, command: input });
    expect(response.success, response.error).toBe(true); return response.result;
  };
  const rpc = <T,>(method: string, params: Record<string, unknown>) => call<T>('gateway', 'rpc', { method, params, timeoutMs: 30_000 });
  const profiles = () => call<{ profiles: WorkspaceProfile[] }>('workspaces', 'list');
  const sampleResources = async (stage: string) => {
    const resources = evidence.resources as { samples: unknown[] };
    try {
      const sample = await app!.evaluate(({ app: electronApp }) => ({
        at: Date.now(), pid: process.pid, memory: process.memoryUsage(), metrics: electronApp.getAppMetrics(),
      }));
      resources.samples.push({ stage, status: 'observed', ...sample });
    } catch (error) { resources.samples.push({ stage, status: 'unknown', error: String(error) }); }
    await record('resourceSnapshots', evidence.resources);
  };
  const saveFirstFailure = async (error: unknown) => {
    evidence.status = 'failed'; evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
    evidence.providerLog = llm?.log ?? [];
    evidence.firstFailureAt = Date.now();
    await writeFile(info.outputPath('first-failure.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' })
      .catch(saveError => { if ((saveError as NodeJS.ErrnoException).code !== 'EEXIST') evidence.failureSaveError = String(saveError); });
  };
  try {
    await mkdir(hub, { recursive: true });
    await record('attemptStarted', { at: Date.now() });
    expect(process.env.CLAWX_E2E_KEEP_TEMP, '保留每次 attempt 的 profile、数据库和 first failure').toBe('1');
    for (const id of Object.values(toolIds)) expect(id).toMatch(/^[A-Za-z0-9]+$/);
    const frozenInputs = await readFrozenInputs(info.file);
    evidence.sourceHead = frozenInputs.head; evidence.driverSha256 = frozenInputs.driverSha256;
    evidence.buildManifest = frozenInputs.build;
    await record('frozenInputs', frozenInputs);
    const gitBytes = (cwd: string, ...args: string[]) => execFileSync('git', [
      '-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, '-c', 'core.fsmonitor=false', ...args,
    ], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } });
    const gitAt = (cwd: string, ...args: string[]) => gitBytes(cwd, ...args).toString('utf8').trim();
    const git = (...args: string[]) => gitAt(hub, ...args);
    git('init', '-b', 'tf0867-fixture');
    await writeFile(join(hub, 'README.fixture'), 'Only this test owns this repository.\n');
    await writeFile(join(hub, '.gitattributes'), '* -text\n');
    git('add', '--', 'README.fixture', '.gitattributes');
    git('-c', 'user.name=Agent fixture', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'TF0867 fixture');
    process.env.CLAWX_EXECUTION_STATE_PATH = state;
    const { createWorktreeService } = await import('../../openclaw_runtime/src/agents/worktree-service');
    const { openExecutionTaskStore } = await import('../../openclaw_runtime/src/agents/execution-task-authority');
    closeOwnerDatabase = (await import('../../openclaw_runtime/src/state/openclaw-state-db')).closeOpenClawStateDatabaseForTest;
    const service = createWorktreeService(hub, { backend: 'git' });
    const trees = ['left', 'right'].map(id => service.create(id, { operationId: `tf0867-create-${id}`, writeSet: ['checkpoint.txt', 'artifact.txt'], installStrategy: 'none' }));
    expect(trees.every(tree => tree.backend === 'git')).toBe(true);
    let sourceRoot = '', targetRoot = '';
    llm = await startScriptedLlm((text, results) => {
      const phase = text.lastIndexOf('TF0867-B') > text.lastIndexOf('TF0867-A') ? 'B' : 'A';
      if (phase === 'A' && !results[toolIds.aWrite]) return { toolCall: { id: toolIds.aWrite, name: 'write', args: { path: join(sourceRoot, 'checkpoint.txt'), content: checkpointBytes } } };
      if (phase === 'B') {
        if (!results[toolIds.bRead]) return { toolCall: { id: toolIds.bRead, name: 'read', args: { path: join(sourceRoot, 'checkpoint.txt') } } };
        if (!results[toolIds.bRead].includes(checkpointBytes.trim())) throw new Error('Source checkpoint was not read by the real tool');
        if (!results[toolIds.bCopy]) return { toolCall: { id: toolIds.bCopy, name: 'write', args: { path: join(targetRoot, 'checkpoint.txt'), content: checkpointBytes } } };
        if (!results[toolIds.bWrite]) return { toolCall: { id: toolIds.bWrite, name: 'write', args: { path: join(targetRoot, 'artifact.txt'), content: finalBytes } } };
      }
      return { text: `TF0867-${phase}-DONE` };
    });
    const launch = () => launchElectronApp({ skipSetup: true, profileDir: userDataDir, env: { CLAWX_EXECUTION_STATE_PATH: state } });
    app = await launch(); await getStableWindow(app); await configureSessionChainProvider(app, llm.port);
    const left = await createSessionChainProject(app, trees[0].root, 'TF0867 left');
    const right = await createSessionChainProject(app, trees[1].root, 'TF0867 right');
    const bridgeRead = await rpc<{ success: boolean; rejectedBeforeDispatch: boolean }>('taskScope.migration.read', {
      sessionKey: left.sessionKey, operationId: 'tf0867-migration',
    });
    expect(bridgeRead).toMatchObject({ success: false, rejectedBeforeDispatch: true });
    await record('frontendBridgeReadDenied', bridgeRead);
    const participants = [left, right];
    const created = await createSessionChainTask(app, left.workspaceId, 'tf0867-create-task', {
      objective: 'Continue the exact artifact across a fenced execution migration', target: 'artifact.txt', constraints: ['Preserve checkpoint bytes'],
      acceptance: [{ id: 'input', description: 'Retained exact checkpoint', verification: { kind: 'file-sha256', path: 'checkpoint.txt', sha256: sha(checkpointBytes) } },
        { id: 'output', description: 'Exact continued output', verification: { kind: 'file-sha256', path: 'artifact.txt', sha256: sha(finalBytes) } }],
    });
    const taskId = created.contract.taskNodeId;
    // Coordinator selection records references; the subsequent simultaneous claims choose the writer.
    for (const participant of participants) {
      await call('workspaces', 'switch', { id: participant.workspaceId });
      await call('taskLedger', 'linkSession', { workspaceId: participant.workspaceId, sessionKey: participant.sessionKey,
        sessionGeneration: participant.generation, nodeId: taskId });
      const binding = (await profiles()).profiles.find(p => p.id === participant.workspaceId)!.coordinatorBindings?.[participant.sessionKey];
      await call('workspaces', 'bindCoordinator', { workspaceId: participant.workspaceId, sessionKey: participant.sessionKey,
        agentId: 'main', expectedRevision: binding?.bindingRevision ?? 0, taskLedgerNodeIds: [taskId],
        environment: { kind: 'local', rootPath: participant.rootPath }, archiveRestorePolicy: 'restore' });
    }
    const beforeRace = openExecutionTaskStore(left.rootPath);
    try { expect(beforeRace.get(taskId).claim).toBeNull(); } finally { beforeRace.close(); }
    await record('claimReady', { profiles: await profiles(), taskId });
    await sampleResources('before-claim');
    // 两请求同时进入真实 Host；角色 A 按实际胜者确定，不控制胜者或重写失败结果。
    const race = await Promise.all(participants.map(async (p, index) => {
      try { return { index, response: await call<Reply<TaskView>>('taskLedger', 'command', { workspaceId: p.workspaceId,
        command: { action: 'claim', taskNodeId: taskId, sessionKey: p.sessionKey, requestId: `tf0867-race-${index}` } }) }; }
      catch (error) { return { index, response: { success: false, error: String(error) } }; }
    }));
    await record('claimRace', race); expect(race.filter(r => r.response.success)).toHaveLength(1);
    expect(race.find(r => !r.response.success)!.response.error).toContain('ALREADY_CLAIMED');
    const winner = race.find(r => r.response.success)!.index, loser = 1 - winner;
    const a = participants[winner], b = participants[loser], sourceTree = trees[winner], targetTree = trees[loser];
    sourceRoot = a.rootPath; targetRoot = b.rootPath;
    await record('identities', { taskId, a, b, sourceTree, targetTree, logicalSessionKey: a.sessionKey });
    await call('workspaces', 'switch', { id: a.workspaceId });
    const send = async (workspaceId: string, phase: 'A' | 'B') => {
      const startedAt = Date.now();
      const sent = await call<{ success: boolean; error?: string; result?: { runId?: string } }>('chat', 'sendWithMedia', {
        workspaceId, sessionKey: a.sessionKey, message: `TF0867-${phase}: execute the assigned artifact work.`, idempotencyKey: `tf0867-send-${phase}` });
      await record(`send${phase}`, sent); expect(sent.success, sent.error).toBe(true); expect(sent.result?.runId).toBeTruthy();
      const readErrors: Array<{ method: string; at: number; error: string }> = [];
      const observe = async <T,>(method: string, read: () => Promise<T>, unknown: T): Promise<T> => {
        try { return await read(); }
        catch (error) {
          readErrors.push({ method, at: Date.now(), error: String(error) });
          await record(`readErrors${phase}`, readErrors);
          if (!/RPC timeout|DEADLINE_EXCEEDED|GATEWAY_UNAVAILABLE/.test(String(error))) throw error;
          return unknown;
        }
      };
      await expect.poll(() => observe('sessions.history', async () => JSON.stringify(await call('sessions', 'history', { sessionKey: a.sessionKey, limit: 100 })).includes(`TF0867-${phase}-DONE`), false), { timeout: 90_000 }).toBe(true);
      await expect.poll(() => observe('sessions.describe', async () => (await rpc<{ session: { hasActiveRun: boolean } }>('sessions.describe', { key: a.sessionKey })).session.hasActiveRun, true), { timeout: 30_000 }).toBe(false);
      (evidence.timings as unknown[]).push({ phase: `tool-run-${phase}`, startedAt, endedAt: Date.now(), durationMs: Date.now() - startedAt });
      return sent.result!.runId!;
    };
    const runA = await send(a.workspaceId, 'A'); expect(await readFile(join(sourceRoot, 'checkpoint.txt'), 'utf8')).toBe(checkpointBytes);
    const taskA = (await call<{ task: TaskView }>('taskLedger', 'sessionTask', { workspaceId: a.workspaceId, sessionKey: a.sessionKey })).task;
    expect(taskA.contract.taskNodeId).toBe(taskId); const oldCredential: TaskCredential = taskA.claim!;
    const readOperation = (rootPath: string, credential: TaskCredential, operationId: string) => {
      const owner = openExecutionTaskStore(rootPath); try { return owner.operation(credential, operationId); } finally { owner.close(); }
    };
    const operationA = readOperation(sourceRoot, oldCredential, `${runA}:${toolIds.aWrite}`); expect(operationA.state).toBe('completed');
    await command(a.workspaceId, { action: 'checkpoint', credential: oldCredential, checkpoint: { completed: ['A wrote checkpoint.txt'],
      nextAction: 'Migrate, retain checkpoint and produce artifact.txt', unresolved: [], artifacts: [{ path: join(sourceRoot, 'checkpoint.txt'), sha256: sha(checkpointBytes) }] } });
    // Commit the bytes produced by the real write tool, then retain the detached tip in a shared branch.
    gitAt(sourceRoot, 'add', '--', 'checkpoint.txt');
    gitAt(sourceRoot, '-c', 'user.name=Agent fixture', '-c', 'user.email=agent@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '-m', 'TF0867 A real checkpoint');
    const sourceCommit = gitAt(sourceRoot, 'rev-parse', '--verify', 'HEAD^{commit}');
    const sourceBranch = 'refs/heads/tf0867aretained';
    git('update-ref', sourceBranch, sourceCommit, '0'.repeat(sourceCommit.length));
    expect(git('rev-parse', '--verify', sourceBranch)).toBe(sourceCommit);
    expect(gitBytes(hub, 'cat-file', 'blob', `${sourceCommit}:checkpoint.txt`)).toEqual(Buffer.from(checkpointBytes));
    const sourceStatus = gitAt(sourceRoot, 'status', '--porcelain=v1', '--untracked-files=all');
    await record('aGitSnapshot', { sourceCommit, sourceBranch, sourceStatus, sha256: sha(checkpointBytes), actor: 'agent' });
    const bindingA = (await profiles()).profiles.find(p => p.id === a.workspaceId)!.coordinatorBindings![a.sessionKey];
    expect(bindingA.writerClaim?.run.runId).toBe(runA); expect(bindingA.activeTaskNodeId).toBe(taskId);
    const writerA = service.writer(sourceTree.id);
    expect(writerA).toMatchObject({ owner: { kind: 'run', agentId: bindingA.agentId, sessionGeneration: oldCredential.generation,
      run: { runId: runA }, task: { taskNodeId: taskId, epoch: oldCredential.epoch } } });
    const writeReceiptA = writerA!.operations.find(op => op.id === operationA.id);
    expect(writeReceiptA).toMatchObject({ state: 'settled', receipt: { outcome: 'completed' } }); expect(writeReceiptA!.receipt!.ownerReceipt).toBeTruthy();
    await record('aExecution', { task: taskA, binding: bindingA, runId: runA, operation: operationA, checkoutWriter: writerA });
    await sampleResources('after-a');
    const request = { workspaceId: a.workspaceId, targetWorkspaceId: b.workspaceId, sessionKey: a.sessionKey, operationId: 'tf0867-migration',
      expectedSessionGeneration: a.generation, expectedBindingRevision: bindingA.bindingRevision };
    await failAfterBindingCommit(app, request.operationId);
    await expect(call('workspaces', 'migrateExecution', request)).rejects.toThrow(faultMessage);
    const interrupted = (await call<{ operation: ExecutionMigrationOperation }>('workspaces', 'executionMigration', request)).operation;
    expect(interrupted.phase).toBe('binding-committed'); expect(interrupted.error).toContain(faultMessage);
    const disk = JSON.parse(await readFile(join(userDataDir, 'workspaces.json'), 'utf8')) as { profiles: WorkspaceProfile[] };
    expect(disk.profiles.find(p => p.id === a.workspaceId)!.executionMigrations![request.operationId]).toEqual(interrupted);
    const prepared = interrupted.runtimeReceipt;
    await record('interruptedOwnerReadback', { main: interrupted, runtime: prepared });
    expect(prepared?.state).toBe('prepared'); expect(prepared?.targetGeneration).toBe(interrupted.targetGeneration);
    expect(prepared?.operationId).toBe(request.operationId);
    await record('interruptedAfterDiskCommit', { request, main: interrupted, runtime: prepared,
      receiptSource: 'Main migration owner persisted Runtime receipt', frontendBridgeRead: bridgeRead });
    // Gateway 先由原 owner 停止；SIGKILL 只命中本 case 持有的 Main 子进程句柄。
    await call('gateway', 'stop'); const child = app.process(), stoppedPid = child.pid, crashAt = Date.now();
    const exited = new Promise<void>(done => child.once('exit', () => done())); expect(child.kill('SIGKILL')).toBe(true); await exited;
    await closeElectronApp(app); app = undefined;
    app = await launch(); await getStableWindow(app); await startGateway(app);
    const persisted = (await call<{ operation: ExecutionMigrationOperation }>('workspaces', 'executionMigration', request)).operation;
    expect(persisted).toEqual(interrupted);
    const moved = (await call<{ operation: ExecutionMigrationOperation }>('workspaces', 'migrateExecution', request)).operation;
    expect(moved.phase).toBe('confirmed'); expect(moved.id).toBe(interrupted.id); expect(moved.reservationReleased).toBe(true);
    expect(moved.targetGeneration).not.toBe(a.generation); expect(moved.targetGeneration).toBe(interrupted.targetGeneration);
    expect(moved.runtimeReceipt?.state).toBe('confirmed');
    const replay = (await call<{ operation: ExecutionMigrationOperation }>('workspaces', 'migrateExecution', request)).operation;
    expect(replay).toEqual(moved);
    await record('recovered', { moved, replay, stoppedPid, newPid: app.process().pid, crashAt, confirmedAt: Date.now() });
    expect(app.process().pid).not.toBe(stoppedPid);
    (evidence.timings as unknown[]).push({ phase: 'main-restart-to-confirmed', startedAt: crashAt, endedAt: Date.now(), durationMs: Date.now() - crashAt });
    await sampleResources('after-recovery');
    const runB = await send(b.workspaceId, 'B'); expect(await readFile(join(targetRoot, 'artifact.txt'), 'utf8')).toBe(finalBytes);
    expect(await readFile(join(targetRoot, 'checkpoint.txt'), 'utf8')).toBe(checkpointBytes);
    const taskB = (await call<{ task: TaskView }>('taskLedger', 'sessionTask', { workspaceId: b.workspaceId, sessionKey: a.sessionKey })).task;
    expect(taskB.contract.taskNodeId).toBe(taskId); expect(taskB.claim!.generation).toBe(moved.targetGeneration);
    expect(taskB.claim!.epoch).toBeGreaterThan(oldCredential.epoch); const credential = taskB.claim!;
    const operationsB = [toolIds.bCopy, toolIds.bWrite].map(id => readOperation(targetRoot, credential, `${runB}:${id}`));
    expect(operationsB.every(op => op.state === 'completed')).toBe(true);
    const bindingB = (await profiles()).profiles.find(p => p.id === b.workspaceId)!.coordinatorBindings![a.sessionKey];
    expect(bindingB.writerClaim?.run.runId).toBe(runB); expect(bindingB.activeTaskNodeId).toBe(taskId);
    const writerB = service.writer(targetTree.id);
    expect(writerB).toMatchObject({ owner: { kind: 'run', agentId: bindingB.agentId, run: { runId: runB }, task: { taskNodeId: taskId, epoch: credential.epoch } } });
    for (const op of operationsB) expect(writerB!.operations.find(row => row.id === op.id)).toMatchObject({ state: 'settled', receipt: { outcome: 'completed' } });
    await record('bExecution', { task: taskB, runId: runB, binding: bindingB, operations: operationsB, checkoutWriter: writerB });
    await sampleResources('after-b');
    const beforeStale = sha(await readFile(join(targetRoot, 'artifact.txt')));
    const stale = await call<Reply<TaskView>>('taskLedger', 'command', { workspaceId: b.workspaceId,
      command: { action: 'checkpoint', credential: oldCredential, checkpoint: { completed: [], nextAction: 'STALE MUST NOT APPLY', unresolved: [], artifacts: [] } } });
    expect(stale.success).toBe(false); expect(stale.error).toContain('TASK_GENERATION_STALE');
    const taskAfterStale = (await call<{ task: TaskView }>('taskLedger', 'sessionTask', { workspaceId: b.workspaceId, sessionKey: a.sessionKey })).task;
    expect(taskAfterStale.checkpoint).toEqual(taskB.checkpoint); expect(sha(await readFile(join(targetRoot, 'artifact.txt')))).toBe(beforeStale);
    expect(() => service.beginWrite(writerA!, 'tf0867-stale-write', sha('stale'))).toThrow();
    await record('staleRejected', { response: stale, sourceWriterState: service.writer(sourceTree.id) });
    const inputManifest = { taskNodeId: taskId, revision: taskB.contract.revision, contractDigest: taskB.contract.digest,
      actor: bindingB.agentId, sessionKey: a.sessionKey, generation: credential.generation, runId: runB,
      bindingRevision: bindingB.bindingRevision, artifacts: [{ path: 'checkpoint.txt', sha256: sha(await readFile(join(targetRoot, 'checkpoint.txt'))) },
        { path: 'artifact.txt', sha256: sha(await readFile(join(targetRoot, 'artifact.txt'))) }] };
    const candidate = sha(JSON.stringify(inputManifest));
    await record('candidateInput', { candidate, manifest: inputManifest });
    await command(b.workspaceId, { action: 'checkpoint', credential, checkpoint: { completed: ['Retained A checkpoint in B', 'B produced exact output'],
      nextAction: 'Verify and accept this exact candidate', unresolved: [], artifacts: inputManifest.artifacts.map(file => ({ ...file, path: join(targetRoot, file.path) })) } });
    const checks: TaskEvidence[] = [];
    for (const [criterionId, path, expectedSha256] of [['input', 'checkpoint.txt', sha(checkpointBytes)], ['output', 'artifact.txt', sha(finalBytes)]]) {
      const receipt = await command<TaskEvidence>(b.workspaceId, { action: 'verifyFile', credential, criterionId, path, expectedSha256, candidate });
      expect(receipt).toMatchObject({ taskNodeId: taskId, candidate, criterionId, sha256: expectedSha256, epoch: credential.epoch, revision: taskB.contract.revision, verifier: 'host-file-verifier' });
      expect(receipt.receiptId).toBeTruthy(); checks.push(receipt);
    }
    await command(b.workspaceId, { action: 'submit', credential, candidate });
    const accepted = await command<TaskView>(b.workspaceId, { action: 'accept', credential, candidate });
    expect(accepted.contract.state).toBe('done'); expect(accepted.claim!.state).toBe('released'); expect(accepted.pendingOperations).toBe(0);
    const events = await command<Changes>(b.workspaceId, { action: 'changes', consumer: 'tf0867-trace', limit: 500 });
    expect(events.events.filter(e => e.taskNodeId === taskId && e.kind === 'accepted')).toHaveLength(1);
    expect(events.events.find(e => e.taskNodeId === taskId && e.kind === 'accepted')!.payload).toMatchObject({ candidate, revision: taskB.contract.revision });
    for (const check of checks) expect(events.events.some(e => e.kind === 'evidence' && (e.payload as TaskEvidence).receiptId === check.receiptId)).toBe(true);
    await record('accepted', { owner: accepted, checks, events });
    const afterMigrationProfiles = await profiles();
    expect(afterMigrationProfiles.profiles.find(p => p.id === a.workspaceId)!.coordinatorBindings?.[a.sessionKey]).toBeUndefined();
    expect(service.writer(sourceTree.id)?.state).toBe('released');
    const owner = openExecutionTaskStore(targetRoot);
    const originalAuthority = { id: owner.domain.id, root: owner.domain.root, database: owner.domain.database };
    let sourceReferences: TaskArtifactReference[];
    let originalHistory: Changes;
    try {
      sourceReferences = owner.worktreeArtifactReferences(sourceRoot);
      originalHistory = owner.changes('tf0867-trace', 500);
      expect(originalHistory.events).toEqual(events.events);
      expect(sourceReferences.length).toBeGreaterThan(0);
      expect(owner.worktreeTaskReferences(sourceRoot)).toContain(taskId);
      for (const source of sourceReferences) {
        expect(source.taskNodeId).toBe(taskId);
        expect(source.sha256).toBe(sha(checkpointBytes));
        expect(source.path.endsWith('/checkpoint.txt')).toBe(true);
      }
      expect(owner.get(taskId).claim).toEqual(accepted.claim);
      expect(owner.retentionReceipts(taskId)).toEqual([]);
    }
    finally { owner.close(); }
    await call('workspaces', 'switch', { id: b.workspaceId });
    await call('workspaces', 'delete', { id: a.workspaceId });
    expect((await profiles()).profiles.some(p => resolve(p.rootPath).toLowerCase() === resolve(sourceRoot).toLowerCase())).toBe(false);
    await record('cleanupInputs', { sourceReferences, originalAuthority, originalHistory,
      sourceWorkspaceRemoved: true, sourceWriter: service.writer(sourceTree.id), sourceCommit, sourceBranch });
    // 同时校验绝对路径、真实路径、受管 generation；失败时保留 fixture，绝不递归兜底删除。
    const canonicalHub = await realpath(hub), canonicalSource = await realpath(sourceRoot);
    const rel = relative(join(canonicalHub, '.openclaw', 'worktrees'), canonicalSource);
    expect(rel && !rel.startsWith('..') && !isAbsolute(rel)).toBeTruthy();
    expect(service.list().find(tree => tree.id === sourceTree.id)?.generation).toBe(sourceTree.generation);
    // The real runtime creates journal/FactStore and workspace files. Drain it,
    // then preserve every generated byte through the same native Git owner.
    await call('gateway', 'stop');
    const generatedBeforeRetention = gitAt(sourceRoot, 'status', '--porcelain=v1', '--untracked-files=all');
    if (generatedBeforeRetention) {
      gitAt(sourceRoot, 'add', '--all', '--', '.');
      gitAt(sourceRoot, '-c', 'user.name=Agent fixture', '-c', 'user.email=agent@example.invalid',
        '-c', 'commit.gpgsign=false', 'commit', '-m', 'TF0867 retain drained runtime history');
    }
    const retainedSourceCommit = gitAt(sourceRoot, 'rev-parse', 'HEAD');
    git('update-ref', sourceBranch, retainedSourceCommit, sourceCommit);
    const cleanBeforeDelete = gitAt(sourceRoot, 'status', '--porcelain=v1', '--untracked-files=all');
    await record('cleanupPreflight', { cleanBeforeDelete, sourceHead: gitAt(sourceRoot, 'rev-parse', 'HEAD'),
      sharedBranchHead: git('rev-parse', sourceBranch), generatedBeforeRetention, retainedSourceCommit,
      canonicalSource, generation: sourceTree.generation });
    expect(cleanBeforeDelete).toBe('');
    expect(gitAt(sourceRoot, 'rev-parse', 'HEAD')).toBe(retainedSourceCommit);
    expect(git('rev-parse', sourceBranch)).toBe(retainedSourceCommit);
    service.cleanup(sourceTree.id, { expectedGeneration: sourceTree.generation });
    expect(existsSync(sourceRoot)).toBe(false); expect(service.list().find(tree => tree.id === sourceTree.id)?.status).toBe('cleaned');
    await record('sourceRemoved', { registry: service.list(), nativeWorktrees: git('worktree', 'list', '--porcelain') });
    await startGateway(app!);
    const finalMigration = (await call<{ operation: ExecutionMigrationOperation }>('workspaces', 'executionMigration', request)).operation;
    const runtimeAfterCleanup = finalMigration.runtimeReceipt as SessionExecutionMigrationReceipt;
    expect(finalMigration.phase).toBe('confirmed');
    expect(runtimeAfterCleanup.state).toBe('confirmed'); expect(runtimeAfterCleanup.operationId).toBe(moved.id);
    const finalTasks = await call<{ tasks: TaskView[] }>('taskLedger', 'queryTasks', { workspaceId: b.workspaceId });
    expect(finalTasks.tasks.find(t => t.contract.taskNodeId === taskId)?.contract.state).toBe('done');
    const finalEvents = await command<Changes>(b.workspaceId, { action: 'changes', consumer: 'tf0867-trace', limit: 500 });
    // The original prefix stays exact; cleanup appends receipts to the same Task history.
    expect(finalEvents.events.length).toBeLessThan(500);
    expect(finalEvents.events.slice(0, originalHistory.events.length)).toEqual(originalHistory.events);
    const finalOwner = openExecutionTaskStore(hub);
    let retainedReceipts: TaskArtifactRetentionReceipt[];
    const retainedReadbacks: Array<{ source: TaskArtifactReference; receiptId: string; sha256: string; sizeBytes: number; bytesBase64: string }> = [];
    try {
      expect({ id: finalOwner.domain.id, root: finalOwner.domain.root, database: finalOwner.domain.database }).toEqual(originalAuthority);
      expect(finalOwner.getTaskEvidence(taskId)).toEqual(expect.arrayContaining(checks));
      expect(finalOwner.get(taskId).claim).toEqual(accepted.claim);
      expect(finalOwner.get(taskId).contract).toEqual(accepted.contract);
      expect(finalOwner.get(taskId).checkpoint).toEqual(accepted.checkpoint);
      expect(finalOwner.changes('tf0867-trace', 500)).toEqual(finalEvents);
      retainedReceipts = finalOwner.retentionReceipts(taskId);
      expect(retainedReceipts).toHaveLength(sourceReferences.length);
      for (const source of sourceReferences) {
        const matches = retainedReceipts.filter(receipt => receipt.source.sourceKey === source.sourceKey);
        expect(matches).toHaveLength(1);
        const receipt = matches[0];
        expect(receipt.source).toEqual(source);
        expect(receipt.actor).toBe('agent');
        expect(receipt.retained.commitOid).toBe(sourceCommit);
        expect(git('rev-parse', '--verify', receipt.retained.ref)).toBe(sourceCommit);
        const bytes = finalOwner.readRetainedArtifact(taskId, receipt.receiptId);
        expect(sha(bytes)).toBe(source.sha256);
        expect(bytes).toEqual(Buffer.from(checkpointBytes));
        expect(bytes.length).toBe(receipt.retained.sizeBytes);
        const retainedEvent = finalEvents.events.filter(event => event.taskNodeId === taskId && event.kind === 'artifact_retained'
          && (event.payload as TaskArtifactRetentionReceipt).receiptId === receipt.receiptId);
        expect(retainedEvent).toHaveLength(1);
        expect(retainedEvent[0].payload).toEqual(receipt);
        expect(retainedEvent[0].sequence).toBeGreaterThan(originalHistory.events.at(-1)!.sequence);
        retainedReadbacks.push({ source, receiptId: receipt.receiptId, sha256: sha(bytes), sizeBytes: bytes.length, bytesBase64: bytes.toString('base64') });
      }
      const preparedEvents = finalEvents.events.filter(event => event.taskNodeId === taskId && event.kind === 'worktree_cleanup_prepared');
      const completedEvents = finalEvents.events.filter(event => event.taskNodeId === taskId && event.kind === 'worktree_cleanup_completed');
      expect(preparedEvents).toHaveLength(1); expect(completedEvents).toHaveLength(1);
      const preparedCleanup = preparedEvents[0].payload as { operationId: string; worktree: string; receiptIds: string[]; actor: string };
      expect(preparedCleanup.operationId).toMatch(new RegExp(`^worktree-cleanup:${sourceTree.generation}:`));
      expect(preparedCleanup.worktree).toBe(sourceReferences[0].worktree);
      expect(preparedCleanup.actor).toBe('agent');
      expect([...preparedCleanup.receiptIds].sort()).toEqual(retainedReceipts.map(receipt => receipt.receiptId).sort());
      expect(completedEvents[0].payload).toEqual(preparedCleanup);
      expect(completedEvents[0].sequence).toBeGreaterThan(preparedEvents[0].sequence);
      for (const event of finalEvents.events.filter(event => event.taskNodeId === taskId && event.kind === 'artifact_retained')) {
        expect(preparedEvents[0].sequence).toBeGreaterThan(event.sequence);
      }
    }
    finally { finalOwner.close(); }
    expect(existsSync(hub)).toBe(true); expect(existsSync(targetRoot)).toBe(true);
    // Read the original task through the surviving workspace's production Host route.
    const hostHistoryPages: Array<{ afterSequence: number; rows: TaskHistory }> = [];
    const hostHistory: TaskHistory = [];
    const expectedTaskEvents = finalEvents.events.filter(event => event.taskNodeId === taskId);
    const historyPageSize = 3;
    let afterSequence = 0;
    for (let pageIndex = 0; pageIndex <= Math.ceil(expectedTaskEvents.length / historyPageSize); pageIndex++) {
      const rows = await command<TaskHistory>(b.workspaceId, { action: 'history', taskNodeId: taskId,
        afterSequence, limit: historyPageSize });
      hostHistoryPages.push({ afterSequence, rows });
      await record('hostHistoryPages', { workspaceId: b.workspaceId, taskId, pages: hostHistoryPages });
      expect(rows.length).toBeLessThanOrEqual(historyPageSize);
      for (const row of rows) { expect(row.seq).toBeGreaterThan(afterSequence); afterSequence = row.seq; }
      hostHistory.push(...rows);
      if (rows.length < historyPageSize) break;
    }
    expect(hostHistoryPages.length).toBeGreaterThan(1);
    expect(hostHistory.map(row => ({ sequence: row.seq, taskNodeId: taskId, kind: row.kind,
      at: row.at, payload: JSON.parse(row.json) as unknown }))).toEqual(expectedTaskEvents);
    const hostReceipts = hostHistory.filter(row => row.kind === 'artifact_retained')
      .map(row => JSON.parse(row.json) as TaskArtifactRetentionReceipt);
    expect(hostReceipts).toEqual(retainedReceipts);
    const hostArtifactReadbacks: Array<{ receiptId: string; pages: RetainedArtifactPage[];
      sha256?: string; sizeBytes?: number; bytesBase64?: string }> = [];
    for (const receipt of hostReceipts) {
      const readback: typeof hostArtifactReadbacks[number] = { receiptId: receipt.receiptId, pages: [] };
      hostArtifactReadbacks.push(readback);
      const chunks: Buffer[] = [], length = 7;
      let offset = 0;
      do {
        const page = await command<RetainedArtifactPage>(b.workspaceId, { action: 'readRetainedArtifact',
          taskNodeId: taskId, receiptId: receipt.receiptId, offset, length });
        readback.pages.push(page);
        await record('hostArtifactPages', { workspaceId: b.workspaceId, taskId, readbacks: hostArtifactReadbacks });
        expect(page.receipt).toEqual(receipt); expect(page.encoding).toBe('base64');
        expect(page.offset).toBe(offset); expect(page.sizeBytes).toBe(receipt.retained.sizeBytes);
        const chunk = Buffer.from(page.content, 'base64'), end = Math.min(offset + length, page.sizeBytes);
        expect(chunk.toString('base64')).toBe(page.content);
        expect(chunk.length).toBe(end - offset);
        expect(page.nextOffset).toBe(end < page.sizeBytes ? end : null);
        chunks.push(chunk); offset = end;
      } while (offset < receipt.retained.sizeBytes);
      expect(readback.pages.length).toBeGreaterThan(1);
      const bytes = Buffer.concat(chunks);
      expect(bytes.length).toBe(receipt.retained.sizeBytes); expect(sha(bytes)).toBe(receipt.source.sha256);
      expect(bytes).toEqual(Buffer.from(checkpointBytes));
      expect(bytes.toString('base64')).toBe(retainedReadbacks.find(value => value.receiptId === receipt.receiptId)!.bytesBase64);
      Object.assign(readback, { sha256: sha(bytes), sizeBytes: bytes.length, bytesBase64: bytes.toString('base64') });
    }
    expect(sha(await readFile(join(targetRoot, 'artifact.txt')))).toBe(checks.find(c => c.criterionId === 'output')!.sha256);
    await record('afterCleanup', { registry: service.list(), runtimeReceipt: runtimeAfterCleanup, tasks: finalTasks, taskEvents: finalEvents,
      originalAuthority, sourceReferences, retainedReceipts, retainedReadbacks, hostHistoryPages, hostReceipts, hostArtifactReadbacks,
      trace: { taskId, actor: bindingB.agentId, runIds: [runA, runB], binding: bindingB, candidate, inputManifest,
        checkReceiptIds: checks.map(c => c.receiptId), migrationOperationId: moved.id } });
    await sampleResources('after-cleanup');
    const frozenAfter = await readFrozenInputs(info.file);
    expect(frozenAfter).toEqual(frozenInputs);
    await record('frozenInputsAfter', frozenAfter);
    expect(llm.anomalies).toEqual([]); evidence.status = 'passed';
  } catch (error) { await saveFirstFailure(error); throw error; }
  finally {
    evidence.providerLog = llm?.log ?? [];
    const cleanupErrors: unknown[] = [];
    if (app) {
      await (await getStableWindow(app).catch(() => null))?.screenshot({ path: info.outputPath('final.png') }).catch(() => undefined);
      await call('gateway', 'stop').catch(error => { cleanupErrors.push(error); evidence.gatewayStopError = String(error); });
      await closeElectronApp(app).catch(error => { cleanupErrors.push(error); evidence.appCloseError = String(error); });
    }
    if (llm) { llm.server.closeAllConnections(); await new Promise<void>(done => llm!.server.close(() => done())); }
    try { closeOwnerDatabase?.(); } catch (error) { cleanupErrors.push(error); evidence.databaseCloseError = String(error); }
    if (oldState === undefined) delete process.env.CLAWX_EXECUTION_STATE_PATH; else process.env.CLAWX_EXECUTION_STATE_PATH = oldState;
    const cleanupFailed = cleanupErrors.length > 0 && evidence.status === 'passed';
    if (cleanupFailed) await saveFirstFailure(cleanupErrors[0]);
    await writeFile(info.outputPath('traceability.json'), JSON.stringify(evidence, null, 2));
    if (cleanupFailed) throw cleanupErrors[0];
  }
});
