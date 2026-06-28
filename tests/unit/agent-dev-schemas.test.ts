import { describe, expect, it } from 'vitest';
import {
  assertAgentDevFeatureFlagsPayload,
  assertAgentDevMockReplayConfig,
  assertAgentDevSeedStatePayload,
} from '@shared/host-api/agent-dev-schemas';

describe('agent dev host-api schemas', () => {
  it('accepts representative seed, replay, and flag payloads', () => {
    expect(() => assertAgentDevSeedStatePayload({
      scenario: 'doctor-failed',
      settings: { theme: 'dark' },
      featureFlags: ['visual', 'doctor-ui'],
      conversations: [{ id: 'conv-1', title: 'Seeded', messages: [] }],
      providers: [{ id: 'provider-1', type: 'custom', hasApiKey: true }],
      visual: { enabled: true, width: 1440, height: 900, theme: 'light', language: 'en' },
    })).not.toThrow();

    expect(() => assertAgentDevMockReplayConfig({
      mode: 'replay',
      fixtures: [{ module: 'settings', action: 'getAll', result: { theme: 'dark' } }],
      clearCalls: true,
    })).not.toThrow();

    expect(() => assertAgentDevFeatureFlagsPayload({ flags: ['a', 'b'], merge: true })).not.toThrow();
  });

  it('rejects unknown scenario ids, malformed replay modes, and non-string flags', () => {
    expect(() => assertAgentDevSeedStatePayload({ scenario: 'not-a-scenario' })).toThrow(/Invalid agentDev\.seedState/);
    expect(() => assertAgentDevMockReplayConfig({ mode: 'capture' })).toThrow(/Invalid agentDev\.configureMockReplay/);
    expect(() => assertAgentDevFeatureFlagsPayload({ flags: ['ok', 1] })).toThrow(/Invalid agentDev\.setFeatureFlags/);
  });
});
