// Review-diff view (SPEC §6.4 verify verb): semantic rewrite of ragcode's
// src/graph/diff-files.ts (MIT, https://github.com/MarshallEriksen-Neura/ragcode)
// plus the reviewDiff flow from its sqlite-graph-store. The unified-diff header
// parser is local (ragcode uses the parse-diff npm package; a dependency-free
// header scan covers the same extraction for git diffs).
import type { FactStore } from "../../factstore/store.js";
import { normalizeFactPath } from "../../factstore/ignore.js";
import { analyzeImpact } from "../impact/impact-view.js";

export interface DiffReview {
  changedFiles: string[];
  relatedTests: string[];
  riskLevel: "low" | "medium" | "high";
  findings: string[];
  impactedFiles: string[];
}

export interface ReviewDiffInput {
  diff?: string;
  changedFiles?: string[];
}

/** Extracts non-deleted target paths from a unified git diff (ragcode diff-files semantics). */
export function extractChangedFiles(diff: string): string[] {
  const files = new Set<string>();
  const lines = diff.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const plusMatch = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
    if (plusMatch) {
      const target = plusMatch[1]!.trim();
      if (target && target !== "/dev/null") files.add(normalizeFactPath(target));
      continue;
    }
    const gitMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (gitMatch) {
      // Header only counts when the file survives (deletions resolve to /dev/null above).
      const next = lines[index + 1] ?? "";
      if (!/^deleted file mode/.test(next)) files.add(normalizeFactPath(gitMatch[2]!.trim()));
    }
  }
  return [...files].sort();
}

export function reviewDiff(store: FactStore, repoRoot: string, input: ReviewDiffInput): DiffReview {
  const changedFiles =
    input.changedFiles && input.changedFiles.length > 0
      ? input.changedFiles.map(normalizeFactPath)
      : extractChangedFiles(input.diff ?? "");
  const tests = new Set<string>();
  const impacted = new Set<string>();
  const findings: string[] = [];
  let riskScore = 0;

  for (const filePath of changedFiles) {
    const impact = analyzeImpact(store, repoRoot, filePath);
    riskScore += impact.impactedFiles.length;
    for (const impactedFile of impact.impactedFiles) {
      impacted.add(impactedFile);
      if (isTestFile(impactedFile)) tests.add(impactedFile);
    }
    const basename = filePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? filePath;
    for (const record of store.getSymbolsByFile(repoRoot, filePath)) {
      if (record.kind === "file") continue;
      // Filename-matched tests (ragcode's fallback heuristic).
      for (const candidate of impacted) {
        if (isTestFile(candidate) && candidate.toLowerCase().includes(basename.toLowerCase())) tests.add(candidate);
      }
      break;
    }
    if (![...tests].some((test) => test.toLowerCase().includes(basename.toLowerCase())) && !isTestFile(filePath)) {
      findings.push(`No directly related test file found for ${filePath}.`);
    }
  }

  return {
    changedFiles,
    relatedTests: [...tests].sort(),
    riskLevel: riskScore > 12 ? "high" : riskScore > 4 ? "medium" : "low",
    findings,
    impactedFiles: [...impacted].sort(),
  };
}

function isTestFile(filePath: string): boolean {
  return /(^|\/)(__tests__|tests?)(\/|$)|\.(test|spec)\.[jt]sx?$/.test(filePath);
}
