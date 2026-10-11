#!/usr/bin/env node
/**
 * Runtime efficiency evidence validator.
 *
 *   node scripts/validate-runtime-efficiency.mjs
 *   node scripts/validate-runtime-efficiency.mjs --out artifacts/runtime-efficiency/report.json
 *   node scripts/validate-runtime-efficiency.mjs --validate-only --out artifacts/runtime-efficiency/report.json
 *
 * Default runs use a probe window long enough to self-validate. --quick keeps the
 * short window for a fast smoke check, and is expected to fail coverage validation
 * by design: fail-closed is a feature, not a bug.
 *
 * Fails closed on purpose. A zero-sample or missing artifact is a failure, not
 * a pass: an unmeasured run must never be reported as a healthy one.
 *
 * Pure Node, no dependencies, so it can run in a bare checkout before
 * `pnpm install`.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ROOT = process.cwd();
const DEFAULT_OUT = resolve(ROOT, 'artifacts/runtime-efficiency/report.json');

const LIMITS = {
  minSamples: 2,
  minCoverageMs: 1000,
  maxPeakRssBytes: 3 * 1024 * 1024 * 1024,
  maxAvgCpuPercent: 100,
};

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') {
      out.out = argv[i + 1];
      i += 1;
    } else {
      out._.push(a);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const outPath = args.out ? resolve(ROOT, args.out) : DEFAULT_OUT;
// `--quick` intentionally uses a short window. It is a smoke path, not a gate:
// short coverage is expected to fail validation, which demonstrates fail-closed.
const quick = args._.includes('--quick') || args.quick === true;
const PROFILE = {
  full: { rounds: 4, spinMs: 120, gapMs: 400 },
  quick: { rounds: 3, spinMs: 80, gapMs: 250 },
};
const profile = quick ? PROFILE.quick : PROFILE.full;

function fail(msg) {
  console.error(`[runtime-efficiency] FAIL: ${msg}`);
  process.exitCode = 1;
}

function ok(msg) {
  console.log(`[runtime-efficiency] OK: ${msg}`);
}

async function buildReport() {
  const schema = 'clawx.runtime-efficiency.v1';
  const generatedAt = new Date().toISOString();

  // A deliberately dependency-free probe: measure this very process for a short
  // window so the artifact is backed by real OS numbers even before the Electron
  // integration lands. Real app sampling is layered on top of this later.
  const samples = [];
  const started = Date.now();
  let lastCpu = process.cpuUsage();
  let lastAt = started;

  // Two synchronous spin segments with a real await between them, so we get
  // genuine wall-clock and CPU-time deltas rather than a fabricated value.
  const burn = (ms) => {
    const until = Date.now() + ms;
    let acc = 0;
    while (Date.now() < until) acc += Math.sqrt(acc + 1);
    return acc;
  };

  burn(profile.spinMs);
  await new Promise((r) => setTimeout(r, profile.gapMs));

  for (let i = 0; i < profile.rounds; i += 1) {
    const now = Date.now();
    const cpu = process.cpuUsage();
    const cpuDeltaUs = cpu.user - lastCpu.user + (cpu.system - lastCpu.system);
    const wallDeltaMs = now - lastAt;
    const usage = process.memoryUsage();
    samples.push({
      at: now,
      cpuPercent:
        wallDeltaMs > 0 && cpuDeltaUs > 0
          ? Math.round(((cpuDeltaUs / 1000 / wallDeltaMs) * 100) * 100) / 100
          : 0,
      rssBytes: usage.rss,
      heapUsedBytes: usage.heapUsed,
      source: 'os-cpu',
    });
    lastCpu = cpu;
    lastAt = now;
    if (i < profile.rounds - 1) {
      burn(profile.spinMs);
      await new Promise((r) => setTimeout(r, profile.gapMs));
    }
  }

  const cpuSum = samples.reduce((acc, s) => acc + s.cpuPercent, 0);
  return {
    schema,
    generatedAt,
    drivenBy: 'agent',
    mode: quick ? 'offline-probe-quick' : 'offline-probe',
    profile: quick ? 'quick' : 'full',
    assumptions: [
      'Samples come from a short-lived Node probe process, not the packaged Electron app.',
      'Electron main-process integration is specified but not yet wired; this artifact proves the evidence path only.',
      'No performance improvement is claimed by this artifact.',
    ],
    limits: LIMITS,
    sampleCount: samples.length,
    coverageMs: samples.length > 0 ? samples[samples.length - 1].at - samples[0].at : 0,
    avgCpuPercent: samples.length ? Math.round((cpuSum / samples.length) * 100) / 100 : 0,
    peakCpuPercent: samples.length ? Math.max(...samples.map((s) => s.cpuPercent)) : 0,
    peakRssBytes: samples.length ? Math.max(...samples.map((s) => s.rssBytes)) : 0,
    samples,
  };
}

function validateReport(report) {
  const findings = [];
  if (report.schema !== 'clawx.runtime-efficiency.v1') {
    findings.push(`unexpected schema: ${report.schema}`);
  }
  if (!Number.isFinite(report.sampleCount) || report.sampleCount < LIMITS.minSamples) {
    findings.push(`sampleCount ${report.sampleCount} < required ${LIMITS.minSamples} (unmeasured run is not a pass)`);
  }
  if (!Number.isFinite(report.coverageMs) || report.coverageMs < LIMITS.minCoverageMs) {
    findings.push(`coverageMs ${report.coverageMs} < required ${LIMITS.minCoverageMs}`);
  }
  if (report.peakRssBytes > LIMITS.maxPeakRssBytes) {
    findings.push(`peakRssBytes ${report.peakRssBytes} exceeds limit ${LIMITS.maxPeakRssBytes}`);
  }
  if (report.avgCpuPercent > LIMITS.maxAvgCpuPercent) {
    findings.push(`avgCpuPercent ${report.avgCpuPercent} exceeds limit ${LIMITS.maxAvgCpuPercent}`);
  }
  for (const sample of report.samples ?? []) {
    if (!Number.isFinite(sample.at) || !sample.source) {
      findings.push('sample missing timestamp or source label');
      break;
    }
  }
  return findings;
}

mkdirSync(dirname(outPath), { recursive: true });

if (args._.includes('--validate-only')) {
  if (!existsSync(outPath)) {
    fail(`artifact not found: ${outPath}`);
  } else {
    const report = JSON.parse(readFileSync(outPath, 'utf8'));
    const findings = validateReport(report);
    if (findings.length) {
      for (const f of findings) fail(f);
    } else {
      ok(`artifact valid: samples=${report.sampleCount} coverageMs=${report.coverageMs}`);
    }
  }
} else {
  const report = await buildReport();
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  ok(`wrote ${outPath}`);
  console.log(`  samples=${report.sampleCount} coverageMs=${report.coverageMs} avgCpu=${report.avgCpuPercent}% peakRss=${Math.round(report.peakRssBytes / 1024 / 1024)}MB`);
  const findings = validateReport(report);
  if (findings.length) {
    for (const f of findings) fail(f);
  } else {
    ok('self-validation passed');
  }
}
