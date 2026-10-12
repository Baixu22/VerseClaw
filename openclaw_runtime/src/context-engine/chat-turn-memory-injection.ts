// Chat-turn memory injection pilot seam.
//
// Design (area-4-role-memory-completion.md §3.4): a single operator gate that
// turns memory injection on for ordinary chat turns. One flag, two providers
// (`role-memory` + `runtime-memory`). Default OFF — with the flag off, prompt
// bytes are identical to today (comms replay parity, §8).
//
// This module is the wiring seam: it resolves the pilot config from runtime
// config, gates on `enabled`, queries the registered memory providers, and
// renders their `ContextItem` output into a single `## Memory Context` block
// suitable for appending to `extraSystemPrompt`.
//
// The actual agent-gateway call site is intentionally isolated to one
// flag-gated invocation; when the flag is off, `assembleChatTurnMemoryInjection`
// returns `null` and the caller must skip appending anything, preserving
// byte-identical prompts.

import { isRecord } from "../runtime-core/index.js";
import { isSubagentSessionKey } from "../sessions/session-key-utils.js";
import { isContextEnhancementKillSwitchEngaged } from "./enhancement-kill-switch.js";
import { applyInjectionBudget, createInjectionBudget } from "./injection-budget.js";
import type {
  ContextItem,
  RuntimeContextProvider,
  RuntimeContextProviderExtras,
  RuntimeContextProviderQuery,
  RuntimeCoreJsonObject,
  RuntimeRegistryDiagnostic,
} from "../runtime-core/index.js";

export const MEMORY_INJECT_PILOT_PROVIDER_IDS = [
  "role-memory",
  "runtime-memory",
] as const;
export type MemoryInjectPilotProviderId =
  (typeof MEMORY_INJECT_PILOT_PROVIDER_IDS)[number];

export type MemoryInjectPilotConfig = {
  enabled: boolean; // default false
  providers: MemoryInjectPilotProviderId[]; // default ['role-memory']
  totalTokenBudget: number; // default 512 (role) + 256 (runtime) capped
  sessions: "all" | "main-only"; // default 'main-only'
};

export const DEFAULT_MEMORY_INJECT_PILOT_CONFIG: MemoryInjectPilotConfig = {
  enabled: false,
  providers: ["role-memory"],
  totalTokenBudget: 768,
  sessions: "main-only",
};

/**
 * #181: the pilot budget is declared in tokens, but the rest of the injection
 * stack measures in characters (see `turn-injection-budget.ts` decision 2). 1
 * token ≈ 4 characters is the same estimate `memory-context-provider.ts` uses
 * (`TOKEN_CHAR_WIDTH`), so a provider-level token budget and this aggregate
 * budget stay comparable. Keep the two constants in step.
 */
export const MEMORY_PILOT_TOKEN_CHAR_WIDTH = 4;

/** Convert the pilot's total token budget into the character ceiling to enforce. */
export function memoryPilotTokenBudgetToChars(totalTokenBudget: number): number {
  return Math.max(1, Math.floor(totalTokenBudget * MEMORY_PILOT_TOKEN_CHAR_WIDTH));
}

export type ChatTurnMemoryInjectionQuery = RuntimeContextProviderQuery & {
  sessionKey?: string;
  /**
   * #182: fact ids another channel already put into this turn's prompt (today:
   * COMPASS `injectedFactIds`). Facts with these ids are dropped before render
   * so the same fact is not injected twice in two different serializations.
   */
  dedupeFactIds?: readonly string[];
};

export type ChatTurnMemoryInjectionResult = {
  text: string;
  diagnostics: RuntimeRegistryDiagnostic[];
  metadata: RuntimeCoreJsonObject;
};

/**
 * Resolve the chat-turn memory injection pilot config from a runtime config
 * object. Accepts either the raw config (`{ runtime: { memory: { injectPilot: ... } } }`)
 * or a pre-extracted runtime section (`{ memory: { injectPilot: ... } }`).
 *
 * Defaults to `enabled: false` — any missing or malformed field falls back to
 * the safe default, never to enabled.
 */
export function resolveMemoryInjectPilotConfig(
  value: unknown,
): MemoryInjectPilotConfig {
  // Fail-closed master cut for all memory/context enhancement.
  if (isContextEnhancementKillSwitchEngaged(value)) {
    return { ...DEFAULT_MEMORY_INJECT_PILOT_CONFIG, enabled: false };
  }

  const runtime = runtimeConfigFrom(value);
  const memory = isRecord(runtime?.memory) ? runtime.memory : undefined;
  const injectPilot = isRecord(memory?.injectPilot)
    ? memory.injectPilot
    : undefined;

  if (!injectPilot) {
    return DEFAULT_MEMORY_INJECT_PILOT_CONFIG;
  }

  const enabled = injectPilot.enabled === true;
  const providers = resolveProviderList(injectPilot.providers);
  const totalTokenBudget = resolveTotalTokenBudget(
    injectPilot.totalTokenBudget,
  );
  const sessions = resolveSessions(injectPilot.sessions);

  return {
    enabled,
    providers,
    totalTokenBudget,
    sessions,
  };
}

/**
 * Returns `true` when the pilot applies to this turn (flag on + session scope
 * match). Returns `false` for any flag-off or non-matching session, in which
 * case the caller must skip injection to preserve byte-identical prompts.
 */
export function shouldInjectChatTurnMemory(
  config: MemoryInjectPilotConfig,
  query: ChatTurnMemoryInjectionQuery,
): boolean {
  if (!config.enabled) return false;
  if (config.sessions === "main-only") {
    const sessionKey = query.sessionKey;
    if (!sessionKey) return false;
    // #183: the *exclusion* uses the runtime's canonical session taxonomy rather
    // than a local string-shape guess — a subagent key that happens to end in
    // `:main` (`agent:<id>:subagent:main`) is still a subagent and used to slip
    // through. The inclusion test still requires the documented
    // `agent:<id>:main` (or cron-main) shape, so which sessions qualify is
    // unchanged for every non-subagent key.
    if (isSubagentSessionKey(sessionKey)) return false;
    if (!/^(agent|cron):[^:]+:main$/.test(sessionKey)) return false;
  }
  return true;
}

/**
 * The wiring seam: query the registered memory providers, collect their
 * `ContextItem` output, render it into a single `## Memory Context` block.
 *
 * Returns `null` when the pilot is off, the session is out of scope, no
 * providers are configured, or every provider falls back — so the caller can
 * simply skip appending anything and preserve byte-identical prompts.
 *
 * Provider failures are isolated: a throwing/fallback provider contributes
 * zero items and a diagnostic, but never aborts the turn or the other
 * providers' injection.
 */
export async function assembleChatTurnMemoryInjection(
  query: ChatTurnMemoryInjectionQuery,
  providers: readonly RuntimeContextProvider[],
  config: MemoryInjectPilotConfig,
  extras?: RuntimeContextProviderExtras,
): Promise<ChatTurnMemoryInjectionResult | null> {
  if (!shouldInjectChatTurnMemory(config, query)) return null;

  const targetProviders = providers.filter((provider) =>
    config.providers.includes(
      provider.manifest.id as MemoryInjectPilotProviderId,
    ),
  );
  if (targetProviders.length === 0) return null;

  const diagnostics: RuntimeRegistryDiagnostic[] = [];
  const allItems: ContextItem[] = [];
  const perProvider: Array<{
    providerId: string;
    itemCount: number;
    status: string;
  }> = [];

  for (const provider of targetProviders) {
    try {
      const result = await provider.getContext(query, extras);
      const items = Array.isArray(result) ? result : result.contextItems;
      const status = Array.isArray(result) ? "success" : result.status;
      if (!Array.isArray(result) && result.diagnostics) {
        diagnostics.push(...result.diagnostics);
      }
      allItems.push(...items);
      perProvider.push({
        providerId: provider.manifest.id,
        itemCount: items.length,
        status,
      });
    } catch (err) {
      diagnostics.push({
        surface: "context",
        providerId: provider.manifest.id,
        status: "error",
        reason: "provider_exception",
        message: `Memory provider threw during chat-turn injection: ${String(err)}`,
        evidenceRefs: [],
        metadata: {
          providerId: provider.manifest.id,
          error: String(err),
        },
      });
      perProvider.push({
        providerId: provider.manifest.id,
        itemCount: 0,
        status: "error",
      });
    }
  }

  if (allItems.length === 0) return null;

  // #182: 去重是义务. Drop (a) facts another channel already injected this turn
  // and (b) the same fact id twice inside this block. Only the ids the caller
  // declares are treated as duplicates — this never guesses from prose.
  const excludedFactIds = new Set(query.dedupeFactIds ?? []);
  const seenFactIds = new Set<string>();
  const keptItems: ContextItem[] = [];
  let droppedDuplicateItems = 0;
  for (const item of allItems) {
    const key = memoryItemIdentity(item);
    if (excludedFactIds.has(key) || seenFactIds.has(key)) {
      droppedDuplicateItems += 1;
      continue;
    }
    seenFactIds.add(key);
    keptItems.push(item);
  }
  if (keptItems.length === 0) return null;

  const rendered = renderMemoryContextBlock(keptItems);
  if (!rendered) return null;

  // #181: `totalTokenBudget` is the aggregate ceiling across every provider in
  // this block — it must actually shrink the bytes, not merely ride along in
  // metadata. The turn ledger (`turn-injection-budget.ts`) is a separate,
  // turn-wide pool shared with the other injection channels; it cannot stand in
  // for this per-pilot limit because by the time memory_pilot charges (lowest
  // precedence) the other channels have already consumed their share.
  const charBudget = memoryPilotTokenBudgetToChars(config.totalTokenBudget);
  const budgeted = applyInjectionBudget(
    createInjectionBudget(charBudget),
    rendered,
    "memory_pilot",
  );
  const memoryBudget: RuntimeCoreJsonObject = {
    tokenBudget: config.totalTokenBudget,
    charBudget,
    charsRequested: rendered.length,
    charsApplied: budgeted.charsApplied,
    charsDropped: Math.max(0, rendered.length - budgeted.charsApplied),
    truncated: budgeted.truncated,
    dropped: budgeted.dropped,
    applied: budgeted.applied,
  };

  return {
    text: budgeted.text ?? "",
    diagnostics,
    metadata: {
      pilot: "runtimeMemory.injectPilot",
      enabled: true,
      providers: config.providers,
      totalTokenBudget: config.totalTokenBudget,
      sessions: config.sessions,
      perProvider,
      totalItems: allItems.length,
      itemsInjected: keptItems.length,
      droppedDuplicateItems,
      dedupeFactIds: [...excludedFactIds],
      memoryBudget,
    },
  };
}

/**
 * #182: identity of one injected memory item. Providers that carry a fact id
 * (runtime-memory) are comparable with the ids COMPASS retrieval reports; the
 * rest fall back to the ContextItem id.
 */
function memoryItemIdentity(item: ContextItem): string {
  const factId = item.metadata?.factId;
  return typeof factId === "string" && factId.length > 0 ? factId : item.id;
}

/**
 * Gateway wiring helper: compute the effective `extraSystemPrompt` for a chat
 * turn, appending the memory context block when the inject pilot is on.
 *
 * Returns the original `extraSystemPrompt` unchanged when:
 * - the pilot flag is off (default) → byte-identical prompts (comms parity)
 * - the session key has not been resolved → no memory scope is available
 * - the pilot is on but no providers returned items → no-op
 * - any error is thrown → suppressed, falls back to the original value
 *
 * The `providerFactory` is only called when the pilot is enabled, so callers
 * can pass an eager constructor without paying the cost when the flag is off.
 */
export async function computeMemoryExtraSystemPrompt(
  extraSystemPrompt: string | undefined,
  cfg: unknown,
  sessionKey: string | undefined,
  providerFactory: () => readonly RuntimeContextProvider[],
  log?: (message: string, context?: Record<string, unknown>) => void,
  scope?: {
    workspace?: string;
    taskId?: string;
    /** #182: fact ids another channel already injected this turn. */
    dedupeFactIds?: readonly string[];
  },
): Promise<string | undefined> {
  let result = extraSystemPrompt;
  try {
    const pilotConfig = resolveMemoryInjectPilotConfig(cfg);
    if (pilotConfig.enabled && sessionKey) {
      const providers = providerFactory();
      const memoryResult = await assembleChatTurnMemoryInjection(
        {
          sessionKey,
          workspace: scope?.workspace,
          taskId: scope?.taskId,
          ...(scope?.dedupeFactIds && scope.dedupeFactIds.length > 0
            ? { dedupeFactIds: scope.dedupeFactIds }
            : {}),
          metadata: { roleName: "main", sessionKey },
        },
        providers,
        pilotConfig,
      );
      if (memoryResult?.text) {
        result = result ? `${result}\n\n${memoryResult.text}` : memoryResult.text;
      }
    }
  } catch (err) {
    log?.(
      "[memory-inject-pilot] suppressed error, falling back to byte-identical prompt",
      { err: String(err) },
    );
  }
  return result;
}

function renderMemoryContextBlock(items: readonly ContextItem[]): string {
  if (items.length === 0) return "";
  const lines: string[] = ["", "## Memory Context", ""];

  // Group items by source provider for readability.
  const byProvider = new Map<string, ContextItem[]>();
  for (const item of items) {
    const providerId = (item.metadata?.providerId as string | undefined) ?? "memory";
    const group = byProvider.get(providerId) ?? [];
    group.push(item);
    byProvider.set(providerId, group);
  }

  for (const [providerId, group] of byProvider) {
    lines.push(`<!-- provider: ${providerId} -->`);
    for (const item of group) {
      const header = item.source ? `### ${item.source}` : "### Memory";
      lines.push(header, "", item.text, "");
    }
  }

  return lines.join("\n").trim();
}

function resolveProviderList(
  value: unknown,
): MemoryInjectPilotProviderId[] {
  if (!Array.isArray(value)) return DEFAULT_MEMORY_INJECT_PILOT_CONFIG.providers;
  const filtered = value.filter(
    (entry): entry is MemoryInjectPilotProviderId =>
      typeof entry === "string" &&
      MEMORY_INJECT_PILOT_PROVIDER_IDS.includes(
        entry as MemoryInjectPilotProviderId,
      ),
  );
  return filtered.length > 0
    ? filtered
    : DEFAULT_MEMORY_INJECT_PILOT_CONFIG.providers;
}

function resolveTotalTokenBudget(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_MEMORY_INJECT_PILOT_CONFIG.totalTokenBudget;
  }
  return Math.floor(value);
}

function resolveSessions(value: unknown): "all" | "main-only" {
  return value === "all" ? "all" : "main-only";
}

function runtimeConfigFrom(value: unknown): Record<string, unknown> | undefined {
  const record = isRecord(value) ? value : undefined;
  const directRuntime = isRecord(record?.runtime) ? record.runtime : undefined;
  if (directRuntime) return directRuntime;
  const config = isRecord(record?.config) ? record.config : undefined;
  const configRuntime = isRecord(config?.runtime) ? config.runtime : undefined;
  return configRuntime;
}
