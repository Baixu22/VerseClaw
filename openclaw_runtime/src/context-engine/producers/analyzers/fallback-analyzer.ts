// Adapted from ragcode-context-engine (MIT), https://github.com/MarshallEriksen-Neura/ragcode
// Source: src/indexing/analyzers/fallback-analyzer.ts (verbatim; import paths localized).
import type { CodeChunk, CodeFile, GraphEdge, SymbolNode } from "../../fact-types.js";
import { sha256, stableId } from "../hash.js";
import type { AnalyzeFileInput, FileAnalysis, LanguageAnalyzer } from "./types.js";

export const fallbackAnalyzer: LanguageAnalyzer = {
  language: "unknown",
  capabilities: [],
  analyzeFile: ({ repoRoot, file, content }) => fallbackFileAnalysis(repoRoot, file, content)
};

export function fallbackFileAnalysis(
  repoRoot: string,
  file: CodeFile,
  content: string,
  existingFileSymbol?: SymbolNode,
  existingEdges: GraphEdge[] = []
): FileAnalysis {
  const lines = content.split(/\r?\n/);
  const fileSymbol = existingFileSymbol ?? createFileSymbol(repoRoot, file, lines.length);
  const chunks: CodeChunk[] = [];
  for (const span of chunkSpansForFile(file.language, lines)) {
    const start = span.start;
    const end = span.end;
    const chunkContent = lines.slice(start, end).join("\n");
    if (!chunkContent.trim()) continue;
    chunks.push({
      id: stableId([repoRoot, file.path, start + 1, end, sha256(chunkContent)]),
      projectId: file.projectId,
      repoRoot,
      filePath: file.path,
      language: file.language,
      kind: "block" as const,
      startLine: start + 1,
      endLine: end,
      content: chunkContent,
      contentHash: sha256(chunkContent)
    });
  }
  return { chunks, symbols: [fileSymbol], edges: existingEdges };
}

interface LineSpan {
  start: number;
  end: number;
}

function chunkSpansForFile(language: CodeFile["language"], lines: string[]): LineSpan[] {
  if (lines.length === 0) return [];
  if (language === "markdown") return markdownSpans(lines);
  if (language === "xml") return xmlSpans(lines);
  if (language === "swift" || language === "kotlin" || language === "gradle") return braceAwareSpans(lines, language);
  return fixedLineSpans(lines, 80);
}

function markdownSpans(lines: string[]): LineSpan[] {
  const starts = [0];
  let fence: string | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const marker = markdownFenceMarker(line);
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
    }
    if (!fence && index > 0 && /^#{1,6}\s+\S/.test(line)) starts.push(index);
  }
  return spansFromStarts(starts, lines.length, 120, (start, preferredEnd, hardEnd) => markdownSafeCutLine(lines, start, preferredEnd, hardEnd));
}

function xmlSpans(lines: string[]): LineSpan[] {
  const spans: LineSpan[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < lines.length; index += 1) {
    depth += xmlDepthDelta(lines[index] ?? "");
    const lineCount = index - start + 1;
    if ((depth <= 0 && lineCount > 1) || lineCount >= 120) {
      spans.push({ start, end: index + 1 });
      start = index + 1;
      depth = 0;
    }
  }
  if (start < lines.length) spans.push({ start, end: lines.length });
  return spans.length > 0 ? spans : fixedLineSpans(lines, 80);
}

function braceAwareSpans(lines: string[], language: CodeFile["language"]): LineSpan[] {
  const spans: LineSpan[] = [];
  let start = 0;
  let depth = 0;
  let inBlock = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const startsBlock = isBraceBoundary(line, language);
    if (!inBlock && startsBlock && index > start) {
      spans.push(...fixedLineSpans(lines.slice(start, index), 80).map((span) => ({ start: span.start + start, end: span.end + start })));
      start = index;
    }
    if (startsBlock) inBlock = true;
    depth += braceDelta(line, language);
    const lineCount = index - start + 1;
    const canCloseBlock = inBlock && depth <= 0 && lineCount > 1;
    const shouldHardSplit = !inBlock && lineCount >= 140;
    const oversizedStructuredBlock = inBlock && lineCount >= 260 && depth <= 1;
    if (canCloseBlock || shouldHardSplit || oversizedStructuredBlock) {
      spans.push({ start, end: index + 1 });
      start = index + 1;
      inBlock = false;
      depth = 0;
    }
  }
  if (start < lines.length) spans.push(...fixedLineSpans(lines.slice(start), 80).map((span) => ({ start: span.start + start, end: span.end + start })));
  return spans.length > 0 ? spans : fixedLineSpans(lines, 80);
}

function fixedLineSpans(lines: string[], size: number): LineSpan[] {
  const spans: LineSpan[] = [];
  for (let start = 0; start < lines.length; start += size) {
    spans.push({ start, end: Math.min(lines.length, start + size) });
  }
  return spans;
}

function spansFromStarts(
  starts: number[],
  lineCount: number,
  maxLines: number,
  safeCutLine: (start: number, preferredEnd: number, hardEnd: number) => number = (_start, preferredEnd) => preferredEnd
): LineSpan[] {
  const spans: LineSpan[] = [];
  const sorted = [...new Set(starts)].sort((a, b) => a - b);
  for (let index = 0; index < sorted.length; index += 1) {
    const start = sorted[index] ?? 0;
    const end = sorted[index + 1] ?? lineCount;
    for (let cursor = start; cursor < end;) {
      const preferredEnd = Math.min(end, cursor + maxLines);
      const safeEnd = safeCutLine(cursor, preferredEnd, end);
      spans.push({ start: cursor, end: safeEnd });
      cursor = safeEnd;
    }
  }
  return spans;
}

function isBraceBoundary(line: string, language: CodeFile["language"]): boolean {
  if (language === "gradle") return /^\s*(plugins|android|dependencies|repositories|subprojects|allprojects|tasks)\b.*\{/.test(line);
  if (language === "swift") return /^\s*(public\s+|private\s+|internal\s+|open\s+)?(class|struct|enum|protocol|extension|func)\b.*\{/.test(line);
  return /^\s*(class|object|interface|fun|val|var)\b.*\{/.test(line);
}

function braceDelta(line: string, language: CodeFile["language"]): number {
  const stripped = stripCodeLineForBraceScan(line, language);
  return (stripped.match(/\{/g)?.length ?? 0) - (stripped.match(/\}/g)?.length ?? 0);
}

function stripCodeLineForBraceScan(line: string, language: CodeFile["language"]): string {
  let output = "";
  let quote: string | undefined;
  let escaping = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    const next = line[index + 1];
    if (!quote && char === "/" && next === "/") break;
    if (!quote && language === "swift" && char === "#") break;
    if (!quote && (char === "\"" || char === "'" || char === "`")) {
      quote = char;
      output += " ";
      continue;
    }
    if (quote) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === quote) {
        quote = undefined;
      }
      output += " ";
      continue;
    }
    output += char;
  }
  return output;
}

function markdownFenceMarker(line: string): string | undefined {
  return /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
}

function markdownSafeCutLine(lines: string[], start: number, preferredEnd: number, hardEnd: number): number {
  const openFence = openMarkdownFenceBetween(lines, start, preferredEnd);
  if (!openFence) return preferredEnd;
  for (let index = preferredEnd; index < hardEnd; index += 1) {
    const marker = markdownFenceMarker(lines[index] ?? "");
    if (marker && marker[0] === openFence[0] && marker.length >= openFence.length) return index + 1;
  }
  return hardEnd;
}

function openMarkdownFenceBetween(lines: string[], start: number, end: number): string | undefined {
  let open: string | undefined;
  for (let index = start; index < end; index += 1) {
    const marker = markdownFenceMarker(lines[index] ?? "");
    if (!marker) continue;
    if (!open) open = marker;
    else if (marker[0] === open[0] && marker.length >= open.length) open = undefined;
  }
  return open;
}

function xmlDepthDelta(line: string): number {
  const withoutComments = line.replace(/<!--.*?-->/g, "");
  const tags = withoutComments.match(/<\/?[^!?][^>]*>/g) ?? [];
  let delta = 0;
  for (const tag of tags) {
    if (/^<\//.test(tag)) delta -= 1;
    else if (!/\/>$/.test(tag)) delta += 1;
  }
  return delta;
}

export function createFileSymbol(repoRoot: string, file: CodeFile, lineCount: number): SymbolNode {
  return {
    id: stableId([repoRoot, file.path, "file"]),
    projectId: file.projectId,
    filePath: file.path,
    name: file.path,
    kind: "file",
    language: file.language,
    startLine: 1,
    endLine: Math.max(1, lineCount)
  };
}

export function analyzeFallbackFile(input: AnalyzeFileInput): FileAnalysis {
  return fallbackFileAnalysis(input.repoRoot, input.file, input.content);
}
