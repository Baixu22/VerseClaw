#!/usr/bin/env node
/**
 * Dependency-free, repository-relative pattern scanner.
 *
 * Task specs used to declare evidence scans as `C:\Users\<name>\...\rtk.exe rg
 * -n '<pattern>' <paths>`: a machine-local executable wrapper that no clean
 * checkout or CI runner has. This script provides the same inspection as a
 * tracked command so `requiredTests` lines stay executable anywhere Node runs.
 *
 * Usage:
 *   node scripts/scan-pattern.mjs --pattern '<regex>' [--include .ts,.tsx] [--fail-on-match] <path...>
 *
 * Exit code is 0 after printing matches unless `--fail-on-match` is given, in
 * which case any match exits 1 (use it for anti-pattern guards).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const SCHEMA = 'verse-claw/scan-pattern@1';

const DEFAULT_SKIP_DIRECTORIES = new Set([
  '.git',
  '.local',
  '.worktrees',
  'build',
  'dist',
  'dist-electron',
  'node_modules',
  'release',
]);

const MAX_MATCH_TEXT = 400;

export function parseArgs(argv) {
  const args = { pattern: null, include: null, globs: [], failOnMatch: false, max: null, targets: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--pattern') {
      args.pattern = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--include') {
      args.include = (argv[index + 1] ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
      index += 1;
    } else if (arg === '--glob') {
      const glob = argv[index + 1];
      if (glob) args.globs.push(glob);
      index += 1;
    } else if (arg === '--max') {
      args.max = Number(argv[index + 1] ?? '0') || null;
      index += 1;
    } else if (arg === '--fail-on-match') {
      args.failOnMatch = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (!arg.startsWith('--')) {
      args.targets.push(arg);
    }
  }
  return args;
}

/**
 * Minimal glob matcher for `--glob` filters, including gitignore-style `!`
 * negation handled by the caller. `**\/` may match zero directories, so
 * `**\/*.md` also excludes a root-level `README.md`.
 */
export function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '(?:.*/)?')
    .replace(/\u0001/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export function compilePattern(pattern) {
  if (!pattern) throw new Error('--pattern <regex> is required');
  return new RegExp(pattern);
}

export function isBinary(buffer) {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}

export function collectFiles(targets, { cwd = process.cwd(), skipDirectories = DEFAULT_SKIP_DIRECTORIES } = {}) {
  const files = [];
  const visit = (absolute) => {
    let stats;
    try {
      stats = statSync(absolute);
    } catch {
      return;
    }
    if (stats.isDirectory()) {
      const name = path.basename(absolute);
      if (skipDirectories.has(name)) return;
      for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        visit(path.join(absolute, entry.name));
      }
      return;
    }
    if (stats.isFile()) files.push(path.resolve(absolute));
  };

  for (const target of targets) visit(path.resolve(cwd, target));
  return files;
}

export function scanText(text, regex) {
  const matches = [];
  const probe = new RegExp(regex.source, regex.flags.replace(/[gy]/g, ''));
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (probe.test(line)) {
      matches.push({ line: index + 1, text: line.trim().slice(0, MAX_MATCH_TEXT) });
    }
  });
  return matches;
}

export function scanPattern({
  pattern,
  targets,
  include = null,
  globs = [],
  cwd = process.cwd(),
  skipDirectories = DEFAULT_SKIP_DIRECTORIES,
} = {}) {
  const regex = pattern instanceof RegExp ? pattern : compilePattern(pattern);
  if (!targets || targets.length === 0) throw new Error('at least one path target is required');
  const positiveGlobs = globs.filter((glob) => !glob.startsWith('!')).map(globToRegExp);
  const negativeGlobs = globs.filter((glob) => glob.startsWith('!')).map((glob) => globToRegExp(glob.slice(1)));

  const files = collectFiles(targets, { cwd, skipDirectories }).filter((absolute) => {
    const file = path.relative(cwd, absolute).split(path.sep).join('/');
    if (include && include.length > 0 && !include.some((suffix) => file.endsWith(suffix))) return false;
    if (positiveGlobs.length > 0 && !positiveGlobs.some((probe) => probe.test(file))) return false;
    if (negativeGlobs.some((probe) => probe.test(file))) return false;
    return true;
  });

  const matches = [];
  let filesScanned = 0;
  for (const absolute of files) {
    const buffer = readFileSync(absolute);
    if (isBinary(buffer)) continue;
    filesScanned += 1;
    const file = path.relative(cwd, absolute).split(path.sep).join('/');
    for (const match of scanText(buffer.toString('utf8'), regex)) {
      matches.push({ file, ...match });
    }
  }
  return { schema: SCHEMA, pattern: regex.source, filesScanned, matches };
}

function printUsage() {
  console.log([
    'Usage: node scripts/scan-pattern.mjs --pattern <regex> <path...>',
    '',
    'Options:',
    '  --pattern <regex>   JavaScript regular expression to search for (required)',
    '  --include <suffixes> Comma-separated file suffixes to keep, e.g. .ts,.tsx',
    '  --glob <pattern>    Keep files matching the glob; prefix with ! to exclude (repeatable)',
    '  --fail-on-match     Exit 1 when at least one match is found',
    '  --max <count>       Stop after this many matches',
  ].join('\n'));
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return 0;
  }
  const result = scanPattern({
    pattern: args.pattern,
    targets: args.targets,
    include: args.include,
    globs: args.globs,
  });
  const matches = args.max ? result.matches.slice(0, args.max) : result.matches;
  for (const match of matches) console.log(`${match.file}:${match.line}: ${match.text}`);
  console.log(
    `[scan-pattern] ${result.matches.length} match(es) in ${result.filesScanned} scanned file(s) `
    + `for /${result.pattern}/`,
  );
  if (args.failOnMatch && result.matches.length > 0) return 1;
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
