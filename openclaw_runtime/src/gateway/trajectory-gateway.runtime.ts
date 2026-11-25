import { resolveSessionFilePath, resolveSessionFilePathOptions } from "../config/sessions/paths.js";
import { parseAgentSessionKey } from "../routing/session-key.js";
import { loadSessionEntry } from "./session-utils.js";
import { TrajectoryGatewayRequestError } from "./trajectory-gateway.js";

/** Resolves the current session source only when trajectory data is requested. */
export function resolveTrajectorySessionSource(sessionKey: string): {
  sessionId: string;
  sessionFile: string;
} {
  const loaded = loadSessionEntry(sessionKey);
  const parsed = parseAgentSessionKey(sessionKey);
  const sessionId = loaded.entry?.sessionId ?? parsed?.rest ?? sessionKey;
  try {
    const pathOptions = resolveSessionFilePathOptions({
      storePath: loaded.storePath,
      agentId: parsed?.agentId,
    });
    return {
      sessionId,
      sessionFile: resolveSessionFilePath(sessionId, loaded.entry, pathOptions),
    };
  } catch (error) {
    throw new TrajectoryGatewayRequestError(
      "invalid-session",
      `Invalid session key ${sessionKey}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
