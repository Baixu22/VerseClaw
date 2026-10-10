/**
 * Issue #90: guard against deprecated exports that have zero call sites but
 * are still declared. The runtime has thousands of dynamic imports, so a
 * generic dead-export scan is unreliable; this list is deliberately explicit
 * and must be curated together with the removal/deprecation decision.
 *
 * Each entry is either:
 *  - removed: the export no longer exists in the source tree; the guard keeps
 *    it here as a regression tripwire so a future reintroduction fails.
 *  - deprecated-public: a plugin-sdk/extension public surface that is still in
 *    its deprecation window. It may remain, but any *call site* is forbidden
 *    by the existing deprecated-API guard and the entry documents the pending
 *    removal.
 */
export const DEPRECATED_ZERO_CALL_ENTRIES = [
  // Removed runtime-internal exports (issue #90). The guard fails if any of
  // these names reappear as an exported declaration.
  { symbol: "classifyCiaoUnhandledRejection", file: "extensions/bonjour/src/ciao.ts", status: "removed" },
  { symbol: "validateIPv4AddressInput", file: "packages/net-policy/src/ipv4.ts", status: "removed" },
  { symbol: "getOAuthProviderInfoList", file: "src/llm/utils/oauth/index.ts", status: "removed" },
  { symbol: "refreshOAuthToken", file: "src/llm/utils/oauth/index.ts", status: "removed" },
  { symbol: "deliverFinalizableDraftPreview", file: "src/channels/draft-preview-finalizer.ts", status: "removed" },
  { symbol: "buildExecApprovalInteractiveReply", file: "src/infra/exec-approval-reply.ts", status: "removed" },
  { symbol: "BARE_SESSION_RESET_PROMPT", file: "src/auto-reply/reply/session-reset-prompt.ts", status: "removed" },
  { symbol: "formatAcpLifecycleError", file: "src/agents/command/attempt-execution.ts", status: "removed" },
  { symbol: "resolveAgentModelPrimary", file: "src/agents/agent-scope.ts", status: "removed" },
  { symbol: "hasGuildPermissionDiscord", file: "extensions/discord/src/send.permissions.ts", status: "removed" },

  // Public compatibility surfaces still inside their deprecation window.
  // These are intentionally retained; removal requires a separate public
  // deprecation-cycle decision.
  { symbol: "buildChannelTurnContext", file: "src/plugin-sdk/channel-inbound.ts", status: "deprecated-public" },
  { symbol: "filterChannelTurnSupplementalContext", file: "src/plugin-sdk/channel-inbound.ts", status: "deprecated-public" },
  { symbol: "resolveChannelIngressAccess", file: "src/plugin-sdk/channel-ingress.ts", status: "deprecated-public" },
  { symbol: "queueAgentHarnessMessage", file: "src/plugin-sdk/agent-harness-runtime.ts", status: "deprecated-public" },
  { symbol: "PersistedThreadBindingsPayload", file: "extensions/discord/src/monitor/thread-bindings.types.ts", status: "deprecated-public" },
];