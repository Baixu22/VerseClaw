#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_DIR = resolve(ROOT, 'artifacts', 'agent-dev-deep-test');
const REPORT_JSON = resolve(OUT_DIR, 'report.json');
const REPORT_MD = resolve(OUT_DIR, 'report.md');
const HISTORY_JSON = resolve(OUT_DIR, 'history.json');
const QUALITY_DIR = resolve(ROOT, 'artifacts', 'agent-dev-quality');
const QUALITY_REPORT_JSON = resolve(QUALITY_DIR, 'report.json');

const REQUIRED_BUILD_ARTIFACTS = [
  'dist/index.html',
  'dist-electron/main/index.js',
  'dist-electron/preload/index.js',
];

const BUILD_REUSE_SOURCE_PATHS = [
  'src',
  'electron',
  'shared',
  'index.html',
  'vite.config.ts',
  'package.json',
  'pnpm-lock.yaml',
];

const PERFORMANCE_BUDGETS = {
  typecheck: {
    targetMs: 25000,
    limitMs: 45000,
    loop: 'full-local',
    owner: 'compiled contract and renderer/Main safety',
    mitigation: 'Use pnpm run typecheck:cached for repeated daily loops, and keep pnpm run typecheck as the uncached release gate.',
  },
  contract: {
    targetMs: 1000,
    limitMs: 3000,
    loop: 'fast-pr',
    owner: 'host-api contract drift',
    mitigation: 'Keep contract scanning text-based and bounded to host-api/service sources.',
  },
  i18n: {
    targetMs: 1000,
    limitMs: 3000,
    loop: 'fast-pr',
    owner: 'locale namespace/key coverage',
    mitigation: 'Keep literal namespace scans bounded to source and locale directories.',
  },
  workbench: {
    targetMs: 1500,
    limitMs: 5000,
    loop: 'fast-pr',
    owner: 'static Workbench evidence indexing',
    mitigation: 'Index report presence and contract metadata only; avoid expensive test/build execution inside Workbench generation.',
  },
  'harness-agent-dev': {
    targetMs: 3000,
    limitMs: 8000,
    loop: 'full-local',
    owner: 'durable Agent Dev task-spec consistency',
    mitigation: 'Keep the Agent Dev task spec reading list narrow and move reusable rules into harness/specs instead of broad source scans.',
  },
  'vitest-agent-dev': {
    targetMs: 10000,
    limitMs: 18000,
    loop: 'fast-pr',
    owner: 'focused Agent Dev unit and facade tests',
    mitigation: 'Keep node-environment Agent Dev tests split from the jsdom host facade test so full unit coverage stays parallel where it is safe.',
  },
  'comms-replay': {
    targetMs: 2000,
    limitMs: 5000,
    loop: 'nightly-release',
    owner: 'communication replay metrics',
    mitigation: 'Keep replay corpus bounded for Agent Dev deep diagnostics; broader comms evidence belongs in release gates.',
  },
  'comms-compare': {
    targetMs: 2000,
    limitMs: 5000,
    loop: 'nightly-release',
    owner: 'communication baseline comparison',
    mitigation: 'Refresh baselines intentionally and keep compare output compact.',
  },
  'e2e-build': {
    targetMs: 25000,
    limitMs: 45000,
    loop: 'full-local',
    owner: 'Vite/Electron production build',
    mitigation: 'Reuse a fresh build with pnpm agent-dev:deep-test:reuse or pnpm run test:e2e:agent-dev-quality:run after a fresh build.',
  },
  'playwright-agent-dev': {
    targetMs: 25000,
    limitMs: 40000,
    loop: 'full-local',
    owner: 'Electron Agent Dev scenario path',
    mitigation: 'Use pnpm agent-dev:deep-test:reuse for the smoke daily loop, and pnpm agent-dev:deep-test:reuse:full only when full Agent Dev E2E evidence is needed without rebuilding.',
  },
  'workbench-refresh': {
    targetMs: 1500,
    limitMs: 5000,
    loop: 'nightly-release',
    owner: 'post-quality Workbench evidence refresh',
    mitigation: 'Refresh evidence from existing artifacts only.',
  },
};

const BASE_STEPS = [
  { id: 'typecheck', command: 'pnpm', args: ['run', 'typecheck'], goal: 'Compiled contract and renderer/Main type safety' },
  { id: 'contract', command: 'pnpm', args: ['contract:check'], goal: 'Host-api contract/facade/service drift' },
  { id: 'i18n', command: 'pnpm', args: ['i18n:lint'], goal: 'Four-locale namespace/key coverage' },
  { id: 'workbench', command: 'pnpm', args: ['agent-dev:workbench'], goal: 'Static Workbench evidence generation' },
  {
    id: 'harness-agent-dev',
    command: 'pnpm',
    args: ['harness', 'validate', '--spec', 'harness/specs/tasks/agent-dev-ecosystem-regularization.md'],
    goal: 'Durable Agent Dev task-spec consistency',
  },
  {
    id: 'vitest-agent-dev',
    command: 'pnpm',
    args: ['agent-dev:unit'],
    goal: 'Focused Agent Dev behavior and facade tests',
  },
  { id: 'comms-replay', command: 'pnpm', args: ['run', 'comms:replay'], goal: 'Communication replay metrics' },
  { id: 'comms-compare', command: 'pnpm', args: ['run', 'comms:compare'], goal: 'Communication baseline comparison' },
  {
    id: 'e2e-build',
    command: 'pnpm',
    args: ['run', 'build:vite'],
    goal: 'Reusable Vite/Electron production build for no-build Playwright loops',
  },
  {
    id: 'playwright-agent-dev',
    command: 'pnpm',
    args: ['run', 'test:e2e:agent-dev-quality:run'],
    goal: 'Electron Agent Dev scenario and in-app Workbench path',
  },
];

function parseDeepTestArgs(argv = process.argv.slice(2)) {
  const options = {
    buildMode: 'fresh',
    unitMode: 'full',
    typecheckMode: 'full',
    e2eMode: 'full',
    unitCoverageNote: 'Full Agent Dev unit path: includes Main API, scaffolds, shared scenarios, contract, i18n, and host-api facade coverage.',
    typecheckCoverageNote: 'Full typecheck path: generate bridge once, then run node and web TypeScript project checks in parallel.',
    e2eCoverageNote: 'Full Agent Dev quality E2E path: accessibility, visual artifact, and Settings > Developer Workbench record flow.',
  };

  for (const arg of argv) {
    if (arg === '--reuse-build') {
      options.buildMode = 'reuse';
    } else if (arg === '--fresh-build') {
      options.buildMode = 'fresh';
    } else if (arg === '--fast-unit') {
      options.unitMode = 'fast';
      options.unitCoverageNote = 'Optimized Agent Dev unit path: node-environment logic tests plus the jsdom host-api facade boundary test; this preserves the same focused unit coverage as pnpm agent-dev:unit.';
    } else if (arg === '--fast-typecheck') {
      options.typecheckMode = 'parallel';
      options.typecheckCoverageNote = 'Parallel full typecheck path: generate bridge once, then run node and web TypeScript projects concurrently; this is not a partial check.';
    } else if (arg === '--cached-typecheck') {
      options.typecheckMode = 'cached';
      options.typecheckCoverageNote = 'Cached typecheck path: generate bridge and reuse a previous successful node/web TypeScript check only when the input fingerprint is unchanged; run pnpm run typecheck before PR/release review.';
    } else if (arg === '--smoke-e2e') {
      options.e2eMode = 'smoke';
      options.e2eCoverageNote = 'Smoke Agent Dev E2E path: Settings > Developer Workbench visibility, contract gaps, and record button only; keep the full E2E for review/release confidence.';
    } else {
      throw new Error(`Unknown Agent Dev deep-test argument: ${arg}`);
    }
  }

  return options;
}

async function collectFiles(root, entry) {
  const absolute = resolve(root, entry);
  if (!existsSync(absolute)) return [];
  const info = await stat(absolute);
  if (!info.isDirectory()) return [absolute];

  const files = [];
  const children = await readdir(absolute, { withFileTypes: true });
  for (const child of children) {
    if (child.name === 'node_modules' || child.name === '.git') continue;
    const childEntry = `${entry}/${child.name}`;
    if (child.isDirectory()) {
      files.push(...await collectFiles(root, childEntry));
    } else if (child.isFile()) {
      files.push(resolve(root, childEntry));
    }
  }
  return files;
}

async function getNewestSource(root) {
  let newest = null;
  for (const entry of BUILD_REUSE_SOURCE_PATHS) {
    const files = await collectFiles(root, entry);
    for (const file of files) {
      const info = await stat(file);
      if (!newest || info.mtimeMs > newest.mtimeMs) {
        newest = { path: file, mtimeMs: info.mtimeMs };
      }
    }
  }
  return newest;
}

async function assessBuildReuse(root = ROOT) {
  const artifacts = [];
  for (const artifact of REQUIRED_BUILD_ARTIFACTS) {
    const absolute = resolve(root, artifact);
    if (!existsSync(absolute)) {
      return {
        mode: 'reuse',
        status: 'missing',
        reusable: false,
        reason: `${artifact} missing`,
        missing: artifact,
        requiredArtifacts: REQUIRED_BUILD_ARTIFACTS,
        sourcePaths: BUILD_REUSE_SOURCE_PATHS,
      };
    }
    const info = await stat(absolute);
    artifacts.push({ path: artifact, mtimeMs: info.mtimeMs });
  }

  const oldestArtifact = artifacts.reduce((oldest, artifact) => (
    artifact.mtimeMs < oldest.mtimeMs ? artifact : oldest
  ));
  const newestSource = await getNewestSource(root);
  if (newestSource && newestSource.mtimeMs > oldestArtifact.mtimeMs) {
    const sourcePath = relative(root, newestSource.path).replaceAll('\\', '/');
    return {
      mode: 'reuse',
      status: 'stale',
      reusable: false,
      reason: `${sourcePath} newer than ${oldestArtifact.path}`,
      newestSource: sourcePath,
      oldestArtifact: oldestArtifact.path,
      artifacts,
      requiredArtifacts: REQUIRED_BUILD_ARTIFACTS,
      sourcePaths: BUILD_REUSE_SOURCE_PATHS,
    };
  }

  return {
    mode: 'reuse',
    status: 'reused',
    reusable: true,
    reason: 'all required build artifacts are newer than relevant Agent Dev sources',
    oldestArtifact: oldestArtifact.path,
    artifacts,
    requiredArtifacts: REQUIRED_BUILD_ARTIFACTS,
    sourcePaths: BUILD_REUSE_SOURCE_PATHS,
  };
}

function createFreshBuildReuse() {
  return {
    mode: 'fresh',
    status: 'fresh',
    reusable: false,
    reason: 'fresh build mode always runs pnpm run build:vite',
    requiredArtifacts: REQUIRED_BUILD_ARTIFACTS,
    sourcePaths: BUILD_REUSE_SOURCE_PATHS,
  };
}

function createDeepTestPlan(options, buildReuse = createFreshBuildReuse()) {
  const steps = BASE_STEPS.map((step) => ({ ...step, args: [...step.args] }));
  const typecheck = steps.find((step) => step.id === 'typecheck');
  const unit = steps.find((step) => step.id === 'vitest-agent-dev');
  const build = steps.find((step) => step.id === 'e2e-build');
  const playwright = steps.find((step) => step.id === 'playwright-agent-dev');

  if (options.typecheckMode === 'parallel' && typecheck) {
    typecheck.args = ['run', 'typecheck:agent-dev'];
    typecheck.goal = 'Parallel node/web TypeScript safety for Agent Dev daily diagnosis';
    typecheck.targetMs = 25000;
    typecheck.limitMs = 35000;
  }

  if (options.typecheckMode === 'cached' && typecheck) {
    typecheck.args = ['run', 'typecheck:cached'];
    typecheck.goal = 'Fingerprint-cached node/web TypeScript safety for repeated Agent Dev diagnosis';
    typecheck.targetMs = 25000;
    typecheck.limitMs = 45000;
  }

  if (options.unitMode === 'fast' && unit) {
    unit.args = ['agent-dev:unit:fast'];
    unit.goal = 'Fast Agent Dev unit loop with node-only tests plus minimal jsdom facade coverage';
    unit.targetMs = 8000;
    unit.limitMs = 15000;
  }

  if (options.e2eMode === 'smoke' && playwright) {
    playwright.args = ['run', 'test:e2e:agent-dev-quality:smoke'];
    playwright.goal = 'Smoke Agent Dev Settings > Developer Workbench path';
    playwright.targetMs = 15000;
    playwright.limitMs = 25000;
  }

  if (buildReuse.status === 'reused' && build) {
    build.skip = true;
    build.skipped = true;
    build.reuseStatus = 'reused';
    build.commandLine = 'reuse existing build';
    build.goal = 'Verified reusable Vite/Electron production build for no-build Playwright loops';
  } else if (build) {
    build.reuseStatus = buildReuse.status;
  }

  return steps;
}

function classifyPerformanceLimits(results) {
  return results.map((step) => {
    const budget = PERFORMANCE_BUDGETS[step.id] ?? {
      targetMs: 10000,
      limitMs: 30000,
      loop: 'unknown',
      owner: step.goal,
      mitigation: 'Add an explicit Agent Dev performance budget for this step.',
    };
    const targetMs = step.targetMs ?? budget.targetMs;
    const limitMs = step.limitMs ?? budget.limitMs;
    const severity = step.durationMs > limitMs
      ? 'limit'
      : step.durationMs > targetMs
        ? 'watch'
        : 'ok';
    return {
      id: step.id,
      durationMs: step.durationMs,
      targetMs,
      limitMs,
      overTargetMs: Math.max(0, step.durationMs - targetMs),
      overLimitMs: Math.max(0, step.durationMs - limitMs),
      ratioToTarget: Number((step.durationMs / targetMs).toFixed(2)),
      severity,
      loop: budget.loop,
      owner: budget.owner,
      mitigation: budget.mitigation,
      commandLine: step.commandLine,
      skipped: Boolean(step.skipped),
      reuseStatus: step.reuseStatus,
    };
  }).sort((left, right) => {
    const severityRank = { limit: 2, watch: 1, ok: 0 };
    return severityRank[right.severity] - severityRank[left.severity]
      || right.overTargetMs - left.overTargetMs
      || right.durationMs - left.durationMs;
  });
}

function summarizeGateProfile(results) {
  const profile = {};
  for (const step of results) {
    const budget = PERFORMANCE_BUDGETS[step.id];
    const loop = budget?.loop ?? 'unknown';
    const current = profile[loop] ?? {
      durationMs: 0,
      stepCount: 0,
      skippedStepCount: 0,
      slowestStep: null,
    };
    current.durationMs += step.durationMs;
    current.stepCount += 1;
    if (step.skipped) current.skippedStepCount += 1;
    if (!current.slowestStep || step.durationMs > current.slowestStep.durationMs) {
      current.slowestStep = {
        id: step.id,
        durationMs: step.durationMs,
        commandLine: step.commandLine,
        skipped: Boolean(step.skipped),
      };
    }
    profile[loop] = current;
  }
  return profile;
}

function stripAnsi(value) {
  return String(value).replace(/\u001b\[[0-9;]*m/g, '');
}

function parseDurationToMs(value, unit) {
  const amount = Number(String(value).replaceAll(',', ''));
  if (!Number.isFinite(amount)) return null;
  if (unit === 'ms') return Math.round(amount);
  if (unit === 's') return Math.round(amount * 1000);
  if (unit === 'm') return Math.round(amount * 60_000);
  return null;
}

function extractLastJsonObject(text, predicate = () => true) {
  const clean = stripAnsi(text);
  const starts = [];
  for (let index = 0; index < clean.length; index += 1) {
    if (clean[index] === '{') starts.push(index);
  }
  for (const start of starts.reverse()) {
    for (let end = clean.length - 1; end > start; end -= 1) {
      if (clean[end] !== '}') continue;
      try {
        const parsed = JSON.parse(clean.slice(start, end + 1));
        if (predicate(parsed)) return parsed;
      } catch {
        // Keep scanning for a later complete JSON block.
      }
    }
  }
  return null;
}

function analyzeTypecheckOutput(step, stdout) {
  const commandLine = step.commandLine ?? [step.command, ...(step.args ?? [])].join(' ');
  const structured = extractLastJsonObject(stdout, (value) => (
    value && typeof value === 'object' && Array.isArray(value.results) && value.mode
  ));
  if (structured) {
    const phases = structured.results.map((result) => ({
      commandLine: result.commandLine,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      ok: result.exitCode === 0,
      skipped: Boolean(result.skipped),
      cacheHit: Boolean(result.cacheHit),
      cachedDurationMs: result.cachedDurationMs,
      cachedAt: result.cachedAt,
    }));
    const slowestPhase = phases.reduce((slowest, phase) => (
      !slowest || phase.durationMs > slowest.durationMs ? phase : slowest
    ), null);
    return {
      kind: 'typecheck',
      mode: structured.mode,
      cache: structured.cache,
      totalDurationMs: structured.totalDurationMs,
      coverageNote: structured.coverageNote,
      phases,
      slowestPhase,
    };
  }

  if (commandLine.includes('typecheck')) {
    return {
      kind: 'typecheck',
      mode: commandLine.includes('typecheck:cached')
        ? 'cached'
        : commandLine.includes('typecheck:agent-dev')
          ? 'parallel'
          : 'sequential',
      breakdownAvailable: false,
      phases: commandLine.includes('typecheck:cached')
        ? ['generate-ext-bridge', 'cached typecheck fingerprint', 'typecheck:node + typecheck:web when cache misses']
        : commandLine.includes('typecheck:agent-dev')
        ? ['generate-ext-bridge', 'typecheck:node + typecheck:web']
        : ['generate-ext-bridge', 'typecheck:node', 'typecheck:web'],
      note: 'This command did not emit structured per-phase timing; the default pnpm run typecheck path should emit the same parallel phase breakdown as pnpm run typecheck:agent-dev.',
    };
  }

  return null;
}

function analyzeBuildOutput(stdout, stderr) {
  const clean = stripAnsi(`${stdout}\n${stderr}`);
  const buildPasses = [...clean.matchAll(/built in ([\d.]+)(ms|s|m)/g)]
    .map((match, index) => ({
      index: index + 1,
      durationMs: parseDurationToMs(match[1], match[2]),
    }));
  const assets = [...clean.matchAll(/((?:dist|dist-electron)[^\s]+)\s+([\d,.]+)\s+kB/g)]
    .map((match) => ({
      path: match[1].replaceAll('\\', '/'),
      sizeKb: Number(match[2].replaceAll(',', '')),
    }))
    .filter((asset) => Number.isFinite(asset.sizeKb))
    .sort((left, right) => right.sizeKb - left.sizeKb);
  const warnings = clean
    .split(/\r?\n/)
    .filter((line) => line.includes('(!)') || line.includes('larger than 500 kB') || line.includes('dynamic import will not move module'));

  return {
    kind: 'vite-build',
    buildPasses,
    largestAssets: assets.slice(0, 8),
    warningCount: warnings.length,
    warnings: warnings.slice(0, 6),
    totalReportedBuildMs: buildPasses.reduce((sum, pass) => sum + (pass.durationMs ?? 0), 0),
  };
}

function analyzePlaywrightOutput(stdout, stderr) {
  const clean = stripAnsi(`${stdout}\n${stderr}`);
  const tests = [...clean.matchAll(/^\s+ok\s+\d+\s+(.+?)\s+\(([\d.]+)(ms|s|m)\)/gm)]
    .map((match) => ({
      title: match[1].trim(),
      durationMs: parseDurationToMs(match[2], match[3]),
    }));
  const summaryMatch = clean.match(/^\s+(\d+)\s+passed\s+\(([\d.]+)(ms|s|m)\)/m);
  return {
    kind: 'playwright',
    passed: summaryMatch ? Number(summaryMatch[1]) : tests.length,
    reportedDurationMs: summaryMatch ? parseDurationToMs(summaryMatch[2], summaryMatch[3]) : null,
    tests: tests.sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0)),
  };
}

function analyzeStepOutput(step, stdout = '', stderr = '') {
  const diagnostics = {};
  if (step.id === 'typecheck') {
    diagnostics.typecheck = analyzeTypecheckOutput(step, stdout);
  }
  if (step.id === 'e2e-build') {
    diagnostics.build = step.skipped
      ? { kind: 'vite-build', reused: true, skipped: true, warningCount: 0, largestAssets: [] }
      : analyzeBuildOutput(stdout, stderr);
  }
  if (step.id === 'playwright-agent-dev') {
    diagnostics.playwright = analyzePlaywrightOutput(stdout, stderr);
  }
  return Object.fromEntries(Object.entries(diagnostics).filter(([, value]) => value));
}

function summarizeDiagnostics(results) {
  const diagnostics = {};
  for (const step of results) {
    if (!step.diagnostics) continue;
    for (const [key, value] of Object.entries(step.diagnostics)) {
      diagnostics[key] = {
        stepId: step.id,
        commandLine: step.commandLine,
        durationMs: step.durationMs,
        ...value,
      };
    }
  }
  return diagnostics;
}

function getFastPathModes(report) {
  const modes = [];
  if (report.buildReuse?.status === 'reused') modes.push('reuse-build');
  if (report.unitMode !== 'full') modes.push(`${report.unitMode}-unit`);
  if (report.typecheckMode !== 'full') modes.push(`${report.typecheckMode}-typecheck`);
  if (report.e2eMode !== 'full') modes.push(`${report.e2eMode}-e2e`);
  return modes;
}

function requiredFullGatesForModes(report) {
  const gates = [];
  if (report.buildReuse?.status === 'reused') gates.push('pnpm run build:vite');
  if (report.unitMode !== 'full') gates.push('pnpm agent-dev:unit');
  if (report.typecheckMode !== 'full') gates.push('pnpm run typecheck');
  if (report.e2eMode !== 'full') gates.push('pnpm test:e2e:agent-dev-quality');
  return [...new Set(gates)];
}

function summarizeDeepTestDecision(report, performanceLimits = report.performanceLimits ?? classifyPerformanceLimits(report.results ?? [])) {
  const failedStep = report.results?.find((step) => !step.ok);
  const limitedSteps = performanceLimits.filter((entry) => entry.severity === 'limit');
  const watchedSteps = performanceLimits.filter((entry) => entry.severity === 'watch');
  const fastPathModes = getFastPathModes(report);
  const requiredFullGates = requiredFullGatesForModes(report);
  const fullGateComplete = requiredFullGates.length === 0
    && report.buildReuse?.status === 'fresh'
    && report.unitMode === 'full'
    && report.typecheckMode === 'full'
    && report.e2eMode === 'full';
  let status = 'daily-loop-ok';
  let reason = 'All selected Agent Dev gates passed within hard limits.';

  if (!report.success || failedStep) {
    status = 'blocked';
    reason = failedStep
      ? `${failedStep.id} failed; inspect stdoutTail/stderrTail before relying on this run.`
      : 'Deep-test did not complete every required step.';
  } else if (limitedSteps.length > 0) {
    status = 'blocked';
    reason = `${limitedSteps.map((entry) => entry.id).join(', ')} exceeded hard performance limits.`;
  } else if (fastPathModes.length > 0) {
    status = 'needs-full-gate';
    reason = 'Daily-loop fast-path evidence passed; run the listed full gates before PR/release review.';
  }

  return {
    status,
    reason,
    dailyLoopReady: status !== 'blocked',
    releaseReady: status === 'daily-loop-ok' && fullGateComplete,
    fullGateComplete,
    budgetStatus: limitedSteps.length > 0 ? 'limit' : watchedSteps.length > 0 ? 'watch' : 'ok',
    fastPathModes,
    requiredFullGates,
    watchSteps: watchedSteps.map((entry) => entry.id),
    limitSteps: limitedSteps.map((entry) => entry.id),
  };
}

function createHistoryEntry(report) {
  return {
    generatedAt: report.generatedAt,
    success: report.success,
    totalDurationMs: report.totalDurationMs,
    decisionStatus: report.decision?.status,
    releaseReady: Boolean(report.decision?.releaseReady),
    modes: {
      buildReuse: report.buildReuse?.status,
      unit: report.unitMode,
      typecheck: report.typecheckMode,
      e2e: report.e2eMode,
    },
    stepDurations: Object.fromEntries(
      (report.results ?? []).map((step) => [step.id, {
        durationMs: step.durationMs,
        skipped: Boolean(step.skipped),
        ok: Boolean(step.ok),
      }]),
    ),
    budgetSummary: {
      ok: (report.performanceLimits ?? []).filter((entry) => entry.severity === 'ok').length,
      watch: (report.performanceLimits ?? []).filter((entry) => entry.severity === 'watch').length,
      limit: (report.performanceLimits ?? []).filter((entry) => entry.severity === 'limit').length,
    },
  };
}

function sameMode(left, right) {
  return left?.modes?.buildReuse === right?.modes?.buildReuse
    && left?.modes?.unit === right?.modes?.unit
    && left?.modes?.typecheck === right?.modes?.typecheck
    && left?.modes?.e2e === right?.modes?.e2e;
}

function summarizeTrend(entries, currentEntry) {
  const previous = entries.at(-1) ?? null;
  const previousSameMode = [...entries].reverse().find((entry) => sameMode(entry, currentEntry)) ?? null;
  const sameModeSampleCount = entries.filter((entry) => sameMode(entry, currentEntry)).length + 1;
  const deltaMs = previous ? currentEntry.totalDurationMs - previous.totalDurationMs : null;
  const sameModeDeltaMs = previousSameMode ? currentEntry.totalDurationMs - previousSameMode.totalDurationMs : null;
  const direction = sameModeDeltaMs == null
    ? 'new-baseline'
    : sameModeDeltaMs < -1000
      ? 'improved'
      : sameModeDeltaMs > 1000
        ? 'regressed'
        : 'stable';
  return {
    direction,
    previousRunDeltaMs: deltaMs,
    sameModeDeltaMs,
    sameModeSampleCount,
    previousRunGeneratedAt: previous?.generatedAt ?? null,
    previousSameModeGeneratedAt: previousSameMode?.generatedAt ?? null,
    note: previousSameMode
      ? `Compared with previous same-mode run ${previousSameMode.generatedAt}.`
      : 'No previous same-mode run was available; this run establishes a baseline.',
  };
}

async function readDeepTestHistory() {
  if (!existsSync(HISTORY_JSON)) return [];
  try {
    const history = JSON.parse(await readFile(HISTORY_JSON, 'utf8'));
    return Array.isArray(history.entries) ? history.entries : [];
  } catch {
    return [];
  }
}

async function writeDeepTestHistory(report) {
  const priorEntries = await readDeepTestHistory();
  const currentEntry = createHistoryEntry(report);
  const trend = summarizeTrend(priorEntries, currentEntry);
  const entries = [...priorEntries, currentEntry].slice(-20);
  const history = {
    schema: 'clawx.agent-dev.deep-test-history.v1',
    updatedAt: report.generatedAt,
    maxEntries: 20,
    latest: currentEntry,
    trend,
    entries,
  };
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(HISTORY_JSON, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
  return {
    path: HISTORY_JSON,
    latest: currentEntry,
    trend,
    sampleCount: entries.length,
  };
}

function runSkippedStep(step) {
  const startedAt = performance.now();
  const commandLine = step.commandLine ?? [step.command, ...step.args].join(' ');
  const durationMs = Math.max(1, Math.round(performance.now() - startedAt));
  console.log(JSON.stringify({
    skipped: true,
    id: step.id,
    reuseStatus: step.reuseStatus,
    commandLine,
  }));
  return {
    ...step,
    commandLine,
    exitCode: 0,
    durationMs,
    ok: true,
    skipped: true,
    diagnostics: analyzeStepOutput({ ...step, commandLine, durationMs, skipped: true }, '', ''),
    stdoutTail: '',
    stderrTail: '',
  };
}

function runStep(step) {
  if (step.skip) return Promise.resolve(runSkippedStep(step));

  return new Promise((resolveStep) => {
    const startedAt = performance.now();
    let stdout = '';
    let stderr = '';
    const commandLine = [step.command, ...step.args].join(' ');
    const command = process.platform === 'win32' && step.command === 'pnpm'
      ? process.env.ComSpec ?? 'cmd.exe'
      : step.command;
    const args = process.platform === 'win32' && step.command === 'pnpm'
      ? ['/d', '/s', '/c', commandLine]
      : step.args;
    const child = spawn(command, args, { cwd: ROOT });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on('close', (code) => {
      const durationMs = Math.round(performance.now() - startedAt);
      const stepResult = {
        ...step,
        commandLine,
        exitCode: code ?? 1,
        durationMs,
        ok: code === 0,
        skipped: Boolean(step.skipped),
        stdoutTail: stdout.slice(-4000),
        stderrTail: stderr.slice(-4000),
      };
      const diagnostics = analyzeStepOutput(stepResult, stdout, stderr);
      resolveStep({
        ...stepResult,
        ...(Object.keys(diagnostics).length ? { diagnostics } : {}),
      });
    });
  });
}

async function readWorkbenchEvidence() {
  const path = resolve(ROOT, 'artifacts', 'agent-dev-workbench', 'evidence.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function recommendations(report, evidence, performanceLimits = classifyPerformanceLimits(report.results)) {
  const notes = [];
  const limited = performanceLimits.filter((entry) => entry.severity === 'limit');
  const watched = performanceLimits.filter((entry) => entry.severity === 'watch');
  for (const entry of limited) {
    notes.push(`${entry.id} exceeded its hard limit by ${entry.overLimitMs}ms; ${entry.mitigation}`);
  }
  for (const entry of watched.slice(0, 3)) {
    notes.push(`${entry.id} exceeded its target by ${entry.overTargetMs}ms; ${entry.mitigation}`);
  }
  if (report.buildReuse?.status === 'reused') {
    notes.push('Build reuse skipped e2e-build after verifying dist and dist-electron artifacts are fresh enough for the selected Playwright loop.');
  } else if (report.buildReuse?.status === 'missing' || report.buildReuse?.status === 'stale') {
    notes.push(`Build reuse requested but ${report.buildReuse.status}; deep-test fell back to a fresh pnpm run build:vite.`);
  }
  if (report.unitMode !== 'full') {
    notes.push(`${report.unitMode} unit mode is daily-loop evidence only; run pnpm agent-dev:unit before review or release.`);
  }
  if (report.typecheckMode !== 'full') {
    notes.push(`${report.typecheckMode} typecheck mode is reported separately from the default full gate; run pnpm run typecheck before review or release if this was a local-only loop.`);
  }
  if (report.e2eMode !== 'full') {
    notes.push('Smoke E2E mode covers the Workbench record path only; run the full Agent Dev quality E2E before review or release.');
  }
  const slowest = [...report.results].filter((step) => !step.skipped)
    .sort((left, right) => right.durationMs - left.durationMs).slice(0, 3);
  for (const step of slowest) {
    if (step.id === 'e2e-build') {
      notes.push('Vite/Electron build is the dominant E2E setup cost; use pnpm agent-dev:deep-test:reuse after a fresh build for repeated local loops.');
    } else if (step.id === 'playwright-agent-dev') {
      notes.push('Playwright runtime remains the dominant full-local cost; keep pnpm agent-dev:deep-test:reuse on smoke E2E for daily diagnosis and use pnpm agent-dev:deep-test:reuse:full only when full E2E evidence is needed.');
    } else if (step.id === 'typecheck') {
      notes.push('Typecheck is a major fixed cost; the Agent Dev parallel typecheck path preserves both node and web projects while reducing local wait time.');
    } else if (step.id === 'vitest-agent-dev') {
      notes.push('Vitest has full and fast paths now; keep host-api facade coverage in the fast path and do not treat node-only evidence as full unit proof.');
    } else if (step.durationMs > 10000) {
      notes.push(`${step.id} took ${Math.round(step.durationMs / 1000)}s; inspect its output tail and consider a narrower fast-gate variant.`);
    }
  }
  if (evidence?.hostApi?.missingFacadeActions?.length || evidence?.hostApi?.missingServiceActions?.length) {
    notes.push('Workbench evidence reports host-api action gaps; repair contract/facade/service before UI work.');
  }
  if (!evidence?.artifacts?.quality && !evidence?.artifactStatus?.quality) {
    notes.push('Quality artifacts were absent before this run; deep-test now writes artifacts/agent-dev-quality/report.json for Workbench indexing after successful E2E.');
  }
  return [...new Set(notes)];
}

async function writeQualityReport(report) {
  const e2eBuild = report.results.find((step) => step.id === 'e2e-build');
  const playwright = report.results.find((step) => step.id === 'playwright-agent-dev');
  if (!playwright) return null;
  const quality = {
    schema: 'clawx.agent-dev.quality-report.v1',
    generatedAt: report.generatedAt,
    success: Boolean(playwright.ok),
    buildReuse: report.buildReuse,
    decision: report.decision,
    unitMode: report.unitMode,
    typecheckMode: report.typecheckMode,
    e2eMode: report.e2eMode,
    build: e2eBuild
      ? {
        ok: e2eBuild.ok,
        durationMs: e2eBuild.durationMs,
        commandLine: e2eBuild.skipped ? 'reuse existing build' : e2eBuild.commandLine,
        reused: Boolean(e2eBuild.skipped || e2eBuild.reuseStatus === 'reused'),
        skipped: Boolean(e2eBuild.skipped),
        reuseStatus: e2eBuild.reuseStatus,
      }
      : null,
    playwright: {
      ok: playwright.ok,
      durationMs: playwright.durationMs,
      commandLine: playwright.commandLine,
      spec: 'tests/e2e/agent-dev-quality.spec.ts',
      mode: report.e2eMode,
      expectedTests: report.e2eMode === 'smoke' ? 1 : 4,
      diagnostics: playwright.diagnostics?.playwright ?? null,
      evidence: report.e2eMode === 'smoke'
        ? [
          'Settings > Developer Agent Dev Workbench host-api record path',
        ]
        : [
          'seeded scenario accessibility report',
          'assistant-ui welcome suggestions visual artifact',
          'seeded scenario visual artifact',
          'Settings > Developer Agent Dev Workbench host-api record path',
        ],
    },
  };
  await mkdir(QUALITY_DIR, { recursive: true });
  await writeFile(QUALITY_REPORT_JSON, `${JSON.stringify(quality, null, 2)}\n`, 'utf8');
  return QUALITY_REPORT_JSON;
}

function renderMarkdown(report) {
  const rows = report.results
    .map((step) => `| ${step.ok ? 'pass' : 'fail'} | ${step.id} | ${step.skipped ? 'yes' : 'no'} | ${Math.round(step.durationMs / 1000)}s | \`${step.commandLine}\` | ${step.goal} |`)
    .join('\n');
  const bottlenecks = report.bottlenecks
    .map((step, index) => `${index + 1}. ${step.id}: ${step.durationMs}ms${step.skipped ? ' (skipped)' : ''}`)
    .join('\n');
  const limits = report.performanceLimits
    .map((entry) => `| ${entry.severity} | ${entry.id} | ${entry.skipped ? 'yes' : 'no'} | ${entry.durationMs}ms | ${entry.targetMs}ms | ${entry.limitMs}ms | ${entry.loop} | ${entry.mitigation} |`)
    .join('\n');
  const profile = Object.entries(report.gateProfile)
    .map(([loop, value]) => `| ${loop} | ${value.durationMs}ms | ${value.stepCount} | ${value.skippedStepCount} | ${value.slowestStep?.id ?? '-'} |`)
    .join('\n');
  const typecheckRows = report.diagnostics?.typecheck?.phases
    ?.map((phase) => typeof phase === 'string'
      ? `| ${phase} | - | - |`
      : `| \`${phase.commandLine}\` | ${phase.durationMs ?? '-'}ms | ${phase.ok ? 'pass' : 'fail'} |`)
    .join('\n') ?? '| - | - | - |';
  const buildRows = report.diagnostics?.build?.largestAssets
    ?.map((asset) => `| \`${asset.path}\` | ${asset.sizeKb} kB |`)
    .join('\n') ?? '| - | - |';
  const e2eRows = report.diagnostics?.playwright?.tests
    ?.map((test) => `| ${test.durationMs ?? '-'}ms | ${test.title} |`)
    .join('\n') ?? '| - | - |';
  const recs = report.recommendations.map((note) => `- ${note}`).join('\n') || '- No optimization recommendation generated.';
  const requiredFullGates = report.decision?.requiredFullGates?.length
    ? report.decision.requiredFullGates.map((command) => `- \`${command}\``).join('\n')
    : '- None.';
  const trend = report.history?.trend
    ? `${report.history.trend.direction}; same-mode delta ${report.history.trend.sameModeDeltaMs ?? 'n/a'}ms; sample count ${report.history.trend.sameModeSampleCount}.`
    : 'No history trend recorded.';
  return `# Agent Dev Deep Test

Generated: ${report.generatedAt}

Result: ${report.success ? 'pass' : 'fail'}

Decision: ${report.decision?.status ?? 'unknown'} - ${report.decision?.reason ?? 'No decision summary generated.'}

Total elapsed: ${report.totalDurationMs}ms

Modes: build=${report.buildReuse.status}, unit=${report.unitMode}, typecheck=${report.typecheckMode}, e2e=${report.e2eMode}

Build reuse reason: ${report.buildReuse.reason}

## Decision

- Daily loop ready: ${report.decision?.dailyLoopReady ? 'yes' : 'no'}
- Release ready: ${report.decision?.releaseReady ? 'yes' : 'no'}
- Budget status: ${report.decision?.budgetStatus ?? 'unknown'}
- Full gate complete: ${report.decision?.fullGateComplete ? 'yes' : 'no'}

Required full gates:

${requiredFullGates}

Trend: ${trend}

## Steps

| Status | Step | Skipped | Duration | Command | Goal |
|---|---:|---:|---:|---|---|
${rows}

## Bottlenecks

${bottlenecks}

## Performance Limits

| Severity | Step | Skipped | Duration | Target | Limit | Loop | Mitigation |
|---|---:|---:|---:|---:|---:|---|---|
${limits}

## Gate Profile

| Loop | Duration | Steps | Skipped steps | Slowest step |
|---|---:|---:|---:|---|
${profile}

## Step Diagnostics

Typecheck phases:

| Phase | Duration | Status |
|---|---:|---|
${typecheckRows}

Largest build assets:

| Asset | Size |
|---|---:|
${buildRows}

Playwright test durations:

| Duration | Test |
|---:|---|
${e2eRows}

## Optimization Recommendations

${recs}
`;
}

async function buildReportBase(results, options, buildReuse, startedAt, refreshResult = null) {
  const allResults = refreshResult ? [...results, refreshResult] : results;
  const evidence = await readWorkbenchEvidence();
  const allPerformanceLimits = classifyPerformanceLimits(allResults);
  const diagnostics = summarizeDiagnostics(allResults);
  const report = {
    schema: 'clawx.agent-dev.deep-test.v1',
    generatedAt: new Date().toISOString(),
    success: results.every((step) => step.ok)
      && results.length === BASE_STEPS.length
      && (!refreshResult || refreshResult.ok),
    totalDurationMs: Math.round(performance.now() - startedAt),
    buildReuse,
    unitMode: options.unitMode,
    unitCoverageNote: options.unitCoverageNote,
    typecheckMode: options.typecheckMode,
    typecheckCoverageNote: options.typecheckCoverageNote,
    e2eMode: options.e2eMode,
    e2eCoverageNote: options.e2eCoverageNote,
    results: allResults,
    bottlenecks: [...allResults].sort((left, right) => right.durationMs - left.durationMs).slice(0, 5)
      .map(({ id, durationMs, commandLine, skipped }) => ({ id, durationMs, commandLine, skipped: Boolean(skipped) })),
    workbenchEvidence: evidence,
    performanceBudgets: PERFORMANCE_BUDGETS,
    performanceLimits: allPerformanceLimits,
    gateProfile: summarizeGateProfile(allResults),
    diagnostics,
  };
  report.decision = summarizeDeepTestDecision(report, allPerformanceLimits);
  report.recommendations = recommendations(report, evidence, allPerformanceLimits);
  return report;
}

async function main() {
  const startedAt = performance.now();
  const options = parseDeepTestArgs();
  const buildReuse = options.buildMode === 'reuse'
    ? await assessBuildReuse(ROOT)
    : createFreshBuildReuse();
  const steps = createDeepTestPlan(options, buildReuse);
  const results = [];
  for (const step of steps) {
    results.push(await runStep(step));
    if (!results.at(-1).ok) break;
  }

  const partialReport = await buildReportBase(results, options, buildReuse, startedAt);
  const qualityReport = await writeQualityReport(partialReport);
  let refreshResult = null;
  if (qualityReport) {
    partialReport.qualityReport = qualityReport;
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(REPORT_JSON, `${JSON.stringify(partialReport, null, 2)}\n`, 'utf8');
    await writeFile(REPORT_MD, renderMarkdown(partialReport), 'utf8');
    refreshResult = await runStep({
      id: 'workbench-refresh',
      command: 'pnpm',
      args: ['agent-dev:workbench'],
      goal: 'Refresh Workbench evidence after quality report generation',
    });
  }
  const report = await buildReportBase(results, options, buildReuse, startedAt, refreshResult);
  if (qualityReport) {
    report.qualityReport = qualityReport;
  }
  report.history = await writeDeepTestHistory(report);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(REPORT_MD, renderMarkdown(report), 'utf8');
  console.log(JSON.stringify({
    success: report.success,
    totalDurationMs: report.totalDurationMs,
    output: REPORT_JSON,
    markdown: REPORT_MD,
    buildReuse: report.buildReuse,
    unitMode: report.unitMode,
    typecheckMode: report.typecheckMode,
    e2eMode: report.e2eMode,
    bottlenecks: report.bottlenecks,
  }, null, 2));
  if (!report.success) process.exitCode = 1;
}

export {
  BUILD_REUSE_SOURCE_PATHS,
  PERFORMANCE_BUDGETS,
  REQUIRED_BUILD_ARTIFACTS,
  analyzeBuildOutput,
  analyzePlaywrightOutput,
  analyzeStepOutput,
  analyzeTypecheckOutput,
  assessBuildReuse,
  classifyPerformanceLimits,
  createHistoryEntry,
  createDeepTestPlan,
  createFreshBuildReuse,
  parseDeepTestArgs,
  summarizeDeepTestDecision,
  summarizeTrend,
  summarizeGateProfile,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
