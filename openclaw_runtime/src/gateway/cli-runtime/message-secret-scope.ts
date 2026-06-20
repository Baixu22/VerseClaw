// P5-2 CLI/TUI Deletion: per-message secret scope resolver stub.
//
// The original `cli/message-secret-scope.ts` was retired along with
// the `cli/` directory. This stub preserves the public surface used by
// the message tool to pick the effective (channel, accountId) for
// resolving secret refs without the CLI orchestrator.

export type ResolveMessageSecretScopeOptions = {
  channel?: string | undefined;
  target?: string | undefined;
  targets?: readonly string[] | undefined;
  fallbackChannel?: string | undefined;
  accountId?: string | undefined;
  fallbackAccountId?: string | undefined;
};

export type MessageSecretScope = {
  channel: string;
  accountId?: string | undefined;
};

export function resolveMessageSecretScope(
  options: ResolveMessageSecretScopeOptions,
): MessageSecretScope {
  const channel = options.channel ?? options.fallbackChannel ?? "default";
  const accountId = options.accountId ?? options.fallbackAccountId;
  const result: MessageSecretScope = { channel };
  if (accountId !== undefined) result.accountId = accountId;
  return result;
}
