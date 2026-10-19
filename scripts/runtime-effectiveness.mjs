#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const OUT_DIR = resolve(ROOT, 'artifacts/runtime-effectiveness');
const REPORT_JSON = resolve(OUT_DIR, 'report.json');
const REPORT_MD = resolve(OUT_DIR, 'report.md');
const HISTORY_JSON = resolve(OUT_DIR, 'history.json');

const args = new Set(process.argv.slice(2));
const reportOnly = args.has('--report-only');
const live = args.has('--live');

if (![...args].every((arg) => ['--report-only', '--live'].includes(arg))) {
  const unknown = [...args].find((arg) => !['--report-only', '--live'].includes(arg));
  throw new Error(`Unknown runtime effectiveness argument: ${unknown}`);
}

await mkdir(OUT_DIR, { recursive: true });

if (reportOnly) {
  if (!existsSync(REPORT_JSON)) {
    throw new Error(`Cannot regenerate markdown; missing ${REPORT_JSON}`);
  }
  const report = JSON.parse(await readFile(REPORT_JSON, 'utf8'));
  const markdown = await renderMarkdown(report);
  await writeFile(REPORT_MD, markdown, 'utf8');
  console.log(JSON.stringify({ report: REPORT_JSON, markdown: REPORT_MD }, null, 2));
  process.exit(0);
}

const report = await runEvaluation({ live });
await writeFile(REPORT_JSON, JSON.stringify(report, null, 2), 'utf8');
await writeFile(REPORT_MD, await renderMarkdown(report), 'utf8');
await writeHistory(report);
console.log(JSON.stringify(report, null, 2));

if (report.decision.status === 'blocked') {
  process.exitCode = 1;
}

async function runEvaluation({ live }) {
  const script = String.raw`
  (async () => {
    const helperModule = await import("../tests/unit/helpers/runtime-effectiveness-eval.ts");
    const helper = helperModule.evaluateRuntimeEffectiveness ? helperModule : helperModule.default;
    const report = await helper.evaluateRuntimeEffectiveness({
      mode: ${JSON.stringify(live ? 'hybrid' : 'deterministic')},
      includeLiveProbe: ${JSON.stringify(live)},
    });
    console.log("RUNTIME_EFFECTIVENESS_REPORT " + JSON.stringify(report));
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
  `;
  const result = spawnPnpm([
    '--config.verify-deps-before-run=false',
    '--dir',
    'openclaw_runtime',
    'exec',
    'tsx',
    '--tsconfig',
    'tsconfig.json',
    '-',
  ], {
    cwd: ROOT,
    env: process.env,
    input: script,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout.replace(/^RUNTIME_EFFECTIVENESS_REPORT .*$/m, '').trimStart());
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`runtime effectiveness evaluator failed with exit code ${result.status ?? 1}`);
  }
  const line = result.stdout?.split(/\r?\n/).find((entry) => entry.startsWith('RUNTIME_EFFECTIVENESS_REPORT '));
  if (!line) {
    throw new Error('runtime effectiveness evaluator did not emit a report payload');
  }
  return JSON.parse(line.slice('RUNTIME_EFFECTIVENESS_REPORT '.length));
}

async function renderMarkdown(report) {
  const script = String.raw`
  (async () => {
    const helperModule = await import("../tests/unit/helpers/runtime-effectiveness-eval.ts");
    const helper = helperModule.renderRuntimeEffectivenessMarkdown ? helperModule : helperModule.default;
    const report = JSON.parse(process.env.RUNTIME_EFFECTIVENESS_REPORT_JSON ?? "{}");
    console.log(helper.renderRuntimeEffectivenessMarkdown(report));
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
  `;
  const result = spawnPnpm([
    '--config.verify-deps-before-run=false',
    '--dir',
    'openclaw_runtime',
    'exec',
    'tsx',
    '--tsconfig',
    'tsconfig.json',
    '-',
  ], {
    cwd: ROOT,
    env: {
      ...process.env,
      RUNTIME_EFFECTIVENESS_REPORT_JSON: JSON.stringify(report),
    },
    input: script,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`runtime effectiveness markdown renderer failed with exit code ${result.status ?? 1}`);
  }
  return result.stdout;
}

async function writeHistory(report) {
  let history = [];
  if (existsSync(HISTORY_JSON)) {
    try {
      const parsed = JSON.parse(await readFile(HISTORY_JSON, 'utf8'));
      history = Array.isArray(parsed) ? parsed : [];
    } catch {
      history = [];
    }
  }
  history.push({
    generatedAt: report.generatedAt,
    mode: report.mode,
    durationMs: report.durationMs,
    decision: report.decision.status,
    acceptance: report.acceptance?.status,
    gate: report.acceptance?.gate,
    summary: report.summary,
    components: report.components.map((entry) => ({
      id: entry.id,
      decision: entry.decision,
      score: entry.effectivenessScore,
    })),
  });
  await writeFile(HISTORY_JSON, JSON.stringify(history.slice(-50), null, 2), 'utf8');
}

function spawnPnpm(args, options) {
  if (process.platform !== 'win32') {
    return spawnSync('pnpm', args, options);
  }
  return spawnSync(process.env.ComSpec ?? 'cmd.exe', [
    '/d',
    '/s',
    '/c',
    ['pnpm', ...args].map(quoteWindowsCommandArg).join(' '),
  ], options);
}

function quoteWindowsCommandArg(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/u.test(value)) {
    return value;
  }
  return '"' + value.replace(/(["^&|<>])/gu, '^$1') + '"';
}
