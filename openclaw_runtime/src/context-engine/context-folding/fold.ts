/**
 * Context folding (CF-03 / TF-0693).
 *
 * Pure request/result plumbing around a single real sessions_spawn child. The
 * parent handle is never sent to the child unchanged: each input ref is
 * re-scoped to the child session first. The child is asked for one JSON
 * ContextFoldResult, and only the validated, budgeted projection may reach the
 * parent. No transcript, tool log or raw child completion belongs here.
 */
import { createHash } from "node:crypto";
import {
  CONTEXT_FOLDING_LIMITS,
  CONTEXT_FOLD_RESULT_SCHEMA,
  ContextFoldingValidationError,
  normalizeContextFoldRequest,
  normalizeContextFoldResult,
  projectContextFoldResultForParent,
  rescopeContextHandleForChild,
  stableStringifyContextFolding,
  type ContextFoldRequest,
  type ContextFoldResult,
  type ContextHandle,
  type ContextHashFn,
  type ContextRequesterIdentity,
} from "../../../../shared/types/context-folding.js";

export const contextFoldHash: ContextHashFn = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");

export type ContextFoldChildIdentity = {
  childRunId: string;
  childSessionKey: string;
};

export type ContextFoldPrepareInput = {
  request: unknown;
  parent: ContextRequesterIdentity;
  parentRunId?: string;
  hash?: ContextHashFn;
};

export type ContextFoldPrepareResult = {
  request: ContextFoldRequest;
  childHandles: ContextHandle[];
  childTask: string;
};

export type ContextFoldParseInput = {
  request: ContextFoldRequest;
  child: ContextFoldChildIdentity;
  /** Handles actually issued to the child, not the parent's originals. */
  childHandles: readonly ContextHandle[];
  output: string;
  deliveryId: string;
  latencyMs: number;
  maxChars?: number;
};

export type ContextFoldParseResult =
  | { ok: true; result: ContextFoldResult; chars: number; truncated: boolean }
  | { ok: false; diagnostic: { code: "invalid_result" | "raw_transcript_rejected" | "child_identity_mismatch" | "duplicate_delivery" | "unknown_delivery"; message: string } };

function fail(code: "invalid_request" | "child_identity_mismatch" | "invalid_result" | "recursion_depth_exceeded", message: string): never {
  throw new ContextFoldingValidationError(message, [{ code, message }]);
}

/** The parent identity is always the executing session; runId is bound explicitly. */
export function assertContextFoldParentIdentity(input: ContextFoldPrepareInput): void {
  const request = normalizeContextFoldRequest(input.request, { hash: input.hash ?? contextFoldHash });
  if (request.parentRunIdentity.workspaceId !== input.parent.workspaceId) {
    fail("invalid_request", "foldRequest.parentRunIdentity.workspaceId does not match the executing workspace");
  }
  if (request.parentRunIdentity.sessionId !== input.parent.sessionId) {
    fail("invalid_request", "foldRequest.parentRunIdentity.sessionId does not match the executing session");
  }
  if (input.parent.depth !== 0) fail("recursion_depth_exceeded", "context_fold is only available at depth 0");
  if (input.parentRunId && request.parentRunIdentity.runId && request.parentRunIdentity.runId !== input.parentRunId) {
    fail("invalid_request", "foldRequest.parentRunIdentity.runId does not match the executing run");
  }
}

/**
 * The child receives only explicitly re-scoped handles. Every evidence-bearing
 * selector and checksum remains the same; only the scope and handle id change.
 */
export function prepareContextFold(input: ContextFoldPrepareInput): ContextFoldPrepareResult {
  assertContextFoldParentIdentity(input);
  const request = normalizeContextFoldRequest(input.request, { hash: input.hash ?? contextFoldHash });
  const child: { sessionId: string; sessionKey?: ContextRequesterIdentity["sessionKey"] } = {
    sessionId: `pending:${request.foldId}`,
  };
  const childHandles = request.inputRefs.map((handle) => rescopeContextHandleForChild(handle, child, { hash: input.hash ?? contextFoldHash }));
  if (request.tokenBudget * 4 < request.maxResultChars) {
    fail("invalid_request", "foldRequest.tokenBudget is too small for maxResultChars");
  }
  const childTask = buildContextFoldChildTask(request, childHandles);
  return { request, childHandles, childTask };
}

export function bindContextFoldChildHandles(params: {
  request: ContextFoldRequest;
  childSessionId: string;
  childSessionKey: string;
  hash?: ContextHashFn;
}): ContextHandle[] {
  return params.request.inputRefs.map((handle) => rescopeContextHandleForChild(handle, {
    sessionId: params.childSessionId,
    sessionKey: params.childSessionKey as ContextRequesterIdentity["sessionKey"],
  }, { hash: params.hash ?? contextFoldHash }));
}

/** A single bounded child instruction; it contains handles, not source text. */
export function buildContextFoldChildTask(request: ContextFoldRequest, childHandles: readonly ContextHandle[]): string {
  const schema = request.outputSchema.kind === "json-object"
    ? `Return one JSON object. Required keys: ${request.outputSchema.required.join(", ") || "(none)"}.`
    : "Return a plain bounded text result.";
  return [
    "You are a context-folding child. Work only inside the declared scope and tools.",
    "",
    `Objective: ${request.objective}`,
    `Workspace ID: ${request.taskScope.workspaceId}`,
    ...(request.taskScope.workspaceRoot ? [`Workspace root: ${request.taskScope.workspaceRoot}`] : []),
    ...(request.taskScope.allowedPaths?.length ? [`Allowed paths: ${request.taskScope.allowedPaths.join(", ")}`] : ["Allowed paths: inferred from the input handles only."]),
    `Allowed tools: ${request.allowedTools.join(", ") || "(read-only evidence inspection only)"}`,
    `Maximum returned output: ${request.maxResultChars} characters. Budget: ${request.tokenBudget} tokens. Timeout: ${request.timeoutMs} ms.`,
    "",
    "Input handles (already scoped to this child):",
    ...childHandles.map((handle) => `- ${handle.handleId}: owner=${handle.owner}; resource=${handle.resourceId}; selector=${handle.selector.kind}; checksum=${handle.checksum}; chars=${handle.estimatedChars}`),
    "",
    "Use the declared tools to inspect the handles. Do not copy a transcript or tool log into the result.",
    "The only parent-visible result is a ContextFoldResult/v1 JSON object with these fields:",
    `${CONTEXT_FOLD_RESULT_SCHEMA}: foldId, childSessionKey, childRunId, status, summary, structuredOutput, evidenceRefs, unresolvedClaims, blockers, failedAttempts, inputRefs, outputChars, usage, diagnostics, rawChildTranscriptChars, recursionDepth, deliveryId, drivenBy, actor.`,
    schema,
    "Use status completed only when evidence is sufficient; otherwise use partial, timeout, cancelled, failed or unknown and explain why.",
    "Do not write Task Ledger, Memory, Knowledge, product defaults, permissions, or task completion state.",
  ].join("\n");
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1]!.trim() : trimmed;
}

function parseJsonObject(output: string): Record<string, unknown> {
  const text = stripCodeFence(output);
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("result must be a JSON object");
    return parsed as Record<string, unknown>;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) fail("invalid_result", "child output is not a valid ContextFoldResult JSON object");
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("result must be a JSON object");
      return parsed as Record<string, unknown>;
    } catch {
      fail("invalid_result", "child output is not a valid ContextFoldResult JSON object");
    }
  }
}

/**
 * Parse the child's single JSON response. Identity must match the actual run,
 * evidence and input refs must be the child's, and the result is projected
 * before it can be shown to the parent.
 */
export function parseContextFoldChildOutput(input: ContextFoldParseInput): ContextFoldParseResult {
  const outputChars = input.output.length;
  if (outputChars > CONTEXT_FOLDING_LIMITS.rawChildTranscriptMaxChars) {
    return {
      ok: false,
      diagnostic: {
        code: "raw_transcript_rejected",
        message: `child output is ${outputChars} chars; context_fold accepts at most ${CONTEXT_FOLDING_LIMITS.rawChildTranscriptMaxChars}`,
      },
    };
  }
  let result: ContextFoldResult;
  try {
    const parsed = parseJsonObject(input.output);
    result = normalizeContextFoldResult(parsed);
  } catch (error) {
    if (error instanceof ContextFoldingValidationError) {
      const issue = error.issues[0];
      const code = issue?.code === "raw_transcript_rejected" ? "raw_transcript_rejected" : "invalid_result";
      return { ok: false, diagnostic: { code, message: code === "raw_transcript_rejected" ? "child result claimed raw transcript content" : "child output is not a valid ContextFoldResult" } };
    }
    return { ok: false, diagnostic: { code: "invalid_result", message: "child output is not a valid ContextFoldResult" } };
  }
  if (result.foldId !== input.request.foldId) {
    return { ok: false, diagnostic: { code: "unknown_delivery", message: "child result was not addressed to this fold request" } };
  }
  if (result.childRunId !== input.child.childRunId || result.childSessionKey !== input.child.childSessionKey) {
    return { ok: false, diagnostic: { code: "child_identity_mismatch", message: "child result identity does not match the spawned run" } };
  }
  const allowed = new Set(input.childHandles.map((handle) => handle.handleId));
  if (result.inputRefs.some((handleId) => !allowed.has(handleId))) return { ok: false, diagnostic: { code: "unknown_delivery", message: "child result was not addressed to this fold request" } };
  if (result.rawChildTranscriptChars > 0) return { ok: false, diagnostic: { code: "raw_transcript_rejected", message: "child result claims raw transcript bytes" } };
  if (result.recursionDepth > CONTEXT_FOLDING_LIMITS.maxRecursiveDepth) return { ok: false, diagnostic: { code: "unknown_delivery", message: "child result exceeded recursion depth" } };
  const projection = projectContextFoldResultForParent(result, { maxChars: Math.min(input.maxChars ?? input.request.maxResultChars, input.request.maxResultChars) });
  return {
    ok: true,
    result: projection.projection,
    chars: projection.chars,
    truncated: projection.truncated,
  };
}

/** A deterministic delivery id binds one child run, fold and payload. */
export function contextFoldDeliveryId(input: { foldId: string; childRunId: string; hash?: ContextHashFn }): string {
  return `cfd_${(input.hash ?? contextFoldHash)(stableStringifyContextFolding({ foldId: input.foldId, childRunId: input.childRunId })).slice(0, 32)}`;
}