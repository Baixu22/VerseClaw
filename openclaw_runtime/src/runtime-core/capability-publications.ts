import { loadMergedBundleMcpConfig } from "../agents/bundle-mcp-config.js";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { resolveRoleContract } from "../agents/role-registry.js";
import type { RoleContract } from "../agents/role-contract.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveEffectiveAgentSkillFilter } from "../skills/discovery/agent-filter.js";
import { buildSkillIndexEntries } from "../skills/discovery/skill-index.js";
import { resolveSkillKey } from "../skills/loading/frontmatter.js";
import { resolveSkillSource } from "../skills/loading/source.js";
import { loadWorkspaceSkillEntries } from "../skills/loading/workspace.js";

export type CapabilityPublicationQuery = {
  agentId?: string | null;
  workspaceId?: string | null;
  roleName?: string | null;
  includeDiagnostics?: boolean;
  includeCandidates?: boolean;
  includeToolCatalog?: "none" | "warmOnly";
};

export type CapabilityPublicationDiagnostic = {
  code: string;
  severity: "info" | "warning" | "blocked";
  message: string;
  details?: Record<string, unknown>;
};

export type CapabilityPublicationEntry = {
  id: string;
  kind: "skill" | "mcp";
  sourceId: string;
  name: string;
  owner: { type: "global" | "agent" | "workspace" | "role" | "unknown"; id?: string | null };
  scope?: "global" | "agent" | "workspace" | "role" | "unknown";
  source?: "runtime" | "local" | "bundled" | "workspace" | "mcp-json" | "registered" | "unknown";
  state: "published" | "available" | "disabled" | "blocked" | "missing" | "runtimeUnavailable";
  exposure: {
    agentIds?: string[];
    workspaceIds?: string[];
    roleNames?: string[];
    promptVisible?: boolean;
    runtimeVisible?: boolean;
    userInvocable?: boolean;
    toolVisible?: boolean;
  };
  useModes: Array<"prompt" | "modelTool" | "userCommand" | "adminAction">;
  runtime: {
    status: "ready" | "configured" | "warm" | "cold" | "disabled" | "blocked" | "missing" | "unavailable";
    method?: "prompt" | "tool" | "config" | "fallback";
    source?: "gateway" | "local-fallback" | "electron-store" | "openclaw-config";
    message?: string;
  };
  toolNames?: string[];
  reasons: string[];
  diagnostics: CapabilityPublicationDiagnostic[];
  skillId?: string;
  serverId?: string;
};

export type CapabilityPublicationResult = {
  success: true;
  source: "gateway";
  generatedAt: string;
  publications: CapabilityPublicationEntry[];
  diagnostics: CapabilityPublicationDiagnostic[];
};

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function diagnostic(
  code: string,
  severity: CapabilityPublicationDiagnostic["severity"],
  message: string,
  details?: Record<string, unknown>,
): CapabilityPublicationDiagnostic {
  return { code, severity, message, ...(details ? { details } : {}) };
}

function mapSkillSource(source: string): CapabilityPublicationEntry["source"] {
  if (source === "workspace") {
    return "workspace";
  }
  if (source === "openclaw-bundled" || source === "bundled") {
    return "bundled";
  }
  if (source === "unknown") {
    return "unknown";
  }
  return "local";
}

function roleToolSet(role?: RoleContract): Set<string> | undefined {
  if (!role || !Array.isArray(role.tools) || role.tools.length === 0) {
    return undefined;
  }
  return new Set(role.tools.map((tool) => normalizeComparable(tool)).filter(Boolean));
}

function roleAllowsPublication(
  roleTools: Set<string> | undefined,
  entry: Pick<CapabilityPublicationEntry, "kind" | "sourceId" | "name" | "id">,
): boolean {
  if (!roleTools || roleTools.size === 0 || roleTools.has("*")) {
    return true;
  }
  const candidates = [
    entry.id,
    entry.sourceId,
    entry.name,
    `${entry.kind}:${entry.sourceId}`,
    `${entry.kind}:${entry.name}`,
    entry.kind,
  ].map((candidate) => normalizeComparable(candidate));
  return candidates.some((candidate) => roleTools.has(candidate));
}

function applyRolePolicy(
  entry: CapabilityPublicationEntry,
  role: RoleContract | undefined,
): CapabilityPublicationEntry {
  const tools = roleToolSet(role);
  if (!role || roleAllowsPublication(tools, entry)) {
    return entry;
  }
  return {
    ...entry,
    state: "blocked",
    runtime: {
      ...entry.runtime,
      status: "blocked",
      message: `Blocked by role "${role.name}" tool policy.`,
    },
    reasons: [...entry.reasons, "role-tools-filter"],
    diagnostics: [
      ...entry.diagnostics,
      diagnostic(
        "roleToolsFilter",
        "blocked",
        `Role "${role.name}" does not list this capability in tools.`,
        { roleName: role.name },
      ),
    ],
  };
}

function resolveWorkspaceDir(params: {
  cfg: OpenClawConfig;
  agentId?: string;
  workspaceId?: string;
}): string {
  return params.workspaceId || resolveAgentWorkspaceDir(params.cfg, params.agentId ?? "main");
}

function skillPublications(params: {
  cfg: OpenClawConfig;
  agentId?: string;
  workspaceDir: string;
  role?: RoleContract;
  includeCandidates?: boolean;
}): CapabilityPublicationEntry[] {
  const skillFilter = params.agentId
    ? resolveEffectiveAgentSkillFilter(params.cfg, params.agentId)
    : undefined;
  const entries = loadWorkspaceSkillEntries(params.workspaceDir, {
    config: params.cfg,
    agentId: params.includeCandidates ? undefined : params.agentId,
  });
  const indexed = buildSkillIndexEntries(entries, {
    agentSkillFilter: params.includeCandidates ? undefined : skillFilter,
  });
  return indexed.map((skill) => {
    const skillKey = resolveSkillKey(skill.entry.skill, skill.entry);
    const source = mapSkillSource(resolveSkillSource(skill.entry.skill));
    const selected = skillFilter === undefined
      || skillFilter.includes(skill.name)
      || skillFilter.includes(skillKey);
    if (!params.includeCandidates && !selected) {
      return null;
    }
    const useModes: CapabilityPublicationEntry["useModes"] = ["adminAction"];
    if (selected && skill.promptVisible) {
      useModes.unshift("prompt");
    }
    if (selected && skill.userInvocable) {
      useModes.push("userCommand");
    }
    const runtimeVisible = selected && skill.runtimeVisible;
    const entry: CapabilityPublicationEntry = {
      id: `skill:${skillKey}`,
      kind: "skill",
      sourceId: skillKey,
      name: skill.name,
      owner: { type: params.agentId ? "agent" : "unknown", id: params.agentId ?? null },
      scope: params.agentId ? "agent" : "unknown",
      source,
      state: runtimeVisible ? "published" : selected ? "disabled" : "available",
      exposure: {
        agentIds: selected && params.agentId ? [normalizeAgentId(params.agentId)] : undefined,
        promptVisible: selected && skill.promptVisible,
        runtimeVisible,
        userInvocable: selected && skill.userInvocable,
      },
      useModes: [...new Set(useModes)],
      runtime: {
        status: runtimeVisible ? "ready" : selected ? "disabled" : "cold",
        method: "prompt",
        source: "gateway",
        message: selected ? undefined : "Skill is available but is not published for this agent.",
      },
      reasons: [
        "runtime-skill-discovery",
        ...(skillFilter === undefined ? ["agent-skill-filter-unset"] : ["agent-skill-filter-applied"]),
        ...(selected ? ["agent-skill-selected"] : ["agent-skill-candidate"]),
      ],
      diagnostics: [],
      skillId: skillKey,
    };
    return applyRolePolicy(entry, params.role);
  }).filter((entry): entry is CapabilityPublicationEntry => entry !== null);
}

function readExposure(server: Record<string, unknown>): Record<string, unknown> | undefined {
  const exposure = server.exposure;
  return exposure && typeof exposure === "object" && !Array.isArray(exposure)
    ? exposure as Record<string, unknown>
    : undefined;
}

function isConfiguredMcpServer(cfg: OpenClawConfig, name: string): boolean {
  return Boolean(cfg.mcp?.servers && Object.hasOwn(cfg.mcp.servers, name));
}

function mcpPublications(params: {
  cfg: OpenClawConfig;
  workspaceDir: string;
  workspaceId?: string;
  agentId?: string;
  roleName?: string;
  role?: RoleContract;
  includeCandidates?: boolean;
}): CapabilityPublicationEntry[] {
  const merged = loadMergedBundleMcpConfig({
    workspaceDir: params.workspaceDir,
    cfg: params.cfg,
    exposureContext: params.includeCandidates ? undefined : {
      agentId: params.agentId,
      workspaceId: params.workspaceId ?? params.workspaceDir,
      roleName: params.roleName,
    },
  });
  return Object.entries(merged.config.mcpServers).map(([name, raw]) => {
    const server = raw as Record<string, unknown>;
    const exposure = readExposure(server);
    const agentIds = normalizeList(exposure?.agents, (value) => normalizeAgentId(value));
    const workspaceIds = normalizeList(exposure?.workspaces);
    const roleNames = normalizeList(exposure?.roles);
    const configured = isConfiguredMcpServer(params.cfg, name);
    const hasAgentRestriction = Boolean(exposure && Object.hasOwn(exposure, "agents"));
    const hasWorkspaceRestriction = Boolean(exposure && Object.hasOwn(exposure, "workspaces"));
    const hasRoleRestriction = Boolean(exposure && Object.hasOwn(exposure, "roles"));
    const contextAgentId = params.agentId ? normalizeAgentId(params.agentId) : "";
    const contextWorkspaceId = normalizeComparable(params.workspaceId ?? params.workspaceDir);
    const contextRoleName = normalizeComparable(params.roleName);
    const exposed = !exposure
      || (!hasAgentRestriction && !hasWorkspaceRestriction && !hasRoleRestriction)
      || (hasAgentRestriction && contextAgentId.length > 0 && agentIds.includes(contextAgentId))
      || (
        hasWorkspaceRestriction
        && contextWorkspaceId.length > 0
        && workspaceIds.includes(contextWorkspaceId)
      )
      || (hasRoleRestriction && contextRoleName.length > 0 && roleNames.includes(contextRoleName));
    if (!params.includeCandidates && !exposed) {
      return null;
    }
    const owner = agentIds.length > 0
      ? { type: "agent" as const, id: agentIds[0] }
      : workspaceIds.length > 0
        ? { type: "workspace" as const, id: workspaceIds[0] }
        : roleNames.length > 0
          ? { type: "role" as const, id: roleNames[0] }
          : { type: "global" as const, id: null };
    const entry: CapabilityPublicationEntry = {
      id: `mcp:${name}`,
      kind: "mcp",
      sourceId: name,
      name,
      owner,
      scope: owner.type,
      source: configured ? "registered" : "bundled",
      state: exposed ? "published" : "available",
      exposure: {
        agentIds: agentIds.length > 0 ? agentIds : undefined,
        workspaceIds: workspaceIds.length > 0 ? workspaceIds : undefined,
        roleNames: roleNames.length > 0 ? roleNames : undefined,
        runtimeVisible: exposed,
        toolVisible: exposed,
      },
      useModes: exposed ? ["modelTool", "adminAction"] : ["adminAction"],
      runtime: {
        status: exposed ? "configured" : "cold",
        method: "tool",
        source: "gateway",
        message: exposed ? undefined : "MCP server is configured but is not published for this context.",
      },
      reasons: [
        configured ? "openclaw-config-mcp" : "bundled-mcp",
        exposed ? "mcp-exposed" : "mcp-candidate",
      ],
      diagnostics: exposure ? [] : [
        diagnostic(
          "legacyGlobalMcpExposure",
          "info",
          "MCP server has no exposure filter; legacy global availability is preserved.",
        ),
      ],
      serverId: name,
    };
    return applyRolePolicy(entry, params.role);
  }).filter((entry): entry is CapabilityPublicationEntry => entry !== null);
}

function addRoleRequirementDiagnostics(
  publications: CapabilityPublicationEntry[],
  role: RoleContract | undefined,
): CapabilityPublicationDiagnostic[] {
  if (!role?.toolRequirements || role.toolRequirements.length === 0) {
    return [];
  }
  const publishedNames = new Set(
    publications.flatMap((entry) => [entry.id, entry.sourceId, entry.name])
      .map((entry) => normalizeComparable(entry))
      .filter(Boolean),
  );
  return role.toolRequirements
    .map((requirement) => normalizeComparable(requirement))
    .filter((requirement) => requirement && !publishedNames.has(requirement))
    .map((requirement) =>
      diagnostic(
        "roleToolRequirementMissing",
        "warning",
        `Role "${role.name}" requires "${requirement}", but it is not published in this context.`,
        { roleName: role.name, requirement },
      ),
    );
}

export function buildCapabilityPublicationResult(params: {
  cfg: OpenClawConfig;
  query?: CapabilityPublicationQuery;
}): CapabilityPublicationResult {
  const agentId = normalizeOptionalString(params.query?.agentId);
  const workspaceId = normalizeOptionalString(params.query?.workspaceId);
  const roleName = normalizeOptionalString(params.query?.roleName);
  const includeCandidates = params.query?.includeCandidates === true;
  const workspaceDir = resolveWorkspaceDir({ cfg: params.cfg, agentId, workspaceId });
  const role = roleName ? resolveRoleContract(roleName, params.cfg) : undefined;
  const diagnostics: CapabilityPublicationDiagnostic[] = [];
  if (roleName && !role) {
    diagnostics.push(
      diagnostic(
        "roleNotFound",
        "warning",
        `Role "${roleName}" was not found; publications are resolved without role narrowing.`,
        { roleName },
      ),
    );
  }
  const publications = [
    ...skillPublications({ cfg: params.cfg, agentId, workspaceDir, role, includeCandidates }),
    ...mcpPublications({ cfg: params.cfg, workspaceDir, workspaceId, agentId, roleName, role, includeCandidates }),
  ];
  diagnostics.push(...addRoleRequirementDiagnostics(publications, role));
  return {
    success: true,
    source: "gateway",
    generatedAt: new Date().toISOString(),
    publications,
    diagnostics,
  };
}
