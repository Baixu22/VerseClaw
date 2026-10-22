import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createVerseGitCleanupBarrier, verseGitCleanupResourceId } from '../shared/versegit-cleanup-barrier';
import type { VerseGitCleanupIdentity } from '../shared/types/versegit';
import { createVerseGitRuntimeBindingPortFromEnv } from '../openclaw_runtime/src/plugin-sdk/versegit-binding-port';
import { registerVerseGitRuntimeBinding, clearVerseGitRuntimeBindingsForTest } from '../openclaw_runtime/src/plugin-sdk/versegit-binding-registry';
import { createWorktreeService, __resetWorktreeRegistry } from '../openclaw_runtime/src/agents/worktree-service';
import { runSubagentVerseGitCleanup } from '../openclaw_runtime/src/agents/subagent-versegit-cleanup';
import type { SubagentRunRecord } from '../openclaw_runtime/src/agents/subagent-registry.types';
import { addSession, deleteSession, type ProcessSession } from '../openclaw_runtime/src/agents/bash-process-registry';
import { SUBAGENT_ENDED_REASON_COMPLETE, SUBAGENT_ENDED_REASON_ERROR } from '../openclaw_runtime/src/agents/subagent-lifecycle-events';

const tempRoot = process.platform === 'win32' ? 'D:/tmp' : process.env.TMPDIR ?? '/tmp';
const reportPath = process.env.VERSEGIT_F2_REPORT_PATH?.trim();
if (!reportPath) throw new Error('VERSEGIT_F2_REPORT_PATH is required');
const cleanupRoot = process.env.CLAWX_VERSGIT_CLEANUP_ROOT?.trim();
if (!cleanupRoot) throw new Error('CLAWX_VERSGIT_CLEANUP_ROOT is required');
const configuredRoot = process.env.VERSEGIT_F2_REPO_ROOT?.trim();
const root = configuredRoot ? resolve(configuredRoot) : mkdtempSync(join(tempRoot, 'versegit-f2-e2e-'));
const ownsRoot = !configuredRoot;
const children = new Set<ChildProcess>();
const sha = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const git = (cwd: string, args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

function initRepo(): void {
  mkdirSync(root, { recursive: true });
  if (!existsSync(join(root, '.git'))) {
    git(root, ['init', '--initial-branch=main']);
  }
  git(root, ['config', 'user.email', 'agent@example.invalid']);
  git(root, ['config', 'user.name', 'Agent']);
  writeFileSync(join(root, '.gitignore'), '.openclaw/\n', 'utf8');
  if (!existsSync(join(root, 'owned.txt'))) writeFileSync(join(root, 'owned.txt'), 'base\n', 'utf8');
  git(root, ['add', '.']);
  try {
    git(root, ['commit', '-m', 'f2 setup']);
  } catch {
    // The pre-created E2 fixture may already have this setup commit.
  }
}

function pidExists(pid: number): boolean {
  try {
    const output = execFileSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8', windowsHide: true, timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output.split(/\r?\n/u).some((line) => new RegExp(`^"node\\.exe","${pid}"`, 'iu').test(line.trim()));
  } catch {
    return false;
  }
}

function makeEntry(input: {
  runId: string;
  worktreeId: string;
  attachmentsDir: string;
  transcriptFile: string;
  failed: boolean;
}): SubagentRunRecord {
  return {
    runId: input.runId,
    childSessionKey: `agent:child:${input.runId}`,
    requesterSessionKey: 'agent:main',
    requesterDisplayKey: 'main',
    task: 'F2 cleanup E2E',
    cleanup: 'delete',
    createdAt: Date.now() - 10,
    startedAt: Date.now() - 9,
    endedAt: Date.now() - 1,
    endedReason: input.failed ? SUBAGENT_ENDED_REASON_ERROR : SUBAGENT_ENDED_REASON_COMPLETE,
    outcome: input.failed ? { status: 'error', error: 'injected failure' } : { status: 'ok' },
    orchestration: {
      orchestrationRunId: 'f2-e2e-orchestration',
      roleName: 'worker',
      isVerifier: false,
      phase: 'worker',
      leadRole: 'lead',
      originalTask: 'F2 cleanup E2E',
      isolation: 'worktree',
      worktreeId: input.worktreeId,
      worktreeBackend: 'git',
    },
    completion: { required: true, resultText: input.failed ? undefined : 'done' },
    delivery: { status: 'delivered' },
    attachmentsDir: input.attachmentsDir,
    attachmentsRootDir: join(root, '.openclaw'),
    execution: { status: 'terminal', transcriptFile: input.transcriptFile },
  };
}

function processSession(input: { id: string; child: ChildProcess; pid: number; sessionKey: string }): ProcessSession {
  return {
    id: input.id,
    command: 'node -e setInterval',
    scopeKey: input.sessionKey,
    sessionKey: input.sessionKey,
    child: input.child as never,
    stdin: input.child.stdin ?? undefined,
    pid: input.pid,
    lifecycleOwner: 'node',
    lifecycleCanonicalSessionKey: input.sessionKey,
    startedAt: Date.now(),
    cwd: root,
    maxOutputChars: 16_000,
    totalOutputChars: 0,
    pendingStdout: [],
    pendingStderr: [],
    pendingStdoutChars: 0,
    pendingStderrChars: 0,
    aggregated: '',
    tail: '',
    exited: false,
    truncated: false,
    backgrounded: true,
    cursorKeyMode: 'unknown',
  };
}

async function waitForPidExit(pid: number, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidExists(pid)) return true;
    await delay(100);
  }
  return !pidExists(pid);
}

async function runCase(label: 'normal' | 'failure' | 'continuation', failed: boolean) {
  const runId = `f2-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const service = createWorktreeService(root, { backend: 'git' });
  const record = service.create(runId, { writeSet: ['owned.txt'] });
  writeFileSync(join(record.root, 'owned.txt'), `${label} agent change\n`, 'utf8');
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  children.add(child);
  await new Promise<void>((resolveSpawn, rejectSpawn) => {
    child.once('spawn', () => resolveSpawn());
    child.once('error', rejectSpawn);
  });
  const pid = child.pid;
  if (!pid) throw new Error('owned process pid missing');
  const sessionId = `f2-session-${runId}`;
  addSession(processSession({ id: sessionId, child, pid, sessionKey: `agent:child:${runId}` }));
  const attachmentsDir = join(root, '.openclaw', `${runId}-attachments`);
  const transcriptFile = join(root, '.openclaw', `${runId}-transcript.jsonl`);
  mkdirSync(attachmentsDir, { recursive: true });
  writeFileSync(join(attachmentsDir, 'note.txt'), 'preserve evidence until barrier\n', 'utf8');
  writeFileSync(transcriptFile, '{"transcript":true}\n', 'utf8');

  const port = createVerseGitRuntimeBindingPortFromEnv();
  if (!port) throw new Error('VerseGit runtime binding port unavailable');
  const requestId = `f2-request-${runId}`;
  const childSessionKey = `agent:child:${runId}`;
  const bound = await port.bind({
    requestId,
    runId,
    traceId: runId,
    worktreePath: record.root,
    agentSessionId: `f2-agent-${runId}`,
    mode: 'M1',
  });
  const attached = await port.attach({ bindingId: bound.bindingId, childSessionKey, childRunId: runId });
  registerVerseGitRuntimeBinding(runId, attached, port);

  let managerPresent = true;
  const result = await runSubagentVerseGitCleanup({
    runId,
    entry: makeEntry({ runId, worktreeId: runId, attachmentsDir, transcriptFile, failed }),
    cleanup: 'delete',
    sessionPresent: true,
    bindingEndReason: failed ? 'failed' : 'completed',
    actions: {
      stopSession: async () => {
        if (pidExists(pid)) process.kill(pid, 'SIGTERM');
        if (!(await waitForPidExit(pid))) throw new Error('owned pid did not exit');
        deleteSession(sessionId);
        children.delete(child);
      },
      deleteSession: async () => { managerPresent = false; },
      deleteAttachments: async () => { rmSync(attachmentsDir, { recursive: true, force: true }); },
      deleteTranscript: async () => { rmSync(transcriptFile, { force: true }); },
      retireManagers: async () => {},
      cleanupWorktree: (authorization) => { service.cleanup(runId, authorization ? { authorization } : undefined); },
    },
  });
  const barrier = createVerseGitCleanupBarrier(cleanupRoot);
  const barrierRecord = barrier.read(runId);
  const late = barrier.observeLateEvent({ runId, event: 'start', epoch: 4 });
  return {
    label,
    runId,
    bindingId: attached.bindingId,
    result: {
      ok: result.ok,
      barriered: result.barriered,
      status: result.record?.status ?? null,
      issues: result.issues,
    },
    ownedProcess: { pid, exited: !pidExists(pid) },
    managerPresent,
    worktreeSurvived: existsSync(record.root),
    attachmentsSurvived: existsSync(attachmentsDir),
    transcriptSurvived: existsSync(transcriptFile),
    baseRootPreserved: existsSync(root) && existsSync(join(root, 'owned.txt'))
      && git(root, ['status', '--porcelain=v1', '--untracked-files=all']).length === 0,
    inventoryAfter: barrierRecord?.inventoryAfter ?? null,
    barrierStatusBeforeLateEvent: barrierRecord?.status ?? null,
    lateEvent: { accepted: late.accepted, status: late.record?.status ?? null, count: late.record?.lateEvents.length ?? 0 },
  };
}

async function main(): Promise<void> {
  initRepo();
  const cases = [
    await runCase('normal', false),
    await runCase('failure', true),
    await runCase('continuation', true),
  ];

  const negativeRoot = join(root, '.openclaw', 'negative-barrier');
  const negativeBarrier = createVerseGitCleanupBarrier(negativeRoot);
  const expected: VerseGitCleanupIdentity = {
    ownerId: 'agent:codex', epoch: 4, authorizationId: 'auth-negative', baseOid: 'a'.repeat(40), refsDigest: `sha256:${sha('negative-ref')}`,
  };
  const negativeWorktree = join(root, 'must-survive-worktree');
  mkdirSync(negativeWorktree, { recursive: true });
  const resourceId = verseGitCleanupResourceId('worktree', negativeWorktree);
  const rejected = negativeBarrier.seal({
    runId: 'f2-negative-ref',
    sessionId: 'f2-negative-session',
    bindingId: 'f2-negative-binding',
    actor: 'codex',
    expected,
    current: { ...expected, refsDigest: `sha256:${sha('drifted-ref')}` },
    references: [],
    evidenceDigests: [`sha256:${sha('negative-evidence')}`],
    inventoryBefore: { observed: true, processes: 0, managers: 0, worktrees: 1, tempRoots: 0, survivors: [] },
    resources: [{ kind: 'worktree', id: resourceId, target: negativeWorktree, owned: true, preserve: false }],
    deletedKinds: ['worktree'],
    stopAccepting: true,
    drain: { ok: true, issues: [] },
  });

  writeFileSync(reportPath!, JSON.stringify({
    schema: 'clawx.versegit.f2-cleanup-e2e/v1',
    driven_by: 'agent',
    actor: 'codex',
    platform: process.platform,
    source: {
      head: git(process.cwd(), ['rev-parse', 'HEAD']),
      tree: git(process.cwd(), ['rev-parse', 'HEAD^{tree}']),
      dirty: git(process.cwd(), ['status', '--porcelain=v1', '--untracked-files=all']).length > 0,
    },
    cleanupRoot,
    cases,
    negative: {
      rejected: !rejected.ok && rejected.issues.includes('identity_mismatch:refsDigest'),
      status: rejected.record?.status ?? null,
      worktreeSurvived: existsSync(negativeWorktree),
    },
    boundaries: {
      bindingExplicitlyEnabled: process.env.CLAWX_VERSGIT_BINDING_ENABLED === '1',
      liveReady: false,
      productApproved: false,
      m4Authorized: false,
      realHumanEvidence: false,
    },
    passed: cases.every((entry) => entry.result.ok && entry.result.status === 'deleted'
      && entry.ownedProcess.exited && !entry.managerPresent && !entry.worktreeSurvived && !entry.attachmentsSurvived && !entry.transcriptSurvived && entry.baseRootPreserved
      && entry.lateEvent.accepted === false && entry.lateEvent.status === 'deleted')
      && !rejected.ok,
  }, null, 2) + '\n', 'utf8');
}

main().catch((error) => {
  writeFileSync(reportPath!, JSON.stringify({
    schema: 'clawx.versegit.f2-cleanup-e2e/v1', driven_by: 'agent', actor: 'codex', passed: false,
    error: String(error).slice(0, 1000),
  }, null, 2) + '\n', 'utf8');
  process.exitCode = 1;
}).finally(async () => {
  clearVerseGitRuntimeBindingsForTest();
  __resetWorktreeRegistry();
  for (const child of children) {
    if (child.pid && pidExists(child.pid)) {
      try { process.kill(child.pid, 'SIGTERM'); } catch {}
    }
  }
  await delay(250);
  if (ownsRoot) rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
});
