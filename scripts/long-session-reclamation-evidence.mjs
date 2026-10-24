#!/usr/bin/env node
/**
 * E2 / TF-0560 evidence driver.
 *
 * Runs the real Main owner tests plus the runtime supervisor/worktree/admission
 * cycle, then writes a receipt derived from those command results. A missing
 * audit line, failed command or non-zero residual never produces a PASS.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { isMainEntrypoint } from './lib/entrypoint.mjs';
import {
  RECLAIM_ACTION_CONTRACTS,
  RECLAIM_OWNERS,
  buildReclaimReceipt,
} from '../shared/long-session-resource-reclamation.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ACTOR = 'codex-long-session-e2';
const DEFAULT_OUT = 'harness/specs/fixtures/long-session-development/e2';
const INVENTORY_FILE = 'resource-owner-inventory.json';
const CYCLES_FILE = 'reclamation-cycle-results.json';
const RECOVERY_FILE = 'resource-recovery-required.json';
const RECEIPT_FILE = 'verification-receipt.json';
const README_FILE = 'README.md';
const E2E_RECEIPT_FILE = 'real-owner-reclamation-receipt.json';
const SUMS_FILE = 'SHA256SUMS';
const SCOPE = {
  workspaceId: 'workspace-e2',
  sessionKey: 'agent:agent-e2:long-session',
  expectedSessionId: 'generation-e2',
  rootPath: 'D:/workspace-e2',
};

const OWNER_UNIT_TESTS = [
  'tests/unit/terminal-session-manager.test.ts',
  'tests/unit/session-cascade-delete.test.ts',
  'tests/unit/session-delete-gate.test.ts',
  'tests/unit/session-activity-background-read.test.ts',
  'tests/unit/versebrowser-host-adapter.test.ts',
  'tests/unit/long-session-resource-reclamation.test.ts',
  'tests/unit/long-session-owner-reclamation-adapter.test.ts',
  'tests/unit/long-session-runtime-resource-inventory.test.ts',
  'tests/unit/orchestration-worktree-merge.test.ts',
  'tests/unit/workspaces-api.test.ts',
  'tests/unit/long-session-effective-policy.test.ts',
];

const RUNTIME_CYCLE_TESTS = [
  'src/sessions/session-admission-registry.test.ts',
  'src/sessions/session-admission-registry-reclamation.test.ts',
  'src/gateway/session-ecosystem-reclamation-cycle.test.ts',
];

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const inline = process.argv.find((entry) => entry.startsWith(name + '='));
  return inline ? inline.slice(name.length + 1) : fallback;
}

function hashText(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hashFile(file) {
  return existsSync(file) ? createHash('sha256').update(readFileSync(file, 'utf8')).digest('hex') : null;
}

function git(args) {
  const executable = process.platform === 'win32' ? 'git.exe' : 'git';
  const result = spawnSync(executable, args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function candidateIdentity() {
  return {
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    commit: git(['rev-parse', '--verify', 'HEAD']),
    tree: git(['rev-parse', '--verify', 'HEAD^{tree}']),
    worktree: ROOT.replaceAll('\\', '/'),
    status: git(['status', '--short']).split(/\r?\n/).filter(Boolean),
  };
}

function runCommand(name, command, args, options = {}) {
  const startedAt = Date.now();
  const executable = process.platform === 'win32'
    ? (process.env.ComSpec ?? 'cmd.exe')
    : command;
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/c', command, ...args]
    : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, TEMP: 'D:\\tmp', TMP: 'D:\\tmp' },
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeoutMs ?? 300_000,
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
  });
  const gate = {
    name,
    command: [command, ...args].join(' '),
    cwd: relative(ROOT, options.cwd ?? ROOT).replaceAll('\\', '/') || '.',
    exitCode: result.status,
    signal: result.signal ?? null,
    durationMs: Date.now() - startedAt,
    timedOut: result.error?.code === 'ETIMEDOUT' || Boolean(result.signal),
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    stdoutSha256: hashText(result.stdout ?? ''),
    stderrSha256: hashText(result.stderr ?? ''),
  };
  const exceptionPattern = /^\s*(?:(?:TypeError|ReferenceError|SyntaxError):|AssertionError:)/mu;
  if (gate.exitCode === 0 && exceptionPattern.test(gate.stderr ?? '')) {
    throw new Error(`${name} exited 0 but stderr contains an assertion/runtime exception: ${gate.stderr}`);
  }
  if (gate.exitCode !== 0) {
    throw new Error(`${name} failed (${gate.exitCode ?? gate.signal}): ${gate.stderr || gate.stdout}`);
  }
  return gate;
}

function parseAuditLine(stdout, marker) {
  const line = stdout.split(/\r?\n/).find((entry) => entry.includes(marker));
  if (!line) throw new Error(`missing ${marker} audit line`);
  const values = Object.fromEntries(
    [...line.matchAll(/([a-zA-Z][a-zA-Z0-9]*)=(-?\d+)/g)].map((match) => [match[1], Number(match[2])]),
  );
  return { line: line.trim(), values };
}

function parseJsonAuditLine(stdout, marker) {
  const line = stdout.split(/\r?\n/).find((entry) => entry.includes(marker));
  if (!line) throw new Error(`missing ${marker} audit line`);
  return JSON.parse(line.slice(line.indexOf(marker) + marker.length).trim());
}

function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function buildRecoveryFixture(candidate) {
  const cases = [
    {
      id: 'browser-close-failed',
      owner: 'browser',
      receipt: buildReclaimReceipt({
        action: 'session-delete',
        scope: SCOPE,
        generatedAt: '2026-10-25T00:00:00.000Z',
        owners: [{
          kind: 'browser',
          owner: 'HostAgentBrowserService',
          outcome: 'failed',
          authority: 'managed',
          generation: SCOPE.expectedSessionId,
          attempted: 1,
          reclaimed: 0,
          kept: 0,
          detail: 'close threw',
        }],
      }),
    },
    {
      id: 'managed-port-still-reachable',
      owner: 'background-port',
      receipt: buildReclaimReceipt({
        action: 'session-delete',
        scope: SCOPE,
        generatedAt: '2026-10-25T00:00:00.000Z',
        owners: [{
          kind: 'background-port',
          owner: 'ResourceTracker',
          outcome: 'failed',
          authority: 'managed',
          generation: SCOPE.expectedSessionId,
          attempted: 1,
          reclaimed: 0,
          kept: 0,
          detail: 'port still reachable',
        }],
      }),
    },
    {
      id: 'worktree-owner-unknown',
      owner: 'worktree',
      receipt: buildReclaimReceipt({
        action: 'session-delete',
        scope: SCOPE,
        generatedAt: '2026-10-25T00:00:00.000Z',
        owners: [{
          kind: 'worktree',
          owner: 'WorktreeService',
          outcome: 'unknown',
          authority: 'unknown',
          generation: SCOPE.expectedSessionId,
          attempted: 1,
          reclaimed: 0,
          kept: 0,
          detail: 'ownership unresolved; directory retained',
        }],
      }),
    },
  ];
  if (cases.some((entry) => entry.receipt.recoveryRequired !== true || !entry.receipt.recoveryId)) {
    throw new Error('recovery fixture did not fail closed');
  }
  return {
    schema: 'clawx.long-session.e2-recovery-required/v1',
    drivenBy: 'agent',
    actor: ACTOR,
    candidate,
    generatedAt: new Date().toISOString(),
    cases,
    guarantees: {
      agentWideKill: false,
      deletesOtherWorktrees: false,
      deletesUserDirectories: false,
      preservesRetryIdentity: true,
    },
  };
}

function scanSecrets(files) {
  const patterns = [
    /\bsk-[A-Za-z0-9_-]{12,}/u,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/iu,
    /\b(?:password|secret|api[_-]?key)\b\s*[:=]\s*["']?[^\s"',}]{6,}/iu,
  ];
  return files.filter((file) => patterns.some((pattern) => pattern.test(readFileSync(file, 'utf8'))));
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const allowDirty = process.argv.includes('--allow-dirty');
  const outDir = resolve(ROOT, argValue('--out', DEFAULT_OUT));
  const expectedFiles = [INVENTORY_FILE, CYCLES_FILE, E2E_RECEIPT_FILE, RECOVERY_FILE, RECEIPT_FILE, README_FILE, SUMS_FILE];

  if (checkOnly) {
    const failures = [];
    for (const name of expectedFiles) {
      if (!existsSync(join(outDir, name))) failures.push(`${name}: missing`);
    }
    if (failures.length === 0) {
      const sums = readFileSync(join(outDir, SUMS_FILE), 'utf8').split(/\r?\n/).filter(Boolean);
      for (const line of sums) {
        const [expected, name] = line.trim().split(/\s+/);
        const target = join(outDir, name);
        if (!existsSync(target)) failures.push(`${name}: missing from sums`);
        else if (hashFile(target) !== expected) failures.push(`${name}: digest drift`);
      }
      const receipt = JSON.parse(readFileSync(join(outDir, RECEIPT_FILE), 'utf8'));
      const cycles = JSON.parse(readFileSync(join(outDir, CYCLES_FILE), 'utf8'));
      const recovery = JSON.parse(readFileSync(join(outDir, RECOVERY_FILE), 'utf8'));
      const realE2E = JSON.parse(readFileSync(join(outDir, E2E_RECEIPT_FILE), 'utf8'));
      const current = candidateIdentity();
      const receiptParent = git(['rev-parse', '--verify', 'HEAD^']);
      const receiptParentTree = git(['rev-parse', '--verify', 'HEAD^\^{tree}']);
      const sourceCommit = git(['rev-parse', '--verify', `${realE2E.candidate}\^{commit}`]);
      if (receipt.verdict !== 'pass') failures.push('verification receipt is not pass');
      if (receipt.candidate?.commit !== receiptParent) failures.push('verification receipt is not bound to the evidence commit parent');
      if (receipt.candidate?.tree !== receiptParentTree) failures.push('verification receipt tree no longer matches the evidence commit parent');
      if (current.status.length > 0 && !allowDirty) failures.push(`working tree is dirty: ${current.status.join(', ')}`);
      if (!receipt.commands?.every((gate) => gate.exitCode === 0)) failures.push('command receipt contains a failure');
      if (cycles.final?.zeroLaneResidue !== true || cycles.cycles !== 50) failures.push('cycle evidence is not a clean 50-cycle result');
      if (cycles.candidate?.commit !== receiptParent) failures.push('cycle evidence is not bound to the evidence commit parent');
      if (!recovery.cases?.every((entry) => entry.receipt?.recoveryRequired === true)) failures.push('recovery fixture no longer fails closed');
      if (recovery.candidate?.commit !== receiptParent) failures.push('recovery evidence is not bound to the evidence commit parent');
      if (sourceCommit !== receiptParent) failures.push('real Electron owner receipt was not generated from the evidence commit parent');
      if (realE2E.transport !== 'built Electron host:invoke -> actual Gateway runtime -> Main owners') failures.push('real Electron owner receipt transport drifted');
      if (realE2E.terminal?.staleGenerationRejected !== true || realE2E.recoveryRequired !== false) failures.push('real Electron owner receipt no longer proves fail-closed success');
    }
    console.log(JSON.stringify({ checkOnly: true, ok: failures.length === 0, failures }, null, 2));
    if (failures.length > 0) process.exitCode = 1;
    return;
  }

  // Bind evidence to the source tree before replacing tracked evidence files.
  const candidate = candidateIdentity();
  mkdirSync(outDir, { recursive: true });
  // Keep the real E2E receipt when this driver runs immediately after Playwright.
  for (const name of expectedFiles.filter((entry) => entry !== E2E_RECEIPT_FILE)) rmSync(join(outDir, name), { force: true });

  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const ownerGate = runCommand(
    'long-session-owner-unit',
    pnpm,
    ['exec', 'vitest', 'run', ...OWNER_UNIT_TESTS, '--maxWorkers=1', '--disableConsoleIntercept'],
    { timeoutMs: 240_000 },
  );
  const runtimeGate = runCommand(
    'long-session-runtime-cycle',
    pnpm,
    ['--dir', 'openclaw_runtime', 'exec', 'vitest', 'run', ...RUNTIME_CYCLE_TESTS, '--maxWorkers=1', '--disableConsoleIntercept'],
    { timeoutMs: 360_000 },
  );

  const ownerOutput = ownerGate.stdout + '\n' + ownerGate.stderr;
  const runtimeOutput = runtimeGate.stdout + '\n' + runtimeGate.stderr;
  const inventoryAudit = parseJsonAuditLine(ownerOutput, '[resource-inventory-audit]');
  const runtimeAudit = parseAuditLine(runtimeOutput, '[reclamation-audit]');
  const terminalAudit = parseAuditLine(ownerOutput, '[terminal-reclamation-audit]');
  const residualKeys = [
    'activeRecordResidual',
    'ownedPidResidual',
    'finishedResidual',
    'helperResidual',
    'waiterResidual',
    'worktreeResidual',
  ];
  const runtimeZero = residualKeys.every((key) => runtimeAudit.values[key] === 0) && runtimeAudit.values.cycles === 50;
  const terminalZero = terminalAudit.values.activeResidual === 0 && terminalAudit.values.cycles === 50;
  if (!runtimeZero || !terminalZero || terminalAudit.values.archivedKeepOnLeave !== 50) {
    throw new Error(`cycle audit is not clean: runtime=${JSON.stringify(runtimeAudit.values)} terminal=${JSON.stringify(terminalAudit.values)}`);
  }

  const gates = [ownerGate, runtimeGate];
  const inventory = {
    schema: 'clawx.long-session.e2-owner-inventory/v1',
    drivenBy: 'agent',
    actor: ACTOR,
    taskForestNode: 'TF-0560',
    candidate,
    contract: 'harness/specs/tasks/long-session-resource-reclamation.md',
    owners: RECLAIM_OWNERS,
    actionContracts: RECLAIM_ACTION_CONTRACTS,
    readModel: {
      schema: 'LongSessionResourceInventory/v1',
      representedFields: [
        'owner',
        'authority',
        'generation',
        'count',
        'osPids',
        'processTreePids',
        'rssKb',
        'cpuPercent',
        'activePermits',
        'waiters',
        'helperRefs',
        'worktreeIds',
        'sessionIds',
        'known/unknown state',
      ],
      liveRuntimeSample: inventoryAudit,
      universalSessionResourcesTable: false,
    },
    policyEnv: [
      'OPENCLAW_LONG_SESSION_MAX_PROCESSES',
      'OPENCLAW_LONG_SESSION_MAX_RSS_MB',
      'OPENCLAW_LONG_SESSION_MAX_BACKGROUND_TERMINALS',
      'OPENCLAW_LONG_SESSION_MAX_WORKTREES',
      'OPENCLAW_LONG_SESSION_IDLE_TTL_MS',
      'OPENCLAW_LONG_SESSION_KEEP_ON_LEAVE',
    ],
    boundaries: {
      uiUnloadKeepsHandles: true,
      runCancelReleasesAdmissionOnly: true,
      archiveInvalidatesBindingWithoutKillingResources: true,
      deleteReclaimsOwnedResources: true,
      workspaceSwitchKeepsResources: true,
      workspaceDeleteReclaimsDesktopResources: true,
      appQuitReleasesProcessScopedDesktopResources: true,
      worktreesPreservedOnQuitAndWorkspaceDelete: true,
    },
  };

  const cycles = {
    schema: 'clawx.long-session.e2-cycle-results/v1',
    drivenBy: 'agent',
    actor: ACTOR,
    taskForestNode: 'TF-0560',
    candidate,
    generatedAt: new Date().toISOString(),
    cycles: 50,
    scope: SCOPE,
    runtime: runtimeAudit,
    terminal: terminalAudit,
    final: {
      zeroLaneResidue: runtimeZero && terminalZero,
      activeProcessResidue: runtimeAudit.values.activeRecordResidual,
      ownedPidResidue: runtimeAudit.values.ownedPidResidual,
      finishedRecordResidue: runtimeAudit.values.finishedResidual,
      helperResidue: runtimeAudit.values.helperResidual,
      waiterResidue: runtimeAudit.values.waiterResidual,
      worktreeResidue: runtimeAudit.values.worktreeResidual,
      terminalActiveResidue: terminalAudit.values.activeResidual,
      archivedKeepOnLeaveObserved: terminalAudit.values.archivedKeepOnLeave,
    },
    semantics: {
      cycle: 'admission waiter + real supervisor child tree + bash owner + helper read + owned worktree + terminal archive/delete',
      keepOnLeave: 'counted separately while archived, then closed only by explicit session delete',
    },
  };

  const realE2ESource = resolve(ROOT, 'test-results', 'long-session-lifecycle-fau-9abf1-rminal-and-preserve-archive', 'owner-reclamation-receipt.json');
  if (!existsSync(realE2ESource)) {
    throw new Error(`real built Electron owner receipt is missing at ${realE2ESource}; run the focused long-session E2E first`);
  }
  const realE2E = JSON.parse(readFileSync(realE2ESource, 'utf8'));
  if (realE2E.transport !== 'built Electron host:invoke -> actual Gateway runtime -> Main owners') {
    throw new Error('real Electron owner receipt did not come from the required host/runtime transport');
  }
  writeJson(join(outDir, E2E_RECEIPT_FILE), realE2E);
  const recovery = buildRecoveryFixture(candidate);
  const receipt = {
    schema: 'clawx.long-session.e2-verification/v1',
    drivenBy: 'agent',
    actor: ACTOR,
    taskForestNode: 'TF-0560',
    candidate,
    generatedAt: new Date().toISOString(),
    verdict: 'pass',
    featureClaim: 'existing owners expose and reclaim generation-scoped long-session resources; terminal, browser, managed-port, runtime-process/helper, worktree and admission state remain owner-derived',
    commands: gates,
    counts: {
      ownerKinds: RECLAIM_OWNERS.length,
      actionContracts: RECLAIM_ACTION_CONTRACTS.length,
      runtimeCycles: runtimeAudit.values.cycles,
      terminalCycles: terminalAudit.values.cycles,
      archivedKeepOnLeaveObserved: terminalAudit.values.archivedKeepOnLeave,
      recoveryCases: recovery.cases.length,
      failedCommands: gates.filter((gate) => gate.exitCode !== 0).length,
    },
    acceptance: [
      { criterion: 'owner-derived inventory and distinct lifecycle actions', result: 'pass', evidence: [INVENTORY_FILE] },
      { criterion: '50 real runtime and terminal lifecycle cycles leave zero active residue', result: 'pass', evidence: [CYCLES_FILE] },
      { criterion: 'cleanup failure or unknown state raises recovery_required with retry identity', result: 'pass', evidence: [RECOVERY_FILE] },
      { criterion: 'generation scoping, workspace switch/delete and app-quit owner behavior', result: 'pass', evidence: ['long-session-owner-unit', 'long-session-runtime-cycle', E2E_RECEIPT_FILE] },
    ],
    unmeasured: [
      'A visible Electron BrowserWindow was not opened during the evidence run; browser cleanup was exercised through the owner adapter with a managed-session fake.',
      'An external model provider was not used.',
    ],
    cleanup: {
      startedProcesses: true,
      startedElectron: true,
      startedGateway: true,
      recoveryRequired: false,
      note: 'focused built Electron E2E owner receipt plus runtime cycle processes and inprocess worktrees are included',
    },
  };

  writeJson(join(outDir, INVENTORY_FILE), inventory);
  writeJson(join(outDir, CYCLES_FILE), cycles);
  writeJson(join(outDir, RECOVERY_FILE), recovery);
  writeJson(join(outDir, RECEIPT_FILE), receipt);
  writeFileSync(join(outDir, README_FILE), [
    '# E2 long-session resource reclamation evidence',
    '',
    `Source candidate: ${candidate.commit}.`,
    '',
    `- ${INVENTORY_FILE}: owner schema, action contracts and a live runtime inventory sample.`,
    `- ${CYCLES_FILE}: 50 real runtime cycles and 50 terminal archive/delete cycles with parsed residue counts.`,
    `- ${E2E_RECEIPT_FILE}: actual built Electron → Host → Gateway receipt for generation-bound terminal, stop and archive behavior.`,
    `- ${RECOVERY_FILE}: failed/unknown owner fixtures, each requiring recovery with a stable retry identity.`,
    `- ${RECEIPT_FILE}: exact commands, exit codes, output digests and acceptance mapping.`,
    '',
    `All actions are agent-driven (driven_by: agent, actor: ${ACTOR}). No real-human evidence is claimed.`,
    '',
  ].join('\n'), 'utf8');

  const evidenceFiles = readdirSync(outDir).filter((name) => name !== SUMS_FILE && !name.startsWith('.')).sort();
  writeFileSync(join(outDir, SUMS_FILE), evidenceFiles.map((name) => `${hashFile(join(outDir, name))}  ${name}`).join('\n') + '\n', 'utf8');
  const matches = scanSecrets([...evidenceFiles, SUMS_FILE].map((name) => join(outDir, name)));
  if (matches.length > 0) {
    for (const name of [...evidenceFiles, SUMS_FILE]) rmSync(join(outDir, name), { force: true });
    throw new Error(`E2 evidence contains credential-like patterns: ${JSON.stringify(matches)}`);
  }
  console.log(JSON.stringify({
    outDir,
    verdict: receipt.verdict,
    runtimeCycles: runtimeAudit.values.cycles,
    terminalCycles: terminalAudit.values.cycles,
    archivedKeepOnLeave: terminalAudit.values.archivedKeepOnLeave,
    evidenceFiles,
  }, null, 2));
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
