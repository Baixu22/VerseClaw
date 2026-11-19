#!/usr/bin/env node
/**
 * Guard: every parent-code reference into the vendored `openclaw_runtime` tree must
 * resolve, or be explicitly exempted with a reason. (Issue #93.)
 *
 * Why this exists
 * ---------------
 * `openclaw_runtime/` is a vendored upstream copy. Parent code reaches into its
 * internals by deep path in two shapes:
 *   - code: a relative `import ... from` / `await import(...)` / `require(...)`
 *     whose specifier points inside the vendored tree;
 *   - strings: evidence assertions, workspace labels, script arguments, fixture text.
 * A re-vendor that renames or moves upstream files breaks both silently: nothing
 * fails, the capability claim or the tooling just stops pointing at a real file.
 *
 * What is checked
 * ---------------
 * For each reference found in the scanned roots, the target must exist on disk as a
 * file (with extension probing) or as a directory. Anything unresolved must appear in
 * `scripts/runtime-deep-refs-baseline.json` with a non-empty `reason`, which is the
 * "existence-checked or explicitly exempted" contract from issue #93. A dangling
 * reference that is neither resolvable nor exempted fails closed.
 *
 * Honest limits
 * -------------
 * - The scan is textual: it reads tracked source and configuration, not a module
 *   graph. A reference built by string concatenation (`join(root, 'openclaw_runtime',
 *   'src', ...)`) is invisible here, and a match inside a comment counts.
 * - Existence is not semantics: a file that still exists but changed its exports
 *   still passes. Only moving the parent code behind a supported entry point, or
 *   importing symbols (so the compiler fails), catches that.
 * - The exemption list is a ledger of accepted debt, not a claim that the reference
 *   is good. It must shrink over time, never grow silently.
 *
 * Usage:
 *   node scripts/check-runtime-deep-refs.mjs [--root <dir>] [--json]
 */
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Directories scanned for parent-code references into the vendored tree.
 *
 * Scope note: this is the *product code + tooling* surface the issue names. `tests/`
 * is deliberately out of scope — its imports are checked by the TypeScript compiler
 * and fail loudly on a rename — and `harness/` holds specification prose whose
 * `openclaw_runtime/**` mentions are patterns and examples, not file references.
 */
export const SCAN_DIRS = ['electron', 'src', 'shared', 'scripts'];
/** Vendored tree prefix that defines "deep reference". */
export const VENDOR_PREFIX = 'openclaw_runtime/';
/** Source extensions probed when an import omits one. */
export const PROBE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.mjs', '.cjs', '.js', '.json', '.py'];
/** ESM-style `.js` specifiers that address a TypeScript source file. */
export const TS_SOURCE_ALIASES = { '.js': ['.ts', '.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };
const SCANNED_FILE_RE = /\.(ts|tsx|mts|mjs|cjs|js|json|md)$/;
const IGNORED_PATH_PARTS = ['/node_modules/', '/.git/', '/dist/', '/dist-electron/', '/build/'];
/**
 * This guard's own exemption ledger quotes the paths it exempts, so scanning it
 * would report every exemption as a dangling reference.
 */
const EXCLUDED_FILES = new Set(['scripts/runtime-deep-refs-baseline.json']);

const IMPORT_RE = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
const BARE_PATH_RE = /['"`]([^'"`\s]*openclaw_runtime\/[^'"`\s]+)['"`]/g;

/** Read the exemption ledger; missing file means "nothing exempted yet". */
export function loadBaseline(root = ROOT) {
  const path = join(root, 'scripts/runtime-deep-refs-baseline.json');
  if (!existsSync(path)) return { entries: [] };
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  return { entries: parsed.entries ?? [] };
}

/** Does `target` exist as a file (extension-probed) or as a directory? */
export function resolvesToExistingPath(root, target) {
  const cleaned = target.replace(/[.,;:)]+$/, '');
  const absolute = join(root, normalize(cleaned));
  if (existsSync(absolute)) return true;
  for (const extension of PROBE_EXTENSIONS) {
    if (existsSync(`${absolute}${extension}`)) return true;
    if (existsSync(join(absolute, `index${extension}`))) return true;
  }
  // ESM specifiers name the emitted `.js` while the file on disk is TypeScript.
  for (const [suffix, aliases] of Object.entries(TS_SOURCE_ALIASES)) {
    if (!cleaned.endsWith(suffix)) continue;
    const stem = cleaned.slice(0, -suffix.length);
    for (const alias of aliases) {
      if (existsSync(join(root, normalize(`${stem}${alias}`)))) return true;
    }
  }
  return false;
}

/** Files under the scanned roots, tracked or not, excluding generated output. */
export function listScannedFiles(root = ROOT) {
  const out = [];
  const dirs = SCAN_DIRS.filter((dir) => existsSync(join(root, dir)));
  if (dirs.length === 0) return out;
  const list = execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '--', ...dirs], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  for (const relative of list.split('\n').map((line) => line.trim()).filter(Boolean)) {
    if (!SCANNED_FILE_RE.test(relative)) continue;
    if (EXCLUDED_FILES.has(relative)) continue;
    if (IGNORED_PATH_PARTS.some((part) => `/${relative}`.includes(part))) continue;
    out.push(relative);
  }
  return [...new Set(out)].sort();
}

/** Normalize an import specifier to a repo-relative path, or null when it is external. */
export function normalizeSpecifier(specifier, fromFile) {
  if (specifier.startsWith('.')) {
    const absolute = normalize(join(dirname(fromFile), specifier));
    return absolute.split(sep).join('/');
  }
  if (specifier.startsWith(VENDOR_PREFIX)) return specifier;
  return null;
}

/** Collect every parent -> vendored reference with its kind and location. */
export function collectReferences(root = ROOT, files = listScannedFiles(root)) {
  const references = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    if (!text.includes(VENDOR_PREFIX)) continue;
    const lines = text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (!line.includes(VENDOR_PREFIX)) continue;
      // Import specifiers first, so a quoted import path is not also reported as a
      // bare string reference on the same line.
      const imported = new Set();
      for (const match of line.matchAll(IMPORT_RE)) {
        const target = normalizeSpecifier(match[1], file);
        if (!target || !target.includes(VENDOR_PREFIX)) continue;
        imported.add(match[1]);
        references.push({ file, line: index + 1, kind: 'import', specifier: match[1], target });
      }
      for (const match of line.matchAll(BARE_PATH_RE)) {
        const raw = match[1];
        if (imported.has(raw)) continue;
        // Not file references: interpolation, globs, brace expansion, gitignore
        // negations, and strings that span escaped newlines.
        if (raw.includes('${') || raw.includes('*') || /[{}]/.test(raw) || raw.includes('\\')) continue;
        if (raw.startsWith('!')) continue;
        const target = raw.startsWith('.') ? normalizeSpecifier(raw, file) : raw.startsWith('/') ? raw.slice(1) : raw;
        if (!target.includes(VENDOR_PREFIX)) continue;
        // A bare string may cite a repository file with its line number. Resolve
        // the file itself; the line number is checked by the owning gate.
        const fileTarget = target.replace(/:([1-9][0-9]*)$/u, '');
        references.push({ file, line: index + 1, kind: 'string', specifier: raw, target: fileTarget });
      }
    }
  }

  const packagePath = join(root, 'package.json');
  if (existsSync(packagePath)) {
    const scripts = JSON.parse(readFileSync(packagePath, 'utf8')).scripts ?? {};
    for (const [name, command] of Object.entries(scripts)) {
      if (typeof command !== 'string') continue;
      for (const match of command.matchAll(/(openclaw_runtime\/[A-Za-z0-9_@%+~().\/-]+)/g)) {
        references.push({ file: 'package.json', line: 0, kind: 'package-script', specifier: name, target: match[1] });
      }
    }
  }

  return references;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesBaseline(entry, reference) {
  if (entry.file && entry.file !== reference.file) return false;
  if (entry.target) {
    const pattern = new RegExp(`^${entry.target.split('*').map(escapeRegExp).join('.*')}$`);
    return pattern.test(reference.target);
  }
  return true;
}

/**
 * Run the whole check.
 * @returns {{ok: boolean, referenceCount: number, countsByKind: Record<string, number>,
 *   dangling: object[], exempted: object[], staleExemptions: object[], errors: string[]}}
 */
export function checkRuntimeDeepRefs({ root = ROOT, baseline = loadBaseline(root), files } = {}) {
  const references = collectReferences(root, files);
  const dangling = [];
  const exempted = [];

  for (const reference of references) {
    const exists = resolvesToExistingPath(root, reference.target);
    const exemption = baseline.entries.find((entry) => matchesBaseline(entry, reference));
    if (exists) continue;
    if (exemption) exempted.push({ ...reference, reason: exemption.reason });
    else dangling.push(reference);
  }

  const usedExemptions = new Set(exempted.map((entry) => `${entry.file}|${entry.target}`));
  const staleExemptions = baseline.entries.filter((entry) => {
    if (entry.target) {
      return !references.some((reference) => matchesBaseline(entry, reference));
    }
    return references.every((reference) => !matchesBaseline(entry, reference));
  });

  const errors = [];
  for (const reference of dangling) {
    errors.push(
      `dangling vendored reference: ${reference.file}:${reference.line} → ${reference.target} ` +
        `(${reference.kind}) does not resolve; fix the path or add it to scripts/runtime-deep-refs-baseline.json with a reason`,
    );
  }
  for (const entry of baseline.entries) {
    if (!entry.reason || !entry.reason.trim()) {
      errors.push(`baseline entry without a reason: ${JSON.stringify(entry)}`);
    }
  }
  // Stale exemptions are informational, like the feature-leaf baseline: a merge or a
  // fix must never turn an unrelated change red.

  const countsByKind = {};
  for (const reference of references) countsByKind[reference.kind] = (countsByKind[reference.kind] ?? 0) + 1;

  return {
    ok: errors.length === 0,
    referenceCount: references.length,
    countsByKind,
    dangling,
    exempted,
    staleExemptions,
    errors,
  };
}

function main(argv) {
  const json = argv.includes('--json');
  const rootIndex = argv.indexOf('--root');
  const root = rootIndex >= 0 ? resolve(argv[rootIndex + 1]) : ROOT;
  const report = checkRuntimeDeepRefs({ root });
  if (json) {
    console.log(JSON.stringify({ check: 'runtime-deep-refs', driven_by: 'agent', ...report }, null, 2));
  } else {
    console.log(
      `runtime-deep-refs: ${report.referenceCount} reference(s) ${JSON.stringify(report.countsByKind)}`,
    );
    console.log(`  exempted (accepted debt): ${report.exempted.length}`);
    if (report.staleExemptions.length > 0) {
      console.log(`  INFO ${report.staleExemptions.length} baseline entr(ies) no longer match any reference:`);
      for (const entry of report.staleExemptions) console.log(`    - ${JSON.stringify(entry)}`);
    }
    if (report.ok) console.log('  OK: every reference resolves or is exempted with a reason');
    else for (const message of report.errors) console.log(`  FAIL: ${message}`);
  }
  process.exitCode = report.ok ? 0 : 1;
}

if (isMainEntrypoint(import.meta.url)) {
  main(process.argv.slice(2));
}
