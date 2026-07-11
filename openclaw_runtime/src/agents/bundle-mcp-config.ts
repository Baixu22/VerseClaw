/**
 * Merges bundled plugin MCP servers with user-configured MCP servers for agent
 * runtimes.
 */
import { normalizeConfiguredMcpServers } from "../config/mcp-config-normalize.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { normalizeAgentId } from "../routing/session-key.js";
import {
  loadEnabledBundleMcpConfig,
  type BundleMcpConfig,
  type BundleMcpDiagnostic,
  type BundleMcpServerConfig,
} from "../plugins/bundle-mcp.js";
import type { PluginManifestRegistry } from "../plugins/manifest-registry.js";

type MergedBundleMcpConfig = {
  config: BundleMcpConfig;
  diagnostics: BundleMcpDiagnostic[];
};

type BundleMcpServerMapper = (server: BundleMcpServerConfig, name: string) => BundleMcpServerConfig;
export type BundleMcpExposureContext = {
  agentId?: string | null;
  workspaceId?: string | null;
  roleName?: string | null;
};

const OPENCLAW_TRANSPORT_TO_CLI_BUNDLE_TYPE: Record<string, string> = {
  "streamable-http": "http",
  http: "http",
  sse: "sse",
  stdio: "stdio",
};

/**
 * User config stores OpenClaw MCP transport names, while CLI backends such as
 * Claude Code and Gemini expect a downstream `type` field. Keep this adapter
 * out of the generic merge path because embedded OpenClaw still consumes the raw
 * OpenClaw `transport` shape directly.
 */
export function toCliBundleMcpServerConfig(server: BundleMcpServerConfig): BundleMcpServerConfig {
  const next = { ...server } as Record<string, unknown>;
  const rawTransport = next.transport;
  delete next.transport;
  if (typeof next.type === "string") {
    return next as BundleMcpServerConfig;
  }
  if (typeof rawTransport === "string") {
    const mapped = OPENCLAW_TRANSPORT_TO_CLI_BUNDLE_TYPE[rawTransport];
    if (mapped) {
      next.type = mapped;
    }
  }
  return next as BundleMcpServerConfig;
}

/** Loads enabled bundled MCP servers and overlays user config by server name. */
export function loadMergedBundleMcpConfig(params: {
  workspaceDir: string;
  cfg?: OpenClawConfig;
  manifestRegistry?: Pick<PluginManifestRegistry, "plugins">;
  mapConfiguredServer?: BundleMcpServerMapper;
  exposureContext?: BundleMcpExposureContext;
}): MergedBundleMcpConfig {
  const bundleMcp = loadEnabledBundleMcpConfig({
    workspaceDir: params.workspaceDir,
    cfg: params.cfg,
    manifestRegistry: params.manifestRegistry,
  });
  const configuredMcp = normalizeConfiguredMcpServers(params.cfg?.mcp?.servers);
  const disabledConfiguredNames = new Set(
    Object.entries(configuredMcp)
      .filter(([, server]) => server.enabled === false)
      .map(([name]) => name),
  );
  const enabledConfiguredMcp = Object.fromEntries(
    Object.entries(configuredMcp).filter(([, server]) => server.enabled !== false),
  );
  const enabledBundleMcp = Object.fromEntries(
    Object.entries(bundleMcp.config.mcpServers).filter(
      ([name]) => !disabledConfiguredNames.has(name),
    ),
  );
  const mapConfiguredServer = params.mapConfiguredServer ?? ((server) => server);
  const filterServer = ([name, server]: [string, BundleMcpServerConfig]) =>
    isBundleMcpServerExposed(server, params.exposureContext, name);

  return {
    config: {
      // OpenClaw config is the owner-managed layer, so it overrides bundle defaults.
      mcpServers: {
        ...Object.fromEntries(
          Object.entries(enabledBundleMcp).filter(filterServer),
        ),
        ...Object.fromEntries(
          Object.entries(enabledConfiguredMcp)
            .map(([name, server]) => [
              name,
              mapConfiguredServer(server as BundleMcpServerConfig, name),
            ] as [string, BundleMcpServerConfig])
            .filter(filterServer),
        ),
      } satisfies BundleMcpConfig["mcpServers"],
    },
    diagnostics: bundleMcp.diagnostics,
  };
}

function normalizeComparable(value: string | undefined | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeList(value: unknown, normalize = normalizeComparable): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => normalize(entry))
    .filter(Boolean);
}

function readExposure(server: BundleMcpServerConfig): Record<string, unknown> | undefined {
  const exposure = (server as Record<string, unknown>).exposure;
  return exposure && typeof exposure === "object" && !Array.isArray(exposure)
    ? exposure as Record<string, unknown>
    : undefined;
}

function isBundleMcpServerExposed(
  server: BundleMcpServerConfig,
  context: BundleMcpExposureContext | undefined,
  _name: string,
): boolean {
  if (!context) {
    return true;
  }
  const exposure = readExposure(server);
  if (!exposure) {
    return true;
  }
  const agentIds = normalizeList(exposure.agents, (value) => normalizeAgentId(value));
  const workspaceIds = normalizeList(exposure.workspaces);
  const roleNames = normalizeList(exposure.roles);
  const hasAgentRestriction = Object.hasOwn(exposure, "agents");
  const hasWorkspaceRestriction = Object.hasOwn(exposure, "workspaces");
  const hasRoleRestriction = Object.hasOwn(exposure, "roles");
  if (!hasAgentRestriction && !hasWorkspaceRestriction && !hasRoleRestriction) {
    return true;
  }
  const agentId = context.agentId ? normalizeAgentId(context.agentId) : "";
  const workspaceId = normalizeComparable(context.workspaceId);
  const roleName = normalizeComparable(context.roleName);
  return (
    (hasAgentRestriction && agentId.length > 0 && agentIds.includes(agentId)) ||
    (hasWorkspaceRestriction && workspaceId.length > 0 && workspaceIds.includes(workspaceId)) ||
    (hasRoleRestriction && roleName.length > 0 && roleNames.includes(roleName))
  );
}
