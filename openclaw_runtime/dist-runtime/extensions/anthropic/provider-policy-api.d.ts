import { i as OpenClawConfig } from "../../types.openclaw-BJQ1igi6.js";
import { f as ModelProviderConfig } from "../../types.models-DPSUKHec.js";
import { Ic as ProviderThinkingProfile } from "../../types-BKcW1vnC.js";
import { t as applyAnthropicConfigDefaults } from "../../config-defaults-CMYjQ8yq.js";
//#region extensions/anthropic/provider-policy-api.d.ts
/** Normalize Anthropic provider config without importing runtime registration. */
declare function normalizeConfig(params: {
  provider: string;
  providerConfig: ModelProviderConfig;
}): ModelProviderConfig;
/** Apply Anthropic config defaults through the provider-policy seam. */
declare function applyConfigDefaults(params: Parameters<typeof applyAnthropicConfigDefaults>[0]): OpenClawConfig;
/** Resolve Claude thinking profile for Anthropic or Claude CLI providers. */
declare function resolveThinkingProfile(params: {
  provider: string;
  modelId: string;
}): ProviderThinkingProfile | null;
//#endregion
export { applyConfigDefaults, normalizeConfig, resolveThinkingProfile };