export type AgentDevTraceLayer =
  | 'renderer'
  | 'host-api'
  | 'ipc'
  | 'gateway'
  | 'runtime'
  | 'model'
  | 'tool';

export type AgentDevTraceDirection = 'in' | 'out' | 'internal';

export type AgentDevTraceEvent = {
  id: string;
  requestId?: string;
  at: number;
  layer: AgentDevTraceLayer;
  direction: AgentDevTraceDirection;
  label: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
};

export type AgentDevCostUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  estimatedCost: number;
};

export type AgentDevCostReport = {
  generatedAt: string;
  totals: AgentDevCostUsage;
  byAgent: Record<string, AgentDevCostUsage>;
  bySkill: Record<string, AgentDevCostUsage>;
  hotPath: Array<{
    label: string;
    requestId?: string;
    totalTokens: number;
    estimatedCost: number;
  }>;
};

export type AgentDevSkillSandboxCapability =
  | 'network'
  | 'filesystem'
  | 'model-call'
  | 'channel-send';

export type AgentDevSkillSandboxEffect = {
  id: string;
  at: number;
  capability: AgentDevSkillSandboxCapability;
  label: string;
  allowed: boolean;
  metadata?: Record<string, unknown>;
};

export type AgentDevSkillSandboxReport = {
  generatedAt: string;
  capabilityGate: Record<AgentDevSkillSandboxCapability, boolean>;
  budget: {
    tokenLimit: number;
    apiCallLimit: number;
    executionMsLimit: number;
    memoryMbLimit: number;
  };
  effects: AgentDevSkillSandboxEffect[];
};

export function createEmptyCostUsage(): AgentDevCostUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
  };
}
