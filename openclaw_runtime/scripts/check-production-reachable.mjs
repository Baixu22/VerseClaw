#!/usr/bin/env node
// §D1 gate: decides whether a symbol is *production reachable* rather than merely defined.
//
// Why this exists: a flat `grep -rn <symbol> src/` cannot answer the question §D1
// asks, and in this repo it actively lies. Two measured examples:
//
//   applyContextLadder      -> grep finds 2 non-test hits, both of which are the
//                              symbol's own name quoted inside a comment string in
//                              coding-c6h-flip-decision.ts. Real call sites: 0.
//   compressToolOutputText  -> grep finds a genuine call in coding-long-chat-curve.ts,
//                              but that module is itself imported by nothing that a
//                              production entry point reaches. Real reachability: none.
//
// So the check has to (a) ignore matches inside comments and string literals, and
// (b) recursively decide whether the *referencing module* is reachable from a
// production entry point. Both are implemented below.
//
// Reachability follows static `import`/`export ... from` edges AND dynamic
// `import("<literal>")` edges. The dynamic edges are not optional here: src/index.ts
// reaches the entire library through `await import("./library.js")`, and there are
// ~1300 literal dynamic imports across src. The ~17 dynamic imports that use a
// computed specifier (plugin/extension loaders) are an acknowledged blind spot and
// are reported by --blind-spots rather than silently ignored.
//
// Usage:
//   node scripts/check-production-reachable.mjs <symbol> [<symbol>...]
//   node scripts/check-production-reachable.mjs --all-modules
//   node scripts/check-production-reachable.mjs --blind-spots
//   node scripts/check-production-reachable.mjs --roots
//
// Exit codes (per symbol run, worst wins):
//   0  every queried symbol has >=1 real call site in a production-reachable module
//   1  at least one symbol has no production-reachable call site
//   2  at least one symbol is reachable only as a re-exported API surface (no call site)
//   3  usage error, unknown symbol, or a configured root no longer exists
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(SCRIPT_DIR, "..");
const SRC_ROOT = path.join(PKG_ROOT, "src");

/**
 * Production entry points named by §D1: attempt.ts / gateway startup /
 * init.ts registration / RPC exposure, plus the package main.
 *
 * Kept as repo-relative paths so a stale entry fails loudly (exit 3) instead of
 * silently shrinking the reachable set — a checker that scans from a root that no
 * longer exists reports false "unreachable" verdicts, which is the exact failure
 * mode §D1 is meant to prevent.
 */
export const PRODUCTION_ROOTS = [
  "src/index.ts",
  "src/agents/embedded-agent-runner/run/attempt.ts",
  "src/context-engine/init.ts",
  "src/gateway/boot.ts",
  "src/gateway/cli-runtime/gateway-rpc.ts",
];

const SOURCE_EXTENSIONS = [".ts", ".mts"];
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "build", ".git", "__snapshots__"]);

/** Files that must never count as a production call site. */
export function classifyFile(relPath) {
  const p = relPath.replaceAll("\\", "/");
  if (/\.(test|spec)\.[cm]?ts$/u.test(p)) return "test";
  if (/(^|\/)__tests__\//u.test(p)) return "test";
  if (/test-support|test-helpers|\.fixture\.|\/fixtures\//u.test(p)) return "test";
  if (/(^|\/)experiments\//u.test(p)) return "experiment";
  if (/(^|\/)scripts\//u.test(p)) return "script";
  return "production";
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Blanks out comments and, when `blankStrings` is set, string-literal bodies —
 * preserving line structure and `${...}` expressions inside template literals.
 *
 * Two modes are needed and conflating them is a real bug: module specifiers *are*
 * string literals, so the import graph must be built from source with comments
 * stripped but strings intact, while symbol reference search needs both gone (that
 * is what stops `"applyContextLadder"` inside a comment from counting as a call).
 *
 * Replacing with spaces rather than deleting keeps line and column numbers intact,
 * so reported file:line values still point at the real source location.
 */
export function stripSource(source, { blankStrings }) {
  const out = Array.from(source);
  const n = source.length;
  let i = 0;

  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k += 1) {
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
  };

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "/" && next === "/") {
      let j = i;
      while (j < n && source[j] !== "\n") j += 1;
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === "/" && next === "*") {
      let j = i + 2;
      while (j < n && !(source[j] === "*" && source[j + 1] === "/")) j += 1;
      blank(i, Math.min(j + 2, n));
      i = j + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && source[j] !== ch) {
        if (source[j] === "\\") j += 1;
        if (source[j] === "\n") break;
        j += 1;
      }
      if (blankStrings) blank(i, Math.min(j + 1, n));
      i = j + 1;
      continue;
    }
    if (ch === "`") {
      // Walk the template, blanking literal chunks but leaving ${...} alone.
      let j = i + 1;
      let chunkStart = i;
      while (j < n) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === "$" && source[j + 1] === "{") {
          if (blankStrings) blank(chunkStart, j);
          // Skip to the matching close brace, tracking nesting.
          let depth = 1;
          let k = j + 2;
          while (k < n && depth > 0) {
            if (source[k] === "{") depth += 1;
            else if (source[k] === "}") depth -= 1;
            k += 1;
          }
          j = k;
          chunkStart = j;
          continue;
        }
        if (source[j] === "`") break;
        j += 1;
      }
      if (blankStrings) blank(chunkStart, Math.min(j + 1, n));
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/** Comments and strings both blanked — for symbol reference search. */
export function stripCommentsAndStrings(source) {
  return stripSource(source, { blankStrings: true });
}

/** Comments blanked, strings kept — for module specifier extraction. */
export function stripCommentsOnly(source) {
  return stripSource(source, { blankStrings: false });
}

const STATIC_IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s*["']([^"']+)["']/gu;
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s*["']([^"']+)["']/gu;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*["']([^"']+)["']/gu;
const COMPUTED_DYNAMIC_RE = /\bimport\(\s*(?!["'])([^)\s][^)]{0,80})/gu;

/** Extracts every statically-resolvable module specifier from already-stripped source. */
export function extractSpecifiers(strippedSource) {
  const found = new Set();
  for (const re of [STATIC_IMPORT_RE, BARE_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(strippedSource)) !== null) found.add(m[1]);
  }
  return [...found];
}

/**
 * Resolves an ESM specifier to a file on disk. This codebase writes `.js` in
 * specifiers while the sources are `.ts`, so `.js` -> `.ts` is the common case.
 */
export function resolveSpecifier(fromFile, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [];
  if (/\.[cm]?js$/u.test(base)) {
    candidates.push(base.replace(/\.c?js$/u, ".ts"), base.replace(/\.mjs$/u, ".mts"));
  }
  candidates.push(base, `${base}.ts`, `${base}.mts`);
  candidates.push(path.join(base, "index.ts"), path.join(base, "index.mts"));
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

function buildGraph(files) {
  const stripped = new Map();
  const specifierText = new Map();
  const edges = new Map();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    // Symbol search wants strings gone; specifier extraction and import-span
    // detection need them intact. Blanking is length-preserving, so offsets are
    // interchangeable between the two variants.
    stripped.set(file, stripCommentsAndStrings(source));
    const forSpecifiers = stripCommentsOnly(source);
    specifierText.set(file, forSpecifiers);
    const targets = new Set();
    for (const spec of extractSpecifiers(forSpecifiers)) {
      const resolved = resolveSpecifier(file, spec);
      if (resolved) targets.add(resolved);
    }
    edges.set(file, targets);
  }
  return { stripped, specifierText, edges };
}

function reachableFrom(roots, edges) {
  const seen = new Set();
  const stack = [...roots];
  while (stack.length > 0) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of edges.get(current) ?? []) {
      if (!seen.has(next)) stack.push(next);
    }
  }
  return seen;
}

/**
 * Character ranges covered by `import ... from "..."` / `export ... from "..."`
 * statements, which in this codebase routinely span many lines.
 *
 * Without this, a symbol sitting alone on its own line inside a multi-line import
 * block is indistinguishable from a call, which would let an imported-but-never-
 * called symbol report as production reachable — the exact false positive §D1 must
 * not produce.
 */
export function findImportExportSpans(strippedSource) {
  const spans = [];
  const re = /(?:^|\n)[ \t]*(import|export)\b([\s\S]{0,2000}?)from[ \t]*["'][^"']+["']/gu;
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(strippedSource)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length, keyword: m[1] });
  }
  return spans;
}

function spanKindAt(spans, offset) {
  for (const span of spans) {
    if (offset >= span.start && offset < span.end) {
      return span.keyword === "import" ? "import" : "re-export";
    }
  }
  return undefined;
}

/** True when the line declares/re-exports the symbol rather than using it. */
export function classifyReference(line, symbol) {
  const decl = new RegExp(
    `\\b(?:export\\s+)?(?:async\\s+)?(?:function|class|const|let|var|type|interface|enum)\\s+${symbol}\\b`,
    "u",
  );
  if (decl.test(line)) return "definition";
  if (new RegExp(`\\bexport\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*from\\b`, "u").test(line)) {
    return "re-export";
  }
  if (new RegExp(`\\bexport\\s*\\{[^}]*\\b${symbol}\\b`, "u").test(line)) return "re-export";
  if (new RegExp(`\\bimport\\s*(?:type\\s*)?\\{[^}]*\\b${symbol}\\b`, "u").test(line)) {
    return "import";
  }
  return "use";
}

function findReferences(symbol, files, stripped, specifierText) {
  const word = new RegExp(`\\b${symbol}\\b`, "gu");
  const hits = [];
  for (const file of files) {
    const text = stripped.get(file);
    if (!text) continue;
    word.lastIndex = 0;
    if (!word.test(text)) continue;
    // Spans must come from the strings-intact variant: the fully stripped text has
    // its specifier quotes blanked, so a quote-anchored match can never fire there.
    const spans = findImportExportSpans(specifierText.get(file) ?? text);
    // Scanning the full text and deriving line numbers from the match offset avoids
    // the offset drift that line-splitting introduces on CRLF files (this repo is
    // CRLF, so `line.length + 1` would undercount by one byte per line).
    const lineStarts = [0];
    for (let k = 0; k < text.length; k += 1) {
      if (text[k] === "\n") lineStarts.push(k + 1);
    }
    const lineNumberAt = (offset) => {
      let lo = 0;
      let hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (lineStarts[mid] <= offset) lo = mid;
        else hi = mid - 1;
      }
      return lo + 1;
    };
    const lineTextAt = (lineNo) => {
      const start = lineStarts[lineNo - 1];
      const end = lineNo < lineStarts.length ? lineStarts[lineNo] : text.length;
      return text.slice(start, end).trim();
    };

    word.lastIndex = 0;
    const seenLines = new Set();
    let m;
    while ((m = word.exec(text)) !== null) {
      const lineNo = lineNumberAt(m.index);
      if (seenLines.has(lineNo)) continue;
      seenLines.add(lineNo);
      const lineText = lineTextAt(lineNo);
      // Resolve against multi-line statement spans first; a single line is not
      // enough context to tell an import member from a call.
      const inSpan = spanKindAt(spans, m.index);
      hits.push({
        file,
        line: lineNo,
        kind: inSpan ?? classifyReference(lineText, symbol),
        text: lineText.slice(0, 160),
      });
    }
  }
  return hits;
}

function rel(file) {
  return path.relative(PKG_ROOT, file).replaceAll("\\", "/");
}

function resolveRoots() {
  const resolved = [];
  const missing = [];
  for (const root of PRODUCTION_ROOTS) {
    const abs = path.join(PKG_ROOT, root);
    if (existsSync(abs)) resolved.push(abs);
    else missing.push(root);
  }
  return { resolved, missing };
}

function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(
      [
        "check-production-reachable — §D1 production reachability gate",
        "",
        "  node scripts/check-production-reachable.mjs <symbol> [<symbol>...]",
        "  node scripts/check-production-reachable.mjs --all-modules",
        "  node scripts/check-production-reachable.mjs --blind-spots",
        "  node scripts/check-production-reachable.mjs --roots",
        "",
        "exit 0 reachable | 1 unreachable | 2 api-surface-only | 3 usage/root error",
      ].join("\n"),
    );
    return args.length === 0 ? 3 : 0;
  }

  const { resolved: roots, missing } = resolveRoots();
  if (missing.length > 0) {
    console.error("FAIL: configured production roots no longer exist:");
    for (const m of missing) console.error(`  - ${m}`);
    console.error("Update PRODUCTION_ROOTS; a stale root silently shrinks the reachable set.");
    return 3;
  }

  const allFiles = walk(SRC_ROOT);
  const { stripped, specifierText, edges } = buildGraph(allFiles);
  const reachable = reachableFrom(roots, edges);

  if (args.includes("--roots")) {
    console.log("production roots (§D1):");
    for (const r of roots) console.log(`  ${rel(r)}`);
    console.log(`\nreachable modules: ${reachable.size} / ${allFiles.length} scanned`);
    return 0;
  }

  if (args.includes("--blind-spots")) {
    console.log("computed dynamic import specifiers (unresolvable, reachability blind spots):");
    let count = 0;
    for (const file of allFiles) {
      const text = stripped.get(file);
      COMPUTED_DYNAMIC_RE.lastIndex = 0;
      let m;
      while ((m = COMPUTED_DYNAMIC_RE.exec(text)) !== null) {
        const line = text.slice(0, m.index).split(/\r?\n/u).length;
        console.log(`  ${rel(file)}:${line}  import(${m[1].trim()}`);
        count += 1;
      }
    }
    console.log(`\ntotal: ${count}`);
    return 0;
  }

  if (args.includes("--all-modules")) {
    const orphans = allFiles
      .filter((f) => classifyFile(rel(f)) === "production" && !reachable.has(f))
      .map(rel)
      .toSorted((a, b) => a.localeCompare(b));
    console.log(`production modules not reachable from any §D1 root: ${orphans.length}`);
    for (const o of orphans) console.log(`  ${o}`);
    console.log(
      `\nscanned ${allFiles.length} files; ${reachable.size} reachable; ` +
        `${allFiles.filter((f) => classifyFile(rel(f)) !== "production").length} test/experiment/script`,
    );
    console.log(
      "\nNOTE: the §D1 roots are this round's context/agent entry points only, not the\n" +
        "whole product. Modules behind out-of-scope entry points (channels, ACP, media,\n" +
        "release) are counted here but are not necessarily dead. This mode is a coarse\n" +
        "sweep; the per-symbol mode is the authoritative §D1 gate.",
    );
    return orphans.length === 0 ? 0 : 1;
  }

  const symbols = args.filter((a) => !a.startsWith("--"));
  let worst = 0;

  for (const symbol of symbols) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(symbol)) {
      console.error(`FAIL: not a valid identifier: ${symbol}`);
      worst = Math.max(worst, 3);
      continue;
    }
    const hits = findReferences(symbol, allFiles, stripped, specifierText);
    if (hits.length === 0) {
      console.log(`\n=== ${symbol} ===`);
      console.log("  symbol not found in src/ (after stripping comments and strings)");
      worst = Math.max(worst, 3);
      continue;
    }

    const productionCalls = [];
    const productionReExports = [];
    const productionImportsOnly = [];
    const excluded = [];
    for (const hit of hits) {
      const cls = classifyFile(rel(hit.file));
      const inReach = reachable.has(hit.file);
      if (hit.kind === "definition") continue;
      if (cls !== "production" || !inReach) {
        excluded.push({ ...hit, why: cls !== "production" ? cls : "module-unreachable" });
        continue;
      }
      if (hit.kind === "use") productionCalls.push(hit);
      else if (hit.kind === "re-export") productionReExports.push(hit);
      else productionImportsOnly.push(hit);
    }

    console.log(`\n=== ${symbol} ===`);
    if (productionCalls.length > 0) {
      console.log(`  PRODUCTION REACHABLE — ${productionCalls.length} call site(s):`);
      for (const h of productionCalls) console.log(`    ${rel(h.file)}:${h.line}  ${h.text}`);
    } else if (productionReExports.length > 0 || productionImportsOnly.length > 0) {
      console.log("  API-SURFACE-ONLY — referenced in reachable modules but never called:");
      for (const h of [...productionReExports, ...productionImportsOnly]) {
        console.log(`    [${h.kind}] ${rel(h.file)}:${h.line}  ${h.text}`);
      }
      worst = Math.max(worst, 2);
    } else {
      console.log("  NOT PRODUCTION REACHABLE — zero production call sites");
      worst = Math.max(worst, 1);
    }

    if (excluded.length > 0) {
      console.log(`  excluded (${excluded.length}) — these are why flat grep over-counts:`);
      for (const h of excluded.slice(0, 20)) {
        console.log(`    [${h.why}/${h.kind}] ${rel(h.file)}:${h.line}  ${h.text}`);
      }
      if (excluded.length > 20) console.log(`    ... and ${excluded.length - 20} more`);
    }
  }

  return worst;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main(process.argv));
}
