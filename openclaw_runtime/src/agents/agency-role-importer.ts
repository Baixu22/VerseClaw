import { validateRoleContract, type RoleContract } from "./role-contract.js";
import type { AgencyDraftRoleEntry } from "./agency-draft-catalog.js";

type AgencySourceAgent = {
  sourceDivision?: string;
  agent: Record<string, unknown>;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const text = stringValue(entry);
      return text ? [text] : [];
    });
  }
  const text = stringValue(value);
  return text ? [text] : [];
}

function kebabCase(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^[a-z]/.test(normalized) ? normalized : `agency-${normalized || "role"}`;
}

function collectAgents(source: unknown): AgencySourceAgent[] {
  if (Array.isArray(source)) {
    return source.map((agent) => ({ agent: recordValue(agent) }));
  }
  const root = recordValue(source);
  const divisions = Array.isArray(root.divisions) ? root.divisions : [];
  const fromDivisions = divisions.flatMap((rawDivision) => {
    const division = recordValue(rawDivision);
    const sourceDivision = stringValue(division.name ?? division.division);
    const agents = Array.isArray(division.agents) ? division.agents : [];
    return agents.map((agent) => ({ sourceDivision, agent: recordValue(agent) }));
  });
  const rootAgents = Array.isArray(root.agents)
    ? root.agents.map((agent) => ({ agent: recordValue(agent) }))
    : [];
  return [...fromDivisions, ...rootAgents];
}

function buildCandidate(params: {
  roleName: string;
  displayName: string;
  description?: string;
  capabilityHints: string[];
  handoffHints: string[];
}): RoleContract {
  return {
    name: params.roleName,
    displayName: params.displayName,
    description: params.description,
    rolePrompt: params.description ?? "",
    tools: [],
    capabilities: params.capabilityHints,
    toolRequirements: [],
    riskProfile: "medium",
    canModifyScope: false,
    permissions: { filesystem: "read", network: "none", commands: [] },
    model: { default: null, fallback: [] },
    effort: "medium",
    outputSchema: { format: "markdown", sections: ["Summary", "Evidence"] },
    handoff: { to: [], from: [], requiresReview: params.handoffHints.length > 0 },
    tags: ["agency-draft"],
  };
}

export function importAgencyDraftRoles(source: unknown): AgencyDraftRoleEntry[] {
  return collectAgents(source).map(({ sourceDivision, agent }) => {
    const sourceAgentName = stringValue(agent.name ?? agent.agentName ?? agent.id) ?? "Unnamed Agency Agent";
    const roleName = kebabCase(stringValue(agent.roleName ?? agent.role) ?? sourceAgentName);
    const description = stringValue(agent.description ?? agent.prompt ?? agent.instructions);
    const capabilityHints = stringArray(agent.capabilities ?? agent.capabilityHints);
    const toolHints = stringArray(agent.tools ?? agent.toolHints ?? agent.toolRequirements);
    const handoffHints = stringArray(agent.handoff ?? agent.handoffs ?? agent.handoffHints);
    const roleCandidate = buildCandidate({
      roleName,
      displayName: sourceAgentName,
      description,
      capabilityHints,
      handoffHints,
    });
    const validation = validateRoleContract(roleCandidate);
    return {
      id: `agency:${sourceDivision ? `${kebabCase(sourceDivision)}:` : ""}${roleName}`,
      status: "draft",
      source: "agency",
      ...(sourceDivision ? { sourceDivision } : {}),
      sourceAgentName,
      roleName,
      displayName: sourceAgentName,
      ...(description ? { description } : {}),
      capabilityHints,
      toolHints,
      handoffHints,
      roleCandidate,
      validationIssues: validation.issues,
    };
  });
}
