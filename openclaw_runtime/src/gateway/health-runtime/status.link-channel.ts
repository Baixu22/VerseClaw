// Resolves the first read-only channel that reports explicit linked state.
import { resolveInspectedChannelAccount } from "../../channels/account-inspection.js";
import { resolveChannelDefaultAccountId } from "../../channels/plugins/helpers.js";
import { listReadOnlyChannelPluginsForConfig } from "../../channels/plugins/read-only.js";
import type { ChannelPlugin } from "../../channels/plugins/types.plugin.js";
import type { ChannelAccountSnapshot } from "../../channels/plugins/types.public.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";

type LinkChannelContext = {
  linked: boolean;
  authAgeMs: number | null;
  account?: unknown;
  accountId?: string;
  plugin: ChannelPlugin;
};

/** Returns link status for the first configured channel that explicitly reports it. */
export async function resolveLinkChannelContext(
  cfg: OpenClawConfig,
  options: { sourceConfig?: OpenClawConfig } = {},
): Promise<LinkChannelContext | null> {
  const sourceConfig = options.sourceConfig ?? cfg;
  const plugins = listReadOnlyChannelPluginsForConfig(cfg, {
    activationSourceConfig: sourceConfig,
    includeSetupFallbackPlugins: false,
  });

  for (const plugin of plugins) {
    try {
      const accountIds = plugin.config.listAccountIds(cfg);
      const defaultAccountId = resolveChannelDefaultAccountId({
        plugin,
        cfg,
        accountIds,
      });
      const { account, enabled, configured } = await resolveInspectedChannelAccount({
        plugin,
        cfg,
        sourceConfig,
        accountId: defaultAccountId,
      });
      const snapshot: ChannelAccountSnapshot = plugin.config.describeAccount
        ? plugin.config.describeAccount(account, cfg)
        : {
            accountId: defaultAccountId,
            enabled,
            configured,
          };
      const summary = plugin.status?.buildChannelSummary
        ? await plugin.status.buildChannelSummary({
            account,
            cfg,
            defaultAccountId,
            snapshot,
          })
        : undefined;
      const linked = typeof summary?.linked === "boolean" ? summary.linked : null;
      if (linked === null) {
        continue;
      }
      const authAgeMs =
        typeof summary?.authAgeMs === "number" ? summary.authAgeMs : null;
      return {
        linked,
        authAgeMs,
        account,
        accountId: defaultAccountId,
        plugin,
      };
    } catch {
      // Status is read-only and best-effort; continue to the next configured plugin.
    }
  }

  return null;
}
