#!/usr/bin/env node
/**
 * Validate repo-relative paths asserted by capability/reliability evidence.
 * These are strings, not imports, so a rename would otherwise silently break
 * the claim's source evidence.
 *
 * Without arguments the script keeps that behaviour and its stdout format
 * (tests/unit/evidence-refs-exist.test.ts pins the current reference count). With
 * arguments it writes or verifies a ProductSemanticEvidenceReport/v1 that binds
 * the typed product relations of shared/product-semantics.ts to the digests of
 * their source references and to the candidate commit/tree, so a stale source,
 * a moved candidate or an unsupported contract version invalidates the report:
 *
 *   --report <path>   write the report (an existing file is never overwritten); exit 0 valid, 1 invalid
 *   --verify <path>   re-read a report, recompute source digests, candidate and contract version; exit 1 on any mismatch
 *   --fixture <json>  in-memory rewrite of a file this gate reads (scripts/lib/registry-fixture.mjs); the tree is untouched
 *   --actor <name>    recorded actor; defaults to CLAWX_EVIDENCE_ACTOR, then 'unknown'. Always agent-driven.
 *
 * Source digests are taken from the candidate blob (`git cat-file blob HEAD:<path>`),
 * never from working-tree bytes, so the checkout's line-ending conversion and
 * uncommitted edits cannot enter the report; a dirty working tree is itself a
 * reason the report is invalid. `rulesEvaluated` records the relation rules the
 * registry validator actually reported under a closed probe set, not a constant.
 *
 * Exit 2 is reserved for usage, fixture, load and I/O errors: it is never a judged result.
 */
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { canonicalEvidenceBytes } from './lib/canonical-evidence-hash.mjs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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

// ---------------------------------------------------------------------------
// ProductSemanticEvidenceReport/v1
// ---------------------------------------------------------------------------

export const EVIDENCE_REPORT_SCHEMA = 'ProductSemanticEvidenceReport/v1';
export const SEMANTIC_REGISTRY_PATH = 'shared/product-semantics.ts';
/** Contract versions this checker can bind. Anything else is reported as unsupported, never read as "latest". */
export const SUPPORTED_CONTRACT_VERSIONS = Object.freeze(['ProductSemanticRelations/v1']);
/** Closed set of diagnostics this script adds on top of the relation rules the registry exports. */
export const SOURCE_DIAGNOSTIC_RULES = Object.freeze([
  'source-missing',
  'source-outside-root',
  'source-untracked',
  'source-symlink-escape',
  'source-digest-mismatch',
  'candidate-mismatch',
  'version-unsupported',
  'report-field-missing',
]);
export const EVIDENCE_NORMALIZATION = Object.freeze({
  policy: 'sha256 over scripts/lib/canonical-evidence-hash.mjs canonicalEvidenceBytes of the candidate blob (git cat-file blob HEAD:<path>): UTF-8 text with CRLF and CR normalized to LF; bytes containing NUL or invalid UTF-8 are hashed unchanged',
  rawDigestPolicy: 'sha256 over the raw bytes of the candidate blob (git cat-file blob HEAD:<path>) as committed; working-tree bytes and core.autocrlf never enter the digest, so the committed line endings stay recoverable',
});
const REGISTRY_EXPORTS = ['PRODUCT_SEMANTIC_CONTRACT_VERSION', 'PRODUCT_SEMANTIC_RELATION_RULES', 'PRODUCT_SEMANTIC_RELATIONS', 'relationKey', 'validateProductSemanticRelations'];
const GIT_OBJECT_ID = /^[0-9a-f]{40}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

class UsageError extends Error {}
class LoadError extends Error {}

const toPosix = (value) => value.replaceAll('\\', '/');
/** Repo-relative POSIX form shared by `git ls-files` output, fixture `file` keys and relation evidenceRefs. */
export function normalizeRef(ref) {
  return posix.normalize(toPosix(ref)).replace(/^\.\//, '');
}
function isInsideRoot(root, absolutePath) {
  return absolutePath === root || absolutePath.startsWith(root + sep);
}
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Two digests of the same bytes, never mixed: canonical text (stable across checkouts) and raw bytes (recoverable). */
export function digestEvidenceBytes(bytes) {
  const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return {
    digest: createHash('sha256').update(canonicalEvidenceBytes(raw)).digest('hex'),
    rawDigest: createHash('sha256').update(raw).digest('hex'),
  };
}

/**
 * Bytes of every `ref` as stored in the candidate tree (HEAD), fetched in one
 * `git cat-file --batch` round trip so nothing depends on how the working tree
 * was checked out. A path with no blob at HEAD is absent from the map; the
 * result is null when git could not answer (never assumed).
 */
export function collectCandidateBlobs(root, refs) {
  const unique = [...new Set(refs.map(normalizeRef))];
  const blobs = new Map();
  if (unique.length === 0) return blobs;
  const result = spawnSync('git', ['cat-file', '--batch'], {
    cwd: root,
    input: Buffer.from(unique.map((ref) => `HEAD:${ref}\n`).join(''), 'utf8'),
    encoding: 'buffer',
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) return null;
  const out = result.stdout;
  let offset = 0;
  for (const ref of unique) {
    const eol = out.indexOf(0x0a, offset);
    if (eol === -1) return null;
    const header = out.subarray(offset, eol).toString('utf8');
    offset = eol + 1;
    if (header.endsWith(' missing')) continue;
    const [, type, sizeText] = header.split(' ');
    const size = Number.parseInt(sizeText, 10);
    if (!Number.isInteger(size) || size < 0) return null;
    const bytes = Buffer.from(out.subarray(offset, offset + size));
    offset += size + 1;
    if (type === 'blob') blobs.set(ref, bytes);
  }
  return blobs;
}

/**
 * Facts about one source reference. `exists`, `insideRoot` and `symlinkEscape`
 * are working-tree facts; `tracked` and both digests come from the candidate
 * blob (`candidateBlobs`, null when git could not be asked — never assumed),
 * so an edited or re-checked-out working copy never changes a digest.
 * `rewrites` (normalized repo path -> text) stands in for the candidate bytes,
 * which is how a negative fixture simulates a changed source without touching
 * disk; every consulted path is added to `readPaths` so an unapplied rewrite is
 * detectable. A reference without a candidate blob is recorded unhashed.
 */
export function describeSourceRef(root, ref, { candidateBlobs = null, rewrites = {}, readPaths = new Set() } = {}) {
  const facts = { path: ref, exists: false, insideRoot: false, tracked: null, symlinkEscape: false, digest: null, rawDigest: null };
  if (typeof ref !== 'string' || ref.trim().length === 0) return facts;
  const absolute = resolve(root, ref);
  facts.insideRoot = isInsideRoot(root, absolute);
  if (!facts.insideRoot) return facts;
  let stat;
  try {
    stat = statSync(absolute);
  } catch {
    return facts;
  }
  if (!stat.isFile()) return facts;
  facts.exists = true;
  facts.symlinkEscape = !isInsideRoot(root, realpathSync(absolute));
  const normalized = normalizeRef(ref);
  facts.tracked = candidateBlobs === null ? null : candidateBlobs.has(normalized);
  if (facts.symlinkEscape) return facts;
  readPaths.add(normalized);
  const bytes = normalized in rewrites ? Buffer.from(rewrites[normalized], 'utf8') : (candidateBlobs?.get(normalized) ?? null);
  if (bytes === null) return facts;
  Object.assign(facts, digestEvidenceBytes(bytes));
  return facts;
}

export function sourceRefDiagnostics(relationKeyValue, facts) {
  const diagnostics = [];
  const add = (rule, message) => diagnostics.push({ relationKey: relationKeyValue, field: 'evidenceRefs', path: facts.path, rule, message });
  if (!facts.insideRoot) {
    add('source-outside-root', `"${facts.path}" resolves outside the repository root; only repo-relative sources are evidence.`);
    return diagnostics;
  }
  if (!facts.exists) {
    add('source-missing', `"${facts.path}" is not a regular file in the repository (deleted, moved or never added).`);
    return diagnostics;
  }
  if (facts.symlinkEscape) {
    add('source-symlink-escape', `"${facts.path}" is reached through a link whose real path leaves the repository root; its bytes were not hashed.`);
  }
  if (facts.tracked === null) {
    add('source-untracked', `"${facts.path}" tracking could not be observed (git cat-file failed); an unobserved source is not treated as tracked.`);
  } else if (!facts.tracked) {
    add('source-untracked', `"${facts.path}" exists but is not part of the candidate commit (HEAD); a local or staged file cannot stand in for clean-candidate source.`);
  }
  return diagnostics;
}

/** `git status --porcelain` lines keep their leading status columns; `dirtyPaths` drops them. */
export function describeCandidate(root) {
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) throw new Error((result.stderr || result.error?.message || `git ${args.join(' ')} failed`).trim());
    return result.stdout;
  };
  try {
    const lines = git(['status', '--porcelain']).split(/\r?\n/).filter((line) => line.length > 0);
    return {
      commit: git(['rev-parse', 'HEAD']).trim(),
      tree: git(['rev-parse', 'HEAD^{tree}']).trim(),
      dirty: lines.length > 0,
      dirtyPaths: lines.map((line) => line.slice(3)).sort(),
    };
  } catch (error) {
    return { commit: null, tree: null, dirty: null, dirtyPaths: [], error: error.message };
  }
}

/**
 * One probe per relation rule the registry declares: metadata a working
 * `validateProductSemanticRelations` must reject with exactly that rule. The
 * report's `rulesEvaluated` lists the rules the validator actually reported
 * under these probes, so a validator stubbed to a no-op cannot still claim the
 * declared set. Endpoints and kinds are the registry's own vocabulary.
 */
const PROBE_RELATION = Object.freeze({ from: 'chat', kind: 'projects', to: 'task-ledger', authorityBoundary: 'read-only-projection', evidenceRefs: ['docs/clawx-product-semantics.md'] });
export const RELATION_RULE_PROBES = Object.freeze([
  { rule: 'unknown-endpoint', candidates: [{ ...PROBE_RELATION, from: 'not-a-declared-concept' }] },
  { rule: 'unknown-kind', candidates: [{ ...PROBE_RELATION, kind: 'not-a-declared-kind' }] },
  { rule: 'unknown-authority-boundary', candidates: [{ ...PROBE_RELATION, authorityBoundary: 'not-a-declared-boundary' }] },
  { rule: 'self-loop', candidates: [{ ...PROBE_RELATION, to: 'chat' }] },
  { rule: 'duplicate-relation', candidates: [{ ...PROBE_RELATION }, { ...PROBE_RELATION }] },
  { rule: 'missing-evidence', candidates: [{ ...PROBE_RELATION, evidenceRefs: [] }] },
  { rule: 'kind-boundary-mismatch', candidates: [{ ...PROBE_RELATION, authorityBoundary: 'advisory-only' }] },
  { rule: 'relation-endpoint-mismatch', candidates: [{ from: 'routing-memo', kind: 'quality-gated-by', to: 'chat', authorityBoundary: 'same-session-scorecard', evidenceRefs: ['docs/clawx-product-semantics.md'] }] },
  { rule: 'reverse-task-authority', candidates: [{ ...PROBE_RELATION, from: 'task-ledger', to: 'chat' }] },
  { rule: 'forged-grant-field', candidates: [{ ...PROBE_RELATION, grants: ['write'] }] },
  { rule: 'cross-session-quality', candidates: [{ from: 'routing-memo', kind: 'quality-gated-by', to: 'task-loop', authorityBoundary: 'same-session-scorecard', evidenceRefs: ['docs/modules/multi-agent-and-tasks.md'] }], context: { sessionScope: 'cross-session' } },
  { rule: 'unsupported-contract-version', candidates: [{ ...PROBE_RELATION }], context: { contractVersion: 'ProductSemanticRelations/v0' } },
].map((probe) => Object.freeze(probe)));

/**
 * Runs every probe through the registry validator and reports which declared
 * rules were actually seen (`observed`, in declared order, followed by any rule
 * the validator reported without declaring), which declared rules never
 * surfaced (`missing`) and which reported rules are undeclared (`unknown`).
 * `extraDiagnostics` are diagnostics already produced for the live relations;
 * a rule reported there counts as evaluated too.
 */
export function observeRelationRules(registry, extraDiagnostics = []) {
  const declared = Array.isArray(registry.PRODUCT_SEMANTIC_RELATION_RULES) ? registry.PRODUCT_SEMANTIC_RELATION_RULES.map(String) : [];
  const seen = new Set();
  const note = (diagnostics) => {
    for (const diagnostic of Array.isArray(diagnostics) ? diagnostics : []) {
      if (typeof diagnostic?.rule === 'string') seen.add(diagnostic.rule);
    }
  };
  note(extraDiagnostics);
  for (const probe of RELATION_RULE_PROBES) note(registry.validateProductSemanticRelations(probe.candidates, probe.context)?.diagnostics);
  const unknown = [...seen].filter((rule) => !declared.includes(rule));
  return {
    observed: [...declared.filter((rule) => seen.has(rule)), ...unknown],
    missing: declared.filter((rule) => !seen.has(rule)),
    unknown,
  };
}

/**
 * Builds the report from an executed registry module. Relation diagnostics come
 * from the registry's own validator (C2); this function adds the source
 * diagnostics above, the contract-version check, the dirty-candidate check and
 * the rule-observation check. A dirty working tree, or a validator that does
 * not report its declared rules, makes the report invalid.
 */
export function buildEvidenceReport({ root, registry, candidate, actor, command, fixtures = [], rewrites = {}, readPaths = new Set(), generatedAt = new Date().toISOString() }) {
  const contractVersion = registry.PRODUCT_SEMANTIC_CONTRACT_VERSION;
  const relations = Array.isArray(registry.PRODUCT_SEMANTIC_RELATIONS) ? [...registry.PRODUCT_SEMANTIC_RELATIONS] : [];
  const diagnostics = [];
  if (!SUPPORTED_CONTRACT_VERSIONS.includes(contractVersion)) {
    diagnostics.push({
      relationKey: null,
      field: 'contractVersion',
      rule: 'version-unsupported',
      message: `Registry declares contract version ${JSON.stringify(contractVersion)}; this checker binds ${SUPPORTED_CONTRACT_VERSIONS.join(', ')} and does not read an unknown version as the latest.`,
    });
  }
  if (candidate.dirty !== false) {
    const preview = candidate.dirtyPaths.slice(0, 3).join(', ') + (candidate.dirtyPaths.length > 3 ? ', …' : '');
    diagnostics.push({
      relationKey: null,
      field: 'candidate.dirty',
      rule: 'candidate-mismatch',
      message: candidate.dirty === null
        ? `The candidate could not be observed (${candidate.error ?? 'git failed'}); an unobserved working tree binds no clean candidate.`
        : `The working tree is dirty (${candidate.dirtyPaths.length} path(s): ${preview}); a report generated over uncommitted changes binds no clean candidate and cannot be valid.`,
    });
  }
  const liveDiagnostics = registry.validateProductSemanticRelations(relations).diagnostics;
  diagnostics.push(...liveDiagnostics);
  const observation = observeRelationRules(registry, liveDiagnostics);
  if (observation.missing.length > 0 || observation.unknown.length > 0) {
    const declaredCount = Array.isArray(registry.PRODUCT_SEMANTIC_RELATION_RULES) ? registry.PRODUCT_SEMANTIC_RELATION_RULES.length : 0;
    diagnostics.push({
      relationKey: null,
      field: 'rulesEvaluated',
      rule: 'report-field-missing',
      message: `The registry validator reported ${observation.observed.length - observation.unknown.length} of ${declaredCount} declared relation rule(s) under probing (missing: ${observation.missing.join(', ') || 'none'}; unknown: ${observation.unknown.join(', ') || 'none'}); a validator that does not evaluate its declared rules cannot bind a report.`,
    });
  }

  const entries = relations.map((relation) => ({
    relationKey: registry.relationKey(relation),
    refs: isPlainObject(relation) && Array.isArray(relation.evidenceRefs) ? relation.evidenceRefs.filter((ref) => typeof ref === 'string') : [],
  }));
  const insideRefs = entries.flatMap(({ refs }) => refs.filter((ref) => isInsideRoot(root, resolve(root, ref))));
  const candidateBlobs = collectCandidateBlobs(root, insideRefs);
  const unverified = [];
  const reportRelations = entries.map(({ relationKey, refs }) => ({
    relationKey,
    sourceRefs: refs.map((ref) => {
      const facts = describeSourceRef(root, ref, { candidateBlobs, rewrites, readPaths });
      const refDiagnostics = sourceRefDiagnostics(relationKey, facts);
      diagnostics.push(...refDiagnostics);
      if (facts.digest === null) unverified.push({ relationKey, path: ref, reason: refDiagnostics[0].rule });
      return facts;
    }),
  }));
  const status = diagnostics.length === 0 ? 'valid' : 'invalid';
  return {
    schema: EVIDENCE_REPORT_SCHEMA,
    contractVersion,
    generatedAt,
    node: process.version,
    actor: { driven_by: 'agent', actor },
    command,
    exitCode: status === 'valid' ? 0 : 1,
    candidate,
    normalization: { ...EVIDENCE_NORMALIZATION },
    fixtures,
    rulesEvaluated: [...observation.observed, ...SOURCE_DIAGNOSTIC_RULES],
    relations: reportRelations,
    diagnostics,
    unverified,
    status,
  };
}

/**
 * Re-judges a stored report against the current tree: every field the contract
 * requires must be present, the contract version and normalization policy must
 * be the ones this checker binds, the candidate must still be HEAD and must
 * have been clean, and every source reference must still exist inside the
 * root, be part of the candidate commit, unescaped and with both digests equal
 * to the candidate blob's. When the live registry is supplied, the report must
 * also still describe it: one result per registry relation, the registry's own
 * evidenceRefs as that relation's sources, and the closed rule set. The live
 * relations and rule probes are executed again — so a report
 * that was trimmed, re-pointed or generated against other sources cannot verify.
 * The report file itself is never modified.
 */
export function verifyEvidenceReport(report, { root, contractVersion, candidate, rewrites = {}, readPaths = new Set(), registry = null }) {
  const diagnostics = [];
  const observedRules = [];
  const add = (field, rule, message, extra = {}) => diagnostics.push({ relationKey: null, field, rule, message, ...extra });
  const missing = (field, expectation) => add(field, 'report-field-missing', `${field} ${expectation}.`);
  const finish = () => ({ status: diagnostics.length === 0 ? 'valid' : 'invalid', diagnostics, rulesEvaluated: [...observedRules, ...SOURCE_DIAGNOSTIC_RULES] });

  if (!isPlainObject(report)) {
    missing('report', 'must be a JSON object');
    return finish();
  }
  if (report.schema === undefined) missing('schema', 'is missing');
  else if (report.schema !== EVIDENCE_REPORT_SCHEMA) add('schema', 'version-unsupported', `Report schema ${JSON.stringify(report.schema)} is not ${EVIDENCE_REPORT_SCHEMA}.`);

  if (typeof report.contractVersion !== 'string') missing('contractVersion', 'must be a string');
  else if (!SUPPORTED_CONTRACT_VERSIONS.includes(report.contractVersion)) add('contractVersion', 'version-unsupported', `Report binds contract version ${JSON.stringify(report.contractVersion)}; this checker supports ${SUPPORTED_CONTRACT_VERSIONS.join(', ')}.`);
  else if (report.contractVersion !== contractVersion) add('contractVersion', 'version-unsupported', `Report binds ${report.contractVersion} but the registry now declares ${JSON.stringify(contractVersion)}.`);

  if (typeof report.generatedAt !== 'string' || Number.isNaN(Date.parse(report.generatedAt))) missing('generatedAt', 'must be an ISO-8601 timestamp');
  if (typeof report.node !== 'string' || report.node.length === 0) missing('node', 'must record the Node version');

  if (!isPlainObject(report.actor)) missing('actor', 'must be an object { driven_by, actor }');
  else {
    if (report.actor.driven_by !== 'agent') missing('actor.driven_by', 'must be "agent"');
    if (typeof report.actor.actor !== 'string' || report.actor.actor.trim().length === 0) missing('actor.actor', 'must name the agent');
  }
  if (!Array.isArray(report.command) || report.command.length === 0 || report.command.some((part) => typeof part !== 'string')) missing('command', 'must list the invoked command');
  if (!Number.isInteger(report.exitCode)) missing('exitCode', 'must record the actual exit code');

  if (!isPlainObject(report.candidate)) missing('candidate', 'must record { commit, tree, dirty, dirtyPaths }');
  else {
    const stored = report.candidate;
    if (!GIT_OBJECT_ID.test(stored.commit ?? '')) missing('candidate.commit', 'must be a 40-hex commit id');
    if (!GIT_OBJECT_ID.test(stored.tree ?? '')) missing('candidate.tree', 'must be a 40-hex tree id');
    if (typeof stored.dirty !== 'boolean') missing('candidate.dirty', 'must be a boolean');
    else if (stored.dirty === true) add('candidate.dirty', 'candidate-mismatch', `Report records a dirty candidate (${Array.isArray(stored.dirtyPaths) ? stored.dirtyPaths.length : '?'} path(s)); it was generated over uncommitted changes and never bound a clean candidate.`);
    if (!Array.isArray(stored.dirtyPaths)) missing('candidate.dirtyPaths', 'must be an array');
    if (candidate.commit === null) add('candidate', 'candidate-mismatch', `The current candidate could not be observed: ${candidate.error}.`);
    else {
      if (GIT_OBJECT_ID.test(stored.commit ?? '') && stored.commit !== candidate.commit) add('candidate.commit', 'candidate-mismatch', `Report binds commit ${stored.commit} but HEAD is ${candidate.commit}.`);
      if (GIT_OBJECT_ID.test(stored.tree ?? '') && stored.tree !== candidate.tree) add('candidate.tree', 'candidate-mismatch', `Report binds tree ${stored.tree} but HEAD^{tree} is ${candidate.tree}.`);
    }
  }

  if (!isPlainObject(report.normalization) || typeof report.normalization.policy !== 'string' || typeof report.normalization.rawDigestPolicy !== 'string') missing('normalization', 'must record { policy, rawDigestPolicy }');
  else {
    if (report.normalization.policy !== EVIDENCE_NORMALIZATION.policy) add('normalization.policy', 'version-unsupported', 'Report digests were produced under a different normalization policy; they are not comparable.');
    if (report.normalization.rawDigestPolicy !== EVIDENCE_NORMALIZATION.rawDigestPolicy) add('normalization.rawDigestPolicy', 'version-unsupported', 'Report raw digests were produced under a different policy; they are not comparable.');
  }

  if (!Array.isArray(report.fixtures)) missing('fixtures', 'must list applied fixture ids (empty for a real run)');
  else if (report.fixtures.length > 0) add('fixtures', 'candidate-mismatch', `Report was generated under ${report.fixtures.length} in-memory fixture mutation(s) (${report.fixtures.join(', ')}); it describes a negative test, not the candidate.`);
  if (!Array.isArray(report.rulesEvaluated) || report.rulesEvaluated.length === 0) missing('rulesEvaluated', 'must list the rules that were evaluated');
  else if (registry) {
    const expectedRules = [...registry.PRODUCT_SEMANTIC_RELATION_RULES, ...SOURCE_DIAGNOSTIC_RULES];
    const storedRules = new Set(report.rulesEvaluated);
    const missingRules = expectedRules.filter((rule) => !storedRules.has(rule));
    const unknownRules = report.rulesEvaluated.filter((rule) => !expectedRules.includes(rule));
    if (missingRules.length > 0 || unknownRules.length > 0) {
      missing('rulesEvaluated', `does not match the closed rule set this checker binds (missing: ${missingRules.join(', ') || 'none'}; unknown: ${unknownRules.join(', ') || 'none'})`);
    }
  }
  if (registry) {
    const liveDiagnostics = registry.validateProductSemanticRelations(registry.PRODUCT_SEMANTIC_RELATIONS).diagnostics;
    diagnostics.push(...liveDiagnostics);
    const observation = observeRelationRules(registry, liveDiagnostics);
    observedRules.push(...observation.observed);
    if (observation.missing.length > 0 || observation.unknown.length > 0) {
      missing('rulesEvaluated', `cannot be verified by the current registry validator probes (missing: ${observation.missing.join(', ') || 'none'}; unknown: ${observation.unknown.join(', ') || 'none'})`);
    }
  }
  if (!Array.isArray(report.diagnostics)) missing('diagnostics', 'must be an array');
  else if (report.status === 'valid' && report.diagnostics.length > 0) missing('status', `is "valid" but the report carries ${report.diagnostics.length} diagnostic(s); a valid report records none`);
  if (!Array.isArray(report.unverified)) missing('unverified', 'must be an array');
  if (report.status !== 'valid' && report.status !== 'invalid') missing('status', 'must be "valid" or "invalid"');
  else if (report.status === 'invalid') add('status', 'report-field-missing', `Report recorded status "invalid" with ${Array.isArray(report.diagnostics) ? report.diagnostics.length : '?'} diagnostic(s); it holds no passing check result.`);
  if (Number.isInteger(report.exitCode) && (report.status === 'valid' || report.status === 'invalid') && (report.exitCode === 0) !== (report.status === 'valid')) {
    missing('exitCode', `(${report.exitCode}) disagrees with status "${report.status}"`);
  }

  if (!Array.isArray(report.relations)) missing('relations', 'must be an array');
  else if (report.relations.length === 0) missing('relations', 'records no relation check result');
  else {
    const storedRefs = report.relations.flatMap((entry) => (isPlainObject(entry) && Array.isArray(entry.sourceRefs) ? entry.sourceRefs : []))
      .map((stored) => (isPlainObject(stored) ? stored.path : null))
      .filter((path) => typeof path === 'string' && isInsideRoot(root, resolve(root, path)));
    const candidateBlobs = collectCandidateBlobs(root, storedRefs);
    report.relations.forEach((entry, index) => {
      if (!isPlainObject(entry) || typeof entry.relationKey !== 'string') {
        missing(`relations[${index}].relationKey`, 'must be a string');
        return;
      }
      if (!Array.isArray(entry.sourceRefs)) {
        missing(`relations[${index}].sourceRefs`, 'must be an array');
        return;
      }
      entry.sourceRefs.forEach((stored, refIndex) => {
        const field = `relations[${index}].sourceRefs[${refIndex}]`;
        if (!isPlainObject(stored) || typeof stored.path !== 'string') {
          missing(`${field}.path`, 'must be a string');
          return;
        }
        for (const flag of ['exists', 'insideRoot', 'symlinkEscape']) {
          if (typeof stored[flag] !== 'boolean') missing(`${field}.${flag}`, 'must be a boolean');
        }
        if (stored.tracked !== true && stored.tracked !== false && stored.tracked !== null) missing(`${field}.tracked`, 'must be true, false or null');
        for (const digestField of ['digest', 'rawDigest']) {
          if (stored[digestField] !== null && !SHA256_HEX.test(stored[digestField] ?? '')) missing(`${field}.${digestField}`, 'must be a sha256 hex string or null');
        }
        const now = describeSourceRef(root, stored.path, { candidateBlobs, rewrites, readPaths });
        diagnostics.push(...sourceRefDiagnostics(entry.relationKey, now));
        if (now.digest === null) return;
        for (const digestField of ['digest', 'rawDigest']) {
          if (stored[digestField] !== now[digestField]) {
            add(digestField, 'source-digest-mismatch', `"${stored.path}" ${digestField} is ${now[digestField]} now but the report recorded ${stored[digestField]}; the source changed after the report was written.`, { relationKey: entry.relationKey, path: stored.path });
          }
        }
      });
    });
    if (registry) {
      const expectedByKey = new Map(registry.PRODUCT_SEMANTIC_RELATIONS.map((relation) => [
        registry.relationKey(relation),
        (Array.isArray(relation.evidenceRefs) ? relation.evidenceRefs : []).filter((ref) => typeof ref === 'string').map((ref) => normalizeRef(ref)),
      ]));
      const seen = new Set();
      report.relations.forEach((entry, index) => {
        if (!isPlainObject(entry) || typeof entry.relationKey !== 'string' || !Array.isArray(entry.sourceRefs)) return;
        if (seen.has(entry.relationKey)) missing(`relations[${index}].relationKey`, `duplicates "${entry.relationKey}"`);
        seen.add(entry.relationKey);
        const expectedRefs = expectedByKey.get(entry.relationKey);
        if (!expectedRefs) {
          missing(`relations[${index}].relationKey`, `"${entry.relationKey}" is not a relation of the registry`);
          return;
        }
        const storedPaths = entry.sourceRefs
          .map((stored) => (isPlainObject(stored) && typeof stored.path === 'string' ? normalizeRef(stored.path) : null))
          .filter((storedPath) => storedPath !== null);
        const missingRefs = expectedRefs.filter((ref) => !storedPaths.includes(ref));
        const extraRefs = storedPaths.filter((ref) => !expectedRefs.includes(ref));
        if (missingRefs.length > 0 || extraRefs.length > 0) {
          missing(`relations[${index}].sourceRefs`, `do not match the registry's evidenceRefs for "${entry.relationKey}" (missing: ${missingRefs.join(', ') || 'none'}; extra: ${extraRefs.join(', ') || 'none'})`);
        }
      });
      for (const key of expectedByKey.keys()) {
        if (!seen.has(key)) missing('relations', `records no result for registry relation "${key}"`);
      }
    }
  }
  return finish();
}

// Executes shared/product-semantics.ts through scripts/lib/ts-import-hooks.mjs
// with the fixture rewrites served in place of the on-disk text, exactly as
// scripts/check-semantic-authority.mjs does for its registries.
async function loadSemanticRegistry(root, rewrites) {
  const { register } = await import('node:module');
  const hrefOf = (relativePath) => pathToFileURL(resolve(root, relativePath)).href;
  const rewritesByHref = Object.fromEntries(Object.entries(rewrites).map(([file, text]) => [hrefOf(file), text]));
  register('./lib/ts-import-hooks.mjs', import.meta.url, { data: { rewrites: rewritesByHref } });
  let registry;
  try {
    registry = await import(hrefOf(SEMANTIC_REGISTRY_PATH));
  } catch (error) {
    throw new LoadError(`${SEMANTIC_REGISTRY_PATH} could not be executed: ${error?.message ?? error}`);
  }
  for (const name of REGISTRY_EXPORTS) {
    if (!(name in registry)) throw new LoadError(`${SEMANTIC_REGISTRY_PATH} does not export ${name}`);
  }
  return registry;
}

function parseArgs(argv) {
  const options = { report: null, verify: null, fixtures: [], actor: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--report', '--verify', '--fixture', '--actor'].includes(flag)) throw new UsageError(`unknown argument: ${flag}`);
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} requires a value`);
    if (flag === '--fixture') options.fixtures.push(value);
    else {
      const key = flag.slice(2);
      if (options[key] !== null) throw new UsageError(`${flag} given more than once`);
      options[key] = value;
    }
    index += 1;
  }
  if (options.report !== null && options.verify !== null) throw new UsageError('--report and --verify are exclusive: verify an existing report or write a new one');
  return options;
}

function resolveActor(value) {
  const actor = (value ?? process.env.CLAWX_EVIDENCE_ACTOR ?? 'unknown').trim() || 'unknown';
  if (/^(real-)?human$/i.test(actor)) throw new UsageError(`actor ${JSON.stringify(actor)} claims a human; reports are agent-driven and must name the agent`);
  return actor;
}

function writeJson(target, value) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function formatDiagnostic(diagnostic) {
  const subject = [diagnostic.relationKey ?? '-', diagnostic.field, diagnostic.path].filter(Boolean).join(' ');
  return `  [${diagnostic.rule}] ${subject}: ${diagnostic.message}`;
}

function unappliedRewrites(rewrites, readPaths) {
  return Object.keys(rewrites).filter((file) => !readPaths.has(file));
}

async function runSemanticMode(argv) {
  const options = parseArgs(argv);
  const root = realpathSync(ROOT);
  const actor = resolveActor(options.actor);
  const command = ['node', toPosix(relative(root, realpathSync(process.argv[1]))), ...process.argv.slice(2).map(toPosix)];
  const reportTarget = options.report === null ? null : resolve(process.cwd(), options.report);
  if (reportTarget !== null && existsSync(reportTarget)) {
    throw new UsageError(`refusing to overwrite ${options.report}: historical reports are kept as written, a new input writes a new report`);
  }
  if (!process.features.typescript) {
    throw new LoadError(`Node ${process.version} cannot strip TypeScript types (process.features.typescript is ${JSON.stringify(process.features.typescript)}); Node >= 23.6 is required to execute ${SEMANTIC_REGISTRY_PATH}`);
  }
  const candidate = describeCandidate(root);
  const readPaths = new Set([SEMANTIC_REGISTRY_PATH]);
  let fixtureIds = [];
  let rewrites = {};
  let registry;
  try {
    const { loadRegistryFixtures } = await import('./lib/registry-fixture.mjs');
    const loaded = await loadRegistryFixtures(options.fixtures, { root });
    fixtureIds = loaded.fixtures.map((fixture) => fixture.id);
    rewrites = Object.fromEntries(Object.entries(loaded.files).map(([file, absolutePath]) => [normalizeRef(file), loaded.texts[absolutePath]]));
    registry = await loadSemanticRegistry(root, rewrites);
  } catch (error) {
    if (reportTarget !== null) {
      writeJson(reportTarget, {
        schema: EVIDENCE_REPORT_SCHEMA,
        contractVersion: null,
        generatedAt: new Date().toISOString(),
        node: process.version,
        actor: { driven_by: 'agent', actor },
        command,
        exitCode: 2,
        candidate,
        normalization: { ...EVIDENCE_NORMALIZATION },
        fixtures: fixtureIds,
        rulesEvaluated: [...SOURCE_DIAGNOSTIC_RULES],
        relations: [],
        diagnostics: [],
        unverified: [],
        status: 'invalid',
        loadError: error.message,
      });
    }
    throw error;
  }

  if (options.verify !== null) {
    const verifyTarget = resolve(process.cwd(), options.verify);
    let stored;
    try {
      stored = JSON.parse(readFileSync(verifyTarget, 'utf8'));
    } catch (error) {
      throw new UsageError(`report ${options.verify} could not be read as JSON: ${error.message}`);
    }
    const result = verifyEvidenceReport(stored, { root, contractVersion: registry.PRODUCT_SEMANTIC_CONTRACT_VERSION, candidate, rewrites, readPaths, registry });
    const unapplied = unappliedRewrites(rewrites, readPaths);
    if (unapplied.length > 0) throw new UsageError(`fixture mutation never applied (file is not read while verifying this report): ${unapplied.join(', ')}`);
    const relationCount = Array.isArray(stored?.relations) ? stored.relations.length : 0;
    const refCount = Array.isArray(stored?.relations) ? stored.relations.reduce((sum, entry) => sum + (Array.isArray(entry?.sourceRefs) ? entry.sourceRefs.length : 0), 0) : 0;
    if (result.status !== 'valid') {
      console.error(`[evidence-refs] FAIL verify invalid: ${toPosix(options.verify)} (${result.diagnostics.length} diagnostic(s))`);
      for (const diagnostic of result.diagnostics) console.error(formatDiagnostic(diagnostic));
      process.exitCode = 1;
      return;
    }
    console.log(`[evidence-refs] verify valid: ${toPosix(options.verify)} (${relationCount} relation(s), ${refCount} source ref(s), candidate ${stored.candidate.commit.slice(0, 9)})`);
    return;
  }

  const report = buildEvidenceReport({ root, registry, candidate, actor, command, fixtures: fixtureIds, rewrites, readPaths });
  const unapplied = unappliedRewrites(rewrites, readPaths);
  if (unapplied.length > 0) throw new UsageError(`fixture mutation never applied (file is not read by this gate): ${unapplied.join(', ')}`);
  if (reportTarget !== null) writeJson(reportTarget, report);
  const destination = reportTarget === null ? '(not written)' : toPosix(options.report);
  const refCount = report.relations.reduce((sum, entry) => sum + entry.sourceRefs.length, 0);
  if (fixtureIds.length > 0) console.error(`[evidence-refs] NOTE fixtures applied in memory: ${fixtureIds.join(', ')}`);
  if (report.status !== 'valid') {
    console.error(`[evidence-refs] FAIL report invalid: ${report.relations.length} relation(s), ${refCount} source ref(s), ${report.diagnostics.length} diagnostic(s) -> ${destination}`);
    for (const diagnostic of report.diagnostics) console.error(formatDiagnostic(diagnostic));
    process.exitCode = 1;
    return;
  }
  console.log(`[evidence-refs] report valid: ${report.relations.length} relation(s), ${refCount} source ref(s), 0 diagnostic(s) -> ${destination}`);
}

function main() {
  if (process.argv.length > 2) {
    return runSemanticMode(process.argv.slice(2)).catch((error) => {
      console.error(`[evidence-refs] ERROR ${error.message}`);
      process.exitCode = 2;
    });
  }
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
