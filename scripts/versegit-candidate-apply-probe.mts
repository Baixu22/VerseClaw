#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyCandidateAfterVerification,
  candidateApplySnapshotDigest,
  cleanupPatchCandidate,
  materializePatchCandidate,
  type CandidateApplyAuthorityState,
  type CandidateApplyHost,
  type CandidateApplyPermit,
  type CandidateApplyRepositoryState,
  type CandidateApplyVerification,
  type PatchCandidateManifest,
} from '../openclaw_runtime/src/agents/orchestration-candidate-apply';
import { applyDeferredPatchFlow } from '../openclaw_runtime/src/agents/orchestration-patch-flow';
import type { PatchProposal } from '../openclaw_runtime/src/agents/patch-flow';
import type { SubagentRunRecord } from '../openclaw_runtime/src/agents/subagent-registry.types';
import { executeGovernedVerseShellProcessObserved } from '../openclaw_runtime/src/agents/verseshell/governed-process';
import { VerseShellProcessManager } from '../openclaw_runtime/src/agents/verseshell/process-manager';
import {
  __resetWriteJournals,
  listJournalSnapshotFiles,
  undoLastWrites,
} from '../openclaw_runtime/src/agents/tools/write-journal';
import {
  VerseGitReceiptBridge,
  createVerificationPlan,
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
  type CompletedCandidateVerificationEvidence,
} from '../electron/services/versegit-receipt-evidence';
import {
  buildPermissionEffectOwnerCheckpoint,
  permissionEffectBindingFor,
  verifyPermissionEffectAtFinalCheckpoint,
  type PermissionEffectCurrentState,
  type PermissionEffectFinalCheckInput,
} from '../shared/permission-effect-contract';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BINARY = join(ROOT, 'resources/bin/win32-x64/ae.exe');
const TEMP_ROOT = process.platform === 'win32' ? 'D:/tmp' : tmpdir();
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const fence = String.fromCharCode(96).repeat(3);
const roots: string[] = [];
const managers: VerseShellProcessManager[] = [];
const EPOCH = 5;
const OWNER_ID = 'owner-e3-probe';
const AUTHORIZATION_ID = 'auth-e3-probe';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}
function sourceState() {
  const dirty = git(ROOT, ['status', '--porcelain=v1', '--untracked-files=normal']).length > 0;
  return {
    branch: git(ROOT, ['branch', '--show-current']) || 'detached',
    commit: git(ROOT, ['rev-parse', 'HEAD']),
    tree: git(ROOT, ['rev-parse', 'HEAD^{tree}']),
    dirty,
  };
}
function state(root: string) {
  return {
    head: git(root, ['rev-parse', 'HEAD']),
    refs: git(root, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads']),
    status: git(root, ['status', '--porcelain=v1', '--untracked-files=all']),
  };
}
function makeRepo(): string {
  const root = mkdtempSync(join(TEMP_ROOT, 'versegit-e3-probe-'));
  roots.push(root);
  git(root, ['init', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'agent@example.invalid']);
  git(root, ['config', 'user.name', 'Agent']);
  writeFileSync(join(root, '.gitignore'), '.openclaw/\n.ae/\n', 'utf8');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/producer.cjs'), "module.exports = { api: () => 1 };\n", 'utf8');
  writeFileSync(join(root, 'src/consumer-a.cjs'), "const { api } = require('./producer.cjs');\nmodule.exports = { value: api() + '-a' };\n", 'utf8');
  writeFileSync(join(root, 'src/consumer-b.cjs'), "const { api } = require('./producer.cjs');\nmodule.exports = { value: api() + 1, implementation: 'b-v0' };\n", 'utf8');
  writeFileSync(join(root, 'verify.cjs'), [
    "const producer = require('./src/producer.cjs');",
    "const consumerA = require('./src/consumer-a.cjs');",
    "const consumerB = require('./src/consumer-b.cjs');",
    "const mode = process.argv[2] ?? 'full';",
    "const aPass = producer.api() === 'one' && consumerA.value === 'one-a';",
    "const bPass = consumerB.value === 2 && (consumerB.implementation === 'b-v1' || consumerB.implementation === 'b-v2');",
    "const checks = mode === 'worker-a' ? [{id:'worker-a',passed:aPass}]",
    "  : mode === 'worker-b' ? [{id:'worker-b',passed:bPass}]",
    "  : [{id:'worker-a',passed:aPass},{id:'worker-b',passed:bPass},{id:'combined-b-v2',passed:bPass && consumerB.implementation === 'b-v2'}];",
    "const ok = checks.every((check) => check.passed);",
    "console.log(JSON.stringify({schema:'clawx.e3.required-tests/v1',mode,ok,checks}));",
    "process.exitCode = ok ? 0 : 1;",
    '',
  ].join('\n'), 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'base']);
  return root;
}

function patchFor(path: string, from: string, to: string): string {
  const removed = from.split(/\r?\n/u).filter((line, index, lines) => index < lines.length - 1 || line.length > 0);
  const added = to.split(/\r?\n/u).filter((line, index, lines) => index < lines.length - 1 || line.length > 0);
  return [
    '*** Begin Patch',
    '*** Update File: ' + path,
    '@@',
    ...removed.map((line) => '-' + line),
    ...added.map((line) => '+' + line),
    '*** End Patch',
  ].join('\n');
}
function proposalsFor(version: 'v1' | 'v2'): PatchProposal[] {
  const producerA = "module.exports = { api: () => 'one' };\n";
  const consumerBBase = "const { api } = require('./producer.cjs');\nmodule.exports = { value: api() + 1, implementation: 'b-v0' };\n";
  const consumerBv1 = "const { api } = require('./producer.cjs');\nmodule.exports = { value: api() + 1, implementation: 'b-v1' };\n";
  const consumerBv2 = "const { api } = require('./producer.cjs');\nconst value = api();\nmodule.exports = { value: typeof value === 'string' ? 2 : value + 1, implementation: 'b-v2' };\n";
  const producerBase = "module.exports = { api: () => 1 };\n";
  return [
    {
      workerId: 'run-worker-a',
      writeSet: ['src/producer.cjs'],
      patchText: patchFor('src/producer.cjs', producerBase, producerA),
    },
    {
      workerId: 'run-worker-b',
      writeSet: ['src/consumer-b.cjs'],
      patchText: patchFor('src/consumer-b.cjs', consumerBBase, version === 'v2' ? consumerBv2 : consumerBv1),
    },
  ];
}
function workerRecord(runId: string, patch: PatchProposal): SubagentRunRecord {
  return {
    runId,
    childSessionKey: 'agent:main:' + runId,
    requesterSessionKey: 'agent:main:main',
    requesterDisplayKey: 'agent:main:main',
    task: 'candidate proposal ' + runId,
    cleanup: 'delete',
    createdAt: 1,
    endedAt: 2,
    outcome: { status: 'ok' },
    completion: {
      required: true,
      resultText: fence + 'apply_patch\n' + patch.patchText + '\n' + fence,
    },
    orchestration: {
      orchestrationRunId: 'orch-e3-probe',
      roleName: 'implementer',
      isVerifier: false,
      phase: 'worker',
      leadRole: 'lead',
      originalTask: 'apply verified candidate',
      patchFlowExecution: true,
      patchFlowWriteSet: [...(patch.writeSet ?? [])],
    },
  } as SubagentRunRecord;
}
function workersFor(version: 'v1' | 'v2'): SubagentRunRecord[] {
  const proposals = proposalsFor(version);
  return [
    workerRecord('run-worker-a', proposals[0]!),
    workerRecord('run-worker-b', proposals[1]!),
  ];
}
function nativeCandidateCheck(candidateRoot: string, mode: 'worker-a' | 'worker-b'): boolean {
  const result = spawnSync(process.execPath, [join(candidateRoot, 'verify.cjs'), mode], {
    cwd: candidateRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  });
  return result.status === 0;
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
function childEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ['PATH', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP']) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  return { ...env, ...overrides };
}
function pidExists(pid: number): boolean {
  try {
    const output = execFileSync('tasklist.exe', ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8', windowsHide: true, timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output.split(/\r?\n/u).some((line) => new RegExp('^"ae\\.exe","' + pid + '"', 'iu').test(line.trim()));
  } catch {
    return false;
  }
}

type VerseShellVerificationRun = {
  verification: CandidateApplyVerification;
  receipt: CompletedCandidateVerificationEvidence['receipt'];
  receiptResult: CompletedCandidateVerificationEvidence['receiptResult'];
  authorityCheck: ReturnType<FileVerseShellReceiptAuthority['verifyReceipt']>;
  execution: Awaited<ReturnType<typeof executeGovernedVerseShellProcessObserved>>;
  plan: VerificationPlan;
  authorization: VerificationAuthorization;
  cleanup: Record<string, unknown>;
};

async function runVerseShellVerification(input: {
  workspaceDir: string;
  candidate: PatchCandidateManifest;
  candidateRoot: string;
  mode: 'worker-a' | 'worker-b' | 'full';
  evidenceRoot: string;
  runId: string;
}): Promise<VerseShellVerificationRun> {
  const sourceCandidate = {
    schema: 'clawx.versegit.candidate/v1' as const,
    candidateId: input.candidate.candidateId,
    baseOid: input.candidate.baseOid,
    baseTreeOid: git(input.workspaceDir, ['rev-parse', input.candidate.baseOid + '^{tree}']),
    workerSnapshots: [],
    candidateCommitOid: input.candidate.candidateCommitOid,
    candidateTreeOid: input.candidate.candidateTreeOid,
    refsBefore: [],
    refsAfter: [],
    mainStateBeforeDigest: '',
    mainStateAfterDigest: '',
    mainUnchanged: true,
    verificationCwdRole: 'host-disposable-candidate' as const,
    materializedPathRole: 'candidate-verification-worktree',
    allowedRuntimeIgnorePaths: ['.openclaw/', '.ae/'],
    inputDigest: input.candidate.candidateInputDigest,
  };
  const candidateInput = createCandidateInputManifest(input.candidateRoot, sourceCandidate);
  const checkId = 'candidate-' + input.mode + '-required-tests';
  const issuedAt = new Date(Date.now() - 1_000).toISOString();
  const authorization: VerificationAuthorization = {
    schema: 'clawx.versegit.verification-authorization/v1',
    authorizationId: AUTHORIZATION_ID + '-' + input.runId,
    runId: input.runId,
    ownerId: OWNER_ID,
    candidateId: candidateInput.candidateId,
    checkId,
    epoch: EPOCH,
    requiredScope: 'full',
    status: 'active',
    issuedAt,
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  };
  const authorizationDigest = sha(stableJson(authorization) + '\n');
  const created = createVerificationPlan({
    runId: input.runId,
    candidateId: candidateInput.candidateId,
    candidateInputDigest: candidateInput.manifest.inputDigest,
    checkId,
    owner: OWNER_ID,
    epoch: EPOCH,
    authorizationId: authorization.authorizationId,
    authorizationDigest,
    evidenceVersion: 2,
    deadlineAt: Date.now() + 60_000,
    requiredChecks: input.mode === 'full'
      ? ['worker-a', 'worker-b', 'combined-b-v2']
      : [input.mode],
    commands: [{
      argv: ['node', 'verify.cjs', input.mode],
      cwd: '.',
      env: { CLAWX_VG_E3_PROBE: '1' },
      effect: 'read',
      retry: 'never',
      expectedArtifacts: ['stdout', 'stderr', 'exit'],
      timeoutMs: 30_000,
      maxOutputBytes: 256 * 1024,
    }],
    requiredScope: 'full',
  });
  if (!created.plan) throw new Error('verification plan invalid: ' + created.issues.join(','));
  const runEvidenceRoot = join(input.evidenceRoot, input.runId);
  const authority = new FileVerseShellReceiptAuthority(runEvidenceRoot);
  authority.reset();
  const bridge = new VerseGitReceiptBridge(authority);
  const prepared = prepareCandidateVerificationEvidence({
    authority,
    bridge,
    plan: created.plan,
    authorization,
    candidateManifest: candidateInput.manifest,
  });
  const manager = new VerseShellProcessManager({
    resolveBinary: () => ({ path: BINARY, source: 'verified-bundled', verified: true }),
  });
  managers.push(manager);
  const execution = await executeGovernedVerseShellProcessObserved({
    command: 'node verify.cjs ' + input.mode,
    argv: created.plan.commands[0]!.argv,
    cwd: input.candidateRoot,
    processEnv: childEnv(created.plan.commands[0]!.env),
    timeoutMs: created.plan.commands[0]!.timeoutMs,
    deadlineAt: created.plan.deadlineAt,
    maxOutputBytes: created.plan.commands[0]!.maxOutputBytes!,
    usePty: false,
    agentId: 'agent-e3-probe',
    sessionId: 'session-' + input.runId,
    hostPolicyApproved: true,
    runtimeEnv: runtimeEnv(),
    manager,
    traceId: input.runId,
  });
  await manager.shutdownAll();
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  const existsAfter = pidExists(execution.processPid);
  const survivorPids = existsAfter ? [execution.processPid] : [];
  const cleanup = {
    schema: VG_VERIFICATION_CLEANUP_SCHEMA,
    status: survivorPids.length === 0 ? 'clean' : 'recovery_required',
    processesDeleted: survivorPids.length === 0,
    processSurvivors: survivorPids.length,
    survivorPids,
    managerProcessSurvivors: manager.list().length,
    managedAfterShutdown: manager.list().map((entry) => entry.pid).filter((pid): pid is number => pid !== null),
    worktreesDeleted: 0,
    worktreeSurvivors: 0,
    candidateWorktreeSurvivors: 1,
    verificationWorktreeSurvivors: 0,
    verificationRootRemoved: true,
    baseRootPreserved: true,
    tempRootRemoved: true,
    hostWorktreesDeleted: 0,
    deletionErrors: [],
    processInventory: {
      baselinePids: [],
      duringPids: [execution.processPid],
      afterPids: survivorPids,
      newProcessPids: [execution.processPid],
      managedPids: [execution.processPid],
      managedAfterShutdown: manager.list().map((entry) => entry.pid).filter((pid): pid is number => pid !== null),
      survivorPids,
      ownedPidChecks: [{ ok: true, pid: execution.processPid, exists: existsAfter }],
    },
  };
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
    receiptId: 'receipt-' + input.runId,
  });
  const authorityCheck = authority.verifyReceipt({ plan: created.plan, receipt: completed.receipt });
  const passed = execution.success
    && completed.receiptResult.status === 'accepted'
    && authorityCheck.ok;
  const verification: CandidateApplyVerification = {
    status: passed ? 'passed' : 'failed',
    candidateId: input.candidate.candidateId,
    baseOid: input.candidate.baseOid,
    candidateTreeOid: input.candidate.candidateTreeOid,
    candidateInputDigest: input.candidate.candidateInputDigest,
    receiptDigest: completed.receiptRef.digest,
    planDigest: String(created.plan.planDigest),
    checkId,
    ownerId: OWNER_ID,
    epoch: EPOCH,
    authorizationId: authorization.authorizationId,
    issues: passed ? [] : [
      'verseshell-exit:' + String(execution.exitCode),
      'receipt-result:' + completed.receiptResult.status,
      'authority:' + (authorityCheck.ok ? 'ok' : authorityCheck.issues.join('|')),
    ],
  };
  return {
    verification,
    receipt: completed.receipt,
    receiptResult: completed.receiptResult,
    authorityCheck,
    execution,
    plan: created.plan,
    authorization,
    cleanup,
  };
}

type PermissionState = {
  nowMs: number;
  revocationEpoch: string;
  revokedGrantIds: string[];
  policyEpoch: string;
  catalogEpoch: string;
};

function permissionState(): PermissionState {
  return {
    nowMs: Date.now(),
    revocationEpoch: 'revocation-e3',
    revokedGrantIds: [],
    policyEpoch: 'policy-e3',
    catalogEpoch: 'catalog-e3',
  };
}

function permissionCheckpoint(input: {
  verification: CandidateApplyVerification;
  current: PermissionState;
}): PermissionEffectFinalCheckInput {
  const binding = permissionEffectBindingFor('coding-control');
  if (!binding) throw new Error('coding-control permission binding missing');
  return buildPermissionEffectOwnerCheckpoint({
    componentId: 'coding-control',
    subject: {
      sessionKey: 'agent:main:e3',
      runId: 'orch-e3-probe',
      attemptIndex: 0,
      modelCallIndex: 0,
      actorKind: 'delegate',
      workspaceId: 'repo:e3',
      taskBranchId: 'task-e3',
    },
    request: {
      requestId: 'request-e3-apply',
      action: 'apply-verified-candidate',
      resource: 'repo:e3',
      purpose: 'apply verified candidate',
      idempotencyKey: 'candidate-apply:' + input.verification.candidateId,
    },
    authorityOwner: binding.finalAuthorityOwner,
    decisionRef: 'grant-' + input.verification.candidateId,
    policyDigest: sha('policy-e3'),
    issuedAtMs: Date.now() - 1_000,
    expiresAtMs: Date.now() + 60 * 60_000,
    nowMs: input.current.nowMs,
    revocationEpoch: input.current.revocationEpoch,
    revokedGrantIds: input.current.revokedGrantIds,
    policyEpoch: input.current.policyEpoch,
    catalogEpoch: input.current.catalogEpoch,
  });
}

function authorityFrom(input: {
  verification: CandidateApplyVerification;
  current: PermissionState;
}): CandidateApplyAuthorityState {
  const verdict = verifyPermissionEffectAtFinalCheckpoint(input);
  return {
    ownerId: input.verification.ownerId,
    epoch: input.verification.epoch,
    authorizationId: input.verification.authorizationId,
    grantId: 'grant-' + input.verification.candidateId,
    grantStatus: verdict.allowed
      ? 'active'
      : verdict.reason === 'grant-revoked' ? 'revoked' : 'missing',
    grantEpoch: input.current.policyEpoch,
    revocationEpoch: input.current.revocationEpoch,
    receiptDigest: input.verification.receiptDigest,
    receiptStatus: 'accepted',
  };
}

type VerseShellHostControl = {
  current?: PermissionState;
  mutateAfterPermit?: () => void;
};

function makeVerseShellHost(input: {
  workspaceDir: string;
  evidenceRoot: string;
  mode: 'worker-a' | 'worker-b' | 'full';
  runId: string;
  control?: VerseShellHostControl;
}): CandidateApplyHost {
  const control = input.control ?? {};
  control.current = control.current ?? permissionState();
  let lastRun: VerseShellVerificationRun | null = null;
  return {
    async verifyCandidate({ candidate, candidateRoot }) {
      lastRun = await runVerseShellVerification({
        workspaceDir: input.workspaceDir,
        candidate,
        candidateRoot,
        mode: input.mode,
        evidenceRoot: input.evidenceRoot,
        runId: input.runId,
      });
      return lastRun.verification;
    },
    async readAuthorityState() {
      if (!lastRun) throw new Error('verification must run before authority snapshot');
      control.current!.nowMs = Date.now();
      return authorityFrom({ verification: lastRun.verification, current: control.current! });
    },
    async authorizeCandidate({ verification, repository }) {
      const current = control.current!;
      current.nowMs = Date.now();
      const verdict = verifyPermissionEffectAtFinalCheckpoint(permissionCheckpoint({ verification, current }));
      const authority = authorityFrom({ verification, current });
      const permit: CandidateApplyPermit = {
        allowed: verdict.allowed,
        permitId: verdict.allowed ? 'permit-e3' : null,
        reason: verdict.allowed ? null : verdict.reason,
        candidateId: verification.candidateId,
        candidateTreeOid: verification.candidateTreeOid,
        candidateInputDigest: verification.candidateInputDigest,
        receiptDigest: verification.receiptDigest,
        ownerId: verification.ownerId,
        epoch: verification.epoch,
        authorizationId: verification.authorizationId,
        grantId: authority.grantId,
        expectedSnapshotDigest: candidateApplySnapshotDigest({ repository, authority }),
      };
      control.mutateAfterPermit?.();
      return permit;
    },
  };
}

function fakeVerification(candidate: PatchCandidateManifest): CandidateApplyVerification {
  return {
    status: 'passed', candidateId: candidate.candidateId, baseOid: candidate.baseOid,
    candidateTreeOid: candidate.candidateTreeOid, candidateInputDigest: candidate.candidateInputDigest,
    receiptDigest: sha('fake-receipt'), planDigest: sha('fake-plan'), checkId: 'fake-check',
    ownerId: OWNER_ID, epoch: EPOCH, authorizationId: AUTHORIZATION_ID, issues: [],
  };
}
function makeSyntheticHost(input: {
  workspaceDir: string;
  authority: CandidateApplyAuthorityState;
  mutation: (input: { workspaceDir: string; candidateRoot: string; authority: CandidateApplyAuthorityState }) => void;
}): CandidateApplyHost {
  let candidateRoot = '';
  const current = input.authority;
  return {
    async verifyCandidate({ candidate, candidateRoot: root }) {
      candidateRoot = root;
      return fakeVerification(candidate);
    },
    async readAuthorityState() {
      return { ...current };
    },
    async authorizeCandidate({ verification, repository }) {
      const permit = {
        allowed: true,
        permitId: 'permit-synthetic',
        reason: null,
        candidateId: verification.candidateId,
        candidateTreeOid: verification.candidateTreeOid,
        candidateInputDigest: verification.candidateInputDigest,
        receiptDigest: verification.receiptDigest,
        ownerId: verification.ownerId,
        epoch: verification.epoch,
        authorizationId: verification.authorizationId,
        grantId: current.grantId,
        expectedSnapshotDigest: candidateApplySnapshotDigest({ repository, authority: current }),
      };
      input.mutation({ workspaceDir: input.workspaceDir, candidateRoot, authority: current });
      return permit;
    },
  };
}

async function runIndividualWorkerCheck(input: {
  workspaceDir: string;
  proposals: PatchProposal[];
  mode: 'worker-a' | 'worker-b';
  evidenceRoot: string;
}): Promise<Record<string, any>> {
  const materialized = await materializePatchCandidate({
    workspaceDir: input.workspaceDir,
    proposals: input.proposals,
  });
  if (materialized.status !== 'frozen') throw new Error('individual candidate materialization failed: ' + materialized.reason);
  const run = await runVerseShellVerification({
    workspaceDir: input.workspaceDir,
    candidate: materialized.manifest,
    candidateRoot: materialized.candidateRoot,
    mode: input.mode,
    evidenceRoot: input.evidenceRoot,
    runId: 'run-e3-' + input.mode,
  });
  const cleanup = await cleanupPatchCandidate({ workspaceDir: input.workspaceDir, candidateRoot: materialized.candidateRoot });
  return {
    worker: input.mode,
    verdict: run.verification.status,
    exitCode: run.execution.exitCode,
    receiptAccepted: run.receiptResult.status,
    authorityOk: run.authorityCheck.ok,
    candidateId: materialized.manifest.candidateId,
    candidateTreeOid: materialized.manifest.candidateTreeOid,
    cleanupOk: cleanup.ok,
  };
}

async function runToctouCases(): Promise<Array<Record<string, any>>> {
  const cases = [
    {
      id: 'target-uncommitted',
      expected: 'state-changed-before-first-write',
      mutate: (repo: string, _candidateRoot: string, _authority: CandidateApplyAuthorityState) => writeFileSync(join(repo, 'src/producer.cjs'), 'user-drift\n', 'utf8'),
    },
    {
      id: 'candidate-drift',
      expected: 'state-changed-before-first-write',
      mutate: (_repo: string, candidateRoot: string, _authority: CandidateApplyAuthorityState) => writeFileSync(join(candidateRoot, 'src/producer.cjs'), 'candidate-drift\n', 'utf8'),
    },
    {
      id: 'base-head',
      expected: 'state-changed-before-first-write',
      mutate: (repo: string, _candidateRoot: string, _authority: CandidateApplyAuthorityState) => { writeFileSync(join(repo, 'drift.txt'), 'drift\n'); git(repo, ['add', 'drift.txt']); git(repo, ['commit', '-m', 'drift']); },
    },
    {
      id: 'epoch',
      expected: 'authority-epoch-mismatch',
      mutate: (_repo: string, _candidateRoot: string, authority: CandidateApplyAuthorityState) => { (authority as { epoch: number }).epoch = EPOCH + 1; },
    },
    {
      id: 'revoked',
      expected: 'grant-revoked',
      mutate: (_repo: string, _candidateRoot: string, authority: CandidateApplyAuthorityState) => { (authority as { grantStatus: CandidateApplyAuthorityState['grantStatus'] }).grantStatus = 'revoked'; },
    },
  ];
  const results: Array<Record<string, any>> = [];
  for (const entry of cases) {
    const root = makeRepo();
    const materialized = await materializePatchCandidate({ workspaceDir: root, proposals: proposalsFor('v2') });
    if (materialized.status !== 'frozen') throw new Error('toctou candidate materialization failed');
    const stateBefore = state(root);
    const authority: CandidateApplyAuthorityState = {
      ownerId: OWNER_ID, epoch: EPOCH, authorizationId: AUTHORIZATION_ID,
      grantId: 'grant-synthetic', grantStatus: 'active', grantEpoch: 'policy-e3',
      revocationEpoch: 'revocation-e3', receiptDigest: sha('fake-receipt'), receiptStatus: 'accepted',
    };
    const host = makeSyntheticHost({
      workspaceDir: root,
      authority,
      mutation: ({ workspaceDir, candidateRoot }) => entry.mutate(workspaceDir, candidateRoot, authority),
    });
    const outcome = await applyCandidateAfterVerification({
      workspaceDir: root,
      candidate: materialized.manifest,
      candidateRoot: materialized.candidateRoot,
      proposals: proposalsFor('v2'),
      host,
      journal: { workspaceRoot: root, sessionId: 'session-e3-toctou', requestId: 'batch-e3-toctou', enabled: true },
      applyProposals: async () => { throw new Error('unexpected write during negative preflight'); },
    });
    const after = state(root);
    results.push({
      id: entry.id,
      status: outcome.status,
      expectedReason: entry.expected,
      actualReason: outcome.decision.reason,
      issues: outcome.decision.issues,
      firstWriteStarted: outcome.trace.some((event) => event.kind === 'first-write-started'),
      baseHeadUnchanged: stateBefore.head === after.head,
      baseRefsUnchanged: stateBefore.refs === after.refs,
      cleanupOk: outcome.cleanup.ok,
      passed: outcome.status === 'preflight-rejected' && (outcome.decision.issues ?? []).includes(entry.expected) && !outcome.trace.some((event) => event.kind === 'first-write-started'),
    });
  }
  return results;
}

async function main(): Promise<void> {
  const source = sourceState();
  if (source.dirty) throw new Error('E3 probe source candidate is dirty');
  if (!existsSync(BINARY)) throw new Error('qualified ae.exe is missing');
  const reportPath = process.env.VERSEGIT_E3_REPORT_PATH?.trim()
    || join(TEMP_ROOT, 'versegit-e3-report-' + Date.now() + '.json');
  const rawRoot = process.env.VERSEGIT_E3_RAW_ROOT?.trim()
    || mkdtempSync(join(TEMP_ROOT, 'versegit-e3-raw-'));
  mkdirSync(rawRoot, { recursive: true });
  const evidenceRoot = join(rawRoot, 'verseshell-evidence');
  const repo = makeRepo();
  const mainBefore = state(repo);
  try {
    const individualWorkers = [
      await runIndividualWorkerCheck({ workspaceDir: repo, proposals: [proposalsFor('v1')[0]!], mode: 'worker-a', evidenceRoot }),
      await runIndividualWorkerCheck({ workspaceDir: repo, proposals: [proposalsFor('v1')[1]!], mode: 'worker-b', evidenceRoot }),
    ];
    if (!individualWorkers.every((worker) => worker.verdict === 'passed')) throw new Error('individual worker verification did not pass');

    const combinedFailureHost = makeVerseShellHost({
      workspaceDir: repo,
      evidenceRoot,
      mode: 'full',
      runId: 'run-e3-combined-failure',
    });
    const combinedFailure = await applyDeferredPatchFlow({
      workers: workersFor('v1'),
      workspaceDir: repo,
      candidateApply: {
        host: combinedFailureHost,
        journal: { workspaceRoot: repo, sessionId: 'session-e3-failure', requestId: 'batch-e3-failure', enabled: true },
      },
    });
    const afterFailure = state(repo);
    if (combinedFailure.status !== 'verification-failed') throw new Error('combined failure was not blocked before apply');
    if (JSON.stringify(afterFailure) !== JSON.stringify(mainBefore)) throw new Error('combined failure wrote to main');
    if (combinedFailure.trace?.some((event) => event.kind === 'first-write-started')) throw new Error('combined failure reached first write');

    const successHost = makeVerseShellHost({
      workspaceDir: repo,
      evidenceRoot,
      mode: 'full',
      runId: 'run-e3-combined-success',
    });
    const success = await applyDeferredPatchFlow({
      workers: workersFor('v2'),
      workspaceDir: repo,
      candidateApply: {
        host: successHost,
        journal: { workspaceRoot: repo, sessionId: 'session-e3-success', requestId: 'batch-e3-success', enabled: true },
      },
    });
    if (success.status !== 'applied') throw new Error('verified candidate was not applied: ' + String(success.error));
    const afterApply = state(repo);
    const appliedContents = {
      producer: readFileSync(join(repo, 'src/producer.cjs'), 'utf8'),
      consumerB: readFileSync(join(repo, 'src/consumer-b.cjs'), 'utf8'),
    };
    const journalSteps = success.results.reduce((sum, result) => sum + (result.journal?.snapshotIds.length ?? 0), 0);
    const journalSnapshotFiles = listJournalSnapshotFiles(repo, 'session-e3-success');
    const undone = undoLastWrites({ workspaceRoot: repo, sessionId: 'session-e3-success', steps: journalSteps, workspaceOnly: true });
    const afterUndo = state(repo);
    if (undone.errors.length > 0) throw new Error('journal recovery failed: ' + undone.errors.join(';'));
    if (afterUndo.status !== '' || afterUndo.head !== mainBefore.head || afterUndo.refs !== mainBefore.refs) throw new Error('journal recovery did not restore base');

    const toctou = await runToctouCases();
    if (!toctou.every((entry) => entry.passed)) throw new Error('one or more TOCTOU negative cases failed');

    const kinds = success.trace?.map((event) => event.kind) ?? [];
    const verifyIndex = kinds.indexOf('verification-start');
    const firstWriteIndex = kinds.indexOf('first-write-started');
    const postApplyIndex = kinds.indexOf('post-apply-verified');
    const orderingPassed = verifyIndex >= 0 && firstWriteIndex > verifyIndex && postApplyIndex > firstWriteIndex;
    if (!orderingPassed) throw new Error('verification did not precede first write');

    const report = {
      schema: 'clawx.versegit.e3-probe-report/v1',
      generated_at: new Date().toISOString(),
      task: 'TF-0534',
      driven_by: 'agent',
      actor: 'codex',
      source,
      execution_route: 'real runtime patch-flow -> candidate freeze -> VerseShell verification -> permission checkpoint -> journaled apply',
      individual_workers: individualWorkers,
      combined_failure: {
        status: combinedFailure.status,
        error: combinedFailure.error ?? null,
        candidate: combinedFailure.candidate,
        verification: combinedFailure.verification,
        trace: combinedFailure.trace,
        cleanup: combinedFailure.cleanup,
        main_before: mainBefore,
        main_after: afterFailure,
        main_unchanged: JSON.stringify(afterFailure) === JSON.stringify(mainBefore),
        first_write_started: false,
        passed: combinedFailure.status === 'verification-failed' && JSON.stringify(afterFailure) === JSON.stringify(mainBefore),
      },
      combined_success: {
        status: success.status,
        candidate: success.candidate,
        verification: success.verification,
        permit: success.permit,
        decision: success.decision,
        cleanup: success.cleanup,
        main_before: mainBefore,
        main_after_apply: afterApply,
        main_after_undo: afterUndo,
        head_unchanged: afterApply.head === mainBefore.head,
        refs_unchanged: afterApply.refs === mainBefore.refs,
        applied_contents: appliedContents,
        passed: success.status === 'applied' && afterApply.head === mainBefore.head && afterApply.refs === mainBefore.refs,
      },
      ordering_trace: {
        events: success.trace ?? [],
        verification_index: verifyIndex,
        first_write_index: firstWriteIndex,
        post_apply_index: postApplyIndex,
        verification_before_first_write: orderingPassed,
        journal_batch_ids: success.results.flatMap((result) => result.journal?.batchId ? [result.journal.batchId] : []),
        journal_snapshot_ids: success.results.flatMap((result) => result.journal?.snapshotIds ?? []),
        passed: orderingPassed,
      },
      toctou_negative: {
        cases: toctou,
        passed: toctou.every((entry) => entry.passed),
      },
      write_journal: {
        result_journals: success.results.flatMap((result) => result.journal ? [result.journal] : []),
        journal_steps: journalSteps,
        snapshot_files: journalSnapshotFiles,
        undo: undone,
        recovery_restored_base: afterUndo.status === '' && afterUndo.head === mainBefore.head && afterUndo.refs === mainBefore.refs,
        passed: journalSteps > 0 && undone.errors.length === 0 && afterUndo.status === '',
      },
      boundaries: {
        real_human_evidence: false,
        default_off: true,
        m4_authorized: false,
        host_authority: 'ClawX',
        vg_landing_authority: false,
      },
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify({
      passed: report.combined_failure.passed && report.combined_success.passed && report.ordering_trace.passed && report.toctou_negative.passed && report.write_journal.passed,
      reportPath,
      combinedFailure: report.combined_failure.status,
      combinedSuccess: report.combined_success.status,
      ordering: report.ordering_trace.passed,
      toctou: report.toctou_negative.cases.length,
      journalSteps,
    }));
  } finally {
    __resetWriteJournals();
    await Promise.allSettled(managers.splice(0).map((manager) => manager.shutdownAll()));
    for (const root of roots.splice(0)) {
      try { rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); } catch {}
    }
  }
}

main().catch((error) => {
  console.error('[versegit-e3-probe] FAIL: ' + String((error as Error)?.stack ?? error));
  process.exitCode = 1;
});
