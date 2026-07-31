// Ripgrep producer (T0): thin wrapper around `rg --json` that maps text hits to
// CodeChunk facts (kind "block"). Locally written for the context-engine rebuild
// (SPEC §5.2); always available, no parsing required.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { CodeChunk, LanguageId } from "../fact-types.js";
import { resolveExecutablePath } from "../../infra/executable-path.js";
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
  diagnostics: RipgrepSearchDiagnostics;
  error?: string;
}

/**
 * Bounded execution facts for the T0 fallback. In particular, Windows reports
 * whether `rg.exe` resolved from PATH instead of collapsing a launch failure
 * into an indistinguishable empty search result.
 */
export interface RipgrepSearchDiagnostics {
  executable: string;
  /**
   * `path` is a normal PATH/PATHEXT resolution, `codex-path` is the local
   * Windows Codex bundle used by the desktop agent harness, and `bare` means
   * process spawning must still resolve `rg` itself.
   */
  executableResolution: "path" | "codex-path" | "bare";
  exitCode?: number;
  signal?: NodeJS.Signals;
  stdoutLines: number;
  matchEvents: number;
  unmappedMatchEvents: number;
  malformedEvents: number;
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
  const executable = resolveRipgrepExecutable();
  const executableLabel = path.basename(executable.executable) || executable.executable;

  return new Promise((resolve) => {
    const child = spawn(executable.executable, args, { cwd: repoRoot, windowsHide: true });
    const chunks: CodeChunk[] = [];
    let truncated = false;
    let stderr = "";
    let buffered = "";
    let settled = false;
    let exitCode: number | undefined;
    let exitSignal: NodeJS.Signals | undefined;
    let stdoutLines = 0;
    let matchEvents = 0;
    let unmappedMatchEvents = 0;
    let malformedEvents = 0;

    const timer = setTimeout(() => {
      truncated = true;
      child.kill();
    }, timeoutMs);

    const diagnostics = (): RipgrepSearchDiagnostics => ({
      ...executable,
      ...(exitCode === undefined ? {} : { exitCode }),
      ...(exitSignal === undefined ? {} : { signal: exitSignal }),
      stdoutLines,
      matchEvents,
      unmappedMatchEvents,
      malformedEvents,
    });

    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ chunks, truncated, diagnostics: diagnostics(), ...(error ? { error } : {}) });
    };

    const consumeLine = (rawLine: string) => {
      const line = rawLine.trim();
      if (!line) return;
      stdoutLines += 1;
      const event = parseRipgrepEvent(line, repoRoot, options.projectId);
      if (event.kind === "malformed") {
        malformedEvents += 1;
        return;
      }
      if (event.kind === "match") matchEvents += 1;
      if (event.kind === "unmapped-match") {
        matchEvents += 1;
        unmappedMatchEvents += 1;
        return;
      }
      if (event.kind !== "match") return;
      if (chunks.length >= maxMatches) {
        truncated = true;
        child.kill();
        return;
      }
      chunks.push(event.chunk);
    };

    const consumeBufferedLines = (flush = false) => {
      let newlineIndex = buffered.indexOf("\n");
      while (newlineIndex !== -1) {
        consumeLine(buffered.slice(0, newlineIndex));
        buffered = buffered.slice(newlineIndex + 1);
        newlineIndex = buffered.indexOf("\n");
      }
      if (flush && buffered.trim()) {
        consumeLine(buffered);
        buffered = "";
      }
    };

    child.stdout.on("data", (data: Buffer) => {
      buffered += data.toString("utf8");
      consumeBufferedLines();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString("utf8");
    });
    child.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      finish(`ripgrep failed to start (${executableLabel}): ${message}`);
    });
    child.on("close", (code, signal) => {
      consumeBufferedLines(true);
      exitCode = code ?? undefined;
      exitSignal = signal ?? undefined;
      // rg exits 1 on "no matches", which is a valid empty result.
      if (!truncated && code !== 0 && code !== 1) {
        const detail = stderr.trim();
        finish(
          detail
            ? `ripgrep exited with code ${code ?? "null"} (executable=${executableLabel}): ${detail}`
            : `ripgrep exited with code ${code ?? "null"}${signal ? ` (signal ${signal})` : ""} without diagnostics (executable=${executableLabel})`,
        );
        return;
      }
      // With a search expression, ripgrep reports code 0 only if it found a
      // match. Treat an unparseable/missing mapped result as a failure, never a
      // successful empty fallback; code 1 remains the normal no-match path.
      if (!truncated && code === 0 && chunks.length === 0) {
        const detail =
          matchEvents > 0
            ? `ripgrep emitted ${matchEvents} match event(s), but none could be mapped to text facts`
            : malformedEvents > 0
              ? `ripgrep emitted ${malformedEvents} unparseable output line(s) instead of JSON match events`
              : "ripgrep exited successfully without emitting match events";
        finish(`${detail} (executable=${executableLabel})`);
        return;
      }
      finish();
    });
  });
}

export function resolveRipgrepExecutable(params: {
  /** Test seam for the Windows resolver; production defaults to the process. */
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  resolvePath?: typeof resolveExecutablePath;
  pathExists?: (filePath: string) => boolean;
} = {}): Pick<
  RipgrepSearchDiagnostics,
  "executable" | "executableResolution"
> {
  const platform = params.platform ?? process.platform;
  const env = params.env ?? process.env;
  const resolvePath = params.resolvePath ?? resolveExecutablePath;
  if (platform !== "win32") {
    return { executable: "rg", executableResolution: "bare" };
  }

  // Prefer a complete path from the actual PATH/PATHEXT resolver.  Check both
  // spellings: shells can expose `rg` through PATHEXT even when `rg.exe` was
  // not present in the inherited environment snapshot.
  const resolved =
    resolvePath("rg.exe", { env }) ??
    resolvePath("rg", { env });
  if (resolved) {
    return { executable: resolved, executableResolution: "path" };
  }

  // `pnpm exec` intentionally narrows PATH on Windows.  When this code runs
  // inside the Codex desktop agent harness, its signed/managed ripgrep binary
  // is still available at this stable absolute location.  Record that source
  // explicitly rather than treating an ENOENT as an empty search result.
  const localAppData = env.LOCALAPPDATA?.trim();
  const codexRipgrep = localAppData
    ? path.win32.join(localAppData, "OpenAI", "Codex", "bin", "rg.exe")
    : undefined;
  if (codexRipgrep && (params.pathExists ?? existsSync)(codexRipgrep)) {
    return { executable: codexRipgrep, executableResolution: "codex-path" };
  }

  // Leave the standard command spelling intact for Node's Windows resolver.
  // If it is still unavailable, the spawn error is returned to callers as a
  // declared failure; it never becomes a successful no-match response.
  return { executable: "rg", executableResolution: "bare" };
}

type RipgrepEvent =
  | { kind: "other" }
  | { kind: "malformed" }
  | { kind: "unmapped-match" }
  | { kind: "match"; chunk: CodeChunk };

function parseRipgrepEvent(line: string, repoRoot: string, projectId: string): RipgrepEvent {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return { kind: "malformed" };
  }
  if (!event || typeof event !== "object") return { kind: "other" };
  const record = event as { type?: string; data?: RipgrepMatchData };
  if (record.type !== "match") return { kind: "other" };
  if (!record.data) return { kind: "unmapped-match" };
  const filePathText = record.data.path?.text;
  const lineNumber = record.data.line_number;
  const lineText = record.data.lines?.text;
  if (!filePathText || typeof lineNumber !== "number" || typeof lineText !== "string") {
    return { kind: "unmapped-match" };
  }

  const relativePath = normalizeRelativePath(filePathText);
  const content = lineText.replace(/\r?\n$/, "");
  return {
    kind: "match",
    chunk: {
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
    },
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
