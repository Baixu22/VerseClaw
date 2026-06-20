export type AgentReasoningEffort = 'auto' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

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

/** Structured role profile compiled to/from SOUL.md */
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

/** Contract-first role definition used by the role-first runtime MVP. */
export interface RoleContract {
  name: string;
  displayName: string;
  description?: string;
  rolePrompt: string;
  tools: string[];
  permissions: RolePermissions;
  model: RoleModelBinding;
  effort: RoleContractEffort;
  outputSchema: RoleOutputSchema;
  handoff: RoleHandoffRules;
  version?: string;
  tags?: string[];
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
