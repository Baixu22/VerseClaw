import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { buildCapabilityPublicationResult } from "../../runtime-core/capability-publications.js";
import type { CapabilityPublicationQuery } from "../../runtime-core/capability-publications.js";
import type { GatewayRequestHandlers } from "./types.js";

function normalizeQuery(params: unknown): CapabilityPublicationQuery {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return {};
  }
  const body = params as Record<string, unknown>;
  return {
    agentId: typeof body.agentId === "string" ? body.agentId : undefined,
    workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : undefined,
    roleName: typeof body.roleName === "string" ? body.roleName : undefined,
    includeDiagnostics: body.includeDiagnostics === true,
    includeCandidates: body.includeCandidates === true,
    includeToolCatalog: body.includeToolCatalog === "warmOnly" ? "warmOnly" : "none",
  };
}

export const capabilitiesHandlers: GatewayRequestHandlers = {
  "capabilities.publications": ({ params, respond, context }) => {
    try {
      respond(
        true,
        buildCapabilityPublicationResult({
          cfg: context.getRuntimeConfig(),
          query: normalizeQuery(params),
        }),
        undefined,
      );
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `capabilities.publications failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  },
};
