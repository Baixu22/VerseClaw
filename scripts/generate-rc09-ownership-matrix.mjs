#!/usr/bin/env node
// RC-09 changed-path ownership matrix generator.
//
// Builds artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/
// changed-path-ownership.json from the exact cumulative candidate diff and
// partitions it into two disjoint sets:
//
//   RC-owned   — the path was first touched in the range by a commit whose
//                subject carries a required RC package id, or no RC commit
//                touched it and a required package spec declares it in
//                ownedPaths.
//   excluded   — every other path, attributed to the exact commit that first
//                introduced it in the range (SHA, subject, derived workstream).
//
// The RC-owned set maps each path to EXACTLY ONE owning RC package from the
// required owner set derived from the final spec's
// `cumulativeOwnership.requiredSpecs`. The excluded set is evidence, not a
// wildcard: ownership globs are never widened to absorb it, every excluded
// path names its introducing commit, and a path that can be attributed to
// neither set aborts the generator with a non-zero exit code.
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = 'runtime-authority-convergence-rc09-ownership/v2';
const FINAL_SPEC_RELATIVE = 'harness/specs/tasks/runtime-authority-convergence-final-acceptance.md';

function git(args, options = {}) {
  const result = spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr ?? '').trim()}`);
  }
  return String(result.stdout ?? '').trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function readFrontmatter(absolutePath) {
  const text = readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/u, '').replaceAll('\r\n', '\n');
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(text);
  if (!match) return null;
  return parseYaml(match[1]);
}

// RC id from a commit subject or a required-spec filename. The chain commits
// carry their package id in the subject (e.g. "accept(rc05r): ...",
// "fix(rc04r): ..."); the aggregate control-package landing commit
// "land RC-00..RC-08B control package" is the RC-00 owner for paths it
// introduced.
function rcFromSubject(subject) {
  const text = subject ?? '';
  const hyphenated = /RC-0(0|1|2|3|4|5|6[a-d]|7|8[a-b])(?:R)?\b/iu.exec(text);
  if (hyphenated) {
    const raw = hyphenated[0].toUpperCase();
    return {
      'RC-00': 'RC-00', 'RC-01': 'RC-01R', 'RC-02': 'RC-02', 'RC-03': 'RC-03',
      'RC-04': 'RC-04R', 'RC-05': 'RC-05R', 'RC-06A': 'RC-06A', 'RC-06B': 'RC-06B',
      'RC-06C': 'RC-06C', 'RC-06D': 'RC-06D', 'RC-07': 'RC-07', 'RC-08A': 'RC-08A',
      'RC-08B': 'RC-08B',
    }[raw] ?? null;
  }
  const match = /rc0(0|1|2|3|4|5|6[abcd]|7|8[ab])/iu.exec(text);
  if (!match) return null;
  const raw = match[0].toUpperCase();
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
  return map[raw] ?? null;
}

/** Glob-to-regexp for spec patterns (windows-safe; matches harness/src rules.mjs semantics). */
function patternToRegExp(pattern) {
  const normalized = String(pattern).replaceAll('\\', '/').replace(/^\.\//u, '');
  const parts = normalized.split('/').filter(Boolean);
  const source = parts.map((part) => {
    let out = '';
    for (let index = 0; index < part.length; index += 1) {
      const char = part[index];
      if (char === '*') {
        out += part[index + 1] === '*' ? (index++, '[^/]*') : '[^/]*';
      } else if (char === '?') {
        out += '[^/]';
      } else if ('\\^$.|+()[]{}'.includes(char)) {
        out += `\\${char}`;
      } else {
        out += char;
      }
    }
    return out;
  });
  return new RegExp(`^${source.join('/')}$`);
}

function pathMatchesPatterns(pathValue, patterns) {
  return patterns.some((pattern) => patternToRegExp(pattern).test(pathValue));
}

/**
 * The required owner set and the spec-declaration fallback both come from the
 * final spec's `cumulativeOwnership.requiredSpecs` — never from a directory
 * scan. Scanning harness/specs/tasks/rc*.md previously pulled in RC-10 and the
 * RC-01R variant specs, which are outside the accepted RC-00..RC-08B set, and
 * it let every package's broad `touchedAreas` globs absorb paths that no RC
 * commit ever touched. Only `ownedPaths` (the explicit per-package
 * declarations) may reclassify a path here.
 */
function loadRequiredPackages() {
  const finalSpecPath = join(repoRoot, ...FINAL_SPEC_RELATIVE.split('/'));
  const finalSpec = readFrontmatter(finalSpecPath);
  const requiredSpecs = toArray(finalSpec?.cumulativeOwnership?.requiredSpecs);
  if (requiredSpecs.length === 0) {
    throw new Error(`${FINAL_SPEC_RELATIVE} declares no cumulativeOwnership.requiredSpecs`);
  }
  const specsDir = join(repoRoot, 'harness', 'specs', 'tasks');
  const packages = [];
  for (const specName of requiredSpecs) {
    const specPath = join(specsDir, basename(String(specName)));
    let frontmatter;
    try {
      frontmatter = readFrontmatter(specPath);
    } catch {
      frontmatter = null;
    }
    if (!frontmatter) throw new Error(`required spec ${specName} is missing or has no frontmatter`);
    const rc = rcFromSubject(basename(String(specName)));
    if (!rc) throw new Error(`required spec ${specName} does not resolve to an RC package id`);
    packages.push({ spec: basename(String(specName)), rc, patterns: toArray(frontmatter.ownedPaths) });
  }
  const requiredOwners = [...new Set(packages.map((entry) => entry.rc))].sort();
  return { packages, requiredOwners };
}

function classifyBySpecDeclaration(pathValue, packages) {
  for (const entry of packages) {
    if (pathMatchesPatterns(pathValue, entry.patterns)) return entry.rc;
  }
  return null;
}

function normalizePath(value) {
  const pathValue = value.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (!pathValue || pathValue.startsWith('/') || /^[A-Za-z]:\//u.test(pathValue)) return null;
  const normalized = pathValue.split('/').filter(Boolean).join('/');
  if (!normalized || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) return null;
  return normalized;
}

/**
 * Derived from a conventional-commit subject: `chore(assets): ...` becomes
 * `chore(assets)`, `feat(ui)!: ...` becomes `feat(ui)`, `fix: ...` becomes
 * `fix`. Subjects without a conventional prefix land in `uncategorized`, which
 * still carries the exact commit SHA and subject.
 */
function workstreamFromSubject(subject) {
  const match = /^([a-z]+)(?:\(([^)]*)\))?[!:]/iu.exec(String(subject ?? '').trim());
  if (!match) return 'uncategorized';
  const type = match[1].toLowerCase();
  return match[2] ? `${type}(${match[2]})` : type;
}

function resolveSha(value, label) {
  if (!value || !/^[a-f0-9]{40}$/u.test(String(value).toLowerCase())) {
    const resolved = git(['rev-parse', '--verify', `${value}^{commit}`], { allowFailure: true }).trim().toLowerCase();
    if (!/^[a-f0-9]{40}$/u.test(resolved)) {
      throw new Error(`${label} must resolve to a 40-hex commit SHA, got "${value}"`);
    }
    return resolved;
  }
  return String(value).toLowerCase();
}

function parseArgs(argv) {
  const values = { baseSha: null, headSha: null, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--base') values.baseSha = argv[++index];
    else if (token === '--head') values.headSha = argv[++index];
    else if (token === '--output') values.output = argv[++index];
    else if (token === '--help') return { help: true, ...values };
    else throw new Error(`unknown argument: ${token}`);
  }
  return values;
}

/**
 * Builds a path -> first-owning-commit index in ONE `git log` pass.
 *
 * Semantics: the owner of a path is the OLDEST commit in the range that touched
 * it. Every commit is indexed (not only RC-subject commits), because a path
 * with no RC owner still has to name the non-RC commit that introduced it.
 *
 * The range is NOT assumed merge-free: `git log --name-only` emits no file list
 * for merge commits, and a merge introduces no content beyond its parents, so
 * the non-merge commits in the range cover every changed path. Any path the
 * index misses fails closed at classification time rather than being silently
 * attributed.
 */
function buildFirstTouchIndex(baseSha, headSha) {
  const records = git([
    'log', '--reverse', '-z', '--format=@@@%H %s', '--name-only', `${baseSha}..${headSha}`,
  ]).split('\0');
  const index = new Map();
  let current = null;
  for (const record of records) {
    if (!record) continue;
    if (record.startsWith('@@@')) {
      const sha = record.slice(3, 43).toLowerCase();
      const subject = record.slice(44);
      current = { sha, subject, rc: rcFromSubject(subject) };
      continue;
    }
    if (!current) continue;
    // `git log --format=... -z` emits the format string NUL-terminated but still
    // separates the commit body from the file list with a newline, so the FIRST
    // path of every commit arrives as "\npath". Trimming is required: without it
    // the first path of each commit silently never matches and is misreported as
    // unattributable.
    const pathValue = normalizePath(record.trim());
    if (pathValue && !index.has(pathValue)) index.set(pathValue, current);
  }
  return index;
}

function countMerges(baseSha, headSha) {
  return git(['rev-list', '--merges', `${baseSha}..${headSha}`]).split('\n').filter(Boolean).length;
}

export function generateRc09OwnershipMatrix(options = {}) {
  const baseSha = resolveSha(options.baseSha, 'base');
  const headSha = resolveSha(options.headSha ?? 'HEAD', 'head');
  if (!/^[a-f0-9]{40}$/u.test(baseSha) || !/^[a-f0-9]{40}$/u.test(headSha)) {
    throw new Error('--base and --head must resolve to 40-hex commit SHAs');
  }

  const { packages, requiredOwners } = loadRequiredPackages();
  const requiredOwnerSet = new Set(requiredOwners);

  const firstTouchIndex = buildFirstTouchIndex(baseSha, headSha);
  const changedPaths = git(['diff', '--name-only', '-z', `${baseSha}..${headSha}`])
    .split('\0')
    .filter(Boolean)
    .map(normalizePath)
    .filter(Boolean)
    .sort();
  if (changedPaths.length === 0) throw new Error('candidate diff is empty');

  const entries = [];
  const byRc = {};
  const byExclusionWorkstream = {};
  const unattributable = [];
  const ownerOutsideSet = [];

  for (const pathValue of changedPaths) {
    const firstTouch = firstTouchIndex.get(pathValue) ?? null;
    // An RC commit that first touched the path owns it outright.
    if (firstTouch?.rc && requiredOwnerSet.has(firstTouch.rc)) {
      entries.push({ path: pathValue, rc: firstTouch.rc, commit: firstTouch.sha });
      byRc[firstTouch.rc] = (byRc[firstTouch.rc] ?? 0) + 1;
      continue;
    }
    // Otherwise a required package may still declare the path explicitly. Broad
    // touchedAreas globs are deliberately not consulted here.
    const declaredRc = classifyBySpecDeclaration(pathValue, packages);
    if (declaredRc) {
      entries.push({ path: pathValue, rc: declaredRc, commit: null, declaredBySpec: true });
      byRc[declaredRc] = (byRc[declaredRc] ?? 0) + 1;
      continue;
    }
    if (firstTouch?.rc && !requiredOwnerSet.has(firstTouch.rc)) {
      ownerOutsideSet.push({ path: pathValue, rc: firstTouch.rc, commit: firstTouch.sha });
      continue;
    }
    if (!firstTouch) {
      unattributable.push(pathValue);
      continue;
    }
    const workstream = workstreamFromSubject(firstTouch.subject);
    entries.push({
      path: pathValue,
      rc: null,
      excluded: { commit: firstTouch.sha, subject: firstTouch.subject, workstream },
    });
    byExclusionWorkstream[workstream] = (byExclusionWorkstream[workstream] ?? 0) + 1;
  }

  if (ownerOutsideSet.length > 0) {
    throw new Error(
      `changed paths first touched by a commit outside the required owner set ${JSON.stringify(requiredOwners)}: `
      + JSON.stringify(ownerOutsideSet.slice(0, 20)),
    );
  }
  if (unattributable.length > 0) {
    throw new Error(`changed paths with no attributable commit: ${unattributable.join(', ')}`);
  }

  entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  const rcOwnedPaths = entries.filter((entry) => entry.rc !== null).length;
  const matrix = {
    schema: SCHEMA,
    baseSha,
    headSha,
    generatedAt: new Date().toISOString(),
    requiredOwners,
    requiredSpecs: packages.map((entry) => entry.spec),
    mergeCommitsInRange: countMerges(baseSha, headSha),
    totalPaths: entries.length,
    rcOwnedPaths,
    excludedPaths: entries.length - rcOwnedPaths,
    byRc,
    byExclusionWorkstream,
    entries,
  };

  if (options.output) {
    const outputPath = resolve(repoRoot, options.output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(matrix, null, 2)}\n`, 'utf8');
  }
  return matrix;
}

export function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    if (args.help || !args.baseSha) {
      console.error('usage: node scripts/generate-rc09-ownership-matrix.mjs --base <acceptedBaseSha> [--head <candidateSha>] [--output <relative-path>]');
      return args.help ? 0 : 1;
    }
    const matrix = generateRc09OwnershipMatrix({
      baseSha: args.baseSha,
      headSha: args.headSha,
      output: args.output,
    });
    const rcSummary = Object.entries(matrix.byRc).map(([rc, n]) => `${rc}=${n}`).join(', ');
    console.log(
      `rc09 ownership matrix: ${matrix.totalPaths} paths -> rc-owned ${matrix.rcOwnedPaths} (${rcSummary}), `
      + `excluded ${matrix.excludedPaths} across ${Object.keys(matrix.byExclusionWorkstream).length} workstreams`,
    );
    return 0;
  } catch (error) {
    console.error(`rc09 ownership matrix generator FAILED: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

// Compare realpaths: node realpath-resolves import.meta.url, so when the repo
// is reached through a directory junction (Desktop\clawx\ClawX -> D:\ClawX)
// the C: argv path and the D: module URL disagree and a plain resolve()
// comparison never matches, silently turning the CLI into a no-op.
function sameRealPath(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return resolve(a) === resolve(b);
  }
}

if (process.argv[1] && sameRealPath(process.argv[1], fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
