#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_TESTS = 'packages/versebrowser/tests';
const M09_DIR = 'harness/specs/fixtures/versebrowser-reintegration/m09';
const DEFAULT_SOURCE_ROOT = process.env.VERSEBROWSER_SOURCE_ROOT ?? 'D:/versebrowser';

function hashSource(bytes) {
  return createHash('sha256').update(Buffer.from(bytes.toString('latin1').replaceAll('\r\n', '\n'), 'latin1')).digest('hex');
}
function issue(kind, detail) { return { kind, ...detail }; }

export async function classifySourceTests(sourceRoot, packageTestsPath) {
  const srcDir = path.join(sourceRoot, 'tests');
  const srcFiles = new Set(await readdir(srcDir));
  const pkgFiles = new Set(await readdir(packageTestsPath));
  const pkgPkg = JSON.parse(await readFile(path.join(path.dirname(packageTestsPath), 'package.json'), 'utf8'));
  const deps = new Set([...Object.keys(pkgPkg.dependencies ?? {}), ...Object.keys(pkgPkg.devDependencies ?? {}), ...Object.keys(pkgPkg.peerDependencies ?? {})]);
  const tests = [...srcFiles].filter((f) => f.endsWith('.test.ts'));
  const entries = [];
  for (const file of tests) {
    const text = await readFile(path.join(srcDir, file), 'utf8');
    const imports = [...new Set([...text.matchAll(/(?:from|import\s*\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]))];
    const repoRef = /(?:join\(\s*ROOT\s*,)|(?:'\.\.'\s*,\s*'scripts')|(?:readdir\(\s*'src')|(?:'\.\.\/\.\.\/scripts)|(?:scripts\/pilot)|(?:scripts\/electron-loop)|(?:scripts\/frontend-loop)/.test(text);
    const reasons = [];
    let disposition = 'module_runtime';
    for (const spec of imports) {
      if (spec.startsWith('node:') || spec === 'vitest') continue;
      if (spec.startsWith('../src/') || spec.startsWith('./src/')) continue;
      if (spec.startsWith('../scripts/') || spec.startsWith('./scripts/')) { disposition = 'source_research_or_release'; reasons.push('scripts-import:' + spec); continue; }
      if (spec.startsWith('.')) { const bare = spec.replace(/^\.\//, ''); if (srcFiles.has(bare) || pkgFiles.has(bare)) continue; reasons.push('helper:' + spec); continue; }
      const scope = spec.split('/').slice(0, 2).join('/');
      if (deps.has(spec) || deps.has(scope)) continue;
      if (spec.startsWith('playwright')) continue;
      if (spec === 'typescript') { if (disposition === 'module_runtime') disposition = 'source_guard_or_release'; reasons.push('typescript'); continue; }
      reasons.push('bare:' + spec);
    }
    if (disposition === 'module_runtime' && repoRef) disposition = 'source_guard_or_release';
    entries.push({ file, disposition, reasons, copied: pkgFiles.has(file) });
  }
  return entries;
}

export async function verifyM09({ hostRoot = ROOT, sourceRoot = DEFAULT_SOURCE_ROOT } = {}) {
  const packageTestsPath = path.join(hostRoot, PACKAGE_TESTS);
  const m09Dir = path.join(hostRoot, M09_DIR);
  const issues = [];
  const entries = await classifySourceTests(sourceRoot, packageTestsPath);
  const moduleRuntime = entries.filter((e) => e.disposition === 'module_runtime');
  const excluded = entries.filter((e) => e.disposition !== 'module_runtime');
  const sourceDir = path.join(sourceRoot, 'tests');

  for (const entry of moduleRuntime) {
    const target = path.join(packageTestsPath, entry.file);
    if (!entry.copied || !existsSync(target)) { issues.push(issue('runtime_test_missing', { file: entry.file })); continue; }
    const src = await readFile(path.join(sourceDir, entry.file));
    const dst = await readFile(target);
    if (hashSource(src) !== hashSource(dst)) issues.push(issue('runtime_test_diverged', { file: entry.file }));
  }
  for (const entry of excluded) {
    if (entry.copied) issues.push(issue('excluded_test_imported', { file: entry.file, disposition: entry.disposition }));
  }

  const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
  const b = await readJson(path.join(m09Dir, 'm09-B-original-oracles.json'));
  const c = await readJson(path.join(m09Dir, 'm09-C-original-oracles.json'));
  const statusKey = (j) => j.results.map((r) => r.taskId + '/' + r.entrance + '=' + r.status).sort().join('|');
  const parity = statusKey(b) === statusKey(c);
  if (!parity) issues.push(issue('matrix_parity_mismatch', {}));
  const expectedNotRun = ['mig-01-docs-quote/SDK', 'mig-01-docs-quote/stdio', 'mig-22-auth-handoff/SDK', 'mig-22-auth-handoff/stdio'].sort().join('|');
  const actualNotRun = c.results.filter((r) => r.status !== 'pass').map((r) => r.taskId + '/' + r.entrance).sort().join('|');
  const notRunPreserved = actualNotRun === expectedNotRun;
  if (!notRunPreserved) issues.push(issue('matrix_not_run_drift', { actual: actualNotRun }));

  const consumerB = await readFile(path.join(m09Dir, 'm09-B-source-consumer.log'), 'utf8');
  const consumerC = await readFile(path.join(m09Dir, 'm09-C-module-consumer.log'), 'utf8');
  const checkCountOk = /"checkCount":42/.test(consumerB) && /"checkCount":42/.test(consumerC);
  if (!checkCountOk) issues.push(issue('consumer_check_count_mismatch', {}));

  const status = issues.length === 0 ? 'pass' : 'fail';
  return {
    schemaVersion: 1,
    artifact: 'versebrowser-m09-regression-verify',
    driven_by: 'agent',
    actor: 'codex',
    status,
    testClosure: {
      sourceTestCount: entries.length,
      dispositions: entries.reduce((acc, e) => { acc[e.disposition] = (acc[e.disposition] ?? 0) + 1; return acc; }, {}),
      moduleRuntimeImported: moduleRuntime.length,
      excludedNotImported: excluded.length,
    },
    matrix: {
      bPass: b.results.filter((r) => r.status === 'pass').length,
      cPass: c.results.filter((r) => r.status === 'pass').length,
      total: c.results.length,
      parity,
      notRunPreserved,
      notRun: c.results.filter((r) => r.status !== 'pass').map((r) => r.taskId + '/' + r.entrance),
    },
    consumer: { checkCount: 42, bPass: checkCountOk, cPass: checkCountOk },
    issues,
  };
}

async function main() {
  const { values } = parseArgs({ options: { 'host-root': { type: 'string' }, 'source-root': { type: 'string' }, output: { type: 'string' } }, allowPositionals: false });
  const report = await verifyM09({ hostRoot: values['host-root'], sourceRoot: values['source-root'] });
  const text = JSON.stringify(report, null, 2) + '\n';
  if (values.output) await writeFile(path.resolve(values.output), text, 'utf8');
  process.stdout.write(text);
  process.exitCode = report.status === 'fail' ? 1 : 0;
}

if (isMainEntrypoint(import.meta.url)) main().catch((error) => { process.stderr.write(String(error?.stack ?? error) + '\n'); process.exitCode = 1; });