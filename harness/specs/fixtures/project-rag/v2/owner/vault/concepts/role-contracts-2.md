---
title: role-contracts / openclaw_runtime/src/agents/team-template.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-09T23:01:31.258Z"
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

Origin: openclaw_runtime/src/agents/team-template.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
import { normalizeTeamTemplate, type TeamTemplateConfig, type TeamTemplate, type TeamTemplateSnapshot } from "./team-template.types.js";

export const BUILT_IN_TEAM_TEMPLATES: readonly TeamTemplate[] = [
  {
    id: "quick-development",
    name: "Quick Development Team",
    description: "Minimal planner, implementer, tester, and reviewer flow for everyday feature work.",
    mode: "lead-workers",
    defaultLeadRole: "planner",
    verifierRole: "reviewer",
    roles: [
      { roleName: "planner", required: true },
      { roleName: "implementer", required: true },
      { roleName: "tester", required: true },
      { roleName: "reviewer", required: true },
    ],
    tags: ["development", "mvp"],
  },
  {
    id: "security-audit",
    name: "Security Audit Team",
    description: "Security reviewer and skeptic-led adversarial review for auth, permissions, and secrets work.",
    mode: "adversarial-review",
    defaultLeadRole: "security-reviewer",
    verifierRole: "skeptic",
    roles: [
      { roleName: "security-reviewer", required: true },
      { roleName: "reviewer", required: true },
      { roleName: "tester", required: true },
      { roleName: "skeptic", required: true },
    ],
    tags: ["security", "audit", "adversarial"],
  },
  {
    id: "refactor",
    name: "Refactor Team",
    description: "Architect-guided refactor workflow with implementation, testing, and skeptic validation.",
    mode: "lead-workers",
    defaultLeadRole: "architect",
    verifierRole: "skeptic",
    roles: [
      { roleName: "architect", required: true },
      { roleName: "implementer", required: true },
      { roleName: "tester", required: true },
      { roleName: "reviewer", required: true },
      { roleName: "skeptic", required: true },
    ],
    tags: ["refactor", "quality"],
  },
] as const;

export function getTeamTemplate(id: string): TeamTemplate | undefined {
  return BUILT_IN_TEAM_TEMPLATES.find((template) => template.id === id);
}

export function resolveTeamTemplate(
  id: string | undefined,
  cfg?: { agents?: { teams?: unknown } },
): TeamTemplate | undefined {
  const templateId = id?.trim();
  if (!templateId) {
    return undefined;
  }
  return getTeamTemplateSnapshot(cfg).templates.find((template) => template.id === templateId);
}

export function getTeamTemplateSnapshot(cfg?: { agents?: { teams?: unknown } }): TeamTemplateSnapshot {
  // Start with built-ins, then merge config-defined teams (config overrides by id).
  const byId = new Map<string, TeamTemplate>();
  for (const builtin of BUILT_IN_TEAM_TEMPLATES) {
    byId.set(builtin.id, builtin);
  }
  const rawTeams = cfg?.agents?.teams;
  if (Array.isArray(rawTeams)) {
    for (const raw of rawTeams) {
      try {
        const normalized = normalizeTeamTemplate(raw as TeamTemplateConfig);
        if (normalized.id) {
          byId.set(normalized.id, normalized);
        }
      } catch {
        // Skip invalid team config — don't break the registry.
      }
    }
  }
  return {
    templates: [...byId.values()],
    defaultTemplateId: "quick-development",
  };
}

~~~
