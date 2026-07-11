import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { normalizeAccountId } from "../../routing/session-key.js";
import {
  isDeliverableMessageChannel,
  normalizeMessageChannel,
} from "../../utils/message-channel-normalize.js";

export type ResolveMessageSecretScopeOptions = {
  channel?: unknown;
  target?: unknown;
  targets?: unknown;
  fallbackChannel?: unknown;
  accountId?: unknown;
  fallbackAccountId?: unknown;
};

export type MessageSecretScope = {
  channel?: string;
  accountId?: string;
};

function resolveScopedChannelCandidate(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = normalizeMessageChannel(value);
  if (!normalized || !isDeliverableMessageChannel(normalized)) {
    return undefined;
  }
  return normalized;
}

function resolveChannelFromTargetValue(target: unknown): string | undefined {
  const trimmed = normalizeOptionalString(target);
  if (!trimmed) {
    return undefined;
  }
  const separator = trimmed.indexOf(":");
  if (separator <= 0) {
    return undefined;
  }
  return resolveScopedChannelCandidate(trimmed.slice(0, separator));
}

function resolveChannelFromTargets(targets: unknown): string | undefined {
  if (!Array.isArray(targets)) {
    return undefined;
  }
  const seen = new Set<string>();
  for (const target of targets) {
    const channel = resolveChannelFromTargetValue(target);
    if (channel) {
      seen.add(channel);
    }
  }
  return seen.size === 1 ? [...seen][0] : undefined;
}

function resolveScopedAccountId(value: unknown): string | undefined {
  const trimmed = normalizeOptionalString(value);
  return trimmed ? normalizeAccountId(trimmed) : undefined;
}

export function resolveMessageSecretScope(
  options: ResolveMessageSecretScopeOptions,
): MessageSecretScope {
  const channel =
    resolveScopedChannelCandidate(options.channel) ??
    resolveChannelFromTargetValue(options.target) ??
    resolveChannelFromTargets(options.targets) ??
    resolveScopedChannelCandidate(options.fallbackChannel);
  const accountId =
    resolveScopedAccountId(options.accountId) ??
    resolveScopedAccountId(options.fallbackAccountId);
  return {
    ...(channel ? { channel } : {}),
    ...(accountId ? { accountId } : {}),
  };
}
