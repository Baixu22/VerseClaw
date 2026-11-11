/** Session-manager scoped runtime state for context-pruning extension settings. */
import { createSessionManagerRuntimeRegistry } from "../session-manager-runtime-registry.js";
import type { EffectiveContextPruningSettings } from "./settings.js";
import type { WouldTrimReport } from "./would-trim.js";

/** Runtime inputs consumed by the context-pruning extension. */
export type ContextPruningRuntimeValue = {
  settings: EffectiveContextPruningSettings;
  sessionId?: string;
  archiveRecallRetention?: boolean;
  contextWindowTokens?: number | null;
  isToolPrunable: (toolName: string) => boolean;
  dropThinkingBlocks: boolean;
  lastCacheTouchAt?: number | null;
  /** TF-0646: record a would-trim report for this turn; never affects pruning. */
  wouldTrimShadow?: boolean;
  lastWouldTrim?: (WouldTrimReport & { gate: { decision: "go" | "no-go"; reason: string } }) | null;
};

// Important: this relies on the embedded agent runtime passing the same SessionManager instance into
// ExtensionContext (ctx.sessionManager) that we used when calling setContextPruningRuntime.
const registry = createSessionManagerRuntimeRegistry<ContextPruningRuntimeValue>();

export const setContextPruningRuntime = registry.set;

export const getContextPruningRuntime = registry.get;
