/** Read-only session policy projection built from owner-resolved runtime facts. */
export const SESSION_EFFECTIVE_POLICY_SCHEMA = 'SessionEffectivePolicy/v1' as const;

export type SessionPolicyFactState =
  | 'configured'
  | 'effective'
  | 'unverified'
  | 'unsupported'
  | 'ignored'
  | 'unknown';

export type SessionPolicyFact<T> = {
  state: SessionPolicyFactState;
  value: T | null;
  source: string;
  reason: string | null;
  observedAt: string | null;
};

export type SessionBackendKind =
  | 'openclaw-embedded'
  | 'codex-app-server'
  | 'claude-cli'
  | 'custom-cli'
  | 'unknown';

export type SessionBackendDescriptor = {
  id: string;
  kind: SessionBackendKind;
  modelProvider: string | null;
  model: string | null;
  nativeThreadId: string | null;
  nativeSessionId: string | null;
};

export type SessionCompactionParameterCompatibility = {
  path: string;
  state: 'effective' | 'ignored' | 'unsupported' | 'unknown';
  reason: string | null;
};

export type SessionCompactionCompatibility = {
  nativeCompactionOwner: 'openclaw' | 'backend' | 'unknown';
  parameters: SessionCompactionParameterCompatibility[];
};

export type SessionPolicyGenerationState = 'current' | 'stale' | 'missing' | 'mismatch' | 'unverified';

export type SessionEffectivePolicy = {
  schemaVersion: typeof SESSION_EFFECTIVE_POLICY_SCHEMA;
  generatedAt: string;
  scope: {
    workspaceId: string;
    sessionKey: string;
    sessionId: string;
    agentId: string;
    permissionMode: string;
  };
  generation: {
    state: SessionPolicyGenerationState;
    runtimeGeneration: string | null;
    runId: string | null;
    profileObservedAt: string | null;
  };
  backend: {
    configured: SessionPolicyFact<string>;
    effective: SessionPolicyFact<SessionBackendDescriptor>;
    binding: SessionPolicyFact<{ kind: string; id: string }>;
    compatibility: SessionCompactionCompatibility;
  };
  model: {
    configured: SessionPolicyFact<{ provider: string | null; model: string | null }>;
    effective: SessionPolicyFact<{ provider: string | null; model: string | null }>;
    effort: SessionPolicyFact<string>;
  };
  grant: {
    mode: SessionPolicyFact<string>;
    effectiveActions: SessionPolicyFact<{
      allowed: string[];
      requiresApproval: string[];
      denied: string[];
      unknown: string[];
    }>;
  };
  limits: {
    context: SessionPolicyFact<{
      usedTokens: number | null;
      contextTokenBudget: number | null;
      reserveTokens: number | null;
      overflowTokens: number | null;
    }>;
    queue: SessionPolicyFact<{
      mode: string | null;
      cap: number | null;
      debounceMs: number | null;
      drop: string | null;
    }>;
    resources: SessionPolicyFact<{
      spawnDepth: number | null;
      subagentControlScope: string | null;
      inheritedToolAllowCount: number;
      inheritedToolDenyCount: number;
    }>;
    schedule: SessionPolicyFact<{ jobIds: string[] }>;
  };
  diagnostics: Array<{
    code: string;
    severity: 'info' | 'warning' | 'error';
    message: string;
  }>;
};
