import { resolveContextTokensForModel } from "../../agents/context.js";
import { resolveConfiguredModelRef } from "../../agents/model-selection-shared.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import { classifySessionKey, resolveSessionModelRef } from "../session-utils.js";

function resolveConfiguredStatusModelRef(params: {
  cfg: OpenClawConfig;
  defaultProvider: string;
  defaultModel: string;
  agentId?: string;
}) {
  if (params.agentId) {
    return resolveSessionModelRef(params.cfg, undefined, params.agentId, {
      allowPluginNormalization: false,
    });
  }
  return resolveConfiguredModelRef({
    cfg: params.cfg,
    defaultProvider: params.defaultProvider,
    defaultModel: params.defaultModel,
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
  return params.provider?.trim() || params.entry?.modelProvider?.trim() || null;
}

export const statusSummaryRuntime = {
  classifySessionKey,
  resolveConfiguredStatusModelRef,
  resolveContextTokensForModel,
  resolveSessionModelRef,
  resolveSessionRuntimeLabel,
};
