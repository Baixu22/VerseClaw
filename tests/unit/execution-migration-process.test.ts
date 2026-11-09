// @vitest-environment node
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExecutionMigrationOperation, SessionExecutionMigrationReceipt } from '../../shared/types/execution-migration';
import type { TaskContractInput, TaskView } from '../../shared/task-system/types';
import type { WorkspaceCoordinatorBinding, WorkspaceProfile } from '../../shared/types/workspace';
import { normalizeRunScope } from '../../shared/types/identity-scope';
import { createExecutionTaskAccess, openExecutionTaskStore } from '../../openclaw_runtime/src/agents/execution-task-authority';
import { registerExecutionDomain } from '../../openclaw_runtime/src/agents/execution-domain';
import { resolveExecutionCheckout } from '../../openclaw_runtime/src/agents/worktree-service';
import {
  clearSessionStoreCacheForTest,
  getSessionEntry,
  saveSessionStore,
} from '../../openclaw_runtime/src/config/sessions/store';
import { closeSqliteSessionStoreDatabase } from '../../openclaw_runtime/src/config/sessions/store-sqlite';
import { resolveSessionFilePath } from '../../openclaw_runtime/src/config/sessions/paths';
import type { SessionEntry } from '../../openclaw_runtime/src/config/sessions/types';
import {
  readSessionMutationOperationJournal,
  type SessionExecutionMigrationOperationManifest,
} from '../../openclaw_runtime/src/gateway/session-mutation-operation-journal';
import type { SessionExecutionMigrationFaultPoint } from '../../openclaw_runtime/src/gateway/session-execution-migration';
import { sessionAdmissionRegistry } from '../../openclaw_runtime/src/sessions/session-admission-registry';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';

type MainDurablePhase =
  | 'intent'
  | 'fenced'
  | 'drained'
  | 'reserved'
  | 'session-committed'
  | 'task-committed'
  | 'binding-committed';
type MainBreakPoint = MainDurablePhase | 'publication-before-tail';
type WorkerMode = 'main' | 'runtime-prepare' | 'runtime-confirm';
type Scenario = {
  schema: 1;
  mode: WorkerMode;
  breakPoint?: MainBreakPoint | SessionExecutionMigrationFaultPoint;
  root: string;
  sourceRoot: string;
  targetRoot: string;
  stateDir: string;
  sessionStorePath: string;
  sessionKey: string;
  agentId: string;
  sourceGeneration: string;
  targetGeneration: string;
  operationId: string;
  taskNodeId: string;
  contractRevision: number;
  contractDigest: string;
};
type WorkspaceDocument = { activeWorkspaceId: string; profiles: WorkspaceProfile[] };
type WorkerRun = {
  child: ChildProcessWithoutNullStreams;
  scenarioPath: string;
  stdout: string[];
  stderr: string[];
};
type ProcessObservation = {
  role: 'terminated' | 'resumed' | 'prepare-complete' | 'worker-complete';
  pid: number;
  breakPoint?: string;
  killRequested: boolean;
  killReturned: boolean;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  observedPidGone: boolean;
};
type CaseEvidence = {
  schema: 1;
  case: string;
  breakPoint?: string;
  driven_by: 'agent';
  requested_route: 'DeepSeek v4.1 flash';
  diskReadback: true;
  sourceGeneration: string;
  targetGeneration: string;
  operation: {
    id: string;
    phase: string;
    sessionKey: string;
    sourceGeneration: string;
    targetGeneration: string;
    reservationReleased: boolean | null;
  } | null;
  journal: { state: string; requestDigest: string; manifestDigest: string } | null;
  session: { sessionId: string; workspaceDir: string | null; migrationState: string | null } | null;
  artifactHashes: Array<{ path: string; sha256: string }>;
  transcriptHashes: Array<{ role: 'source' | 'target'; sha256: string | null }>;
  processes: ProcessObservation[];
  workerEvidence: {
    workerEvents: unknown[];
    breakSignal: unknown;
    workerResult: unknown;
    workerError: unknown;
  };
};
type Fixture = {
  root: string;
  sourceRoot: string;
  targetRoot: string;
  stateDir: string;
  sessionStorePath: string;
  sessionKey: string;
  sourceGeneration: string;
  targetGeneration: string;
  operationId: string;
  taskNodeId: string;
  contractRevision: number;
  contractDigest: string;
  artifactPath: string;
  sourceTranscriptPath: string;
  targetTranscriptPath: string;
  sourceEntry: SessionEntry;
  sourceTask: TaskView;
  scenarioPath: string;
  sourceHash: string;
};

const workerPath = fileURLToPath(new URL('./fixtures/execution-migration-worker.mts', import.meta.url));
const originalStateDir = process.env.OPENCLAW_STATE_DIR;
const originalTemp = process.env.TEMP;
const originalTmp = process.env.TMP;
const liveChildren = new Set<ChildProcessWithoutNullStreams>();
let activeRoot: string | undefined;
let activeFixture: Fixture | undefined;
let activeCase: { case: string; breakPoint?: string } | undefined;
let activeProcesses: ProcessObservation[] = [];
let activeBreakSignal: unknown;
let evidenceSequence = 0;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function atomicJson(filePath: string, value: unknown): void {
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, filePath);
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function discard(filePath: string): void {
  rmSync(filePath, { force: true });
}

function readOptionalJson(filePath: string): unknown {
  if (!existsSync(filePath)) return null;
  try {
    return readJson(filePath);
  } catch (error) {
    return { unreadable: error instanceof Error ? error.message : String(error) };
  }
}

function fileHash(filePath: string | null | undefined): string | null {
  if (!filePath || !existsSync(filePath)) return null;
  return sha256(readFileSync(filePath));
}

function beginCase(caseName: string, breakPoint?: string): void {
  activeCase = { case: caseName, ...(breakPoint ? { breakPoint } : {}) };
  activeProcesses = [];
  activeBreakSignal = undefined;
}

function recordProcess(observation: ProcessObservation): void {
  activeProcesses.push(observation);
}

function writeEvidence(fixture: Fixture, caseInfo: { case: string; breakPoint?: string }): void {
  const requestedDirectory = process.env.MIGRATION_PROCESS_EVIDENCE_DIR?.trim();
  if (!requestedDirectory) return;
  const evidenceDirectory = path.resolve(requestedDirectory);
  mkdirSync(evidenceDirectory, { recursive: true });

  let savedOperation: ExecutionMigrationOperation | null = null;
  const workspacePath = path.join(fixture.root, 'workspace.json');
  if (existsSync(workspacePath)) {
    const document = readJson<WorkspaceDocument>(workspacePath);
    savedOperation = document.profiles.find((profile) => profile.id === 'source')
      ?.executionMigrations?.[fixture.operationId] ?? null;
  }

  let journal: CaseEvidence['journal'] = null;
  try {
    const row = readSessionMutationOperationJournal(fixture.sessionStorePath, fixture.operationId, 'session-execution-migrate');
    if (row) {
      journal = {
        state: row.state,
        requestDigest: (row.manifest as SessionExecutionMigrationOperationManifest).requestDigest,
        manifestDigest: row.row.manifest_digest,
      };
    }
  } catch (error) {
    journal = { state: `unreadable:${error instanceof Error ? error.message : String(error)}`, requestDigest: '', manifestDigest: '' };
  }

  let session: CaseEvidence['session'] = null;
  try {
    clearSessionStoreCacheForTest();
    const entry = getSessionEntry({ storePath: fixture.sessionStorePath, sessionKey: fixture.sessionKey });
    session = entry ? {
      sessionId: entry.sessionId,
      workspaceDir: entry.workspaceDir ?? null,
      migrationState: entry.executionMigration?.state ?? null,
    } : null;
  } catch {
    session = null;
  }

  const artifactHashes = new Map<string, string>();
  for (const artifact of savedOperation?.task.checkpoint?.artifacts ?? []) {
    artifactHashes.set(artifact.path, fileHash(artifact.path) ?? `missing:${artifact.path}`);
  }
  try {
    const targetStore = openExecutionTaskStore(fixture.targetRoot);
    try {
      for (const artifact of targetStore.get(fixture.taskNodeId).checkpoint?.artifacts ?? []) {
        artifactHashes.set(artifact.path, fileHash(artifact.path) ?? `missing:${artifact.path}`);
      }
    } finally {
      targetStore.close();
    }
  } catch {
    // A pre-handoff Runtime fault may not yet have a target task view.
  }

  const eventPath = path.join(fixture.root, 'worker-events.jsonl');
  const events = existsSync(eventPath)
    ? readFileSync(eventPath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
        try { return JSON.parse(line) as unknown; } catch { return { raw: line }; }
      })
    : [];
  const evidence: CaseEvidence = {
    schema: 1,
    case: caseInfo.case,
    ...(caseInfo.breakPoint ? { breakPoint: caseInfo.breakPoint } : {}),
    driven_by: 'agent',
    requested_route: 'DeepSeek v4.1 flash',
    diskReadback: true,
    sourceGeneration: fixture.sourceGeneration,
    targetGeneration: savedOperation?.targetGeneration ?? fixture.targetGeneration,
    operation: savedOperation ? {
      id: savedOperation.id,
      phase: savedOperation.phase,
      sessionKey: savedOperation.sessionKey,
      sourceGeneration: savedOperation.sourceGeneration,
      targetGeneration: savedOperation.targetGeneration,
      reservationReleased: savedOperation.reservationReleased ?? null,
    } : null,
    journal,
    session,
    artifactHashes: [...artifactHashes].map(([artifactPath, digest]) => ({ path: artifactPath, sha256: digest })),
    transcriptHashes: [
      { role: 'source', sha256: fileHash(fixture.sourceTranscriptPath) },
      { role: 'target', sha256: fileHash(savedOperation?.runtimeReceipt?.transcriptPath ?? fixture.targetTranscriptPath) },
    ],
    processes: structuredClone(activeProcesses),
    workerEvidence: {
      workerEvents: events,
      breakSignal: activeBreakSignal ?? readOptionalJson(path.join(fixture.root, 'break.signal.json')),
      workerResult: readOptionalJson(path.join(fixture.root, 'worker-result.json')),
      workerError: readOptionalJson(path.join(fixture.root, 'worker-error.json')),
    },
  };

  evidenceSequence += 1;
  const safeCase = caseInfo.case.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'case';
  const filePath = path.join(evidenceDirectory, `${String(evidenceSequence).padStart(2, '0')}-${safeCase}.json`);
  atomicJson(filePath, evidence);
  const readBack = readJson<CaseEvidence>(filePath);
  if (readBack.case !== evidence.case || readBack.processes.length !== evidence.processes.length) {
    throw new Error(`process evidence disk readback mismatch: ${filePath}`);
  }
}
function resetRuntimeState(): void {
  sessionAdmissionRegistry.clearForTests();
  clearSessionStoreCacheForTest();
  closeOpenClawStateDatabaseForTest();
}

function contract(): TaskContractInput {
  return {
    objective: 'Continue the exact task after independent process termination',
    target: 'result.txt',
    constraints: ['Preserve the source transcript and checkpoint'],
    acceptance: [{
      id: 'owner-proof',
      description: 'The runtime owner verifies the resumed operation',
      verification: { kind: 'owner-receipt', owner: 'agent-process-proof' },
    }],
  };
}

function initCheckout(directory: string): void {
  mkdirSync(directory, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: directory, windowsHide: true, stdio: 'pipe' });
}

function sourceBinding(input: {
  sessionKey: string;
  sourceGeneration: string;
  sourceRoot: string;
  taskNodeId: string;
  now: string;
}): WorkspaceCoordinatorBinding {
  return {
    schemaVersion: 1,
    workspaceId: 'source',
    agentId: 'main',
    sessionKey: input.sessionKey,
    sessionGeneration: input.sourceGeneration,
    activeTaskNodeId: input.taskNodeId,
    taskLedgerReferences: [],
    environment: {
      kind: 'local',
      backend: 'git',
      canonicalRoot: input.sourceRoot,
      branch: 'main',
      detachedHead: false,
      setupProfile: null,
    },
    archiveRestorePolicy: 'restore',
    state: 'active',
    bindingRevision: 1,
    invalidationReason: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
function createFixture(): Fixture {
  resetRuntimeState();
  const tempBase = path.resolve(process.env.TEMP || process.env.TMP || tmpdir());
  mkdirSync(tempBase, { recursive: true });
  const root = mkdtempSync(path.join(tempBase, 'tf0866-process-'));
  activeRoot = root;
  const sourceRoot = path.join(root, 'source');
  const targetRoot = path.join(root, 'target');
  const stateDir = path.join(root, 'state');
  const sessionStorePath = path.join(stateDir, 'agents', 'main', 'sessions', 'sessions.json');
  mkdirSync(path.dirname(sessionStorePath), { recursive: true });
  initCheckout(sourceRoot);
  initCheckout(targetRoot);
  process.env.OPENCLAW_STATE_DIR = stateDir;
  process.env.TEMP = tempBase;
  process.env.TMP = tempBase;
  resetRuntimeState();

  const sessionKey = 'agent:main:tf0866-process-proof';
  const sourceGeneration = 'tf0866-source-generation';
  const targetGeneration = 'tf0866-target-generation';
  const operationId = 'tf0866-process-operation';
  const artifactPath = path.join(sourceRoot, 'result.txt');
  writeFileSync(artifactPath, 'retained checkpoint artifact\n', 'utf8');

  const sourceStore = openExecutionTaskStore(sourceRoot);
  let sourceTask: TaskView;
  try {
    sourceTask = sourceStore.start({ contract: contract() }, sessionKey, sourceGeneration, 'agent-process-proof-start');
    sourceStore.checkpoint(sourceTask.claim!, {
      completed: ['source work completed'],
      nextAction: 'resume the same task in the target checkout',
      unresolved: [],
      artifacts: [{ path: 'result.txt', sha256: sha256('retained checkpoint artifact\n') }],
    });
    sourceTask = sourceStore.get(sourceTask.contract.taskNodeId);
  } finally {
    sourceStore.close();
  }

  registerExecutionDomain({
    workspaceRoot: targetRoot,
    authorityRoot: sourceRoot,
    actor: 'agent-process-proof',
    operationId: 'agent-process-proof-register-target',
    expectedRevision: 0,
    projectRevision: 1,
  });
  closeOpenClawStateDatabaseForTest();

  const updatedAt = Date.now();
  const sourceEntry: SessionEntry = {
    sessionId: sourceGeneration,
    updatedAt,
    workspaceDir: sourceRoot,
    sessionFile: `${sourceGeneration}.jsonl`,
    usageFamilyKey: 'tf0866-lineage',
    usageFamilySessionIds: [sourceGeneration],
  };
  saveSessionStore(sessionStorePath, { [sessionKey]: sourceEntry }, { skipMaintenance: true });
  const sourceTranscriptPath = resolveSessionFilePath(sourceGeneration, sourceEntry, {
    agentId: 'main',
    sessionsDir: path.dirname(sessionStorePath),
  });
  const transcriptText = [
    JSON.stringify({ type: 'session', id: sourceGeneration }),
    JSON.stringify({ type: 'message', role: 'user', content: 'Continue this identical objective' }),
    JSON.stringify({ type: 'message', role: 'assistant', content: 'Checkpoint retained' }),
    '',
  ].join('\n');
  writeFileSync(sourceTranscriptPath, transcriptText, 'utf8');
  const sourceHash = sha256(readFileSync(sourceTranscriptPath));
  const targetTranscriptPath = resolveSessionFilePath(targetGeneration, {
    sessionFile: `${targetGeneration}.jsonl`,
  }, {
    agentId: 'main',
    sessionsDir: path.dirname(sessionStorePath),
  });

  const createdAt = new Date().toISOString();
  const binding = sourceBinding({ sessionKey, sourceGeneration, sourceRoot, taskNodeId: sourceTask.contract.taskNodeId, now: createdAt });
  const source: WorkspaceProfile = {
    id: 'source',
    name: 'Source',
    rootPath: sourceRoot,
    agentId: 'main',
    activeSessionKey: sessionKey,
    permissionMode: 'fullAccess',
    state: {},
    coordinatorBindings: { [sessionKey]: binding },
    executionMigrations: {},
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
  };
  const target: WorkspaceProfile = {
    ...source,
    id: 'target',
    name: 'Target',
    rootPath: targetRoot,
    activeSessionKey: 'agent:main:target-placeholder',
    coordinatorBindings: {},
    executionMigrations: {},
  };
  atomicJson(path.join(root, 'workspace.json'), { activeWorkspaceId: 'source', profiles: [source, target] } satisfies WorkspaceDocument);

  const scenarioPath = path.join(root, 'scenario.json');
  const fixture: Fixture = {
    root,
    sourceRoot,
    targetRoot,
    stateDir,
    sessionStorePath,
    sessionKey,
    sourceGeneration,
    targetGeneration,
    operationId,
    taskNodeId: sourceTask.contract.taskNodeId,
    contractRevision: sourceTask.contract.revision,
    contractDigest: sourceTask.contract.digest,
    artifactPath,
    sourceTranscriptPath,
    targetTranscriptPath,
    sourceEntry,
    sourceTask,
    scenarioPath,
    sourceHash,
  };
  activeFixture = fixture;
  return fixture;
}

function scenarioFor(fixture: Fixture, mode: WorkerMode, breakPoint?: Scenario['breakPoint']): Scenario {
  return {
    schema: 1,
    mode,
    ...(breakPoint ? { breakPoint } : {}),
    root: fixture.root,
    sourceRoot: fixture.sourceRoot,
    targetRoot: fixture.targetRoot,
    stateDir: fixture.stateDir,
    sessionStorePath: fixture.sessionStorePath,
    sessionKey: fixture.sessionKey,
    agentId: 'main',
    sourceGeneration: fixture.sourceGeneration,
    targetGeneration: fixture.targetGeneration,
    operationId: fixture.operationId,
    taskNodeId: fixture.taskNodeId,
    contractRevision: fixture.contractRevision,
    contractDigest: fixture.contractDigest,
  };
}

function seedSourceReceipt(fixture: Fixture, outcome: 'completed' | 'reconciled'): string {
  const checkout = resolveExecutionCheckout(fixture.sourceRoot);
  const access = createExecutionTaskAccess(fixture.sourceRoot);
  const credential = checkout.service.claimWriter(checkout.worktreeId, checkout.basis.generation, {
    kind: 'run',
    agentId: 'main',
    sessionGeneration: fixture.sourceGeneration,
    bindingRevision: 1,
    run: normalizeRunScope({
      runId: `source-${outcome}-run-before-migration`,
      scope: { workspaceId: 'source', sessionKey: fixture.sessionKey },
    }),
    task: {
      authorityId: access.domain.id,
      taskNodeId: fixture.taskNodeId,
      epoch: fixture.sourceTask.claim!.epoch,
      contractRevision: fixture.contractRevision,
    },
  }, `agent-process-proof-source-${outcome}-writer`);

  const operationId = `source-write-${outcome}`;
  checkout.service.beginWrite(credential, operationId, sha256(`${outcome}-write`));
  const store = openExecutionTaskStore(fixture.sourceRoot, access.basis);
  try {
    store.beginOperation(fixture.sourceTask.claim!, operationId, 'write');
    if (outcome === 'completed') {
      store.finishOperation(fixture.sourceTask.claim!, operationId, 'completed', 'completed by source owner');
    } else {
      store.reconcileOperation(fixture.sourceTask.claim!, operationId, {
        id: 'source-owner-reconcile-receipt',
        outcome: 'applied',
        owner: 'agent-process-proof',
      });
    }
  } finally {
    store.close();
    closeOpenClawStateDatabaseForTest();
  }
  return operationId;
}
function spawnWorker(fixture: Fixture, mode: WorkerMode, breakPoint?: Scenario['breakPoint']): WorkerRun {
  const scenario = scenarioFor(fixture, mode, breakPoint);
  atomicJson(fixture.scenarioPath, scenario);
  discard(path.join(fixture.root, 'break.signal.json'));
  discard(path.join(fixture.root, 'worker-result.json'));
  discard(path.join(fixture.root, 'worker-error.json'));
  const run: WorkerRun = {
    child: spawn(process.execPath, ['--import', 'tsx', workerPath, fixture.scenarioPath], {
      cwd: fileURLToPath(new URL('../../openclaw_runtime', import.meta.url)),
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: fixture.stateDir,
        TEMP: path.resolve(process.env.TEMP || process.env.TMP || tmpdir()),
        TMP: path.resolve(process.env.TEMP || process.env.TMP || tmpdir()),
      },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }),
    scenarioPath: fixture.scenarioPath,
    stdout: [],
    stderr: [],
  };
  liveChildren.add(run.child);
  run.child.stdout.on('data', (chunk: Buffer) => run.stdout.push(chunk.toString('utf8')));
  run.child.stderr.on('data', (chunk: Buffer) => run.stderr.push(chunk.toString('utf8')));
  run.child.once('exit', () => liveChildren.delete(run.child));
  return run;
}
function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForSignal(fixture: Fixture, run: WorkerRun): Promise<{ pid: number; point: string }> {
  const signalPath = path.join(fixture.root, 'break.signal.json');
  const errorPath = path.join(fixture.root, 'worker-error.json');
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (existsSync(signalPath)) {
      activeBreakSignal = readJson(path.join(fixture.root, 'break.signal.json'));
      return readJson<{ pid: number; point: string }>(signalPath);
    }
    if (existsSync(errorPath)) {
      throw new Error(`worker failed before durable signal: ${readFileSync(errorPath, 'utf8')}`);
    }
    if (run.child.exitCode !== null) {
      throw new Error(`worker exited before durable signal (code=${run.child.exitCode}, stderr=${run.stderr.join('')})`);
    }
    await sleep(25);
  }
  throw new Error('timed out waiting for durable worker signal');
}

async function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs = 10_000): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  return await Promise.race([
    new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code))),
    sleep(timeoutMs).then(() => {
      throw new Error('worker did not exit within timeout');
    }),
  ]);
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function terminateWorker(fixture: Fixture, run: WorkerRun, expectedPoint: string): Promise<void> {
  const signal = await waitForSignal(fixture, run);
  expect(signal.point).toBe(expectedPoint);
  expect(signal.pid).toBe(run.child.pid);
  expect(run.child.pid).toBeTypeOf('number');
  expect(pidExists(run.child.pid!)).toBe(true);

  // This is an OS process termination. No rejection is injected into the
  // production call and no same-process reconstruction is used.
  const killReturned = run.child.kill('SIGKILL');
  expect(killReturned).toBe(true);
  const exitCode = await waitForExit(run.child);
  expect(exitCode).not.toBe(0);
  await sleep(30);
  const observedPidGone = !pidExists(signal.pid);
  expect(observedPidGone).toBe(true);
  recordProcess({
    role: 'terminated',
    pid: signal.pid,
    breakPoint: expectedPoint,
    killRequested: true,
    killReturned,
    exitCode,
    exitSignal: run.child.signalCode,
    observedPidGone,
  });
}

async function completeWorker(fixture: Fixture, run: WorkerRun, role: ProcessObservation['role'] = 'resumed'): Promise<{ operationId: string; phase?: string; state?: string; pid: number }> {
  const exitCode = await waitForExit(run.child, 25_000);
  const errorPath = path.join(fixture.root, 'worker-error.json');
  if (exitCode !== 0 || existsSync(errorPath)) {
    throw new Error(`worker failed (code=${exitCode}, error=${existsSync(errorPath) ? readFileSync(errorPath, 'utf8') : 'none'}, stderr=${run.stderr.join('')})`);
  }
  const result = readJson<{ operationId: string; phase?: string; state?: string; pid: number }>(path.join(fixture.root, 'worker-result.json'));
  recordProcess({
    role,
    pid: run.child.pid ?? -1,
    killRequested: false,
    killReturned: false,
    exitCode,
    exitSignal: run.child.signalCode,
    observedPidGone: run.child.pid ? !pidExists(run.child.pid) : false,
  });
  return result;
}

function workspace(fixture: Fixture): WorkspaceDocument {
  return readJson(path.join(fixture.root, 'workspace.json'));
}

function operation(fixture: Fixture): ExecutionMigrationOperation {
  const saved = workspace(fixture).profiles
    .find((profile) => profile.id === 'source')?.executionMigrations?.[fixture.operationId];
  if (!saved) throw new Error('migration operation missing');
  return saved;
}

function refreshSession(fixture: Fixture): SessionEntry | undefined {
  clearSessionStoreCacheForTest();
  closeSqliteSessionStoreDatabase(fixture.sessionStorePath);
  closeOpenClawStateDatabaseForTest();
  return getSessionEntry({ storePath: fixture.sessionStorePath, sessionKey: fixture.sessionKey });
}

function assertAtMostOneActiveBinding(fixture: Fixture): void {
  const active = workspace(fixture).profiles.flatMap((profile) => Object.values(profile.coordinatorBindings ?? {}))
    .filter((binding) => binding.sessionKey === fixture.sessionKey && binding.state === 'active');
  expect(active.length).toBeLessThanOrEqual(1);
}

function assertNoConcurrentWriters(fixture: Fixture): void {
  const source = resolveExecutionCheckout(fixture.sourceRoot).service.writer(null);
  const target = resolveExecutionCheckout(fixture.targetRoot).service.writer(null);
  const writable = [source, target].filter((state) => state && state.state !== 'released');
  expect(writable.length).toBeLessThanOrEqual(1);
}

function assertIntentArtifactPath(fixture: Fixture, saved: ExecutionMigrationOperation): void {
  expect(saved.phase).toBe('intent');
  expect(saved.task.checkpoint?.artifacts).toEqual([
    { path: path.resolve(fixture.sourceRoot, 'result.txt'), sha256: sha256('retained checkpoint artifact\n') },
  ]);
  expect(path.isAbsolute(saved.task.checkpoint!.artifacts[0]!.path)).toBe(true);
}

function assertMainFinal(fixture: Fixture, expectedTargetGeneration: string, expectTargetWriterReleased = true): ExecutionMigrationOperation {
  resetRuntimeState();
  const saved = operation(fixture);
  expect(saved).toMatchObject({
    id: fixture.operationId,
    phase: 'confirmed',
    sessionKey: fixture.sessionKey,
    sourceGeneration: fixture.sourceGeneration,
    targetGeneration: expectedTargetGeneration,
  });
  expect(saved.task.credential.taskNodeId).toBe(fixture.taskNodeId);
  expect(saved.reservationReleased).toBe(true);

  const published = workspace(fixture);
  expect(published.activeWorkspaceId).toBe('target');
  const sourceProfile = published.profiles.find((profile) => profile.id === 'source')!;
  const targetProfile = published.profiles.find((profile) => profile.id === 'target')!;
  expect(sourceProfile.coordinatorBindings?.[fixture.sessionKey]).toBeUndefined();
  expect(targetProfile.coordinatorBindings?.[fixture.sessionKey]).toMatchObject({
    state: 'active',
    sessionGeneration: expectedTargetGeneration,
    activeTaskNodeId: fixture.taskNodeId,
  });
  assertAtMostOneActiveBinding(fixture);

  const entry = refreshSession(fixture);
  expect(entry).toMatchObject({
    sessionId: expectedTargetGeneration,
    workspaceDir: fixture.targetRoot,
    executionMigration: { operationId: fixture.operationId, state: 'confirmed' },
  });
  const sourceHash = sha256(readFileSync(fixture.sourceTranscriptPath));
  const migratedTranscriptPath = saved.runtimeReceipt?.transcriptPath;
  expect(migratedTranscriptPath).toBeTruthy();
  const targetHash = sha256(readFileSync(migratedTranscriptPath!));
  expect(sourceHash).toBe(targetHash);
  expect(readFileSync(migratedTranscriptPath!, 'utf8')).toContain('Continue this identical objective');

  const targetStore = openExecutionTaskStore(fixture.targetRoot);
  try {
    const task = targetStore.get(fixture.taskNodeId);
    expect(task.contract.taskNodeId).toBe(fixture.taskNodeId);
    expect(task.contract.objective).toBe(contract().objective);
    expect(task.contract.revision).toBe(fixture.contractRevision);
    expect(task.contract.digest).toBe(fixture.contractDigest);
    expect(task.claim).toMatchObject({
      taskNodeId: fixture.taskNodeId,
      sessionKey: fixture.sessionKey,
      generation: expectedTargetGeneration,
      worktree: createExecutionTaskAccess(fixture.targetRoot).domain.worktree,
    });
    expect(task.checkpoint?.nextAction).toBe('resume the same task in the target checkout');
    expect(task.checkpoint?.completed).toEqual(['source work completed']);
    expect(task.checkpoint?.artifacts).toEqual(saved.task.checkpoint?.artifacts);
    expect(task.checkpoint?.artifacts).toHaveLength(1);
    expect(task.checkpoint!.artifacts[0]!.path).toBe(fixture.artifactPath);
    expect(path.isAbsolute(task.checkpoint!.artifacts[0]!.path)).toBe(true);
    expect(task.pendingOperations).toBe(0);
  } finally {
    targetStore.close();
  }

  const sourceTaskStore = openExecutionTaskStore(fixture.sourceRoot);
  try {
    expect(sourceTaskStore.get(fixture.taskNodeId).claim?.generation).toBe(expectedTargetGeneration);
  } finally {
    sourceTaskStore.close();
  }

  expect(readFileSync(fixture.artifactPath, 'utf8')).toBe('retained checkpoint artifact\n');
  if (expectTargetWriterReleased) {
    expect(resolveExecutionCheckout(fixture.targetRoot).service.writer(null)?.state).toBe('released');
  }
  assertNoConcurrentWriters(fixture);
  return saved;
}
function assertRuntimeFinal(fixture: Fixture, expectedTargetGeneration: string): SessionExecutionMigrationReceipt {
  resetRuntimeState();
  const entry = refreshSession(fixture);
  expect(entry).toMatchObject({
    sessionId: expectedTargetGeneration,
    workspaceDir: fixture.targetRoot,
    executionMigration: { operationId: fixture.operationId, state: 'confirmed' },
  });
  expect(entry?.workspaceDir).not.toBe(fixture.sourceRoot);

  const journal = readSessionMutationOperationJournal(
    fixture.sessionStorePath,
    fixture.operationId,
    'session-execution-migrate',
  );
  expect(journal?.state).toBe('runtime_committed');
  const manifest = journal?.manifest as SessionExecutionMigrationOperationManifest;
  expect(manifest.request).toMatchObject({
    operationId: fixture.operationId,
    sessionKey: fixture.sessionKey,
    targetGeneration: expectedTargetGeneration,
  });
  const receipt = JSON.parse(journal!.receiptJson!) as SessionExecutionMigrationReceipt;
  expect(receipt).toMatchObject({
    operationId: fixture.operationId,
    sessionKey: fixture.sessionKey,
    targetGeneration: expectedTargetGeneration,
    state: 'confirmed',
  });
  expect(sha256(readFileSync(fixture.sourceTranscriptPath))).toBe(sha256(readFileSync(fixture.targetTranscriptPath)));

  const taskStore = openExecutionTaskStore(fixture.targetRoot);
  try {
    const task = taskStore.get(fixture.taskNodeId);
    expect(task.contract.objective).toBe(contract().objective);
    expect(task.claim).toMatchObject({
      taskNodeId: fixture.taskNodeId,
      sessionKey: fixture.sessionKey,
      generation: expectedTargetGeneration,
    });
    expect(task.checkpoint?.nextAction).toBe('resume the same task in the target checkout');
    expect(task.pendingOperations).toBe(0);
  } finally {
    taskStore.close();
  }
  return receipt;
}

function expectedInterruptedState(faultPoint: SessionExecutionMigrationFaultPoint): {
  journal: 'intent' | 'store_committed' | 'runtime_committed';
  session: 'source' | 'target-prepared' | 'target-confirmed';
} {
  if (faultPoint === 'after-intent' || faultPoint === 'after-copy') return { journal: 'intent', session: 'source' };
  if (faultPoint === 'after-store-commit' || faultPoint === 'before-prepare-reply') {
    return { journal: 'store_committed', session: 'target-prepared' };
  }
  return { journal: 'runtime_committed', session: 'target-confirmed' };
}

function assertRuntimeInterrupted(fixture: Fixture, faultPoint: SessionExecutionMigrationFaultPoint): void {
  resetRuntimeState();
  const expected = expectedInterruptedState(faultPoint);
  const journal = readSessionMutationOperationJournal(
    fixture.sessionStorePath,
    fixture.operationId,
    'session-execution-migrate',
  );
  expect(journal?.state).toBe(expected.journal);
  const entry = refreshSession(fixture);
  if (expected.session === 'source') {
    expect(entry).toMatchObject({ sessionId: fixture.sourceGeneration, workspaceDir: fixture.sourceRoot });
  } else if (expected.session === 'target-prepared') {
    expect(entry).toMatchObject({
      sessionId: fixture.targetGeneration,
      workspaceDir: fixture.targetRoot,
      executionMigration: { operationId: fixture.operationId, state: 'prepared' },
    });
  } else {
    expect(entry).toMatchObject({
      sessionId: fixture.targetGeneration,
      workspaceDir: fixture.targetRoot,
      executionMigration: { operationId: fixture.operationId, state: 'confirmed' },
    });
  }
  expect(sha256(readFileSync(fixture.sourceTranscriptPath))).toBe(fixture.sourceHash);
  if (existsSync(fixture.targetTranscriptPath)) {
    expect(sha256(readFileSync(fixture.targetTranscriptPath))).toBe(fixture.sourceHash);
  }
}

function handoffTarget(fixture: Fixture): void {
  closeOpenClawStateDatabaseForTest();
  const store = openExecutionTaskStore(fixture.sourceRoot);
  try {
    const source = store.binding(fixture.sessionKey, fixture.sourceGeneration);
    if (!source?.claim) throw new Error('source task claim missing');
    store.handoff(source.claim, fixture.sessionKey, fixture.targetGeneration, fixture.targetRoot);
  } finally {
    store.close();
  }
  closeOpenClawStateDatabaseForTest();
}

afterEach(async () => {
  if (activeFixture && activeCase) writeEvidence(activeFixture, activeCase);
  for (const child of liveChildren) {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  liveChildren.clear();
  resetRuntimeState();
  if (activeRoot) closeSqliteSessionStoreDatabase(path.join(activeRoot, 'state', 'agents', 'main', 'sessions', 'sessions.json'));
  if (activeRoot) {
    await sleep(100);
    rmSync(activeRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
  activeRoot = undefined;
  activeFixture = undefined;
  activeCase = undefined;
  activeProcesses = [];
  activeBreakSignal = undefined;
  if (originalStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
  else process.env.OPENCLAW_STATE_DIR = originalStateDir;
  if (originalTemp === undefined) delete process.env.TEMP;
  else process.env.TEMP = originalTemp;
  if (originalTmp === undefined) delete process.env.TMP;
  else process.env.TMP = originalTmp;
});

describe('TF-0866 independent process termination and restart', () => {
  it.each([
    'intent',
    'fenced',
    'drained',
    'reserved',
    'session-committed',
    'task-committed',
    'binding-committed',
  ] satisfies MainDurablePhase[])(
    'Main resumes the same operation after the OS process is terminated at durable phase %s',
    async (phase) => {
      beginCase('Main durable ' + phase, phase);
      const fixture = createFixture();
      const first = spawnWorker(fixture, 'main', phase);
      await terminateWorker(fixture, first, phase);

      const interrupted = operation(fixture);
      expect(interrupted).toMatchObject({
        id: fixture.operationId,
        phase,
        sessionKey: fixture.sessionKey,
        sourceGeneration: fixture.sourceGeneration,
      });
      expect(interrupted.targetGeneration).not.toBe(fixture.sourceGeneration);
      if (phase === 'intent') assertIntentArtifactPath(fixture, interrupted);
      assertAtMostOneActiveBinding(fixture);
      assertNoConcurrentWriters(fixture);

      const resumed = await completeWorker(fixture, spawnWorker(fixture, 'main'));
      const final = assertMainFinal(fixture, interrupted.targetGeneration);
      expect(resumed.operationId).toBe(fixture.operationId);
      expect(final.phase).toBe('confirmed');
      expect(final.targetGeneration).toBe(interrupted.targetGeneration);
    },
    60_000,
  );

  it('releases the exact reserved target writer after active+confirmed publication but before the process tail', async () => {
    beginCase('Main publication before tail', 'publication-before-tail');
    const fixture = createFixture();
    const first = spawnWorker(fixture, 'main', 'publication-before-tail');
    await terminateWorker(fixture, first, 'publication-before-tail');

    const published = operation(fixture);
    expect(published.phase).toBe('confirmed');
    const document = workspace(fixture);
    expect(document.activeWorkspaceId).toBe('target');
    expect(document.profiles.find((profile) => profile.id === 'target')?.coordinatorBindings?.[fixture.sessionKey]?.state).toBe('active');
    expect(document.profiles.find((profile) => profile.id === 'source')?.coordinatorBindings?.[fixture.sessionKey]).toBeUndefined();
    const oldReservation = published.reservation!;
    const oldWriter = resolveExecutionCheckout(fixture.targetRoot).service.writer(null);
    expect(oldWriter).toMatchObject({
      state: 'active',
      epoch: oldReservation.credential.epoch,
      token: oldReservation.credential.token,
    });
    expect(resolveExecutionCheckout(fixture.sourceRoot).service.writer(null)?.state ?? 'released').toBe('released');

    await completeWorker(fixture, spawnWorker(fixture, 'main'));
    const final = assertMainFinal(fixture, published.targetGeneration);
    expect(final.reservation?.credential.token).toBe(oldReservation.credential.token);
    expect(resolveExecutionCheckout(fixture.targetRoot).service.writer(null)?.state).toBe('released');
  }, 60_000);
  it('does not release a later target writer when a confirmed operation is replayed', async () => {
    beginCase('Main confirmed replay exact reservation', 'publication-before-tail');
    const fixture = createFixture();
    const first = spawnWorker(fixture, 'main', 'publication-before-tail');
    await terminateWorker(fixture, first, 'publication-before-tail');
    const published = operation(fixture);
    const checkout = resolveExecutionCheckout(fixture.targetRoot);
    const oldReservation = published.reservation!;
    checkout.service.releaseUnusedWriter(oldReservation.credential);
    const later = checkout.service.claimWriter(checkout.worktreeId, checkout.basis.generation, {
      kind: 'run',
      agentId: 'main',
      sessionGeneration: published.targetGeneration,
      bindingRevision: published.sourceBindingRevision + 2,
      run: normalizeRunScope({
        runId: 'later-writer-after-publication',
        scope: { workspaceId: 'target', sessionKey: fixture.sessionKey },
      }),
    }, 'later-writer-after-publication');
    checkout.service.beginWrite(later, 'later-writer-effect', sha256('later writer effect'));
    checkout.service.settleWrite(later, 'later-writer-effect', {
      outcome: 'completed',
      ownerReceipt: 'later-writer-owner-receipt',
    });

    await completeWorker(fixture, spawnWorker(fixture, 'main'));
    const stillLater = resolveExecutionCheckout(fixture.targetRoot).service.writer(null);
    expect(stillLater).toMatchObject({
      state: 'active',
      epoch: later.epoch,
      token: later.token,
      operations: [expect.objectContaining({ id: 'later-writer-effect', state: 'settled' })],
    });
    assertMainFinal(fixture, published.targetGeneration, false);
    expect(resolveExecutionCheckout(fixture.targetRoot).service.writer(null)?.token).toBe(later.token);
    resolveExecutionCheckout(fixture.targetRoot).service.releaseWriter(later);
  }, 60_000);

  it.each(['completed', 'reconciled'] as const)(
    'consumes a %s source checkout receipt before pausing the source Task owner',
    async (receiptOutcome) => {
      beginCase(`Main source ${receiptOutcome} receipt before pause`, 'fenced');
      const fixture = createFixture();
      const receiptOperationId = seedSourceReceipt(fixture, receiptOutcome);
      const first = spawnWorker(fixture, 'main', 'fenced');
      await terminateWorker(fixture, first, 'fenced');
      const resumed = await completeWorker(fixture, spawnWorker(fixture, 'main'));
      expect(resumed.operationId).toBe(fixture.operationId);
      assertMainFinal(fixture, operation(fixture).targetGeneration);

      resetRuntimeState();
      const sourceWriter = resolveExecutionCheckout(fixture.sourceRoot).service.writer(null);
      expect(sourceWriter?.state).toBe('released');
      expect(sourceWriter?.operations).toHaveLength(1);
      expect(sourceWriter?.operations[0]).toMatchObject({ id: receiptOperationId, state: 'settled' });
      if (receiptOutcome === 'completed') {
        expect(sourceWriter?.operations[0]?.receipt?.ownerReceipt).toContain(`task-operation:${receiptOperationId}`);
      } else {
        expect(sourceWriter?.operations[0]?.receipt?.ownerReceipt).toBe('source-owner-reconcile-receipt');
      }

      const sourceStore = openExecutionTaskStore(fixture.sourceRoot);
      try {
        const events = sourceStore.db.prepare(
          "SELECT kind FROM task_events WHERE task_id=? AND kind IN ('effect_reconciled','pause','handoff') ORDER BY seq",
        ).all(fixture.taskNodeId) as Array<{ kind: string }>;
        expect(events.map((row) => row.kind)).toEqual(
          receiptOutcome === 'reconciled' ? ['effect_reconciled', 'pause', 'handoff'] : ['pause', 'handoff'],
        );
      } finally {
        sourceStore.close();
      }
    },
    60_000,
  );

  it.each([
    'after-intent',
    'after-copy',
    'after-store-commit',
    'before-prepare-reply',
  ] satisfies SessionExecutionMigrationFaultPoint[])(
    'Runtime resumes the same prepare journal after the OS process is terminated at %s',
    async (faultPoint) => {
      beginCase('Runtime prepare ' + faultPoint, faultPoint);
      const fixture = createFixture();
      await terminateWorker(fixture, spawnWorker(fixture, 'runtime-prepare', faultPoint), faultPoint);
      assertRuntimeInterrupted(fixture, faultPoint);
      const resumed = await completeWorker(fixture, spawnWorker(fixture, 'runtime-prepare'));
      expect(resumed).toMatchObject({ operationId: fixture.operationId, state: 'prepared' });
      expect(refreshSession(fixture)).toMatchObject({
        sessionId: fixture.targetGeneration,
        workspaceDir: fixture.targetRoot,
        executionMigration: { operationId: fixture.operationId, state: 'prepared' },
      });
    },
    60_000,
  );

  it.each([
    'after-confirm-commit',
    'before-confirm-reply',
  ] satisfies SessionExecutionMigrationFaultPoint[])(
    'Runtime resumes the same confirmation journal after the OS process is terminated at %s',
    async (faultPoint) => {
      beginCase('Runtime confirm ' + faultPoint, faultPoint);
      const fixture = createFixture();
      const prepared = await completeWorker(fixture, spawnWorker(fixture, 'runtime-prepare'), 'prepare-complete');
      expect(prepared).toMatchObject({ operationId: fixture.operationId, state: 'prepared' });
      handoffTarget(fixture);

      await terminateWorker(fixture, spawnWorker(fixture, 'runtime-confirm', faultPoint), faultPoint);
      assertRuntimeInterrupted(fixture, faultPoint);
      const resumed = await completeWorker(fixture, spawnWorker(fixture, 'runtime-confirm'));
      expect(resumed).toMatchObject({ operationId: fixture.operationId, state: 'confirmed' });
      const receipt = assertRuntimeFinal(fixture, fixture.targetGeneration);
      expect(receipt.operationId).toBe(fixture.operationId);
    },
    60_000,
  );
});
