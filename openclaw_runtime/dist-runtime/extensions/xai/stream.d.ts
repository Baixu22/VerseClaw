import { Vr as StreamFn } from "../../index-Ctn3rMDO.js";
import { an as ProviderWrapStreamFnContext } from "../../plugin-entry-AA93uEnw.js";
//#region extensions/xai/stream.d.ts
declare function createXaiToolPayloadCompatibilityWrapper(baseStreamFn: StreamFn | undefined): StreamFn;
declare function createXaiFastModeWrapper(baseStreamFn: StreamFn | undefined, fastMode: boolean): StreamFn;
declare function wrapXaiProviderStream(ctx: ProviderWrapStreamFnContext): StreamFn | undefined;
//#endregion
export { createXaiFastModeWrapper, createXaiToolPayloadCompatibilityWrapper, wrapXaiProviderStream };