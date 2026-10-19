#!/usr/bin/env node
// Runtime Authority Convergence final-evidence validator. It intentionally
// fails closed: engineering evidence and the user-authored human verdict are
// independently bound to one clean Git candidate and one acceptance manifest.
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

import {
  ACCEPTANCE_SCHEMA,
  createDetachedWorktree,
  digestManifest,
  digestPlan,
  digestReport,
  equalDigest,
  repositoryIdentity,
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
  // Who actually drove H-01..H-06. Owner policy is that the agent drives them
  // (`AGENTS.md` §Human-in-the-loop policy), so the record must say so instead of
  // leaving the claim implicit; declaring 'human' when no human drove it stays
  // fabrication.
  'driven_by',
  'actor',
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
/**
 * Reads the final acceptance spec frontmatter from `root`. Callers pass the
 * candidate root so a closure commit can never rewrite the rules it is judged
 * by. Returns undefined (and records an error) when the spec is unreadable.
 */
function readFinalSpecFrontmatter(root, errors) {
  const specPath = resolve(root, ...FINAL_ACCEPTANCE_SPEC_RELATIVE.split('/'));
  if (!existsSync(specPath)) {
    errors.push(`final acceptance spec is missing: ${FINAL_ACCEPTANCE_SPEC_RELATIVE}`);
    return undefined;
  }
  try {
    const text = readFileSync(specPath, 'utf8').replace(/^\uFEFF/u, '').replaceAll('\r\n', '\n');
    const match = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(text);
    return match ? parseYaml(match[1]) : null;
  } catch (error) {
    errors.push(`cannot read the final acceptance spec: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function requiredOwnerSet(root, errors) {
  const frontmatter = readFinalSpecFrontmatter(root, errors);
  if (frontmatter === undefined) return null;
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
  // The matrix is generated from `git diff <base>..<headSha>` and is then
  // committed inside the candidate. `headSha` therefore can only ever be the
  // candidate or one of its ancestors: a matrix generated against the candidate
  // itself cannot be committed in that same candidate, because rewriting the
  // matrix changes the commit it names (a hash fixed point). Binding is
  // enforced as base equality plus head ancestry, and the coverage check below
  // still requires the matrix to account for EVERY manifest changed path — so a
  // matrix generated too early cannot pass by covering too little.
  if (matrix?.baseSha !== base) {
    errors.push('changed-path-ownership.json is not bound to the manifest base commit');
  }
  if (!isNonBlankString(matrix?.headSha) || !SHA1_HEX.test(String(matrix.headSha))) {
    errors.push('changed-path-ownership.json headSha is missing or malformed');
  } else if (isNonBlankString(manifest?.candidate?.commit) && SHA1_HEX.test(String(manifest.candidate.commit))) {
    const ancestor = git(
      root,
      ['merge-base', '--is-ancestor', String(matrix.headSha), String(manifest.candidate.commit)],
      { allowFailure: true },
    );
    if (ancestor.status !== 0) {
      errors.push('changed-path-ownership.json headSha is not an ancestor of the candidate commit');
    }
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

// ---------------------------------------------------------------------------
// Closure advance. Closing an acceptance round must commit STATUS, archives,
// the canonical evidence pair and task-forest state, so the invoking HEAD
// necessarily moves past the candidate. The validator therefore judges the
// candidate inside a detached worktree of the candidate itself, and separately
// proves that every path changed between the candidate and the invoking
// worktree is a closure path declared by the CANDIDATE's final spec. Product,
// test, script, spec, and locked-input changes after the candidate still fail
// closed. See docs/dev/unified-agent-system/runtime-convergence/RC-09-CLOSURE-ADVANCE-FIX-PLAN.md.
// ---------------------------------------------------------------------------

const CLOSURE_CODE_EXTENSIONS = /\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts|sh|ps1|py)$/iu;
const CLOSURE_FROZEN_FILES = Object.freeze([
  'scripts/validate-runtime-authority-convergence.mjs',
  'scripts/lib/agent-engineering-acceptance.mjs',
  FINAL_ACCEPTANCE_SPEC_RELATIVE,
]);
const CLOSURE_ERROR = 'closure advance: ';

function gitPathExistsAt(root, commit, pathValue) {
  return git(root, ['cat-file', '-e', `${commit}:${pathValue}`], { allowFailure: true }).status === 0;
}

/**
 * Returns the root that candidate checks run against. When the invoking
 * worktree is exactly the clean candidate this is `root` itself (unchanged
 * behavior). Otherwise it is a detached worktree of the candidate, into which
 * the manifest's locked provision inputs that the candidate does not track are
 * copied after their digests are verified. The caller must call cleanup().
 */
function openCandidateView(root, manifest, errors) {
  const direct = { candidateRoot: root, advanced: false, cleanup() {} };
  const commit = String(manifest?.candidate?.commit ?? '').toLowerCase();
  const tree = String(manifest?.candidate?.tree ?? '').toLowerCase();
  if (!SHA1_HEX.test(commit) || !SHA1_HEX.test(tree)) return direct;
  let identity;
  try {
    identity = repositoryIdentity(root);
  } catch (error) {
    errors.push(`${CLOSURE_ERROR}cannot inspect the invoking worktree: ${error instanceof Error ? error.message : String(error)}`);
    return direct;
  }
  if (identity.commit === commit && identity.tree === tree && identity.clean) return direct;
  if (git(root, ['cat-file', '-e', `${commit}^{commit}`], { allowFailure: true }).status !== 0) return direct;

  let checkout;
  try {
    checkout = createDetachedWorktree(root, { commit });
  } catch (error) {
    errors.push(`${CLOSURE_ERROR}cannot open a candidate worktree: ${error instanceof Error ? error.message : String(error)}`);
    return direct;
  }
  const view = { candidateRoot: checkout.path, advanced: true, cleanup: () => checkout.cleanup() };
  const copies = Array.isArray(manifest?.source?.provisionCopies) ? manifest.source.provisionCopies : [];
  const copied = [];
  for (const input of copies) {
    const pathValue = normalizedPath(input?.path);
    if (!pathValue || gitPathExistsAt(root, commit, pathValue)) continue;
    const sourcePath = resolve(root, ...pathValue.split('/'));
    const destPath = resolve(checkout.path, ...pathValue.split('/'));
    const matches = (filePath) => existsSync(filePath)
      && statSync(filePath).isFile()
      && statSync(filePath).size === input.bytes
      && equalDigest(sha256File(filePath), String(input.sha256 ?? ''));
    if (!matches(sourcePath)) {
      errors.push(`${CLOSURE_ERROR}provision copy digest mismatch: ${pathValue}`);
      continue;
    }
    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(sourcePath, destPath);
    if (!matches(destPath)) {
      errors.push(`${CLOSURE_ERROR}provision copy digest mismatch: ${pathValue}`);
      continue;
    }
    copied.push(pathValue);
  }
  try {
    const status = repositoryIdentity(checkout.path);
    if (!status.clean) {
      // repositoryIdentity trims stdout, so the first porcelain line may have lost
      // its leading status space; strip the XY code by pattern, not by offset.
      const dirty = status.status
        .split(/\r?\n/u)
        .map((line) => normalizedPath(line.trim().replace(/^\S{1,2}\s+/u, '')))
        .filter(Boolean);
      for (const pathValue of dirty) {
        errors.push(`${CLOSURE_ERROR}provisioned input is not ignored in the candidate: ${pathValue}`);
      }
      if (dirty.length === 0) errors.push(`${CLOSURE_ERROR}candidate worktree is dirty after provisioning (${copied.length} copies)`);
    }
  } catch (error) {
    errors.push(`${CLOSURE_ERROR}cannot inspect the candidate worktree: ${error instanceof Error ? error.message : String(error)}`);
  }
  return view;
}

function allowedPathMatcher(entry) {
  if (!isNonBlankString(entry)) return null;
  const value = entry.trim();
  if (value.endsWith('/**')) {
    const dir = value.slice(0, -3);
    if (!dir || /[*?[\]{}]/u.test(dir) || normalizedPath(dir) !== dir) return null;
    return { entry: value, covers: (pathValue) => pathValue.startsWith(`${dir}/`) };
  }
  if (/[*?[\]{}]/u.test(value) || normalizedPath(value) !== value) return null;
  return { entry: value, covers: (pathValue) => pathValue === value };
}

function gitPathList(root, args) {
  return git(root, args).stdout.split('\0').map(normalizedPath).filter(Boolean);
}

function validateClosureAdvance(root, candidateRoot, manifest, baselineRelative, errors) {
  const candidate = String(manifest.candidate.commit).toLowerCase();

  // 1. The invoking HEAD must descend from the candidate. This also catches a
  //    branch ref that was silently rewound to an older packed ref.
  if (git(root, ['merge-base', '--is-ancestor', candidate, 'HEAD'], { allowFailure: true }).status !== 0) {
    errors.push(`${CLOSURE_ERROR}candidate is not an ancestor of HEAD`);
  }

  // 2-3. The allowlist is read from the CANDIDATE's spec, never from HEAD, and
  //      only exact paths or <dir>/** prefixes are accepted.
  const frontmatter = readFinalSpecFrontmatter(candidateRoot, errors);
  const declared = frontmatter?.closureAdvance?.allowedPaths;
  const matchers = [];
  if (!Array.isArray(declared) || declared.length === 0) {
    errors.push(`${CLOSURE_ERROR}candidate spec declares no closureAdvance.allowedPaths`);
  } else {
    for (const entry of declared) {
      const matcher = allowedPathMatcher(entry);
      if (matcher) matchers.push(matcher);
      else errors.push(`${CLOSURE_ERROR}malformed allowedPaths entry: ${String(entry)}`);
    }
  }

  // 4. Frozen inputs can never be closure paths.
  const frozen = new Set([
    ...CLOSURE_FROZEN_FILES,
    ...(manifest.source?.files ?? []).map((file) => normalizedPath(file?.path)),
    ...(manifest.source?.provisionCopies ?? []).map((input) => normalizedPath(input?.path)),
    baselineRelative,
  ].filter(Boolean));
  for (const matcher of matchers) {
    for (const pathValue of frozen) {
      if (matcher.covers(pathValue)) {
        errors.push(`${CLOSURE_ERROR}allowedPaths entry covers frozen input: ${matcher.entry} -> ${pathValue}`);
      }
    }
  }

  // 5. Every path that differs between the candidate and the invoking worktree:
  //    committed and uncommitted tracked changes plus untracked, non-ignored
  //    files. Renames are split so a moved frozen input still shows its source.
  let changed;
  try {
    changed = [...new Set([
      ...gitPathList(root, ['diff', '--name-only', '--no-renames', '-z', candidate]),
      ...gitPathList(root, ['ls-files', '--others', '--exclude-standard', '-z']),
    ])].sort();
  } catch (error) {
    errors.push(`${CLOSURE_ERROR}cannot compute the post-candidate diff: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  // 6. Classify each path. An empty diff (e.g. an empty commit) passes.
  for (const pathValue of changed) {
    if (frozen.has(pathValue)) {
      errors.push(`${CLOSURE_ERROR}frozen input changed after candidate: ${pathValue}`);
    } else if (CLOSURE_CODE_EXTENSIONS.test(pathValue)) {
      errors.push(`${CLOSURE_ERROR}code file changed after candidate: ${pathValue}`);
    } else if (!matchers.some((matcher) => matcher.covers(pathValue))) {
      errors.push(`${CLOSURE_ERROR}non-closure path changed after candidate: ${pathValue}`);
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
  if (verdict.driven_by !== 'agent' && verdict.driven_by !== 'human') {
    errors.push('human verdict driven_by must be agent or human');
  }
  if (!isNonBlankString(verdict.actor)) errors.push('human verdict actor is required');
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

function validateCandidateInputs(root, manifest, baseline, errors) {
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
}

export function validateRuntimeAuthorityConvergencePreflight(options = {}) {
  const root = resolve(options.root ?? SCRIPT_ROOT);
  const manifest = options.manifest;
  if (!manifest || typeof manifest !== 'object') return { ok: false, errors: ['manifest must be an object'] };
  const errors = [];
  let baseline;
  try {
    const baselinePath = resolveInputPath(root, options.baselinePath ?? 'artifacts/runtime-authority-convergence/rc-01/baseline.json', 'baseline');
    // Execution must start from its clean planned candidate. Historical closure
    // replay remains the final validator's separate candidate-view operation.
    baseline = readJson(baselinePath, 'baseline');
    validateCandidateInputs(root, manifest, baseline, errors);
    return { ok: errors.length === 0, errors, manifest, baseline };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return { ok: false, errors, manifest, baseline };
  }
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

  // Evidence (manifest, report, verdict) is a closure product and is read from
  // the invoking root; its integrity is carried by the digest chain. Everything
  // the candidate is judged by (baseline, spec, matrix, source inputs, tree) is
  // read from the candidate view.
  let manifest;
  let report;
  let baseline;
  let manifestPath;
  let reportPath;
  let verdictPath;
  let baselineRelative;
  try {
    manifestPath = resolveInputPath(root, options.manifestPath, 'manifest');
    reportPath = resolveInputPath(root, options.engineeringReportPath, 'engineering report');
    const baselinePath = resolveInputPath(root, options.baselinePath ?? 'artifacts/runtime-authority-convergence/rc-01/baseline.json', 'baseline');
    baselineRelative = normalizedPath(relative(root, baselinePath));
    if (!existsSync(manifestPath) || !existsSync(reportPath) || !existsSync(baselinePath)) throw new Error('manifest, engineering report, or baseline file is missing');
    if (phase === 'human') {
      verdictPath = resolveInputPath(root, options.humanVerdictPath, 'human verdict');
      if (!existsSync(verdictPath)) throw new Error('human verdict file is missing');
    }
    manifest = readJson(manifestPath, 'manifest');
    report = readJson(reportPath, 'engineering report');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return { ok: false, errors };
  }

  const view = openCandidateView(root, manifest, errors);
  try {
    const candidateRoot = view.candidateRoot;
    try {
      baseline = readJson(resolve(candidateRoot, ...String(baselineRelative).split('/')), 'baseline');
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return { ok: false, errors };
    }

    validateCandidateInputs(candidateRoot, manifest, baseline, errors);
    if (view.advanced) validateClosureAdvance(root, candidateRoot, manifest, baselineRelative, errors);
    validateReportContract(manifest, report, reportPath, errors);
    if (phase === 'human' && verdictPath) validateHumanVerdict(manifest, manifestPath, reportPath, verdictPath, errors);

    return { ok: errors.length === 0, errors, phase, manifest, report, baseline, closureAdvance: view.advanced };
  } finally {
    view.cleanup();
  }
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

if (isMainEntrypoint(import.meta.url)) {
  process.exitCode = main();
}
