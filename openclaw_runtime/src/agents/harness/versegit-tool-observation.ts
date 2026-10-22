import { createHash } from "node:crypto";
import type { AgentToolResultMiddlewareEvent } from "../../plugins/agent-tool-result-middleware-types.js";
import {
  VG_TOOL_BASIS_SCHEMA,
  type VerseGitBindingRecord,
  type VerseGitToolBasis,
  type VerseGitToolObservationRequest,
  type VerseGitToolObservationStatus,
} from "../../../../shared/versegit-runtime-contract.js";

function stable(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map((item) => stable(item, seen)).join(",")}]`;
  if (value && typeof value === "object") {
    if (seen.has(value)) return '"[circular]"';
    seen.add(value);
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key], seen)}`);
    return `{${fields.join(",")}}`;
  }
  return "null";
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stable(value)).digest("hex")}`;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function sanitizeBasis(value: unknown): VerseGitToolBasis | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const basis = value as Record<string, unknown>;
  if (basis.schema !== VG_TOOL_BASIS_SCHEMA) return undefined;
  if (basis.kind !== "read" && basis.kind !== "write" && basis.kind !== "edit") return undefined;
  if (typeof basis.path !== "string" || !basis.path.trim() || basis.path.length > 500) return undefined;
  if (!Number.isInteger(basis.lineStart) || Number(basis.lineStart) < 1) return undefined;
  if (!Number.isInteger(basis.lineEnd) || Number(basis.lineEnd) < Number(basis.lineStart)) return undefined;
  const hashes = ["fileSha256", "rangeSha256", "beforeSha256", "afterSha256"] as const;
  for (const key of hashes) {
    const candidate = basis[key];
    if (candidate !== undefined && candidate !== null && !isSha256(candidate)) return undefined;
  }
  return {
    schema: VG_TOOL_BASIS_SCHEMA,
    kind: basis.kind,
    path: basis.path.trim(),
    lineStart: Number(basis.lineStart),
    lineEnd: Number(basis.lineEnd),
    ...(basis.fileSha256 === null || isSha256(basis.fileSha256) ? { fileSha256: basis.fileSha256 as string | null } : {}),
    ...(basis.rangeSha256 === null || isSha256(basis.rangeSha256) ? { rangeSha256: basis.rangeSha256 as string | null } : {}),
    ...(basis.beforeSha256 === null || isSha256(basis.beforeSha256) ? { beforeSha256: basis.beforeSha256 as string | null } : {}),
    ...(basis.afterSha256 === null || isSha256(basis.afterSha256) ? { afterSha256: basis.afterSha256 as string | null } : {}),
    ...(typeof basis.truncated === "boolean" ? { truncated: basis.truncated } : {}),
  };
}

function toolStatus(event: AgentToolResultMiddlewareEvent): VerseGitToolObservationStatus {
  const details = event.result.details && typeof event.result.details === "object"
    ? event.result.details as Record<string, unknown>
    : {};
  const status = typeof details.status === "string" ? details.status.toLowerCase() : "";
  if (status.includes("cancel") || status.includes("abort")) return "cancelled";
  if (status.includes("timeout") || status.includes("timed")) return "timed-out";
  if (event.isError === true || status === "error" || status === "failed") return "failed";
  return status === "" || status === "ok" || status === "success" || status === "succeeded" ? "succeeded" : "unknown";
}

export function deriveVerseGitToolObservationRequest(params: {
  event: AgentToolResultMiddlewareEvent;
  binding: VerseGitBindingRecord;
  cwd: string;
}): VerseGitToolObservationRequest {
  const args: Record<string, unknown> = {};
  for (const key of ["path", "file_path", "offset", "limit", "pattern", "glob"] as const) {
    const value = params.event.args[key];
    if (typeof value === "string" || typeof value === "number") args[key] = value;
  }
  const details = params.event.result.details && typeof params.event.result.details === "object"
    ? params.event.result.details as Record<string, unknown>
    : {};
  const basis = sanitizeBasis(details.versegit_basis);
  return {
    schema: "clawx.versegit.tool-observation-request/v1",
    bindingId: params.binding.bindingId,
    childRunId: params.binding.childRunId ?? "",
    toolCallId: params.event.toolCallId,
    toolName: params.event.toolName,
    status: toolStatus(params.event),
    args,
    cwd: params.cwd,
    inputDigest: digest(params.event.args),
    outputDigest: digest(params.event.result),
    ...(basis ? { basis } : {}),
    observedAt: new Date().toISOString(),
    ownerId: params.binding.ownerId,
    epoch: params.binding.epoch,
  };
}
