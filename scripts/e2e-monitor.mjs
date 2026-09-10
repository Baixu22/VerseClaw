#!/usr/bin/env node
/**
 * e2e-monitor: 周期跑 ClawX 真实 Electron Playwright 核心 spec，
 * 把结果累积到 artifacts/e2e-monitor/runs.jsonl，并维护最新汇总到
 * artifacts/e2e-monitor/state.json。
 *
 * 非破坏性：只跑既定 spec 列表；单轮超时不会造成 daemon 崩溃；
 * provider/electron 失败会被记录为 reason 字段。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'artifacts', 'e2e-monitor');
const runsLog = join(outDir, 'runs.jsonl');
const statePath = join(outDir, 'state.json');
const logPath = join(outDir, 'monitor.log');

const PLAYWRIGHT_CLI = join(root, 'node_modules', '@playwright', 'test', 'cli.js');
const PLAYWRIGHT_CMD = process.platform === 'win32'
  ? join(root, 'node_modules', '.bin', 'playwright.cmd')
  : join(root, 'node_modules', '.bin', 'playwright');

function pickRunner() {
  if (existsSync(PLAYWRIGHT_CLI)) {
    return { cmd: process.execPath, prefix: [PLAYWRIGHT_CLI] };
  }
  if (existsSync(PLAYWRIGHT_CMD)) {
    return { cmd: PLAYWRIGHT_CMD, prefix: [] };
  }
  // fallback to npx-style (shell:true) last-resort
  return { cmd: process.platform === 'win32' ? 'playwright.cmd' : 'playwright', prefix: [], shell: true };
}

// 只跑已经被证实能在本机可靠的震荡最小的 smoke spec；
// agent-browser-workbench 已知存在断点，仅在 --deep 时跑以免干扰心跳。
const DEFAULT_SPECS = [
  'tests/e2e/app-smoke.spec.ts',
  'tests/e2e/agent-dev-quality.spec.ts',
  'tests/e2e/browser-security-recovery.spec.ts',
];
const DEEP_SPECS = [
  ...DEFAULT_SPECS,
  'tests/e2e/agent-browser-workbench.spec.ts',
];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { mkdirSync(outDir, { recursive: true }); appendFileSync(logPath, line + '\n'); } catch {}
}

function readState() {
  try { return JSON.parse(readFileSync(statePath, 'utf-8')); } catch { return { rounds: [] }; }
}

function writeState(state) {
  try { mkdirSync(outDir, { recursive: true }); writeFileSync(statePath, JSON.stringify(state, null, 2)); } catch {}
}

function appendRun(rec) {
  try { mkdirSync(outDir, { recursive: true }); appendFileSync(runsLog, JSON.stringify(rec) + '\n'); } catch {}
}

async function runCmd(runner, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(runner.cmd, [...runner.prefix, ...args], {
      cwd: root,
      shell: runner.shell ?? false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000);
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(err), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, timedOut });
    });
  });
}

function parsePlaywrightSummary(stdout, stderr) {
  const text = stdout + '\n' + stderr;
  const passMatch = text.match(/(\d+)\s+passed/);
  const failMatch = text.match(/(\d+)\s+failed/);
  const skipMatch = text.match(/(\d+)\s+skipped/);
  const flakyMatch = text.match(/(\d+)\s+flaky/);
  return {
    passed: passMatch ? parseInt(passMatch[1], 10) : 0,
    failed: failMatch ? parseInt(failMatch[1], 10) : 0,
    skipped: skipMatch ? parseInt(skipMatch[1], 10) : 0,
    flaky: flakyMatch ? parseInt(flakyMatch[1], 10) : 0,
  };
}

async function runSpec(runner, spec, timeoutMs) {
  const startedAt = new Date().toISOString();
  const args = ['test', spec, '--reporter=line', `--output=${join(outDir, 'output')}`];
  const res = await runCmd(runner, args, timeoutMs);
  const summary = parsePlaywrightSummary(res.stdout, res.stderr);
  return {
    spec,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: res.code,
    timedOut: res.timedOut,
    summary,
    stdoutTail: res.stdout.split('\n').slice(-6),
    stderrTail: res.stderr.split('\n').slice(-6),
  };
}

async function heartbeatRound(idx, runner, specs, timeoutMs) {
  const startedAt = Date.now();
  const results = [];
  let totalPass = 0, totalFail = 0, totalSkip = 0, totalFlaky = 0;
  for (const s of specs) {
    const r = await runSpec(runner, s, timeoutMs);
    results.push(r);
    totalPass += r.summary.passed;
    totalFail += r.summary.failed;
    totalSkip += r.summary.skipped;
    totalFlaky += r.summary.flaky;
    log(`round=${idx} spec=${s} pass=${r.summary.passed} fail=${r.summary.failed} exit=${r.exitCode}${r.timedOut ? ' timeout' : ''}`);
  }
  return {
    round: idx,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    results,
    totals: { passed: totalPass, failed: totalFail, skipped: totalSkip, flaky: totalFlaky },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const deep = args.includes('--deep');
  const intervalSec = parseInt(args.find((a) => a.startsWith('--interval='))?.split('=')[1] ?? '300', 10);
  const maxRounds = parseInt(args.find((a) => a.startsWith('--max-rounds='))?.split('=')[1] ?? '12', 10);
  const timeoutMs = parseInt(args.find((a) => a.startsWith('--timeout='))?.split('=')[1] ?? '180000', 10);
  const specs = deep ? DEEP_SPECS : DEFAULT_SPECS;

  const runner = pickRunner();
  log(`e2e-monitor start specs=${specs.length} interval=${intervalSec}s maxRounds=${maxRounds} timeoutMs=${timeoutMs} deep=${deep} runner=${runner.cmd}`);

  const state = readState();
  state.startedAt = new Date().toISOString();
  state.specs = specs;
  state.intervalSec = intervalSec;
  state.maxRounds = maxRounds;
  state.deep = deep;
  state.runner = { cmd: runner.cmd, prefix: runner.prefix };

  for (let i = 1; i <= maxRounds; i += 1) {
    const round = await heartbeatRound(i, runner, specs, timeoutMs);
    state.rounds.push(round);
    state.lastRoundAt = round.finishedAt;
    state.lastTotals = round.totals;
    writeState(state);
    appendRun(round);
    log(`round=${i} totals pass=${round.totals.passed} fail=${round.totals.failed} skip=${round.totals.skipped} flaky=${round.totals.flaky} dur=${round.durationMs}ms`);
    if (i < maxRounds) await new Promise((r) => setTimeout(r, intervalSec * 1000));
  }
  state.finishedAt = new Date().toISOString();
  writeState(state);
  log('e2e-monitor exit');
}

main().catch((err) => {
  log(`fatal ${err?.stack ?? err}`);
  process.exit(1);
});
