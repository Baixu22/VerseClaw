#!/usr/bin/env node
/**
 * Report conditional unit-test skips instead of letting them disappear in a
 * green run. Discovers suites that mention hasDeepSeekKey(), runs them once
 * with Vitest's JSON reporter, and prints file/test skipped counts.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UNIT_ROOT = join(ROOT, 'tests/unit');
const OUTPUT = join(ROOT, 'artifacts/test-skips/report.json');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

export function discoverConditionalSuites(root = ROOT) {
  const unitRoot = join(root, 'tests/unit');
  return walk(unitRoot)
    .filter((file) => /\.test\.ts$/.test(file))
    .filter((file) => {
      const text = readFileSync(file, 'utf8');
      return text.includes('hasDeepSeekKey') && text.includes('skipIf');
    })
    .map((file) => relative(root, file).replace(/\\/g, '/'))
    .sort();
}

export function summarizeVitestJson(input) {
  const parsed = JSON.parse(input);
  const files = [];
  let passed = 0;
  let skipped = 0;
  for (const file of parsed.testResults ?? []) {
    const assertions = file.assertionResults ?? [];
    const fileSkipped = assertions.filter((entry) => entry.status === 'skipped').length;
    const filePassed = assertions.filter((entry) => entry.status === 'passed').length;
    passed += filePassed;
    skipped += fileSkipped;
    files.push({ file: relative(process.cwd(), file.name).replace(/\\/g, '/'), passed: filePassed, skipped: fileSkipped });
  }
  return { passed, skipped, files };
}

function main() {
  const suites = discoverConditionalSuites(ROOT);
  if (suites.length === 0) {
    console.error('[test-skips] no conditional suites discovered');
    process.exitCode = 1;
    return;
  }
  mkdirSync(dirname(OUTPUT), { recursive: true });
  const args = ['node_modules/vitest/vitest.mjs', 'run', ...suites, '--reporter=json', '--outputFile', OUTPUT, '--maxWorkers=1'];
  execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', windowsHide: true });
  const summary = summarizeVitestJson(readFileSync(OUTPUT, 'utf8'));
  writeFileSync(OUTPUT, JSON.stringify({ suiteCount: suites.length, ...summary }, null, 2) + '\n');
  console.log(`[test-skips] suites=${suites.length} passed=${summary.passed} skipped=${summary.skipped}`);
  for (const file of summary.files) console.log(`  ${file.skipped.toString().padStart(3)} skipped  ${file.file}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
