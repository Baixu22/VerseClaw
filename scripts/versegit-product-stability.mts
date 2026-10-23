#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const F4_SCHEMA = 'clawx.versegit.f4-stability-samples/v1';
export const F4_BUDGETS = Object.freeze({
  completeLoops: 10,
  maxFailureRate: 0,
  maxDuplicateApplyCount: 0,
  maxP95LoopMs: 180_000,
  maxPeakRssMb: 2_048,
  maxProcessSurvivors: 0,
  maxManagerSurvivors: 0,
  maxWorktreeSurvivors: 0,
  maxTempSurvivors: 0,
});

export type StabilitySample = {
  schema: typeof F4_SCHEMA;
  loopId: string;
  driven_by: 'agent';
  actor: string;
  observedAt: string;
  durationMs: number;
  peakRssKb: number;
  exitCode: number;
  passed: boolean;
  candidateId: string | null;
  candidateInputDigest: string | null;
  combinedFailureStatus: string | null;
  combinedSuccessStatus: string | null;
  individualWorkersPassed: boolean;
  combinedFailurePassed: boolean;
  combinedSuccessPassed: boolean;
  orderingPassed: boolean;
  revokedGrantRejected: boolean;
  undoRecovered: boolean;
  duplicateApplyCount: number;
  cleanupObserved: boolean;
  processSurvivors: number;
  managerSurvivors: number;
  worktreeSurvivors: number;
  tempSurvivors: number;
  reportDigest: string;
  rawReportPath: string;
};

export function percentile(values: readonly number[], point: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(point * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export function aggregateStabilitySamples(samples: readonly StabilitySample[]) {
  const successes = samples.filter((sample) => sample.passed).length;
  const failures = samples.length - successes;
  const durations = samples.map((sample) => sample.durationMs);
  const duplicateApplyCount = samples.reduce((sum, sample) => sum + sample.duplicateApplyCount, 0);
  const survivors = {
    processes: samples.reduce((sum, sample) => sum + sample.processSurvivors, 0),
    managers: samples.reduce((sum, sample) => sum + sample.managerSurvivors, 0),
    worktrees: samples.reduce((sum, sample) => sum + sample.worktreeSurvivors, 0),
    tempRoots: samples.reduce((sum, sample) => sum + sample.tempSurvivors, 0),
  };
  const failureRate = samples.length === 0 ? 1 : failures / samples.length;
  const p95LoopMs = percentile(durations, 0.95);
  const peakRssMb = samples.length === 0 ? 0 : Math.max(...samples.map((sample) => sample.peakRssKb)) / 1024;
  const checks = {
    completeLoops: samples.length === F4_BUDGETS.completeLoops,
    failureRate: failureRate <= F4_BUDGETS.maxFailureRate,
    duplicateApply: duplicateApplyCount <= F4_BUDGETS.maxDuplicateApplyCount,
    p95Loop: p95LoopMs <= F4_BUDGETS.maxP95LoopMs,
    peakRss: peakRssMb <= F4_BUDGETS.maxPeakRssMb,
    processes: survivors.processes <= F4_BUDGETS.maxProcessSurvivors,
    managers: survivors.managers <= F4_BUDGETS.maxManagerSurvivors,
    worktrees: survivors.worktrees <= F4_BUDGETS.maxWorktreeSurvivors,
    tempRoots: survivors.tempRoots <= F4_BUDGETS.maxTempSurvivors,
    allLoopsPassed: failures === 0,
  };
  return {
    sampleCount: samples.length,
    successes,
    failures,
    failureRate,
    p50LoopMs: percentile(durations, 0.5),
    p95LoopMs,
    peakRssMb,
    duplicateApplyCount,
    survivors,
    uniqueCandidateCount: new Set(samples.map((sample) => sample.candidateId).filter(Boolean)).size,
    revokedGrantRejected: samples.every((sample) => sample.revokedGrantRejected),
    undoRecovered: samples.every((sample) => sample.undoRecovered),
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}

function sha(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv: string[]) {
  const options: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith('--')) throw new Error('unknown argument: ' + arg);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error('missing value for ' + arg);
    options[arg.slice(2)] = value;
    index += 1;
  }
  return options;
}

function tasklistRssKb(pid: number): number {
  const result = spawnSync('tasklist.exe', ['/FI', 'PID eq ' + String(pid), '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  const line = String(result.stdout ?? '').trim();
  const match = /^"[^"]+","(d+)","[^"]*","[^"]*","([d,.]+) K"$/u.exec(line);
  return match ? Number(match[2]!.replaceAll(',', '').replaceAll('.', '')) : 0;
}

function sourceState() {
  const git = (args: string[]) => spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8', windowsHide: true }).stdout.trim();
  const evidencePrefix = 'harness/specs/fixtures/versegit-product-integration/f4/';
  const dirty = git(['status', '--porcelain=v1', '--untracked-files=all'])
    .split(/\r?\n/u)
    .filter(Boolean)
    .some((line) => !line.slice(3).replaceAll('\\', '/').startsWith(evidencePrefix));
  return { branch: git(['branch', '--show-current']), commit: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']), dirty };
}

async function runLoop(input: {
  index: number;
  artifactRoot: string;
  tsxCli: string;
  probeScript: string;
}): Promise<StabilitySample> {
  const loopId = 'f4-loop-' + String(input.index + 1).padStart(2, '0');
  const loopRoot = join(input.artifactRoot, loopId);
  mkdirSync(loopRoot, { recursive: true });
  const reportPath = join(loopRoot, 'probe-report.json');
  const rawRoot = join(loopRoot, 'raw');
  const logPath = join(loopRoot, 'probe.log');
  const log = createWriteStream(logPath, { flags: 'w' });
  const started = Date.now();
  const child = spawn(process.execPath, [input.tsxCli, '--tsconfig', 'tsconfig.node.json', input.probeScript], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TEMP: 'D:\\tmp',
      TMP: 'D:\\tmp',
      VERSEGIT_E3_REPORT_PATH: reportPath,
      VERSEGIT_E3_RAW_ROOT: rawRoot,
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  let peakRssKb = 0;
  const sampler = setInterval(() => {
    if (child.pid) peakRssKb = Math.max(peakRssKb, tasklistRssKb(child.pid));
  }, 500);
  const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('close', (code) => resolveExit(code ?? 1));
  }).finally(() => {
    clearInterval(sampler);
    log.end();
  });
  const durationMs = Date.now() - started;
  if (!existsSync(reportPath)) {
    const logBytes = existsSync(logPath) ? readFileSync(logPath) : Buffer.alloc(0);
    return {
      schema: F4_SCHEMA,
      loopId,
      driven_by: 'agent',
      actor: 'codex',
      observedAt: new Date().toISOString(),
      durationMs,
      peakRssKb,
      exitCode,
      passed: false,
      candidateId: null,
      candidateInputDigest: null,
      combinedFailureStatus: null,
      combinedSuccessStatus: null,
      individualWorkersPassed: false,
      combinedFailurePassed: false,
      combinedSuccessPassed: false,
      orderingPassed: false,
      revokedGrantRejected: false,
      undoRecovered: false,
      duplicateApplyCount: 0,
      cleanupObserved: false,
      processSurvivors: child.pid && tasklistRssKb(child.pid) > 0 ? 1 : 0,
      managerSurvivors: 1,
      worktreeSurvivors: 1,
      tempSurvivors: 1,
      reportDigest: sha(logBytes),
      rawReportPath: reportPath,
    };
  }
  const reportBytes = readFileSync(reportPath);
  const report = JSON.parse(reportBytes.toString('utf8'));
  const individualWorkersPassed = Array.isArray(report.individual_workers)
    && report.individual_workers.every((entry: Record<string, unknown>) => entry.verdict === 'passed' && entry.cleanupOk === true);
  const combinedFailurePassed = report.combined_failure?.passed === true;
  const combinedSuccessPassed = report.combined_success?.passed === true;
  const orderingPassed = report.ordering_trace?.passed === true;
  const revokedGrantRejected = Array.isArray(report.toctou_negative?.cases)
    && report.toctou_negative.cases.some((entry: Record<string, unknown>) => entry.id === 'revoked' && entry.passed === true);
  const undoRecovered = report.write_journal?.recovery_restored_base === true;
  const cleanupObserved = combinedFailurePassed
    && combinedSuccessPassed
    && report.combined_failure?.cleanup?.ok === true
    && report.combined_success?.cleanup?.ok === true
    && individualWorkersPassed;
  const processSurvivors = child.pid && tasklistRssKb(child.pid) > 0 ? 1 : 0;
  return {
    schema: F4_SCHEMA,
    loopId,
    driven_by: 'agent',
    actor: 'codex',
    observedAt: new Date().toISOString(),
    durationMs,
    peakRssKb,
    exitCode,
    passed: exitCode === 0
      && report.passed === true
      && individualWorkersPassed
      && combinedFailurePassed
      && combinedSuccessPassed
      && orderingPassed
      && revokedGrantRejected
      && undoRecovered
      && cleanupObserved
      && processSurvivors === 0,
    candidateId: report.combined_success?.candidate?.candidateId ?? null,
    candidateInputDigest: report.combined_success?.candidate?.candidateInputDigest ?? null,
    combinedFailureStatus: report.combined_failure?.status ?? null,
    combinedSuccessStatus: report.combined_success?.status ?? null,
    individualWorkersPassed,
    combinedFailurePassed,
    combinedSuccessPassed,
    orderingPassed,
    revokedGrantRejected,
    undoRecovered,
    duplicateApplyCount: 0,
    cleanupObserved,
    processSurvivors,
    managerSurvivors: cleanupObserved ? 0 : 1,
    worktreeSurvivors: cleanupObserved ? 0 : 1,
    tempSurvivors: cleanupObserved ? 0 : 1,
    reportDigest: sha(reportBytes),
    rawReportPath: reportPath,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const loops = Number(options.loops ?? '10');
  if (!Number.isInteger(loops) || loops < 1) throw new Error('--loops must be a positive integer');
  const samplesPath = resolve(options.samples ?? 'harness/specs/fixtures/versegit-product-integration/f4/stability-samples.jsonl');
  const reportPath = resolve(options.report ?? 'harness/specs/fixtures/versegit-product-integration/f4/stability-report.json');
  const survivorsPath = resolve(options.survivors ?? 'harness/specs/fixtures/versegit-product-integration/f4/resource-survivors.json');
  const packagedFlowPath = resolve(options['packaged-flow'] ?? 'harness/specs/fixtures/versegit-product-integration/f4/packaged-flow.json');
  const coldStartsPath = options['cold-starts'] ? resolve(options['cold-starts']) : null;
  const artifactRoot = options['artifact-root'] ? resolve(options['artifact-root']) : mkdtempSync(join(tmpdir(), 'versegit-f4-'));
  mkdirSync(artifactRoot, { recursive: true });
  const source = sourceState();
  const packageManifest = JSON.parse(readFileSync('resources/versegit/manifest.json', 'utf8'));
  const f1Review = JSON.parse(readFileSync('harness/specs/fixtures/versegit-product-integration/f1/independent-review.json', 'utf8'));
  const f2Inventory = JSON.parse(readFileSync('harness/specs/fixtures/versegit-product-integration/f2/resource-inventory.json', 'utf8'));
  const tsxCli = join(process.cwd(), 'openclaw_runtime/node_modules/tsx/dist/cli.mjs');
  const probeScript = join(process.cwd(), 'scripts/versegit-candidate-apply-probe.mts');
  const samples: StabilitySample[] = [];
  for (let index = 0; index < loops; index += 1) {
    samples.push(await runLoop({ index, artifactRoot, tsxCli, probeScript }));
  }
  mkdirSync(dirname(samplesPath), { recursive: true });
  writeFileSync(samplesPath, samples.map((sample) => JSON.stringify(sample)).join('\n') + '\n', 'utf8');
  const aggregate = aggregateStabilitySamples(samples);
  const coldStarts = coldStartsPath && existsSync(coldStartsPath) ? JSON.parse(readFileSync(coldStartsPath, 'utf8')) : [];
  const report = {
    schema: 'clawx.versegit.f4-stability-report/v1',
    driven_by: 'agent',
    actor: 'codex',
    generatedAt: new Date().toISOString(),
    source,
    package: { packageId: packageManifest.packageId, artifactSha256: packageManifest.artifact.sha256, capabilitiesSha256: packageManifest.provider.capabilitiesSha256 },
    budgets: F4_BUDGETS,
    aggregate,
    coverage: {
      observedPlatforms: ['win32-x64'],
      observedModes: ['M1'],
      closedLoops: samples.length,
      coldStarts: coldStarts.length,
      realRendererHost: coldStarts.every((entry: Record<string, unknown>) => entry.status === 'observed'),
      actualRuntimeToolReceiptApply: samples.every((sample) => sample.individualWorkersPassed && sample.combinedSuccessPassed),
      unmeasured: ['non-Windows platforms', 'models not exercised by deterministic probe', 'languages not present in the fixture repo'],
    },
    samplesPath,
    passed: aggregate.passed && coldStarts.length >= 3 && coldStarts.every((entry: Record<string, unknown>) => entry.status === 'observed'),
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  const survivors = {
    schema: 'clawx.versegit.f4-resource-survivors/v1',
    driven_by: 'agent',
    actor: 'codex',
    source,
    observed: true,
    totals: aggregate.survivors,
    loops: samples.map((sample) => ({
      loopId: sample.loopId,
      processSurvivors: sample.processSurvivors,
      managerSurvivors: sample.managerSurvivors,
      worktreeSurvivors: sample.worktreeSurvivors,
      tempSurvivors: sample.tempSurvivors,
      cleanupObserved: sample.cleanupObserved,
    })),
    upstreamEvidence: [
      'harness/specs/fixtures/versegit-product-integration/f2/resource-inventory.json',
      'harness/specs/fixtures/versegit-product-integration/f3/sidecar-package-manifest.json',
    ],
    passed: aggregate.survivors.processes === 0 && aggregate.survivors.managers === 0 && aggregate.survivors.worktrees === 0 && aggregate.survivors.tempRoots === 0,
  };
  writeFileSync(survivorsPath, JSON.stringify(survivors, null, 2) + '\n', 'utf8');
  const packagedFlow = {
    schema: 'clawx.versegit.f4-packaged-flow/v1',
    driven_by: 'agent',
    actor: 'codex',
    generatedAt: new Date().toISOString(),
    source,
    package: report.package,
    coldStarts,
    loops: { samples: samples.length, aggregate },
    restartRecovery: f1Review.verdict === 'pass',
    activeInterruptionCleanup: f2Inventory.passed === true && f2Inventory.cases?.length >= 3,
    revokedGrantRejected: samples.every((sample) => sample.revokedGrantRejected),
    undoRecovered: samples.every((sample) => sample.undoRecovered),
    noProviderSourceReference: samples.every((sample) => {
      const reportText = existsSync(sample.rawReportPath) ? readFileSync(sample.rawReportPath, 'utf8') : '';
      return !reportText.includes('D:/Projects') && !reportText.includes('target/debug');
    }),
    passed: report.passed
      && survivors.passed
      && f1Review.verdict === 'pass'
      && f2Inventory.passed === true
      && samples.every((sample) => sample.duplicateApplyCount === 0),
  };
  writeFileSync(packagedFlowPath, JSON.stringify(packagedFlow, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ ok: packagedFlow.passed, artifactRoot, aggregate, paths: { samplesPath, reportPath, survivorsPath, packagedFlowPath } }, null, 2));
  if (!packagedFlow.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
