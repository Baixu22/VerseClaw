import { f as ModelProviderConfig } from "../../types.models-DPSUKHec.js";
import { Ic as ProviderThinkingProfile } from "../../types-BKcW1vnC.js";
import { wt as ProviderDefaultThinkingPolicyContext } from "../../plugin-entry-AA93uEnw.js";
//#region extensions/google/provider-policy-api.d.ts
declare function normalizeConfig(params: {
  provider: string;
  providerConfig: ModelProviderConfig;
}): ModelProviderConfig;
declare function resolveThinkingProfile(context: ProviderDefaultThinkingPolicyContext): ProviderThinkingProfile | undefined;
//#endregion
export { normalizeConfig, resolveThinkingProfile };