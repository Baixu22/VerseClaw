#!/usr/bin/env node
/**
 * Validate repo-relative paths asserted by capability/reliability evidence.
 * These are strings, not imports, so a rename would otherwise silently break
 * the claim's source evidence.
 */
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { canonicalEvidenceBytes, sha256CanonicalEvidenceFile } from './lib/canonical-evidence-hash.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEMANTIC_FIXTURES = 'harness/specs/fixtures/ontology-lite-existing-contracts';
const SEMANTIC_REPORT_SCHEMA = 'ProductSemanticEvidence/v1';
const SEMANTIC_MODULE_SOURCES = [
  'shared/product-semantics.ts', 'shared/types/identity-scope.ts', 'shared/types/task-ledger-reference.ts',
  'shared/types/coding-run.ts', 'shared/product-semantic-unsafe-claims.ts',
];
const SEMANTIC_HASH_POLICY = {
  algorithm: 'sha256', canonical: 'canonical-evidence-hash/v1',
  normalization: 'UTF-8 CRLF/CR to LF; binary bytes unchanged',
  raw: 'Separate original-byte digest for recovery; not the cross-platform integrity comparison',
};

// The runtime already owns tsx; this offline auditor does not add a dependency or runtime consumer.
function semanticContract(root) {
  const runtimeRequire = createRequire(resolve(ROOT, 'openclaw_runtime/package.json'));
  const { register } = runtimeRequire('tsx/cjs/api');
  const loader = register({ namespace: randomUUID() });
  try { return loader.require(resolve(root, 'shared/product-semantics.ts'), import.meta.url); }
  finally { loader.unregister(); }
}

const rawSha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sha256 = bytes => rawSha256(canonicalEvidenceBytes(bytes));
const git = (root, ...args) => execFileSync('git', args, { cwd: root, windowsHide: true, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const gitText = (root, ...args) => git(root, ...args).toString('utf8').trim();
const jsonFile = path => JSON.parse(readFileSync(path, 'utf8'));
const outside = path => path === '..' || path.startsWith('../') || path.startsWith('..\\') || isAbsolute(path);

function rejectSource(path, rule, message) {
  throw Object.assign(new Error(message), { relationKey: '$contract', field: path, rule });
}

function semanticSource(root, rootReal, ref, commit) {
  if (typeof ref !== 'string' || !ref || /[\\:\0]/u.test(ref) || isAbsolute(ref)
    || ref.split('/').some(part => !part || part === '.' || part === '..')) {
    rejectSource(String(ref), 'source-scope', 'Source references must be canonical repository-relative file paths.');
  }
  const absolute = resolve(root, ref);
  if (outside(relative(root, absolute))) rejectSource(ref, 'source-scope', 'Source leaves the repository root.');
  if (!existsSync(absolute)) rejectSource(ref, 'source-missing', 'Referenced source does not exist.');
  if (outside(relative(rootReal, realpathSync(absolute)))) rejectSource(ref, 'source-symlink-escape', 'Resolved source leaves the repository root.');
  if (!statSync(absolute).isFile()) rejectSource(ref, 'source-shape', 'Referenced source must be a file.');
  try { git(root, 'ls-files', '--error-unmatch', '--', ref); }
  catch { rejectSource(ref, 'source-untracked', 'Source is not tracked by this candidate repository.'); }
  let blob;
  try { blob = git(root, 'show', commit + ':' + ref); }
  catch { rejectSource(ref, 'source-candidate', 'Source is absent from the candidate commit.'); }
  const bytes = readFileSync(absolute);
  if (sha256(bytes) !== sha256(blob)) rejectSource(ref, 'source-candidate', 'Working source differs from its candidate blob.');
  return { path: ref, canonicalSha256: sha256CanonicalEvidenceFile(absolute), rawSha256: rawSha256(bytes), candidateBlobRawSha256: rawSha256(blob), tracked: true };
}

/** A derived static audit; it never establishes an owner receipt, task fact or authorization. */
export function createProductSemanticEvidence(root = ROOT, options = {}) {
  const report = { schema: SEMANTIC_REPORT_SCHEMA, contractVersion: null, driven_by: 'agent',
    actor: options.actor ?? 'native-semantic-evidence-auditor', command: options.command ?? 'createProductSemanticEvidence(root)',
    checkedAt: new Date().toISOString(), candidate: null, hashPolicy: { ...SEMANTIC_HASH_POLICY },
    relationKeys: [], relationSources: [], sourceRefs: [], checks: [], diagnostics: [],
    unverified: ['Static declarations and source bytes only; no owner-store, runtime receipt, actual task completion or grant was verified.'], status: 'invalid' };
  try {
    const rootReal = realpathSync(root);
    if (realpathSync(gitText(root, 'rev-parse', '--show-toplevel')) !== rootReal) rejectSource('$candidate', 'candidate-root', 'The supplied root must be the Git worktree root.');
    report.candidate = { commit: gitText(root, 'rev-parse', 'HEAD'), tree: gitText(root, 'rev-parse', 'HEAD^{tree}'), dirty: gitText(root, 'status', '--porcelain', '--untracked-files=all') !== '' };
    for (const ref of SEMANTIC_MODULE_SOURCES) semanticSource(root, rootReal, ref, report.candidate.commit);
    const { PRODUCT_SEMANTIC_CONTRACT_VERSION, PRODUCT_SEMANTIC_RELATIONS, productSemanticRelationKey, validateProductSemanticRelations } = semanticContract(root);
    report.contractVersion = PRODUCT_SEMANTIC_CONTRACT_VERSION;
    if (report.contractVersion !== 'ProductSemanticRelations/v1') rejectSource('contractVersion', 'input-version', 'Unsupported source semantic contract version.');
    const input = jsonFile(resolve(root, SEMANTIC_FIXTURES, 'relations.valid.json'));
    const catalog = jsonFile(resolve(root, SEMANTIC_FIXTURES, 'sources.json'));
    if (input.schema !== 'ProductSemanticRelationInput/v1' || catalog.schema !== 'ProductSemanticSources/v1') rejectSource('$contract', 'input-version', 'Unsupported semantic input or source-catalog version.');
    const result = validateProductSemanticRelations(input.relations, input.context);
    report.diagnostics.push(...result.diagnostics);
    report.relationKeys = input.relations?.map(productSemanticRelationKey) ?? [];
    if (!isDeepStrictEqual(report.relationKeys, PRODUCT_SEMANTIC_RELATIONS.map(productSemanticRelationKey))) rejectSource('relationKeys', 'relation-coverage', 'The input must cover exactly the six existing directed relations.');
    if (!Array.isArray(catalog.relations) || !isDeepStrictEqual(catalog.relations.map(row => row.relationKey), report.relationKeys)
      || !Array.isArray(catalog.boundaries)) rejectSource('relationSources', 'source-coverage', 'Source mapping must cover every existing relation and declare its boundaries.');
    report.checks.push({ id: 'relations', command: 'validateProductSemanticRelations(relations, context)', exitCode: result.valid ? 0 : 1 });
    const refs = new Set([
      ...SEMANTIC_MODULE_SOURCES,
      'scripts/check-evidence-refs.mjs', 'scripts/lib/canonical-evidence-hash.mjs',
      SEMANTIC_FIXTURES + '/sources.json', SEMANTIC_FIXTURES + '/relations.valid.json', SEMANTIC_FIXTURES + '/relations.invalid.json',
      ...input.relations.flatMap(row => row.evidenceRefs ?? []),
    ]);
    const anchors = [];
    for (const row of catalog.relations) {
      if (!['source-backed', 'documented-only', 'gap'].includes(row.evidenceGrade)
        || !Array.isArray(row.documentation) || row.documentation.length === 0 || !Array.isArray(row.owners) || row.owners.length === 0
        || !Array.isArray(row.regressions) || !Array.isArray(row.unverified)) rejectSource(row.relationKey, 'source-coverage', 'Each relation needs explicit owner/documentation references, regressions and limitations.');
      anchors.push(...row.documentation, ...row.owners);
      row.regressions.forEach(ref => refs.add(ref));
      report.relationSources.push({ relationKey: row.relationKey, evidenceGrade: row.evidenceGrade, documentation: row.documentation, owners: row.owners });
      report.unverified.push(...row.unverified);
    }
    for (const boundary of catalog.boundaries) {
      if (!Array.isArray(boundary.sources) || !Array.isArray(boundary.regressions)) rejectSource('boundaries', 'source-coverage', 'Boundary sources and regressions must be explicit arrays.');
      anchors.push(...boundary.sources);
      boundary.regressions.forEach(ref => refs.add(ref));
    }
    anchors.forEach(ref => refs.add(ref.path));
    report.sourceRefs = [...refs].sort().map(ref => semanticSource(root, rootReal, ref, report.candidate.commit));
    for (const { path, locator } of anchors) {
      if (typeof locator !== 'string' || !locator || !readFileSync(resolve(root, path), 'utf8').includes(locator)) rejectSource(path, 'source-anchor', 'The declared source locator is missing.');
    }
    report.checks.push({ id: 'sources', command: 'realpath + git ls-files + git show + canonical-evidence-hash/v1', exitCode: 0 });
    report.checks.push({ id: 'candidate', command: 'git rev-parse HEAD / HEAD^{tree}; git status --porcelain --untracked-files=all', exitCode: report.candidate.dirty ? 1 : 0 });
    if (report.candidate.dirty) rejectSource('candidate.dirty', 'candidate-dirty', 'Dirty inputs are diagnostic only and cannot satisfy clean-candidate acceptance.');
    if (typeof report.actor !== 'string' || !report.actor.trim()) rejectSource('actor', 'actor-required', 'An actual agent actor is required.');
    if (typeof report.command !== 'string' || !report.command.trim()) rejectSource('command', 'command-required', 'The executed audit command is required.');
    report.status = report.diagnostics.length === 0 ? 'valid' : 'invalid';
  } catch (error) {
    report.diagnostics.push({ relationKey: error.relationKey ?? '$contract', field: error.field ?? 'sources', rule: error.rule ?? 'evidence-input', message: error.message });
  }
  return report;
}

/** Recomputes current source/candidate facts; a stored pass cannot substitute for these checks. */
export function validateProductSemanticEvidence(root, report) {
  const diagnostics = [];
  const add = (field, rule, message) => diagnostics.push({ relationKey: '$contract', field, rule, message });
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    add('report', 'report-required', 'A nonempty semantic report is required.');
    return { valid: false, diagnostics };
  }
  const current = createProductSemanticEvidence(root, { actor: report.actor, command: report.command });
  diagnostics.push(...current.diagnostics);
  if (report.schema !== SEMANTIC_REPORT_SCHEMA || report.contractVersion !== current.contractVersion) add('contractVersion', 'report-version', 'Unsupported report or semantic contract version.');
  if (report.driven_by !== 'agent' || typeof report.actor !== 'string' || !report.actor.trim()) add('actor', 'actor-required', 'The report must identify its actual agent actor.');
  if (typeof report.command !== 'string' || !report.command.trim()) add('command', 'command-required', 'The executed audit command is required.');
  if (typeof report.checkedAt !== 'string' || !Number.isFinite(Date.parse(report.checkedAt))) add('checkedAt', 'report-time', 'A valid check timestamp is required.');
  if (!isDeepStrictEqual(report.hashPolicy, SEMANTIC_HASH_POLICY)) add('hashPolicy', 'hash-policy', 'Hash algorithm and normalization must match the canonical evidence policy.');
  if (!isDeepStrictEqual(report.candidate, current.candidate)) add('candidate', 'candidate-mismatch', 'The report does not identify this current clean candidate.');
  for (const field of ['relationKeys', 'relationSources']) if (!isDeepStrictEqual(report[field], current[field])) add(field, 'relation-coverage', 'Relation keys and owner references differ from current source declarations.');
  if (!Array.isArray(report.sourceRefs) || report.sourceRefs.length === 0) add('sourceRefs', 'source-digest', 'Source references and canonical digests are required.');
  else {
    const project = rows => rows.map(row => ({ path: row.path, canonicalSha256: row.canonicalSha256, candidateBlobRawSha256: row.candidateBlobRawSha256, tracked: row.tracked }));
    if (report.sourceRefs.some(row => !row || typeof row !== 'object' || !/^[a-f0-9]{64}$/u.test(row.rawSha256 ?? ''))
      || !isDeepStrictEqual(project(report.sourceRefs), project(current.sourceRefs))) add('sourceRefs', 'source-digest', 'Source paths or their candidate/canonical digests do not match.');
  }
  if (!isDeepStrictEqual(report.checks, current.checks) || report.checks?.length !== 3 || report.checks.some(row => row.exitCode !== 0)) add('checks', 'checks-required', 'Every declared relation, source and candidate check must be present and successful.');
  if (report.status !== 'valid' || !Array.isArray(report.diagnostics) || report.diagnostics.length !== 0) add('status', 'report-status', 'An invalid or incomplete report cannot be a pass.');
  if (!isDeepStrictEqual(report.unverified, current.unverified)) add('unverified', 'limitations-required', 'Every source-declared static-evidence limitation must remain explicit.');
  for (const field of Object.keys(report)) if (!Object.hasOwn(current, field)) add(field, 'undeclared-report-field', 'The derived report cannot add authority or undeclared state.');
  return { valid: diagnostics.length === 0, diagnostics };
}
const EVIDENCE_FILES = [
  'shared/product-semantics.ts',
  'shared/capability-claims.ts',
  'shared/sensitive-content-boundary.ts',
  'shared/reliability-boundaries.ts',
  'shared/dcs/prod-flags-catalog.ts',
];

const REPO_PATH_PREFIXES = [
  'src/',
  'shared/',
  'electron/',
  'harness/',
  'openclaw_runtime/',
  'tests/',
  'scripts/',
  'docs/',
  'reports/',
  'plans/',
  'artifacts/',
];
const PATH_LIKE = /(?:^|[\s'"`\[(])((?:src|shared|electron|harness|openclaw_runtime|tests|scripts|docs|reports|plans|artifacts)\/[A-Za-z0-9_.@%+~()\/:-]+?\.(?:tsx|ts|jsonl|json|mjs|js|md|yml|yaml|css|html))/g;

export function collectEvidenceRefs(root = ROOT) {
  const refs = new Map();
  for (const relative of EVIDENCE_FILES) {
    const absolute = join(root, relative);
    if (!existsSync(absolute)) {
      refs.set(relative, [relative]);
      continue;
    }
    const text = readFileSync(absolute, 'utf8');
    const found = new Set();
    for (const match of text.matchAll(PATH_LIKE)) {
      const value = match[1];
      if (REPO_PATH_PREFIXES.some((prefix) => value.startsWith(prefix))) found.add(value);
    }
    refs.set(relative, [...found].sort());
  }
  const packagePath = join(root, 'package.json');
  if (existsSync(packagePath)) {
    const scripts = JSON.parse(readFileSync(packagePath, 'utf8')).scripts ?? {};
    const packageRefs = new Set();
    for (const command of Object.values(scripts)) {
      if (typeof command !== 'string') continue;
      for (const match of command.matchAll(PATH_LIKE)) {
        if (match[1].startsWith('openclaw_runtime/')) packageRefs.add(match[1]);
      }
    }
    refs.set('package.json scripts', [...packageRefs].sort());
  }
  return refs;
}

export function checkEvidenceRefs(root = ROOT) {
  const missing = [];
  for (const [owner, refs] of collectEvidenceRefs(root)) {
    for (const ref of refs) {
      if (!existsSync(join(root, ref))) missing.push({ owner, ref });
    }
  }
  return { ok: missing.length === 0, missing };
}

function main() {
  const result = checkEvidenceRefs(ROOT);
  if (!result.ok) {
    console.error('[evidence-refs] FAIL missing referenced paths:');
    for (const entry of result.missing) console.error(`  ${entry.owner}: ${entry.ref}`);
    process.exitCode = 1;
    return;
  }
  const count = [...collectEvidenceRefs(ROOT).values()].reduce((sum, refs) => sum + refs.length, 0);
  console.log(`[evidence-refs] PASS ${count} referenced path(s)`);
}

if (isMainEntrypoint(import.meta.url)) main();
