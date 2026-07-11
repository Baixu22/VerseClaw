import { f as UnifiedModelCatalogEntry } from "../../manifest-registry-yMj3D9bX.js";
import { ln as UnifiedModelCatalogProviderContext } from "../../plugin-entry-AA93uEnw.js";
import { a as VideoGenerationModelCapabilitiesContext, s as VideoGenerationProviderCapabilities } from "../../video-generation-DF3vCxoU.js";

//#region extensions/deepinfra/surface-model-catalogs.d.ts
declare function listDeepInfraImageGenCatalog(ctx: UnifiedModelCatalogProviderContext): Promise<readonly UnifiedModelCatalogEntry[] | null>;
declare function listDeepInfraVideoGenCatalog(ctx: UnifiedModelCatalogProviderContext): Promise<readonly UnifiedModelCatalogEntry<VideoGenerationProviderCapabilities>[] | null>;
declare function resolveDeepInfraVideoModelCapabilities(ctx: VideoGenerationModelCapabilitiesContext): Promise<VideoGenerationProviderCapabilities | undefined>;
//#endregion
export { listDeepInfraImageGenCatalog, listDeepInfraVideoGenCatalog, resolveDeepInfraVideoModelCapabilities };