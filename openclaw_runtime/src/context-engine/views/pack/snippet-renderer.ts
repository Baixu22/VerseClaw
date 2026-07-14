// Adapted from ragcode-context-engine (MIT), https://github.com/MarshallEriksen-Neura/ragcode
// Source: src/context/snippet-renderer.ts (verbatim; import paths localized).
import type { ContextMode, ContextSnippet } from "../../fact-types.js";
import type { SearchHit } from "../retrieval/hybrid-retriever.js";
import { chooseExpansion } from "./expansion-policy.js";
import { skeletonizeChunk } from "./skeletonizer.js";

const FOCUS_WINDOW_LINES = 28;
const MAX_SNIPPET_LINES = 150;
const MAX_SNIPPET_CHARS = 8000;

export function renderSnippet(hit: SearchHit, query: string, mode: Exclude<ContextMode, "auto">): ContextSnippet {
  const originalLineCount = lineCount(hit.chunk.content);
  const decision = chooseExpansion(hit.chunk, query, mode);
  const rendered = renderContent(hit, decision.expansionLevel, decision.focusLine);
  const returnedLineCount = lineCount(rendered);

  return {
    filePath: hit.chunk.filePath,
    startLine: renderedStartLine(hit, decision.focusLine),
    endLine: renderedEndLine(hit, rendered, decision.focusLine),
    content: rendered,
    score: hit.score,
    reason: hit.reason,
    role: roleForHit(hit),
    expansionLevel: decision.expansionLevel,
    originalLineCount,
    returnedLineCount,
    elidedLineCount: Math.max(0, originalLineCount - returnedLineCount)
  };
}

function renderContent(hit: SearchHit, expansionLevel: ContextSnippet["expansionLevel"], focusLine?: number): string {
  let content: string;
  if (expansionLevel === "full_body") content = hit.chunk.content;
  else if (expansionLevel === "skeleton") content = skeletonizeChunk(hit.chunk);
  else if (expansionLevel === "file_card") content = fileCard(hit);
  else if (focusLine !== undefined) content = focusedWindow(hit.chunk.content, focusLine);
  else content = hit.chunk.content;

  return truncateContent(content, MAX_SNIPPET_LINES, MAX_SNIPPET_CHARS);
}

function truncateContent(content: string, maxLines: number, maxChars: number): string {
  const lines = content.split(/\r?\n/);
  if (lines.length <= maxLines && content.length <= maxChars) {
    return content;
  }

  const charLineLimit = lineLimitForChars(lines, maxChars);
  const targetLine = Math.max(1, Math.min(maxLines, charLineLimit));
  const boundaryLine = boundaryAwareCutLine(lines, targetLine);
  const fenceAware = fenceAwareCut(lines, boundaryLine, maxLines);
  const truncatedLines = lines.slice(0, fenceAware.cutLine);
  const omittedCount = lines.length - fenceAware.cutLine;
  const suffix = fenceAware.syntheticFenceClose
    ? [fenceAware.syntheticFenceClose, `... [truncated: +${omittedCount} lines]`]
    : [`... [truncated: +${omittedCount} lines]`];

  return assembleTruncatedContent(truncatedLines, suffix, maxChars);
}

function lineLimitForChars(lines: string[], maxChars: number): number {
  let used = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const next = used + lines[index]!.length + (index > 0 ? 1 : 0);
    if (next > maxChars) return Math.max(1, index);
    used = next;
  }
  return lines.length;
}

function boundaryAwareCutLine(lines: string[], targetLine: number): number {
  let bestCutLine = targetLine;
  for (let index = Math.max(0, targetLine - 10); index <= Math.min(lines.length - 1, targetLine + 10); index += 1) {
    const line = lines[index]?.trim() || "";
    if (line === "}" || line.startsWith("} ") || line === "};") {
      bestCutLine = index + 1;
      break;
    }
  }
  return bestCutLine;
}

function fenceAwareCut(lines: string[], preferredCutLine: number, maxLines: number): { cutLine: number; syntheticFenceClose?: string } {
  const openFence = openFenceAtCut(lines, preferredCutLine);
  if (!openFence) return { cutLine: preferredCutLine };
  const searchLimit = Math.min(lines.length, Math.max(preferredCutLine + 1, maxLines + 40));
  for (let index = preferredCutLine; index < searchLimit; index += 1) {
    const fence = markdownFenceLine(lines[index] ?? "");
    if (fence && fence.marker[0] === openFence.marker[0] && fence.marker.length >= openFence.marker.length) {
      return { cutLine: index + 1 };
    }
  }
  return { cutLine: preferredCutLine, syntheticFenceClose: openFence.marker };
}

function openFenceAtCut(lines: string[], cutLine: number): { marker: string } | undefined {
  let open: { marker: string } | undefined;
  for (let index = 0; index < cutLine; index += 1) {
    const fence = markdownFenceLine(lines[index] ?? "");
    if (!fence) continue;
    if (!open) {
      open = fence;
    } else if (fence.marker[0] === open.marker[0] && fence.marker.length >= open.marker.length) {
      open = undefined;
    }
  }
  return open;
}

function markdownFenceLine(line: string): { marker: string } | undefined {
  const match = /^\s*(`{3,}|~{3,})/.exec(line);
  return match ? { marker: match[1]! } : undefined;
}

function assembleTruncatedContent(lines: string[], suffix: string[], maxChars: number): string {
  const suffixText = suffix.join("\n");
  const separatorChars = lines.length > 0 && suffixText.length > 0 ? 1 : 0;
  const lineBudget = Math.max(0, maxChars - suffixText.length - separatorChars);
  const fitted = fitLinesToCharBudget(lines, lineBudget);
  return [...fitted, ...suffix].join("\n");
}

function fitLinesToCharBudget(lines: string[], maxChars: number): string[] {
  if (maxChars <= 0) return [];
  const fitted: string[] = [];
  let used = 0;
  for (const line of lines) {
    const separatorChars = fitted.length > 0 ? 1 : 0;
    const remaining = maxChars - used - separatorChars;
    if (remaining <= 0) break;
    if (line.length <= remaining) {
      fitted.push(line);
      used += separatorChars + line.length;
      continue;
    }
    const clipped = clipOversizedLine(line, remaining);
    if (clipped.length > 0) fitted.push(clipped);
    break;
  }
  return fitted;
}

function clipOversizedLine(line: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (line.length <= maxChars) return line;
  const marker = " ... [line truncated]";
  if (maxChars <= marker.length) return line.slice(0, maxChars);
  return `${line.slice(0, maxChars - marker.length)}${marker}`;
}

function focusedWindow(content: string, focusLine: number): string {
  const lines = content.split(/\r?\n/);
  const half = Math.floor(FOCUS_WINDOW_LINES / 2);
  const start = Math.max(0, focusLine - 1 - half);
  const end = Math.min(lines.length, start + FOCUS_WINDOW_LINES);
  const prefix = start > 0 ? ["..."] : [];
  const suffix = end < lines.length ? ["..."] : [];
  return [...prefix, ...lines.slice(start, end), ...suffix].join("\n");
}

function renderedStartLine(hit: SearchHit, focusLine?: number): number {
  if (focusLine === undefined) return hit.chunk.startLine;
  return hit.chunk.startLine + Math.max(0, focusLine - 1 - Math.floor(FOCUS_WINDOW_LINES / 2));
}

function renderedEndLine(hit: SearchHit, content: string, focusLine?: number): number {
  if (focusLine === undefined) return hit.chunk.startLine + Math.max(0, lineCount(content) - 1);
  return renderedStartLine(hit, focusLine) + Math.max(0, lineCount(content) - 1);
}

function fileCard(hit: SearchHit): string {
  return [
    `${hit.chunk.kind}: ${hit.chunk.symbolName ?? hit.chunk.filePath}`,
    `language: ${hit.chunk.language}`,
    `lines: ${hit.chunk.startLine}-${hit.chunk.endLine}`
  ].join("\n");
}

function roleForHit(hit: SearchHit): string {
  if (hit.chunk.symbolName) return `${hit.chunk.kind}: ${hit.chunk.symbolName}`;
  return `${hit.chunk.kind} evidence`;
}

function lineCount(content: string): number {
  return content.length === 0 ? 0 : content.split(/\r?\n/).length;
}
