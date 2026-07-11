import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../../agents/defaults.js";
import { resolveContextTokensForModel } from "../../agents/context.js";
import { resolveConfiguredModelRef } from "../../agents/model-selection-shared.js";
import { resolveSessionModelRef } from "../session-utils.js";
import { classifySessionKey } from "../session-utils.js";
import type { OpenClawConfig } from "../../config/types.js";
import type { SessionEntry } from "../../config/sessions/types.js";

function resolveConfiguredStatusModelRef(params: {
  cfg: OpenClawConfig;
  defaultProvider?: string;
  defaultModel?: string;
  agentId?: string;
}): { provider: string; model: string } {
  if (params.agentId) {
    return resolveSessionModelRef(params.cfg, undefined, params.agentId, {
      allowPluginNormalization: false,
    });
  }
  return resolveConfiguredModelRef({
    cfg: params.cfg,
    defaultProvider: params.defaultProvider ?? DEFAULT_PROVIDER,
    defaultModel: params.defaultModel ?? DEFAULT_MODEL,
    allowPluginNormalization: false,
  });
}

function resolveSessionRuntimeLabel(params: {
  cfg: OpenClawConfig;
  entry?: SessionEntry;
  provider?: string;
  model?: string;
  agentId?: string;
  sessionKey?: string;
}): string | null {
  const provider = params.provider?.trim();
  if (provider) {
    return provider;
  }
  return params.entry?.modelProvider ?? null;
}

export const statusSummaryRuntime = {
  classifySessionKey,
  resolveConfiguredStatusModelRef,
  resolveContextTokensForModel,
  resolveSessionRuntimeLabel,
  resolveSessionModelRef,
};