/**
 * C2-5: post-write incremental diagnostics (type-level, not parse-level).
 * Timeout 2s fuse; findings attach to tool result; timeout is silent.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { codingObservability } from "../context-engine/coding-observability.js";
import { languageForPath } from "../context-engine/producers/ripgrep-producer.js";

export const POST_WRITE_DIAG_TIMEOUT_MS = 2000;

export type DiagFinding = {
  file: string;
  message: string;
  code?: number;
};

export type DiagResult =
  | { ok: true; findings: DiagFinding[]; timedOut?: false }
  | { ok: false; timedOut: true; findings: DiagFinding[] };

const IGNORED_CODES = new Set([
  2318, // Cannot find global type (noLib noise)
  2304, // Cannot find name (ambient missing)
  2583,
  2584,
]);

/**
 * Lightweight single-file TypeScript check using transpile diagnostics +
 * a simple annotation mismatch heuristic (no full project graph).
 */
export function diagnoseTypeScriptFile(params: {
  workspaceRoot: string;
  relPath: string;
  content?: string;
}): DiagFinding[] {
  const abs = path.isAbsolute(params.relPath)
    ? path.resolve(params.relPath)
    : path.resolve(params.workspaceRoot, params.relPath);
  const rel = path.relative(path.resolve(params.workspaceRoot), abs).replace(/\\/g, "/");
  let content = params.content;
  if (content === undefined) {
    try {
      content = readFileSync(abs, "utf8");
    } catch {
      return [];
    }
  }

  const findings: DiagFinding[] = [];
  const transpile = ts.transpileModule(content, {
    reportDiagnostics: true,
    fileName: rel || params.relPath,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      strict: true,
      noEmit: true,
    },
  });
  for (const d of transpile.diagnostics ?? []) {
    if (d.category !== ts.DiagnosticCategory.Error) continue;
    if (d.code !== undefined && IGNORED_CODES.has(d.code)) continue;
    findings.push({
      file: rel || params.relPath,
      message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
      code: d.code,
    });
  }

  // Heuristic type mismatch: `const x: number = 'string'` style
  const mismatch =
    /:\s*(number|boolean|string|void|null|undefined|object|any)\s*=\s*('[^']*'|"[^"]*"|`[^`]*`|\d+|true|false)/g;
  let m: RegExpExecArray | null;
  while ((m = mismatch.exec(content)) !== null) {
    const annotated = m[1];
    const value = m[2] ?? "";
    const valueIsString = value.startsWith("'") || value.startsWith('"') || value.startsWith("`");
    const valueIsNumber = /^\d/.test(value);
    const valueIsBool = value === "true" || value === "false";
    let bad = false;
    if (annotated === "number" && !valueIsNumber) bad = true;
    if (annotated === "string" && !valueIsString) bad = true;
    if (annotated === "boolean" && !valueIsBool) bad = true;
    if (bad) {
      findings.push({
        file: rel || params.relPath,
        message: `Type annotation '${annotated}' is incompatible with assigned value ${value}`,
        code: 2322,
      });
    }
  }

  return findings;
}

export async function diagnoseFileWithTimeout(params: {
  workspaceRoot: string;
  relPath: string;
  content?: string;
  timeoutMs?: number;
}): Promise<DiagResult> {
  const language = languageForPath(params.relPath);
  if (language !== "typescript" && language !== "javascript") {
    return { ok: true, findings: [] };
  }
  const timeoutMs = params.timeoutMs ?? POST_WRITE_DIAG_TIMEOUT_MS;
  if (timeoutMs <= 0) {
    return { ok: false, timedOut: true, findings: [] };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raced = await Promise.race([
      Promise.resolve().then(() =>
        diagnoseTypeScriptFile({
          workspaceRoot: params.workspaceRoot,
          relPath: params.relPath,
          content: params.content,
        }),
      ),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
      }),
    ]);
    if (raced === "timeout") {
      return { ok: false, timedOut: true, findings: [] };
    }
    return { ok: true, findings: raced };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function attachDiagToResult<T extends { details?: unknown }>(
  result: T,
  findings: DiagFinding[],
): T {
  if (findings.length === 0) return result;
  const prev =
    result.details && typeof result.details === "object" && !Array.isArray(result.details)
      ? (result.details as Record<string, unknown>)
      : {};
  codingObservability.recordDiagHit();
  return {
    ...result,
    details: {
      ...prev,
      diag: findings.slice(0, 20).map((f) => ({
        file: f.file,
        message: f.message,
        code: f.code,
      })),
      diag_summary: findings
        .slice(0, 3)
        .map((f) => f.message)
        .join("; ")
        .slice(0, 400),
    },
  };
}
