#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const ROOT = process.cwd();
const CACHE_DIR = resolve(ROOT, 'artifacts', 'typecheck-cache');
const CACHE_REPORT = resolve(CACHE_DIR, 'report.json');
const CACHE_SCHEMA = 'clawx.typecheck-cache.v1';

const CACHE_INPUTS = [
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.web.json',
  'tsconfig.test.json',
  'vite.config.ts',
  'scripts/generate-ext-bridge.mjs',
  'scripts/typecheck-agent-dev.mjs',
  'src',
  'electron',
  'shared',
  'openclaw_runtime/packages/normalization-core/src',
  'openclaw_runtime/packages/acp-core/src',
];

const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.d.ts',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);

const args = new Set(process.argv.slice(2));
const unknown = [...args].find((arg) => ![
  '--cache',
  '--force',
  '--no-cache',
].includes(arg));
if (unknown) {
  throw new Error(`Unknown typecheck-agent-dev argument: ${unknown}`);
}

const noCache = args.has('--no-cache');
const force = args.has('--force');
const cacheEnabled = (args.has('--cache') || force) && !noCache;
const startedAt = performance.now();

const bridge = await run('node', ['scripts/generate-ext-bridge.mjs']);
if (bridge.exitCode !== 0) {
  process.exitCode = bridge.exitCode;
} else {
  const fingerprint = await createTypecheckFingerprint();
  const cached = cacheEnabled && !force
    ? await readUsableCache(fingerprint.key)
    : null;

  if (cached) {
    const report = createCacheHitReport({ bridge, cached, fingerprint, startedAt });
    console.log(JSON.stringify(report, null, 2));
  } else {
    const [nodeCheck, webCheck, testCheck] = await Promise.all([
      run('pnpm', ['run', 'typecheck:node']),
      run('pnpm', ['run', 'typecheck:web']),
      runObservation('pnpm', ['run', 'typecheck:test']),
    ]);
    const results = [bridge, nodeCheck, webCheck];
    const success = results.every((result) => result.exitCode === 0);
    const report = {
      success,
      mode: 'parallel',
      testTypes: testCheck,
      cache: {
        enabled: cacheEnabled,
        status: cacheEnabled ? (force ? 'force' : 'miss') : 'disabled',
        key: fingerprint.key,
        inputCount: fingerprint.files.length,
        report: CACHE_REPORT,
      },
      totalDurationMs: Math.round(performance.now() - startedAt),
      coverageNote: 'Runs the node and web TypeScript projects as pnpm run typecheck after generating the extension bridge, and additionally typechecks tests/ (tsconfig.test.json) in observation mode: its legacy errors are reported under testTypes but do not fail the gate.',
      results,
    };
    console.log(JSON.stringify(report, null, 2));
    if (success && cacheEnabled) {
      await writeCache(report, fingerprint);
    }
    if (!success) process.exitCode = 1;
  }
}

function run(command, args) {
  return new Promise((resolveRun) => {
    const commandStartedAt = performance.now();
    const commandLine = [command, ...args].join(' ');
    const childCommand = process.platform === 'win32' && command === 'pnpm'
      ? process.env.ComSpec ?? 'cmd.exe'
      : command;
    const childArgs = process.platform === 'win32' && command === 'pnpm'
      ? ['/d', '/s', '/c', commandLine]
      : args;
    const child = spawn(childCommand, childArgs, {
      cwd: ROOT,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('close', (code) => {
      resolveRun({
        commandLine,
        exitCode: code ?? 1,
        durationMs: Math.round(performance.now() - commandStartedAt),
      });
    });
  });
}

/**
 * Run a typecheck command in observation mode: capture its output so the
 * legacy error count can be reported without failing the gate, and persist the
 * full output for a follow-up dispatch. Used for tests/ (tsconfig.test.json),
 * which has a large pre-existing type-error surface that must not block CI.
 */
function runObservation(command, args) {
  return new Promise((resolveRun) => {
    const commandStartedAt = performance.now();
    const commandLine = [command, ...args].join(' ');
    const childCommand = process.platform === 'win32' && command === 'pnpm'
      ? process.env.ComSpec ?? 'cmd.exe'
      : command;
    const childArgs = process.platform === 'win32' && command === 'pnpm'
      ? ['/d', '/s', '/c', commandLine]
      : args;
    let output = '';
    const child = spawn(childCommand, childArgs, {
      cwd: ROOT,
      windowsHide: true,
    });
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('close', (code) => {
      const errorCount = (output.match(/error TS\d+/g) ?? []).length;
      const errorLog = resolve(CACHE_DIR, 'test-typecheck-errors.log');
      const result = {
        commandLine,
        exitCode: code ?? 1,
        durationMs: Math.round(performance.now() - commandStartedAt),
        observationMode: true,
        errorCount,
        errorLog,
      };
      // Observation-only: a failure to persist the log must not fail the gate.
      mkdir(CACHE_DIR, { recursive: true })
        .then(() => writeFile(errorLog, output, 'utf8'))
        .catch(() => {})
        .finally(() => resolveRun(result));
    });
  });
}

async function createTypecheckFingerprint() {
  const files = [];
  for (const entry of CACHE_INPUTS) {
    files.push(...await collectInputFiles(entry));
  }

  const uniqueFiles = [...new Set(files)]
    .map((file) => ({
      absolute: file,
      relative: normalizePath(relative(ROOT, file)),
    }))
    .sort((left, right) => left.relative.localeCompare(right.relative));

  const hash = createHash('sha256');
  for (const file of uniqueFiles) {
    const content = await readFile(file.absolute);
    hash.update(file.relative);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }

  for (const entry of CACHE_INPUTS) {
    const absolute = resolve(ROOT, entry);
    if (!existsSync(absolute)) {
      hash.update(`missing:${normalizePath(entry)}`);
      hash.update('\0');
    }
  }

  return {
    key: hash.digest('hex'),
    files: uniqueFiles.map((file) => file.relative),
    roots: CACHE_INPUTS,
  };
}

async function collectInputFiles(entry) {
  const absolute = resolve(ROOT, entry);
  if (!existsSync(absolute)) return [];
  const info = await stat(absolute);
  if (info.isFile()) {
    return shouldHashFile(absolute) ? [absolute] : [];
  }
  if (!info.isDirectory()) return [];

  const files = [];
  const children = await readdir(absolute, { withFileTypes: true });
  for (const child of children) {
    if (shouldSkipDirectory(child.name)) continue;
    const childEntry = resolve(absolute, child.name);
    if (child.isDirectory()) {
      files.push(...await collectInputFiles(childEntry));
    } else if (child.isFile() && shouldHashFile(childEntry)) {
      files.push(childEntry);
    }
  }
  return files;
}

function shouldSkipDirectory(name) {
  return [
    '.git',
    '.vite',
    'artifacts',
    'coverage',
    'dist',
    'dist-electron',
    'node_modules',
    'output',
    'tmp',
  ].includes(name);
}

function shouldHashFile(path) {
  const normalized = normalizePath(path);
  if (normalized.endsWith('pnpm-lock.yaml')) return true;
  const match = normalized.match(/(\.[^.\/]+)$/u);
  return match ? SOURCE_EXTENSIONS.has(match[1]) : false;
}

async function readUsableCache(key) {
  if (!existsSync(CACHE_REPORT)) return null;
  try {
    const cached = JSON.parse(await readFile(CACHE_REPORT, 'utf8'));
    if (
      cached.schema === CACHE_SCHEMA &&
      cached.key === key &&
      cached.success === true &&
      Array.isArray(cached.results)
    ) {
      return cached;
    }
  } catch {
    return null;
  }
  return null;
}

function createCacheHitReport({ bridge, cached, fingerprint, startedAt }) {
  const cachedPhases = cached.results
    .filter((result) => result.commandLine !== 'node scripts/generate-ext-bridge.mjs')
    .map((result) => ({
      commandLine: result.commandLine,
      exitCode: 0,
      durationMs: 0,
      skipped: true,
      cacheHit: true,
      cachedDurationMs: result.durationMs,
      cachedAt: cached.generatedAt,
    }));

  return {
    success: true,
    mode: 'parallel',
    cache: {
      enabled: true,
      status: 'hit',
      key: fingerprint.key,
      inputCount: fingerprint.files.length,
      report: CACHE_REPORT,
      cachedAt: cached.generatedAt,
    },
    totalDurationMs: Math.round(performance.now() - startedAt),
    coverageNote: 'Reused a previous successful node/web TypeScript check because the typecheck input fingerprint is unchanged; run pnpm run typecheck for an uncached full gate.',
    results: [bridge, ...cachedPhases],
  };
}

async function writeCache(report, fingerprint) {
  await mkdir(CACHE_DIR, { recursive: true });
  const cacheReport = {
    schema: CACHE_SCHEMA,
    generatedAt: new Date().toISOString(),
    key: fingerprint.key,
    roots: fingerprint.roots,
    inputCount: fingerprint.files.length,
    success: report.success,
    mode: report.mode,
    totalDurationMs: report.totalDurationMs,
    results: report.results,
  };
  await writeFile(CACHE_REPORT, `${JSON.stringify(cacheReport, null, 2)}\n`, 'utf8');
}

function normalizePath(value) {
  return value.replaceAll('\\', '/');
}
