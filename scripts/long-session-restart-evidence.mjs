#!/usr/bin/env node
/**
 * F1 / TF-0561 evidence driver.
 *
 * Runs the long-session restart journey through a real built Electron app,
 * plus the existing real worker-completion and coordinator UI journeys, then
 * curates only receipts whose assertions were actually satisfied.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ACTOR = 'codex-long-session-f1';
const OUT_DIR = resolve(ROOT, 'harness/specs/fixtures/long-session-development/f1');
const EVIDENCE_BASE = resolve(process.env.CLAWX_F1_EVIDENCE_ROOT ?? 'D:/tmp/anchor-long-session-f1');
let RUN_ROOT = resolve(EVIDENCE_BASE, String(Date.now()));
const REQUIRED_E2E = [
  'tests/e2e/chat-session-handoff.spec.ts',
  'tests/e2e/chat-session-fork.spec.ts',
  'tests/e2e/chat-session-compact-range.spec.ts',
  'tests/e2e/runtime-lifecycle-governance.spec.ts',
  'tests/e2e/long-session-restart-journeys.spec.ts',
];
const OWNER_E2E = [
  'tests/e2e/long-session-completion-continuation.spec.ts',
  'tests/e2e/long-session-coordination.spec.ts',
];

function hashText(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function hashFile(file) { return createHash('sha256').update(readFileSync(file, 'utf8')).digest('hex'); }
function writeJson(file, value) { writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function git(args) {
  const result = spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', args, {
    cwd: ROOT, encoding: 'utf8', windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
function candidateIdentity() {
  return {
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    commit: git(['rev-parse', '--verify', 'HEAD']),
    tree: git(['rev-parse', '--verify', 'HEAD^{tree}']),
    worktree: ROOT.replaceAll('\\', '/'),
    status: git(['status', '--short']).split(/\r?\n/).filter(Boolean).filter((line) => !line.includes('harness/specs/fixtures/long-session-development/f1/')),
  };
}
function run(name, args, outputDir) {
  const startedAt = Date.now();
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : command,
    process.platform === 'win32' ? ['/d', '/c', command, ...args] : args, {
      cwd: ROOT,
      env: {
        ...process.env,
        TEMP: 'D:\\tmp',
        TMP: 'D:\\tmp',
        CLAWX_E2E_RUN_ROOT: join(RUN_ROOT, `${name}-run`),
      },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 900_000,
      maxBuffer: 32 * 1024 * 1024,
      shell: false,
    });
  const gate = {
    name,
    command: [command, ...args].join(' '),
    exitCode: result.status,
    signal: result.signal ?? null,
    timedOut: result.error?.code === 'ETIMEDOUT' || Boolean(result.signal),
    durationMs: Date.now() - startedAt,
    stdoutSha256: hashText(result.stdout ?? ''),
    stderrSha256: hashText(result.stderr ?? ''),
    outputDir: outputDir ? relative(ROOT, outputDir).replaceAll('\\', '/') : null,
    stderrTail: (result.stderr ?? '').slice(-4000),
  };
  if (gate.exitCode !== 0) throw new Error(`${name} failed (${gate.exitCode ?? gate.signal}): ${gate.stderrTail || 'no stderr'}`);
  return gate;
}
function findFile(root, name) {
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const child = join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(child, name);
      if (found) return found;
    } else if (entry.name === name) return child;
  }
  return null;
}
function requireFile(root, name) {
  const file = findFile(root, name);
  if (!file) throw new Error(`missing evidence artifact ${name} under ${root}`);
  return file;
}
function normalizedF1(raw, rawSha256) {
  const j = raw.journeys ?? {};
  return {
    schema: 'clawx.long-session.restart-journeys.curated/v1',
    driven_by: 'agent',
    actor: ACTOR,
    transport: raw.transport,
    rawReceiptSha256: rawSha256,
    evidenceLevels: raw.evidenceLevels,
    journeys: {
      realProviderTurn: j.realProviderTurn,
      gatewayRestart: j.gatewayRestart,
      appRestart: j.appRestart,
      forkCompactHandoff: j.forkCompactHandoff,
      archiveRestore: {
        archived: j.archiveRestore?.archived,
        archivedSessionKey: j.archiveRestore?.archiveEntry?.sessionKey,
        archivedGeneration: j.archiveRestore?.archivedGeneration,
        restoredGeneration: j.archiveRestore?.restoredGeneration,
        restoredHistory: j.archiveRestore?.restoredHistory,
      },
      isolation: j.isolation,
      lifecycleNegative: j.lifecycleNegative,
      dualWorkerBatch: j.dualWorkerBatch,
    },
    unmeasured: raw.unmeasured,
  };
}
function normalizedBatch(raw, rawSha256) {
  const batch = raw.terminalBatch;
  const replay = raw.restartReplay;
  const fenced = raw.resetFence;
  return {
    rawReceiptSha256: rawSha256,
    orchestrationRunId: raw.first?.orchestrationRunId ?? null,
    terminal: batch ? { batchId: batch.batchId, status: batch.status, outcome: batch.outcome, generationState: batch.generationState, counts: batch.counts, delivery: batch.delivery, members: batch.members, consolidatedReceiptId: batch.consolidatedReceiptId } : null,
    duplicateReplay: { status: raw.duplicate?.status, replayed: raw.duplicate?.replayed, orchestrationRunId: raw.duplicate?.orchestrationRunId ?? null },
    restartReplay: replay ? { batchId: replay.batchId, status: replay.status, consolidatedReceiptId: replay.consolidatedReceiptId, members: replay.members } : null,
    staleFence: fenced ? { batchId: fenced.batchId, status: fenced.status, outcome: fenced.outcome, generationState: fenced.generationState, consolidatedReceiptId: fenced.consolidatedReceiptId } : null,
    unsupportedBackend: raw.unsupportedBackend,
    unknownWorker: raw.unknownWorker,
    transport: raw.transport,
  };
}
function checkNormalized(f1, batch) {
  const failures = [];
  if (f1.journeys.realProviderTurn?.requests < 1 || f1.journeys.realProviderTurn?.transcriptReadback !== true) failures.push('real provider turn missing');
  if (f1.journeys.gatewayRestart?.beforePid === f1.journeys.gatewayRestart?.afterPid || f1.journeys.gatewayRestart?.transcriptReadback !== true) failures.push('Gateway restart not proven');
  if (f1.journeys.appRestart?.transcriptReadback !== true || f1.journeys.appRestart?.taskLedgerReadback !== true) failures.push('App restart readback missing');
  if (f1.journeys.forkCompactHandoff?.compact !== true || f1.journeys.forkCompactHandoff?.compacted !== true || !f1.journeys.forkCompactHandoff?.forkKey || !f1.journeys.forkCompactHandoff?.handoffKey) failures.push('fork/compact/handoff missing');
  if (f1.journeys.archiveRestore?.archived !== true || !f1.journeys.archiveRestore?.restoredGeneration || f1.journeys.archiveRestore?.restoredGeneration === f1.journeys.archiveRestore?.archivedGeneration) failures.push('archive/restore generation not proven');
  if (f1.journeys.isolation?.workspaces !== 2 || f1.journeys.isolation?.ordinarySessions !== 1 || f1.journeys.isolation?.crossWorkspaceNodes !== 0 || f1.journeys.isolation?.taskLinksForOrdinarySession !== 0) failures.push('isolation counters not clean');
  if (f1.journeys.lifecycleNegative?.duplicateRestoreRejected !== true || f1.journeys.lifecycleNegative?.ordinaryDeleteDidNotTouchSource !== true) failures.push('lifecycle negatives missing');
  if (f1.journeys.dualWorkerBatch?.counts?.expected !== 2 || f1.journeys.dualWorkerBatch?.counts?.settled !== 2 || f1.journeys.dualWorkerBatch?.status !== 'terminal') failures.push('dual worker terminal batch missing');
  if (batch.terminal?.status !== 'terminal' || !batch.terminal?.consolidatedReceiptId) failures.push('worker completion receipt missing');
  if (batch.duplicateReplay?.replayed !== true || batch.restartReplay?.consolidatedReceiptId !== batch.terminal?.consolidatedReceiptId) failures.push('duplicate/restart worker replay not stable');
  if (batch.staleFence?.status !== 'fenced' || batch.staleFence?.generationState !== 'mismatch' || batch.staleFence?.consolidatedReceiptId !== null) failures.push('stale batch not fenced');
  if (batch.unknownWorker?.status !== 'rejected' || batch.unknownWorker?.phantomChildCreated !== false) failures.push('unknown worker negative missing');
  if (failures.length > 0) throw new Error(`F1 evidence contradictions: ${failures.join('; ')}`);
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const allowDirty = process.argv.includes('--allow-dirty');
  const candidate = candidateIdentity();
  const names = ['restart-journey-results.json', 'host-runtime-receipts.json', 'ui-evidence-index.json', 'SHA256SUMS'];
  if (checkOnly) {
    const failures = [];
    for (const name of names) if (!existsSync(join(OUT_DIR, name))) failures.push(`${name}: missing`);
    if (candidate.status.length > 0 && !allowDirty) failures.push(`working tree dirty: ${candidate.status.join(', ')}`);
    if (failures.length === 0) {
      for (const line of readFileSync(join(OUT_DIR, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/)) {
        const [expected, name] = line.trim().split(/\s+/);
        if (hashFile(join(OUT_DIR, name)) !== expected) failures.push(`${name}: digest drift`);
      }
      const f1 = JSON.parse(readFileSync(join(OUT_DIR, 'restart-journey-results.json'), 'utf8'));
      const runtime = JSON.parse(readFileSync(join(OUT_DIR, 'host-runtime-receipts.json'), 'utf8'));
      if (f1.candidate?.commit !== candidate.commit && !allowDirty) failures.push('F1 receipt not bound to HEAD');
      if (runtime.candidate?.commit !== candidate.commit && !allowDirty) failures.push('runtime receipt not bound to HEAD');
      try { checkNormalized(f1, runtime.commandJourneys?.dualWorkerBatch ?? {}); } catch (error) { failures.push(String(error.message)); }
    }
    console.log(JSON.stringify({ checkOnly: true, ok: failures.length === 0, failures }, null, 2));
    if (failures.length > 0) process.exitCode = 1;
    return;
  }

  const reuseIndex = process.argv.indexOf('--reuse');
  const reuseRoot = reuseIndex >= 0 ? process.argv[reuseIndex + 1]?.trim() : '';
  const gates = [];
  if (reuseRoot) {
    RUN_ROOT = resolve(reuseRoot);
  } else {
    RUN_ROOT = resolve(EVIDENCE_BASE, String(Date.now()));
    mkdirSync(RUN_ROOT, { recursive: true });
    gates.push(run('required-e2e', ['exec', 'playwright', 'test', ...REQUIRED_E2E, '--workers=1', '--output', join(RUN_ROOT, 'required')], join(RUN_ROOT, 'required')));
    gates.push(run('owner-journeys', ['exec', 'playwright', 'test', ...OWNER_E2E, '--workers=1', '--output', join(RUN_ROOT, 'owners')], join(RUN_ROOT, 'owners')));
  }
  for (const name of names) rmSync(join(OUT_DIR, name), { force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const f1Source = requireFile(join(RUN_ROOT, 'required'), 'restart-journey-results.json');
  const batchSource = requireFile(join(RUN_ROOT, 'owners'), 'completion-continuation-e2e.json');
  const uiSource = requireFile(join(RUN_ROOT, 'owners'), 'coordination-ui-journey.json');
  const uiScreens = requireFile(join(RUN_ROOT, 'owners'), 'coordination-ui-screenshots.json');
  const f1Raw = JSON.parse(readFileSync(f1Source, 'utf8'));
  const batchRaw = JSON.parse(readFileSync(batchSource, 'utf8'));
  const uiRaw = JSON.parse(readFileSync(uiSource, 'utf8'));
  const uiScreensRaw = JSON.parse(readFileSync(uiScreens, 'utf8'));
  const f1 = { candidate, ...normalizedF1(f1Raw, hashFile(f1Source)) };
  const runtime = {
    schema: 'clawx.long-session.host-runtime-receipts/v1',
    driven_by: 'agent', actor: ACTOR, candidate,
    commandJourneys: { dualWorkerBatch: normalizedBatch(batchRaw, hashFile(batchSource)) },
    uiOwnerRead: { windowLifecycle: uiRaw.observed?.windowLifecycle, ownerReads: uiRaw.observed?.ownerReads, quietWindow: uiRaw.observed?.quietWindow, taskLedgerNavigation: uiRaw.observed?.taskLedgerNavigation, workerNavigation: uiRaw.observed?.workerNavigation },
    limitations: uiRaw.limitations,
  };
  const ui = {
    schema: 'clawx.long-session.ui-evidence-index/v1',
    driven_by: 'agent', actor: ACTOR, candidate,
    sourceReceiptSha256: hashFile(uiSource),
    screenshots: uiScreensRaw.screenshots,
    evidenceLevel: 'real built Electron Chat ResourceChip -> Host API -> actual Main owner',
    limitations: ['visual rendering is supporting evidence; lifecycle assertions are host-owner readbacks'],
  };
  checkNormalized(f1, runtime.commandJourneys.dualWorkerBatch);
  writeJson(join(OUT_DIR, 'restart-journey-results.json'), f1);
  writeJson(join(OUT_DIR, 'host-runtime-receipts.json'), runtime);
  writeJson(join(OUT_DIR, 'ui-evidence-index.json'), ui);
  const files = ['restart-journey-results.json', 'host-runtime-receipts.json', 'ui-evidence-index.json'];
  writeFileSync(join(OUT_DIR, 'SHA256SUMS'), files.map((name) => `${hashFile(join(OUT_DIR, name))}  ${name}`).join('\n') + '\n', 'utf8');
  console.log(JSON.stringify({ outDir: OUT_DIR, candidate, gates, artifacts: files }, null, 2));
}
if (isMainEntrypoint(import.meta.url)) main().catch((error) => { console.error(error); process.exitCode = 1; });
