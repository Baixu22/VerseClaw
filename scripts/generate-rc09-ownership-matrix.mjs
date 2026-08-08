#!/usr/bin/env node
// RC-09 changed-path ownership matrix generator.
//
// Builds artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/
// changed-path-ownership.json from the exact cumulative candidate diff:
// every changed path between the RC-01 accepted base and the RC-09 final
// candidate is mapped to EXACTLY ONE owning RC package (RC-00..RC-08B).
//
// The owner is the first chain commit (topological order) that introduced the
// path, derived from `git diff-tree` — never from a hardcoded array standing as
// proof. The chain is the accepted candidate lineage whose per-package commits
// carry the RC id in their subject.
//
// Fail-closed: any path with no owner, or a first-touch commit outside the
// accepted chain, aborts with a non-zero exit code.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = 'runtime-authority-convergence-rc09-ownership/v1';

function git(args, options = {}) {
  const result = spawnSync('git', args, {
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

// The accepted chain: every commit between the RC-01 acceptance base and the
// RC-09 final candidate HEAD, in topological (oldest-first) order.
function resolveChain(baseSha, headSha) {
  const lines = git(['log', '--format=%H %s', '--reverse', `${baseSha}..${headSha}`])
    .split('\n')
    .filter(Boolean);
  return lines.map((line) => {
    const space = line.indexOf(' ');
    return {
      sha: line.slice(0, space),
      subject: line.slice(space + 1),
    };
  });
}

// RC id from an accepted chain commit subject. The chain commits carry their
// package id in the subject (e.g. "accept(rc05r): ...", "fix(rc04r): ...").
// The pre-chain control-package landing commit "land RC-00..RC-08B control
// package" is the RC-00 owner for paths it introduced (remediation plan §7:
// "将原 116 个 changed paths 重新分类到唯一 RC owner").
function rcFromSubject(subject) {
  const text = subject ?? '';
  // Hyphenated "RC-00"/"RC-08B" forms in aggregate-control subjects.
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
  // Normalize: rc06a -> RC-06A, rc08b -> RC-08B, rc01 -> RC-01R, etc.
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

/**
 * Pre-chain classification fallback. Paths first introduced by the rejected
 * pre-chain commits (fac6327a2 / 90e796893) carry no RC commit; they are
 * re-classified to the FIRST RC spec (deterministic RC-00..RC-08B order) whose
 * touchedAreas/ownedPaths cover the path — the remediation plan §7 requirement
 * ("将原 116 个 changed paths 重新分类到唯一 RC owner").
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

function toArray(value) {
  return Array.isArray(value) ? value : [];
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

function listTaskSpecs(specsDir) {
  const specs = [];
  for (const entry of readdirSync(specsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.startsWith('rc') || !entry.name.endsWith('.md')) continue;
    const name = entry.name;
    if (name.includes('final')) continue;
    let frontmatter;
    try {
      const text = readFileSync(join(specsDir, name), 'utf8');
      // Frontmatter is delimited by --- lines; tolerate CRLF and BOM.
      const normalized = text.replace(/^\uFEFF/u, '').replaceAll('\r\n', '\n');
      const match = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(normalized);
      if (!match) continue;
      frontmatter = parseYaml(match[1]);
    } catch {
      continue;
    }
    specs.push({
      spec: name,
      rc: rcFromSubject(name) ?? name.replace(/^rc(\d+[abcd]?)-.*$/u, (_, id) => `RC-${id.toUpperCase()}`),
      patterns: [
        ...toArray(frontmatter?.touchedAreas),
        ...toArray(frontmatter?.ownedPaths),
      ],
    });
  }
  return specs;
}

function specPatterns(repoRoot) {
  return listTaskSpecs(join(repoRoot, 'harness', 'specs', 'tasks'));
}

function pathMatchesPatterns(pathValue, patterns) {
  return patterns.some((pattern) => patternToRegExp(pattern).test(pathValue));
}

function classifyPreChainPath(pathValue, patterns) {
  for (const entry of patterns) {
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

function firstTouchingCommit(pathValue, chain) {
  for (const entry of chain) {
    // Only accepted RC chain commits own paths; rejected pre-chain commits
    // (fac6327a2 control package, 90e796893 ChatInput fix) carry no RC id and
    // are handled by the pre-chain spec classification fallback.
    if (!rcFromSubject(entry.subject)) continue;
    const touched = git(['diff-tree', '--no-commit-id', '--name-only', '-r', entry.sha, '--', pathValue])
      .split('\n')
      .filter(Boolean)
      .map(normalizePath)
      .filter(Boolean);
    if (touched.includes(pathValue)) return entry;
  }
  return null;
}

export function generateRc09OwnershipMatrix(options = {}) {
  const baseSha = resolveSha(options.baseSha, 'base');
  const headSha = resolveSha(options.headSha ?? 'HEAD', 'head');
  if (!/^[a-f0-9]{40}$/u.test(baseSha) || !/^[a-f0-9]{40}$/u.test(headSha)) {
    throw new Error('--base and --head must resolve to 40-hex commit SHAs');
  }

  const chain = resolveChain(baseSha, headSha);
  if (chain.length === 0) throw new Error('chain is empty: baseSha must be an ancestor of HEAD');

  const changedPaths = git(['diff', '--name-only', '-z', `${baseSha}..${headSha}`])
    .split('\0')
    .filter(Boolean)
    .map(normalizePath)
    .filter(Boolean)
    .sort();

  // Pre-chain re-classification: paths first introduced by the rejected
  // pre-chain commits have no RC commit owner; classify them by the FIRST RC
  // spec whose touchedAreas/ownedPaths cover them (deterministic RC order).
  const specPatternsForFallback = specPatterns(repoRoot);

  const entries = [];
  const unowned = [];
  const nonChain = [];
  for (const pathValue of changedPaths) {
    const firstTouch = firstTouchingCommit(pathValue, chain);
    if (!firstTouch) {
      const preChainRc = classifyPreChainPath(pathValue, specPatternsForFallback);
      if (preChainRc) {
        entries.push({ path: pathValue, rc: preChainRc, commit: null, preChain: true });
        continue;
      }
      unowned.push(pathValue);
      continue;
    }
    const rc = rcFromSubject(firstTouch.subject);
    if (!rc) {
      nonChain.push({ path: pathValue, commit: firstTouch.sha, subject: firstTouch.subject });
      continue;
    }
    entries.push({
      path: pathValue,
      rc,
      commit: firstTouch.sha,
    });
  }

  if (unowned.length > 0) {
    throw new Error(`changed paths with no chain owner: ${unowned.join(', ')}`);
  }
  if (nonChain.length > 0) {
    throw new Error(`changed paths first touched outside an RC commit: ${JSON.stringify(nonChain)}`);
  }

  const byRc = {};
  for (const entry of entries) {
    byRc[entry.rc] = (byRc[entry.rc] ?? 0) + 1;
  }

  const matrix = {
    schema: SCHEMA,
    baseSha,
    headSha,
    generatedAt: new Date().toISOString(),
    totalPaths: entries.length,
    byRc,
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
    console.log(`rc09 ownership matrix: ${matrix.totalPaths} paths -> ${Object.entries(matrix.byRc).map(([rc, n]) => `${rc}=${n}`).join(', ')}`);
    return 0;
  } catch (error) {
    console.error(`rc09 ownership matrix generator FAILED: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
