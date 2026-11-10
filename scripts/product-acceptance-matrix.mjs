import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { COMPONENT_DISPOSITION_ENTRIES } from '../shared/dcs/component-disposition-catalog.ts';
import { assertSafeOutputDirectory, repositoryIdentity, sha256, sha256File } from './lib/agent-engineering-acceptance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY = 'harness/specs/fixtures/product-acceptance-matrix/inventory.json';
export const GROUPS = ['provider', 'sessions', 'coding', 'knowledge', 'memory', 'delegation', 'channels', 'tools', 'settings'];
const words = (value) => Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim());

export function validateInventory(inventory, root = ROOT, defaultIds = COMPONENT_DISPOSITION_ENTRIES.filter((entry) => entry.disposition === 'default').map((entry) => entry.id)) {
  const errors = [];
  if (inventory?.schema !== 'ProductAcceptanceMatrix/v1' || inventory?.node !== 'TF-0582') errors.push('Invalid matrix identity');
  const groups = Array.isArray(inventory?.groups) ? inventory.groups : [];
  if (JSON.stringify(groups.map((group) => group.id).sort()) !== JSON.stringify([...GROUPS].sort())) errors.push('All nine groups must appear exactly once');
  const covered = new Set();
  for (const group of groups) {
    if (!words(group.positiveOracles) || !words(group.negativeOracles)) errors.push(`${group.id}: positive and negative oracles are required`);
    if (!words(group.evidenceLayers) || !Array.isArray(group.remainingChecks)) errors.push(`${group.id}: evidence layer and remaining checks are required`);
    if (!words(group.files)) errors.push(`${group.id}: test files are required`);
    for (const file of group.files ?? []) {
      const location = typeof file === 'string' ? resolve(root, file) : root;
      if (typeof file !== 'string' || !/^tests\/e2e\/.+\.spec\.ts$/u.test(file) || !location.startsWith(resolve(root) + sep)
          || !existsSync(location) || !statSync(location).isFile()) errors.push(`${group.id}: missing or invalid test file ${file}`);
    }
    if (!Array.isArray(group.defaultComponents)) errors.push(`${group.id}: disposition mapping is required`);
    for (const id of group.defaultComponents ?? []) {
      covered.add(id);
      if (!defaultIds.includes(id)) errors.push(`${group.id}: unknown default disposition ${id}`);
    }
  }
  for (const id of defaultIds) if (!covered.has(id)) errors.push(`Unmapped default disposition ${id}`);
  if (!words(inventory?.additionalAcceptance)) errors.push('Additional TF-0582 acceptance criteria are required');
  return errors;
}

export function collectCases(report, root = ROOT) {
  if (!Array.isArray(report?.suites) || typeof report?.config?.rootDir !== 'string') throw new Error('Invalid Playwright report');
  const cases = [];
  const walk = (suites, parents = []) => {
    for (const suite of suites) {
      const titles = [...parents, suite.title];
      for (const spec of suite.specs ?? []) {
        const file = relative(root, resolve(report.config.rootDir, spec.file)).split(sep).join('/');
        for (const test of spec.tests ?? []) {
          cases.push({
            key: JSON.stringify([file, ...titles, spec.title, test.projectName ?? '', test.repeatEachIndex ?? 0]),
            file, title: [...titles, spec.title].join(' > '), expectedStatus: test.expectedStatus,
            results: test.results ?? [], status: test.status,
          });
        }
      }
      walk(suite.suites ?? [], titles);
    }
  };
  walk(report.suites);
  return cases;
}

export function evaluateReport(discovery, actual, exitCode, root = ROOT) {
  const failures = [];
  if (exitCode !== 0) failures.push(`Playwright exit code: ${exitCode}`);
  if ((discovery?.errors?.length ?? 0) || (actual?.errors?.length ?? 0)) failures.push('Playwright reported collection or global errors');
  let planned = [], observed = [];
  try { planned = collectCases(discovery, root); observed = collectCases(actual, root); }
  catch (error) { failures.push(error.message); }
  if (!planned.length) failures.push('No planned tests');
  const expected = new Set(planned.map((test) => test.key));
  const found = new Set(observed.map((test) => test.key));
  if (expected.size !== planned.length || found.size !== observed.length) failures.push('Duplicate test identity');
  for (const key of expected) if (!found.has(key)) failures.push(`Missing planned test: ${key}`);
  for (const key of found) if (!expected.has(key)) failures.push(`Unexpected test: ${key}`);
  for (const test of planned) if (test.expectedStatus !== 'passed') failures.push(`Planned test is skipped or expected to fail: ${test.title}`);
  let passed = 0, failed = 0, skipped = 0;
  for (const test of observed) {
    if (test.results.length === 1 && test.results[0].status === 'passed' && test.expectedStatus === 'passed' && test.status === 'expected') passed++;
    else {
      if (test.expectedStatus === 'skipped' || test.results.some((result) => result.status === 'skipped')) skipped++;
      else failed++;
      failures.push(`Test did not pass once without retries: ${test.title}`);
    }
  }
  return { passed: failures.length === 0, counts: { planned: planned.length, observed: observed.length, passed, failed, skipped }, failures };
}

function executeNode(label, argv, output, env) {
  const jsonPath = resolve(output, `${label}.json`);
  const stdout = resolve(output, `${label}.stdout.txt`), stderr = resolve(output, `${label}.stderr.txt`);
  const handles = [openSync(stdout, 'wx'), openSync(stderr, 'wx')];
  const startedAt = new Date().toISOString();
  let result;
  try {
    result = spawnSync(process.execPath, argv, { cwd: ROOT, env: { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: jsonPath },
      stdio: ['ignore', ...handles], windowsHide: true, timeout: label === 'discovery' ? 120_000 : 3_600_000 });
  } finally { handles.forEach((handle) => closeSync(handle)); }
  let report = null;
  if (existsSync(jsonPath)) {
    try { report = JSON.parse(readFileSync(jsonPath, 'utf8')); } catch { /* Invalid output is rejected by evaluateReport. */ }
  }
  return { report, command: { argv: [process.execPath, ...argv], startedAt, finishedAt: new Date().toISOString(),
    exitCode: result.status, signal: result.signal, error: result.error?.message ?? null,
    artifacts: [stdout, stderr, ...(existsSync(jsonPath) ? [jsonPath] : [])].map((path) => ({ path: relative(output, path), sha256: sha256File(path) })) } };
}

function executePlaywright(label, files, output, env) {
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const argv = [cli, 'test', ...files, '--workers=1', '--retries=0', '--reporter=json', `--output=${resolve(output, 'test-results')}`];
  if (label === 'discovery') argv.push('--list');
  return executeNode(label, argv, output, env);
}

export function validateBuildStamp(stamp, candidate) {
  if (!stamp || stamp.head !== candidate.commit || !candidate.clean) throw new Error('Runtime build is not bound to the clean candidate');
}

function buildIdentity(candidate) {
  const stamp = JSON.parse(readFileSync(resolve(ROOT, 'openclaw_runtime/dist/.buildstamp'), 'utf8'));
  validateBuildStamp(stamp, candidate);
  for (const entry of ['dist/index.html', 'dist-electron/main/index.js', 'openclaw_runtime/dist/entry.js']) {
    if (!statSync(resolve(ROOT, entry)).isFile()) throw new Error(`Missing build entry: ${entry}`);
  }
  const files = ['dist', 'dist-electron', 'openclaw_runtime/dist', 'openclaw_runtime/dist-runtime'].flatMap((directory) =>
    readdirSync(resolve(ROOT, directory), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
      .map((entry) => { const path = resolve(entry.parentPath, entry.name); return { path: relative(ROOT, path).split(sep).join('/'), sha256: sha256File(path) }; }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return { stamp, files, digest: sha256(JSON.stringify(files)) };
}

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: { check: { type: 'boolean' }, plan: { type: 'boolean' }, run: { type: 'boolean' }, output: { type: 'string' }, group: { type: 'string', multiple: true } } });
  if ([values.check, values.plan, values.run].filter(Boolean).length !== 1) throw new Error('Choose exactly one of --check, --plan, --run');
  const inventory = JSON.parse(readFileSync(resolve(ROOT, INVENTORY), 'utf8'));
  const errors = validateInventory(inventory);
  if (errors.length) throw new Error(errors.join('\n'));
  const selected = values.group ?? GROUPS;
  if (!selected.length || new Set(selected).size !== selected.length || selected.some((id) => !GROUPS.includes(id))) throw new Error('Unknown or duplicate group');
  const files = [...new Set(inventory.groups.filter((group) => selected.includes(group.id)).flatMap((group) => group.files))].sort();
  if (values.check) { console.log(JSON.stringify({ groups: inventory.groups.length, files: files.length, inventoryValid: true })); return 0; }
  if (!values.output) throw new Error('--output is required');
  const output = assertSafeOutputDirectory(values.output, ROOT);
  if (existsSync(output)) throw new Error('Output directory already exists; use a fresh run directory');
  mkdirSync(output, { recursive: true });
  const save = (name, value) => writeFileSync(resolve(output, name), JSON.stringify(value, null, 2) + '\n');
  const candidate = repositoryIdentity(ROOT);
  const plan = { schema: 'ProductMatrixPlan/v1', driven_by: 'agent', actor: 'product-matrix-runner', node: inventory.node,
    createdAt: new Date().toISOString(), candidate, selectedGroups: selected, files, inventory,
    inventorySha256: sha256File(resolve(ROOT, INVENTORY)), catalogSha256: sha256File(resolve(ROOT, 'shared/dcs/component-disposition-catalog.ts')) };
  save('plan.json', plan);
  if (values.plan) { console.log(JSON.stringify({ plan: resolve(output, 'plan.json'), groups: selected.length, files: files.length, executed: false })); return 0; }
  if (!candidate.clean) throw new Error('Acceptance requires a clean committed candidate; plan.json records the dirty input');
  const env = { ...process.env, CLAWX_SPACE_BUNNY_ACCEPTANCE: '1', CLAWX_MOYU_ACCEPTANCE: '1',
    // Dependencies are provisioned before acceptance; a nested pnpm must not purge a shared dependency directory.
    pnpm_config_verify_deps_before_run: 'false' };
  const discovery = executePlaywright('discovery', files, output, env);
  const discoveryFailures = [];
  let planned = [];
  try { planned = collectCases(discovery.report); } catch (error) { discoveryFailures.push(error.message); }
  if (discovery.command.exitCode !== 0 || discovery.report?.errors?.length) discoveryFailures.push('Playwright discovery failed');
  if (!planned.length) discoveryFailures.push('Playwright discovery is empty');
  for (const file of files) if (!planned.some((test) => test.file === file)) discoveryFailures.push(`No collected tests for ${file}`);
  for (const test of planned) if (!files.includes(test.file)) discoveryFailures.push(`Unexpected collected file ${test.file}`);
  for (const test of planned) if (test.expectedStatus !== 'passed') discoveryFailures.push(`Required test is skipped or expected to fail: ${test.title}`);
  const builds = [];
  let build = null;
  if (!discoveryFailures.length) {
    for (const [label, args] of [
      ['vite-build', ['--max-old-space-size=6144', 'node_modules/vite/bin/vite.js', 'build']],
      ['runtime-build', ['scripts/build-openclaw-runtime.mjs']],
    ]) {
      const step = executeNode(label, args, output, env);
      builds.push(step.command);
      if (step.command.exitCode !== 0) { discoveryFailures.push(`${label} failed: ${step.command.exitCode}`); break; }
    }
    if (!discoveryFailures.length) {
      try { build = buildIdentity(candidate); save('build-inputs.json', build); }
      catch (error) { discoveryFailures.push(error.message); }
    }
  }
  const actual = discoveryFailures.length ? null : executePlaywright('execution', files, output, env);
  const result = actual ? evaluateReport(discovery.report, actual.report, actual.command.exitCode)
    : { passed: false, counts: { planned: planned.length, observed: 0, passed: 0, failed: 0, skipped: 0 }, failures: discoveryFailures };
  const after = repositoryIdentity(ROOT);
  if (after.commit !== candidate.commit || after.tree !== candidate.tree || !after.clean) { result.passed = false; result.failures.push('Candidate changed during execution'); }
  if (actual) {
    try { if (buildIdentity(candidate).digest !== build.digest) throw new Error('Build changed during execution'); }
    catch (error) { result.passed = false; result.failures.push(error.message); }
  }
  const report = { schema: 'ProductMatrixRun/v1', driven_by: 'agent', actor: 'product-matrix-runner', candidate, candidateAfter: after,
    planSha256: sha256File(resolve(output, 'plan.json')), selectedSuiteResult: result,
    buildDigest: build?.digest ?? null, commands: [discovery.command, ...builds, ...(actual ? [actual.command] : [])],
    groups: inventory.groups.map((group) => ({ id: group.id, selected: selected.includes(group.id), suiteStatus: selected.includes(group.id) ? (result.passed ? 'passed' : 'failed') : 'not-run', evidenceLayers: group.evidenceLayers, remainingChecks: group.remainingChecks })),
    remainingAcceptance: [...inventory.additionalAcceptance, ...inventory.groups.filter((group) => !selected.includes(group.id)).map((group) => `${group.id}: not run in this batch`), ...inventory.groups.flatMap((group) => group.remainingChecks.map((check) => `${group.id}: ${check}`))] };
  save('report.json', report);
  save('report.sha256.json', { 'report.json': sha256(JSON.stringify(report, null, 2) + '\n') });
  console.log(JSON.stringify({ report: resolve(output, 'report.json'), selectedSuitePassed: result.passed, counts: result.counts, remainingAcceptance: report.remainingAcceptance.length }));
  return result.passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
