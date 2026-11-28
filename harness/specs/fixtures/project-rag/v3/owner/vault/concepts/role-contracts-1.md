---
title: openclaw_runtime/src/agents/role-contract.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-10T04:49:07.401Z"
acl:
  read: [operator]
scope:
  workspaceId: rag-corpus-workspace
retention:
  policy: source-coupled
actor: codex/project-rag-corpus-author
driven_by: agent
---

# Repository source snapshot

Origin: openclaw_runtime/src/agents/role-contract.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
import { parse as parseYaml } from "yaml";

import { buildRolePermissionDenyList } from "./role-permissions-policy.js";

export type RolePermissionAccess = "none" | "read" | "write" | "admin";
export type RoleNetworkAccess = "none" | "limited" | "full";
export type RoleContractEffort = "auto" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type RolePermissions = {
  filesystem: RolePermissionAccess;
  network: RoleNetworkAccess;
  commands: string[];
  readPaths?: string[];
  writePaths?: string[];
};

export type RoleModelBinding = {
  default?: string | null;
  fallback?: string[];
  provider?: string | null;
};

export type RoleOutputSchema = {
  format: "markdown" | "json" | "text";
  sections?: string[];
  jsonSchema?: Record<string, unknown>;
};

export type RoleHandoffRules = {
  to: string[];
  from: string[];
  requiresReview?: boolean;
};

export type RoleContract = {
  name: string;
  displayName: string;
  description?: string;
  rolePrompt: string;
  tools: string[];
  capabilities?: string[];
  toolRequirements?: string[];
  riskProfile?: "low" | "medium" | "high" | "critical";
  canModifyScope?: boolean;
  permissions: RolePermissions;
  model: RoleModelBinding;
  effort: RoleContractEffort;
  outputSchema: RoleOutputSchema;
  handoff: RoleHandoffRules;
  version?: string;
  tags?: string[];
  /**
   * Area 3 §3.5: optional routing keywords for role-router scoring. Built-in
   * roles use the static `ROLE_KEYWORDS` table in role-router.ts; config-defined
   * (pack) roles declare their own keywords here so they can be routed by
   * user-authored language (CN/EN/mixed) without modifying the built-in table.
   * Normalized like `tags` (kebab-case trimmed, case-insensitive match). The
   * router applies the same +2 weight as built-in keyword matches.
   */
  routingKeywords?: string[];
  /**
   * Optional Persona fragment (bridge to AgentRoleProfile). Untyped passthrough
   * record runtime-side so this module stays free of cross-package imports; the
   * shared declaration (`shared/types/agent.ts`) types it as
   * `Partial<AgentRoleProfile>`. When present, `compileRoleContractToSoul`
   * appends a persona section to the compiled SOUL.
   */
  profile?: Record<string, unknown>;
};

export type RoleContractValidationSeverity = "error" | "warning";

export type RoleContractValidationIssue = {
  path: string;
  message: string;
  /**
   * `error` (default) blocks the contract; `warning` is a surfaced diagnostic
   * that does not change whether an existing configuration loads. Cross-field
   * conflicts between `tools` and `permissions` are warnings so a previously
   * accepted role is reported at registration instead of being silently dropped.
   */
  severity?: RoleContractValidationSeverity;
};

export type RoleContractValidationResult = {
  ok: boolean;
  issues: RoleContractValidationIssue[];
};

type RawRoleContract = Record<string, unknown>;

const FILESYSTEM_ACCESS: readonly RolePermissionAccess[] = ["none", "read", "write", "admin"];
const NETWORK_ACCESS: readonly RoleNetworkAccess[] = ["none", "limited", "full"];
const EFFORTS: readonly RoleContractEffort[] = [
  "auto",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const OUTPUT_FORMATS: readonly RoleOutputSchema["format"][] = ["markdown", "json", "text"];

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const stringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const text = stringValue(item);
    return text ? [text] : [];
  });
};

const recordValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** Like recordValue but returns undefined instead of {} for absent/invalid input. */
const optionalRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const text = stringValue(value)?.toLowerCase();
  return allowed.find((entry) => entry === text) ?? fallback;
}

function normalizePermissions(value: unknown): RolePermissions {
  const permissions = recordValue(value);
  return {
    filesystem: enumValue(permissions.filesystem, FILESYSTEM_ACCESS, "read"),
    network: enumValue(permissions.network, NETWORK_ACCESS, "none"),
    commands: stringArray(permissions.commands),
    readPaths: stringArray(permissions.read_paths ?? permissions.readPaths),
    writePaths: stringArray(permissions.write_paths ?? permissions.writePaths),
  };
}

function normalizeModel(value: unknown): RoleModelBinding {
  const model = recordValue(value);
  return {
    default: stringValue(model.default) ?? null,
    fallback: stringArray(model.fallback),
    provider: stringValue(model.provider) ?? null,
  };
}

function normalizeOutputSchema(value: unknown): RoleOutputSchema {
  const output = recordValue(value);
  const jsonSchema = recordValue(output.json_schema ?? output.jsonSchema);
  return {
    format: enumValue(output.format, OUTPUT_FORMATS, "markdown"),
    sections: stringArray(output.sections),
    jsonSchema: Object.keys(jsonSchema).length > 0 ? jsonSchema : undefined,
  };
}

function normalizeHandoff(value: unknown): RoleHandoffRules {
  const handoff = recordValue(value);
  return {
    to: stringArray(handoff.to),
    from: stringArray(handoff.from),
    requiresReview: handoff.requires_review === true || handoff.requiresReview === true,
  };
}

export function normalizeRoleContract(input: unknown): RoleContract {
  const raw = recordValue(input);
  const name = stringValue(raw.name) ?? "unnamed-role";
  const displayName = stringValue(raw.display_name ?? raw.displayName) ?? name;
  const rolePrompt = stringValue(raw.role_prompt ?? raw.rolePrompt) ?? stringValue(raw.prompt) ?? "";
  return {
    name,
    displayName,
    description: stringValue(raw.description),
    rolePrompt,
    tools: stringArray(raw.tools),
    capabilities: stringArray(raw.capabilities),
    toolRequirements: stringArray(raw.tool_requirements ?? raw.toolRequirements),
    riskProfile: enumValue(raw.risk_profile ?? raw.riskProfile, ["low", "medium", "high", "critical"] as const, "medium"),
    canModifyScope: raw.can_modify_scope === true || raw.canModifyScope === true,
    permissions: normalizePermissions(raw.permissions),
    model: normalizeModel(raw.model),
    effort: enumValue(raw.effort, EFFORTS, "medium"),
    outputSchema: normalizeOutputSchema(raw.output_schema ?? raw.outputSchema),
    handoff: normalizeHandoff(raw.handoff),
    version: stringValue(raw.version),
    tags: stringArray(raw.tags),
    routingKeywords: stringArray(raw.routing_keywords ?? raw.routingKeywords),
    profile: optionalRecord(raw.profile),
  };
}

export function validateRoleContract(role: RoleContract): RoleContractValidationResult {
  const issues: RoleContractValidationIssue[] = [];
  if (!/^[a-z][a-z0-9-]*$/.test(role.name)) {
    issues.push({ path: "name", message: "Role name must be kebab-case and start with a letter." });
  }
  if (!role.displayName) {
    issues.push({ path: "displayName", message: "displayName is required." });
  }
  if (!role.rolePrompt || role.rolePrompt.length < 12) {
    issues.push({ path: "rolePrompt", message: "rolePrompt must describe the role contract." });
  }
  if (!role.tools.every((tool) => /^[a-zA-Z][a-zA-Z0-9_.:-]*$/.test(tool))) {
    issues.push({ path: "tools", message: "Tool names must be stable identifiers." });
  }
  if (!role.capabilities?.every((capability) => /^[a-zA-Z][a-zA-Z0-9_.:-]*$/.test(capability))) {
    issues.push({ path: "capabilities", message: "Capabilities must be stable identifiers." });
  }
  if (!role.toolRequirements?.every((tool) => /^[a-zA-Z][a-zA-Z0-9_.:-]*$/.test(tool))) {
    issues.push({ path: "toolRequirements", message: "Tool requirements must be stable identifiers." });
  }
  if (role.permissions.filesystem === "none" && (role.permissions.readPaths?.length || role.permissions.writePaths?.length)) {
    issues.push({ path: "permissions", message: "Path permissions require filesystem access." });
  }
  // Cross-field check against the real permission -> tool deny mapping (issue
  // #109). A tool that the declared permissions already deny can still be listed
  // in `tools`; that used to pass validation and only surfaced later when the
  // derived deny list stripped it, leaving the declaration and the effective
  // capability contradictory. Report it at validation time, naming the tools.
  const permissionDeniedTools = new Set(buildRolePermissionDenyList(role));
  const conflictingTools = role.tools.filter((tool) =>
    permissionDeniedTools.has(tool.toLowerCase()),
  );
  if (conflictingTools.length > 0) {
    issues.push({
      path: "tools",
      severity: "warning",
      message:
        `Tool(s) ${conflictingTools.join(", ")} conflict with permissions ` +
        `(filesystem=${role.permissions.filesystem}, network=${role.permissions.network}, ` +
        `commands=${role.permissions.commands.length}): the permission deny list removes them, ` +
        "so the declared capability would not be effective.",
    });
  }
  if (!role.outputSchema.format) {
    issues.push({ path: "outputSchema.format", message: "outputSchema.format is required." });
  }
  // Soft check: profile, when present, must be an object. Invalid profiles are
  // already dropped by normalizeRoleContract, so this only fires when a caller
  // bypasses normalization — the contract still loads without the profile.
  if (role.profile !== undefined && (typeof role.profile !== "object" || Array.isArray(role.profile))) {
    issues.push({ path: "profile", message: "profile must be an object when present." });
  }
  // Only errors block a contract: warnings are diagnostics that must not drop an
  // already-accepted configuration entry.
  const ok = !issues.some((issue) => (issue.severity ?? "error") === "error");
  return { ok, issues };
}

export function parseRoleContractYaml(source: string): RoleContractValidationResult & { role?: RoleContract } {
  const parsed = parseYaml(source) as RawRoleContract | null;
  const role = normalizeRoleContract(parsed ?? {});
  const validation = validateRoleContract(role);
  return { ...validation, role };
}

export function assertRoleContract(input: unknown): RoleContract {
  const role = normalizeRoleContract(input);
  const validation = validateRoleContract(role);
  if (!validation.ok) {
    throw new Error(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  return role;
}

export function compileRoleContractToSoul(role: RoleContract): string {
  const sections = role.outputSchema.sections?.length
    ? `\nOutput sections: ${role.outputSchema.sections.join(", ")}`
    : "";
  const tools = role.tools.length ? role.tools.join(", ") : "none";
  return [
    `# ${role.displayName}`,
    "",
    role.rolePrompt,
    "",
    `Role contract: ${role.name}`,
    `Tools: ${tools}`,
    role.capabilities?.length ? `Capabilities: ${role.capabilities.join(", ")}` : undefined,
    role.toolRequirements?.length ? `Required tools: ${role.toolRequirements.join(", ")}` : undefined,
    role.riskProfile ? `Risk profile: ${role.riskProfile}` : undefined,
    `Filesystem: ${role.permissions.filesystem}; Network: ${role.permissions.network}`,
    `Effort: ${role.effort}`,
    `Output: ${role.outputSchema.format}${sections}`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

const role = (contract: RoleContract): RoleContract => contract;

export const BUILT_IN_ROLE_CONTRACTS: readonly RoleContract[] = [
  role({
    name: "planner",
    displayName: "Planner",
    rolePrompt: "Plan the work, identify dependencies, split tasks, and define acceptance criteria before execution.",
    tools: ["read", "glob", "grep"],
    capabilities: ["task-analysis", "planning", "multi-file-coordination"],
    toolRequirements: ["read", "glob", "grep"],
    riskProfile: "medium",
    canModifyScope: true,
    permissions: { filesystem: "read", network: "none", commands: [] },
    model: { default: null, fallback: [] },
    effort: "high",
    outputSchema: { format: "markdown", sections: ["Goal", "Plan", "Risks", "Acceptance"] },
    handoff: { to: ["architect", "implementer"], from: [] },
    tags: ["planning", "coordination"],
  }),
  role({
    name: "architect",
    displayName: "Architect",
    rolePrompt: "Design system boundaries, interfaces, tradeoffs, and migration paths with minimal disruption.",
    tools: ["read", "glob", "grep"],
    capabilities: ["task-analysis", "architecture", "multi-file-coordination"],
    toolRequirements: ["read", "glob", "grep"],
    riskProfile: "medium",
    canModifyScope: true,
    permissions: { filesystem: "read", network: "none", commands: [] },
    model: { default: null, fallback: [] },
    effort: "high",
    outputSchema: { format: "markdown", sections: ["Architecture", "Interfaces", "Tradeoffs", "Risks"] },
    handoff: { to: ["implementer", "reviewer"], from: ["planner"] },
    tags: ["architecture"],
  }),
  role({
    name: "implementer",
    displayName: "Implementer",
    rolePrompt: "Make focused code changes that match the existing code style and preserve current behavior unless requested.",
    tools: ["read", "write", "edit", "bash"],
    capabilities: ["task-analysis", "code-change", "implementation"],
    toolRequirements: ["read", "write", "edit"],
    riskProfile: "medium",
    canModifyScope: false,
    permissions: { filesystem: "write", network: "none", commands: [] },
    model: { default: null, fallback: [] },
    effort: "medium",
    outputSchema: { format: "markdown", sections: ["Changes", "Verification"] },
    handoff: { to: ["tester", "reviewer"], from: ["planner", "architect"] },
    tags: ["implementation"],
  }),
  role({
    name: "tester",
    displayName: "Tester",
    rolePrompt: "Design and run verification that proves behavior, covers edge cases, and reports exact failures.",
    tools: ["read", "bash"],
    capabilities: ["task-analysis", "verification"],
    toolRequirements: ["read", "bash"],
    riskProfile: "medium",
    canModifyScope: false,
    permissions: { filesystem: "read", network: "none", commands: [] },
    model: { default: null, fallback: [] },
    effort: "medium",
    outputSchema: { format: "markdown", sections: ["Cases", "Results", "Failures"] },
    handoff: { to: ["reviewer", "skeptic"], from: ["implementer"] },
    tags: ["testing"],
  }),
  role({
    name: "reviewer",
    displayName: "Reviewer",
    rolePrompt: "Review changes for correctness, maintainability, regression risk, and unnecessary complexity.",
    tools: ["read", "glob", "grep"],
    capabilities: ["task-analysis", "review", "verification"],
    toolRequirements: ["read", "glob", "grep"],
    riskProfile: "medium",
    canModifyScope: false,
    permissions: { filesystem: "read", network: "none", commands: [] },
    model: { default: null, fallback: [] },
    effort: "high",
    outputSchema: { format: "markdown", sections: ["Findings", "Evidence", "Recommendation"] },
    handoff: { to: ["implementer", "skeptic"], from: ["tester"] },
    tags: ["review"],
  }),
  role({
    name: "security-reviewer",
    displayName: "Security Reviewer",
    rolePrompt: "Review security, permissions, secrets, authentication, and abuse boundaries with a defensive focus.",
    tools: ["read", "glob", "grep"],
    capabilities: ["task-analysis", "security-review", "adversarial-review", "review"],
    toolRequirements: ["read", "glob", "grep"],
    riskProfile: "high",
    canModifyScope: false,
    permissions: { filesystem: "read", network: "none", commands: [] },
    model: { default: null, fallback: [] },
    effort: "xhigh",
    outputSchema: { format: "markdown", sections: ["Threats", "Findings", "Mitigations"] },
    handoff: { to: ["skeptic", "implementer"], from: ["planner", "reviewer"], requiresReview: true },
    tags: ["security", "adversarial"],
  }),
  role({
    name: "docs-writer",
    displayName: "Docs Writer",
    rolePrompt: "Turn implementation details into clear user-facing and developer-facing documentation.",
    tools: ["read", "write", "edit"],
    capabilities: ["task-analysis", "documentation"],
    toolRequirements: ["read", "write", "edit"],
    riskProfile: "low",
    canModifyScope: false,
    permissions: { filesystem: "write", network: "none", commands: [] },
    model: { default: null, fallback: [] },
    effort: "medium",
    outputSchema: { format: "markdown", sections: ["Summary", "Usage", "Notes"] },
    handoff: { to: ["reviewer"], from: ["implementer"] },
    tags: ["docs"],
  }),
  role({
    name: "knowledge-librarian",
    displayName: "Knowledge Librarian",
    rolePrompt: "Retrieve, ground, and cite knowledge base evidence. Prefer retrieval over speculation and surface unknowns clearly.",
    tools: ["read", "glob", "grep", "knowledge.search", "knowledge.get"],
    capabilities: ["task-analysis", "knowledge-retrieval", "citation"],
    toolRequirements: ["knowledge.search", "knowledge.get"],
    riskProfile: "low",
    canModifyScope: false,
    permissions: { filesystem: "read", network: "none", commands: [] },
    model: { default: null, fallback: [] },
    effort: "medium",
    outputSchema: { format: "markdown", sections: ["Answer", "Sources", "Unknowns"] },
    handoff: { to: ["researcher", "reviewer"], from: ["planner"] },
    tags: ["knowledge", "retrieval"],
  }),
  role({
    name: "skeptic",
    displayName: "Skeptic",
    rolePrompt: "Try to refute the proposed solution, find missing evidence, and decide whether acceptance criteria are truly met.",
    tools: ["read", "glob", "grep", "bash"],
    capabilities: ["task-analysis", "adversarial-review", "verification", "review"],
    toolRequirements: ["read", "glob", "grep"],
    riskProfile: "high",
    canModifyScope: false,
    permissions: { filesystem: "read", network: "none", commands: [] },
    model: { default: null, fallback: [] },
    effort: "high",
    outputSchema: { format: "markdown", sections: ["Verdict", "Refutations", "Required Fixes"] },
    handoff: { to: ["implementer", "reviewer"], from: ["tester", "security-reviewer"], requiresReview: true },
    tags: ["verification", "adversarial"],
  }),
] as const;

export const BUILT_IN_ROLE_NAMES: ReadonlySet<string> = new Set(
  BUILT_IN_ROLE_CONTRACTS.map((roleContract) => roleContract.name),
);

export function isBuiltInRoleName(name: string): boolean {
  return BUILT_IN_ROLE_NAMES.has(name);
}

export function getBuiltInRoleContract(name: string): RoleContract | undefined {
  return BUILT_IN_ROLE_CONTRACTS.find((roleContract) => roleContract.name === name);
}

~~~
