import { wr as AgentMessage } from "../../index-Ctn3rMDO.js";
import { Ic as ProviderThinkingProfile, In as ProviderSanitizeReplayHistoryContext, Sn as ProviderReplayPolicyContext, bn as ProviderReasoningOutputModeContext, xn as ProviderReplayPolicy, yn as ProviderReasoningOutputMode } from "../../types-BKcW1vnC.js";
import { Nt as ProviderNormalizeToolSchemasContext, a as AnyAgentTool, en as ProviderToolSchemaDiagnostic, wt as ProviderDefaultThinkingPolicyContext } from "../../plugin-entry-AA93uEnw.js";
import { d as createGoogleThinkingStreamWrapper } from "../../provider-stream-shared-C0-WAKmv.js";
//#region extensions/google/provider-hooks.d.ts
declare const GOOGLE_GEMINI_PROVIDER_HOOKS: {
  resolveThinkingProfile: (context: ProviderDefaultThinkingPolicyContext) => ProviderThinkingProfile | undefined;
  wrapStreamFn: typeof createGoogleThinkingStreamWrapper;
  normalizeToolSchemas: (ctx: ProviderNormalizeToolSchemasContext) => AnyAgentTool[];
  inspectToolSchemas: (ctx: ProviderNormalizeToolSchemasContext) => ProviderToolSchemaDiagnostic[];
  buildReplayPolicy?: ((ctx: ProviderReplayPolicyContext) => ProviderReplayPolicy | null | undefined) | undefined;
  sanitizeReplayHistory?: ((ctx: ProviderSanitizeReplayHistoryContext) => Promise<AgentMessage[] | null | undefined> | AgentMessage[] | null | undefined) | undefined;
  resolveReasoningOutputMode?: ((ctx: ProviderReasoningOutputModeContext) => ProviderReasoningOutputMode | null | undefined) | undefined;
};
//#endregion
export { GOOGLE_GEMINI_PROVIDER_HOOKS };