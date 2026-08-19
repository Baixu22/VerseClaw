/**
 * Shared diff computation utilities for the edit tool.
 * Used by both edit.ts (for execution) and tool-execution.ts (for preview rendering).
 */

import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import * as Diff from "diff";
import { resolveToCwd } from "./path-utils.js";

export type LineEnding = "\r\n" | "\n" | "\r";

export function captureLineEndings(content: string): LineEnding[] {
  return [...content.matchAll(/\r\n|\n|\r/g)].map((match) => match[0] as LineEnding);
}

export function detectLineEnding(content: string): LineEnding {
  return captureLineEndings(content)[0] ?? "\n";
}

export function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function restoreLineEndings(
  text: string,
  ending: LineEnding | readonly LineEnding[],
): string {
  const endings = typeof ending === "string" ? undefined : ending;
  const fallback = typeof ending === "string" ? ending : (endings?.[0] ?? "\n");
  let index = 0;
  return text.replace(/\n/g, () => endings?.[index++] ?? fallback);
}

/**
 * Normalize text for fuzzy matching. Applies progressive transformations:
 * - Strip trailing whitespace from each line
 * - Normalize smart quotes to ASCII equivalents
 * - Normalize Unicode dashes/hyphens to ASCII hyphen
 * - Normalize special Unicode spaces to regular space
 */
export function normalizeForFuzzyMatch(text: string): string {
  return (
    text
      .normalize("NFKC")
      // Strip trailing whitespace per line
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      // Smart single quotes → '
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      // Smart double quotes → "
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      // Various dashes/hyphens → -
      // U+2010 hyphen, U+2011 non-breaking hyphen, U+2012 figure dash,
      // U+2013 en-dash, U+2014 em-dash, U+2015 horizontal bar, U+2212 minus
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
      // Special spaces → regular space
      // U+00A0 NBSP, U+2002-U+200A various spaces, U+202F narrow NBSP,
      // U+205F medium math space, U+3000 ideographic space
      .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ")
  );
}

/**
 * Aider-style "did you mean" hint: find the line(s) in `content` most similar
 * to `oldText` when an exact/fuzzy match failed. Returns up to `padding`
 * context lines around the best match when similarity >= threshold.
 *
 * Mirrors aider's `find_similar_lines` (threshold 0.6, expand N=5 lines):
 * - exact first/last line match → return the exact block
 * - otherwise best SequenceMatcher-style ratio over line windows
 */
export function findSimilarLines(
  content: string,
  oldText: string,
  options: { threshold?: number; padding?: number } = {},
): string {
  const threshold = options.threshold ?? 0.6;
  const padding = options.padding ?? 5;
  const contentLines = normalizeForFuzzyMatch(content).split("\n");
  const patternLines = normalizeForFuzzyMatch(oldText).split("\n").filter((line) => line.length > 0);
  if (contentLines.length === 0 || patternLines.length === 0) {
    return "";
  }

  // Exact first/last line match wins.
  const first = patternLines[0];
  const last = patternLines[patternLines.length - 1];
  for (let i = 0; i + patternLines.length <= contentLines.length; i += 1) {
    if (contentLines[i] === first && contentLines[i + patternLines.length - 1] === last) {
      const from = Math.max(0, i - padding);
      const to = Math.min(contentLines.length, i + patternLines.length + padding);
      return contentLines.slice(from, to).join("\n");
    }
  }

  // Sliding-window best ratio.
  let bestRatio = 0;
  let bestStart = -1;
  for (let start = 0; start + patternLines.length <= contentLines.length; start += 1) {
    const window = contentLines.slice(start, start + patternLines.length);
    const ratio = lineWindowRatio(window, patternLines);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestStart = start;
    }
  }
  if (bestRatio < threshold || bestStart < 0) {
    return "";
  }
  const from = Math.max(0, bestStart - padding);
  const to = Math.min(contentLines.length, bestStart + patternLines.length + padding);
  return contentLines.slice(from, to).join("\n");
}

/**
 * Line-level similarity via longest common subsequence (LCS) length, matching
 * Aider's SequenceMatcher.ratio() semantics on line sequences: 2*M/(len1+len2)
 * where M is the LCS length. Unlike shared-line counting, this is sensitive to
 * line ORDER, so a reordered block no longer scores 1.0 (parity fix: Aider
 * rejects reordered windows below threshold; the old Set count accepted them).
 */
function lineWindowRatio(window: string[], pattern: string[]): number {
  const denom = window.length + pattern.length;
  if (denom === 0) return 0;
  // Classic LCS DP, O(m*n) time with O(n) rolling rows. Rows are pattern
  // (m), columns are window (n); equal-length sliding windows make
  // ratio = 2*M/(2L) = M/L, identical to SequenceMatcher on unique lines.
  const m = pattern.length;
  const n = window.length;
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      curr[j] =
        pattern[i - 1] === window[j - 1]
          ? prev[j - 1] + 1
          : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  const lcs = prev[n];
  return (2 * lcs) / denom;
}

export interface FuzzyMatchResult {
  /** Whether a match was found */
  found: boolean;
  /** The index where the match starts (in the content that should be used for replacement) */
  index: number;
  /** Length of the matched text */
  matchLength: number;
  /** Whether fuzzy matching was used (false = exact match) */
  usedFuzzyMatch: boolean;
  /**
   * The content to use for replacement operations.
   * When exact match: original content. When fuzzy match: normalized content.
   */
  contentForReplacement: string;
}

type FuzzyIndex = {
  text: string;
  spans: Array<{ start: number; end: number }>;
};

function normalizeFuzzyCharacter(char: string): string {
  return char
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

function buildFuzzyIndex(text: string): FuzzyIndex {
  let normalized = "";
  const spans: FuzzyIndex["spans"] = [];
  let lineOutputStart = 0;

  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index);
    const char = String.fromCodePoint(codePoint ?? 0);
    const width = char.length;
    if (char === "\n") {
      while (normalized.length > lineOutputStart && /\s/u.test(normalized.at(-1) ?? "")) {
        normalized = normalized.slice(0, -1);
        spans.pop();
      }
      normalized += "\n";
      spans.push({ start: index, end: index + width });
      lineOutputStart = normalized.length;
      index += width;
      continue;
    }
    const transformed = normalizeFuzzyCharacter(char);
    normalized += transformed;
    for (let offset = 0; offset < transformed.length; offset += 1) {
      spans.push({ start: index, end: index + width });
    }
    index += width;
  }
  while (normalized.length > lineOutputStart && /\s/u.test(normalized.at(-1) ?? "")) {
    normalized = normalized.slice(0, -1);
    spans.pop();
  }
  return { text: normalized, spans };
}

export interface Edit {
  oldText: string;
  newText: string;
}

interface MatchedEdit {
  editIndex: number;
  matchIndex: number;
  matchLength: number;
  newText: string;
}

export interface AppliedEditsResult {
  baseContent: string;
  newContent: string;
}

/**
 * Find oldText in content, trying exact match first, then fuzzy match.
 * When fuzzy matching is used, the returned contentForReplacement is the
 * fuzzy-normalized version of the content (trailing whitespace stripped,
 * Unicode quotes/dashes normalized to ASCII).
 */
export function fuzzyFindText(content: string, oldText: string): FuzzyMatchResult {
  // Try exact match first
  const exactIndex = content.indexOf(oldText);
  if (exactIndex !== -1) {
    return {
      found: true,
      index: exactIndex,
      matchLength: oldText.length,
      usedFuzzyMatch: false,
      contentForReplacement: content,
    };
  }

  // Try fuzzy match - work entirely in normalized space
  const fuzzy = buildFuzzyIndex(content);
  const fuzzyContent = fuzzy.text;
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);

  if (fuzzyIndex === -1) {
    return {
      found: false,
      index: -1,
      matchLength: 0,
      usedFuzzyMatch: false,
      contentForReplacement: content,
    };
  }

  const firstSpan = fuzzy.spans[fuzzyIndex];
  const lastSpan = fuzzy.spans[fuzzyIndex + fuzzyOldText.length - 1];
  if (!firstSpan || !lastSpan) {
    return {
      found: false,
      index: -1,
      matchLength: 0,
      usedFuzzyMatch: false,
      contentForReplacement: content,
    };
  }
  return {
    found: true,
    index: firstSpan.start,
    matchLength: lastSpan.end - firstSpan.start,
    usedFuzzyMatch: true,
    contentForReplacement: content,
  };
}

/** Strip UTF-8 BOM if present, return both the BOM (if any) and the text without it */
export function stripBom(content: string): { bom: string; text: string } {
  return content.startsWith("\uFEFF")
    ? { bom: "\uFEFF", text: content.slice(1) }
    : { bom: "", text: content };
}

function countOccurrences(content: string, oldText: string): number {
  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  return fuzzyContent.split(fuzzyOldText).length - 1;
}

function getNotFoundError(path: string, editIndex: number, totalEdits: number): Error {
  if (totalEdits === 1) {
    return new Error(
      `Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`,
    );
  }
  return new Error(
    `Could not find edits[${editIndex}] in ${path}. The oldText must match exactly including all whitespace and newlines.`,
  );
}

function getDuplicateError(
  path: string,
  editIndex: number,
  totalEdits: number,
  occurrences: number,
): Error {
  if (totalEdits === 1) {
    return new Error(
      `Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`,
    );
  }
  return new Error(
    `Found ${occurrences} occurrences of edits[${editIndex}] in ${path}. Each oldText must be unique. Please provide more context to make it unique.`,
  );
}

function getEmptyOldTextError(path: string, editIndex: number, totalEdits: number): Error {
  if (totalEdits === 1) {
    return new Error(`oldText must not be empty in ${path}.`);
  }
  return new Error(`edits[${editIndex}].oldText must not be empty in ${path}.`);
}

function getNoChangeError(path: string, totalEdits: number): Error {
  if (totalEdits === 1) {
    return new Error(
      `No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`,
    );
  }
  return new Error(`No changes made to ${path}. The replacements produced identical content.`);
}

/**
 * Apply one or more exact-text replacements to LF-normalized content.
 *
 * All edits are matched against the same original content. Replacements are
 * then applied in reverse order so offsets remain stable. If any edit needs
 * fuzzy matching, the operation runs in fuzzy-normalized content space to
 * preserve current single-edit behavior.
 */
export function applyEditsToNormalizedContent(
  normalizedContent: string,
  edits: Edit[],
  path: string,
): AppliedEditsResult {
  const normalizedEdits = edits.map((edit) => ({
    oldText: normalizeToLF(edit.oldText),
    newText: normalizeToLF(edit.newText),
  }));

  for (let i = 0; i < normalizedEdits.length; i++) {
    if (normalizedEdits[i].oldText.length === 0) {
      throw getEmptyOldTextError(path, i, normalizedEdits.length);
    }
  }

  const baseContent = normalizedContent;

  const matchedEdits: MatchedEdit[] = [];
  for (let i = 0; i < normalizedEdits.length; i++) {
    const edit = normalizedEdits[i];
    const matchResult = fuzzyFindText(baseContent, edit.oldText);
    if (!matchResult.found) {
      throw getNotFoundError(path, i, normalizedEdits.length);
    }

    const occurrences = countOccurrences(baseContent, edit.oldText);
    if (occurrences > 1) {
      throw getDuplicateError(path, i, normalizedEdits.length, occurrences);
    }

    matchedEdits.push({
      editIndex: i,
      matchIndex: matchResult.index,
      matchLength: matchResult.matchLength,
      newText: edit.newText,
    });
  }

  matchedEdits.sort((a, b) => a.matchIndex - b.matchIndex);
  for (let i = 1; i < matchedEdits.length; i++) {
    const previous = matchedEdits[i - 1];
    const current = matchedEdits[i];
    if (previous.matchIndex + previous.matchLength > current.matchIndex) {
      throw new Error(
        `edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${path}. Merge them into one edit or target disjoint regions.`,
      );
    }
  }

  let newContent = baseContent;
  for (let i = matchedEdits.length - 1; i >= 0; i--) {
    const edit = matchedEdits[i];
    newContent =
      newContent.slice(0, edit.matchIndex) +
      edit.newText +
      newContent.slice(edit.matchIndex + edit.matchLength);
  }

  if (baseContent === newContent) {
    throw getNoChangeError(path, normalizedEdits.length);
  }

  return { baseContent, newContent };
}

/** Generate a standard unified patch. */
export function generateUnifiedPatch(
  path: string,
  oldContent: string,
  newContent: string,
  contextLines = 4,
  fileStatus: "modified" | "added" | "deleted" = "modified",
): string {
  if (fileStatus === "deleted") {
    return Diff.createTwoFilesPatch(
      path,
      "/dev/null",
      oldContent,
      newContent,
      undefined,
      undefined,
      { context: contextLines, headerOptions: Diff.FILE_HEADERS_ONLY },
    );
  }
  if (fileStatus === "added" && newContent.length === 0) {
    const quotePath = (value: string): string =>
      /[\s"\\]/u.test(value) ? JSON.stringify(value) : value;
    return [
      `diff --git ${quotePath(`a/${path}`)} ${quotePath(`b/${path}`)}`,
      "new file mode 100644",
      "index 0000000..e69de29",
    ].join("\n");
  }
  return Diff.createTwoFilesPatch(
    fileStatus === "added" ? "/dev/null" : path,
    path,
    oldContent,
    newContent,
    undefined,
    undefined,
    {
    context: contextLines,
    headerOptions: Diff.FILE_HEADERS_ONLY,
    },
  );
}

/**
 * Generate a display-oriented diff string with line numbers and context.
 * Returns both the diff string and the first changed line number (in the new file).
 */
export function generateDiffString(
  oldContent: string,
  newContent: string,
  contextLines = 4,
): { diff: string; firstChangedLine: number | undefined } {
  const parts = Diff.diffLines(oldContent, newContent);
  const output: string[] = [];

  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const maxLineNum = Math.max(oldLines.length, newLines.length);
  const lineNumWidth = String(maxLineNum).length;

  let oldLineNum = 1;
  let newLineNum = 1;
  let lastWasChange = false;
  let firstChangedLine: number | undefined;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const raw = part.value.split("\n");
    if (raw[raw.length - 1] === "") {
      raw.pop();
    }

    if (part.added || part.removed) {
      // Capture the first changed line (in the new file)
      if (firstChangedLine === undefined) {
        firstChangedLine = newLineNum;
      }

      // Show the change
      for (const line of raw) {
        if (part.added) {
          const lineNum = String(newLineNum).padStart(lineNumWidth, " ");
          output.push(`+${lineNum} ${line}`);
          newLineNum++;
        } else {
          // removed
          const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
          output.push(`-${lineNum} ${line}`);
          oldLineNum++;
        }
      }
      lastWasChange = true;
    } else {
      // Context lines - only show a few before/after changes
      const nextPartIsChange = i < parts.length - 1 && (parts[i + 1].added || parts[i + 1].removed);
      const hasLeadingChange = lastWasChange;
      const hasTrailingChange = nextPartIsChange;

      if (hasLeadingChange && hasTrailingChange) {
        if (raw.length <= contextLines * 2) {
          for (const line of raw) {
            const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
            output.push(` ${lineNum} ${line}`);
            oldLineNum++;
            newLineNum++;
          }
        } else {
          const leadingLines = raw.slice(0, contextLines);
          const trailingLines = raw.slice(raw.length - contextLines);
          const skippedLines = raw.length - leadingLines.length - trailingLines.length;

          for (const line of leadingLines) {
            const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
            output.push(` ${lineNum} ${line}`);
            oldLineNum++;
            newLineNum++;
          }

          output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
          oldLineNum += skippedLines;
          newLineNum += skippedLines;

          for (const line of trailingLines) {
            const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
            output.push(` ${lineNum} ${line}`);
            oldLineNum++;
            newLineNum++;
          }
        }
      } else if (hasLeadingChange) {
        const shownLines = raw.slice(0, contextLines);
        const skippedLines = raw.length - shownLines.length;

        for (const line of shownLines) {
          const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
          output.push(` ${lineNum} ${line}`);
          oldLineNum++;
          newLineNum++;
        }

        if (skippedLines > 0) {
          output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
          oldLineNum += skippedLines;
          newLineNum += skippedLines;
        }
      } else if (hasTrailingChange) {
        const skippedLines = Math.max(0, raw.length - contextLines);
        if (skippedLines > 0) {
          output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
          oldLineNum += skippedLines;
          newLineNum += skippedLines;
        }

        for (const line of raw.slice(skippedLines)) {
          const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
          output.push(` ${lineNum} ${line}`);
          oldLineNum++;
          newLineNum++;
        }
      } else {
        // Skip these context lines entirely
        oldLineNum += raw.length;
        newLineNum += raw.length;
      }

      lastWasChange = false;
    }
  }

  return { diff: output.join("\n"), firstChangedLine };
}

export interface EditDiffResult {
  diff: string;
  firstChangedLine: number | undefined;
}

export interface EditDiffError {
  error: string;
}

export interface EditDiffOperations {
  readFile: (absolutePath: string) => Promise<Buffer | string>;
  access: (absolutePath: string) => Promise<void>;
}

/**
 * Compute the diff for one or more edit operations without applying them.
 * Used for preview rendering in the TUI before the tool executes.
 */
export async function computeEditsDiff(
  path: string,
  edits: Edit[],
  cwd: string,
  operations?: EditDiffOperations,
): Promise<EditDiffResult | EditDiffError> {
  const absolutePath = resolveToCwd(path, cwd);

  try {
    // Check if file exists and is readable
    try {
      if (operations) {
        await operations.access(absolutePath);
      } else {
        await access(absolutePath, constants.R_OK);
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error && "code" in error
          ? `Error code: ${String(error.code)}`
          : String(error);
      return { error: `Could not edit file: ${path}. ${errorMessage}.` };
    }

    // Read the file
    const rawContentResult = operations
      ? await operations.readFile(absolutePath)
      : await readFile(absolutePath, "utf-8");
    const rawContent =
      typeof rawContentResult === "string" ? rawContentResult : rawContentResult.toString("utf-8");

    // Strip BOM before matching (LLM won't include invisible BOM in oldText)
    const { text: content } = stripBom(rawContent);
    const normalizedContent = normalizeToLF(content);
    const { baseContent, newContent } = applyEditsToNormalizedContent(
      normalizedContent,
      edits,
      path,
    );

    // Generate the diff
    return generateDiffString(baseContent, newContent);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Compute the diff for a single edit operation without applying it.
 * Kept as a convenience wrapper for single-edit callers.
 */
export async function computeEditDiff(
  path: string,
  oldText: string,
  newText: string,
  cwd: string,
): Promise<EditDiffResult | EditDiffError> {
  return computeEditsDiff(path, [{ oldText, newText }], cwd);
}
