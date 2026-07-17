/**
 * 抄写自 browser-ai-assistant-master/src/shared/toolAuthorization.ts。
 * 零修改，仅调整 import 路径（本文件无外部 import）。
 *
 * P0-3 阶段：三模式运行态 + 一次性 Grant 的类型与授权函数。
 * 保留源文件粒度，便于后续同步上游修复。
 */

export type BrowserAutomationMode = "normal_restricted" | "controlled_enhanced" | "full_access";

export type ToolAuthorizationMode = "normal" | "runtime_readonly" | "controlled_enhanced" | "full_access";

export type ToolRiskCapability =
  | "browser_control"
  | "network_read"
  | "runtime_readonly"
  | "controlled_enhanced"
  | "request_replay"
  | "boundary_choice"
  | "full_access";

export type BrowserAutomationGrant =
  | "include_sensitive_field_in_current_tool_result"
  | "send_single_confirmed_replay_request_without_credentials"
  | "expand_runtime_summary_depth"
  | "expand_js_or_sourcemap_context"
  | "write_sensitive_result_to_chat_once";

export interface ToolAuthorizationContext {
  mode: ToolAuthorizationMode;
  tabId?: number;
  origin?: string;
  createdAt: number;
  expiresAt?: number;
  reason?: string;
}

export interface BoundaryGrantContext {
  id: string;
  tabId: number;
  origin: string;
  toolCallId: string;
  scopeKey: string;
  grants: BrowserAutomationGrant[];
  selectedChoiceIds: string[];
  otherText?: string;
  createdAt: number;
  expiresAt: number;
}

export const NORMAL_TOOL_AUTHORIZATION_CONTEXT: ToolAuthorizationContext = {
  mode: "normal",
  createdAt: 0,
};

export function isRuntimeReadonlyAuthorized(context: ToolAuthorizationContext, tabId: number | undefined, now = Date.now()): boolean {
  if (typeof tabId !== "number") {
    return false;
  }

  if (context.mode !== "runtime_readonly" && context.mode !== "controlled_enhanced") {
    return false;
  }

  if (context.expiresAt !== undefined && context.expiresAt <= now) {
    return false;
  }

  return context.tabId === tabId;
}

export function isFullAccessAuthorized(context: ToolAuthorizationContext, tabId: number | undefined, now = Date.now()): boolean {
  if (typeof tabId !== "number") {
    return false;
  }

  if (context.mode !== "full_access") {
    return false;
  }

  if (context.expiresAt !== undefined && context.expiresAt <= now) {
    return false;
  }

  return context.tabId === tabId;
}

export function isControlledEnhancedAuthorized(context: ToolAuthorizationContext, tabId: number | undefined, now = Date.now()): boolean {
  if (typeof tabId !== "number") {
    return false;
  }

  if (context.mode !== "controlled_enhanced") {
    return false;
  }

  if (context.expiresAt !== undefined && context.expiresAt <= now) {
    return false;
  }

  return context.tabId === tabId;
}

export function getOriginFromUrl(urlRaw: string): string | undefined {
  try {
    const url = new URL(urlRaw);
    return url.origin;
  } catch {
    return undefined;
  }
}

export function createBoundaryGrantScopeKey(input: { name: string; arguments: Record<string, unknown> }): string {
  return `${normalizeBoundaryScopeToolName(input.name)}\u0000${stableStringify(normalizeBoundaryScopeArguments(input.arguments))}`;
}

function normalizeBoundaryScopeToolName(name: string): string {
  return name.replace(/\./g, "_");
}

function normalizeBoundaryScopeArguments(args: Record<string, unknown>): Record<string, unknown> {
  const { scopeKey: _scopeKey, ...rest } = args;
  return rest;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}


/** True when a boundary grant is still valid for the active tab+origin at now. */
export function isBoundaryGrantUsable(
  grant: BoundaryGrantContext | undefined,
  tabId: number | undefined,
  origin: string | undefined,
  now = Date.now(),
): boolean {
  if (!grant) return false;
  if (typeof tabId !== "number") return false;
  if (!origin) return false;
  if (grant.tabId !== tabId) return false;
  if (grant.origin !== origin) return false;
  if (grant.expiresAt <= now) return false;
  return true;
}

/**
 * Full-access mode authorization with tab + origin + expiry binding.
 * Fail-closed when any binding field is missing.
 */
export function isFullAccessContextAuthorized(params: {
  modeOk: boolean;
  tabId?: number;
  origin?: string;
  expectedTabId?: number;
  expectedOrigin?: string;
  expiresAt?: number;
  now?: number;
}): boolean {
  const now = params.now ?? Date.now();
  if (!params.modeOk) return false;
  if (typeof params.tabId !== "number" || typeof params.expectedTabId !== "number") return false;
  if (params.tabId !== params.expectedTabId) return false;
  if (!params.origin || !params.expectedOrigin) return false;
  if (params.origin !== params.expectedOrigin) return false;
  if (params.expiresAt !== undefined && params.expiresAt <= now) return false;
  return true;
}
