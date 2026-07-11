import { i as OpenClawConfig } from "../../types.openclaw-BJQ1igi6.js";
import { Vr as StreamFn } from "../../index-Ctn3rMDO.js";
//#region extensions/openai/native-web-search.d.ts
type OpenAINativeWebSearchPatchResult = "payload_not_object" | "native_tool_already_present" | "injected";
declare function patchOpenAINativeWebSearchPayload(payload: unknown): OpenAINativeWebSearchPatchResult;
declare function createOpenAINativeWebSearchWrapper(baseStreamFn: StreamFn | undefined, params: {
  config?: OpenClawConfig;
}): StreamFn;
//#endregion
export { createOpenAINativeWebSearchWrapper, patchOpenAINativeWebSearchPayload };