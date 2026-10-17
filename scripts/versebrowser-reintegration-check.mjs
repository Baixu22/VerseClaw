#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

export const LOCK_PATH = 'harness/specs/fixtures/versebrowser-reintegration/source-lock.json';
export const M00_DIR = 'harness/specs/fixtures/versebrowser-reintegration/m00';
const M00_FILES = {
  baseline: 'm00-baseline.json',
  tasks: 'm00-task-conservation.json',
  api: 'm00-api-crosswalk.json',
  files: 'm00-file-delta-review.json',
  allowlist: 'm00-next-phase-allowlist.json',
};
const SAFE_DISPOSITIONS = new Set(['wire_required', 'constraint_preserved', 'historical_evidence_preserved', 'deferred']);

export function hashSource(bytes) {
  const canonical = Buffer.from(bytes.toString('latin1').replaceAll('\r\n', '\n'), 'latin1');
  return createHash('sha256').update(canonical).digest('hex');
}

function issue(kind, detail) {
  return { kind, ...detail };
}

export function inspectProtectedInputs(lock, sourceRoot, read = readFile) {
  const entries = Array.isArray(lock?.protectedInputs) ? lock.protectedInputs : [];
  const issues = [];
  const seen = new Set();
  let verified = 0;
  return Promise.all(entries.map(async (entry) => {
    if (!entry || typeof entry.path !== 'string' || path.isAbsolute(entry.path) || entry.path.split('/').includes('..')) {
      issues.push(issue('source_path_invalid', { path: String(entry?.path) }));
      return;
    }
    if (seen.has(entry.path)) {
      issues.push(issue('duplicate_source_path', { path: entry.path }));
      return;
    }
    seen.add(entry.path);
    const absolute = path.join(sourceRoot, entry.path);
    let bytes;
    try {
      bytes = await read(absolute);
    } catch (error) {
      issues.push(issue(error?.code === 'ENOENT' ? 'source_missing' : 'source_unreadable', { path: entry.path, message: String(error?.message ?? error) }));
      return;
    }
    const raw = createHash('sha256').update(bytes).digest('hex');
    const lf = hashSource(bytes);
    if (raw !== entry.sha256 && lf !== entry.lfSha256) {
      issues.push(issue('source_hash_mismatch', { path: entry.path, expected: entry.sha256, actual: raw, lfExpected: entry.lfSha256, lfActual: lf }));
      return;
    }
    verified += 1;
  })).then(() => ({
    status: issues.length === 0 ? 'pass' : 'fail',
    expected: entries.length,
    verified,
    issues,
  }));
}

export function extractAgentBrowserMethods(contractText) {
  const marker = 'agentBrowser: {';
  const start = contractText.indexOf(marker);
  if (start < 0) return new Set();
  let depth = 0;
  let end = -1;
  for (let index = start + marker.length - 1; index < contractText.length; index += 1) {
    const char = contractText[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) { end = index; break; }
    }
  }
  const block = contractText.slice(start, end < 0 ? contractText.length : end + 1);
  const methods = new Set();
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^\s{4}([A-Za-z][A-Za-z0-9]*)\??\s*:/);
    if (match) methods.add(match[1]);
  }
  return methods;
}

export function inspectHostSurface(contractText, lock) {
  const present = extractAgentBrowserMethods(contractText);
  const legacyExpected = Array.isArray(lock?.hostApi?.existingMethods) ? lock.hostApi.existingMethods : [];
  const sourceExpected = Array.isArray(lock?.hostApi?.sourceMethods) ? lock.hostApi.sourceMethods : [];
  const sourceOnly = new Set(Array.isArray(lock?.hostApi?.sourceOnlyMethods) ? lock.hostApi.sourceOnlyMethods : []);
  const missingLegacy = legacyExpected.filter((method) => !present.has(method));
  const pendingSourceOnly = sourceExpected.filter((method) => sourceOnly.has(method) && !present.has(method));
  const unexpected = [...present].filter((method) => !sourceExpected.includes(method));
  const issues = [];
  for (const method of missingLegacy) issues.push(issue('legacy_method_missing', { method }));
  for (const method of unexpected) issues.push(issue('unknown_host_method', { method }));
  return {
    status: issues.length === 0 ? 'pass' : 'fail',
    legacyExpected: legacyExpected.length,
    legacyPresent: legacyExpected.length - missingLegacy.length,
    legacyMissing: missingLegacy,
    sourceOnlyExpected: sourceOnly.size,
    sourceOnlyPresent: sourceOnly.size - pendingSourceOnly.length,
    sourceOnlyPending: pendingSourceOnly,
    issues,
  };
}

export function inspectTaskMapping(taskArtifact, lock) {
  const issues = [];
  const entries = Array.isArray(taskArtifact?.entries) ? taskArtifact.entries : [];
  const ids = entries.map((entry) => entry?.sourceTaskId);
  const unique = new Set(ids);
  if (taskArtifact?.sourceArchive?.nodeCount !== 190) issues.push(issue('source_task_count_mismatch', { expected: 190, actual: taskArtifact?.sourceArchive?.nodeCount }));
  if (taskArtifact?.sourceArchive?.edgeCount !== 338) issues.push(issue('source_edge_count_mismatch', { expected: 338, actual: taskArtifact?.sourceArchive?.edgeCount }));
  if (entries.length !== 190) issues.push(issue('source_task_entry_count_mismatch', { expected: 190, actual: entries.length }));
  if (unique.size !== ids.length) issues.push(issue('duplicate_source_task_entry', { count: ids.length - unique.size }));
  for (const entry of entries) {
    if (entry?.review?.reviewStatus !== 'reviewed' || !SAFE_DISPOSITIONS.has(entry?.review?.disposition)) {
      issues.push(issue('source_task_disposition_missing', { sourceTaskId: entry?.sourceTaskId }));
    }
  }
  return {
    status: issues.length === 0 ? 'pass' : 'fail',
    entryCount: entries.length,
    uniqueCount: unique.size,
    issues,
  };
}

export function inspectAllowlist(allowlist, lock) {
  const issues = [];
  const excluded = new Set([
    ...(lock?.proposedModule?.excludedProjectRoots ?? []),
    '.git', '.local', '.agent-workbench', '.ae', 'node_modules', 'dist', 'data',
  ]);
  const lockByPath = new Map((lock?.protectedInputs ?? []).map((entry) => [entry.path, entry]));
  const expectedRoles = new Map();
  for (const entry of lock?.protectedInputs ?? []) expectedRoles.set(entry.role, (expectedRoles.get(entry.role) ?? 0) + 1);
  const seen = new Set();
  for (const [role, entries] of Object.entries(allowlist?.groups ?? {})) {
    if ((expectedRoles.get(role) ?? 0) !== (Array.isArray(entries) ? entries.length : -1)) {
      issues.push(issue('allowlist_role_count_mismatch', { role, expected: expectedRoles.get(role) ?? 0, actual: Array.isArray(entries) ? entries.length : null }));
    }
    for (const entry of Array.isArray(entries) ? entries : []) {
      const relative = entry?.path;
      if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split('/').includes('..')) {
        issues.push(issue('allowlist_path_invalid', { role, path: relative }));
        continue;
      }
      if (seen.has(relative)) issues.push(issue('allowlist_duplicate_path', { path: relative }));
      seen.add(relative);
      if ([...excluded].some((root) => relative === root || relative.startsWith(root + '/'))) {
        issues.push(issue('process_path_forbidden', { role, path: relative }));
      }
      if (role === 'required_runtime_patch' || entry?.requiresPatch === true) {
        const registered = lockByPath.get(relative);
        if (!registered || registered.role !== 'required_runtime_patch') {
          issues.push(issue('unregistered_patch', { role, path: relative }));
        }
      }
    }
  }
  return { status: issues.length === 0 ? 'pass' : 'fail', issues };
}

export function inspectFileDeltas(fileArtifact, lock) {
  const issues = [];
  const entries = Array.isArray(fileArtifact?.entries) ? fileArtifact.entries : [];
  const expectedPairs = lock?.comparison?.totalPairs ?? 0;
  if (entries.length !== expectedPairs) issues.push(issue('file_delta_count_mismatch', { expected: expectedPairs, actual: entries.length }));
  const allowed = new Set(['verbatim', 'import_rewrite_only', 'behavior_delta_review_required']);
  const lockPaths = new Set((lock?.protectedInputs ?? []).map((entry) => entry.path));
  const knownDeltas = entries.filter((entry) => entry?.classification === 'behavior_delta_review_required');
  for (const entry of entries) {
    if (!allowed.has(entry?.classification)) issues.push(issue('file_delta_classification_unknown', { target: entry?.target, classification: entry?.classification }));
    if (entry?.registeredPatch && !lockPaths.has(entry.registeredPatch)) issues.push(issue('unregistered_patch', { path: entry.registeredPatch, target: entry.target }));
  }
  return {
    status: issues.length === 0 ? 'pass' : 'fail',
    pairCount: entries.length,
    verbatim: entries.filter((entry) => entry?.classification === 'verbatim').length,
    importRewriteOnly: entries.filter((entry) => entry?.classification === 'import_rewrite_only').length,
    behaviorDeltaReviewRequired: knownDeltas.length,
    knownDeltas: knownDeltas.map((entry) => entry.target),
    issues,
  };
}

export function evaluateReintegration(inputs, options = {}) {
  const critical = [
    inputs.protectedInputs,
    inputs.hostSurface,
    inputs.taskMapping,
    inputs.allowlist,
    inputs.fileDeltas,
  ].flatMap((section) => section?.issues ?? []);
  const sourceOnlyPending = inputs.hostSurface?.sourceOnlyPending ?? [];
  const knownDeltas = inputs.fileDeltas?.knownDeltas ?? [];
  const blockers = [
    ...sourceOnlyPending.map((method) => `source_only_method_pending:${method}`),
    ...knownDeltas.map((target) => `behavior_delta_review_required:${target}`),
    'product_module_not_imported',
  ];
  const prepared = critical.length === 0;
  const complete = false;
  const status = !prepared ? 'fail' : 'prepared';
  return {
    schemaVersion: 1,
    check: 'versebrowser-reintegration',
    driven_by: 'agent',
    actor: 'codex',
    stage: options.requireFinal ? 'final' : 'preparation',
    status,
    sourcePreservation: inputs.protectedInputs,
    missing: {
      legacyMethods: inputs.hostSurface?.legacyMissing ?? [],
      sourceOnlyMethods: sourceOnlyPending,
      behaviorDeltas: knownDeltas,
      productModuleImported: false,
    },
    unknown: {
      runtimeAcceptance: 'not-tested',
      packagedAcceptance: 'not-tested',
      platformCompatibility: 'not-tested',
      consumerBehaviorParity: 'must be verified at the owning checkpoints',
    },
    scopeAllowlist: inputs.allowlist,
    hostApi: inputs.hostSurface,
    taskMapping: inputs.taskMapping,
    fileDeltas: inputs.fileDeltas,
    finalMigration: { status: complete ? 'complete' : 'incomplete', complete, blockers },
    issues: critical,
    exitCode: options.requireFinal ? (complete ? 0 : 1) : (prepared ? 0 : 1),
  };
}

async function loadJson(file) { return JSON.parse(await readFile(file, 'utf8')); }

export async function runCheck(options = {}) {
  const hostRoot = path.resolve(options.hostRoot ?? process.cwd());
  const sourceRoot = path.resolve(options.sourceRoot ?? process.env.VERSEBROWSER_SOURCE_ROOT ?? 'D:/versebrowser');
  const lockPath = path.resolve(hostRoot, options.lockPath ?? LOCK_PATH);
  const lock = options.lock ?? await loadJson(lockPath);
  const protectedInputs = options.protectedInputs ?? await inspectProtectedInputs(lock, sourceRoot);
  const contractText = options.contractText ?? await readFile(path.join(hostRoot, 'shared/host-api/contract.ts'), 'utf8');
  const hostSurface = options.hostSurface ?? inspectHostSurface(contractText, lock);
  const taskMapping = options.taskMapping ?? inspectTaskMapping(await loadJson(path.join(hostRoot, M00_DIR, M00_FILES.tasks)), lock);
  const allowlist = options.allowlist ?? inspectAllowlist(await loadJson(path.join(hostRoot, M00_DIR, M00_FILES.allowlist)), lock);
  const fileDeltas = options.fileDeltas ?? inspectFileDeltas(await loadJson(path.join(hostRoot, M00_DIR, M00_FILES.files)), lock);
  return evaluateReintegration({ protectedInputs, hostSurface, taskMapping, allowlist, fileDeltas }, options);
}

function textReport(report) {
  const lines = [
    `VerseBrowser reintegration check: ${report.status} (${report.stage})`,
    `source-preservation: ${report.sourcePreservation.status} (${report.sourcePreservation.verified}/${report.sourcePreservation.expected})`,
    `host-api: ${report.hostApi.status} legacy ${report.hostApi.legacyPresent}/${report.hostApi.legacyExpected}; source-only pending ${report.hostApi.sourceOnlyPending.length}`,
    `task-mapping: ${report.taskMapping.status} (${report.taskMapping.entryCount} entries)`,
    `allowlist: ${report.scopeAllowlist.status}`,
    `file-deltas: ${report.fileDeltas.status} (${report.fileDeltas.behaviorDeltaReviewRequired} behavior deltas pending)`,
    `missing: legacy=${report.missing.legacyMethods.length} source-only=${report.missing.sourceOnlyMethods.length} behavior-deltas=${report.missing.behaviorDeltas.length}`,
    `unknown: runtime=${report.unknown.runtimeAcceptance} package=${report.unknown.packagedAcceptance}`,
    `final-migration: ${report.finalMigration.status}; ready=${report.finalMigration.complete}`,
  ];
  for (const entry of report.issues) lines.push(`ISSUE ${entry.kind} ${JSON.stringify(entry)}`);
  if (!report.finalMigration.complete) lines.push('Preparation success does not mean migration or runtime acceptance is complete.');
  return lines.join('\n') + '\n';
}

async function main() {
  const { values } = parseArgs({ options: {
    'host-root': { type: 'string' }, 'source-root': { type: 'string' }, lock: { type: 'string' },
    json: { type: 'boolean' }, 'require-final': { type: 'boolean' }, output: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  }, allowPositionals: false });
  if (values.help) { process.stdout.write('Usage: node scripts/versebrowser-reintegration-check.mjs [--source-root DIR] [--host-root DIR] [--json] [--require-final] [--output FILE]\n'); return; }
  const report = await runCheck({ hostRoot: values['host-root'], sourceRoot: values['source-root'], lockPath: values.lock, requireFinal: values['require-final'] });
  const output = values.json ? JSON.stringify(report, null, 2) + '\n' : textReport(report);
  if (values.output) await writeFile(path.resolve(values.output), JSON.stringify(report, null, 2) + '\n', 'utf8');
  process.stdout.write(output);
  process.exitCode = report.exitCode;
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => { process.stderr.write(String(error?.stack ?? error) + '\n'); process.exitCode = 1; });
}
