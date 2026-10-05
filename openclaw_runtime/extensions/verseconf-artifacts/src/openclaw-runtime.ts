import { commitStructuredArtifactBytes, commitStructuredArtifactCandidate, jsonResult, readStringParam, readStructuredArtifactSource } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import type { VerseConfRuntime, VerseConfToolContext, VerseConfToolResult } from "./runtime.js";

export const openClawVerseConfRuntime: VerseConfRuntime = {
  jsonResult(payload): VerseConfToolResult { return jsonResult(payload) as VerseConfToolResult; },
  readStringParam,
  readStructuredArtifactSource,
  commitStructuredArtifactCandidate,
  commitStructuredArtifactBytes,
};

export function verseConfContext(context: OpenClawPluginToolContext): VerseConfToolContext {
  return {
    workspaceDir: context.workspaceDir,
    sessionKey: context.sessionKey,
    sessionId: context.sessionId,
    agentId: context.agentId,
  };
}
