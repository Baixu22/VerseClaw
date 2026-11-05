import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createVerseGitCleanupBarrier } from '../../shared/versegit-cleanup-barrier';
import { afterEach, describe, expect, it } from 'vitest';
import { VerseShellProcessManager } from '../../openclaw_runtime/src/agents/verseshell/process-manager';
import {
  executeGovernedVerseShellProcessObserved,
  type GovernedVerseShellProcessObservedResult,
} from '../../openclaw_runtime/src/agents/verseshell/governed-process';
import {
  freezeOrchestrationCandidate,
  type CreateCandidateWorker,
} from '../../openclaw_runtime/src/agents/orchestration-candidate';
import {
  __resetWorktreeRegistry,
  createWorktreeService,
  writeWorktreeFile,
} from '../../openclaw_runtime/src/agents/worktree-service';
import type { Observation } from '../../shared/verseshell/types';
import {
  VerseGitReceiptBridge,
  createVerificationPlan,
  executionInputDigest,
  type VerificationAuthorization,
  type VerificationPlan,
  type VerseShellReceipt,
} from '../../electron/services/versegit-receipt-bridge';
import {
  VG_VERIFICATION_CLEANUP_SCHEMA,
  FileVerseShellReceiptAuthority,
  completeCandidateVerificationEvidence,
  createCandidateInputManifest,
  prepareCandidateVerificationEvidence,
  cleanupBarrierEvidenceFromRecord,
  stableJson,
  readCompletedVerseGitReviewFacts,
  readCompletedVerseGitTaskCheck,
  type CandidateInputManifest,
} from '../../electron/services/versegit-receipt-evidence';

const binaryPath = resolve('resources/bin/win32-x64/ae.exe');
const runRealBinary = process.platform === 'win32' && existsSync(binaryPath);
const tempRoot = process.platform === 'win32' ? 'D:/tmp' : process.env.TMPDIR ?? '/tmp';
const roots: string[] = [];
const managers: VerseShellProcessManager[] = [];

const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();

afterEach(async () => {
  __resetWorktreeRegistry();
  await Promise.allSettled(managers.splice(0).map((manager) => manager.shutdownAll()));
  while (roots.length > 0) {
    const root = roots.pop()!;
    rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});

const REQUIRED_CHECKS = ['producer-api', 'consumer-a', 'consumer-b-rework', 'required-env'];
const REQUIRED_ENV = { CLAWX_VG_REQUIRED_SCOPE: 'full', CLAWX_VG_TEST_MODE: 'candidate' };

function makeRepo(): string {
  const root = mkdtempSync(join(tempRoot, 'versegit-e2-receipt-'));
  roots.push(root);
  git(root, ['init', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'agent@example.invalid']);
  git(root, ['config', 'user.name', 'Agent']);
  writeFileSync(join(root, '.gitignore'), '.openclaw/\n.ae/\n', 'utf8');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/producer.cjs'), "module.exports = { api: () => 1 };\n", 'utf8');
  writeFileSync(join(root, 'src/consumer-a.cjs'), "const { api } = require('./producer.cjs');\nmodule.exports = { value: api() + '-a' };\n", 'utf8');
  writeFileSync(join(root, 'src/consumer-b.cjs'), "const { api } = require('./producer.cjs');\nmodule.exports = { value: api() + 1, implementation: 'b-v0' };\n", 'utf8');
  writeFileSync(join(root, 'verify.cjs'), `const producer = require('./src/producer.cjs');
const consumerA = require('./src/consumer-a.cjs');
const consumerB = require('./src/consumer-b.cjs');
const checks = [
  { id: 'producer-api', passed: producer.api() === 'one' },
  { id: 'consumer-a', passed: consumerA.value === 'one-a' },
  { id: 'consumer-b-rework', passed: consumerB.value === 2 && consumerB.implementation === 'b-v2' },
  { id: 'required-env', passed: process.env.CLAWX_VG_REQUIRED_SCOPE === 'full' && process.env.CLAWX_VG_TEST_MODE === 'candidate' },
];
console.log(JSON.stringify({ schema: 'clawx.versegit.required-tests/v1', ok: checks.every((check) => check.passed), checks }));
process.exitCode = checks.every((check) => check.passed) ? 0 : 1;
`, 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'base']);
  return root;
}

function makeWorkers(root: string): { service: ReturnType<typeof createWorktreeService>; workers: Array<CreateCandidateWorker & { worktreeId: string }> } {
  const service = createWorktreeService(root, { backend: 'git' });
  const definitions = [
    { id: 'worker-a', writeSet: ['src/producer.cjs', 'src/consumer-a.cjs'] },
    { id: 'worker-b', writeSet: ['src/consumer-b.cjs'] },
  ];
  return {
    service,
    workers: definitions.map(({ id, writeSet }, index) => {
      const record = service.create(id, { writeSet });
      return {
        taskNodeId: `task-${id}`,
        worktreeId: id,
        worktreePath: record.root,
        worktreeRole: id,
        declaredWriteSet: writeSet,
        parentOrder: index,
      };
    }),
  };
}

function writeWorkerChanges(workers: Array<{ worktreePath: string }>, consumerBVersion: 'v1' | 'v2'): void {
  writeWorktreeFile(workers[0]!.worktreePath, 'src/producer.cjs', "module.exports = { api: () => 'one' };\n");
  writeWorktreeFile(workers[0]!.worktreePath, 'src/consumer-a.cjs', "const { api } = require('./producer.cjs');\nmodule.exports = { value: api() + '-a' };\n");
  writeWorktreeFile(
    workers[1]!.worktreePath,
    'src/consumer-b.cjs',
    consumerBVersion === 'v2'
      ? "const { api } = require('./producer.cjs');\nconst value = api();\nmodule.exports = { value: typeof value === 'string' ? 2 : value + 1, implementation: 'b-v2' };\n"
      : "const { api } = require('./producer.cjs');\nmodule.exports = { value: api() + 1, implementation: 'b-v1' };\n",
  );
}

function authorizationFor(input: {
  runId: string;
  candidateId: string;
  checkId: string;
  status?: 'active' | 'revoked';
  scope?: 'full' | 'selected';
}): VerificationAuthorization {
  const issuedAt = new Date(Date.now() - 1_000).toISOString();
  return {
    schema: 'clawx.versegit.verification-authorization/v1',
    authorizationId: `auth-${input.runId}`,
    runId: input.runId,
    ownerId: 'owner-candidate-receipts',
    candidateId: input.candidateId,
    checkId: input.checkId,
    epoch: 2,
    requiredScope: input.scope ?? 'full',
    status: input.status ?? 'active',
    issuedAt,
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    ...(input.status === 'revoked' ? { revokedAt: new Date().toISOString(), revocationReason: 'operator_revoked' } : {}),
  };
}

function planFor(input: {
  runId: string;
  candidateId: string;
  candidateInputDigest: string;
  authorizationDigest: string;
  scope?: 'full' | 'selected';
  deadlineAt?: number;
  taskCompletion?: VerificationPlan['taskCompletion'];
}): VerificationPlan {
  const created = createVerificationPlan({
    runId: input.runId,
    candidateId: input.candidateId,
    candidateInputDigest: input.candidateInputDigest,
    checkId: 'candidate-full-required-tests',
    owner: 'owner-candidate-receipts',
    epoch: 2,
    authorizationId: `auth-${input.runId}`,
    authorizationDigest: input.authorizationDigest,
    evidenceVersion: 2,
    deadlineAt: input.deadlineAt ?? Date.now() + 60_000,
    requiredChecks: input.taskCompletion ? ['candidate-full-required-tests'] : input.scope === 'selected' ? ['producer-api'] : REQUIRED_CHECKS,
    ...(input.taskCompletion ? { taskCompletion: input.taskCompletion } : {}),
    commands: [{
      argv: ['node', 'verify.cjs'],
      cwd: '.',
      env: REQUIRED_ENV,
      effect: 'read',
      retry: 'never',
      expectedArtifacts: ['stdout', 'stderr', 'exit'],
      timeoutMs: 30_000,
      maxOutputBytes: 256 * 1024,
    }],
    requiredScope: input.scope ?? 'full',
  });
  if (!created.plan) throw new Error(created.issues.join('; '));
  return created.plan;
}

function childEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ['PATH', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP']) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  return { ...env, ...overrides };
}
function runtimeEnv(): NodeJS.ProcessEnv {
  return {
    VERSESHELL_RUNTIME_VERSION: '1.0.0',
    VERSESHELL_SERVER_PROTOCOL: 'verseshell.jsonl/v1',
    VERSESHELL_OPERATION_CATALOG_DIGEST: 'sha256:67f78a723d582bf0809aab1f94352772c8a2818367b2f5e9d931722c06e979e8',
    VERSESHELL_OPERATION_CATALOG_COUNT: '32',
    VERSESHELL_AE_SHA256: sha(readFileSync(binaryPath)),
    VERSESHELL_OS_SHELL: 'powershell',
  };
}

function pidExists(pid: number): boolean {
  try {
    const output = execFileSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8', windowsHide: true, timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output.split(/\r?\n/u).some((line) => new RegExp(`^"ae\\.exe","${pid}"`, 'iu').test(line.trim()));
  } catch {
    return false;
  }
}


async function finishCleanup(input: {
  manager: VerseShellProcessManager;
  result: GovernedVerseShellProcessObservedResult;
  candidatePath: string;
  baseRoot: string;
  deletedWorktrees: number;
}): Promise<Record<string, unknown>> {
  const pre = input.manager.list();
  const managedPids = [...new Set([
    ...pre.filter((entry) => input.result.processKeys.includes(entry.key)).map((entry) => entry.pid),
    ...(input.result.processPid ? [input.result.processPid] : []),
  ].filter((pid): pid is number => Number.isInteger(pid) && Number(pid) > 0))].sort((a, b) => a - b);
  await input.manager.shutdownAll();
  const managedAfterShutdown = input.manager.list().map((entry) => entry.pid).filter((pid): pid is number => pid !== null);
  const ownedPidChecks = managedPids.map((pid) => ({ ok: true, pid, exists: pidExists(pid) }));
  const survivorPids = ownedPidChecks.filter((entry) => entry.exists).map((entry) => entry.pid);
  const deletionErrors: string[] = [];
  if (existsSync(input.candidatePath)) {
    try {
      git(input.baseRoot, ['worktree', 'remove', '--force', input.candidatePath]);
    } catch (error) {
      deletionErrors.push(String((error as Error).message ?? error).slice(0, 300));
    }
  }
  const candidateWorktreeSurvivors = existsSync(input.candidatePath) ? 1 : 0;
  return {
    schema: VG_VERIFICATION_CLEANUP_SCHEMA,
    status: deletionErrors.length === 0 && survivorPids.length === 0 && managedAfterShutdown.length === 0 ? 'clean' : 'recovery_required',
    processesDeleted: survivorPids.length === 0,
    processSurvivors: survivorPids.length,
    survivorPids,
    managerProcessSurvivors: managedAfterShutdown.length,
    managedAfterShutdown,
    worktreesDeleted: deletionErrors.length === 0 ? input.deletedWorktrees : 0,
    worktreeSurvivors: candidateWorktreeSurvivors,
    candidateWorktreeSurvivors,
    verificationRootRemoved: candidateWorktreeSurvivors === 0,
    baseRootPreserved: true,
    tempRootRemoved: candidateWorktreeSurvivors === 0,
    hostWorktreesDeleted: 0,
    deletionErrors,
    processInventory: {
      baselinePids: [],
      duringPids: managedPids,
      afterPids: ownedPidChecks.filter((entry) => entry.exists).map((entry) => entry.pid),
      newProcessPids: managedPids,
      managedPids,
      managedAfterShutdown,
      survivorPids,
      ownedPidChecks,
    },
  };
}

async function runCandidate(input: {
  candidateRoot: string;
  candidateId: string;
  candidateInputDigest: string;
  candidateManifest: CandidateInputManifest;
  runId: string;
  evidenceRoot: string;
  manager: VerseShellProcessManager;
  baseRoot: string;
}): Promise<{
  plan: VerificationPlan;
  execution: GovernedVerseShellProcessObservedResult;
  receipt: VerseShellReceipt;
  receiptResult: string;
  verdict: string;
  cleanup: Record<string, unknown>;
}> {
  const authorization = authorizationFor({ runId: input.runId, candidateId: input.candidateId, checkId: 'candidate-full-required-tests' });
  const authorizationDigest = sha(`${stableJson(authorization)}\n`);
  const plan = planFor({ ...input, authorizationDigest });
  const authority = new FileVerseShellReceiptAuthority(input.evidenceRoot);
  if (!existsSync(input.evidenceRoot)) authority.reset();
  const bridge = new VerseGitReceiptBridge(authority);
  const prepared = prepareCandidateVerificationEvidence({ authority, bridge, plan, authorization, candidateManifest: input.candidateManifest });
  const execution = await executeGovernedVerseShellProcessObserved({
    command: plan.commands[0]!.argv.join(' '),
    argv: plan.commands[0]!.argv,
    cwd: input.candidateRoot,
    processEnv: childEnv(plan.commands[0]!.env),
    timeoutMs: plan.commands[0]!.timeoutMs,
    deadlineAt: plan.deadlineAt,
    maxOutputBytes: plan.commands[0]!.maxOutputBytes!,
    usePty: false,
    agentId: 'agent-candidate-receipts',
    sessionId: `session-${plan.runId}`,
    hostPolicyApproved: true,
    runtimeEnv: runtimeEnv(),
    manager: input.manager,
    traceId: plan.runId,
  });
  const cleanup = await finishCleanup({
    manager: input.manager,
    result: execution,
    candidatePath: input.candidateRoot,
    baseRoot: input.baseRoot,
    deletedWorktrees: 1,
  });
  const cleanupBarrier = syntheticCleanup(authority.root, plan);
  cleanup.cleanupBarrier = cleanupBarrier.cleanup.cleanupBarrier;
  const completed = completeCandidateVerificationEvidence({
    authority,
    bridge,
    prepared,
    execution: {
      observation: execution.observation,
      stdout: execution.stdout,
      stderr: execution.stderr,
      processKey: execution.processKey,
      processPid: execution.processPid,
      managerKey: execution.managerKey,
      approvalRequired: execution.approvalRequired,
      approvedByHost: execution.approvedByHost,
    },
    cleanup,
    cleanupBarrierRoot: cleanupBarrier.cleanupBarrierRoot,
    receiptId: `receipt-${input.runId}`,
  });
  expect(completed.receiptResult.status).toBe('accepted');
  return {
    plan,
    execution,
    receipt: completed.receipt,
    receiptResult: completed.receiptResult.status,
    verdict: completed.verdict.status,
    cleanup,
  };
}

function syntheticObservation(): Observation {
  return {
    schema: 'verseshell.observation/v1',
    id: 'observation-v2',
    op: 'exec.run',
    ok: true,
    status: 'ok',
    data: {
      exit_code: 0,
      timed_out: false,
      stdout: { text: '{"ok":true}' },
      stderr: { text: '' },
    },
    meta: { elapsed_ms: 3, profile: 'generic', token_estimate: 8, capabilities_used: ['shell.exec'] },
  };
}

function syntheticCleanup(root: string, plan: VerificationPlan): { cleanup: Record<string, unknown>; cleanupBarrierRoot: string } {
  const cleanupBarrierRoot = join(root, 'cleanup-barrier');
  const barrier = createVerseGitCleanupBarrier(cleanupBarrierRoot);
  const identity = {
    ownerId: plan.owner,
    epoch: plan.epoch,
    authorizationId: plan.authorizationId,
    baseOid: 'a'.repeat(40),
    refsDigest: `sha256:${sha('refs-synthetic')}`,
  };
  const sealed = barrier.seal({
    runId: plan.runId,
    sessionId: 'session-synthetic',
    bindingId: 'binding-synthetic',
    actor: 'codex',
    expected: identity,
    current: identity,
    references: [],
    evidenceDigests: [`sha256:${sha('evidence-synthetic')}`],
    inventoryBefore: { observed: true, processes: 0, managers: 1, worktrees: 0, tempRoots: 0, survivors: [] },
    resources: [{ kind: 'manager', id: 'manager-synthetic', target: 'session-synthetic', owned: true, preserve: false }],
    deletedKinds: ['manager'],
    stopAccepting: true,
    drain: { ok: true, issues: [] },
  });
  if (!sealed.sealId) throw new Error('synthetic cleanup barrier seal failed');
  const detached = barrier.markDetached({ runId: plan.runId, sealId: sealed.sealId, current: identity, vgDetached: true });
  if (!detached.record) throw new Error('synthetic cleanup barrier detach failed');
  const completed = barrier.complete({
    runId: plan.runId,
    sealId: sealed.sealId,
    inventoryAfter: { observed: true, processes: 0, managers: 0, worktrees: 0, tempRoots: 0, survivors: [] },
  });
  if (!completed.ok || !completed.record) throw new Error('synthetic cleanup barrier completion failed');
  return {
    cleanupBarrierRoot,
    cleanup: {
    schema: VG_VERIFICATION_CLEANUP_SCHEMA,
    status: 'clean',
    processesDeleted: true,
    processSurvivors: 0,
    survivorPids: [],
    managerProcessSurvivors: 0,
    managedAfterShutdown: [],
    worktreesDeleted: 1,
    worktreeSurvivors: 0,
    candidateWorktreeSurvivors: 0,
    verificationRootRemoved: true,
    baseRootPreserved: true,
    tempRootRemoved: true,
    hostWorktreesDeleted: 0,
    deletionErrors: [],
    processInventory: {
      baselinePids: [],
      duringPids: [1234],
      afterPids: [],
      newProcessPids: [1234],
      managedPids: [1234],
      managedAfterShutdown: [],
      survivorPids: [],
      ownedPidChecks: [{ ok: true, pid: 1234, exists: false }],
    },
      cleanupBarrier: cleanupBarrierEvidenceFromRecord(completed.record),
    },
  };
}

function installSyntheticEvidence(root: string, taskCompletion?: VerificationPlan['taskCompletion']) {
  const manifest = { schema: 'test.candidate/v1', inputDigest: 'a'.repeat(64), files: [{ path: 'verify.cjs', sha256: 'a'.repeat(64) }],
    ...(taskCompletion ? { candidateCommitOid: taskCompletion.candidate.source } : {}) };
  const candidateId = sha(stableJson(manifest));
  const authorization = authorizationFor({ runId: 'run-synthetic', candidateId, checkId: 'candidate-full-required-tests' });
  const authorizationDigest = sha(`${stableJson(authorization)}\n`);
  const plan = planFor({ runId: 'run-synthetic', candidateId, candidateInputDigest: manifest.inputDigest, authorizationDigest, taskCompletion });
  const authority = new FileVerseShellReceiptAuthority(root);
  authority.reset();
  const bridge = new VerseGitReceiptBridge(authority);
  const prepared = prepareCandidateVerificationEvidence({ authority, bridge, plan, authorization, candidateManifest: manifest as never });
  const cleanupEvidence = syntheticCleanup(root, plan);
  const completed = completeCandidateVerificationEvidence({
    authority,
    bridge,
    prepared,
    execution: {
      observation: syntheticObservation(),
      stdout: '{"ok":true}',
      stderr: '',
      processKey: 'process-live',
      processPid: 1234,
      managerKey: 'manager-live',
      approvalRequired: true,
      approvedByHost: true,
    },
    cleanup: cleanupEvidence.cleanup,
    cleanupBarrierRoot: cleanupEvidence.cleanupBarrierRoot,
    receiptId: 'receipt-synthetic',
  });
  expect(completed.receiptResult.status).toBe('accepted');
  expect(completed.verdict.status).toBe('observed');
  // A generic successful execution has no Task Ledger task/checkpoint binding.
  // It must not be promoted into an automatic completion check by the reader.
  if (!taskCompletion) expect(readCompletedVerseGitTaskCheck(plan.runId, root)).toBeNull();
  return { authority, bridge, plan, authorization, prepared, manifest, candidateId, completed };
}

describe('candidate receipt v2 host authority', () => {
  it('recomputes a task-bound fixture receipt from disk and rejects artifact tampering after reopening (not live execution evidence)', () => {
    const root = mkdtempSync(join(tempRoot, 'versegit-task-reader-')); roots.push(root);
    const scope = { workspaceId: 'workspace-task', projectId: 'workspace-task', sessionKey: 'agent:main:task', sessionGeneration: 'physical-task' };
    const binding = { taskRef: { owner: 'task-ledger', taskNodeId: 'task-bound', scope }, checkpointId: 'owner-checkpoint', checkpointRevision: 'd'.repeat(64),
      acceptanceSha256: 'e'.repeat(64), candidate: { source: 'f'.repeat(40), inputSha256: 'a'.repeat(64), configSha256: 'b'.repeat(64), dirtyDiffSha256: 'c'.repeat(64) },
      reviewer: { agentId: 'main', runId: 'independent-reviewer', sessionKey: 'agent:main:reviewer' }, expiresAt: Date.now() + 60_000 } as VerificationPlan['taskCompletion'];
    const fixture = installSyntheticEvidence(root, binding);
    const reopened = new FileVerseShellReceiptAuthority(root);
    expect(reopened.readTaskCheck(fixture.plan.runId)).toMatchObject({ receiptId: fixture.completed.receiptId, taskRef: binding!.taskRef,
      ownerRevision: fixture.completed.receiptRef.digest, checkpointRevision: binding!.checkpointRevision, reviewer: binding!.reviewer, status: 'verified' });
    expect(readCompletedVerseGitTaskCheck(fixture.plan.runId, join(root, 'missing-authority'))).toBeNull();
    const artifact = join(root, 'artifacts', fixture.completed.receipt.stdoutDigest);
    writeFileSync(artifact, 'tampered bytes');
    expect(new FileVerseShellReceiptAuthority(root).readTaskCheck(fixture.plan.runId)).toBeNull();
  });
  it('revalidates cached review facts against the same receipt owner on every read', () => {
    const root = mkdtempSync(join(tempRoot, 'versegit-review-cache-')); roots.push(root);
    const installed = installSyntheticEvidence(root);
    const cwd = installed.plan.commands[0].cwd;
    expect(readCompletedVerseGitReviewFacts(installed.plan.runId, cwd)).toMatchObject({ candidateId: installed.candidateId, receiptId: installed.completed.receiptId });
    expect(readCompletedVerseGitReviewFacts(installed.plan.runId, join(root, 'other-workspace'))).toBeNull();
    writeFileSync(join(root, installed.completed.receiptRef.path), '{}');
    expect(readCompletedVerseGitReviewFacts(installed.plan.runId, cwd)).toBeNull();
  });
  it('accepts only a complete v2 binding and rejects each required negative independently', () => {
    const root = mkdtempSync(join(tempRoot, 'versegit-e2-negative-'));
    roots.push(root);
    const installed = installSyntheticEvidence(root);
    const receipt = installed.completed.receipt;

    const noAuthority = new VerseGitReceiptBridge();
    noAuthority.registerPlan(installed.plan);
    expect(noAuthority.receive(installed.plan.runId, receipt)).toMatchObject({
      status: 'rejected_by_policy', reason: 'host_evidence_authority_missing',
    });
    expect(installed.bridge.receive(installed.plan.runId, { ...receipt, receiptId: 'receipt-wrong-candidate', candidateId: 'wrong' })).toMatchObject({ status: 'rejected_by_policy', reason: 'receipt candidateId mismatch' });
    expect(installed.bridge.receive(installed.plan.runId, { ...receipt, receiptId: 'receipt-old-epoch', epoch: 1 })).toMatchObject({ status: 'rejected_by_policy', reason: 'receipt epoch mismatch' });

    const selectedAuthorization = authorizationFor({
      runId: 'run-selected',
      candidateId: installed.candidateId,
      checkId: 'candidate-full-required-tests',
      scope: 'selected',
    });
    const selectedDigest = sha(`${stableJson(selectedAuthorization)}\n`);
    const selectedPlan = planFor({
      runId: 'run-selected',
      candidateId: installed.candidateId,
      candidateInputDigest: installed.manifest.inputDigest,
      authorizationDigest: selectedDigest,
      scope: 'selected',
    });
    const selectedBridge = new VerseGitReceiptBridge(installed.authority);
    selectedBridge.registerPlan(selectedPlan);
    expect(selectedBridge.receive(selectedPlan.runId, {
      ...receipt,
      receiptId: 'receipt-selected',
      planId: selectedPlan.runId,
      planDigest: selectedPlan.planDigest,
      candidateId: selectedPlan.candidateId,
      checkId: selectedPlan.checkId,
      ownerId: selectedPlan.owner,
      epoch: selectedPlan.epoch,
      authorizationId: selectedPlan.authorizationId,
      executionInputDigest: executionInputDigest(selectedPlan),
      requiredScope: 'full',
    })).toMatchObject({
      status: 'rejected_by_policy', reason: 'plan scope is not full',
    });

    const inputPath = join(root, 'inputs', `${sha(installed.plan.candidateId)}.json`);
    const storedInput = readFileSync(inputPath, 'utf8');
    writeFileSync(inputPath, `${storedInput} `, 'utf8');
    const inputDrift = installed.authority.verifyReceipt({ plan: installed.plan, receipt });
    expect(inputDrift.ok).toBe(false);
    expect(inputDrift.issues).toContain('candidate input manifest evidence digest mismatch');
    writeFileSync(inputPath, storedInput, 'utf8');

    const artifactPath = join(root, 'artifacts', receipt.stdoutDigest);
    const storedArtifact = readFileSync(artifactPath, 'utf8');
    writeFileSync(artifactPath, `${storedArtifact} `, 'utf8');
    const tampered = installed.authority.verifyReceipt({ plan: installed.plan, receipt });
    expect(tampered.ok).toBe(false);
    expect(tampered.issues).toEqual(expect.arrayContaining([`receipt artifact digest mismatch: ${receipt.stdoutDigest}`]));
    writeFileSync(artifactPath, storedArtifact, 'utf8');

    expect(installed.authority.verifyReceipt({ plan: installed.plan, receipt }).ok).toBe(true);

    const receiptPath = join(root, 'receipts', `${sha(receipt.receiptId)}.json`);
    const storedReceipt = readFileSync(receiptPath, 'utf8');
    rmSync(receiptPath);
    const missingReceipt = installed.authority.verifyReceipt({ plan: installed.plan, receipt });
    expect(missingReceipt.ok).toBe(false);
    expect(missingReceipt.issues).toContain('host receipt record is missing');
    writeFileSync(receiptPath, storedReceipt, 'utf8');
    expect(installed.authority.verifyReceipt({ plan: installed.plan, receipt }).ok).toBe(true);
  });

  it('rejects a revoked grant that otherwise has coherent receipt evidence', () => {
    const root = mkdtempSync(join(tempRoot, 'versegit-e2-revoked-'));
    roots.push(root);
    const manifest = { schema: 'test.candidate/v1', inputDigest: 'b'.repeat(64), files: [{ path: 'verify.cjs', sha256: 'b'.repeat(64) }] };
    const candidateId = sha(stableJson(manifest));
    const authorization = authorizationFor({ runId: 'run-revoked', candidateId, checkId: 'candidate-full-required-tests', status: 'revoked' });
    const authorizationDigest = sha(`${stableJson(authorization)}\n`);
    const plan = planFor({ runId: 'run-revoked', candidateId, candidateInputDigest: manifest.inputDigest, authorizationDigest });
    const authority = new FileVerseShellReceiptAuthority(root);
    authority.reset();
    const bridge = new VerseGitReceiptBridge(authority);
    const authorizationRef = authority.recordAuthorization(authorization);
    const inputRef = authority.recordCandidateInput(candidateId, manifest);
    const planRef = authority.recordPlan(plan);
    bridge.registerPlan(plan);
    const cleanupEvidence = syntheticCleanup(root, plan);
    const completed = completeCandidateVerificationEvidence({
      authority,
      bridge,
      prepared: { plan, planRef, inputRef, authorizationRef },
      execution: {
        observation: syntheticObservation(),
        stdout: '{"ok":true}', stderr: '', processKey: 'process-revoked', processPid: 1234,
        managerKey: 'manager-revoked', approvalRequired: true, approvedByHost: true,
      },
      cleanup: cleanupEvidence.cleanup,
      cleanupBarrierRoot: cleanupEvidence.cleanupBarrierRoot,
      receiptId: 'receipt-revoked',
    });
    expect(completed.receiptResult.status).toBe('rejected_by_policy');
    expect(completed.receiptResult.issues).toContain('authorization is revoked');
    expect(completed.verdict.realVerseshellExecution).toBe(false);
  });
});

describe.runIf(runRealBinary)('real governed candidate receipts', () => {
  it('preserves a failed receipt before a refreshed candidate continuation passes and cleans every managed process', async () => {
    const baseRoot = makeRepo();
    const mainBefore = {
      head: git(baseRoot, ['rev-parse', 'HEAD']),
      refs: git(baseRoot, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads']),
      status: git(baseRoot, ['status', '--porcelain=v1', '--untracked-files=all']),
    };
    const { service, workers } = makeWorkers(baseRoot);
    writeWorkerChanges(workers, 'v1');
    const failedCandidate = freezeOrchestrationCandidate({
      baseRoot,
      workers,
      expectedBaseOid: mainBefore.head,
      allowedRuntimeIgnorePaths: ['.openclaw/', '.ae/'],
    });
    expect(failedCandidate.status).toBe('frozen');
    if (failedCandidate.status !== 'frozen') return;
    const failedInput = createCandidateInputManifest(failedCandidate.materializedPath, failedCandidate.manifest);
    const evidenceRoot = mkdtempSync(join(tempRoot, 'versegit-e2-evidence-'));
    roots.push(evidenceRoot);
    const failedManager = new VerseShellProcessManager({ resolveBinary: () => ({ path: binaryPath, source: 'verified-bundled', verified: true }) });
    managers.push(failedManager);
    const failedRun = await runCandidate({
      candidateRoot: failedCandidate.materializedPath,
      candidateId: failedInput.candidateId,
      candidateInputDigest: failedInput.manifest.inputDigest,
      candidateManifest: failedInput.manifest,
      runId: 'run-candidate-failure',
      evidenceRoot,
      manager: failedManager,
      baseRoot,
    });
    expect(failedRun.execution.exitCode).not.toBe(0);
    expect(failedRun.receipt.status).toBe('exited');
    expect(failedRun.receiptResult).toBe('accepted');
    expect(failedRun.verdict).toBe('observed');
    expect(failedRun.execution.stdout).toContain('consumer-b-rework');

    writeWorkerChanges(workers, 'v2');
    const repairedCandidate = freezeOrchestrationCandidate({
      baseRoot,
      workers,
      expectedBaseOid: mainBefore.head,
      allowedRuntimeIgnorePaths: ['.openclaw/', '.ae/'],
    });
    expect(repairedCandidate.status).toBe('frozen');
    if (repairedCandidate.status !== 'frozen') return;
    expect(repairedCandidate.manifest.candidateId).not.toBe(failedCandidate.manifest.candidateId);
    const repairedInput = createCandidateInputManifest(repairedCandidate.materializedPath, repairedCandidate.manifest);
    const repairedManager = new VerseShellProcessManager({ resolveBinary: () => ({ path: binaryPath, source: 'verified-bundled', verified: true }) });
    managers.push(repairedManager);
    const repairedRun = await runCandidate({
      candidateRoot: repairedCandidate.materializedPath,
      candidateId: repairedInput.candidateId,
      candidateInputDigest: repairedInput.manifest.inputDigest,
      candidateManifest: repairedInput.manifest,
      runId: 'run-candidate-continuation',
      evidenceRoot,
      manager: repairedManager,
      baseRoot,
    });
    expect(repairedRun.execution.exitCode, JSON.stringify({ stdout: repairedRun.execution.stdout, stderr: repairedRun.execution.stderr, failure: failedRun.execution.stdout })).toBe(0);
    expect(repairedRun.execution.success).toBe(true);
    expect(repairedRun.receiptResult).toBe('accepted');
    expect(repairedRun.verdict).toBe('observed');

    const authority = new FileVerseShellReceiptAuthority(evidenceRoot);
    expect(authority.verifyReceipt({ plan: failedRun.plan, receipt: failedRun.receipt }).ok).toBe(true);
    expect(authority.verifyReceipt({ plan: repairedRun.plan, receipt: repairedRun.receipt }).ok).toBe(true);
    expect(failedRun.receipt.observationDigest).not.toBe(repairedRun.receipt.observationDigest);
    expect(failedRun.cleanup.status).toBe('clean');
    expect(repairedRun.cleanup.status).toBe('clean');

    service.cleanup('worker-a');
    service.cleanup('worker-b');
    expect({
      head: git(baseRoot, ['rev-parse', 'HEAD']),
      refs: git(baseRoot, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads']),
      status: git(baseRoot, ['status', '--porcelain=v1', '--untracked-files=all']),
    }).toEqual(mainBefore);
    expect(git(baseRoot, ['show', 'HEAD:src/consumer-b.cjs'])).toContain('b-v0');
  }, 180_000);
});
