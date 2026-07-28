/**
 * C2 write-side composition: parse-on-write touch + post-write syntax check.
 * Applied after successful edit/write/apply_patch.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { codingObservability } from "../context-engine/coding-observability.js";
import type { Materializer } from "../context-engine/factstore/materialize.js";
import { getToolParamsRecord } from "./agent-tools.params.js";
import type { AnyAgentTool } from "./agent-tools.types.js";
import {
  attachSyntaxCheckToResult,
  checkFileSyntaxWithTimeout,
  formatSyntaxCheckFailed,
  recordSyntaxCheckMetric,
} from "./post-write-parse-check.js";
import {
  attachDiagToResult,
  diagnoseFileWithTimeout,
} from "./post-write-diag.js";
import { extractPatchTargetPaths } from "./tools/write-journal.js";
import { toFactRelPath } from "./fact-rel-path.js";
import { detectTestRunner, formatTestRunnerDetection } from "./test-runner-detect.js";
import { reviewDiff } from "../context-engine/views/verify/review-diff-view.js";
import type { FactStore } from "../context-engine/factstore/store.js";

export type WriteSideEffectsOptions = {
  workspaceRoot: string;
  materializer?: Pick<Materializer, "onFileTouched">;
  factStore?: FactStore;
  /** C2-1 parse-on-write (default true when materializer present). */
  parseOnWriteEnabled?: boolean;
  /** C2-9 syntax check (default true). */
  syntaxCheckEnabled?: boolean;
  syntaxTimeoutMs?: number;
  /** C2-5 incremental type diag (default true). */
  diagEnabled?: boolean;
  diagTimeoutMs?: number;
  /** C2-3: attach related-tests verify evidence after write (default true when factStore present). */
  verifyConsumeEnabled?: boolean;
  /** FP-P1-04: attach project test-runner detection after write (default true). */
  testRunnerDetectEnabled?: boolean;
};

function collectTargetPaths(toolName: string, args: unknown, result: unknown): string[] {
  const record = getToolParamsRecord(args);
  if (toolName === "apply_patch") {
    const fromArgs =
      typeof record?.input === "string" ? extractPatchTargetPaths(record.input) : [];
    if (fromArgs.length > 0) {
      return fromArgs;
    }
    const details =
      result && typeof result === "object" && "details" in result
        ? (result as { details?: { summary?: { added?: string[]; modified?: string[]; deleted?: string[] } } })
            .details
        : undefined;
    const summary = details?.summary;
    if (summary) {
      return [
        ...(summary.added ?? []),
        ...(summary.modified ?? []),
        ...(summary.deleted ?? []),
      ];
    }
    return [];
  }
  if (typeof record?.path === "string" && record.path.trim()) {
    return [record.path];
  }
  return [];
}

function touchPaths(
  paths: string[],
  workspaceRoot: string,
  materializer: Pick<Materializer, "onFileTouched">,
): void {
  for (const filePath of paths) {
    const rel = toFactRelPath(filePath, workspaceRoot);
    if (!rel) {
      continue;
    }
    const started = performance.now();
    materializer.onFileTouched(rel);
    codingObservability.recordTouchLatency(performance.now() - started);
    codingObservability.recordParseOnWriteHit();
  }
}

export function wrapToolWithWriteSideEffects(
  tool: AnyAgentTool,
  options: WriteSideEffectsOptions,
): AnyAgentTool {
  const parseOnWrite =
    options.parseOnWriteEnabled !== false && Boolean(options.materializer);
  const syntaxCheck = options.syntaxCheckEnabled !== false;
  const diagEnabled = options.diagEnabled !== false;
  const verifyConsume =
    options.verifyConsumeEnabled !== false && Boolean(options.factStore);
  const testRunnerDetect = options.testRunnerDetectEnabled !== false;
  if (!parseOnWrite && !syntaxCheck && !diagEnabled && !verifyConsume && !testRunnerDetect) {
    return tool;
  }

  return {
    ...tool,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const result = await tool.execute(toolCallId, args, signal, onUpdate);
      const paths = collectTargetPaths(tool.name, args, result);
      if (paths.length === 0) {
        return result;
      }

      if (parseOnWrite && options.materializer) {
        touchPaths(paths, options.workspaceRoot, options.materializer);
      }

      // C2-9: parse-level syntax check (optional)
      let nextResult = result;
      if (syntaxCheck) {
        let lastFailure: string | undefined;
        for (const filePath of paths) {
          const abs = path.isAbsolute(filePath)
            ? path.resolve(filePath)
            : path.resolve(options.workspaceRoot, filePath);
          let content: string | undefined;
          try {
            content = readFileSync(abs, "utf8");
          } catch {
            // deleted or missing ? skip syntax
            continue;
          }
          const check = await checkFileSyntaxWithTimeout({
            workspaceRoot: options.workspaceRoot,
            relPath: filePath,
            content,
            timeoutMs: options.syntaxTimeoutMs,
          });
          if (check === null) {
            // timeout: silent
            recordSyntaxCheckMetric(false);
            continue;
          }
          if (!check.ok) {
            lastFailure = formatSyntaxCheckFailed(check.message);
            recordSyntaxCheckMetric(true);
          } else {
            recordSyntaxCheckMetric(false);
          }
        }
        if (lastFailure) {
          nextResult = attachSyntaxCheckToResult(nextResult, lastFailure);
        }
      }

      // C2-5: type-level diag (distinct from C2-9 parse syntax)
      if (diagEnabled) {
        for (const filePath of paths) {
          const abs = path.isAbsolute(filePath)
            ? path.resolve(filePath)
            : path.resolve(options.workspaceRoot, filePath);
          let content: string | undefined;
          try {
            content = readFileSync(abs, "utf8");
          } catch {
            continue;
          }
          const diag = await diagnoseFileWithTimeout({
            workspaceRoot: options.workspaceRoot,
            relPath: filePath,
            content,
            timeoutMs: options.diagTimeoutMs,
          });
          if (diag.timedOut) {
            codingObservability.recordDiagSilent();
            continue;
          }
          if (diag.findings.length > 0) {
            nextResult = attachDiagToResult(nextResult, diag.findings);
          } else {
            codingObservability.recordDiagSilent();
          }
        }
      }

      // C2-3: verify consume (related tests) — sync attach, fail-open
      if (verifyConsume && options.factStore && paths.length > 0) {
        try {
          const changedFiles = paths
            .map((p) => toFactRelPath(p, options.workspaceRoot) ?? p)
            .filter(Boolean);
          const review = reviewDiff(options.factStore, options.workspaceRoot, {
            changedFiles,
          });
          const related = review.relatedTests ?? [];
          if (related.length > 0) {
            const prev =
              nextResult.details &&
              typeof nextResult.details === "object" &&
              !Array.isArray(nextResult.details)
                ? (nextResult.details as Record<string, unknown>)
                : {};
            nextResult = {
              ...nextResult,
              details: {
                ...prev,
                verify_consume: {
                  relatedTests: related.slice(0, 12),
                  riskLevel: review.riskLevel,
                },
              },
            };
            codingObservability.recordVerifyConsumeHit();
          }
        } catch {
          // fail-open
        }
      }

      // FP-P1-04 verify段: say which test command applies — or why none
      // does. A skip must be explainable, never silence that reads as "passed".
      if (testRunnerDetect) {
        try {
          const detection = detectTestRunner(options.workspaceRoot);
          const prev =
            nextResult.details &&
            typeof nextResult.details === "object" &&
            !Array.isArray(nextResult.details)
              ? (nextResult.details as Record<string, unknown>)
              : {};
          nextResult = {
            ...nextResult,
            details: {
              ...prev,
              verify_tests: {
                ...detection,
                rendered: formatTestRunnerDetection(detection),
              },
            },
          };
          codingObservability.recordTestRunnerDetect(detection.detected);
        } catch {
          // fail-open: detection must never break a successful write
        }
      }

      // FP-P1-04 diff段 + verify段 visibility. `details` is stripped from chat
      // history by the gateway projection (chat-display-projection.ts deletes
      // it), so evidence that only lives there never reaches the user — an
      // `edit` would render as nothing but "Successfully replaced 1 block(s)".
      // `content` survives the projection, so append it there.
      nextResult = appendCodingEvidenceToContent(nextResult);
      return nextResult;
    },
  };
}

const WRITE_DIFF_MAX_CHARS = 4000;

/**
 * Append the diff, syntax check, and test-runner verdict to the tool result's
 * text content so the coding loop's diff段/verify段 are visible in the product,
 * not just in `details` (which chat history drops).
 */
function appendCodingEvidenceToContent<T extends { details?: unknown; content?: unknown }>(
  result: T,
): T {
  const details =
    result.details && typeof result.details === "object" && !Array.isArray(result.details)
      ? (result.details as Record<string, unknown>)
      : undefined;
  if (!details) {
    return result;
  }
  const sections: string[] = [];
  const diff = typeof details.diff === "string" ? details.diff : "";
  if (diff.trim().length > 0) {
    const body =
      diff.length > WRITE_DIFF_MAX_CHARS
        ? `${diff.slice(0, WRITE_DIFF_MAX_CHARS)}\n...(diff truncated)...`
        : diff;
    sections.push(`diff:\n${body}`);
  }
  if (typeof details.syntax_check === "string") {
    sections.push(`syntax_check: ${details.syntax_check}`);
  }
  const verifyTests =
    details.verify_tests && typeof details.verify_tests === "object"
      ? (details.verify_tests as Record<string, unknown>)
      : undefined;
  if (typeof verifyTests?.rendered === "string") {
    sections.push(`verify_tests: ${verifyTests.rendered}`);
  }
  if (sections.length === 0) {
    return result;
  }
  const block = { type: "text" as const, text: sections.join("\n") };
  const content = Array.isArray(result.content) ? [...result.content, block] : [block];
  return { ...result, content };
}
