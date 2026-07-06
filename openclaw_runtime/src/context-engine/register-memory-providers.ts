// Memory context provider registration helper.
//
// Design (area-4-role-memory-completion.md §3.1, §3.2, §3.4): federate the two
// memory systems at the context-provider seam. This helper constructs the
// provider instances that `assembleChatTurnMemoryInjection` queries when the
// `runtimeMemory.injectPilot` flag is on.
//
// Registration is purely additive (§6: "The facade (§3.3) and provider
// registration (§3.2) are purely additive and need no promotion."). The
// providers are only queried through the pilot seam, which is default-off, so
// registering them has no effect on prompt bytes until the flag is flipped.

import type {
  RuntimeContextProvider,
  RuntimeContextProviderQuery,
} from "../runtime-core/index.js";
import { createRuntimeMemoryContextProvider } from "./memory-context-provider.js";
import { createRoleMemoryContextProvider } from "./role-memory-context-provider.js";

export type MemoryContextProvidersOptions = {
  // Role Memory provider options. When provided, the `role-memory` provider is
  // created (governance-curated, production-proven for subagents — leads the
  // pilot per §3.4).
  roleMemory?: {
    resolveRoleName: (
      query: RuntimeContextProviderQuery,
    ) => string | undefined;
    defaultTokenBudget?: number;
  };
  // Runtime Memory provider options. When provided, the `runtime-memory`
  // provider is created (shadow feature — only register when its gates pass,
  // §6: maturity ≥ 0.7, extraction density ≥ 1.0, multi_hop Recall@5 ≥ 40%).
  runtimeMemory?: Parameters<
    typeof createRuntimeMemoryContextProvider
  >[0];
};

/**
 * Construct the memory context providers for the chat-turn injection pilot.
 *
 * Returns an empty array when no options are provided — callers that only want
 * the Role Memory provider (the pilot's initial configuration, §3.4 default
 * `providers: ['role-memory']`) pass only `roleMemory`. The Runtime Memory
 * provider is opt-in because its quality gates are not yet met.
 *
 * The returned providers are stateless and safe to register once at runtime
 * startup; activation is governed separately by the `runtimeMemory.injectPilot`
 * flag resolved in `chat-turn-memory-injection.ts`.
 */
export function createMemoryContextProviders(
  opts: MemoryContextProvidersOptions = {},
): RuntimeContextProvider[] {
  const providers: RuntimeContextProvider[] = [];
  if (opts.roleMemory) {
    providers.push(createRoleMemoryContextProvider(opts.roleMemory));
  }
  if (opts.runtimeMemory) {
    providers.push(createRuntimeMemoryContextProvider(opts.runtimeMemory));
  }
  return providers;
}

/**
 * Default role-name resolver for main-session chat turns.
 *
 * Per §3.2: "for a main-agent chat turn, the Agent's persona-derived role name
 * or 'main'". This resolver checks `query.metadata.roleName` (set by the
 * caller from Area 1 taxonomy) and falls back to `'main'` so that main-session
 * turns always have a role identity for memory lookup.
 *
 * Override this with a richer resolver when the Agent has a persona-derived
 * role (Area 1 lifecycle read model).
 */
export function defaultMainSessionRoleResolver(
  query: RuntimeContextProviderQuery,
): string | undefined {
  if (query.metadata && typeof query.metadata === "object") {
    const value = (query.metadata as { roleName?: unknown }).roleName;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "main";
}
