import { describe, expect, it } from 'vitest';
import {
  collectContractIssues,
  parseContractActions,
  parseFacadeActions,
  parseRegistryScenarioIds,
} from '../../scripts/contract-check.mjs';

const contractText = `
export type HostApiContract = {
  agentDev: {
    status: () => AgentDevStatusResult;
    seedState: (payload?: AgentDevSeedStatePayload) => AgentDevSeedStateResult;
  };
};
`;

const hostApiText = `
export const hostApi = {
  agentDev: {
    status: () => invokeHost('agentDev', 'status'),
    seedState: (input) => invokeHost('agentDev', 'seedState', input),
  },
};
`;

const ipcHandlersText = `
  const services: HostServiceRegistry = {
    agentDev: createAgentDevApi({ gatewayManager }),
  };
`;

const agentDevApiText = `
import { isAgentDevScenarioId } from '@shared/agent-dev/scenarios';
export function createAgentDevApi() {
  return {
    status: () => ({}),
    seedState: async (payload) => {
      assertAgentDevSeedStatePayload(payload);
      assertAgentDevMockReplayConfig(payload);
      assertAgentDevFeatureFlagsPayload(payload);
      assertAgentDevRecordScenarioPayload(payload);
    },
  };
}
`;

const scenarioRegistryText = `
export const AGENT_DEV_SCENARIOS = [
  { id: 'chat-empty', route: '/', description: '', seed: {} },
  { id: 'chat-streaming', route: '/', description: '', seed: {} },
  { id: 'models-heavy-usage', route: '/', description: '', seed: {} },
  { id: 'settings-provider-error', route: '/', description: '', seed: {} },
  { id: 'doctor-failed', route: '/', description: '', seed: {} },
  { id: 'gateway-connecting', route: '/', description: '', seed: {} },
  { id: 'knowledge-drafts', route: '/', description: '', seed: {} },
  { id: 'observability-trace-errors', route: '/', description: '', seed: {} },
  { id: 'transport-fallback-chain', route: '/', description: '', seed: {} },
  { id: 'skill-execution-timeout', route: '/', description: '', seed: {} },
  { id: 'multi-agent-handoff', route: '/', description: '', seed: {} },
  { id: 'knowledge-conflict-merge', route: '/', description: '', seed: {} },
  { id: 'channel-reconnect-storm', route: '/', description: '', seed: {} },
  { id: 'clawgraph-dag-cycle', route: '/', description: '', seed: {} },
] as const;
`;

function baseInput(overrides = {}) {
  return {
    contractText,
    hostApiText,
    ipcHandlersText,
    agentDevApiText,
    agentDevSchemaText: 'AGENT_DEV_SCENARIO_IDS',
    rendererAgentDevText: '@shared/agent-dev/scenario-composer',
    workbenchText: 'shared/agent-dev/scenarios.ts',
    scenarioRegistryText,
    ...overrides,
  };
}

describe('contract check', () => {
  it('parses contract, facade, and scenario registry entries', () => {
    expect([...parseContractActions(contractText).get('agentDev')!]).toEqual(['status', 'seedState']);
    expect([...parseFacadeActions(hostApiText).get('agentDev')!]).toEqual(['status', 'seedState']);
    expect(parseRegistryScenarioIds(scenarioRegistryText)).toContain('doctor-failed');
  });

  it('passes representative aligned P0 inputs', () => {
    expect(collectContractIssues(baseInput())).toEqual([]);
  });

  it('reports readable drift for missing facade actions and registry ids', () => {
    const issues = collectContractIssues(baseInput({
      hostApiText: hostApiText.replace("    seedState: (input) => invokeHost('agentDev', 'seedState', input),\n", ''),
      scenarioRegistryText: scenarioRegistryText.replace("  { id: 'doctor-failed', route: '/', description: '', seed: {} },\n", ''),
    }));

    expect(issues).toEqual(expect.arrayContaining([
      "src/lib/host-api.ts: missing hostApi.agentDev.seedState facade",
      "shared/agent-dev/scenarios.ts: missing required scenario 'doctor-failed'",
    ]));
  });
});
