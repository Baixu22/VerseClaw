// Local runtime control-plane read-only gateway methods.
//
// The MVP reports are bounded in-memory diagnostics. These methods expose the
// current status and filtered reports without changing runtime state.
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import {
  getLocalControlPlaneStatus,
  isLocalControlPlaneReportKind,
  listLocalControlPlaneCorrelations,
  listLocalControlPlaneReports,
  type LocalControlPlaneCorrelationFilter,
  type LocalControlPlaneCorrelationGroupBy,
  type LocalControlPlaneReportFilter,
} from "../../local-control-plane/index.js";
import type { GatewayRequestHandlers } from "./types.js";

const CORRELATION_GROUP_BY_VALUES = ["task", "run", "session", "evidence"] as const;

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readLimit(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(200, Math.floor(value)));
}

function readReportFilter(params: Record<string, unknown>): LocalControlPlaneReportFilter | undefined {
  if (params.kind !== undefined && !isLocalControlPlaneReportKind(params.kind)) {
    return undefined;
  }
  return {
    ...(isLocalControlPlaneReportKind(params.kind) ? { kind: params.kind } : {}),
    ...(readString(params.sessionKey) ? { sessionKey: readString(params.sessionKey) } : {}),
    ...(readString(params.runId) ? { runId: readString(params.runId) } : {}),
    ...(readString(params.taskId) ? { taskId: readString(params.taskId) } : {}),
    ...(readLimit(params.limit) !== undefined ? { limit: readLimit(params.limit) } : {}),
  };
}

function isCorrelationGroupBy(value: unknown): value is LocalControlPlaneCorrelationGroupBy {
  return typeof value === "string" && CORRELATION_GROUP_BY_VALUES.includes(value as LocalControlPlaneCorrelationGroupBy);
}

function readCorrelationFilter(params: Record<string, unknown>): LocalControlPlaneCorrelationFilter | undefined {
  const reportFilter = readReportFilter(params);
  if (!reportFilter) return undefined;
  if (params.groupBy !== undefined && !isCorrelationGroupBy(params.groupBy)) {
    return undefined;
  }
  return {
    ...reportFilter,
    ...(isCorrelationGroupBy(params.groupBy) ? { groupBy: params.groupBy } : {}),
    ...(readString(params.evidenceType) ? { evidenceType: readString(params.evidenceType) } : {}),
    ...(readString(params.evidenceRef) ? { evidenceRef: readString(params.evidenceRef) } : {}),
  };
}

export const localControlPlaneHandlers: GatewayRequestHandlers = {
  "localControlPlane.status": ({ respond, context }) => {
    respond(
      true,
      {
        status: getLocalControlPlaneStatus(context.getRuntimeConfig()),
      },
      undefined,
    );
  },

  "localControlPlane.reports": ({ params, respond }) => {
    const filter = readReportFilter(params);
    if (!filter) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          'localControlPlane.reports "kind" must be one of context, model_router, capability, evidence, mission',
        ),
      );
      return;
    }
    respond(
      true,
      {
        reports: listLocalControlPlaneReports(filter),
      },
      undefined,
    );
  },

  "localControlPlane.correlations": ({ params, respond }) => {
    const filter = readCorrelationFilter(params);
    if (!filter) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          'localControlPlane.correlations params must use a valid "kind" and groupBy=task|run|session|evidence',
        ),
      );
      return;
    }
    respond(
      true,
      {
        correlations: listLocalControlPlaneCorrelations(filter),
      },
      undefined,
    );
  },
};
