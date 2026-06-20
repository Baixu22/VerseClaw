export type TeamTemplateMode = "router" | "lead-workers" | "adversarial-review";

export type TeamTemplateRoleBinding = {
  roleName: string;
  required: boolean;
  modelRef?: string | null;
};

export type TeamTemplate = {
  id: string;
  name: string;
  description: string;
  mode: TeamTemplateMode;
  roles: TeamTemplateRoleBinding[];
  defaultLeadRole: string;
  verifierRole?: string;
  tags: string[];
};

export type TeamTemplateSnapshot = {
  templates: TeamTemplate[];
  defaultTemplateId: string;
};

/**
 * Config-defined team template. Accepts both snake_case and camelCase.
 * Used by AgentsConfig.teams for user-defined team compositions.
 */
export type TeamTemplateConfig = {
  id: string;
  name?: string;
  description?: string;
  mode?: TeamTemplateMode;
  default_lead_role?: string;
  defaultLeadRole?: string;
  verifier_role?: string;
  verifierRole?: string;
  roles: Array<{
    role_name?: string;
    roleName?: string;
    required?: boolean;
    model_ref?: string | null;
    modelRef?: string | null;
  }>;
  tags?: string[];
};

/** Normalizes a TeamTemplateConfig into a TeamTemplate. */
export function normalizeTeamTemplate(raw: TeamTemplateConfig): TeamTemplate {
  const id = raw.id?.trim() ?? "";
  return {
    id,
    name: raw.name?.trim() || id,
    description: raw.description?.trim() || `Custom team: ${id}`,
    mode: raw.mode ?? "lead-workers",
    defaultLeadRole: raw.defaultLeadRole?.trim() || raw.default_lead_role?.trim() || raw.roles[0]?.roleName || raw.roles[0]?.role_name || "implementer",
    verifierRole: raw.verifierRole?.trim() || raw.verifier_role?.trim() || undefined,
    roles: (raw.roles ?? []).map((r) => ({
      roleName: r.roleName?.trim() || r.role_name?.trim() || "",
      required: r.required ?? true,
      modelRef: r.modelRef ?? r.model_ref ?? null,
    })).filter((r) => r.roleName),
    tags: raw.tags ?? [],
  };
}
