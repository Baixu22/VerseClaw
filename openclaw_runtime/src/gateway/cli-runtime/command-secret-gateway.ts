// P5-2 CLI/TUI Deletion: gateway-routed command secret resolver stub.
//
// The original `cli/command-secret-gateway.ts` was retired along with
// the `cli/` directory. This stub preserves the public surface so that
// downstream tools (e.g. `agents/tools/message-tool.ts`) can still
// route secret resolution through the gateway when running headless
// without a CLI attached.

export type ResolveCommandSecretRefsMode = "enforce_resolved" | "best_effort";

export type ResolveCommandSecretRefsViaGatewayOptions = {
  config: unknown;
  commandName: string;
  targetIds: readonly string[];
  allowedPaths?: readonly string[];
  mode: ResolveCommandSecretRefsMode;
};

export type ResolveCommandSecretRefsViaGatewayResult = {
  resolvedConfig: unknown;
  resolvedRefs: readonly { targetId: string; value: string }[];
  missingRefs: readonly string[];
};

export async function resolveCommandSecretRefsViaGateway(
  options: ResolveCommandSecretRefsViaGatewayOptions,
): Promise<ResolveCommandSecretRefsViaGatewayResult> {
  // P5-2: the CLI gateway channel is no longer wired in the runtime;
  // callers still get a valid (empty) result envelope so the tool layer
  // can short-circuit cleanly.
  return {
    resolvedConfig: options.config,
    resolvedRefs: [],
    missingRefs: options.mode === "enforce_resolved" ? [...options.targetIds] : [],
  };
}
