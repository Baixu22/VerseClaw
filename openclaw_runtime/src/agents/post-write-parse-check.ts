/**
 * C2-9: post-write parse integrity check (parse-level only).
 * Timeout 500ms; failures attach syntax_check to tool result details.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { codingObservability } from "../context-engine/coding-observability.js";
import type { CodeFile } from "../context-engine/fact-types.js";
import { analyzeFileWithRegistry } from "../context-engine/producers/analyzers/registry.js";
import { projectIdForRoot, sha256 } from "../context-engine/producers/hash.js";
import { languageForPath } from "../context-engine/producers/ripgrep-producer.js";

export const POST_WRITE_SYNTAX_TIMEOUT_MS = 500;

export type SyntaxCheckResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Run parse-level syntax check for a single file. Never throws.
 */
export function checkFileSyntax(params: {
  workspaceRoot: string;
  relPath: string;
  content?: string;
}): SyntaxCheckResult {
  const abs = path.isAbsolute(params.relPath)
    ? path.resolve(params.relPath)
    : path.resolve(params.workspaceRoot, params.relPath);
  const rel = path.relative(path.resolve(params.workspaceRoot), abs).replace(/\\/g, "/");
  let content = params.content;
  if (content === undefined) {
    try {
      content = readFileSync(abs, "utf8");
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  const language = languageForPath(rel || params.relPath);
  if (language === "unknown") {
    // Unsupported language: fallback only — never false-positive.
    return { ok: true };
  }

  if (language === "typescript" || language === "javascript") {
    const diag = checkTypeScriptSyntax(rel || params.relPath, content);
    if (diag) {
      return { ok: false, message: diag };
    }
    return { ok: true };
  }

  try {
    const repoRoot = path.resolve(params.workspaceRoot);
    const file: CodeFile = {
      projectId: projectIdForRoot(repoRoot),
      path: rel || params.relPath,
      absolutePath: abs,
      language,
      sizeBytes: Buffer.byteLength(content, "utf8"),
      contentHash: sha256(content),
      modifiedAtMs: Date.now(),
    };
    analyzeFileWithRegistry({ repoRoot, file, content });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function checkTypeScriptSyntax(filePath: string, content: string): string | undefined {
  const result = ts.transpileModule(content, {
    reportDiagnostics: true,
    fileName: filePath,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
    },
  });
  const diags = result.diagnostics ?? [];
  const pick =
    diags.find((d) => d.category === ts.DiagnosticCategory.Error && d.code < 2000) ??
    diags.find((d) => d.category === ts.DiagnosticCategory.Error);
  if (!pick) {
    return undefined;
  }
  return ts.flattenDiagnosticMessageText(pick.messageText, "\n");
}

/**
 * Race syntax check against timeout; silent on timeout.
 */
export async function checkFileSyntaxWithTimeout(params: {
  workspaceRoot: string;
  relPath: string;
  content?: string;
  timeoutMs?: number;
}): Promise<SyntaxCheckResult | null> {
  const timeoutMs = params.timeoutMs ?? POST_WRITE_SYNTAX_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() =>
        checkFileSyntax({
          workspaceRoot: params.workspaceRoot,
          relPath: params.relPath,
          content: params.content,
        }),
      ),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    return result;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function formatSyntaxCheckFailed(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim().slice(0, 200);
  return `failed(${compact})`;
}

export function attachSyntaxCheckToResult<T extends { details?: unknown; content?: unknown }>(
  result: T,
  syntax: string,
): T {
  const prevDetails =
    result.details && typeof result.details === "object" && !Array.isArray(result.details)
      ? (result.details as Record<string, unknown>)
      : {};
  return {
    ...result,
    details: {
      ...prevDetails,
      syntax_check: syntax,
    },
  };
}

export function recordSyntaxCheckMetric(hit: boolean): void {
  codingObservability.recordSyntaxCheck(hit);
}
