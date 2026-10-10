#!/usr/bin/env node
/**
 * Guard: every runtime feature leaf must have a visible consumer.
 *
 * Class of defect this covers (issue #96, AC b): a config leaf that is
 * declared in the runtime config type / zod schema / labels but that no
 * runtime source ever reads — so flipping it in Settings or in the config
 * file silently does nothing. The `runtime.coding.uftk` subtree was the
 * canonical instance: its 12 gates (19 leaves) shipped in the type, the
 * exhaustive fixture and the strict schema with zero readers, and issue #95
 * removed them. It is kept here as the historical example of the class.
 *
 * WHAT THIS CHECK IS, AND IS NOT
 * ------------------------------
 * The consumer test is TEXTUAL / STRUCTURAL, not a proof of reachability.
 * A leaf is treated as consumed when, somewhere outside the config-declaration
 * and test scope, it is specifically named:
 *   (a) the full dotted path appears as a quoted string ("runtime.<path>"),
 *   (b) a suffix chain of >= 2 segments appears as a property access,
 *   (c) the leaf's most specific segment (the last segment that is not a
 *       generic gate word such as `enabled`/`shadow`) is reached as a
 *       property access (`.seg`, `?.seg`) or as a quoted key (`"seg"`,
 *       `["seg"]`). This repo reads leaves through generic record helpers and
 *       quoted key tables — e.g. `readCodingLeaf(coding, "staleWriteGuard")`
 *       and `["verifiedRuntime", "typedAci", ...]` — so the quoted-key form is
 *       load-bearing evidence, not decoration.
 *
 * Honest limits: a match may come from a comment, an unrelated identifier of
 * the same name, or a type-only reference; a leaf reached only dynamically
 * (computed key, config passthrough) may be missed; and a *new* leaf added
 * under a parent whose specific segment name is already used elsewhere can be
 * treated as consumed even though nothing reads that leaf. The check is a
 * tripwire for leaves that are *never specifically named*, not a reachability
 * prover. It deliberately fails OPEN (ambiguous => consumed) so a missed
 * detection only weakens the baseline and never raises a false red.
 *
 * Baseline policy (fail closed only on NEW zero-consumer leaves)
 * -------------------------------------------------------------
 * Today's zero-consumer leaves are pinned in FEATURE_LEAF_CONSUMER_BASELINE
 * with the owning issue recorded. Fatal is exactly one condition: a leaf that
 * is NOT pinned shows up with no consumer. Two softer outcomes stay green:
 *   - a pinned leaf gains a consumer (e.g. a wiring fix landing) => informational;
 *   - a pinned leaf no longer exists in the schema (a removal fix landing)
 *     => informational, so removing dead leaves is never punished.
 *
 * Usage:
 *   node scripts/check-feature-leaf-consumers.mjs [--root <dir>] [--json]
 *   node scripts/check-feature-leaf-consumers.mjs --self-test
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Machine-readable source of the runtime feature leaves (single source of truth). */
export const RUNTIME_FEATURE_LEAVES_SOURCE = 'openclaw_runtime/src/config/runtime-feature-leaves.ts';
/** The exported sample object that is compile-checked to cover every typed leaf. */
export const RUNTIME_FEATURE_LEAVES_EXPORT = 'RUNTIME_FEATURE_EXHAUSTIVE';

/**
 * Directories scanned for consumers. `openclaw_runtime/src/config/**` is
 * excluded via EXCLUDED_PATH_PARTS because that tree *declares* leaves
 * (type / zod schema / labels / help) rather than consuming them.
 */
export const SCAN_DIRS = ['openclaw_runtime/src', 'electron', 'shared', 'src'];
export const EXCLUDED_PATH_PARTS = ['/config/', '/test/', '/tests/', '/__tests__/', '/__mocks__/', '/fixtures/'];
export const EXCLUDED_FILE_RE = /\.(test|spec)\.(ts|tsx|mts|cts)$/;
export const SCANNED_EXT_RE = /\.(ts|tsx|mts|cts)$/;

/**
 * Gate keys that are too generic to identify a leaf on their own. They are
 * skipped when picking the leaf's "most specific segment" (see
 * mostSpecificSegment), because e.g. `enabled` or `shadow` alone appears in
 * hundreds of unrelated expressions. The chain rules still apply in full.
 */
export const GENERIC_SEGMENTS = new Set([
  'enabled', 'shadow', 'persist', 'default', 'mode', 'role', 'rules', 'provider', 'seal',
]);

/**
 * Pinned baseline: leaves with no specific consumer visible in this tree today.
 *
 * Issue #95 resolved the historical bulk of this list: the whole
 * `coding.uftk` subtree (17 of the 19 entries that were once pinned here) was
 * removed from the type, the strict schema and the exhaustive fixture because it
 * had zero runtime readers. Nothing pins an `uftk` leaf any more, and a
 * regression test asserts the subtree cannot come back silently.
 *
 * What remains are heuristics-blind spots, not proven-dead leaves:
 * `coding.verifier.noSelfRepair` and
 * `contextFamily.observationMasking.preserveNewestObservationCount` are read
 * through paths this textual scan cannot see. Pinning them keeps today's tree
 * green without asserting they are unwired — if their readers become visible,
 * the check reports them as informational and stays green.
 */
export const FEATURE_LEAF_CONSUMER_BASELINE = Object.freeze([
  'coding.verifier.noSelfRepair',
  'contextFamily.observationMasking.preserveNewestObservationCount',
]);

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Dot-joined leaf paths of a plain-object sample tree.
 * Arrays and empty objects are leaves — same semantics as `listLeafPaths` in
 * runtime-feature-leaves.ts, reimplemented here because that file is TypeScript
 * and this check is a plain-node script.
 */
export function listLeafPaths(node, prefix = '') {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return prefix ? [prefix] : [];
  }
  const keys = Object.keys(node);
  if (keys.length === 0) return prefix ? [prefix] : [];
  return keys.flatMap((key) => listLeafPaths(node[key], prefix ? `${prefix}.${key}` : key));
}

/**
 * Extract the `RUNTIME_FEATURE_EXHAUSTIVE` object literal from the TypeScript
 * source with a brace/string/comment-aware scan, then evaluate it as data.
 * This keeps the leaf list tied to the real source instead of a copy that
 * can drift.
 */
export function extractRuntimeFeatureLeaves(sourceText) {
  const anchor = sourceText.indexOf(`export const ${RUNTIME_FEATURE_LEAVES_EXPORT}`);
  if (anchor < 0) {
    throw new Error(`could not find 'export const ${RUNTIME_FEATURE_LEAVES_EXPORT}' in ${RUNTIME_FEATURE_LEAVES_SOURCE}`);
  }
  const start = sourceText.indexOf('{', sourceText.indexOf('= {', anchor));
  if (start < 0) {
    throw new Error(`could not find the object literal for ${RUNTIME_FEATURE_LEAVES_EXPORT}`);
  }
  let depth = 0;
  let end = -1;
  let quote = null;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = start; i < sourceText.length; i++) {
    const char = sourceText[i];
    const next = sourceText[i + 1];
    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (quote) {
      if (char === '\\') { i++; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (char === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw new Error(`unterminated object literal for ${RUNTIME_FEATURE_LEAVES_EXPORT}`);
  const literal = sourceText.slice(start, end + 1);
  let value;
  try {
    // The literal is pure data (strings/numbers/booleans/arrays/objects).
    value = Function(`"use strict"; return (${literal});`)();
  } catch (error) {
    throw new Error(`could not evaluate ${RUNTIME_FEATURE_LEAVES_EXPORT}: ${error.message}`);
  }
  return listLeafPaths(value).sort();
}

/** Collect candidate consumer source files under `root`. */
export function listConsumerFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SCANNED_EXT_RE.test(entry.name)) out.push(full.split(sep).join('/'));
    }
  };
  for (const dir of SCAN_DIRS) {
    const abs = join(root, dir);
    try { if (!statSync(abs).isDirectory()) continue; } catch { continue; }
    walk(abs);
  }
  return out.filter((file) => {
    if (EXCLUDED_FILE_RE.test(file)) return false;
    return !EXCLUDED_PATH_PARTS.some((part) => file.includes(part));
  }).sort();
}

/** Load `{ path, text }` for every consumer file under `root`. */
export function loadConsumerSources(root) {
  return listConsumerFiles(root).map((file) => ({ path: file, text: readFileSync(file, 'utf8') }));
}

/** The most specific segment of a leaf path: the last one that is not a generic gate word. */
export function mostSpecificSegment(leafPath) {
  const segments = leafPath.split('.');
  for (let i = segments.length - 1; i >= 0; i--) {
    if (!GENERIC_SEGMENTS.has(segments[i])) return segments[i];
  }
  return null;
}

/**
 * Build the regex set that decides whether one leaf path is specifically named.
 * Exported so tests can assert shape without re-deriving it.
 */
export function buildLeafPatterns(leafPath) {
  const segments = leafPath.split('.');
  const quotedFullPath = [
    `"runtime.${leafPath}"`,
    `'runtime.${leafPath}'`,
    `"${leafPath}"`,
    `'${leafPath}'`,
  ];
  // Every suffix chain of >= 2 segments, as a property access with optional chaining.
  const chains = [];
  for (let size = 2; size <= segments.length; size++) {
    const suffix = segments.slice(segments.length - size);
    chains.push(new RegExp(suffix.map(escapeRegExp).join('[?]?\\s*\\.\\s*')));
  }
  const specific = mostSpecificSegment(leafPath);
  const specificPatterns = specific
    ? [
      new RegExp(`[.?]\\s*\\.\\s*${escapeRegExp(specific)}(?![\\w$])`),
      new RegExp(`(["'\`])${escapeRegExp(specific)}\\1`),
      new RegExp(`\\[\\s*(["'\`])${escapeRegExp(specific)}\\1\\s*\\]`),
    ]
    : [];
  return { quotedFullPath, chains, specificPatterns, specific };
}

/** True when `leafPath` is specifically named by at least one consumer source. */
export function hasConsumer(leafPath, sources) {
  const { quotedFullPath, chains, specificPatterns } = buildLeafPatterns(leafPath);
  for (const { text } of sources) {
    if (quotedFullPath.some((needle) => text.includes(needle))) return true;
    if (chains.some((pattern) => pattern.test(text))) return true;
    if (specificPatterns.some((pattern) => pattern.test(text))) return true;
  }
  return false;
}

/**
 * Run the whole check.
 * @returns {{ ok: boolean, leafCount: number, consumerFileCount: number,
 *   unpinnedZeroConsumerLeaves: string[], pinnedZeroConsumerLeaves: string[],
 *   baselineLeavesNowConsumed: string[], staleBaselineEntries: string[], errors: string[] }}
 */
export function checkFeatureLeafConsumers({ root = process.cwd(), baseline = FEATURE_LEAF_CONSUMER_BASELINE, sources, leafPaths } = {}) {
  const errors = [];
  let leaves = leafPaths;
  let consumerSources = sources;
  if (!leaves) {
    try {
      const sourceFile = join(root, RUNTIME_FEATURE_LEAVES_SOURCE);
      leaves = extractRuntimeFeatureLeaves(readFileSync(sourceFile, 'utf8'));
    } catch (error) {
      return { ok: false, leafCount: 0, consumerFileCount: 0, unpinnedZeroConsumerLeaves: [], pinnedZeroConsumerLeaves: [], baselineLeavesNowConsumed: [], staleBaselineEntries: [], errors: [error.message] };
    }
  }
  if (!consumerSources) consumerSources = loadConsumerSources(root);
  if (leaves.length === 0) errors.push('no runtime feature leaves were enumerated');

  const pinned = new Set(baseline);
  const unpinnedZeroConsumerLeaves = [];
  const pinnedZeroConsumerLeaves = [];
  const baselineLeavesNowConsumed = [];

  for (const leaf of [...leaves].sort()) {
    const consumed = hasConsumer(leaf, consumerSources);
    if (!consumed && !pinned.has(leaf)) unpinnedZeroConsumerLeaves.push(leaf);
    if (!consumed && pinned.has(leaf)) pinnedZeroConsumerLeaves.push(leaf);
    if (consumed && pinned.has(leaf)) baselineLeavesNowConsumed.push(leaf);
  }

  const enumerated = new Set(leaves);
  const staleBaselineEntries = [...pinned].filter((leaf) => !enumerated.has(leaf)).sort();
  // Fatal is exactly one condition: an unpinned leaf has no visible consumer.
  // A pinned leaf that gained a consumer, or that no longer exists in the
  // schema, is informational so that resolving the #95 debt in either
  // direction (re-wire or delete) can never turn this guard red.
  for (const leaf of unpinnedZeroConsumerLeaves) {
    errors.push(`runtime feature leaf '${leaf}' has no visible consumer; wire it to a runtime reader, or pin it in FEATURE_LEAF_CONSUMER_BASELINE with its owning issue`);
  }

  return {
    ok: errors.length === 0,
    leafCount: leaves.length,
    consumerFileCount: consumerSources.length,
    unpinnedZeroConsumerLeaves,
    pinnedZeroConsumerLeaves,
    baselineLeavesNowConsumed,
    staleBaselineEntries,
    errors,
  };
}

function main(argv) {
  const json = argv.includes('--json');
  const rootIndex = argv.indexOf('--root');
  const root = rootIndex >= 0 ? resolve(argv[rootIndex + 1]) : process.cwd();
  let report;
  try {
    report = checkFeatureLeafConsumers({ root });
  } catch (error) {
    report = { ok: false, leafCount: 0, consumerFileCount: 0, unpinnedZeroConsumerLeaves: [], pinnedZeroConsumerLeaves: [], baselineLeavesNowConsumed: [], staleBaselineEntries: [], errors: [error.message] };
  }
  if (json) {
    console.log(JSON.stringify({ ...report, check: 'feature-leaf-consumers', driven_by: 'agent' }, null, 2));
  } else {
    console.log(`feature-leaf-consumers: ${report.leafCount} leaves, ${report.consumerFileCount} consumer sources`);
    console.log(`  pinned zero-consumer leaves : ${report.pinnedZeroConsumerLeaves.length}`);
    if (report.baselineLeavesNowConsumed.length > 0) {
      console.log(`  INFO pinned leaves that now have a consumer (${report.baselineLeavesNowConsumed.length}):`);
      for (const leaf of report.baselineLeavesNowConsumed) console.log(`    - ${leaf}`);
      console.log('    (informational: this is the expected #95 fix direction; the check stays green)');
    }
    if (report.staleBaselineEntries.length > 0) {
      console.log(`  INFO pinned leaf no longer exists in the schema (${report.staleBaselineEntries.length}):`);
      for (const leaf of report.staleBaselineEntries) console.log(`    - ${leaf}`);
      console.log('    (informational: drop it from FEATURE_LEAF_CONSUMER_BASELINE when the owner issue lands)');
    }
    if (report.ok) {
      console.log('  OK: no new zero-consumer leaf');
    } else {
      for (const message of report.errors) console.log(`  FAIL: ${message}`);
    }
  }
  process.exitCode = report.ok ? 0 : 1;
}

/**
 * Reproducible negative control. Builds a throwaway root in the OS temp dir,
 * runs the check against a synthetic runtime-feature-leaves.ts, and asserts:
 *   1. an empty baseline reports the unwired leaf as fatal (ok === false);
 *   2. pinning that leaf makes the same tree pass, reporting it as pinned.
 * Never touches the repo; removes its temp dir before returning.
 */
export function runSelfTest() {
  const results = [];
  const root = mkdtempSync(join(tmpdir(), 'feature-leaf-consumers-selftest-'));
  try {
    const configDir = join(root, 'openclaw_runtime', 'src', 'config');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'runtime-feature-leaves.ts'), [
      '/** synthetic self-test fixture */',
      'export const RUNTIME_FEATURE_EXHAUSTIVE = {',
      '  alpha: { enabled: true },',
      '  beta: { enabled: true },',
      '};',
      '',
    ].join('\n'));
    const consumerDir = join(root, 'openclaw_runtime', 'src', 'consumer');
    mkdirSync(consumerDir, { recursive: true });
    // Only `alpha` has a reader; `beta` is the unwired leaf.
    writeFileSync(join(consumerDir, 'alpha.ts'), 'export const a = cfg.runtime?.alpha?.enabled === true;\n');

    const unpinned = checkFeatureLeafConsumers({ root });
    const pinned = checkFeatureLeafConsumers({ root, baseline: ['beta.enabled'] });

    results.push({
      name: 'unwired leaf fails closed with an empty baseline',
      ok: unpinned.ok === false
        && unpinned.unpinnedZeroConsumerLeaves.includes('beta.enabled')
        && !unpinned.unpinnedZeroConsumerLeaves.includes('alpha.enabled')
        && unpinned.errors.some((message) => message.includes('beta.enabled')),
      detail: `ok=${unpinned.ok} unpinned=${JSON.stringify(unpinned.unpinnedZeroConsumerLeaves)}`,
    });
    results.push({
      name: 'pinning the unwired leaf makes the tree pass and reports it as pinned',
      ok: pinned.ok === true
        && pinned.pinnedZeroConsumerLeaves.includes('beta.enabled')
        && pinned.unpinnedZeroConsumerLeaves.length === 0,
      detail: `ok=${pinned.ok} pinned=${JSON.stringify(pinned.pinnedZeroConsumerLeaves)}`,
    });
    results.push({
      name: 'leaf count comes from the synthetic source',
      ok: unpinned.leafCount === 2,
      detail: `leafCount=${unpinned.leafCount}`,
    });
  } catch (error) {
    results.push({ name: 'self-test harness ran', ok: false, detail: error.message });
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  const failed = results.filter((result) => !result.ok);
  for (const result of results) {
    console.log(`  ${result.ok ? 'PASS' : 'FAIL'}  ${result.name}  [${result.detail}]`);
  }
  console.log(failed.length === 0
    ? `feature-leaf-consumers --self-test: PASS (${results.length}/${results.length})`
    : `feature-leaf-consumers --self-test: FAIL (${results.length - failed.length}/${results.length})`);
  return failed.length === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    process.exitCode = runSelfTest() ? 0 : 1;
  } else {
    main(argv);
  }
}
