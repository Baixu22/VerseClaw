import { createOrchestratorPlan, type OrchestratorRequest } from "../agents/orchestrator.js";
import { routeRole, type RoleRouteRequest } from "../agents/role-router.js";
import type { ContextPackInput } from "../memory/context-pack.js";
import { buildContextPack } from "../memory/context-pack.js";
import { reviewMemoryProposal, type MemoryGatekeeperOptions } from "../memory/gatekeeper.js";
import type { MemoryCard, MemoryProposal } from "../memory/types.js";
import { createObservabilityTraceRecorder, type ObservabilityTraceRecorder } from "./trace-recorder.js";
import { buildTraceScorecard } from "./scorecard.js";
import type { ObservabilityScorecard, ObservabilityTrace } from "./types.js";

export type ObservedRoleFirstRunResult = {
  trace: ObservabilityTrace;
  scorecard: ObservabilityScorecard;
};

export function createRoleFirstTrace(task: string, attrs?: { runId?: string; sessionKey?: string; mode?: string }): ObservabilityTraceRecorder {
  const recorder = createObservabilityTraceRecorder({
    name: "role-first-runtime",
    runId: attrs?.runId,
    sessionKey: attrs?.sessionKey,
    task,
    mode: attrs?.mode,
    tags: ["role-first"],
  });
  recorder.start();
  return recorder;
}

export function observedRouteRole(recorder: ObservabilityTraceRecorder, request: RoleRouteRequest) {
  const span = recorder.startSpan({ name: "role-router", kind: "role-router", input: request.task });
  try {
    const result = routeRole(request);
    recorder.endSpan(span.id, {
      output: result.primary.role.name,
      metrics: { supportingRoles: result.supporting.length },
      attributes: { mode: result.mode, primaryRole: result.primary.role.name },
    });
    return result;
  } catch (error) {
    recorder.endSpan(span.id, { status: "error", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export function observedOrchestratorPlan(recorder: ObservabilityTraceRecorder, request: OrchestratorRequest) {
  const span = recorder.startSpan({ name: "orchestrator", kind: "orchestrator", input: request.task });
  try {
    const result = createOrchestratorPlan(request);
    recorder.endSpan(span.id, {
      output: result.mode,
      metrics: { workers: result.workers.length },
      attributes: { leadRole: result.leadRole, verifierRole: result.verifierRole, reasons: result.reasons },
    });
    return result;
  } catch (error) {
    recorder.endSpan(span.id, { status: "error", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export function observedContextPack(recorder: ObservabilityTraceRecorder, input: ContextPackInput) {
  const span = recorder.startSpan({ name: "context-pack", kind: "context-pack", roleName: input.roleName });
  try {
    const pack = buildContextPack(input);
    recorder.endSpan(span.id, {
      output: `tokens=${pack.estimatedTokens.total}`,
      metrics: { tokens: pack.estimatedTokens.total, truncated: pack.truncated ? 1 : 0 },
      attributes: { budget: pack.budget, estimatedTokens: pack.estimatedTokens },
    });
    return pack;
  } catch (error) {
    recorder.endSpan(span.id, { status: "error", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export function observedMemoryProposal(
  recorder: ObservabilityTraceRecorder,
  proposal: MemoryProposal,
  existing: readonly MemoryCard[] = [],
  options: MemoryGatekeeperOptions = {},
) {
  const span = recorder.startSpan({ name: "memory-gatekeeper", kind: "gatekeeper", input: proposal.content });
  try {
    const decision = reviewMemoryProposal(proposal, existing, options);
    recorder.endSpan(span.id, {
      output: decision.accepted ? "accepted" : "rejected",
      metrics: { accepted: decision.accepted ? 1 : 0, existingCards: existing.length },
      attributes: { reason: decision.reason, cardId: decision.card?.id, scope: proposal.scope, type: proposal.type },
    });
    return decision;
  } catch (error) {
    recorder.endSpan(span.id, { status: "error", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export function completeObservedRun(
  recorder: ObservabilityTraceRecorder,
  status: "completed" | "error" | "aborted" = "completed",
  error?: string,
): ObservedRoleFirstRunResult {
  const trace = recorder.complete(status, error);
  const scorecard = buildTraceScorecard(trace);
  return { trace, scorecard };
}
