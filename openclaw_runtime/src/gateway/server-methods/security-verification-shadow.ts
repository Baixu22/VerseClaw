// Security/verification shadow gateway methods.
//
// These methods expose deterministic, backend-only shadow evaluations. They do
// not enforce policy or run external validation commands.
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import {
  buildToolCallRequestFromUnknown,
  buildToolCallResultFromUnknown,
  evaluateSecurityShadow,
  evaluateVerificationShadow,
  getSecurityVerificationShadowRecord,
  getSecurityVerificationShadowRecords,
  getSecurityVerificationShadowSummary,
  getSecurityVerificationShadowStatus,
  recordSecurityVerificationShadow,
  type SecurityShadowDecision,
  type ShadowRecordSubject,
  type ShadowRecordSource,
  type VerificationShadowStatus,
} from "../../security-verification-shadow/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readLimit(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, Math.floor(value)));
}

function readSource(value: unknown): ShadowRecordSource | undefined {
  return value === "tools.invoke" || value === "security.policy.simulate" || value === "verification.run"
    ? value
    : undefined;
}

function readSubject(value: unknown): ShadowRecordSubject | undefined {
  return value === "tool_call" || value === "event_log" || value === "checkpoint" ? value : undefined;
}

function readSecurityDecision(value: unknown): SecurityShadowDecision | undefined {
  return value === "allow" || value === "warn" || value === "would_require_approval" || value === "would_block"
    ? value
    : undefined;
}

function readVerificationStatus(value: unknown): VerificationShadowStatus | undefined {
  return value === "passed" || value === "warning" || value === "failed" || value === "insufficient_evidence"
    ? value
    : undefined;
}

function readRecordFilters(params: Record<string, unknown>) {
  return {
    ...(readLimit(params.limit) !== undefined ? { limit: readLimit(params.limit) } : {}),
    ...(readString(params.runId) ? { runId: readString(params.runId) } : {}),
    ...(readSource(params.source) ? { source: readSource(params.source) } : {}),
    ...(readSubject(params.subject) ? { subject: readSubject(params.subject) } : {}),
    ...(readSecurityDecision(params.decision ?? params.securityDecision)
      ? { securityDecision: readSecurityDecision(params.decision ?? params.securityDecision) }
      : {}),
    ...(readVerificationStatus(params.status ?? params.verificationStatus)
      ? { verificationStatus: readVerificationStatus(params.status ?? params.verificationStatus) }
      : {}),
  };
}

export const securityVerificationShadowHandlers: GatewayRequestHandlers = {
  "security.health": async ({ respond, context }) => {
    respond(true, { ok: true, health: getSecurityVerificationShadowStatus(context.getRuntimeConfig()) }, undefined);
  },

  "security.policy.get": async ({ respond, context }) => {
    respond(
      true,
      {
        policy: {
          mode: "shadow",
          enabled: getSecurityVerificationShadowStatus(context.getRuntimeConfig()).enabled,
          enforcement: "observe-only",
          deterministicOnly: true,
          llmJudge: false,
          externalTests: false,
        },
      },
      undefined,
    );
  },

  "security.policy.simulate": async ({ params, respond }) => {
    const request = buildToolCallRequestFromUnknown({
      source: "security.policy.simulate",
      value: params.request ?? params,
    });
    const result = buildToolCallResultFromUnknown({ request, value: params.result });
    respond(
      true,
      {
        decision: evaluateSecurityShadow(request, result),
        verification: evaluateVerificationShadow(request, result),
        recorded: false,
      },
      undefined,
    );
  },

  "security.intercepts.list": async ({ params, respond }) => {
    const filters = readRecordFilters(params);
    respond(
      true,
      {
        intercepts: getSecurityVerificationShadowRecords(filters),
        summary: getSecurityVerificationShadowSummary(filters),
      },
      undefined,
    );
  },

  "verification.health": async ({ respond, context }) => {
    respond(true, { ok: true, health: getSecurityVerificationShadowStatus(context.getRuntimeConfig()) }, undefined);
  },

  "verification.run": async ({ params, respond }) => {
    const hasEvents = Array.isArray(params.events);
    const hasCheckpoint = params.checkpoint !== undefined;
    if (hasEvents && hasCheckpoint) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "verification.run accepts either events or checkpoint, not both"));
      return;
    }
    if (hasEvents) {
      const record = recordSecurityVerificationShadow({
        source: "verification.run",
        events: params.events,
        ...(readString(params.runId) ? { runId: readString(params.runId) } : {}),
      });
      respond(true, { result: record.verification, runId: record.runId, record }, undefined);
      return;
    }
    if (hasCheckpoint) {
      const record = recordSecurityVerificationShadow({
        source: "verification.run",
        checkpoint: params.checkpoint,
        ...(readString(params.runId) ? { runId: readString(params.runId) } : {}),
      });
      respond(true, { result: record.verification, runId: record.runId, record }, undefined);
      return;
    }
    const request = buildToolCallRequestFromUnknown({
      source: "verification.run",
      value: params.request ?? params,
    });
    const result = buildToolCallResultFromUnknown({ request, value: params.result });
    const record = recordSecurityVerificationShadow({
      source: "verification.run",
      request,
      ...(result ? { result } : {}),
      ...(readString(params.runId) ? { runId: readString(params.runId) } : {}),
    });
    respond(true, { result: record.verification, runId: record.runId, record }, undefined);
  },

  "verification.status": async ({ respond, context }) => {
    respond(true, { status: getSecurityVerificationShadowStatus(context.getRuntimeConfig()) }, undefined);
  },

  "verification.results.list": async ({ params, respond }) => {
    const filters = readRecordFilters(params);
    const records = getSecurityVerificationShadowRecords(filters);
    respond(true, {
      results: records.map((record) => ({
        id: record.id,
        runId: record.runId,
        subject: record.subject,
        createdAt: record.createdAt,
        source: record.source,
        sampling: record.sampling,
        request: record.request,
        result: record.result,
        eventLog: record.eventLog,
        checkpoint: record.checkpoint,
        security: record.security,
        verification: record.verification,
        observabilityTraceId: record.observabilityTraceId,
      })),
      summary: getSecurityVerificationShadowSummary(filters),
    }, undefined);
  },

  "verification.results.get": async ({ params, respond }) => {
    const id = readString(params.id);
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'verification.results.get requires "id"'));
      return;
    }
    const record = getSecurityVerificationShadowRecord(id);
    if (!record) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unknown verification result "${id}"`));
      return;
    }
    respond(true, { result: record }, undefined);
  },
};
