/**
 * Ensures runtime plugin registries are loaded for agent execution. Startup
 * plugin IDs from metadata scope the load when available.
 */
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { applyPluginAutoEnable } from "../config/plugin-auto-enable.js";
import { resolvePluginActivationSourceConfig } from "../plugins/activation-source-config.js";
import { normalizePluginsConfig } from "../plugins/config-state.js";
import { getCurrentPluginMetadataSnapshot } from "../plugins/current-plugin-metadata-snapshot.js";
import { extractPluginInstallRecordsFromInstalledPluginIndex } from "../plugins/installed-plugin-index-install-records.js";
import { getActivePluginRuntimeSubagentMode } from "../plugins/runtime.js";
import { ensureStandaloneRuntimePluginRegistryLoaded } from "../plugins/runtime/standalone-runtime-registry-loader.js";
import { resolveUserPath } from "../utils.js";

type StartupScopedPluginSnapshot = NonNullable<
  ReturnType<typeof getCurrentPluginMetadataSnapshot>
> & {
  startup?: {
    pluginIds?: readonly unknown[];
  };
};

function resolveStartupPluginScopeFromCurrentSnapshot(params: {
  config?: OpenClawConfig;
  workspaceDir?: string;
}) {
  const snapshot = getCurrentPluginMetadataSnapshot({
    config: params.config,
    workspaceDir: params.workspaceDir,
    // Startup IDs belong to this Gateway scope; the owner still checks roots and workspace.
    allowScopedSnapshot: true,
  }) as StartupScopedPluginSnapshot | undefined;
  const pluginIds = snapshot?.startup?.pluginIds;
  if (!snapshot || !Array.isArray(pluginIds)) {
    return undefined;
  }
  const activationSourceConfig = resolvePluginActivationSourceConfig({ config: params.config });
  // Startup and agent loads qualify the same registry with source activation facts.
  // Runtime defaults cannot replace the original auto-enable reasons in that key.
  const activation = applyPluginAutoEnable({
    config: activationSourceConfig,
    env: process.env,
    manifestRegistry: snapshot.manifestRegistry,
    discovery: snapshot.discovery,
  });
  return {
    pluginIds: pluginIds.filter((pluginId): pluginId is string => typeof pluginId === "string"),
    loadOptions: {
      activationSourceConfig,
      autoEnabledReasons: activation.autoEnabledReasons,
      manifestRegistry: snapshot.manifestRegistry,
      installRecords: extractPluginInstallRecordsFromInstalledPluginIndex(snapshot.index),
    },
  };
}

/** Ensure standalone runtime plugins are loaded for the current agent context. */
export function ensureRuntimePluginsLoaded(params: {
  config?: OpenClawConfig;
  workspaceDir?: string | null;
  allowGatewaySubagentBinding?: boolean;
}): void {
  if (params.config && !normalizePluginsConfig(params.config.plugins).enabled) {
    return;
  }
  const workspaceDir =
    typeof params.workspaceDir === "string" && params.workspaceDir.trim()
      ? resolveUserPath(params.workspaceDir)
      : undefined;
  const startupScope = resolveStartupPluginScopeFromCurrentSnapshot({
    config: params.config,
    workspaceDir,
  });
  const startupPluginIds = startupScope?.pluginIds;
  const allowGatewaySubagentBinding =
    params.allowGatewaySubagentBinding === true ||
    getActivePluginRuntimeSubagentMode() === "gateway-bindable";
  ensureStandaloneRuntimePluginRegistryLoaded({
    requiredPluginIds: startupPluginIds,
    loadOptions: {
      config: params.config,
      workspaceDir,
      ...startupScope?.loadOptions,
      ...(startupPluginIds === undefined ? {} : { onlyPluginIds: startupPluginIds }),
      runtimeOptions: allowGatewaySubagentBinding
        ? { allowGatewaySubagentBinding: true }
        : undefined,
    },
  });
}
