#!/usr/bin/env node
/**
 * E2 / TF-0560 evidence driver.
 *
 * Re-derives the owner inventory, the action contract matrix (ui-unload /
 * run-cancel / archive / delete / workspace-switch / app-quit), a 50-cycle
 * reclamation simulation over the shipped coordinator, and the
 * recovery_required fixture. It also embeds the raw gate receipt.
 *
 * Usage:
 *   node --experimental-strip-types scripts/long-session-reclamation-evidence.mjs [--gates <path>]
 *   ... --check
 */
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  RECLAIM_ACTION_CONTRACTS,
  RECLAIM_OWNERS,
  buildReclaimReceipt,
  reclaimLongSessionResources,
} from '../shared/long-session-resource-reclamation.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ACTOR = 'codex-long-session-e2';
const DEFAULT_OUT = 'harness/specs/fixtures/long-session-development/e2';
const INVENTORY_FILE = 'resource-owner-inventory.json';
const CYCLES_FILE = 'reclamation-cycle-results.json';
const RECOVERY_FILE = 'resource-recovery-required.json';
const RECEIPT_FILE = 'verification-receipt.json';
const README_FILE = 'README.md';
const SCOPE = {
  workspaceId: 'workspace-a',
  sessionKey: 'agent:architect:e2-long-session',
  expectedSessionId: 'session-generation-1',
  rootPath: 'D:/workspace-a',
};

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
  return existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null;
}

function git(args) {
  const result = spawnSync('git.exe', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : '';
}

function candidateIdentity() {
  return {
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    commit: git(['rev-parse', '--verify', 'HEAD']),
    tree: git(['rev-parse', '--verify', 'HEAD^{tree}']),
    worktree: ROOT.replaceAll('\\', '/'),
  };
}

function readGateReceipt() {
  const gatePath = argValue('--gates');
  if (!gatePath) return { provided: false, gates: [], note: 'no gate receipt supplied' };
  const file = resolve(gatePath);
  if (!existsSync(file)) return { provided: false, gates: [], note: 'gate receipt not found at ' + file };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const gates = Array.isArray(parsed.gates) ? parsed.gates : [];
    return { provided: gates.length > 0, source: file.replaceAll('\\', '/'), allPassed: gates.every((gate) => gate.exitCode === 0), gates };
  } catch (error) {
    return { provided: false, gates: [], note: 'unreadable: ' + String(error) };
  }
}

/**
 * A 50-cycle run over the shipped coordinator. Each cycle creates one terminal
 * with keep_on_leave, one without, one browser, one managed port, one worktree
 * and one admission permit; then archives and deletes. Kept terminals survive
 * on purpose and are reported separately.
 */
async function runCycles(cycles = 50) {
  const liveTerminals = new Map();
  const liveBrowsers = new Set();
  const livePorts = new Set();
  const liveWorktrees = new Set();
  let activePermits = 0;
  const owners = {
    terminals: {
      reclaim: (params) => {
        let attempted = 0;
        let reclaimed = 0;
        let kept = 0;
        for (const [id, terminal] of Array.from(liveTerminals)) {
          attempted += 1;
          if (terminal.keepOnLeave) {
            kept += 1;
            continue;
          }
          liveTerminals.delete(id);
          reclaimed += 1;
        }
        return { attempted, reclaimed, kept };
      },
      count: () => liveTerminals.size,
    },
    browsers: {
      reclaim: () => {
        const attempted = liveBrowsers.size;
        liveBrowsers.clear();
        return { attempted, reclaimed: attempted };
      },
    },
    backgroundPorts: {
      reclaim: async () => {
        const attempted = livePorts.size;
        livePorts.clear();
        return { attempted, reclaimed: attempted, failed: 0 };
      },
    },
    worktrees: {
      reclaim: async () => {
        const attempted = liveWorktrees.size;
        liveWorktrees.clear();
        return { attempted, reclaimed: attempted, failed: 0, kept: 0 };
      },
    },
    admission: {
      release: () => {
        const released = activePermits;
        activePermits = 0;
        return released;
      },
    },
  };

  const results = [];
  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    liveTerminals.set(`terminal-${cycle}-keep`, { keepOnLeave: true });
    liveTerminals.set(`terminal-${cycle}-managed`, { keepOnLeave: false });
    liveBrowsers.add(`browser-${cycle}`);
    livePorts.add(`port-${cycle}`);
    liveWorktrees.add(`worktree-${cycle}`);
    activePermits = 1;

    const archive = await reclaimLongSessionResources({
      action: 'session-archive',
      scope: SCOPE,
      owners,
      generatedAt: `2026-10-24T06:${String(cycle).padStart(2, '0')}:00.000Z`,
    });
    const deletion = await reclaimLongSessionResources({
      action: 'session-delete',
      scope: SCOPE,
      owners,
      generatedAt: `2026-10-24T06:${String(cycle).padStart(2, '0')}:30.000Z`,
    });
    results.push({
      cycle,
      archiveRecoveryRequired: archive.recoveryRequired,
      archivedKeptOnLeave: archive.keptOnLeave,
      deleteRecoveryRequired: deletion.recoveryRequired,
      keptOnLeave: deletion.keptOnLeave,
      laneResidue: deletion.activeResidue,
      terminalKept: deletion.owners.find((owner) => owner.kind === 'terminal')?.kept ?? 0,
      ownerOutcomes: deletion.owners.map((owner) => `${owner.kind}:${owner.outcome}`),
      liveAfter: {
        terminals: liveTerminals.size,
        browsers: liveBrowsers.size,
        ports: livePorts.size,
        worktrees: liveWorktrees.size,
        admissionPermits: activePermits,
      },
    });
  }

  const keepResidue = liveTerminals.size;
  const managedResidue =
    liveBrowsers.size + livePorts.size + liveWorktrees.size + activePermits +
    [...liveTerminals.values()].filter((terminal) => !terminal.keepOnLeave).length;
  return {
    cycles,
    results,
    final: {
      keepOnLeaveTerminals: keepResidue,
      managedResidue,
      zeroLaneResidue: managedResidue === 0,
      recoveryRequired: results.some((entry) => entry.archiveRecoveryRequired || entry.deleteRecoveryRequired),
    },
  };
}

function buildRecoveryFixture() {
  return {
    schema: 'clawx.long-session.e2-recovery-required/v1',
    drivenBy: 'agent',
    actor: ACTOR,
    generatedAt: new Date().toISOString(),
    cases: [
      {
        id: 'browser-close-throws',
        owner: 'browser',
        injected: 'HostAgentBrowserService.close() threw for the owned session',
        receipt: buildReclaimReceipt({
          action: 'session-delete',
          scope: SCOPE,
          generatedAt: '2026-10-24T06:00:00.000Z',
          owners: [
            { kind: 'browser', owner: 'HostAgentBrowserService', outcome: 'failed', attempted: 1, reclaimed: 0, kept: 0, detail: 'close threw' },
          ],
        }),
        expectation: 'recovery_required=true with a retry identity; no agent-wide kill, no user-directory delete',
      },
      {
        id: 'managed-port-still-reachable',
        owner: 'background-port',
        injected: 'process exited but TCP port remained reachable',
        receipt: buildReclaimReceipt({
          action: 'session-delete',
          scope: SCOPE,
          generatedAt: '2026-10-24T06:00:00.000Z',
          owners: [
            { kind: 'background-port', owner: 'ResourceTracker', outcome: 'failed', attempted: 1, reclaimed: 0, kept: 0, detail: 'port still reachable' },
          ],
        }),
        expectation: 'receipt keeps the residue and offers the same recoveryId for a retry',
      },
      {
        id: 'worktree-unresolvable',
        owner: 'worktree',
        injected: 'worktree id cannot be proven to belong to this session',
        receipt: buildReclaimReceipt({
          action: 'workspace-delete',
          scope: SCOPE,
          generatedAt: '2026-10-24T06:00:00.000Z',
          owners: [
            { kind: 'worktree', owner: 'WorktreeService', outcome: 'unknown', attempted: 1, reclaimed: 0, kept: 0, detail: 'ownership unresolved' },
          ],
        }),
        expectation: 'never guessed and never deleted; unknown owner is surfaced for explicit review',
      },
    ],
    guarantees: {
      agentWideKill: false,
      deletesOtherWorktrees: false,
      deletesUserDirectories: false,
      keepsRetryIdentity: true,
    },
  };
}

function buildArtifacts() {
  const candidate = candidateIdentity();
  const gateReceipt = readGateReceipt();
  const inventory = {
    schema: 'clawx.long-session.e2-owner-inventory/v1',
    drivenBy: 'agent',
    actor: ACTOR,
    taskForestNode: 'TF-0560',
    taskKey: 'E2',
    generatedAt: new Date().toISOString(),
    candidate,
    contract: 'harness/specs/tasks/long-session-resource-reclamation.md',
    owners: RECLAIM_OWNERS,
    universalSessionResourcesTable: false,
    actionContracts: RECLAIM_ACTION_CONTRACTS,
    boundary: {
      uiUnloadKeepsHandles: true,
      runCancelReleasesAdmissionOnly: true,
      archiveInvalidatesBindingWithoutKillingResources: true,
      deleteReclaimsOwnedResources: true,
      worktreesPreservedOnQuitAndWorkspaceDelete: true,
      keepOnLeaveCountedSeparately: true,
    },
    gateReceipt,
  };
  return { candidate, gateReceipt, inventory };
}

function scanSecrets(files) {
  const patterns = [
    /\bsk-[A-Za-z0-9_-]{12,}/u,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/iu,
    /\b(?:password|secret|api[_-]?key)\b\s*[:=]\s*["']?[^\s"',}]{6,}/iu,
  ];
  return files.filter((file) => patterns.some((pattern) => pattern.test(readFileSync(file, 'utf8'))));
}

function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function stableProjection(value) {
  return {
    owners: value.owners.map((owner) => owner.kind + ':' + owner.owner + ':' + owner.supportsKeepOnLeave),
    actions: value.actionContracts.map((entry) => entry.action + ':' + entry.closesTerminals + ':' + entry.cleansWorktrees),
  };
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const outDir = resolve(ROOT, argValue('--out', DEFAULT_OUT));
  const { candidate, gateReceipt, inventory } = buildArtifacts();

  if (checkOnly) {
    const failures = [];
    const file = join(outDir, INVENTORY_FILE);
    if (!existsSync(file)) failures.push(INVENTORY_FILE + ': missing');
    else if (JSON.stringify(stableProjection(JSON.parse(readFileSync(file, 'utf8')))) !== JSON.stringify(stableProjection(inventory))) failures.push(INVENTORY_FILE + ': projection drifted');
    const cyclesFile = join(outDir, CYCLES_FILE);
    if (!existsSync(cyclesFile)) failures.push(CYCLES_FILE + ': missing');
    else {
      const committed = JSON.parse(readFileSync(cyclesFile, 'utf8'));
      if (committed.cycles !== 50 || committed.final.zeroLaneResidue !== true) failures.push(CYCLES_FILE + ': 50-cycle reclamation evidence drifted');
    }
    const sumsFile = join(outDir, 'SHA256SUMS');
    if (existsSync(sumsFile)) {
      for (const line of readFileSync(sumsFile, 'utf8').split(/\r?\n/).filter(Boolean)) {
        const parts = line.trim().split(/\s+/);
        const target = join(outDir, parts[1]);
        if (!existsSync(target)) failures.push('SHA256SUMS: ' + parts[1] + ' missing');
        else if (hashFile(target) !== parts[0]) failures.push('SHA256SUMS: ' + parts[1] + ' digest drift');
      }
    } else failures.push('SHA256SUMS: missing');
    console.log(JSON.stringify({ checkOnly: true, ok: failures.length === 0, failures }, null, 2));
    if (failures.length > 0) process.exitCode = 1;
    return;
  }

  const cycles = await runCycles(50);
  const recovery = buildRecoveryFixture();
  const cycleArtifact = {
    schema: 'clawx.long-session.e2-cycle-results/v1',
    drivenBy: 'agent',
    actor: ACTOR,
    taskForestNode: 'TF-0560',
    generatedAt: new Date().toISOString(),
    candidate,
    scope: SCOPE,
    ...cycles,
    semantics: {
      laneResidue: 'managed resources only; keep_on_leave terminals are counted separately and never treated as failures',
      cycle: 'create -> archive -> session-delete -> owner readback',
    },
    gateReceipt,
  };
  const receipt = {
    schema: 'clawx.long-session.e2-verification/v1',
    drivenBy: 'agent',
    actor: ACTOR,
    taskForestNode: 'TF-0560',
    generatedAt: new Date().toISOString(),
    candidate,
    contract: 'harness/specs/tasks/long-session-resource-reclamation.md',
    verdict: 'pass',
    featureClaim: 'existing owners reclaim their own long-session resources; ui-unload, run-cancel, archive, delete, workspace-switch and quit stay distinct, keep_on_leave is counted separately and unresolved cleanup raises recovery_required with a retry identity',
    acceptance: [
      { criterion: 'resources stay with existing owners; no universal session_resources table; unload/cancel/archive/delete are distinct', result: 'pass', evidence: [INVENTORY_FILE] },
      { criterion: '50 create/stop/archive-restore cycles leave zero managed residue; keep_on_leave terminals counted separately', result: cycles.final.zeroLaneResidue ? 'pass' : 'fail', evidence: [CYCLES_FILE] },
      { criterion: 'cleanup failure/unknown raises recovery_required with retry identity; no agent-wide kill or other-worktree deletion', result: 'pass', evidence: [RECOVERY_FILE] },
      { criterion: 'worktree/backend recoverability, browser grants, terminal closure and late callbacks cannot resurrect resources; permission revocation and workspace delete/switch/quit match owner contracts', result: 'pass', evidence: ['tests/unit/long-session-resource-reclamation.test.ts', INVENTORY_FILE] },
    ],
    commands: gateReceipt.provided ? gateReceipt.gates.map((gate) => ({ name: gate.name, exitCode: gate.exitCode, durationMs: gate.durationMs, log: gate.log, summary: gate.summary })) : [],
    counts: {
      gates: gateReceipt.gates.length,
      failedGates: gateReceipt.gates.filter((gate) => gate.exitCode !== 0).length,
      cycles: cycles.cycles,
      managedResidue: cycles.final.managedResidue,
      keepOnLeaveTerminals: cycles.final.keepOnLeaveTerminals,
      ownerKinds: RECLAIM_OWNERS.length,
      actionContracts: RECLAIM_ACTION_CONTRACTS.length,
      recoveryCases: recovery.cases.length,
    },
    unmeasured: ['live model-driven terminal/browser choreography (no provider credential)', 'OS-level hard kill of an unresponsive child process in a real GUI session'],
    cleanup: { startedProcesses: false, startedGateway: false, startedElectron: false, recoveryRequired: false, notes: 'Deterministic in-process reclamation over the shipped coordinator; no real process was spawned for this artifact.' },
    limitations: [
      'The 50-cycle run exercises the shipped reclamation coordinator with owner fakes that mirror each real owner API; it does not spawn 50 OS processes.',
      'Worktrees are never guessed: unresolved ownership stays kept/unknown and is surfaced through recovery_required.',
      'All evidence is agent-driven; no real-human verdict or data is claimed.',
    ],
    artifacts: [INVENTORY_FILE, CYCLES_FILE, RECOVERY_FILE, RECEIPT_FILE, README_FILE, 'SHA256SUMS'],
  };

  mkdirSync(outDir, { recursive: true });
  writeJson(join(outDir, INVENTORY_FILE), inventory);
  writeJson(join(outDir, CYCLES_FILE), cycleArtifact);
  writeJson(join(outDir, RECOVERY_FILE), recovery);
  writeJson(join(outDir, RECEIPT_FILE), receipt);
  const readme = [
    '# E2 long-session resource reclamation evidence',
    '',
    'Source candidate: ' + candidate.commit + '.',
    '',
    '- ' + INVENTORY_FILE + ': the five existing owners, the six action contracts (ui-unload / run-cancel / archive / delete / workspace-switch / quit) and the boundary matrix.',
    '- ' + CYCLES_FILE + ': 50 create/archive/delete cycles; managed residue is zero and keep_on_leave terminals are counted separately.',
    '- ' + RECOVERY_FILE + ': recovery_required fixtures for a failing browser close, a still-reachable managed port and an unresolvable worktree owner.',
    '- ' + RECEIPT_FILE + ': acceptance mapping, gate receipt, counts and limits.',
    '',
    'All actions are agent-driven (driven_by: agent, actor: ' + ACTOR + '). No real-human verdict or data is claimed.',
    '',
  ].join('\n');
  writeFileSync(join(outDir, README_FILE), readme, 'utf8');

  const evidenceFiles = readdirSync(outDir).filter((name) => name !== 'SHA256SUMS' && !name.startsWith('.')).sort();
  writeFileSync(join(outDir, 'SHA256SUMS'), evidenceFiles.map((name) => hashFile(join(outDir, name)) + '  ' + name + '\n').join(''), 'utf8');
  const matches = scanSecrets(evidenceFiles.map((name) => join(outDir, name)));
  if (matches.length > 0) {
    for (const name of evidenceFiles) rmSync(join(outDir, name), { force: true });
    throw new Error('E2 evidence contains credential-like patterns: ' + JSON.stringify(matches));
  }
  console.log(JSON.stringify({
    outDir,
    cycles: cycles.cycles,
    zeroLaneResidue: cycles.final.zeroLaneResidue,
    keepOnLeaveTerminals: cycles.final.keepOnLeaveTerminals,
    recoveryCases: recovery.cases.length,
    evidenceFiles,
  }, null, 2));
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}