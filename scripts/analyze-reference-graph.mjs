#!/usr/bin/env node
// Exact-path reference graph analysis for tracked repository files.
//
// Issue #75 corrected the first repository audit: that audit decided "zero
// reference" candidates with filename/directory substring matching, so a file
// only counted as referenced when its *basename* happened to appear somewhere.
// Any file that has a same-named sibling elsewhere (STATUS.md, README.md,
// index.json, ...) was wrongly reported as referenced, and any file whose full
// path appears in the tree was wrongly reported as zero-reference whenever the
// basename itself did not occur verbatim.
//
// This script answers the only question cleanup decisions may rely on: does the
// candidate file's *full relative path* occur inside some tracked file?
//
// Method:
//   1. `git ls-files` defines the tracked universe (the same universe every
//      cleanup decision has to be safe against).
//   2. Candidate files are tracked paths inside the requested directories.
//   3. A candidate counts as referenced by a file when the candidate's full
//      relative path (forward slashes, as git spells it) occurs in that file's
//      text. Basenames, directory names and glob guesses never count.
//   4. References are reported per source category: code, docs/contracts, and
//      any tracked file. The first audit's own extension set (code plus
//      json/yml/yaml, without markdown) is reported as `issueMethod` so the
//      corrected numbers can be compared with that table 1:1.
//
// Output: a human summary table on stdout plus an optional JSON report (--out).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Source extensions that ship as executable/loadable code. */
export const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.mts', '.js', '.cjs', '.jsx']);
/** Source extensions that carry documentation or contracts. */
export const CONTRACT_EXTENSIONS = new Set(['.md', '.json', '.yml', '.yaml']);
/** Extension set used by the first audit (issue #75): code plus json/yml/yaml, but not markdown. */
export const ISSUE_METHOD_EXTENSIONS = new Set([...CODE_EXTENSIONS, '.json', '.yml', '.yaml']);

export const DEFAULT_EXCLUDED_PREFIXES = ['openclaw_runtime/'];
export const LOCKFILE_BASENAMES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lockb',
]);
export const DEFAULT_AREAS = ['docs'];
export const DEFAULT_MAX_REFERENCES = 500;
const BINARY_SNIFF_BYTES = 8192;

export function normalizePath(filePath) {
  return filePath.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function stripTrailingSlash(area) {
  return normalizePath(area).replace(/\/+$/, '');
}

export function isLockfile(filePath) {
  const base = normalizePath(filePath).split('/').pop() ?? '';
  return LOCKFILE_BASENAMES.has(base)
    || base.endsWith('.lock')
    || base.endsWith('.lock.json')
    || base.endsWith('-lock.json');
}

/** Why a tracked file is left out of the scanned corpus, or null when it is scanned. */
export function exclusionReason(filePath, { includeRuntime = false, includeLockfiles = false } = {}) {
  const normalized = normalizePath(filePath);
  if (!includeRuntime && DEFAULT_EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return 'runtime';
  }
  if (!includeLockfiles && isLockfile(normalized)) return 'lockfile';
  return null;
}

export function categorizeSource(filePath) {
  const extension = path.posix.extname(normalizePath(filePath)).toLowerCase();
  if (CODE_EXTENSIONS.has(extension)) return 'code';
  if (CONTRACT_EXTENSIONS.has(extension)) return 'contract';
  return 'other';
}

export function isIssueMethodSource(filePath) {
  return ISSUE_METHOD_EXTENSIONS.has(path.posix.extname(normalizePath(filePath)).toLowerCase());
}

export function listTrackedFiles(root = ROOT) {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return output.split('\0').filter(Boolean).map(normalizePath).sort();
}

/** Candidate files are the tracked paths equal to an area or inside it. */
export function selectCandidates(tracked, areas) {
  const byArea = new Map();
  for (const area of areas) {
    byArea.set(area, []);
  }
  for (const filePath of tracked) {
    for (const area of areas) {
      if (filePath === area || filePath.startsWith(`${area}/`)) {
        byArea.get(area).push(filePath);
        break;
      }
    }
  }
  return byArea;
}

export function isProbablyBinary(bytes) {
  const limit = Math.min(bytes.length, BINARY_SNIFF_BYTES);
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] === 0) return true;
  }
  return false;
}

export function computeLineStarts(content) {
  const starts = [0];
  for (let index = content.indexOf('\n'); index !== -1; index = content.indexOf('\n', index + 1)) {
    starts.push(index + 1);
  }
  return starts;
}

export function lineAt(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (lineStarts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

export function collectOccurrences(content, needle, lineStarts, cap) {
  const found = [];
  for (let index = content.indexOf(needle); index !== -1 && found.length < cap; index = content.indexOf(needle, index + 1)) {
    found.push({ line: lineAt(lineStarts, index), offset: index });
  }
  return found;
}

/**
 * Group candidates by their parent directory. `dir + '/'` is always a prefix of
 * every candidate in the group, so a source that does not contain the group
 * prefix cannot contain any candidate in it. This keeps the exact matching
 * cheap without weakening it.
 */
export function groupCandidatesByDirectory(candidates) {
  const groups = new Map();
  for (const candidate of [...candidates].sort()) {
    const slash = candidate.lastIndexOf('/');
    const prefix = slash === -1 ? '' : `${candidate.slice(0, slash)}/`;
    const group = groups.get(prefix) ?? [];
    group.push(candidate);
    groups.set(prefix, group);
  }
  return groups;
}

function emptyReferences() {
  return {
    codeReferences: [],
    contractReferences: [],
    issueMethodReferences: [],
    anyReferences: [],
    selfReferenced: false,
    truncated: false,
  };
}

/**
 * Pure exact-path reference analysis.
 *
 * @param {{candidates: string[], corpus: {path: string, content: string}[], excludeSelf?: boolean, maxReferences?: number}} input
 * @returns {Map<string, object>} candidate path -> reference record
 */
export function analyzeReferences({ candidates, corpus, excludeSelf = false, maxReferences = DEFAULT_MAX_REFERENCES }) {
  const results = new Map();
  for (const candidate of [...candidates].sort()) results.set(candidate, emptyReferences());
  const perCandidateCap = Math.max(1, Math.ceil(maxReferences / 4));

  for (const [prefix, group] of groupCandidatesByDirectory(candidates)) {
    const matching = prefix === ''
      ? corpus
      : corpus.filter((source) => source.content.includes(prefix));
    for (const source of matching) {
      const category = categorizeSource(source.path);
      const issueMethod = isIssueMethodSource(source.path);
      let lineStarts = null;
      for (const candidate of group) {
        if (excludeSelf && source.path === candidate) continue;
        if (!source.content.includes(candidate)) continue;
        const record = results.get(candidate);
        if (source.path === candidate) record.selfReferenced = true;
        if (lineStarts === null) lineStarts = computeLineStarts(source.content);
        const remaining = perCandidateCap - record.anyReferences.length;
        if (remaining <= 0) {
          record.truncated = true;
          continue;
        }
        const occurrences = collectOccurrences(source.content, candidate, lineStarts, remaining);
        if (occurrences.length === remaining) record.truncated = true;
        const entries = occurrences.map((occurrence) => ({ file: source.path, line: occurrence.line }));
        record.anyReferences.push(...entries);
        if (category === 'code') record.codeReferences.push(...entries);
        if (category === 'contract') record.contractReferences.push(...entries);
        if (issueMethod) record.issueMethodReferences.push(...entries);
      }
    }
  }
  return results;
}

function distinctFiles(references) {
  return new Set(references.map((reference) => reference.file)).size;
}

/** Aggregate per-candidate records into the per-area numbers the cleanup decision needs. */
export function summarizeArea(area, candidates, results) {
  const files = candidates.map((candidate) => {
    const record = results.get(candidate) ?? emptyReferences();
    return {
      path: candidate,
      selfReferenced: record.selfReferenced,
      truncated: record.truncated,
      counts: {
        code: distinctFiles(record.codeReferences),
        contract: distinctFiles(record.contractReferences),
        issueMethod: distinctFiles(record.issueMethodReferences),
        any: distinctFiles(record.anyReferences),
      },
      codeReferences: record.codeReferences,
      contractReferences: record.contractReferences,
      issueMethodReferences: record.issueMethodReferences,
      anyReferences: record.anyReferences,
    };
  });
  const zero = (key) => files.filter((file) => file.counts[key] === 0).length;
  const referenced = (key) => files.length - zero(key);
  const percentage = (value) => (files.length === 0 ? 0 : Number(((value / files.length) * 100).toFixed(1)));
  return {
    area,
    fileCount: files.length,
    referencedCode: referenced('code'),
    zeroCode: zero('code'),
    zeroCodePct: percentage(zero('code')),
    referencedContract: referenced('contract'),
    zeroContract: zero('contract'),
    zeroIssueMethod: zero('issueMethod'),
    zeroIssueMethodPct: percentage(zero('issueMethod')),
    referencedAny: referenced('any'),
    zeroAny: zero('any'),
    zeroAnyPct: percentage(zero('any')),
    selfReferenced: files.filter((file) => file.selfReferenced).length,
    zeroCodeFiles: files.filter((file) => file.counts.code === 0).map((file) => file.path),
    files,
  };
}

export function renderTable(areas, { zeroOnly = false } = {}) {
  const header = [
    'directory'.padEnd(30),
    'files'.padStart(6),
    'code-ref'.padStart(9),
    'zero-code'.padStart(10),
    'zero-code%'.padStart(11),
    'zero-issue'.padStart(11),
    'zero-any'.padStart(9),
    'zero-any%'.padStart(10),
  ].join('  ');
  const lines = [header, '-'.repeat(header.length)];
  for (const area of areas) {
    lines.push([
      area.area.padEnd(30),
      String(area.fileCount).padStart(6),
      String(area.referencedCode).padStart(9),
      String(area.zeroCode).padStart(10),
      `${area.zeroCodePct}%`.padStart(11),
      String(area.zeroIssueMethod).padStart(11),
      String(area.zeroAny).padStart(9),
      `${area.zeroAnyPct}%`.padStart(10),
    ].join('  '));
    if (zeroOnly) {
      for (const file of area.zeroCodeFiles) lines.push(`  zero-code  ${file}`);
    }
  }
  return lines.join('\n');
}

async function readCorpus({ root, tracked, includeRuntime, includeLockfiles, ignoreSources = [] }) {
  const corpus = [];
  const skipped = { runtime: 0, lockfile: 0, binary: 0, missing: 0, ignoredSource: 0 };
  let scannedBytes = 0;
  for (const filePath of tracked) {
    const reason = exclusionReason(filePath, { includeRuntime, includeLockfiles });
    if (reason) {
      skipped[reason] += 1;
      continue;
    }
    if (ignoreSources.some((pattern) => filePath.includes(pattern))) {
      skipped.ignoredSource += 1;
      continue;
    }
    let bytes;
    try {
      bytes = await readFile(path.join(root, filePath));
    } catch {
      skipped.missing += 1;
      continue;
    }
    scannedBytes += bytes.length;
    if (isProbablyBinary(bytes)) {
      skipped.binary += 1;
      continue;
    }
    corpus.push({ path: filePath, content: bytes.toString('utf8'), size: bytes.length });
  }
  return { corpus, skipped, scannedBytes };
}

async function hashCandidates(root, candidates) {
  const hashes = new Map();
  for (const candidate of candidates) {
    try {
      const bytes = await readFile(path.join(root, candidate));
      hashes.set(candidate, { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    } catch {
      hashes.set(candidate, { size: null, sha256: null });
    }
  }
  return hashes;
}

export function findMentions(corpus, tokens) {
  const mentions = new Map();
  for (const token of tokens) mentions.set(token, []);
  for (const source of corpus) {
    for (const token of tokens) {
      if (!source.content.includes(token)) continue;
      const lineStarts = computeLineStarts(source.content);
      const occurrences = collectOccurrences(source.content, token, lineStarts, DEFAULT_MAX_REFERENCES);
      for (const occurrence of occurrences) {
        mentions.get(token).push({ file: source.path, line: occurrence.line, category: categorizeSource(source.path) });
      }
    }
  }
  return mentions;
}

export const HELP = `Exact-path reference graph analysis (issue #75)

Usage: node scripts/analyze-reference-graph.mjs [options]

Options:
  --dir <path>           Tracked directory (or file) whose candidates are analyzed.
                         Repeatable and comma-separated. Default: ${DEFAULT_AREAS.join(', ')}
  --out <file>           Write the JSON report to this path (created if needed).
  --json                 Print the JSON report to stdout instead of the table.
  --include-runtime      Also scan openclaw_runtime/ (excluded by default).
  --include-lockfiles    Also scan lockfiles (excluded by default).
  --exclude-self         Do not count a candidate's own file as a reference source.
  --hash                 Record size and sha256 for every candidate (provenance).
  --mentions <text>      Also report tracked files containing this text (repeatable).
                         Use it to detect directory-name-only references, which are
                         deliberately NOT counted as references to a file.
  --ignore-source <text> Drop source files whose path contains this text from the
                         scanned corpus. Repeatable. Needed because administrative
                         registries (.gitignore, scripts/repository-artifacts.json)
                         list every retained path and therefore make every file look
                         referenced.
  --zero-only            Append the zero-code-reference candidate list to the table.
  --max-references <n>   Cap stored references per candidate. Default: ${DEFAULT_MAX_REFERENCES}.
  --help                 Show this help.

Exit code is 0 whenever the analysis ran; the report, not the exit code, carries
the verdict. Matching is exact full-relative-path containment: a same-named file
in another directory never counts as a reference.
`;

async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      dir: { type: 'string', multiple: true },
      out: { type: 'string' },
      json: { type: 'boolean' },
      'include-runtime': { type: 'boolean' },
      'include-lockfiles': { type: 'boolean' },
      'exclude-self': { type: 'boolean' },
      hash: { type: 'boolean' },
      mentions: { type: 'string', multiple: true },
      'ignore-source': { type: 'string', multiple: true },
      'zero-only': { type: 'boolean' },
      'max-references': { type: 'string' },
      help: { type: 'boolean' },
    },
    allowPositionals: false,
  });
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const areas = (values.dir?.length ? values.dir : DEFAULT_AREAS)
    .flatMap((entry) => entry.split(','))
    .map((entry) => stripTrailingSlash(entry.trim()))
    .filter(Boolean);
  const maxReferences = values['max-references'] ? Number.parseInt(values['max-references'], 10) : DEFAULT_MAX_REFERENCES;
  if (!Number.isInteger(maxReferences) || maxReferences < 1) throw new Error('--max-references must be a positive integer');
  const includeRuntime = values['include-runtime'] === true;
  const includeLockfiles = values['include-lockfiles'] === true;
  const excludeSelf = values['exclude-self'] === true;

  const tracked = listTrackedFiles();
  const byArea = selectCandidates(tracked, areas);
  const candidates = [...new Set([...byArea.values()].flat())].sort();
  const ignoreSources = (values['ignore-source'] ?? []).flatMap((entry) => entry.split(',')).map((entry) => entry.trim()).filter(Boolean);
  const { corpus, skipped, scannedBytes } = await readCorpus({ root: ROOT, tracked, includeRuntime, includeLockfiles, ignoreSources });
  const results = analyzeReferences({ candidates, corpus, excludeSelf, maxReferences });
  const hashes = values.hash ? await hashCandidates(ROOT, candidates) : new Map();

  const areaSummaries = areas.map((area) => {
    const summary = summarizeArea(area, byArea.get(area) ?? [], results);
    return {
      ...summary,
      files: summary.files.map((file) => {
        const provenance = hashes.get(file.path);
        return provenance ? { ...file, size: provenance.size, sha256: provenance.sha256 } : file;
      }),
    };
  });

  const mentions = values.mentions?.length ? findMentions(corpus, values.mentions) : new Map();
  const report = {
    schemaVersion: 1,
    analysis: 'exact-full-relative-path containment against git ls-files',
    generatedAt: new Date().toISOString(),
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim(),
    options: {
      areas,
      includeRuntime,
      includeLockfiles,
      excludeSelf,
      hashed: values.hash === true,
      maxReferences,
      ignoreSources,
    },
    corpus: {
      trackedFiles: tracked.length,
      scannedFiles: corpus.length,
      scannedBytes,
      skipped,
    },
    areas: areaSummaries,
    mentions: [...mentions.entries()].map(([token, entries]) => ({
      token,
      fileCount: new Set(entries.map((entry) => entry.file)).size,
      entries,
    })),
  };

  if (values.out) {
    const outPath = path.resolve(values.out);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (values.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  const table = renderTable(areaSummaries, { zeroOnly: values['zero-only'] === true });
  const lines = [
    `exact-path reference analysis @ ${report.gitHead.slice(0, 9)} (${report.generatedAt})`,
    `tracked files: ${tracked.length}  scanned: ${corpus.length}  skipped: runtime=${skipped.runtime} lockfiles=${skipped.lockfile} binary=${skipped.binary} missing=${skipped.missing} ignoredSource=${skipped.ignoredSource}`,
    `candidates: ${candidates.length}`,
    '',
    table,
  ];
  for (const mention of report.mentions) {
    lines.push('', `--mentions "${mention.token}": ${mention.fileCount} tracked file(s)`);
  }
  if (values.out) lines.push('', `json report: ${path.resolve(values.out)}`);
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

if (isMainEntrypoint(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.message.includes('Unknown option')) console.error(`\n${HELP}`);
    process.exitCode = 1;
  }
}

export { ROOT };
