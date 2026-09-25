#!/usr/bin/env node
// Runtime Authority Convergence final-evidence validator. It intentionally
// fails closed: engineering evidence and the user-authored human verdict are
// independently bound to one clean Git candidate and one acceptance manifest.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

import {
  ACCEPTANCE_SCHEMA,
  digestManifest,
  digestPlan,
  digestReport,
  equalDigest,
  sha256File,
  stableJson,
  validateAcceptanceManifest,
  validateReportEvidence,
} from './lib/agent-engineering-acceptance.mjs';

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA1_HEX = /^[a-f0-9]{40}$/u;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const PHASES = new Set(['engineering', 'human']);
const HUMAN_SCENARIOS = ['H-01', 'H-02', 'H-03', 'H-04', 'H-05', 'H-06'];
const HUMAN_VERDICT_KEYS = [
  'schema',
  'candidate_sha',
  'manifest_sha256',
  'engineering_report_sha256',
  'verdict',
  'accepted_scenarios',
  'failed_scenarios',
  'notes',
  'decided_at',
];

function isNonBlankString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function pathInside(child, parent) {
  const childPath = resolve(child);
  const parentPath = resolve(parent);
  const relation = relative(parentPath, childPath);
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation));
}

function resolveInputPath(root, value, label) {
  if (!isNonBlankString(value)) throw new Error(`${label} is required`);
  const pathValue = resolve(root, value);
  if (!pathInside(pathValue, root)) throw new Error(`${label} must remain inside the candidate worktree`);
  return pathValue;
}

function parseArgs(argv) {
  const values = {};
  const known = new Set(['phase', 'manifest', 'engineering-report', 'human-verdict', 'baseline', 'root']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (!known.has(key)) throw new Error(`unknown argument: --${key}`);
    if (Object.prototype.hasOwnProperty.call(values, key)) throw new Error(`duplicate argument: --${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value`);
    values[key] = value;
    index += 1;
  }
  return {
    phase: values.phase,
    manifest: values.manifest,
    engineeringReport: values['engineering-report'],
    humanVerdict: values['human-verdict'],
    baseline: values.baseline,
    root: values.root,
  };
}

function readJson(pathValue, label) {
  try {
    return JSON.parse(readFileSync(pathValue, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function git(root, args, options = {}) {
  const result = spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    timeout: options.timeoutMs ?? 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdout = String(result.stdout ?? '');
  const stderr = String(result.stderr ?? '');
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`git ${args.join(' ')} failed${stderr.trim() ? `: ${stderr.trim()}` : ''}`);
  }
  return { status: result.status ?? 1, stdout, stderr };
}

function normalizedPath(value) {
  if (!isNonBlankString(value)) return null;
  const pathValue = value.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (pathValue.startsWith('/') || /^[A-Za-z]:\//u.test(pathValue)) return null;
  const normalized = pathValue.split('/').filter(Boolean).join('/');
  if (!normalized || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) return null;
  return normalized;
}

function validateManifestDigests(manifest, errors) {
  if (!isNonBlankString(manifest?.planDigest) || !SHA256_HEX.test(manifest.planDigest)) {
    errors.push('manifest planDigest is missing or malformed');
  } else if (!equalDigest(digestPlan(manifest), manifest.planDigest)) {
    errors.push('manifest planDigest mismatch');
  }
  if (!isNonBlankString(manifest?.manifestDigest) || !SHA256_HEX.test(manifest.manifestDigest)) {
    errors.push('manifest manifestDigest is missing or malformed');
  } else if (!equalDigest(digestManifest(manifest), manifest.manifestDigest)) {
    errors.push('manifest manifestDigest mismatch');
  }
}

function validateBaseline(root, baseline, manifest, errors) {
  const acceptedBaseSha = baseline?.acceptedBaseSha;
  if (baseline?.schema !== 'runtime-authority-convergence-baseline/v1') {
    errors.push('baseline schema mismatch');
  }
  if (!isNonBlankString(acceptedBaseSha) || !SHA1_HEX.test(acceptedBaseSha)) {
    errors.push('baseline acceptedBaseSha is missing or malformed');
    return null;
  }
  const base = acceptedBaseSha.toLowerCase();
  try {
    git(root, ['cat-file', '-e', `${base}^{commit}`]);
    if (manifest?.baseRef !== base) errors.push(`manifest baseRef mismatch: ${manifest?.baseRef ?? '<missing>'} != ${base}`);
    if (!isNonBlankString(manifest?.candidate?.commit) || !SHA1_HEX.test(manifest.candidate.commit)) {
      errors.push('manifest candidate commit is missing or malformed');
      return base;
    }
    const candidate = manifest.candidate.commit.toLowerCase();
    const ancestor = git(root, ['merge-base', '--is-ancestor', base, candidate], { allowFailure: true });
    if (ancestor.status !== 0) errors.push('acceptedBaseSha is not an ancestor of candidate commit');
  } catch (error) {
    errors.push(`cannot verify baseline ancestry: ${error instanceof Error ? error.message : String(error)}`);
  }
  const locks = baseline?.productLocks ?? {};
  if (locks.liveReady !== false || locks.productApproved !== false || locks.defaultOn !== false) {
    errors.push('baseline product locks changed');
  }
  return base;
}

function validateCandidateTree(root, manifest, errors) {
  const candidate = manifest?.candidate ?? {};
  if (!isNonBlankString(candidate.commit) || !SHA1_HEX.test(candidate.commit)) {
    errors.push('manifest candidate commit is missing or malformed');
    return;
  }
  if (!isNonBlankString(candidate.tree) || !SHA1_HEX.test(candidate.tree)) {
    errors.push('manifest candidate tree is missing or malformed');
    return;
  }
  try {
    const candidateTree = git(root, ['rev-parse', '--verify', `${candidate.commit}^{tree}`]).stdout.trim().toLowerCase();
    if (candidateTree !== candidate.tree.toLowerCase()) errors.push('manifest candidate tree does not match candidate commit');
    const head = git(root, ['rev-parse', '--verify', 'HEAD']).stdout.trim().toLowerCase();
    const headTree = git(root, ['rev-parse', '--verify', 'HEAD^{tree}']).stdout.trim().toLowerCase();
    if (head !== candidate.commit.toLowerCase() || headTree !== candidate.tree.toLowerCase()) {
      errors.push('validator worktree is not checked out at the manifest candidate');
    }
  } catch (error) {
    errors.push(`cannot verify candidate identity: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateChangedPaths(root, manifest, base, errors) {
  if (!base || !isNonBlankString(manifest?.candidate?.commit)) return;
  const declared = Array.isArray(manifest.changedPaths) ? manifest.changedPaths.map(normalizedPath) : null;
  if (!declared || declared.some((pathValue) => !pathValue)) {
    errors.push('manifest changedPaths must be a normalized array');
    return;
  }
  if (new Set(declared).size !== declared.length || stableJson(declared) !== stableJson([...declared].sort())) {
    errors.push('manifest changedPaths must be unique and sorted');
  }
  try {
    const expected = git(root, ['diff', '--name-only', '-z', `${base}..${manifest.candidate.commit}`]).stdout
      .split('\0')
      .filter(Boolean)
      .map(normalizedPath)
      .filter(Boolean)
      .sort();
    if (stableJson(expected) !== stableJson(declared)) {
      errors.push(`manifest changedPaths mismatch (expected ${expected.length} paths, got ${declared.length})`);
    }
  } catch (error) {
    errors.push(`cannot recompute candidate changed paths: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const OWNERSHIP_MATRIX_RELATIVE =
  'artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/changed-path-ownership.json';
const FINAL_ACCEPTANCE_SPEC_RELATIVE = 'harness/specs/tasks/runtime-authority-convergence-final-acceptance.md';

/** Mirrors scripts/generate-rc09-ownership-matrix.mjs rcFromSubject for spec names. */
function rcOwnerFromSpecName(specName) {
  const match = /rc0(0|1|2|3|4|5|6[abcd]|7|8[ab])/iu.exec(String(specName ?? ''));
  if (!match) return null;
  const map = {
    RC00: 'RC-00',
    RC01: 'RC-01R',
    RC02: 'RC-02',
    RC03: 'RC-03',
    RC04: 'RC-04R',
    RC05: 'RC-05R',
    RC06A: 'RC-06A',
    RC06B: 'RC-06B',
    RC06C: 'RC-06C',
    RC06D: 'RC-06D',
    RC07: 'RC-07',
    RC08A: 'RC-08A',
    RC08B: 'RC-08B',
  };
  return map[match[0].toUpperCase()] ?? null;
}

/**
 * The required owner set is derived from the final spec's
 * `cumulativeOwnership.requiredSpecs`, never hardcoded here. A matrix that
 * attributes a path to a package outside that set (RC-10, an RC-01R variant
 * spec, or any invented id) must fail closed.
 */
function requiredOwnerSet(root, errors) {
  const specPath = resolve(root, ...FINAL_ACCEPTANCE_SPEC_RELATIVE.split('/'));
  if (!existsSync(specPath)) {
    errors.push(`final acceptance spec is missing: ${FINAL_ACCEPTANCE_SPEC_RELATIVE}`);
    return null;
  }
  let frontmatter;
  try {
    const text = readFileSync(specPath, 'utf8').replace(/^\uFEFF/u, '').replaceAll('\r\n', '\n');
    const match = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(text);
    frontmatter = match ? parseYaml(match[1]) : null;
  } catch (error) {
    errors.push(`cannot read the final acceptance spec: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const requiredSpecs = Array.isArray(frontmatter?.cumulativeOwnership?.requiredSpecs)
    ? frontmatter.cumulativeOwnership.requiredSpecs
    : [];
  if (requiredSpecs.length === 0) {
    errors.push('final acceptance spec declares no cumulativeOwnership.requiredSpecs');
    return null;
  }
  const owners = new Set();
  for (const specName of requiredSpecs) {
    const owner = rcOwnerFromSpecName(specName);
    if (!owner) {
      errors.push(`required spec does not resolve to an RC owner: ${specName}`);
      return null;
    }
    owners.add(owner);
  }
  return owners;
}

/**
 * RC-09 ownership-matrix validation. The final evidence bundle must contain
 * changed-path-ownership.json generated from the exact candidate diff, and the
 * matrix must partition that diff totally and disjointly:
 *
 *   - every RC-owned path maps to EXACTLY ONE owner inside the required owner
 *     set derived from the final spec;
 *   - every excluded path records the commit SHA, subject and workstream of the
 *     non-RC commit that introduced it.
 *
 * Missing matrix, schema drift, duplicate paths, an owner outside the required
 * set, an unattributed exclusion, or a partition that does not exactly cover
 * manifest.changedPaths all fail closed.
 */
function validateOwnershipMatrix(root, manifest, base, errors) {
  if (!base || !Array.isArray(manifest?.changedPaths)) return;
  const matrixPath = resolve(root, ...OWNERSHIP_MATRIX_RELATIVE.split('/'));
  if (!existsSync(matrixPath)) {
    errors.push('changed-path-ownership.json is missing from the final evidence bundle');
    return;
  }
  let matrix;
  try {
    matrix = JSON.parse(readFileSync(matrixPath, 'utf8'));
  } catch (error) {
    errors.push(`cannot read changed-path-ownership.json: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (matrix?.schema !== 'runtime-authority-convergence-rc09-ownership/v2') {
    errors.push('changed-path-ownership.json schema mismatch');
    return;
  }
  const requiredOwners = requiredOwnerSet(root, errors);
  if (!requiredOwners) return;
  if (matrix?.baseSha !== base || matrix?.headSha !== manifest.candidate.commit) {
    errors.push('changed-path-ownership.json is not bound to the manifest base/candidate commits');
  }
  const declaredRequiredOwners = Array.isArray(matrix?.requiredOwners) ? [...matrix.requiredOwners].sort() : null;
  if (!declaredRequiredOwners || stableJson(declaredRequiredOwners) !== stableJson([...requiredOwners].sort())) {
    errors.push('changed-path-ownership.json requiredOwners does not match the final spec required specs');
  }
  if (!Array.isArray(matrix.entries)) {
    errors.push('changed-path-ownership.json entries are missing');
    return;
  }
  const seen = new Set();
  let rcOwned = 0;
  let excluded = 0;
  for (const entry of matrix.entries) {
    const pathValue = normalizedPath(entry?.path);
    if (!pathValue) {
      errors.push(`changed-path-ownership.json has a malformed entry: ${JSON.stringify(entry)}`);
      continue;
    }
    if (seen.has(pathValue)) {
      errors.push(`changed path appears more than once in changed-path-ownership.json: ${pathValue}`);
      continue;
    }
    seen.add(pathValue);
    if (isNonBlankString(entry?.rc)) {
      rcOwned += 1;
      if (!requiredOwners.has(String(entry.rc))) {
        errors.push(`changed path owned by a package outside the required owner set: ${pathValue} -> ${entry.rc}`);
      }
      continue;
    }
    const excludedEntry = entry?.excluded;
    if (
      entry?.rc !== null
      || !excludedEntry
      || typeof excludedEntry !== 'object'
      || !isNonBlankString(excludedEntry.commit)
      || !SHA1_HEX.test(String(excludedEntry.commit))
      || !isNonBlankString(excludedEntry.subject)
      || !isNonBlankString(excludedEntry.workstream)
    ) {
      errors.push(`changed-path-ownership.json has an unattributed entry: ${JSON.stringify(entry)}`);
      continue;
    }
    excluded += 1;
  }
  for (const pathValue of manifest.changedPaths) {
    if (!seen.has(pathValue)) {
      errors.push(`changed path is missing from changed-path-ownership.json: ${pathValue}`);
    }
  }
  if (seen.size !== manifest.changedPaths.length) {
    errors.push(`changed-path-ownership.json path count mismatch (matrix ${seen.size}, manifest ${manifest.changedPaths.length})`);
  }
  if (matrix.totalPaths !== seen.size || matrix.rcOwnedPaths !== rcOwned || matrix.excludedPaths !== excluded) {
    errors.push('changed-path-ownership.json partition counts do not match its entries');
  }
  const byRcTotal = Object.values(matrix.byRc ?? {}).reduce((total, count) => total + (Number(count) || 0), 0);
  if (byRcTotal !== rcOwned) {
    errors.push(`changed-path-ownership.json byRc total ${byRcTotal} does not match ${rcOwned} RC-owned paths`);
  }
  const byWorkstreamTotal = Object.values(matrix.byExclusionWorkstream ?? {})
    .reduce((total, count) => total + (Number(count) || 0), 0);
  if (byWorkstreamTotal !== excluded) {
    errors.push(`changed-path-ownership.json byExclusionWorkstream total ${byWorkstreamTotal} does not match ${excluded} excluded paths`);
  }
}

function validateSourceIdentity(root, manifest, errors) {
  const source = manifest?.source;
  const candidate = manifest?.candidate?.commit;
  if (source?.identityPolicy !== 'git-blob-v1' || source?.eolPolicy !== 'git-blob') {
    errors.push('manifest source identity policy is not git-blob-v1');
  }
  if (!Array.isArray(source?.files) || source.files.length === 0) {
    errors.push('manifest source files are missing');
    return;
  }
  if (!Array.isArray(source?.missing) || source.missing.length !== 0) errors.push('manifest declares missing source inputs');
  for (const file of source.files) {
    const pathValue = normalizedPath(file?.path);
    if (!pathValue || file?.exists !== true || !isNonBlankString(file?.gitBlob) || !SHA1_HEX.test(file.gitBlob)) {
      errors.push(`manifest source input is malformed: ${file?.path ?? '<unknown>'}`);
      continue;
    }
    try {
      const candidateBlob = git(root, ['rev-parse', '--verify', `${candidate}:${pathValue}`]).stdout.trim().toLowerCase();
      if (candidateBlob !== file.gitBlob.toLowerCase()) errors.push(`source Git blob mismatch: ${pathValue}`);
      const diff = git(root, ['diff', '--quiet', candidate, '--', pathValue], { allowFailure: true });
      if (diff.status !== 0) errors.push(`source worktree differs from candidate Git blob: ${pathValue}`);
    } catch (error) {
      errors.push(`cannot verify source Git blob ${pathValue}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function validateReportContract(manifest, report, reportPath, errors) {
  const evidenceRoot = dirname(reportPath);
  errors.push(...validateReportEvidence(manifest, report, evidenceRoot, {
    expectedRole: 'verifier',
    label: 'final report',
  }));
  if (report?.documentType !== 'agent-engineering-acceptance-report' || report?.reportVersion !== 1) {
    errors.push('final report contract mismatch');
  }
  if (report?.role !== 'verifier') errors.push('final report is not independent Verifier evidence');
  if (report?.result !== 'pass' || report?.engineeringAcceptedByAgent !== true || !Array.isArray(report?.failures) || report.failures.length !== 0) {
    errors.push('engineering acceptance is not green');
  }
  if (report?.conclusion?.engineeringAcceptedByAgent !== true) errors.push('final report conclusion is not green');
  if (report?.humanEvidenceRequired !== true || report?.taskStatusRecommendation !== 'review_needed' || report?.conclusion?.residualHumanEvidence !== true) {
    errors.push('final report lost human-evidence residual');
  }
  if (!isNonBlankString(report?.actor) || !isNonBlankString(report?.executorActor) || !isNonBlankString(report?.verifierActor)) {
    errors.push('final report actors are missing or blank');
  } else if (report.actor !== report.verifierActor || report.executorActor === report.verifierActor) {
    errors.push('Executor/Verifier identity separation failed');
  }
  if (!isNonBlankString(report?.reportDigest) || !SHA256_HEX.test(report.reportDigest)) {
    errors.push('final report semantic reportDigest missing or malformed');
  } else if (!equalDigest(digestReport(report), report.reportDigest)) {
    errors.push('final report semantic reportDigest mismatch');
  }
  const safety = report?.safety ?? {};
  if (
    safety.productLocksChanged !== false
    || safety.liveReady !== false
    || safety.productApproved !== false
    || safety.defaultOn !== false
    || safety.promotionAuthorized !== false
    || report?.conclusion?.allowedPromotion !== false
  ) {
    errors.push('product lock or promotion drift');
  }
}

function validateHumanVerdict(manifest, manifestPath, reportPath, verdictPath, errors) {
  let verdict;
  try {
    verdict = parseYaml(readFileSync(verdictPath, 'utf8'));
  } catch (error) {
    errors.push(`cannot read human verdict: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (!verdict || typeof verdict !== 'object' || Array.isArray(verdict)) {
    errors.push('human verdict must be a YAML object');
    return;
  }
  const actualKeys = Object.keys(verdict).sort();
  if (stableJson(actualKeys) !== stableJson([...HUMAN_VERDICT_KEYS].sort())) errors.push('human verdict schema keys mismatch');
  if (verdict.schema !== 'runtime-authority-convergence-human-verdict/v1') errors.push('human verdict schema mismatch');
  if (verdict.candidate_sha !== manifest?.candidate?.commit) errors.push('human verdict candidate_sha mismatch');
  if (!isNonBlankString(verdict.manifest_sha256) || !SHA256_HEX.test(verdict.manifest_sha256) || !equalDigest(sha256File(manifestPath), verdict.manifest_sha256)) {
    errors.push('human verdict manifest_sha256 mismatch');
  }
  if (!isNonBlankString(verdict.engineering_report_sha256) || !SHA256_HEX.test(verdict.engineering_report_sha256) || !equalDigest(sha256File(reportPath), verdict.engineering_report_sha256)) {
    errors.push('human verdict engineering_report_sha256 mismatch');
  }
  if (verdict.verdict !== 'accepted') errors.push('human verdict is not accepted');
  if (!Array.isArray(verdict.accepted_scenarios) || stableJson(verdict.accepted_scenarios) !== stableJson(HUMAN_SCENARIOS)) {
    errors.push('human verdict accepted_scenarios must be exactly H-01 through H-06');
  }
  if (!Array.isArray(verdict.failed_scenarios) || verdict.failed_scenarios.length !== 0) errors.push('human verdict failed_scenarios must be empty');
  if (typeof verdict.notes !== 'string' || !isNonBlankString(verdict.decided_at)) errors.push('human verdict notes/decided_at are incomplete');
}

export function validateRuntimeAuthorityConvergence(options = {}) {
  const root = resolve(options.root ?? SCRIPT_ROOT);
  const errors = [];
  const phase = options.phase;
  if (!PHASES.has(phase)) {
    return { ok: false, errors: [`phase must be one of: ${[...PHASES].join(', ')}`] };
  }
  if (phase === 'engineering' && options.humanVerdictPath) errors.push('engineering phase must not receive a human verdict');
  if (phase === 'human' && !options.humanVerdictPath) errors.push('human phase requires --human-verdict');

  let manifest;
  let report;
  let baseline;
  let manifestPath;
  let reportPath;
  let verdictPath;
  try {
    manifestPath = resolveInputPath(root, options.manifestPath, 'manifest');
    reportPath = resolveInputPath(root, options.engineeringReportPath, 'engineering report');
    const baselinePath = resolveInputPath(root, options.baselinePath ?? 'artifacts/runtime-authority-convergence/rc-01/baseline.json', 'baseline');
    if (!existsSync(manifestPath) || !existsSync(reportPath) || !existsSync(baselinePath)) throw new Error('manifest, engineering report, or baseline file is missing');
    if (phase === 'human') {
      verdictPath = resolveInputPath(root, options.humanVerdictPath, 'human verdict');
      if (!existsSync(verdictPath)) throw new Error('human verdict file is missing');
    }
    manifest = readJson(manifestPath, 'manifest');
    report = readJson(reportPath, 'engineering report');
    baseline = readJson(baselinePath, 'baseline');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return { ok: false, errors };
  }

  if (manifest.schema !== ACCEPTANCE_SCHEMA || manifest.manifestVersion !== 1) errors.push('manifest schema mismatch');
  if (manifest.executionMode !== 'full') errors.push('manifest executionMode must be full');
  if (manifest.candidate?.cleanAtPlan !== true) errors.push('candidate was dirty at plan');
  validateManifestDigests(manifest, errors);
  errors.push(...validateAcceptanceManifest(manifest, { root, requireClean: true, requireFull: true }).errors);
  const base = validateBaseline(root, baseline, manifest, errors);
  validateCandidateTree(root, manifest, errors);
  validateChangedPaths(root, manifest, base, errors);
  validateOwnershipMatrix(root, manifest, base, errors);
  validateSourceIdentity(root, manifest, errors);
  validateReportContract(manifest, report, reportPath, errors);
  if (phase === 'human' && verdictPath) validateHumanVerdict(manifest, manifestPath, reportPath, verdictPath, errors);

  return { ok: errors.length === 0, errors, phase, manifest, report, baseline };
}

function usage() {
  return [
    'usage:',
    '  node scripts/validate-runtime-authority-convergence.mjs --phase engineering --manifest <path> --engineering-report <path>',
    '  node scripts/validate-runtime-authority-convergence.mjs --phase human --manifest <path> --engineering-report <path> --human-verdict <path>',
  ].join('\n');
}

export function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    const result = validateRuntimeAuthorityConvergence({
      root: args.root,
      phase: args.phase,
      manifestPath: args.manifest,
      engineeringReportPath: args.engineeringReport,
      humanVerdictPath: args.humanVerdict,
      baselinePath: args.baseline,
    });
    if (!result.ok) {
      console.error('runtime-authority-convergence evidence validator FAILED:');
      for (const error of result.errors) console.error(`  - ${error}`);
      return 1;
    }
    console.log(`runtime-authority-convergence ${result.phase} evidence validator PASSED (manifest ${result.manifest.runId}, report ${result.report.runId})`);
    return 0;
  } catch (error) {
    console.error(`runtime-authority-convergence evidence validator FAILED: ${error instanceof Error ? error.message : String(error)}`);
    console.error(usage());
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
