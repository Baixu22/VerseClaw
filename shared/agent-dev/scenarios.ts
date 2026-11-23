export type AgentDevScenarioDefinition = {
  id: string;
  route: string;
  description: string;
  seed: Record<string, unknown>;
  slices?: string[];
  tags?: string[];
};

export const AGENT_DEV_SCENARIOS = [
  {
    id: 'ui-v2-showcase',
    route: '/ui-v2-showcase',
    description: 'Interactive Apple-inspired material and motion reference for Windows UI v2.',
    seed: { uiVersion: 'v2', visualMode: true },
    slices: ['ui'],
    tags: ['ui-v2', 'visual', 'motion'],
  },
  {
    id: 'chat-empty',
    route: '/',
    description: 'Empty chat session with setup skipped and no provider key.',
    seed: { conversations: [], providers: [] },
    slices: ['conversations', 'providers'],
    tags: ['chat', 'empty-state'],
  },
  {
    id: 'chat-streaming',
    route: '/',
    description: 'Chat page with a synthetic in-progress assistant turn.',
    seed: { gatewayStatus: { state: 'running', gatewayReady: true } },
    slices: ['gatewayStatus'],
    tags: ['chat', 'streaming'],
  },
  {
    id: 'models-heavy-usage',
    route: '/settings/models',
    description: 'Models page with dense token usage buckets for chart validation.',
    seed: { usageWindowDays: 30, modelCount: 12 },
    slices: ['usage'],
    tags: ['settings', 'models'],
  },
  {
    id: 'settings-provider-error',
    route: '/settings/models',
    description: 'Provider settings page with a validation error state.',
    seed: { providerError: 'invalid_api_key' },
    slices: ['providers'],
    tags: ['settings', 'providers'],
  },
  {
    id: 'doctor-failed',
    route: '/settings/advanced',
    description: 'Advanced settings with a failed OpenClaw Doctor payload.',
    seed: { doctorExitCode: 1 },
    slices: ['doctor'],
    tags: ['settings', 'doctor'],
  },
  {
    id: 'gateway-connecting',
    route: '/',
    description: 'Gateway connecting banner and retry affordances.',
    seed: { gatewayStatus: { state: 'starting', gatewayReady: false } },
    slices: ['gatewayStatus'],
    tags: ['gateway', 'chat'],
  },
  {
    id: 'knowledge-drafts',
    route: '/knowledge',
    description: 'Knowledge hub with draft/proposal queues populated.',
    seed: { draftCount: 3, proposalCount: 2 },
    slices: ['knowledge'],
    tags: ['knowledge'],
  },
  {
    id: 'observability-trace-errors',
    route: '/observability',
    description: 'Observability page with errored traces and node diagnostics.',
    seed: { traceStatus: 'failed', diagnosticCount: 4 },
    slices: ['observability'],
    tags: ['observability', 'trace'],
  },
  {
    id: 'typed-ipc-gateway-unavailable',
    route: '/',
    description: 'Typed IPC remains available while the Main-owned Gateway connection is unavailable.',
    seed: { hostTransport: 'ipc', gatewayStatus: { state: 'error', gatewayReady: false } },
    slices: ['gatewayStatus', 'transport'],
    tags: ['gateway', 'transport', 'error'],
  },
  {
    id: 'skill-execution-timeout',
    route: '/settings/advanced',
    description: 'Skill sandbox shows an execution timeout and budget evidence.',
    seed: { skillSandbox: { status: 'timeout', executionMs: 30000 } },
    slices: ['skills', 'sandbox'],
    tags: ['skill', 'sandbox', 'timeout'],
  },
  {
    id: 'multi-agent-handoff',
    route: '/',
    description: 'Conversation state includes a multi-agent handoff marker.',
    seed: { handoff: { fromAgentId: 'agent-a', toAgentId: 'agent-b', status: 'pending' } },
    slices: ['conversations', 'agents'],
    tags: ['agents', 'handoff'],
  },
  {
    id: 'knowledge-conflict-merge',
    route: '/knowledge',
    description: 'Knowledge hub contains a merge conflict review queue.',
    seed: { knowledgeConflictCount: 2, proposalCount: 3 },
    slices: ['knowledge'],
    tags: ['knowledge', 'merge'],
  },
  {
    id: 'channel-reconnect-storm',
    route: '/settings/channels',
    description: 'Channel diagnostics contain repeated reconnect events.',
    seed: { channelReconnects: 8, channelStatus: 'flapping' },
    slices: ['channels'],
    tags: ['channel', 'diagnostics'],
  },
  {
    id: 'clawgraph-dag-cycle',
    route: '/clawgraph',
    description: 'ClawGraph compile state includes a cycle diagnostic.',
    seed: { clawgraph: { compileStatus: 'failed', diagnostic: 'dag_cycle' } },
    slices: ['clawgraph'],
    tags: ['clawgraph', 'diagnostics'],
  },
] as const satisfies readonly AgentDevScenarioDefinition[];

export type AgentDevScenarioId = (typeof AGENT_DEV_SCENARIOS)[number]['id'];

export const AGENT_DEV_SCENARIO_IDS = AGENT_DEV_SCENARIOS.map((scenario) => scenario.id) as AgentDevScenarioId[];

const AGENT_DEV_SCENARIO_ID_SET = new Set<string>(AGENT_DEV_SCENARIO_IDS);

export function isAgentDevScenarioId(value: unknown): value is AgentDevScenarioId {
  return typeof value === 'string' && AGENT_DEV_SCENARIO_ID_SET.has(value);
}

export function getAgentDevScenario(id: AgentDevScenarioId): AgentDevScenarioDefinition {
  return AGENT_DEV_SCENARIOS.find((scenario) => scenario.id === id) as AgentDevScenarioDefinition;
}

export function listAgentDevScenarios(): AgentDevScenarioDefinition[] {
  return AGENT_DEV_SCENARIOS.map((scenario) => ({
    ...scenario,
    seed: { ...scenario.seed },
    slices: scenario.slices ? [...scenario.slices] : undefined,
    tags: scenario.tags ? [...scenario.tags] : undefined,
  }));
}
