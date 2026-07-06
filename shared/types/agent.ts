export type AgentReasoningEffort = 'auto' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * **Assistant** — persistent identity (canonical taxonomy).
 *
 * User-created, persists across sessions. Owns the workspace, model binding,
 * channel bindings, and session tree. One Assistant has exactly one Persona
 * (`AgentRoleProfile`) and may participate in M:N orchestration runs that use
 * many Role Contracts (`RoleContract`).
 *
 * See `docs/role-identity-taxonomy.md` and `shared/types/role-identity.ts`.
 */
export interface AgentSummary {
  id: string;
  name: string;
  isDefault: boolean;
  modelDisplay: string;
  modelRef?: string | null;
  overrideModelRef?: string | null;
  inheritedModel: boolean;
  reasoningEffort?: AgentReasoningEffort;
  workspace: string;
  agentDir: string;
  mainSessionKey: string;
  channelTypes: string[];
}

export interface AgentsSnapshot {
  agents: AgentSummary[];
  defaultAgentId: string;
  defaultModelRef?: string | null;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
}

/**
 * **Persona** — 1:1 attribute of an Assistant (canonical taxonomy).
 *
 * Compiled to `<workspace>/SOUL.md` (free-form, model-facing) and optionally
 * mirrored to `<workspace>/role-profile.json` (structured, lossless round-trip
 * via `soulHash` staleness check). The structured sidecar is the canonical
 * source for downstream consumers (`RoleContract.profile`, memory binding,
 * KB binding); SOUL.md remains hand-editable and wins on conflict.
 *
 * See `docs/role-identity-taxonomy.md` and `shared/types/role-identity.ts`.
 */
export interface AgentRoleProfile {
  displayName: string;
  role: string;
  customRole?: string;
  verbosity: 'concise' | 'balanced' | 'detailed';
  tone: 'formal' | 'casual' | 'friendly' | 'direct';
  language: string;
  customStyle?: string;
  expertise: string[];
  limitations: string[];
  backstory: string;
}

export type RolePermissionAccess = 'none' | 'read' | 'write' | 'admin';
export type RoleNetworkAccess = 'none' | 'limited' | 'full';
export type RoleContractEffort = AgentReasoningEffort | 'max';

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
  format: 'markdown' | 'json' | 'text';
  sections?: string[];
  jsonSchema?: Record<string, unknown>;
};

export type RoleHandoffRules = {
  to: string[];
  from: string[];
  requiresReview?: boolean;
};

/**
 * **Role Contract** — reusable orchestration library item (canonical taxonomy).
 *
 * M:N with Assistants: many contracts can be used in one orchestration, and
 * one contract can be reused across many orchestrations. Authored as built-ins
 * (`BUILT_IN_ROLE_CONTRACTS`) or as config entries (`cfg.agents.roles[]`); the
 * registry merges them with later-wins resolution on name collision.
 *
 * This declaration is reunified with the runtime-side declaration in
 * `openclaw_runtime/src/agents/role-contract.ts` (which is authoritative — it
 * has the validator). Both sides now carry the same keyset:
 *   - `capabilities` / `toolRequirements` / `riskProfile` / `canModifyScope`
 *     were runtime-only; now also declared here.
 *   - `profile` was shared-only; now also honored runtime-side.
 *
 * See `docs/role-identity-taxonomy.md` and `shared/types/role-identity.ts`.
 */
export interface RoleContract {
  name: string;
  displayName: string;
  description?: string;
  rolePrompt: string;
  tools: string[];
  /** Capability tags (stable identifiers) used by the router for matching. */
  capabilities?: string[];
  /** Tools the role expects to be available; router reports gaps if missing. */
  toolRequirements?: string[];
  /** Risk classification guiding review depth and approval friction. */
  riskProfile?: 'low' | 'medium' | 'high' | 'critical';
  /** Whether the role may expand its declared scope mid-run. */
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
   * roles use the static ROLE_KEYWORDS table in role-router.ts; config-defined
   * (pack) roles declare their own keywords here so they can be routed by
   * user-authored language (CN/EN/mixed) without modifying the built-in table.
   * The router applies the same +2 weight as built-in keyword matches.
   */
  routingKeywords?: string[];
  /** Optional Persona fragment compiled into the role's SOUL (bridge field). */
  profile?: Partial<AgentRoleProfile>;
}

export type RoleContractValidationIssue = {
  path: string;
  message: string;
};

export type RoleContractValidationResult = {
  ok: boolean;
  issues: RoleContractValidationIssue[];
};

export const DEFAULT_ROLE_PROFILE: AgentRoleProfile = {
  displayName: '',
  role: '通用助手',
  verbosity: 'balanced',
  tone: 'friendly',
  language: '',
  expertise: [],
  limitations: [],
  backstory: '',
};

/** Content of all bootstrap files for an agent */
export interface AgentBootstrapFiles {
  soulMd: string;
  agentsMd: string;
  toolsMd: string;
  userMd: string;
  identityMd: string;
  heartbeatMd: string;
  bootMd: string;
}
