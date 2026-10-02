import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import type { OpenClawPluginApi } from "../api.js";
import { VerseConfArtifactStore } from "./store.js";

const READ_SCOPE = "operator.read" as const;
const WRITE_SCOPE = "operator.write" as const;

type GatewayContext = Parameters<Parameters<OpenClawPluginApi["registerGatewayMethod"]>[1]>[0];
type Respond = GatewayContext["respond"];

function error(respond: Respond, value: unknown): void {
  respond(false, undefined, { code: "verseconf_artifact_error", message: formatErrorMessage(value) });
}

function paramsOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function workspaceOf(params: Record<string, unknown>): string {
  const value = params.workspaceDir;
  if (typeof value !== "string" || !value.trim()) throw new Error("workspaceDir is required");
  return value;
}

export function registerVerseConfGatewayMethods(params: { api: OpenClawPluginApi; store?: VerseConfArtifactStore }): void {
  const store = params.store ?? new VerseConfArtifactStore();
  params.api.registerGatewayMethod("verseconf.artifacts.list", async ({ params: raw, respond }) => {
    try { respond(true, store.listArtifacts(workspaceOf(paramsOf(raw)))); } catch (value) { error(respond, value); }
  }, { scope: READ_SCOPE });
  params.api.registerGatewayMethod("verseconf.artifacts.history", async ({ params: raw, respond }) => {
    try {
      const input = paramsOf(raw);
      const artifactId = typeof input.artifactId === "string" ? input.artifactId : "";
      const workspaceDir = workspaceOf(input);
      const artifact = store.getArtifact(artifactId);
      if (!artifact || artifact.workspaceDir !== workspaceDir) throw new Error("artifact not found");
      respond(true, { artifact, revisions: store.listRevisions(artifactId), outputs: store.listOutputs(artifactId) });
    } catch (value) { error(respond, value); }
  }, { scope: READ_SCOPE });
  params.api.registerGatewayMethod("verseconf.artifacts.outputs", async ({ params: raw, respond }) => {
    try {
      const input = paramsOf(raw);
      const artifactId = typeof input.artifactId === "string" ? input.artifactId : "";
      const workspaceDir = workspaceOf(input);
      const artifact = store.getArtifact(artifactId);
      if (!artifact || artifact.workspaceDir !== workspaceDir) throw new Error("artifact not found");
      respond(true, { outputs: store.listOutputs(artifactId, typeof input.revisionId === "string" ? input.revisionId : undefined) });
    } catch (value) { error(respond, value); }
  }, { scope: READ_SCOPE });
  params.api.registerGatewayMethod("verseconf.artifacts.disable", async ({ params: raw, respond }) => {
    try {
      const input = paramsOf(raw);
      const artifactId = typeof input.artifactId === "string" ? input.artifactId : "";
      const workspaceDir = workspaceOf(input);
      const artifact = store.getArtifact(artifactId);
      if (!artifact || artifact.workspaceDir !== workspaceDir) throw new Error("artifact not found");
      store.disableArtifact(artifactId, {
        workspaceDir,
        sessionKey: typeof input.sessionKey === "string" ? input.sessionKey : "gateway",
        sessionId: typeof input.sessionId === "string" ? input.sessionId : "gateway",
        agentId: typeof input.agentId === "string" ? input.agentId : "gateway",
        requestId: typeof input.requestId === "string" ? input.requestId : "gateway",
      });
      respond(true, { artifactId, disabled: true, historyPreserved: true });
    } catch (value) { error(respond, value); }
  }, { scope: WRITE_SCOPE });
}
