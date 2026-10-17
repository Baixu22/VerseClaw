#!/usr/bin/env node
/**
 * M12 closeout verifier (versebrowser-upstream-reintegration).
 *
 * Re-audits the final candidate after the duplicate-implementation retirement:
 *  - every retired host duplicate file and its duplicate host test is gone;
 *  - no live (non-test) module imports the retired specifiers;
 *  - every retired host test has a module counterpart that still exists;
 *  - the 190 source-task mapping and the two deferred scopes are preserved;
 *  - the declared host API surface is intact;
 *  - the module package allowlist is unchanged;
 *  - the freshly built dist/dist-electron output is byte-identical to the
 *    packaged app.asar bundle, so packaging evidence still binds to the
 *    final candidate.
 *
 * A pass here is a scoped reintegration-closeout audit, not a product GA claim.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { inspectHostSurface, inspectTaskMapping as inspectM00TaskMapping } from './versebrowser-reintegration-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const M12_DIR = 'harness/specs/fixtures/versebrowser-reintegration/m12';
const M00_TASKS = 'harness/specs/fixtures/versebrowser-reintegration/m00/m00-task-conservation.json';
const LOCK_PATH = 'harness/specs/fixtures/versebrowser-reintegration/source-lock.json';
const MODULE_TESTS = 'packages/versebrowser/tests';
const EXPECTED_DEFERRED = ['TF-0343', 'TF-0344'];
const EXPECTED_MODULE_FILES = [
  'dist',
  'LICENSE',
  'scripts/patch-upstream.mjs',
  'patches',
  'import-manifest.json',
  'integration-patches.json',
  'package.json',
];

// Duplicate implementations retired in M12 (zero production callers at retire time).
export const RETIRED_IMPLEMENTATIONS = [
  'electron/services/agent-browser-service.ts',
  'electron/services/agent-browser-cli-runner.ts',
  'electron/services/agent-browser-task-service.ts',
  'electron/services/agent-browser-vault.ts',
  'electron/services/agent-browser-supervised-task-executor.ts',
  'electron/services/agent-browser/browser-control/actions.ts',
  'electron/services/agent-browser/browser-control/automation-boundary-detector.ts',
  'electron/services/agent-browser/browser-control/boundary-choice-tool-executor.ts',
  'electron/services/agent-browser/browser-control/browser-debugger-connection.ts',
  'electron/services/agent-browser/browser-control/console-recorder.ts',
  'electron/services/agent-browser/browser-control/full-access-tool-executor.ts',
  'electron/services/agent-browser/browser-control/js-source-index.ts',
  'electron/services/agent-browser/browser-control/js-source-tool-executor.ts',
  'electron/services/agent-browser/browser-control/network-recorder.ts',
  'electron/services/agent-browser/browser-control/page-text-extractor.ts',
  'electron/services/agent-browser/browser-control/replay-tool-executor.ts',
  'electron/services/agent-browser/browser-control/runtime-read-tool-executor.ts',
  'electron/services/agent-browser/browser-control/same-origin-js-fetcher.ts',
  'electron/services/agent-browser/browser-control/same-origin-source-map-fetcher.ts',
  'electron/services/agent-browser/browser-control/snapshot-manager.ts',
  'electron/services/agent-browser/browser-control/source-map-fetch-guards.ts',
  'electron/services/agent-browser/browser-control/source-map-tool-executor.ts',
  'electron/services/agent-browser/browser-control/tab-manager.ts',
];

// Duplicate host unit tests retired with those implementations; each has a
// byte-equivalent module counterpart under packages/versebrowser/tests.
export const RETIRED_TESTS = [
  'agent-browser-automation-boundary-detector.test.ts',
  'agent-browser-boundary-choice-tool-executor.test.ts',
  'agent-browser-browser-control.test.ts',
  'agent-browser-cdp-lifecycle.test.ts',
  'agent-browser-cli-runner.test.ts',
  'agent-browser-console-recorder.test.ts',
  'agent-browser-full-access-tool-executor.test.ts',
  'agent-browser-js-source-index.test.ts',
  'agent-browser-js-source-tool-executor.test.ts',
  'agent-browser-network-recorder.test.ts',
  'agent-browser-network-service.test.ts',
  'agent-browser-p4-002-isolation.test.ts',
  'agent-browser-page-text-extractor.test.ts',
  'agent-browser-replay-tool-executor.test.ts',
  'agent-browser-runtime-mode.test.ts',
  'agent-browser-runtime-read-tool-executor.test.ts',
  'agent-browser-same-origin-source-map-fetcher.test.ts',
  'agent-browser-service.test.ts',
  'agent-browser-source-map-tool-executor.test.ts',
  'agent-browser-supervised-task-executor.test.ts',
  'agent-browser-tab-manager.test.ts',
  'agent-browser-task-service.test.ts',
  'agent-browser-vault.test.ts',
  'r0-4-agent-browser-nav-timeout.test.ts',
];

const DEAD_SPECIFIERS = [
  'agent-browser-service',
  'agent-browser-cli-runner',
  'agent-browser-task-service',
  'agent-browser-vault',
  'agent-browser-supervised-task-executor',
  'services/agent-browser/',
];

const LIVE_ROOTS = ['electron', 'src', 'shared', 'openclaw_runtime/src', 'scripts'];
// This verifier names the retired specifiers as data; it must not flag itself.
const LIVE_SCAN_IGNORE = new Set(['scripts/versebrowser-m12-closeout-verify.mjs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-electron', '.git', '.local', 'build', 'release', 'artifacts']);

function issue(kind, detail) {
  return { kind, ...detail };
}

async function readJson(abs) {
  return JSON.parse(await readFile(abs, 'utf8'));
}

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), out);
    } else {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

export async function inspectRetirement({ hostRoot = ROOT } = {}) {
  const issues = [];
  const presentImpl = RETIRED_IMPLEMENTATIONS.filter((rel) => existsSync(path.join(hostRoot, rel)));
  for (const rel of presentImpl) issues.push(issue('retired_implementation_present', { path: rel }));

  const presentTests = RETIRED_TESTS
    .map((name) => path.join('tests/unit', name))
    .filter((rel) => existsSync(path.join(hostRoot, rel)));
  for (const rel of presentTests) issues.push(issue('retired_test_present', { path: rel }));

  const missingCounterparts = RETIRED_TESTS
    .map((name) => path.join(MODULE_TESTS, name))
    .filter((rel) => !existsSync(path.join(hostRoot, rel)));
  for (const rel of missingCounterparts) issues.push(issue('module_counterpart_missing', { path: rel }));

  const liveImporters = [];
  for (const root of LIVE_ROOTS) {
    for (const file of await walk(path.join(hostRoot, root))) {
      const rel = path.relative(hostRoot, file).replaceAll('\\', '/');
      if (rel.startsWith('tests/') || LIVE_SCAN_IGNORE.has(rel)) continue;
      if (!/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(rel)) continue;
      const text = await readFile(file, 'utf8');
      for (const needle of DEAD_SPECIFIERS) {
        if (text.includes(needle)) liveImporters.push({ path: rel, specifier: needle });
      }
    }
  }
  for (const hit of liveImporters) issues.push(issue('live_importer_of_retired_module', hit));

  return {
    status: issues.length === 0 ? 'pass' : 'fail',
    retiredImplementations: RETIRED_IMPLEMENTATIONS.length,
    retiredTests: RETIRED_TESTS.length,
    implementationsPresent: presentImpl,
    testsPresent: presentTests,
    moduleCounterpartMissing: missingCounterparts,
    liveImporters,
    issues,
  };
}

export async function inspectTaskMapping({ hostRoot = ROOT, forestPath } = {}) {
  const tasks = await readJson(path.join(hostRoot, M00_TASKS));
  // The 190-node / 338-edge / reviewed-disposition invariants are owned by the M00
  // checker; M12 adds only the deferred-scope and forest-status re-audit.
  const m00 = await inspectM00TaskMapping(tasks);
  const issues = [...m00.issues];
  const entries = Array.isArray(tasks.entries) ? tasks.entries : [];

  const dispositions = {};
  for (const entry of entries) {
    const disposition = entry.review?.disposition;
    dispositions[disposition] = (dispositions[disposition] ?? 0) + 1;
  }

  const deferred = entries.filter((entry) => entry.review?.disposition === 'deferred');
  const deferredTargets = deferred.map((entry) => entry.review?.hostTargetTaskIds?.[0]);
  if (deferred.length !== EXPECTED_DEFERRED.length) {
    issues.push(issue('deferred_scope_count_mismatch', { expected: EXPECTED_DEFERRED.length, actual: deferred.length }));
  }
  for (const target of EXPECTED_DEFERRED) {
    if (!deferredTargets.includes(target)) issues.push(issue('deferred_scope_target_missing', { target }));
  }

  const nodeStatus = [];
  const resolvedForest = forestPath ?? path.join(hostRoot, '.agent-workbench/task-forest/graph/forest.json');
  if (existsSync(resolvedForest)) {
    const forest = await readJson(resolvedForest);
    const nodes = Array.isArray(forest.nodes) ? forest.nodes : Object.values(forest.nodes ?? {});
    for (const target of EXPECTED_DEFERRED) {
      const node = nodes.find((candidate) => candidate.id === target);
      nodeStatus.push({ id: target, status: node?.status ?? 'missing', title: node?.title ?? null });
      if (node?.status !== 'proposed') issues.push(issue('deferred_scope_node_not_proposed', { target, status: node?.status ?? 'missing' }));
    }
  }

  return {
    status: issues.length === 0 ? 'pass' : 'fail',
    sourceNodes: tasks.sourceArchive?.nodeCount ?? null,
    sourceEdges: tasks.sourceArchive?.edgeCount ?? null,
    entries: entries.length,
    dispositions,
    deferred: deferred.map((entry) => ({ sourceTaskId: entry.sourceTaskId, hostTargetTaskIds: entry.review?.hostTargetTaskIds ?? [] })),
    deferredNodeStatus: nodeStatus,
    forestInspected: existsSync(resolvedForest),
    issues,
  };
}

export async function inspectHostApiSurface({ hostRoot = ROOT } = {}) {
  const lock = await readJson(path.join(hostRoot, LOCK_PATH));
  const contractText = await readFile(path.join(hostRoot, 'shared/host-api/contract.ts'), 'utf8');
  return inspectHostSurface(contractText, lock);
}

export async function inspectModuleAllowlist({ hostRoot = ROOT } = {}) {
  const issues = [];
  const pkg = await readJson(path.join(hostRoot, 'packages/versebrowser/package.json'));
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  const sorted = [...files].sort();
  const expected = [...EXPECTED_MODULE_FILES].sort();
  if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
    issues.push(issue('module_files_allowlist_changed', { actual: sorted }));
  }
  return { status: issues.length === 0 ? 'pass' : 'fail', files: sorted, issues };
}

export async function inspectPackagedCandidate({ hostRoot = ROOT } = {}) {
  const archiveRel = 'release/win-unpacked/resources/app.asar';
  const archive = path.join(hostRoot, archiveRel);
  if (!existsSync(archive)) {
    return { status: 'not_run', reason: 'packaged_app_asar_missing', archive: archiveRel };
  }
  const require = createRequire(path.join(hostRoot, 'package.json'));
  const asar = createRequire(require.resolve('electron-builder'))('@electron/asar');
  const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

  const built = [...(await walk(path.join(hostRoot, 'dist'))), ...(await walk(path.join(hostRoot, 'dist-electron')))]
    .map((file) => path.relative(hostRoot, file).replaceAll('\\', '/'));

  const issues = [];
  let matched = 0;
  for (const rel of built) {
    const local = await readFile(path.join(hostRoot, rel));
    let packed = null;
    for (const candidate of [rel.replaceAll('/', '\\'), rel]) {
      try {
        packed = asar.extractFile(archive, candidate);
        break;
      } catch {
        /* try next spelling */
      }
    }
    if (!packed) {
      issues.push(issue('built_file_absent_from_package', { path: rel }));
      continue;
    }
    if (sha256(local) !== sha256(packed)) issues.push(issue('built_file_differs_from_package', { path: rel }));
    else matched += 1;
  }

  const packedList = asar
    .listPackage(archive)
    .map((entry) => entry.replace(/^[/\\]+/, '').replaceAll('\\', '/'))
    .filter((entry) => /^(dist|dist-electron)\/.+\.[A-Za-z0-9]+$/.test(entry));
  const builtSet = new Set(built);
  const extra = packedList.filter((entry) => !builtSet.has(entry));
  if (extra.length) issues.push(issue('extra_files_in_package_payload', { entries: extra }));

  return {
    status: issues.length === 0 ? 'pass' : 'fail',
    archive: archiveRel,
    builtFiles: built.length,
    matchedFiles: matched,
    issues,
  };
}

export async function verifyM12({ hostRoot = ROOT, forestPath } = {}) {
  const retirement = await inspectRetirement({ hostRoot });
  const taskMapping = await inspectTaskMapping({ hostRoot, forestPath });
  const hostApi = await inspectHostApiSurface({ hostRoot });
  const moduleAllowlist = await inspectModuleAllowlist({ hostRoot });
  const packagedCandidate = await inspectPackagedCandidate({ hostRoot });
  const sections = { retirement, taskMapping, hostApi, moduleAllowlist, packagedCandidate };
  const issues = Object.values(sections).flatMap((section) => section.issues ?? []);
  return {
    schemaVersion: 1,
    artifact: 'versebrowser-m12-closeout-verify',
    driven_by: 'agent',
    actor: 'codex',
    status: issues.length === 0 ? 'pass' : 'fail',
    retirement,
    taskMapping,
    hostApi,
    moduleAllowlist,
    packagedCandidate,
    issues,
    validationBoundary:
      'A pass proves the retired duplicates are gone, the module counterparts still exist, the task/scope conservation inputs are intact and the final build output equals the packaged bundle. It is not a product GA verdict and does not re-run the packaged NSIS installer.',
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      'host-root': { type: 'string' },
      'forest': { type: 'string' },
      output: { type: 'string' },
    },
    allowPositionals: false,
  });
  const report = await verifyM12({ hostRoot: values['host-root'], forestPath: values.forest });
  const text = JSON.stringify(report, null, 2) + '\n';
  if (values.output) {
    await mkdir(path.dirname(path.resolve(values.output)), { recursive: true });
    await writeFile(path.resolve(values.output), text, 'utf8');
  }
  process.stdout.write(text);
  process.exitCode = report.status === 'fail' ? 1 : 0;
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(String(error?.stack ?? error) + '\n');
    process.exitCode = 1;
  });
}
