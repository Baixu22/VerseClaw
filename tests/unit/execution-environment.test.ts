import { describe, expect, it } from 'vitest';
import {
  createExecutionEnvironment,
  executionEnvironmentFromSandbox,
  sandboxNetworkToExecutionNetwork,
} from '@shared/types/execution-environment';
import type { SandboxProviderStatus } from '@shared/types/sandbox';

function provider(input: Partial<SandboxProviderStatus> & Pick<SandboxProviderStatus, 'id'>): SandboxProviderStatus {
  return {
    id: input.id,
    label: input.id,
    available: input.available ?? true,
    runtimeLevel: input.runtimeLevel ?? 'policy',
    reason: input.reason,
    capabilities: input.capabilities ?? [],
  };
}

describe('ExecutionEnvironment semantics', () => {
  it.each([
    ['policy-light', provider({ id: 'policy-light', runtimeLevel: 'policy' }), 'host', 'policy'],
    ['windows-light', provider({ id: 'windows-light', runtimeLevel: 'light' }), 'host', 'process'],
    ['docker-strong', provider({ id: 'docker-strong', runtimeLevel: 'strong' }), 'docker', 'container'],
    ['ssh-strong', provider({ id: 'ssh-strong', runtimeLevel: 'strong' }), 'ssh', 'vm'],
    ['codex-native', createExecutionEnvironment({ backend: 'codex-native', guarantee: 'policy' }), 'codex-native', 'policy'],
  ] as const)('maps %s from owner-supplied facts', (_label, input, backend, guarantee) => {
    const environment = 'runtimeLevel' in input
      ? executionEnvironmentFromSandbox(input)
      : input;
    expect(environment).toMatchObject({ backend, guarantee });
  });

  it('does not infer guarantee from a provider name when runtimeLevel says policy', () => {
    const environment = executionEnvironmentFromSandbox(provider({ id: 'docker-strong', runtimeLevel: 'policy' }));
    expect(environment).toMatchObject({ backend: 'docker', guarantee: 'policy' });
  });

  it('marks unavailable strong providers as unavailable and preserves the reason', () => {
    const environment = executionEnvironmentFromSandbox(provider({
      id: 'docker-strong',
      available: false,
      runtimeLevel: 'unavailable',
      reason: 'Docker daemon unavailable',
    }));
    expect(environment).toMatchObject({
      backend: 'docker',
      guarantee: 'policy',
      status: 'unavailable',
      reason: 'Docker daemon unavailable',
    });
  });

  it('keeps network, writable roots and null reason explicit', () => {
    expect(createExecutionEnvironment({ writableRoots: ['/workspace'], network: 'approval-required' })).toEqual({
      backend: 'host',
      guarantee: 'policy',
      network: 'approval-required',
      writableRoots: ['/workspace'],
      status: 'available',
      reason: null,
    });
    expect(sandboxNetworkToExecutionNetwork('localOnly')).toBe('local-only');
    expect(sandboxNetworkToExecutionNetwork('approvalRequired')).toBe('approval-required');
  });

  it('rejects unknown enums instead of guessing', () => {
    expect(() => createExecutionEnvironment({ backend: 'mystery' as never })).toThrow('valid backend');
    expect(() => createExecutionEnvironment({ guarantee: 'strong' as never })).toThrow('valid guarantee');
    expect(() => createExecutionEnvironment({ writableRoots: [' '] })).toThrow('writableRoots');
  });
});
