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
    respond(true, {
      available: true,
      workflows: await listWorkflowFiles(workspaceRoot),
      workspaceRoot: workspaceRoot ?? null,
    }, undefined);
  },

  "clawgraph.compile": async ({ params, respond, context }) => {
    const result = compileFromParams(params, context);
    if (!result) {
      respondInvalid(respond, 'clawgraph.compile requires "workflowYaml"');
      return;
    }
    respond(true, result, undefined);
  },

  "clawgraph.run": async ({ params, respond, context }) => {
    const sessionKey = readString(params.sessionKey) ?? readString(params.key);
    if (!sessionKey) {
      respondInvalid(respond, 'clawgraph.run requires "sessionKey"');
      return;
    }
    const compile = compileFromParams(params, context);
    if (!compile) {
      respondInvalid(respond, 'clawgraph.run requires "workflowYaml"');
      return;
    }
    if (!compile.ok || !compile.ir) {
      respond(true, { available: true, compile, snapshot: null }, undefined);
      return;
    }
    const workspaceRoot = readString(params.workspaceRoot);
    const sourcePath = readString(params.sourcePath);
    if (workspaceRoot && sourcePath && !resolveInsideWorkspace(workspaceRoot, sourcePath)) {
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
      respond(true, { available: true, compile, snapshot }, undefined);
    } catch (error) {
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
      respondInvalid(respond, 'clawgraph.status requires "runId"');
      return;
    }
    const snapshot = await getClawGraphRunStatus(runId, lifecycleBroadcaster(context));
    if (!snapshot) {
      respondInvalid(respond, `unknown ClawGraph run "${runId}"`);
      return;
    }
    respond(true, { available: true, snapshot }, undefined);
  },

  "clawgraph.events": async ({ params, respond }) => {
    const runId = readString(params.runId);
    if (!runId) {
      respondInvalid(respond, 'clawgraph.events requires "runId"');
      return;
    }
    const events = getClawGraphRunEvents(runId, readPositiveInteger(params.limit));
    if (!events) {
      respondInvalid(respond, `unknown ClawGraph run "${runId}"`);
      return;
    }
    respond(true, { available: true, events }, undefined);
  },

  "clawgraph.abort": async ({ params, respond, context }) => {
    const runId = readString(params.runId);
    if (!runId) {
      respondInvalid(respond, 'clawgraph.abort requires "runId"');
      return;
    }
    const snapshot = abortClawGraphRun(runId, readString(params.reason), lifecycleBroadcaster(context));
    if (!snapshot) {
      respondInvalid(respond, `unknown ClawGraph run "${runId}"`);
      return;
    }
    respond(true, { available: true, snapshot }, undefined);
  },

  "clawgraph.review": async ({ params, respond, context }) => {
    const runId = readString(params.runId);
    const reviewId = readString(params.reviewId);
    const decision = readString(params.decision);
    if (!runId || !reviewId || (decision !== "approve" && decision !== "reject")) {
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
      respondInvalid(respond, `unknown ClawGraph run "${runId}"`);
      return;
    }
    respond(true, { available: true, snapshot }, undefined);
  },
};
