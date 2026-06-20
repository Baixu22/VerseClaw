// P5-2 CLI/TUI Deletion: per-channel command secret target resolver stub.
//
// The original `cli/command-secret-targets.ts` was retired along with
// the `cli/` directory. This stub preserves the public surface used by
// the message tool to enumerate which secret targets are valid for a
// given (channel, account) pair.

import type { OpenClawConfig } from "../../config/types.openclaw.js";

export type GetScopedChannelsCommandSecretTargetsOptions = {
  config: OpenClawConfig;
  channel: string;
  accountId?: string | undefined;
};

export type ScopedCommandSecretTargets = {
  targetIds: readonly string[];
  allowedPaths?: readonly string[];
};

export function getScopedChannelsCommandSecretTargets(
  options: GetScopedChannelsCommandSecretTargetsOptions,
): ScopedCommandSecretTargets {
  // P5-2: there are no CLI-attached secret targets in the runtime, so the
  // scoped list is always empty. The shape is preserved so callers can
  // branch on it without conditional imports.
  return {
    targetIds: [],
    allowedPaths: undefined,
  };
}

// Back-compat alias for older callers (e.g. agents/agent-runtime-config.ts)
// that still invoke the no-arg `getAgentRuntimeCommandSecretTargetIds`.
export function getAgentRuntimeCommandSecretTargetIds(
  _options: { includeChannelTargets?: boolean } = {},
): readonly string[] {
  return [];
}
