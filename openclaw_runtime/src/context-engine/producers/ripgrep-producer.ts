// Ripgrep producer (T0): thin wrapper around `rg --json` that maps text hits to
// CodeChunk facts (kind "block"). Locally written for the context-engine rebuild
// (SPEC §5.2); always available, no parsing required.
import { spawn } from "node:child_process";
import path from "node:path";
import type { CodeChunk, LanguageId } from "../fact-types.js";
import { sha256, stableId } from "./hash.js";

export interface RipgrepSearchOptions {
  projectId: string;
  /** Hard cap on emitted chunks so one broad query cannot flood the store. */
  maxMatches?: number;
  timeoutMs?: number;
  /** Extra rg args (e.g. ["-i"] or ["--glob", "*.ts"]). */
  extraArgs?: string[];
}

export interface RipgrepSearchResult {
  chunks: CodeChunk[];
  truncated: boolean;
  error?: string;
}

const DEFAULT_MAX_MATCHES = 200;
const DEFAULT_TIMEOUT_MS = 10_000;

const EXTENSION_LANGUAGE: Record<string, LanguageId> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".css": "css",
  ".md": "markdown",
  ".json": "json",
  ".swift": "swift",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".gradle": "gradle",
  ".xml": "xml",
};

export function languageForPath(filePath: string): LanguageId {
  return EXTENSION_LANGUAGE[path.extname(filePath).toLowerCase()] ?? "unknown";
}

/** Runs `rg --json <pattern> <repoRoot>` and maps match events to chunk facts. */
export function ripgrepSearch(
  pattern: string,
  repoRoot: string,
  options: RipgrepSearchOptions,
): Promise<RipgrepSearchResult> {
  const maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const args = ["--json", "--no-messages", ...(options.extraArgs ?? []), "-e", pattern, "."];

  return new Promise((resolve) => {
    const child = spawn("rg", args, { cwd: repoRoot, windowsHide: true });
    const chunks: CodeChunk[] = [];
    let truncated = false;
    let stderr = "";
    let buffered = "";
    let settled = false;

    const timer = setTimeout(() => {
      truncated = true;
      child.kill();
    }, timeoutMs);

    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ chunks, truncated, ...(error ? { error } : {}) });
    };

    child.stdout.on("data", (data: Buffer) => {
      buffered += data.toString("utf8");
      let newlineIndex = buffered.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffered.slice(0, newlineIndex).trim();
        buffered = buffered.slice(newlineIndex + 1);
        newlineIndex = buffered.indexOf("\n");
        if (!line) continue;
        const chunk = chunkFromRipgrepEvent(line, repoRoot, options.projectId);
        if (!chunk) continue;
        if (chunks.length >= maxMatches) {
          truncated = true;
          child.kill();
          return;
        }
        chunks.push(chunk);
      }
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString("utf8");
    });
    child.on("error", (error) => {
      finish(error instanceof Error ? error.message : String(error));
    });
    child.on("close", (code) => {
      // rg exits 1 on "no matches", which is a valid empty result.
      if (code !== null && code > 1 && stderr.trim()) {
        finish(stderr.trim());
        return;
      }
      finish();
    });
  });
}

function chunkFromRipgrepEvent(line: string, repoRoot: string, projectId: string): CodeChunk | undefined {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!event || typeof event !== "object") return undefined;
  const record = event as { type?: string; data?: RipgrepMatchData };
  if (record.type !== "match" || !record.data) return undefined;
  const filePathText = record.data.path?.text;
  const lineNumber = record.data.line_number;
  const lineText = record.data.lines?.text;
  if (!filePathText || typeof lineNumber !== "number" || typeof lineText !== "string") return undefined;

  const relativePath = normalizeRelativePath(filePathText);
  const content = lineText.replace(/\r?\n$/, "");
  return {
    id: stableId([repoRoot, relativePath, lineNumber, lineNumber, sha256(content)]),
    projectId,
    repoRoot,
    filePath: relativePath,
    language: languageForPath(relativePath),
    kind: "block",
    startLine: lineNumber,
    endLine: lineNumber,
    content,
    contentHash: sha256(content),
  };
}

interface RipgrepMatchData {
  path?: { text?: string };
  line_number?: number;
  lines?: { text?: string };
}

function normalizeRelativePath(filePath: string): string {
  const withoutDot = filePath.startsWith("./") || filePath.startsWith(".\\")
    ? filePath.slice(2)
    : filePath;
  return withoutDot.replaceAll("\\", "/");
}
