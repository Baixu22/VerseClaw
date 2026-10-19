#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const ROOT = process.cwd();
const OUT_DIR = resolve(ROOT, 'artifacts/runtime-long-stability');
const REPORT_JSON = resolve(OUT_DIR, 'report.json');
const REPORT_MD = resolve(OUT_DIR, 'report.md');
const RUNTIME_EFFECTIVENESS_JSON = resolve(ROOT, 'artifacts/runtime-effectiveness/report.json');
const AGENT_DEV_DEEP_JSON = resolve(ROOT, 'artifacts/agent-dev-deep-test/report.json');
const RUNTIME_MEMORY_JSON = resolve(ROOT, 'artifacts/runtime-memory-eval/report.json');
const VERIFY_DEPS_FLAG = '--config.verify-deps-before-run=false';

const STARTED_AT = performance.now();
const GENERATED_AT = new Date().toISOString();

await mkdir(OUT_DIR, { recursive: true });

const report = {
  schema: 'clawx.runtime-long-stability.v1',
  generatedAt: GENERATED_AT,
  mode: 'offline-medium',
  noProviderCost: true,
  assumptions: [
    'No live provider or Gateway model call is used as a hard gate.',
    'Dirty worktree is recorded as context, not treated as a failure by itself.',
    'Cost saving is judged from offline token/context/runtime budget evidence, not billable invoices.',
  ],
  precheck: {},
  baseline: null,
  runtimeRounds: [],
  deepTest: null,
  agentMapBenefit: null,
  runtimeMemory: null,
  stability: null,
  cost: null,
  finalDecision: null,
  degradationReasons: [],
  optimizationTargets: [],
};

try {
  report.precheck = await runPrecheck();
  report.baseline = await readJsonIfExists(RUNTIME_EFFECTIVENESS_JSON);

  for (let index = 1; index <= 3; index += 1) {
    report.runtimeRounds.push(await runRuntimeRound(index));
    await writeReports(report);
  }

  report.deepTest = await runDeepTest();
  await writeReports(report);

  report.agentMapBenefit = await runAgentMapBenefit();
  await writeReports(report);

  report.runtimeMemory = await runRuntimeMemoryEval();
  report.stability = assessStability(report);
  report.cost = assessCost(report);
  report.finalDecision = decide(report);
  report.degradationReasons = buildDegradationReasons(report);
  report.optimizationTargets = buildOptimizationTargets(report);
  report.durationMs = Math.round(performance.now() - STARTED_AT);

  await writeReports(report);
  console.log(JSON.stringify({
    report: REPORT_JSON,
    markdown: REPORT_MD,
    finalDecision: report.finalDecision,
    durationMs: report.durationMs,
  }, null, 2));

  if (report.finalDecision === 'blocked') {
    process.exitCode = 1;
  }
} catch (error) {
  report.durationMs = Math.round(performance.now() - STARTED_AT);
  report.finalDecision = 'blocked';
  report.degradationReasons.push(error instanceof Error ? error.message : String(error));
  report.optimizationTargets.push('Fix the long-stability harness failure and rerun pnpm runtime:long-stability.');
  await writeReports(report);
  console.error(error);
  process.exitCode = 1;
}

async function runPrecheck() {
  const gitStatus = await runCommand('git', ['status', '--short'], {
    label: 'precheck:git-status',
    timeoutMs: 30_000,
    stream: false,
  });
  const pnpmVersion = await runCommand('pnpm', ['--version'], {
    label: 'precheck:pnpm-version',
    timeoutMs: 30_000,
    stream: false,
  });
  const gitStatusLines = gitStatus.stdout.trim()
    ? gitStatus.stdout.trim().split(/\r?\n/)
    : [];
  return {
    environment: 'offline-medium',
    generatedAt: GENERATED_AT,
    gitStatus: {
      exitCode: gitStatus.exitCode,
      dirty: gitStatusLines.length > 0,
      lineCount: gitStatusLines.length,
      lines: gitStatusLines,
    },
    pnpm: {
      exitCode: pnpmVersion.exitCode,
      version: pnpmVersion.stdout.trim(),
    },
    baselineReportExists: existsSync(RUNTIME_EFFECTIVENESS_JSON),
    rtkAvailable: false,
  };
}

async function runRuntimeRound(index) {
  console.log(`[runtime-long-stability] round ${index}/3: runtime effectiveness`);
  const effectiveness = await runPnpm(['run', 'runtime:effectiveness'], {
    label: `round-${index}:runtime-effectiveness`,
    timeoutMs: 180_000,
  });
  const effectivenessReport = await readJsonIfExists(RUNTIME_EFFECTIVENESS_JSON);

  console.log(`[runtime-long-stability] round ${index}/3: FactStore impact parity`);
  const impactParity = await runPnpm(['--dir', 'openclaw_runtime', 'exec', 'node', 'scripts/run-vitest.mjs', 'run', '--config', 'test/vitest/vitest.unit.config.ts', 'src/context-engine/views/impact/impact-parity.test.ts'], {
    label: `round-${index}:impact-parity`,
    timeoutMs: 180_000,
  });

  console.log(`[runtime-long-stability] round ${index}/3: loop stability`);
  const loopStability = await runPnpm([
    'exec',
    'vitest',
    'run',
    'tests/integration/loop-stability-check.test.ts',
    '--reporter=verbose',
  ], {
    label: `round-${index}:loop-stability`,
    timeoutMs: 240_000,
  });

  const impactParityComponent = getComponent(effectivenessReport, 'impact-parity');
  const agentMapComponent = getComponent(effectivenessReport, 'agentmap-shadow');
  const acceptanceStatus = effectivenessReport?.acceptance?.status;
  const round = {
    index,
    commands: {
      effectiveness: summarizeCommand(effectiveness),
      impactParity: summarizeCommand(impactParity),
      loopStability: summarizeCommand(loopStability),
    },
    aggregateDecision: effectivenessReport?.decision?.status ?? 'missing',
    acceptanceStatus: acceptanceStatus ?? 'missing',
    blockedComponents: effectivenessReport?.decision?.blockedComponents ?? [],
    regressionCount: effectivenessReport?.summary?.regressionCount ?? null,
    impactParity: {
      decision: impactParityComponent?.decision ?? 'missing',
      queryCount: impactParityComponent?.metrics?.queryCount ?? null,
      allQueriesFound: impactParityComponent?.metrics?.checks?.allQueriesFound ?? false,
      callerCount: impactParityComponent?.metrics?.callerCount ?? null,
      impactFileCount: impactParityComponent?.metrics?.impactFileCount ?? null,
    },
    agentMap: {
      decision: agentMapComponent?.decision ?? 'missing',
      defaultRuns: agentMapComponent?.metrics?.defaultRuns ?? null,
      enabledRuns: agentMapComponent?.metrics?.enabledRuns ?? null,
      noAuthority: agentMapComponent?.metrics?.checks?.noAuthority ?? false,
    },
  };

  round.passed = isRuntimeRoundPassed(round);
  return round;
}

async function runDeepTest() {
  console.log('[runtime-long-stability] agent-dev deep-test reuse');
  let command = await runPnpm(['run', 'agent-dev:deep-test:reuse'], {
    label: 'agent-dev:deep-test:reuse',
    timeoutMs: 25 * 60_000,
  });
  let deepReport = await readJsonIfExists(AGENT_DEV_DEEP_JSON);

  const reuseStatus = deepReport?.buildReuse?.status;
  const shouldRunFresh = command.exitCode !== 0 && ['missing', 'stale'].includes(reuseStatus);
  if (shouldRunFresh) {
    console.log(`[runtime-long-stability] reuse build ${reuseStatus}; running fresh deep-test`);
    command = await runPnpm(['run', 'agent-dev:deep-test'], {
      label: 'agent-dev:deep-test',
      timeoutMs: 30 * 60_000,
    });
    deepReport = await readJsonIfExists(AGENT_DEV_DEEP_JSON);
  }

  const results = Array.isArray(deepReport?.results) ? deepReport.results : [];
  const slowestStep = deepReport?.diagnostics?.byLoop?.fullLocal?.slowestStep
    ?? deepReport?.slowestStep
    ?? results.filter((entry) => !entry.skipped)
      .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))[0]
    ?? null;

  return {
    command: summarizeCommand(command),
    reportPath: AGENT_DEV_DEEP_JSON,
    available: Boolean(deepReport),
    success: deepReport?.success ?? command.exitCode === 0,
    totalDurationMs: deepReport?.totalDurationMs ?? command.durationMs,
    decision: deepReport?.decision ?? null,
    budgetStatus: deepReport?.decision?.budgetStatus ?? null,
    watchSteps: deepReport?.decision?.watchSteps ?? [],
    limitSteps: deepReport?.decision?.limitSteps ?? [],
    typecheckCache: deepReport?.diagnostics?.typecheck?.cache ?? null,
    slowestStep: slowestStep ? {
      id: slowestStep.id,
      durationMs: slowestStep.durationMs,
      commandLine: slowestStep.commandLine,
      skipped: Boolean(slowestStep.skipped),
    } : null,
    recommendations: deepReport?.recommendations ?? [],
  };
}

async function runAgentMapBenefit() {
  console.log('[runtime-long-stability] AgentMap benefit eval');
  const command = await runPnpm(['run', 'agent-map:benefit-eval'], {
    label: 'agent-map:benefit-eval',
    timeoutMs: 180_000,
  });
  const summary = parseMarkerJson(command.stdout, 'AGENT_MAP_BENEFIT_EVAL_SUMMARY');
  const metrics = summary?.metrics ?? null;
  const leakRisk = Boolean(
    (metrics?.generatedLeakRate ?? 0) > 0 ||
    (metrics?.promptPresentRedundancyRate ?? 0) > 0 ||
    (metrics?.mustRejectLeakRate ?? 0) > 0 ||
    (metrics?.authorityEscalationCount ?? 0) > 0,
  );
  return {
    command: summarizeCommand(command),
    available: Boolean(summary),
    recommendation: summary?.recommendation ?? metrics?.investmentRecommendation ?? null,
    recommendationReasons: summary?.recommendationReasons ?? [],
    metrics,
    leakRisk,
  };
}

async function runRuntimeMemoryEval() {
  console.log('[runtime-long-stability] runtime memory full eval');
  const command = await runPnpm(['run', 'eval:runtime-memory:full'], {
    label: 'eval:runtime-memory:full',
    timeoutMs: 15 * 60_000,
  });
  const memoryReport = await readJsonIfExists(RUNTIME_MEMORY_JSON);
  const latency = memoryReport?.enhancedReport?.dimensions?.latencyBenchmark;
  const summary = memoryReport?.enhancedReport?.summary;
  const evidenceClass = memoryReport?.evidenceClass ?? null;
  const accepted = memoryReport?.accepted === true;
  return {
    command: summarizeCommand(command),
    reportPath: RUNTIME_MEMORY_JSON,
    available: Boolean(memoryReport),
    evidenceClass,
    accepted,
    incomplete: command.timedOut || !memoryReport || evidenceClass === 'synthetic' || !accepted,
    testSuite: memoryReport?.testSuite ?? null,
    tokenOverheadP95: latency?.tokenOverheadP95 ?? null,
    tokenOverheadP50: latency?.tokenOverheadP50 ?? null,
    latencyMsP95: latency?.latencyMsP95 ?? null,
    overallScore: summary?.overallScore ?? null,
    budgetPressurePass: (latency?.tokenOverheadP95 ?? Number.POSITIVE_INFINITY) <= 200,
    scorePass: (summary?.overallScore ?? 0) >= 0.70,
    weaknesses: summary?.weaknesses ?? [],
    recommendations: summary?.recommendations ?? [],
  };
}

function assessStability(data) {
  const runtimeRoundsPassed = data.runtimeRounds.every((round) => round.passed);
  const durations = data.runtimeRounds.map((round) => round.commands.effectiveness.durationMs).filter(Number.isFinite);
  const variance = durationVariance(durations);
  const loopFailures = data.runtimeRounds.filter((round) => round.commands.loopStability.exitCode !== 0).map((round) => round.index);
  const impactParityFailures = data.runtimeRounds.filter((round) => round.commands.impactParity.exitCode !== 0).map((round) => round.index);
  return {
    runtimeRoundsPassed,
    passedRounds: data.runtimeRounds.filter((round) => round.passed).length,
    totalRounds: data.runtimeRounds.length,
    loopFailures,
    impactParityFailures,
    runtimeEffectivenessDurationMs: durations,
    durationVariance: variance,
    excessiveVariance: variance.maxMinRatio > 2 || variance.coefficientOfVariation > 0.35,
    stable: runtimeRoundsPassed && loopFailures.length === 0 && impactParityFailures.length === 0,
  };
}

function assessCost(data) {
  const deepDecision = data.deepTest?.decision;
  const deepBlocked = data.deepTest?.command?.exitCode !== 0 || deepDecision?.status === 'blocked';
  const deepLimit = (data.deepTest?.limitSteps ?? []).length > 0 || deepDecision?.budgetStatus === 'limit';
  const memory = data.runtimeMemory;
  const memoryPass = Boolean(memory && !memory.incomplete && memory.budgetPressurePass && memory.scorePass);
  const agentMapMetrics = data.agentMapBenefit?.metrics;
  const agentMapPositive = Boolean(
    data.agentMapBenefit?.command?.exitCode === 0 &&
    !data.agentMapBenefit?.leakRisk &&
    agentMapMetrics &&
    agentMapMetrics.benefitScore > 0 &&
    agentMapMetrics.budgetEfficiency > 0 &&
    ['continue_investment', 'hold_boundary'].includes(agentMapMetrics.investmentRecommendation),
  );
  return {
    deepBlocked,
    deepLimit,
    deepBudgetStatus: data.deepTest?.budgetStatus ?? null,
    deepWatchSteps: data.deepTest?.watchSteps ?? [],
    memoryPass,
    memoryIncomplete: Boolean(memory?.incomplete),
    tokenOverheadP95: memory?.tokenOverheadP95 ?? null,
    overallScore: memory?.overallScore ?? null,
    agentMapPositive,
    agentMapLeakRisk: Boolean(data.agentMapBenefit?.leakRisk),
    noHardLimit: !deepBlocked && !deepLimit,
  };
}

function decide(data) {
  if (!data.stability?.stable) {
    return 'blocked';
  }
  if (data.agentMapBenefit?.leakRisk) {
    return 'extra-cost';
  }
  if (data.cost?.deepBlocked || data.cost?.deepLimit) {
    return 'extra-cost';
  }
  if (data.stability?.excessiveVariance) {
    return 'extra-cost';
  }
  if (data.runtimeMemory?.incomplete) {
    return 'cost-neutral';
  }
  if (!data.cost?.memoryPass) {
    return 'extra-cost';
  }
  if (data.cost?.agentMapPositive) {
    return 'net-saving';
  }
  return 'cost-neutral';
}

function buildDegradationReasons(data) {
  const reasons = [];
  for (const round of data.runtimeRounds) {
    if (!round.passed) {
      reasons.push(`Round ${round.index} failed runtime stability acceptance.`);
    }
  }
  if (data.deepTest?.command?.exitCode !== 0) {
    reasons.push(`agent-dev deep-test exited with ${data.deepTest.command.exitCode}.`);
  }
  if (data.deepTest?.decision?.status === 'blocked') {
    reasons.push('agent-dev deep-test decision is blocked.');
  }
  if ((data.deepTest?.limitSteps ?? []).length > 0) {
    reasons.push(`agent-dev deep-test has hard limit steps: ${data.deepTest.limitSteps.join(', ')}.`);
  }
  if (data.runtimeMemory?.incomplete) {
    reasons.push('runtime-memory eval is incomplete; cost saving cannot be proven from memory evidence.');
  } else {
    if (data.runtimeMemory?.tokenOverheadP95 != null && data.runtimeMemory.tokenOverheadP95 > 200) {
      reasons.push(`runtime-memory tokenOverheadP95 ${data.runtimeMemory.tokenOverheadP95} exceeds 200.`);
    }
    if (data.runtimeMemory?.overallScore != null && data.runtimeMemory.overallScore < 0.70) {
      reasons.push(`runtime-memory overallScore ${data.runtimeMemory.overallScore} is below 0.70.`);
    }
  }
  if (data.agentMapBenefit?.leakRisk) {
    reasons.push('AgentMap benefit eval found leak or authority regression risk.');
  }
  if (data.stability?.excessiveVariance) {
    reasons.push(`Runtime loop duration variance is high: max/min=${data.stability.durationVariance.maxMinRatio.toFixed(2)}, cv=${data.stability.durationVariance.coefficientOfVariation.toFixed(2)}.`);
  }
  if (reasons.length === 0 && data.finalDecision === 'net-saving') {
    reasons.push('No degradation detected; offline evidence supports net-saving.');
  }
  return reasons;
}

function buildOptimizationTargets(data) {
  const targets = [];
  for (const step of data.deepTest?.watchSteps ?? []) {
    targets.push(`Watch ${step} in agent-dev deep-test; keep build reuse fresh and avoid expanding this gate casually.`);
  }
  for (const recommendation of data.deepTest?.recommendations ?? []) {
    targets.push(recommendation);
  }
  for (const weakness of data.runtimeMemory?.weaknesses ?? []) {
    targets.push(`Runtime memory: ${weakness}`);
  }
  for (const recommendation of data.runtimeMemory?.recommendations ?? []) {
    targets.push(`Runtime memory: ${recommendation}`);
  }
  if (!data.cost?.agentMapPositive) {
    targets.push('AgentMap: keep shadow-only boundary and improve budget efficiency/benefit score before any authority expansion.');
  }
  if (data.precheck?.gitStatus?.dirty) {
    targets.push('Rerun on a clean branch for release-grade touchedAreas and harness parity evidence.');
  }
  return [...new Set(targets)];
}

function isRuntimeRoundPassed(round) {
  return (
    round.commands.effectiveness.exitCode === 0 &&
    round.commands.impactParity.exitCode === 0 &&
    round.commands.loopStability.exitCode === 0 &&
    round.aggregateDecision === 'effective' &&
    round.acceptanceStatus === 'passed' &&
    round.blockedComponents.length === 0 &&
    round.regressionCount === 0 &&
    round.impactParity.decision === 'effective' &&
    (round.impactParity.queryCount ?? 0) > 0 &&
    round.impactParity.allQueriesFound === true &&
    round.agentMap.decision === 'shadow-only' &&
    round.agentMap.noAuthority === true
  );
}

function getComponent(reportValue, id) {
  return reportValue?.components?.find((component) => component.id === id) ?? null;
}

function parseMarkerJson(stdout, marker) {
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(`${marker} `));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(marker.length + 1));
  } catch {
    return null;
  }
}

function summarizeCommand(command) {
  return {
    label: command.label,
    commandLine: command.commandLine,
    exitCode: command.exitCode,
    durationMs: command.durationMs,
    timedOut: command.timedOut,
    stdoutTail: tail(command.stdout),
    stderrTail: tail(command.stderr),
  };
}

function durationVariance(values) {
  if (values.length === 0) {
    return { min: null, max: null, mean: null, maxMinRatio: 0, coefficientOfVariation: 0 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  const standardDeviation = Math.sqrt(variance);
  return {
    min,
    max,
    mean,
    maxMinRatio: min > 0 ? max / min : Number.POSITIVE_INFINITY,
    coefficientOfVariation: mean > 0 ? standardDeviation / mean : 0,
  };
}

async function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function writeReports(data) {
  data.durationMs = Math.round(performance.now() - STARTED_AT);
  await writeFile(REPORT_JSON, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await writeFile(REPORT_MD, renderMarkdown(data), 'utf8');
}

function renderMarkdown(data) {
  const lines = [];
  lines.push('# Runtime Long Stability Report');
  lines.push('');
  lines.push(`- Generated at: ${data.generatedAt}`);
  lines.push(`- Mode: ${data.mode}`);
  lines.push(`- No provider cost: ${data.noProviderCost ? 'yes' : 'no'}`);
  lines.push(`- Final decision: ${data.finalDecision ?? 'running'}`);
  lines.push(`- Duration: ${formatDuration(data.durationMs ?? 0)}`);
  lines.push(`- Dirty worktree: ${data.precheck?.gitStatus?.dirty ? `yes (${data.precheck.gitStatus.lineCount} entries)` : 'no'}`);
  lines.push('');

  lines.push('## Runtime Rounds');
  lines.push('');
  lines.push('| Round | Passed | Aggregate | Acceptance | Impact parity | Queries | All found | AgentMap | Runtime ms | Impact parity ms | Loop ms |');
  lines.push('|---:|---|---|---|---|---:|---|---|---:|---:|---:|');
  for (const round of data.runtimeRounds) {
    lines.push(`| ${round.index} | ${yesNo(round.passed)} | ${round.aggregateDecision} | ${round.acceptanceStatus} | ${round.impactParity.decision} | ${round.impactParity.queryCount ?? 'n/a'} | ${yesNo(round.impactParity.allQueriesFound)} | ${round.agentMap.decision} | ${round.commands.effectiveness.durationMs} | ${round.commands.impactParity.durationMs} | ${round.commands.loopStability.durationMs} |`);
  }
  if (data.runtimeRounds.length === 0) lines.push('| n/a | running | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |');
  lines.push('');

  lines.push('## Agent Dev Deep Test');
  lines.push('');
  if (data.deepTest) {
    lines.push(`- Command exit: ${data.deepTest.command.exitCode}`);
    lines.push(`- Decision: ${data.deepTest.decision?.status ?? 'missing'}`);
    lines.push(`- Budget status: ${data.deepTest.budgetStatus ?? 'missing'}`);
    lines.push(`- Watch steps: ${(data.deepTest.watchSteps ?? []).join(', ') || 'none'}`);
    lines.push(`- Limit steps: ${(data.deepTest.limitSteps ?? []).join(', ') || 'none'}`);
    lines.push(`- Typecheck cache: ${data.deepTest.typecheckCache?.status ?? 'n/a'}`);
    lines.push(`- Slowest step: ${data.deepTest.slowestStep ? `${data.deepTest.slowestStep.id} (${data.deepTest.slowestStep.durationMs} ms)` : 'n/a'}`);
  } else {
    lines.push('- Not run yet.');
  }
  lines.push('');

  lines.push('## Runtime Memory Cost');
  lines.push('');
  if (data.runtimeMemory) {
    lines.push(`- Incomplete: ${yesNo(data.runtimeMemory.incomplete)}`);
    lines.push(`- Evidence class: ${data.runtimeMemory.evidenceClass ?? 'missing'}`);
    lines.push(`- Accepted: ${yesNo(data.runtimeMemory.accepted)}`);
    lines.push(`- tokenOverheadP95: ${data.runtimeMemory.tokenOverheadP95 ?? 'n/a'}`);
    lines.push(`- overallScore: ${formatNumber(data.runtimeMemory.overallScore)}`);
    lines.push(`- latencyMsP95: ${formatNumber(data.runtimeMemory.latencyMsP95)}`);
    lines.push(`- budgetPressurePass: ${yesNo(data.runtimeMemory.budgetPressurePass)}`);
    lines.push(`- scorePass: ${yesNo(data.runtimeMemory.scorePass)}`);
  } else {
    lines.push('- Not run yet.');
  }
  lines.push('');

  lines.push('## AgentMap Benefit');
  lines.push('');
  if (data.agentMapBenefit) {
    const metrics = data.agentMapBenefit.metrics;
    lines.push(`- Recommendation: ${data.agentMapBenefit.recommendation ?? 'missing'}`);
    lines.push(`- Leak risk: ${yesNo(data.agentMapBenefit.leakRisk)}`);
    lines.push(`- benefitScore: ${formatNumber(metrics?.benefitScore)}`);
    lines.push(`- budgetEfficiency: ${formatNumber(metrics?.budgetEfficiency)}`);
    lines.push(`- authorityEscalationCount: ${metrics?.authorityEscalationCount ?? 'n/a'}`);
  } else {
    lines.push('- Not run yet.');
  }
  lines.push('');

  lines.push('## Acceptance');
  lines.push('');
  lines.push(`- Stability: ${data.stability?.stable ? 'passed' : data.stability ? 'failed' : 'running'}`);
  lines.push(`- Cost: ${data.cost ? JSON.stringify({
    memoryPass: data.cost.memoryPass,
    noHardLimit: data.cost.noHardLimit,
    agentMapPositive: data.cost.agentMapPositive,
  }) : 'running'}`);
  lines.push('');

  lines.push('## Degradation Reasons');
  lines.push('');
  for (const reason of data.degradationReasons ?? []) {
    lines.push(`- ${reason}`);
  }
  if ((data.degradationReasons ?? []).length === 0) lines.push('- None recorded yet.');
  lines.push('');

  lines.push('## Optimization Targets');
  lines.push('');
  for (const target of data.optimizationTargets ?? []) {
    lines.push(`- ${target}`);
  }
  if ((data.optimizationTargets ?? []).length === 0) lines.push('- None recorded yet.');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

async function runPnpm(args, options) {
  return runCommand('pnpm', [VERIFY_DEPS_FLAG, ...args], options);
}

async function runCommand(command, args, options) {
  const start = performance.now();
  const label = options.label ?? command;
  const commandLine = [command, ...args].join(' ');
  const child = spawnCommand(command, args);
  let stdout = '';
  let stderr = '';
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
  }, options.timeoutMs ?? 120_000);

  child.stdout?.on('data', (chunk) => {
    const text = chunk.toString();
    stdout = appendCapped(stdout, text);
    if (options.stream !== false) process.stdout.write(text);
  });
  child.stderr?.on('data', (chunk) => {
    const text = chunk.toString();
    stderr = appendCapped(stderr, text);
    if (options.stream !== false) process.stderr.write(text);
  });

  const exitCode = await new Promise((resolvePromise) => {
    child.on('error', (error) => {
      stderr = appendCapped(stderr, error.message);
      resolvePromise(1);
    });
    child.on('close', (code) => resolvePromise(code ?? 1));
  });
  clearTimeout(timer);

  return {
    label,
    commandLine,
    exitCode,
    durationMs: Math.round(performance.now() - start),
    timedOut,
    stdout,
    stderr,
  };
}

function spawnCommand(command, args) {
  if (process.platform !== 'win32') {
    return spawn(command, args, { cwd: ROOT, env: process.env, windowsHide: true });
  }
  return spawn(process.env.ComSpec ?? 'cmd.exe', [
    '/d',
    '/s',
    '/c',
    [command, ...args].map(quoteWindowsCommandArg).join(' '),
  ], { cwd: ROOT, env: process.env, windowsHide: true });
}

function quoteWindowsCommandArg(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/u.test(value)) {
    return value;
  }
  return `"${value.replace(/(["^&|<>])/gu, '^$1')}"`;
}

function appendCapped(current, next) {
  const combined = current + next;
  const limit = 8 * 1024 * 1024;
  return combined.length <= limit ? combined : combined.slice(combined.length - limit);
}

function tail(value, max = 4000) {
  return value.length <= max ? value : value.slice(value.length - max);
}

function yesNo(value) {
  return value ? 'yes' : 'no';
}

function formatNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(4) : 'n/a';
}

function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}
