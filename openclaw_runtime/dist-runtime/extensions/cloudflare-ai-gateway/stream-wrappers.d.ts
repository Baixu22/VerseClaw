import { Vr as StreamFn } from "../../index-Ctn3rMDO.js";
import { t as SubsystemLogger } from "../../subsystem-n4Y4vCcQ.js";
import { an as ProviderWrapStreamFnContext } from "../../plugin-entry-AA93uEnw.js";
//#region extensions/cloudflare-ai-gateway/stream-wrappers.d.ts
declare function shouldPatchAnthropicMessagesPayload(model: ProviderWrapStreamFnContext["model"]): boolean;
/**
 * Creates a wrapper that removes trailing assistant prefill messages before
 * extended-thinking Anthropic requests are sent through Cloudflare.
 */
declare function createCloudflareAiGatewayAnthropicThinkingPrefillWrapper(baseStreamFn: StreamFn | undefined): StreamFn;
/**
 * Applies the Anthropic payload wrapper only for Anthropic-compatible models.
 */
declare function wrapCloudflareAiGatewayProviderStream(ctx: ProviderWrapStreamFnContext): StreamFn | undefined;
/** Test-only access to wrapper decisions and logger injection points. */
declare const testing: {
  log: SubsystemLogger;
  shouldPatchAnthropicMessagesPayload: typeof shouldPatchAnthropicMessagesPayload;
};
//#endregion
export { testing as __testing, testing, createCloudflareAiGatewayAnthropicThinkingPrefillWrapper, wrapCloudflareAiGatewayProviderStream };