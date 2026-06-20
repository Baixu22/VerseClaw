import { unregisterApiProviders } from "../api-registry.js";

/** Source id reserved for built-in API provider registrations. */
export const BUILT_IN_API_PROVIDER_SOURCE_ID = "core:built-in";

/** ClawX pruned runtime intentionally ships without real built-in LLM SDK providers. */
export function registerBuiltInApiProviders(): void {
  // Real provider SDKs are pruned; ClawX uses the Electron-layer mock provider
  // for no-cost smoke paths and can add explicit product providers later.
}

/** Restores the built-in provider registry state for tests. */
export function resetApiProviders(): void {
  unregisterApiProviders(BUILT_IN_API_PROVIDER_SOURCE_ID);
  registerBuiltInApiProviders();
}
