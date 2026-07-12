import { readdir, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { listRoleContracts } from "../../agents/role-registry.js";
import { parseClawGraphWorkflowYaml } from "../../agents/clawgraph/compiler.js";
import {
  abortClawGraphRun,
  getClawGraphRunEvents,
  getClawGraphRunStatus,
  reviewClawGraphRun,
  startClawGraphRun,
} from "../../agents/clawgraph/runtime.js";
import type { ClawGraphReviewDecision, ClawGraphRunEvent, ClawGraphRunSnapshot } from "../../agents/clawgraph/types.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
// [SPINE] Diagnostic-only API handler telemetry; responses remain unchanged.
import { eventBus, shadowSafetyBoundary } from "../../runtime-spine/index.js";
import type { GatewayRequestContext, GatewayRequestHandlers, RespondFn } from "./types.js";

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const next = Math.floor(value);
  return next > 0 ? next : undefined;
}

function rolesConfig(cfg: OpenClawConfig): { agents?: { roles?: unknown; teams?: unknown } } {
  return cfg as unknown as { agents?: { roles?: unknown; teams?: unknown } };
}

function availableRuntimeRoles(context: GatewayRequestContext): string[] {
  return listRoleContracts(rolesConfig(context.getRuntimeConfig())).map((role) => role.name);
}

function respondInvalid(respond: RespondFn, message: string): void {
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
}

// [SPINE] Parameter summaries avoid recording workflow YAML, session keys, and reason text.
function summarizeClawGraphParams(params: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    keys: Object.keys(params).sort(),
  };
  const workflowYaml = typeof params.workflowYaml === "string" ? params.workflowYaml : undefined;
  if (workflowYaml !== undefined) {
    summary.workflowYaml = {
      present: workflowYaml.length > 0,
      length: workflowYaml.length,
      lineCount: workflowYaml.length > 0 ? workflowYaml.split(/\r\n|\r|\n/u).length : 0,
    };
  }
  const sessionKey = readString(params.sessionKey) ?? readString(params.key);
  if (sessionKey) {
    summary.sessionKey = { present: true };
  }
  const reason = typeof params.reason === "string" ? params.reason : undefined;
  if (reason !== undefined) {
    summary.reason = {
      present: reason.trim().length > 0,
      length: reason.length,
    };
  }
  const sourcePath = readString(params.sourcePath);
  if (sourcePath) {
    summary.sourcePath = {
      present: true,
      basename: basename(sourcePath),
    };
  }
  if (readString(params.workspaceRoot)) {
    summary.workspaceRoot = { present: true };
  }
  for (const key of ["workspaceId", "agentId", "runId", "reviewId", "decision"] as const) {
    const value = readString(params[key]);
    if (value) {
      summary[key] = value;
    }
  }
  const limit = readPositiveInteger(params.limit);
  if (limit !== undefined) {
    summary.limit = limit;
  }
  return summary;
}

// [SPINE] Emit gateway method diagnostics before returning without changing response shape.
function emitClawGraphApiDiagnostic(method: string, params: Record<string, unknown>, outcome: Record<string, unknown>): void {
  try {
    shadowSafetyBoundary.execute(`clawgraph.api.${method}`, () => {
      eventBus.emit(
        "diagnostic_record",
        readString(params.runId) ?? `clawgraph-api:${method}`,
        "clawgraph_run",
        { sourceId: "clawgraph-api", sourceType: "diagnostic", stage: method },
        {
          mode: "diagnostic_only",
          method,
          params: summarizeClawGraphParams(params),
          outcome,
        },
      );
    });
  } catch {
    // Diagnostic-only emission must not affect gateway method responses.
  }
}

function resolveInsideWorkspace(workspaceRoot: string, candidate: string): string | null {
  const root = resolve(workspaceRoot);
  const target = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate);
  const rel = relative(root, target);
  if (rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel))) {
    return target;
  }
  return null;
}

async function listWorkflowFiles(workspaceRoot: string | undefined) {
  if (!workspaceRoot) return [];
  const root = resolve(workspaceRoot);
  const workflowDir = join(root, ".clawx", "clawgraph");
  const rel = relative(root, workflowDir);
  if (rel.startsWith("..") || isAbsolute(rel)) return [];
  let entries;
  try {
    entries = await readdir(workflowDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = extname(entry.name).toLowerCase();
    if (extension !== ".yaml" && extension !== ".yml") continue;
    const path = join(workflowDir, entry.name);
    const info = await stat(path).catch(() => null);
    files.push({
      name: entry.name,
      path,
      relativePath: relative(root, path).split("\\").join("/"),
      ...(info ? { size: info.size, mtime: info.mtimeMs } : {}),
    });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

function lifecycleBroadcaster(context: GatewayRequestContext) {
  return (event: ClawGraphRunEvent, snapshot: ClawGraphRunSnapshot) => {
    try {
      context.broadcast("clawgraph-lifecycle", { event, snapshot }, { dropIfSlow: true });
    } catch {
      // Broadcasts are best-effort; run events remain available through clawgraph.events.
    }
  };
}

function compileFromParams(params: Record<string, unknown>, context: GatewayRequestContext) {
  const workflowYaml = readString(params.workflowYaml);
  if (!workflowYaml) {
    return null;
  }
  return parseClawGraphWorkflowYaml(workflowYaml, {
    sourcePath: readString(params.sourcePath),
    availableRuntimeRoles: availableRuntimeRoles(context),
  });
}

export const clawGraphHandlers: GatewayRequestHandlers = {
  "clawgraph.listWorkflows": async ({ params, respond }) => {
    const workspaceRoot = readString(params.workspaceRoot);
    const workflows = await listWorkflowFiles(workspaceRoot);
    // [SPINE] API diagnostics are emitted before returning the unchanged response.
    emitClawGraphApiDiagnostic("clawgraph.listWorkflows", params, {
      ok: true,
      available: true,
      workflowCount: workflows.length,
    });
    respond(true, {
      available: true,
      workflows,
      workspaceRoot: workspaceRoot ?? null,
    }, undefined);
  },

  "clawgraph.compile": async ({ params, respond, context }) => {
    const result = compileFromParams(params, context);
    if (!result) {
      // [SPINE] Invalid requests are reported with redacted parameter summaries.
      emitClawGraphApiDiagnostic("clawgraph.compile", params, {
        ok: false,
        errorCode: ErrorCodes.INVALID_REQUEST,
        reason: "missing_workflowYaml",
      });
      respondInvalid(respond, 'clawgraph.compile requires "workflowYaml"');
      return;
    }
    // [SPINE] Compile result diagnostics never alter the compiler response.
    emitClawGraphApiDiagnostic("clawgraph.compile", params, {
      ok: true,
      compileOk: result.ok,
      diagnosticCount: result.diagnostics.length,
      hasIr: Boolean(result.ir),
    });
    respond(true, result, undefined);
  },

  "clawgraph.run": async ({ params, respond, context }) => {
    const sessionKey = readString(params.sessionKey) ?? readString(params.key);
    if (!sessionKey) {
      // [SPINE] Invalid run requests are diagnostic-only.
      emitClawGraphApiDiagnostic("clawgraph.run", params, {
        ok: false,
        errorCode: ErrorCodes.INVALID_REQUEST,
        reason: "missing_sessionKey",
      });
      respondInvalid(respond, 'clawgraph.run requires "sessionKey"');
      return;
    }
    const compile = compileFromParams(params, context);
    if (!compile) {
      // [SPINE] Missing workflow YAML is reported without recording YAML payloads.
      emitClawGraphApiDiagnostic("clawgraph.run", params, {
        ok: false,
        errorCode: ErrorCodes.INVALID_REQUEST,
        reason: "missing_workflowYaml",
      });
      respondInvalid(respond, 'clawgraph.run requires "workflowYaml"');
      return;
    }
    if (!compile.ok || !compile.ir) {
      // [SPINE] Compile failure is a successful handler response with null snapshot.
      emitClawGraphApiDiagnostic("clawgraph.run", params, {
        ok: true,
        available: true,
        compileOk: compile.ok,
        diagnosticCount: compile.diagnostics.length,
        snapshot: null,
      });
      respond(true, { available: true, compile, snapshot: null }, undefined);
      return;
    }
    const workspaceRoot = readString(params.workspaceRoot);
    const sourcePath = readString(params.sourcePath);
    if (workspaceRoot && sourcePath && !resolveInsideWorkspace(workspaceRoot, sourcePath)) {
      // [SPINE] Source path violations report only the basename.
      emitClawGraphApiDiagnostic("clawgraph.run", params, {
        ok: false,
        errorCode: ErrorCodes.INVALID_REQUEST,
        reason: "sourcePath_outside_workspace",
        sourcePathBasename: basename(sourcePath),
      });
      respondInvalid(respond, `sourcePath is outside workspace: ${basename(sourcePath)}`);
      return;
    }
    try {
      const snapshot = await startClawGraphRun({
        ir: compile.ir,
        sessionKey,
        workspaceId: readString(params.workspaceId) ?? null,
        agentId: readString(params.agentId),
        workspaceRoot,
        lifecycle: lifecycleBroadcaster(context),
      });
      // [SPINE] Successful run responses keep the existing payload shape.
      emitClawGraphApiDiagnostic("clawgraph.run", params, {
        ok: true,
        available: true,
        compileOk: compile.ok,
        snapshotStatus: snapshot.status,
        runId: snapshot.runId,
      });
      respond(true, { available: true, compile, snapshot }, undefined);
    } catch (error) {
      // [SPINE] Handler failures are reported without changing error response shape.
      emitClawGraphApiDiagnostic("clawgraph.run", params, {
        ok: false,
        errorCode: ErrorCodes.UNAVAILABLE,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `clawgraph.run failed: ${error instanceof Error ? error.message : String(error)}`),
      );
    }
  },

  "clawgraph.status": async ({ params, respond, context }) => {
    const runId = readString(params.runId);
    if (!runId) {
      // [SPINE] Invalid status requests are diagnostic-only.
      emitClawGraphApiDiagnostic("clawgraph.status", params, {
        ok: false,
        errorCode: ErrorCodes.INVALID_REQUEST,
        reason: "missing_runId",
      });
      respondInvalid(respond, 'clawgraph.status requires "runId"');
      return;
    }
    const snapshot = await getClawGraphRunStatus(runId, lifecycleBroadcaster(context));
    if (!snapshot) {
      // [SPINE] Unknown runs are reported without altering the error response.
      emitClawGraphApiDiagnostic("clawgraph.status", params, {
        ok: false,
        errorCode: ErrorCodes.INVALID_REQUEST,
        reason: "unknown_run",
      });
      respondInvalid(respond, `unknown ClawGraph run "${runId}"`);
      return;
    }
    // [SPINE] Status response shape remains authoritative.
    emitClawGraphApiDiagnostic("clawgraph.status", params, {
      ok: true,
      available: true,
      snapshotStatus: snapshot.status,
      runId: snapshot.runId,
    });
    respond(true, { available: true, snapshot }, undefined);
  },

  "clawgraph.events": async ({ params, respond }) => {
    const runId = readString(params.runId);
    if (!runId) {
      // [SPINE] Invalid events requests are diagnostic-only.
      emitClawGraphApiDiagnostic("clawgraph.events", params, {
        ok: false,
        errorCode: ErrorCodes.INVALID_REQUEST,
        reason: "missing_runId",
      });
      respondInvalid(respond, 'clawgraph.events requires "runId"');
      return;
    }
    const events = getClawGraphRunEvents(runId, readPositiveInteger(params.limit));
    if (!events) {
      // [SPINE] Unknown run event lookups do not change response shape.
      emitClawGraphApiDiagnostic("clawgraph.events", params, {
        ok: false,
        errorCode: ErrorCodes.INVALID_REQUEST,
        reason: "unknown_run",
      });
      respondInvalid(respond, `unknown ClawGraph run "${runId}"`);
      return;
    }
    // [SPINE] Events response remains unchanged.
    emitClawGraphApiDiagnostic("clawgraph.events", params, {
      ok: true,
      available: true,
      eventCount: events.length,
      runId,
    });
    respond(true, { available: true, events }, undefined);
  },

  "clawgraph.abort": async ({ params, respond, context }) => {
    const runId = readString(params.runId);
    if (!runId) {
      // [SPINE] Invalid abort requests are diagnostic-only.
      emitClawGraphApiDiagnostic("clawgraph.abort", params, {
        ok: false,
        errorCode: ErrorCodes.INVALID_REQUEST,
        reason: "missing_runId",
      });
      respondInvalid(respond, 'clawgraph.abort requires "runId"');
      return;
    }
    const snapshot = abortClawGraphRun(runId, readString(params.reason), lifecycleBroadcaster(context));
    if (!snapshot) {
      // [SPINE] Unknown run aborts are diagnostic-only.
      emitClawGraphApiDiagnostic("clawgraph.abort", params, {
        ok: false,
        errorCode: ErrorCodes.INVALID_REQUEST,
        reason: "unknown_run",
      });
      respondInvalid(respond, `unknown ClawGraph run "${runId}"`);
      return;
    }
    // [SPINE] Abort response shape remains unchanged.
    emitClawGraphApiDiagnostic("clawgraph.abort", params, {
      ok: true,
      available: true,
      snapshotStatus: snapshot.status,
      runId: snapshot.runId,
    });
    respond(true, { available: true, snapshot }, undefined);
  },

  "clawgraph.review": async ({ params, respond, context }) => {
    const runId = readString(params.runId);
    const reviewId = readString(params.reviewId);
    const decision = readString(params.decision);
    if (!runId || !reviewId || (decision !== "approve" && decision !== "reject")) {
      // [SPINE] Invalid review requests are diagnostic-only.
      emitClawGraphApiDiagnostic("clawgraph.review", params, {
        ok: false,
        errorCode: ErrorCodes.INVALID_REQUEST,
        reason: "invalid_review_request",
      });
      respondInvalid(respond, 'clawgraph.review requires "runId", "reviewId", and decision "approve" or "reject"');
      return;
    }
    const snapshot = await reviewClawGraphRun({
      runId,
      reviewId,
      decision: decision as ClawGraphReviewDecision,
      reason: readString(params.reason),
      lifecycle: lifecycleBroadcaster(context),
    });
    if (!snapshot) {
      // [SPINE] Unknown run reviews are diagnostic-only.
      emitClawGraphApiDiagnostic("clawgraph.review", params, {
        ok: false,
        errorCode: ErrorCodes.INVALID_REQUEST,
        reason: "unknown_run",
      });
      respondInvalid(respond, `unknown ClawGraph run "${runId}"`);
      return;
    }
    // [SPINE] Review response shape remains unchanged.
    emitClawGraphApiDiagnostic("clawgraph.review", params, {
      ok: true,
      available: true,
      snapshotStatus: snapshot.status,
      runId: snapshot.runId,
      decision,
    });
    respond(true, { available: true, snapshot }, undefined);
  },
};
