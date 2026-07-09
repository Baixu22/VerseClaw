import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { validateRoleContract, type RoleContract } from "./role-contract.js";
import type { AgencyDraftRoleEntry } from "./agency-draft-catalog.js";

type AgencySourceAgent = {
  sourceDivision?: string;
  agent: Record<string, unknown>;
};

export type AgencyRepositoryCatalog = {
  entries: AgencyDraftRoleEntry[];
  divisions: Record<string, Record<string, unknown>>;
  tools: Record<string, Record<string, unknown>>;
  runbooks: Array<Record<string, unknown>>;
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

function objectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(recordValue).filter((entry) => Object.keys(entry).length > 0) : [];
}

function kebabCase(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^[a-z]/.test(normalized) ? normalized : `agency-${normalized || "role"}`;
}

function parseJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  return recordValue(JSON.parse(readFileSync(path, "utf8")));
}

function parseFrontmatter(source: string): { data: Record<string, unknown>; body: string } {
  const normalized = source.replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/m.exec(normalized);
  if (!match) {
    return { data: {}, body: normalized };
  }
  const data: Record<string, unknown> = {};
  for (const rawLine of match[1]!.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    data[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
  return { data, body: match[2] ?? "" };
}

function titleFromMarkdown(body: string): string | undefined {
  const heading = body.match(/^#\s+(.+)$/m)?.[1];
  return stringValue(heading?.replace(/\s+Agent$/i, ""));
}

function slugFromRelativePath(relativePath: string): { division?: string; slug: string } {
  const normalized = relativePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const file = parts.at(-1) ?? normalized;
  return {
    division: parts.length > 1 ? parts[0] : undefined,
    slug: file.replace(/\.md$/i, ""),
  };
}

function collectMarkdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectMarkdownFiles(path);
    }
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  }).sort();
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

export function parseAgencyAgentMarkdown(relativePath: string, source: string): { division?: string; agent: Record<string, unknown> } {
  const { division, slug } = slugFromRelativePath(relativePath);
  const { data, body } = parseFrontmatter(source);
  const name = stringValue(data.name) ?? titleFromMarkdown(body) ?? slug;
  const description = stringValue(data.description);
  return {
    division,
    agent: {
      id: slug,
      roleName: slug,
      name,
      ...(description ? { description } : {}),
      prompt: body.trim(),
      frontmatter: data,
    },
  };
}

export function importAgencyDraftRolesFromRepository(rootDir: string): AgencyRepositoryCatalog {
  const divisionsRoot = recordValue(parseJsonFile(join(rootDir, "divisions.json")).divisions);
  const toolsRoot = recordValue(parseJsonFile(join(rootDir, "tools.json")).tools);
  const runbooksRoot = objectArray(parseJsonFile(join(rootDir, "strategy", "runbooks.json")).runbooks);
  const agents: AgencySourceAgent[] = [];

  for (const division of Object.keys(divisionsRoot).sort()) {
    const divisionDir = join(rootDir, division);
    if (!existsSync(divisionDir)) {
      continue;
    }
    for (const fullPath of collectMarkdownFiles(divisionDir)) {
      const parsed = parseAgencyAgentMarkdown(relative(rootDir, fullPath), readFileSync(fullPath, "utf8"));
      agents.push({ sourceDivision: parsed.division ?? division, agent: parsed.agent });
    }
  }

  return {
    entries: importAgencyDraftRoles({ divisions: Object.keys(divisionsRoot).map((division) => ({
      name: division,
      agents: agents.filter((entry) => entry.sourceDivision === division).map((entry) => entry.agent),
    })) }),
    divisions: divisionsRoot as Record<string, Record<string, unknown>>,
    tools: toolsRoot as Record<string, Record<string, unknown>>,
    runbooks: runbooksRoot,
  };
}
