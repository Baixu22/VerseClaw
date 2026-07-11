import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { normalizeOptionalAccountId } from "../../routing/account-id.js";
import {
  discoverConfigSecretTargetsByIds,
  listSecretTargetRegistryEntries,
} from "../../secrets/target-registry.js";

const STATIC_AGENT_RUNTIME_BASE_TARGET_IDS = [
  "models.providers.*.apiKey",
  "models.providers.*.headers.*",
  "models.providers.*.request.headers.*",
  "models.providers.*.request.auth.token",
  "models.providers.*.request.auth.value",
  "models.providers.*.request.proxy.tls.ca",
  "models.providers.*.request.proxy.tls.cert",
  "models.providers.*.request.proxy.tls.key",
  "models.providers.*.request.proxy.tls.passphrase",
  "models.providers.*.request.tls.ca",
  "models.providers.*.request.tls.cert",
  "models.providers.*.request.tls.key",
  "models.providers.*.request.tls.passphrase",
  "agents.defaults.memorySearch.remote.apiKey",
  "agents.list[].memorySearch.remote.apiKey",
  "agents.list[].tts.providers.*.apiKey",
  "messages.tts.providers.*.apiKey",
  "skills.entries.*.apiKey",
  "tools.web.search.apiKey",
  "tools.web.fetch.firecrawl.apiKey",
] as const;

function channelTargetIds(channel?: string): Set<string> {
  const prefix = channel ? `channels.${channel}.` : "channels.";
  return new Set(
    listSecretTargetRegistryEntries()
      .map((entry) => entry.id)
      .filter((id) => id.startsWith(prefix))
      .toSorted((left, right) => left.localeCompare(right)),
  );
}

export type GetScopedChannelsCommandSecretTargetsOptions = {
  config: OpenClawConfig;
  channel?: string;
  accountId?: string;
};

export type ScopedCommandSecretTargets = {
  targetIds: Set<string>;
  allowedPaths?: ReadonlySet<string>;
};

export function getScopedChannelsCommandSecretTargets(
  options: GetScopedChannelsCommandSecretTargetsOptions,
): ScopedCommandSecretTargets {
  const channel = normalizeOptionalString(options.channel);
  const targetIds = channelTargetIds(channel);
  const accountId = normalizeOptionalAccountId(options.accountId);
  if (!channel || !accountId) {
    return { targetIds };
  }

  const allowedPaths = new Set<string>();
  for (const target of discoverConfigSecretTargetsByIds(options.config, targetIds)) {
    const [root, targetChannel, accountRoot, targetAccount] = target.pathSegments;
    if (
      root === "channels" &&
      targetChannel === channel &&
      (accountRoot !== "accounts" || targetAccount === accountId)
    ) {
      allowedPaths.add(target.path);
    }
  }
  return { targetIds, allowedPaths };
}

export function getAgentRuntimeCommandSecretTargetIds(
  options: { includeChannelTargets?: boolean } = {},
): Set<string> {
  const targetIds = new Set<string>(STATIC_AGENT_RUNTIME_BASE_TARGET_IDS);
  for (const entry of listSecretTargetRegistryEntries()) {
    const id = entry.id;
    const pluginWebCredential =
      /^plugins\.entries\.[^.]+\.config\.(webSearch|webFetch)\.apiKey$/.test(id);
    if (pluginWebCredential || (options.includeChannelTargets === true && id.startsWith("channels."))) {
      targetIds.add(id);
    }
  }
  return targetIds;
}
