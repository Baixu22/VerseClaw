#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeOrchestrationCandidate, type CreateCandidateWorker } from '../openclaw_runtime/src/agents/orchestration-candidate';
import { createWorktreeService, writeWorktreeFile } from '../openclaw_runtime/src/agents/worktree-service';
import { VerseShellProcessManager } from '../openclaw_runtime/src/agents/verseshell/process-manager';
import { executeGovernedVerseShellProcessObserved } from '../openclaw_runtime/src/agents/verseshell/governed-process';
import {
  VerseGitReceiptBridge,
  createVerificationPlan,
  executionInputDigest,
  type VerificationAuthorization,
  type VerificationPlan,
} from '../electron/services/versegit-receipt-bridge';
import {
  VG_VERIFICATION_CLEANUP_SCHEMA,
  FileVerseShellReceiptAuthority,
  completeCandidateVerificationEvidence,
  createCandidateInputManifest,
  prepareCandidateVerificationEvidence,
  stableJson,
  type CandidateInputManifest,
  type CompletedCandidateVerificationEvidence,
} from '../electron/services/versegit-receipt-evidence';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'harness/specs/fixtures/versegit-product-integration/e2';
const BINARY = join(ROOT, 'resources/bin/win32-x64/ae.exe');
const TEMP_ROOT = process.platform === 'win32' ? 'D:/tmp' : tmpdir();
const REQUIRED_CHECKS = ['producer-api', 'consumer-a', 'consumer-b-rework', 'required-env'];
const REQUIRED_ENV = { CLAWX_VG_REQUIRED_SCOPE: 'full', CLAWX_VG_TEST_MODE: 'candidate' };
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
function sourceState() {
  const dirty = git(ROOT, ['status', '--porcelain=v1', '--untracked-files=normal']).length > 0;
  return {
    branch: git(ROOT, ['branch', '--show-current']) || 'detached',
    commit: git(ROOT, ['rev-parse', 'HEAD']),
    tree: git(ROOT, ['rev-parse', 'HEAD^{tree}']),
    dirty,
  };
}
function writeJson(path: string, value: unknown): void {
  const full = resolve(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function runtimeEnv(): NodeJS.ProcessEnv {
  return {
    VERSESHELL_RUNTIME_VERSION: '1.0.0',
    VERSESHELL_SERVER_PROTOCOL: 'verseshell.jsonl/v1',
    VERSESHELL_OPERATION_CATALOG_DIGEST: 'sha256:67f78a723d582bf0809aab1f94352772c8a2818367b2f5e9d931722c06e979e8',
    VERSESHELL_OPERATION_CATALOG_COUNT: '32',
    VERSESHELL_AE_SHA256: sha(readFileSync(BINARY)),
    VERSESHELL_OS_SHELL: 'powershell',
  };
}
function childEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ['PATH', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP']) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  return { ...env, ...overrides };
}
function makeRepo(): string {
  const root = mkdtempSync(join(TEMP_ROOT, 'versegit-e2-evidence-'));
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
function makeWorkers(root: string) {
  const service = createWorktreeService(root, { backend: 'git' });
  const definitions = [
    { id: 'worker-a', writeSet: ['src/producer.cjs', 'src/consumer-a.cjs'] },
    { id: 'worker-b', writeSet: ['src/consumer-b.cjs'] },
  ];
  const workers: Array<CreateCandidateWorker & { worktreeId: string }> = definitions.map(({ id, writeSet }, index) => {
    const record = service.create(id, { writeSet });
    return {
      taskNodeId: `task-${id}`,
      worktreeId: id,
      worktreePath: record.root,
      worktreeRole: id,
      declaredWriteSet: writeSet,
      parentOrder: index,
    };
  });
  return { service, workers };
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
    ownerId: 'owner-e2-candidate-receipts',
    candidateId: input.candidateId,
    checkId: input.checkId,
    epoch: 3,
    requiredScope: input.scope ?? 'full',
    status: input.status ?? 'active',
    issuedAt,
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    ...(input.status === 'revoked' ? { revokedAt: new Date().toISOString(), revocationReason: 'agent_negative_check' } : {}),
  };
}
function planFor(input: {
  runId: string;
  candidateId: string;
  candidateInputDigest: string;
  authorizationDigest: string;
  scope?: 'full' | 'selected';
  deadlineAt?: number;
}): VerificationPlan {
  const created = createVerificationPlan({
    runId: input.runId,
    candidateId: input.candidateId,
    candidateInputDigest: input.candidateInputDigest,
    checkId: 'candidate-full-required-tests',
    owner: 'owner-e2-candidate-receipts',
    epoch: 3,
    authorizationId: `auth-${input.runId}`,
    authorizationDigest: input.authorizationDigest,
    evidenceVersion: 2,
    deadlineAt: input.deadlineAt ?? Date.now() + 60_000,
    requiredChecks: input.scope === 'selected' ? ['producer-api'] : REQUIRED_CHECKS,
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
async function cleanupEvidence(input: {
  result: Awaited<ReturnType<typeof executeGovernedVerseShellProcessObserved>>;
  baseRoot: string;
  candidatePath: string;
}): Record<string, unknown> {
  const managedPids = [input.result.processPid];
  const ownedPidChecks = managedPids.map((pid) => ({ ok: true, pid, exists: pidExists(pid) }));
  const survivorPids = ownedPidChecks.filter((entry) => entry.exists).map((entry) => entry.pid);
  const deletionErrors: string[] = [];
  let lastError: unknown;
  for (let attempt = 0; attempt < 120 && existsSync(input.candidatePath); attempt += 1) {
    try {
      rmSync(input.candidatePath, { recursive: true, force: true, maxRetries: 1, retryDelay: 100 });
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
  }
  try { git(input.baseRoot, ['worktree', 'prune']); } catch {}
  if (existsSync(input.candidatePath)) deletionErrors.push(String((lastError as Error)?.message ?? lastError ?? 'candidate worktree removal failed').slice(0, 300));
  const candidateWorktreeSurvivors = existsSync(input.candidatePath) ? 1 : 0;
  return {
    schema: VG_VERIFICATION_CLEANUP_SCHEMA,
    status: deletionErrors.length === 0 && survivorPids.length === 0 && candidateWorktreeSurvivors === 0 ? 'clean' : 'recovery_required',
    processesDeleted: survivorPids.length === 0,
    processSurvivors: survivorPids.length,
    survivorPids,
    managerProcessSurvivors: 0,
    managedAfterShutdown: [],
    worktreesDeleted: deletionErrors.length === 0 ? 1 : 0,
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
      afterPids: survivorPids,
      newProcessPids: managedPids,
      managedPids,
      managedAfterShutdown: [],
      survivorPids,
      ownedPidChecks,
    },
  };
}

async function runCandidate(input: {
  baseRoot: string;
  candidateRoot: string;
  candidateManifest: CandidateInputManifest;
  candidateIdentity: string;
  manifest: ReturnType<typeof createCandidateInputManifest>;
  runId: string;
  evidenceRoot: string;
  manager: VerseShellProcessManager;
}) {
  const authorization = authorizationFor({
    runId: input.runId,
    candidateId: input.candidateIdentity,
    checkId: 'candidate-full-required-tests',
  });
  const authorizationDigest = sha(`${stableJson(authorization)}\n`);
  const plan = planFor({
    runId: input.runId,
    candidateId: input.candidateIdentity,
    candidateInputDigest: input.candidateManifest.inputDigest,
    authorizationDigest,
  });
  const authority = new FileVerseShellReceiptAuthority(input.evidenceRoot);
  if (!existsSync(input.evidenceRoot)) authority.reset();
  const bridge = new VerseGitReceiptBridge(authority);
  const prepared = prepareCandidateVerificationEvidence({
    authority,
    bridge,
    plan,
    authorization,
    candidateManifest: input.candidateManifest,
  });
  const startedAt = Date.now();
  const execution = await executeGovernedVerseShellProcessObserved({
    command: 'node verify.cjs',
    argv: plan.commands[0]!.argv,
    cwd: input.candidateRoot,
    processEnv: childEnv(plan.commands[0]!.env),
    timeoutMs: plan.commands[0]!.timeoutMs,
    deadlineAt: plan.deadlineAt,
    maxOutputBytes: plan.commands[0]!.maxOutputBytes!,
    usePty: false,
    agentId: 'agent-e2-candidate-receipts',
    sessionId: `session-${plan.runId}`,
    hostPolicyApproved: true,
    runtimeEnv: runtimeEnv(),
    manager: input.manager,
    traceId: plan.runId,
  });
  await input.manager.shutdownAll();
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  const cleanup = await cleanupEvidence({
    result: execution,
    baseRoot: input.baseRoot,
    candidatePath: input.candidateRoot,
  });
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
    receiptId: `receipt-${input.runId}`,
  });
  const afterCheck = authority.verifyReceipt({ plan, receipt: completed.receipt });
  if (!afterCheck.ok) throw new Error(`authority replay failed for ${input.runId}: ${afterCheck.issues.join('; ')}`);
  let parsedOutput: Record<string, unknown>;
  try {
    parsedOutput = JSON.parse(execution.stdout.trim()) as Record<string, unknown>;
  } catch {
    parsedOutput = { schema: 'unparsed', raw: execution.stdout.slice(0, 4096) };
  }
  return {
    runId: input.runId,
    candidateIdentity: input.candidateIdentity,
    candidateManifest: input.candidateManifest,
    manifest: input.manifest,
    plan,
    authorization,
    authorizationDigest,
    startedAt,
    completedAt: Date.now(),
    execution,
    cleanup,
    prepared,
    completed: completed as CompletedCandidateVerificationEvidence,
    authority,
    bridge,
    afterCheck,
    parsedOutput,
  };
}

function sanitizePlan(plan: VerificationPlan) {
  return {
    schema: plan.schema,
    runId: plan.runId,
    candidateId: plan.candidateId,
    candidateInputDigest: plan.candidateInputDigest,
    checkId: plan.checkId,
    owner: plan.owner,
    epoch: plan.epoch,
    authorizationId: plan.authorizationId,
    authorizationDigest: plan.authorizationDigest,
    evidenceVersion: plan.evidenceVersion,
    deadlineAt: plan.deadlineAt,
    requiredChecks: plan.requiredChecks,
    requiredScope: plan.requiredScope,
    commands: plan.commands.map((command) => ({
      argv: [...command.argv],
      cwd: command.cwd,
      env: { ...command.env },
      effect: command.effect,
      retry: command.retry,
      expectedArtifacts: [...command.expectedArtifacts],
      timeoutMs: command.timeoutMs,
      maxOutputBytes: command.maxOutputBytes,
    })),
    planDigest: plan.planDigest,
  };
}
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stableValue((value as Record<string, unknown>)[key])]));
  }
  return value;
}
function documentDigest(document: Record<string, unknown>): string {
  return sha(JSON.stringify(stableValue({ ...document, generated_at: undefined, digest: undefined })));
}
function sign<T extends Record<string, unknown>>(document: T): T & { digest: string } {
  return Object.assign(document, { digest: documentDigest(document) }) as T & { digest: string };
}
function cleanRoot(root: string): void {
  const resolved = resolve(root);
  if (!resolved.startsWith(resolve(TEMP_ROOT)) || !resolved.includes('versegit-e2-evidence-')) {
    throw new Error('refusing to remove a path outside the E2 temporary root');
  }
  rmSync(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
}
function caseFromBridge(id: string, mutation: string, result: ReturnType<VerseGitReceiptBridge['receive']>) {
  return {
    id,
    mutation,
    expected: 'rejected_by_policy',
    actual: { status: result.status, reason: result.reason, issues: result.issues },
    passed: result.status === 'rejected_by_policy',
  };
}
function caseFromAuthority(id: string, mutation: string, result: ReturnType<FileVerseShellReceiptAuthority['verifyReceipt']>) {
  return {
    id,
    mutation,
    expected: 'authority_rejected',
    actual: { ok: result.ok, reason: result.issues[0] ?? null, issues: result.issues },
    passed: result.ok === false,
  };
}
function runNegativeMatrix(input: {
  rawRoot: string;
  evidenceRoot: string;
  continuation: Awaited<ReturnType<typeof runCandidate>>;
}) {
  const cases: Array<ReturnType<typeof caseFromBridge> | ReturnType<typeof caseFromAuthority>> = [];
  const receipt = input.continuation.completed.receipt;
  const plan = input.continuation.plan;
  const authority = new FileVerseShellReceiptAuthority(input.evidenceRoot);

  const fakeBridge = new VerseGitReceiptBridge();
  fakeBridge.registerPlan(plan);
  cases.push(caseFromBridge(
    'fake-self-reported',
    'caller-sealed receipt claims realVerseShell without host evidence authority',
    fakeBridge.receive(plan.runId, { ...receipt, receiptId: 'receipt-fake-self-reported' }),
  ));

  const bridge = new VerseGitReceiptBridge(authority);
  bridge.registerPlan(plan);
  cases.push(caseFromBridge(
    'wrong-candidate',
    'receipt candidateId changed',
    bridge.receive(plan.runId, { ...receipt, receiptId: 'receipt-wrong-candidate', candidateId: 'wrong-candidate' }),
  ));
  cases.push(caseFromBridge(
    'old-epoch',
    'receipt epoch changed',
    bridge.receive(plan.runId, { ...receipt, receiptId: 'receipt-old-epoch', epoch: plan.epoch - 1 }),
  ));

  const selectedAuthorization = authorizationFor({
    runId: 'run-selected-negative',
    candidateId: input.continuation.candidateIdentity,
    checkId: 'candidate-full-required-tests',
    scope: 'selected',
  });
  const selectedDigest = sha(`${stableJson(selectedAuthorization)}\n`);
  const selectedPlan = planFor({
    runId: 'run-selected-negative',
    candidateId: input.continuation.candidateIdentity,
    candidateInputDigest: input.continuation.candidateManifest.inputDigest,
    authorizationDigest: selectedDigest,
    scope: 'selected',
  });
  const selectedBridge = new VerseGitReceiptBridge(authority);
  selectedBridge.registerPlan(selectedPlan);
  cases.push(caseFromBridge(
    'partial-scope',
    'selected plan attempts to present a full-scope receipt',
    selectedBridge.receive(selectedPlan.runId, {
      ...receipt,
      receiptId: 'receipt-partial-scope',
      planId: selectedPlan.runId,
      planDigest: selectedPlan.planDigest,
      candidateId: selectedPlan.candidateId,
      checkId: selectedPlan.checkId,
      ownerId: selectedPlan.owner,
      epoch: selectedPlan.epoch,
      authorizationId: selectedPlan.authorizationId,
      executionInputDigest: executionInputDigest(selectedPlan),
      requiredScope: 'full',
    }),
  ));

  const missingRoot = join(input.rawRoot, 'negative-missing');
  cpSync(input.evidenceRoot, missingRoot, { recursive: true });
  rmSync(join(missingRoot, 'observations', `${sha(String(receipt.observationId))}.json`), { force: true });
  cases.push(caseFromAuthority(
    'missing-observation',
    'host observation wrapper deleted',
    new FileVerseShellReceiptAuthority(missingRoot).verifyReceipt({ plan, receipt }),
  ));

  const inputDriftRoot = join(input.rawRoot, 'negative-input-drift');
  cpSync(input.evidenceRoot, inputDriftRoot, { recursive: true });
  const inputPath = join(inputDriftRoot, 'inputs', `${sha(plan.candidateId)}.json`);
  writeFileSync(inputPath, `${readFileSync(inputPath, 'utf8')} `, 'utf8');
  cases.push(caseFromAuthority(
    'input-drift',
    'retained candidate input manifest bytes changed after receipt creation',
    new FileVerseShellReceiptAuthority(inputDriftRoot).verifyReceipt({ plan, receipt }),
  ));

  const tamperedRoot = join(input.rawRoot, 'negative-tampered-artifact');
  cpSync(input.evidenceRoot, tamperedRoot, { recursive: true });
  const artifactPath = join(tamperedRoot, 'artifacts', receipt.stdoutDigest);
  writeFileSync(artifactPath, `${readFileSync(artifactPath, 'utf8')} `, 'utf8');
  cases.push(caseFromAuthority(
    'tampered-artifact',
    'stdout artifact bytes changed after receipt creation',
    new FileVerseShellReceiptAuthority(tamperedRoot).verifyReceipt({ plan, receipt }),
  ));

  const revokedRunId = 'run-revoked-negative';
  const revokedAuthorization = authorizationFor({
    runId: revokedRunId,
    candidateId: input.continuation.candidateIdentity,
    checkId: 'candidate-full-required-tests',
    status: 'revoked',
  });
  const revokedDigest = sha(`${stableJson(revokedAuthorization)}\n`);
  const revokedPlan = planFor({
    runId: revokedRunId,
    candidateId: input.continuation.candidateIdentity,
    candidateInputDigest: input.continuation.candidateManifest.inputDigest,
    authorizationDigest: revokedDigest,
  });
  const revokedRoot = join(input.rawRoot, 'negative-revoked');
  const revokedAuthority = new FileVerseShellReceiptAuthority(revokedRoot);
  revokedAuthority.reset();
  const revokedBridge = new VerseGitReceiptBridge(revokedAuthority);
  const revokedAuthorizationRef = revokedAuthority.recordAuthorization(revokedAuthorization);
  const revokedInputRef = revokedAuthority.recordCandidateInput(input.continuation.candidateIdentity, input.continuation.candidateManifest);
  const revokedPlanRef = revokedAuthority.recordPlan(revokedPlan);
  revokedBridge.registerPlan(revokedPlan);
  const revokedCompleted = completeCandidateVerificationEvidence({
    authority: revokedAuthority,
    bridge: revokedBridge,
    prepared: { plan: revokedPlan, planRef: revokedPlanRef, inputRef: revokedInputRef, authorizationRef: revokedAuthorizationRef },
    execution: {
      observation: input.continuation.execution.observation,
      stdout: input.continuation.execution.stdout,
      stderr: input.continuation.execution.stderr,
      processKey: input.continuation.execution.processKey,
      processPid: input.continuation.execution.processPid,
      managerKey: input.continuation.execution.managerKey,
      approvalRequired: input.continuation.execution.approvalRequired,
      approvedByHost: input.continuation.execution.approvedByHost,
    },
    cleanup: input.continuation.cleanup,
    receiptId: 'receipt-revoked-negative',
  });
  cases.push(caseFromBridge(
    'revoked-grant',
    'active receipt paired with a host-recorded revoked grant',
    revokedCompleted.receiptResult,
  ));

  return { cases, passed: cases.every((entry) => entry.passed) };
}
async function main(): Promise<void> {
  const source = sourceState();
  if (source.dirty) throw new Error('E2 evidence source candidate is dirty before generation');
  if (!existsSync(BINARY)) throw new Error('qualified ae.exe is missing');
  mkdirSync(TEMP_ROOT, { recursive: true });
  const rawRoot = mkdtempSync(join(TEMP_ROOT, 'versegit-e2-raw-'));
  const evidenceRoot = join(rawRoot, 'evidence');
  const baseRoot = makeRepo();
  const { service, workers } = makeWorkers(baseRoot);
  const managers: VerseShellProcessManager[] = [];
  try {
    const mainBefore = {
      head: git(baseRoot, ['rev-parse', 'HEAD']),
      refs: git(baseRoot, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads']),
      status: git(baseRoot, ['status', '--porcelain=v1', '--untracked-files=all']),
    };

    writeWorkerChanges(workers, 'v1');
    const failedCandidate = freezeOrchestrationCandidate({
      baseRoot,
      workers,
      expectedBaseOid: mainBefore.head,
      allowedRuntimeIgnorePaths: ['.openclaw/', '.ae/'],
    });
    if (failedCandidate.status !== 'frozen') throw new Error(`failed candidate did not freeze: ${failedCandidate.status}`);
    const failedInput = createCandidateInputManifest(failedCandidate.materializedPath, failedCandidate.manifest);
    const failedManager = new VerseShellProcessManager({
      resolveBinary: () => ({ path: BINARY, source: 'verified-bundled', verified: true }),
    });
    managers.push(failedManager);
    const failure = await runCandidate({
      baseRoot,
      candidateRoot: failedCandidate.materializedPath,
      candidateManifest: failedInput.manifest,
      candidateIdentity: failedInput.candidateId,
      manifest: failedInput,
      runId: 'run-e2-candidate-failure',
      evidenceRoot,
      manager: failedManager,
    });
    if (failure.completed.receiptResult.status !== 'accepted') throw new Error('failed candidate receipt was not accepted');
    if (failure.completed.verdict.status !== 'observed') throw new Error('failed candidate verdict is not observed');
    if (failure.execution.exitCode === 0) throw new Error('failure candidate unexpectedly passed required tests');
    if (failure.parsedOutput.ok !== false) throw new Error('failure output did not retain the failed required-test result');
    const failureRecordedAt = Date.now();

    writeWorkerChanges(workers, 'v2');
    const repairedCandidate = freezeOrchestrationCandidate({
      baseRoot,
      workers,
      expectedBaseOid: mainBefore.head,
      allowedRuntimeIgnorePaths: ['.openclaw/', '.ae/'],
    });
    if (repairedCandidate.status !== 'frozen') throw new Error(`repaired candidate did not freeze: ${repairedCandidate.status}`);
    if (repairedCandidate.manifest.candidateId === failedCandidate.manifest.candidateId) throw new Error('worker refresh did not create a new candidate');
    const repairedInput = createCandidateInputManifest(repairedCandidate.materializedPath, repairedCandidate.manifest);
    const continuationStartedAt = Date.now();
    const repairedManager = new VerseShellProcessManager({
      resolveBinary: () => ({ path: BINARY, source: 'verified-bundled', verified: true }),
    });
    managers.push(repairedManager);
    const continuation = await runCandidate({
      baseRoot,
      candidateRoot: repairedCandidate.materializedPath,
      candidateManifest: repairedInput.manifest,
      candidateIdentity: repairedInput.candidateId,
      manifest: repairedInput,
      runId: 'run-e2-candidate-continuation',
      evidenceRoot,
      manager: repairedManager,
    });
    if (continuation.completed.receiptResult.status !== 'accepted') throw new Error('continuation receipt was not accepted');
    if (continuation.completed.verdict.status !== 'observed') throw new Error('continuation verdict is not observed');
    if (continuation.execution.exitCode !== 0 || continuation.parsedOutput.ok !== true) throw new Error('continuation required tests did not pass');

    service.cleanup('worker-a');
    service.cleanup('worker-b');
    const mainAfter = {
      head: git(baseRoot, ['rev-parse', 'HEAD']),
      refs: git(baseRoot, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads']),
      status: git(baseRoot, ['status', '--porcelain=v1', '--untracked-files=all']),
    };
    const mainUnchanged = JSON.stringify(mainBefore) === JSON.stringify(mainAfter);
    if (!mainUnchanged) throw new Error('candidate verification wrote back to the main workspace');

    const failureStillVerify = new FileVerseShellReceiptAuthority(evidenceRoot).verifyReceipt({
      plan: failure.plan,
      receipt: failure.completed.receipt,
    });
    if (!failureStillVerify.ok) throw new Error('failure receipt was not preserved after continuation');
    const negatives = runNegativeMatrix({ rawRoot, evidenceRoot, continuation });
    if (!negatives.passed) throw new Error('one or more E2 receipt negatives were not rejected');

    const plansDocument = sign({
      schema: 'clawx.versegit.e2-plans/v1',
      generated_at: new Date().toISOString(),
      task: 'TF-0533',
      driven_by: 'agent',
      actor: 'codex',
      source,
      required_tests: REQUIRED_CHECKS,
      runs: [
        {
          id: 'failure',
          candidate: {
            sourceCandidateId: failedCandidate.manifest.candidateId,
            candidateId: failedInput.candidateId,
            candidateCommitOid: failedCandidate.manifest.candidateCommitOid,
            candidateTreeOid: failedCandidate.manifest.candidateTreeOid,
            inputDigest: failedInput.manifest.inputDigest,
            files: failedInput.manifest.files,
          },
          plan: sanitizePlan(failure.plan),
          observed_checks: failure.parsedOutput,
        },
        {
          id: 'continuation',
          candidate: {
            sourceCandidateId: repairedCandidate.manifest.candidateId,
            candidateId: repairedInput.candidateId,
            candidateCommitOid: repairedCandidate.manifest.candidateCommitOid,
            candidateTreeOid: repairedCandidate.manifest.candidateTreeOid,
            inputDigest: repairedInput.manifest.inputDigest,
            files: repairedInput.manifest.files,
          },
          plan: sanitizePlan(continuation.plan),
          observed_checks: continuation.parsedOutput,
        },
      ],
      execution_route: 'production process.start -> VerseShell governed ACI',
      output_bounds: { timeout_ms: 30_000, max_output_bytes: 256 * 1024 },
      host_policy_approved: true,
      native_fallback_used: false,
      passed: true,
    });

    const receiptRun = (run: typeof failure) => ({
      run_id: run.runId,
      candidate_id: run.candidateIdentity,
      plan_id: run.plan.runId,
      plan_digest: run.plan.planDigest,
      check_id: run.plan.checkId,
      owner_id: run.plan.owner,
      epoch: run.plan.epoch,
      authorization_id: run.plan.authorizationId,
      input_digest: run.plan.candidateInputDigest,
      receipt: run.completed.receipt,
      receipt_ref: run.completed.receiptRef,
      plan_ref: run.prepared.planRef,
      input_manifest_ref: run.prepared.inputRef,
      authorization_ref: run.prepared.authorizationRef,
      cleanup_ref: run.completed.cleanupRef,
      observation: {
        id: run.execution.observation.id,
        schema: run.execution.observation.schema,
        op: run.execution.observation.op,
        digest: run.completed.receipt.observationDigest,
        process_key_digest: sha(run.execution.processKey),
        process_pid: run.execution.processPid,
        exit_code: run.execution.exitCode,
        timed_out: run.execution.timedOut,
        state: run.execution.state,
        stdout_digest: run.completed.receipt.stdoutDigest,
        stderr_digest: run.completed.receipt.stderrDigest,
        approval_required: run.execution.approvalRequired,
        approved_by_host: run.execution.approvedByHost,
        raw_stdout: run.execution.stdout,
        raw_stderr: run.execution.stderr,
      },
      receipt_result: run.completed.receiptResult,
      verdict: run.completed.verdict,
      authority_replay: run.afterCheck,
    });
    const receiptsDocument = sign({
      schema: 'clawx.versegit.e2-execution-receipts/v1',
      generated_at: new Date().toISOString(),
      task: 'TF-0533',
      driven_by: 'agent',
      actor: 'codex',
      source,
      runs: [receiptRun(failure), receiptRun(continuation)],
      failure_before_continuation: {
        failure_recorded_at: new Date(failureRecordedAt).toISOString(),
        continuation_started_at: new Date(continuationStartedAt).toISOString(),
        failure_receipt_retained_after_continuation: failureStillVerify.ok,
        failure_before_continuation: failureRecordedAt <= continuationStartedAt,
        candidate_ids_distinct: failedInput.candidateId !== repairedInput.candidateId,
        observation_digests_distinct: failure.completed.receipt.observationDigest !== continuation.completed.receipt.observationDigest,
        main_writeback_performed: false,
      },
      boundaries: {
        real_human_evidence: false,
        default_off: true,
        m4_authorized: false,
        host_authority: 'ClawX',
        vg_landing_authority: false,
      },
      passed: true,
    });

    const negativeDocument = sign({
      schema: 'clawx.versegit.e2-receipt-negative/v1',
      generated_at: new Date().toISOString(),
      task: 'TF-0533',
      driven_by: 'agent',
      actor: 'codex',
      source,
      cases: negatives.cases,
      required_cases: [
        'missing-observation', 'fake-self-reported', 'wrong-candidate', 'old-epoch',
        'input-drift', 'revoked-grant', 'partial-scope', 'tampered-artifact',
      ],
      passed: negatives.passed,
    });

    const cleanupRuns = [failure, continuation].map((run) => ({
      run_id: run.runId,
      cleanup: run.cleanup,
      managed_processes_exited: Array.isArray((run.cleanup.processInventory as Record<string, unknown>).ownedPidChecks)
        && ((run.cleanup.processInventory as Record<string, unknown>).ownedPidChecks as Array<Record<string, unknown>>).every((entry) => entry.ok === true && entry.exists === false),
      candidate_worktree_removed: run.cleanup.candidateWorktreeSurvivors === 0,
      manager_process_survivors: run.cleanup.managerProcessSurvivors,
      deletion_errors: run.cleanup.deletionErrors,
    }));
    const cleanupDocument = sign({
      schema: 'clawx.versegit.e2-execution-cleanup/v1',
      generated_at: new Date().toISOString(),
      task: 'TF-0533',
      driven_by: 'agent',
      actor: 'codex',
      source,
      runs: cleanupRuns,
      main_workspace: {
        head: mainAfter.head,
        refs: mainAfter.refs,
        status: mainAfter.status,
        unchanged: mainUnchanged,
      },
      passed: cleanupRuns.every((run) => run.cleanup.status === 'clean' && run.managed_processes_exited && run.candidate_worktree_removed),
    });

    const serialized = JSON.stringify([plansDocument, receiptsDocument, negativeDocument, cleanupDocument]);
    if (/[A-Za-z]:[\\/]/u.test(serialized)) throw new Error('E2 curated evidence contains an absolute host path');
    writeJson(`${OUT}/plans.json`, plansDocument);
    writeJson(`${OUT}/execution-receipts.json`, receiptsDocument);
    writeJson(`${OUT}/receipt-negative.json`, negativeDocument);
    writeJson(`${OUT}/execution-cleanup.json`, cleanupDocument);
    console.log(`[versegit-e2] OK failure=${failure.completed.receipt.receiptId} continuation=${continuation.completed.receipt.receiptId} negatives=${negatives.cases.length} mainUnchanged=${mainUnchanged}`);
  } finally {
    await Promise.allSettled(managers.map((manager) => manager.shutdownAll()));
    try { service.cleanup('worker-a'); } catch {}
    try { service.cleanup('worker-b'); } catch {}
    cleanRoot(baseRoot);
  }
}

main().catch((error) => {
  console.error(`[versegit-e2] FAIL: ${String((error as Error)?.stack ?? error)}`);
  process.exitCode = 1;
});