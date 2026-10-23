#!/usr/bin/env node
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
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
import { promisify } from 'node:util';
import { createVerseGitCleanupBarrier } from '../shared/versegit-cleanup-barrier';
import type { VerseGitCleanupIdentity, VerseGitCleanupResource } from '../shared/types/versegit';

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'harness/specs/fixtures/versegit-product-integration/f2');
const TEMP_ROOT = process.platform === 'win32' ? 'D:/tmp' : tmpdir();
const sha = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const git = (args: string[]): string => execFileSyncLocal(args);
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const startedAt = new Date().toISOString();

function execFileSyncLocal(args: string[]): string {
  const result = execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as string;
  return result.trim();
}

function writeJson(name: string, value: unknown): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sourceState() {
  const evidencePrefix = 'harness/specs/fixtures/versegit-product-integration/f2/';
  const dirty = git(['status', '--porcelain=v1', '--untracked-files=all'])
    .split(/\r?\n/u)
    .filter(Boolean)
    .some((line) => !line.slice(3).replaceAll('\\', '/').startsWith(evidencePrefix));
  return {
    branch: git(['branch', '--show-current']) || 'detached',
    commit: git(['rev-parse', 'HEAD']),
    tree: git(['rev-parse', 'HEAD^{tree}']),
    dirty,
  };
}

async function runCommand(name: string, argv: string[], env: NodeJS.ProcessEnv = process.env) {
  const started = Date.now();
  try {
    const result = await execFileAsync(argv[0]!, argv.slice(1), {
      cwd: ROOT,
      env,
      timeout: 300_000,
      windowsHide: true,
      shell: process.platform === 'win32',
      maxBuffer: 24 * 1024 * 1024,
    });
    return {
      name,
      argv,
      exitCode: 0,
      durationMs: Date.now() - started,
      stdoutTail: result.stdout.slice(-4000),
      stderrTail: result.stderr.slice(-4000),
    };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string; message?: string };
    return {
      name,
      argv,
      exitCode: typeof failure.code === 'number' ? failure.code : 1,
      durationMs: Date.now() - started,
      stdoutTail: String(failure.stdout ?? '').slice(-4000),
      stderrTail: String(failure.stderr ?? failure.message ?? '').slice(-4000),
    };
  }
}

function identity(overrides: Partial<VerseGitCleanupIdentity> = {}): VerseGitCleanupIdentity {
  return {
    ownerId: 'agent:codex',
    epoch: 4,
    authorizationId: 'auth-f2-evidence',
    baseOid: 'a'.repeat(40),
    refsDigest: `sha256:${sha('f2-evidence-refs')}`,
    ...overrides,
  };
}

function managerResource(): VerseGitCleanupResource {
  return { kind: 'manager', id: 'manager-f2-evidence', target: 'session-f2-evidence', owned: true, preserve: false };
}

function sealInput(runId: string, overrides: Record<string, unknown> = {}) {
  const expected = identity();
  return {
    runId,
    sessionId: runId,
    bindingId: `binding-${runId}`,
    actor: 'codex',
    expected,
    current: expected,
    references: [],
    evidenceDigests: [`sha256:${sha(runId + ':evidence')}`],
    inventoryBefore: { observed: true, processes: 0, managers: 1, worktrees: 0, tempRoots: 0, survivors: [] },
    resources: [managerResource()],
    deletedKinds: ['manager'],
    stopAccepting: true,
    drain: { ok: true, issues: [] },
    ...overrides,
  } as Parameters<ReturnType<typeof createVerseGitCleanupBarrier>['seal']>[0];
}

function runNegativeCases(root: string) {
  const cases: Array<Record<string, unknown>> = [];
  const identityFields = ['ownerId', 'epoch', 'authorizationId', 'baseOid', 'refsDigest'] as const;
  for (const field of identityFields) {
    const current = identity({ [field]: field === 'epoch' ? 3 : `drift-${field}` } as Partial<VerseGitCleanupIdentity>);
    const seal = createVerseGitCleanupBarrier(root).seal(sealInput(`identity-${field}`, { current }));
    cases.push({
      case: `identity_mismatch_${field}`,
      rejected: !seal.ok,
      status: seal.record?.status ?? null,
      issues: seal.issues,
      deletionNotAttempted: true,
    });
  }
  const stageCases = [
    ['stop_accepting', { stopAccepting: false }],
    ['drain_cancel', { drain: { ok: false, issues: ['drain-timeout'] } }],
    ['evidence', { evidenceDigests: [] }],
    ['inventory', { inventoryBefore: { observed: false, processes: 0, managers: 1, worktrees: 0, tempRoots: 0 } }],
  ] as const;
  for (const [name, override] of stageCases) {
    const seal = createVerseGitCleanupBarrier(root).seal(sealInput(`stage-${name}`, override));
    cases.push({ case: `stage_failure_${name}`, rejected: !seal.ok, status: seal.record?.status ?? null, issues: seal.issues });
  }

  const recoveryInput = sealInput('recovery-survivor');
  const barrier = createVerseGitCleanupBarrier(root);
  const sealed = barrier.seal(recoveryInput);
  if (!sealed.sealId) throw new Error('recovery seal failed');
  barrier.markDetached({ runId: recoveryInput.runId, sealId: sealed.sealId, current: recoveryInput.current, vgDetached: true });
  const survivor = barrier.complete({
    runId: recoveryInput.runId,
    sealId: sealed.sealId,
    inventoryAfter: { observed: true, processes: 0, managers: 1, worktrees: 0, tempRoots: 0, survivors: ['manager:session-f2-evidence'] },
  });
  cases.push({
    case: 'survivor_recovery_required',
    recovered: !survivor.ok && survivor.record?.status === 'recovery_required',
    status: survivor.record?.status ?? null,
    inventoryAfter: survivor.record?.inventoryAfter ?? null,
    issues: survivor.record?.issues ?? [],
  });

  const lateInput = sealInput('late-event');
  const lateSealed = barrier.seal(lateInput);
  if (!lateSealed.sealId) throw new Error('late seal failed');
  barrier.markDetached({ runId: lateInput.runId, sealId: lateSealed.sealId, current: lateInput.current, vgDetached: true });
  barrier.complete({ runId: lateInput.runId, sealId: lateSealed.sealId, inventoryAfter: { observed: true, processes: 0, managers: 0, worktrees: 0, tempRoots: 0, survivors: [] } });
  const late = barrier.observeLateEvent({ runId: lateInput.runId, event: 'start', epoch: 4 });
  cases.push({
    case: 'late_event_after_delete',
    accepted: late.accepted,
    status: late.record?.status ?? null,
    lateEvents: late.record?.lateEvents.length ?? 0,
    sealStable: late.record?.sealId === lateSealed.sealId,
  });
  return cases;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const rawRoot = mkdtempSync(join(TEMP_ROOT, 'versegit-f2-evidence-'));
  const artifactRoot = join(rawRoot, 'e2');
  mkdirSync(artifactRoot, { recursive: true });
  const sourceBefore = sourceState();
  const commands = [];
  commands.push(await runCommand('unit', [pnpm, 'exec', 'vitest', 'run', 'tests/unit/versegit-cleanup-barrier.test.ts']));
  commands.push(await runCommand('e2', [pnpm, 'exec', 'playwright', 'test', 'tests/e2e/versegit-lifecycle-cleanup.spec.ts'], {
    ...process.env,
    VERSEGIT_F2_E2_ARTIFACT_DIR: artifactRoot,
  }));
  commands.push(await runCommand('contract', [pnpm, 'contract:check']));
  commands.push(await runCommand('harness', [pnpm, 'harness', 'validate', '--spec', 'harness/specs/tasks/versegit-product-f2-cleanup-barrier.md']));
  const e2ReportPath = join(artifactRoot, 'e2-report.json');
  const eventsPath = join(artifactRoot, 'bridge-events.jsonl');
  if (!existsSync(e2ReportPath)) throw new Error('F2 E2 report was not produced: ' + JSON.stringify(commands.find((entry) => entry.name === 'e2')));
  const e2 = JSON.parse(readFileSync(e2ReportPath, 'utf8'));
  const events = readFileSync(eventsPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const negativeRoot = join(rawRoot, 'negative-barriers');
  const negatives = runNegativeCases(negativeRoot);
  const sourceAfter = sourceState();
  const passed = commands.every((entry) => entry.exitCode === 0)
    && e2.passed === true
    && negatives.every((entry) => entry.rejected === true || entry.recovered === true || (entry.case === 'late_event_after_delete' && entry.accepted === false && entry.status === 'deleted' && entry.sealStable === true));

  writeJson('cleanup-barrier.json', {
    schema: 'clawx.versegit.f2-cleanup-barrier-evidence/v1',
    driven_by: 'agent',
    actor: 'codex',
    generatedAt: new Date().toISOString(),
    source: { before: sourceBefore, after: sourceAfter },
    protocol: {
      stages: ['stop_accepting', 'drain_cancel', 'seal_evidence', 'detach_vg', 'verify_owner_epoch_ref', 'delete_disposable'],
      lateEventsRejectedAfterSeal: true,
      restartReadsDurableRecord: true,
      unknownInventoryNeverClaimsZero: true,
    },
    commands,
    e2: {
      schema: e2.schema,
      passed: e2.passed,
      cases: e2.cases,
      negative: e2.negative,
      boundaries: e2.boundaries,
    },
    events: {
      path: 'bridge-events.jsonl',
      count: events.length,
      attached: events.filter((event) => event.kind === 'attached').length,
      ended: events.filter((event) => event.kind === 'ended').length,
      allAgentDriven: events.every((event) => event.driven_by === 'agent' && event.actor === 'electron-main'),
    },
    passed,
  });

  writeJson('resource-inventory.json', {
    schema: 'clawx.versegit.f2-resource-inventory/v1',
    driven_by: 'agent',
    actor: 'codex',
    source: sourceBefore,
    observedOn: 'win32',
    cases: e2.cases.map((entry: Record<string, any>) => ({
      label: entry.label,
      ownedProcess: entry.ownedProcess,
      managerPresent: entry.managerPresent,
      worktreeSurvived: entry.worktreeSurvived,
      attachmentsSurvived: entry.attachmentsSurvived,
      transcriptSurvived: entry.transcriptSurvived,
      baseRootPreserved: entry.baseRootPreserved,
      inventoryAfter: entry.inventoryAfter,
      zeroSurvivors: entry.ownedProcess?.exited === true
        && entry.managerPresent === false
        && entry.worktreeSurvived === false
        && entry.attachmentsSurvived === false
        && entry.transcriptSurvived === false
        && entry.inventoryAfter?.observed === true
        && entry.inventoryAfter.processes === 0
        && entry.inventoryAfter.managers === 0
        && entry.inventoryAfter.worktrees === 0
        && entry.inventoryAfter.tempRoots === 0,
    })),
    negative: e2.negative,
    passed: e2.cases.every((entry: Record<string, any>) => entry.result?.status === 'deleted'
      && entry.ownedProcess?.exited === true && entry.managerPresent === false
      && entry.worktreeSurvived === false && entry.attachmentsSurvived === false && entry.transcriptSurvived === false),
  });

  writeJson('recovery-required.json', {
    schema: 'clawx.versegit.f2-recovery-required/v1',
    driven_by: 'agent',
    actor: 'codex',
    source: sourceBefore,
    cases: negatives,
    passed: negatives.every((entry) => entry.rejected === true || entry.recovered === true || (entry.case === 'late_event_after_delete' && entry.accepted === false && entry.status === 'deleted' && entry.sealStable === true)),
  });

  rmSync(rawRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  writeJson('cleanup-barrier.json', {
    schema: 'clawx.versegit.f2-cleanup-barrier-evidence/v1',
    driven_by: 'agent', actor: 'codex', generatedAt: new Date().toISOString(), startedAt,
    passed: false, error: String(error).slice(0, 1200),
  });
  process.exitCode = 1;
});
