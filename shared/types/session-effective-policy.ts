/** Read-only session policy projected from existing owner-resolved facts. */
export const SESSION_EFFECTIVE_POLICY_SCHEMA = 'SessionEffectivePolicy/v1' as const;

export type SessionPolicyFactStatus =
  | 'configured'
  | 'effective'
  | 'unverified'
  | 'unsupported'
  | 'ignored';

export type SessionPolicyFact<T> = {
  value: T | null;
  status: SessionPolicyFactStatus;
  source: string;
  reason: string | null;
};

export type SessionPolicyAxis<T> = {
  configured: SessionPolicyFact<T>;
  effective: SessionPolicyFact<T>;
};

export type SessionPolicyBackend = {
  runtime: string;
  kind: 'openclaw' | 'native' | 'cli' | 'unknown';
  ownsNativeCompaction: boolean | null;
  provider: string | null;
  model: string | null;
};

/** The harness that owns this turn, kept separate from the model backend. */
export type SessionPolicyHarness = {
  id: string;
  kind: SessionPolicyBackend['kind'];
};

export type SessionPolicyModel = {
  provider: string | null;
  model: string | null;
  effort: string | null;
};

export type SessionPolicyGrantAction = {
  actionId: string;
  authorization: 'allowed' | 'requires-approval' | 'denied' | 'not-applicable' | 'unknown';
  grantState: 'active' | 'pending' | 'expired' | 'revoked' | 'denied' | 'unknown' | null;
};

export type SessionPolicyGrantSummary = {
  total: number;
  allowed: number;
  requiresApproval: number;
  denied: number;
  unknown: number;
  actions: readonly SessionPolicyGrantAction[];
};

export type SessionPolicyContextLimits = {
  contextTokens: number | null;
  contextPressure: 'low' | 'medium' | 'high' | null;
};

export type SessionPolicyQueueLimits = {
  mode: 'steer' | 'followup' | 'collect' | 'interrupt' | null;
  cap: number | null;
  drop: 'old' | 'new' | 'summarize' | null;
  debounceMs: number | null;
  queuedCount: number;
};

export type SessionPolicyResourceLimits = {
  maxConcurrentRuns: number | null;
  maxConcurrentSubagents: number | null;
  maxSpawnDepth: number | null;
  maxChildrenPerAgent: number | null;
  maxProcesses: number | null;
  maxRssMb: number | null;
  maxBackgroundTerminals: number | null;
  maxWorktrees: number | null;
  idleTtlMs: number | null;
  keepOnLeave: boolean | null;
};

export type SessionPolicyScheduleLimits = {
  cronEnabled: boolean | null;
  cronMaxConcurrentRuns: number | null;
  sessionRetention: string | null;
};

export type SessionPolicyTools = {
  /** Runtime-exposed menu, not adapter health, permission, or effect evidence. */
  names: readonly string[];
  digest: string;
};

export type SessionHostCapabilityFact = {
  state: 'supported' | 'unsupported' | 'unknown';
  source: string;
  observedAt: string | null;
  reason: string | null;
};

/** Diagnostic observations only. Every execution still passes its real owner. */
export type SessionHostReadiness = {
  owner: 'electron-gateway';
  observedAt: string;
  runtimeGeneration: string | null;
  runtime: SessionHostCapabilityFact;
  tools: SessionHostCapabilityFact;
  scheduling: SessionHostCapabilityFact;
  budget: SessionHostCapabilityFact;
  unattendedService: SessionHostCapabilityFact;
};

export type SessionBackendCompatibilityRow = {
  backend: string;
  parameter: string;
  status: SessionPolicyFactStatus;
  reason: string | null;
};

export type SessionEffectivePolicy = {
  schemaVersion: typeof SESSION_EFFECTIVE_POLICY_SCHEMA;
  generatedAt: string;
  scope: {
    workspaceId: string;
    sessionKey: string;
    agentId: string | null;
    sessionId: string | null;
    runId: string | null;
  };
  generation: {
    state: 'effective' | 'unverified' | 'stale' | 'mismatch' | 'missing';
    runtimeGeneration: string | null;
    capabilityProfileGeneration: string | null;
    observedAt: string | null;
    reason: string | null;
  };
  backend: SessionPolicyAxis<SessionPolicyBackend>;
  harness: SessionPolicyAxis<SessionPolicyHarness>;
  model: SessionPolicyAxis<SessionPolicyModel>;
  grants: SessionPolicyAxis<SessionPolicyGrantSummary>;
  context: SessionPolicyAxis<SessionPolicyContextLimits>;
  queue: SessionPolicyAxis<SessionPolicyQueueLimits>;
  resources: SessionPolicyAxis<SessionPolicyResourceLimits>;
  schedule: SessionPolicyAxis<SessionPolicyScheduleLimits>;
  /** Absent on older runtimes; absence is unknown, never a tool grant. */
  tools?: SessionPolicyFact<SessionPolicyTools>;
  /** Main-owned enrichment of the runtime policy through the existing API. */
  host?: SessionHostReadiness;
  compatibility: readonly SessionBackendCompatibilityRow[];
  sources: readonly string[];
};
