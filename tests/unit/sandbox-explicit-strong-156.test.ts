import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  requestedProviderId: 'policy-light' as string,
  dockerAvailable: false,
  permissionMode: 'readOnly' as string,
  detectCalls: [] as Array<{ forceRefresh?: boolean }>,
}));

vi.mock('@electron/utils/workspace-runtime-permissions', () => ({
  readActiveSandboxProviderIdFromStore: vi.fn(async () => state.requestedProviderId),
  readActiveWorkspacePermissionModeFromStore: vi.fn(async () => state.permissionMode),
  normalizeSandboxProviderId: (id: string) => id,
  describeSandboxRuntimeLevel: (id: string) =>
    id === 'docker-strong' || id === 'ssh-strong' ? 'strong' : id === 'windows-light' ? 'light' : 'policy',
  mapWorkspacePermissionToSandboxConfig: () => ({
    agents: { defaults: { sandbox: { mode: 'off', backend: 'openshell', scope: 'session', workspaceAccess: 'none' } } },
    tools: { exec: { host: 'gateway', security: 'allowlist', ask: 'on-miss' }, sandbox: { tools: { alsoAllow: [] } } },
  }),
}));

vi.mock('@electron/utils/sandbox-provider-detection', () => ({
  detectSandboxProviderSnapshot: vi.fn(async (options?: { forceRefresh?: boolean }) => {
    state.detectCalls.push({ forceRefresh: options?.forceRefresh === true });
    return {
      docker: { cli: state.dockerAvailable, daemon: state.dockerAvailable, image: state.dockerAvailable },
      providers: [
        { id: 'policy-light', label: 'Policy-light', available: true, runtimeLevel: 'policy', capabilities: [] },
        {
          id: 'docker-strong',
          label: 'Docker',
          available: state.dockerAvailable,
          runtimeLevel: state.dockerAvailable ? 'strong' : 'unavailable',
          capabilities: [],
        },
      ],
      detectedAt: Date.now(),
    };
  }),
}));

describe('explicit strong sandbox requests fail closed (#156)', () => {
  beforeEach(() => {
    state.requestedProviderId = 'policy-light';
    state.dockerAvailable = false;
    state.permissionMode = 'readOnly';
    state.detectCalls.length = 0;
  });

  it('resolver throws when requireStrong is set and the strong provider is unavailable', async () => {
    const { resolveSandboxEffectivePolicy, SandboxStrengthUnavailableError } = await import(
      '@electron/utils/sandbox-policy-resolver'
    );
    expect(() => resolveSandboxEffectivePolicy({
      permissionMode: 'readOnly',
      requestedProviderId: 'docker-strong',
      requireStrong: true,
      providers: [
        { id: 'policy-light', label: 'Policy-light', available: true, runtimeLevel: 'policy', capabilities: [] },
        { id: 'docker-strong', label: 'Docker', available: false, runtimeLevel: 'unavailable', capabilities: [] },
      ],
    })).toThrow(SandboxStrengthUnavailableError);
  });

  it('resolver keeps degrading when requireStrong is not set (automatic/startup path)', async () => {
    const { resolveSandboxEffectivePolicy } = await import('@electron/utils/sandbox-policy-resolver');
    const policy = resolveSandboxEffectivePolicy({
      permissionMode: 'readOnly',
      requestedProviderId: 'docker-strong',
      providers: [
        { id: 'policy-light', label: 'Policy-light', available: true, runtimeLevel: 'policy', capabilities: [] },
        { id: 'docker-strong', label: 'Docker', available: false, runtimeLevel: 'unavailable', capabilities: [] },
      ],
    });
    expect(policy.requestedProviderId).toBe('docker-strong');
    expect(policy.effectiveProviderId).toBe('policy-light');
    expect(policy.degraded).toBe(true);
  });

  it('resolver returns strong when requireStrong is set and the provider is available', async () => {
    const { resolveSandboxEffectivePolicy } = await import('@electron/utils/sandbox-policy-resolver');
    const policy = resolveSandboxEffectivePolicy({
      permissionMode: 'readOnly',
      requestedProviderId: 'docker-strong',
      requireStrong: true,
      providers: [
        { id: 'policy-light', label: 'Policy-light', available: true, runtimeLevel: 'policy', capabilities: [] },
        { id: 'docker-strong', label: 'Docker', available: true, runtimeLevel: 'strong', capabilities: [] },
      ],
    });
    expect(policy.effectiveProviderId).toBe('docker-strong');
    expect(policy.runtimeLevel).toBe('strong');
    expect(policy.degraded).toBe(false);
  });

  it('exposes the default policy environment without implying a container guarantee', async () => {
    const { resolveSandboxEffectivePolicy } = await import('@electron/utils/sandbox-policy-resolver');
    const policy = resolveSandboxEffectivePolicy({
      permissionMode: 'readOnly',
      requestedProviderId: 'policy-light',
      providers: [{ id: 'policy-light', label: 'Policy-light', available: true, runtimeLevel: 'policy', capabilities: [] }],
    });
    expect(policy.executionEnvironment).toMatchObject({ backend: 'host', guarantee: 'policy', status: 'available' });
  });

  it('exposes a container guarantee only when the strong provider is actually available', async () => {
    const { resolveSandboxEffectivePolicy } = await import('@electron/utils/sandbox-policy-resolver');
    const policy = resolveSandboxEffectivePolicy({
      permissionMode: 'readOnly',
      requestedProviderId: 'docker-strong',
      requireStrong: true,
      providers: [{ id: 'docker-strong', label: 'Docker', available: true, runtimeLevel: 'strong', capabilities: [] }],
    });
    expect(policy.executionEnvironment).toMatchObject({ backend: 'docker', guarantee: 'container', status: 'available' });
  });

  it('fails closed for an unavailable container instead of returning a host fallback', async () => {
    const { resolveSandboxEffectivePolicy, SandboxStrengthUnavailableError } = await import('@electron/utils/sandbox-policy-resolver');
    expect(() => resolveSandboxEffectivePolicy({
      permissionMode: 'readOnly',
      requestedProviderId: 'docker-strong',
      requireStrong: true,
      providers: [{ id: 'docker-strong', label: 'Docker', available: false, runtimeLevel: 'unavailable', capabilities: [] }],
    })).toThrow(SandboxStrengthUnavailableError);
  });

  it('rejects an explicit codex-native environment that conflicts with the resolved backend', async () => {
    const { resolveSandboxEffectivePolicy, SandboxStrengthUnavailableError } = await import('@electron/utils/sandbox-policy-resolver');
    expect(() => resolveSandboxEffectivePolicy({
      permissionMode: 'readOnly',
      requestedProviderId: 'policy-light',
      executionEnvironment: {
        backend: 'codex-native',
        guarantee: 'policy',
        network: 'disabled',
        writableRoots: [],
        status: 'available',
        reason: null,
      },
      providers: [{ id: 'policy-light', label: 'Policy-light', available: true, runtimeLevel: 'policy', capabilities: [] }],
    })).toThrow(SandboxStrengthUnavailableError);
  });

  it('high-risk gate denies outright when strength is required but unmet, even with an approval path', async () => {
    const { decideSandboxHighRiskAction } = await import('@electron/utils/sandbox-high-risk-gate');
    const decision = decideSandboxHighRiskAction({
      degraded: true,
      strengthRequired: true,
      degradeReason: 'Docker strong sandbox is unavailable; refusing to run on policy-light controls.',
      requestedProviderId: 'docker-strong',
      effectiveProviderId: 'policy-light',
      runtimeLevel: 'policy',
    }, 'exec', { allowApproval: true });
    expect(decision.allowed).toBe(false);
    expect(decision.requiresApproval).toBe(false);
    expect(decision.forceVisible).toBe(true);
    expect(decision.reason).toContain('strong isolation was requested');
  });

  it('high-risk gate does not treat an explicit policy-light choice as strength-required', async () => {
    const { decideSandboxHighRiskAction } = await import('@electron/utils/sandbox-high-risk-gate');
    const decision = decideSandboxHighRiskAction({
      degraded: false,
      strengthRequired: false,
      requestedProviderId: 'policy-light',
      effectiveProviderId: 'policy-light',
      runtimeLevel: 'policy',
    }, 'exec', { allowApproval: true });
    expect(decision.allowed).toBe(true);
  });

  it('force-visible summary labels unmet strength distinctly from an acknowledged downgrade', async () => {
    const { buildForcedDegradedVisibility } = await import('@electron/utils/sandbox-high-risk-gate');
    const unmet = buildForcedDegradedVisibility({
      degraded: true,
      strengthRequired: true,
      degradeReason: 'Strong isolation requested but unavailable.',
      requestedProviderId: 'docker-strong',
      effectiveProviderId: 'policy-light',
      runtimeLevel: 'policy',
    });
    expect(unmet.label).toBe('unavailable');
    expect(unmet.warnings.join(' ')).toContain('explicitly requested');
  });

  it('active policy snapshot marks strengthRequired and fails closed when docker-strong is selected but unavailable', async () => {
    state.requestedProviderId = 'docker-strong';
    state.dockerAvailable = false;

    const { getActiveSandboxHighRiskPolicy } = await import('@electron/utils/active-sandbox-high-risk-policy');
    const policy = await getActiveSandboxHighRiskPolicy();
    expect(policy.strengthRequired).toBe(true);
    expect(policy.requestedProviderId).toBe('docker-strong');
    expect(policy.effectiveProviderId).toBe('policy-light');
    expect(policy.runtimeLevel).toBe('policy');
    expect(policy.degraded).toBe(true);
    expect(policy.degradeReason).toContain('Docker strong sandbox is unavailable');
  });

  it('active policy snapshot reports strong and satisfied when the provider is available', async () => {
    state.requestedProviderId = 'docker-strong';
    state.dockerAvailable = true;

    const { getActiveSandboxHighRiskPolicy } = await import('@electron/utils/active-sandbox-high-risk-policy');
    const policy = await getActiveSandboxHighRiskPolicy();
    expect(policy.strengthRequired).toBe(true);
    expect(policy.effectiveProviderId).toBe('docker-strong');
    expect(policy.runtimeLevel).toBe('strong');
    expect(policy.degraded).toBe(false);
  });

  it('re-detects capabilities at the execution boundary when strong isolation is requested', async () => {
    state.requestedProviderId = 'docker-strong';
    state.dockerAvailable = true;

    const { getActiveSandboxHighRiskPolicy } = await import('@electron/utils/active-sandbox-high-risk-policy');
    await getActiveSandboxHighRiskPolicy();
    // A strong request must bypass the 15s detection cache so a provider that
    // vanished after selection cannot be reported as still strong.
    expect(state.detectCalls).toContainEqual({ forceRefresh: true });

    state.detectCalls.length = 0;
    state.requestedProviderId = 'policy-light';
    await getActiveSandboxHighRiskPolicy();
    expect(state.detectCalls).toContainEqual({ forceRefresh: false });
  });
  it('active policy snapshot does not mark strengthRequired for policy-light', async () => {
    state.requestedProviderId = 'policy-light';
    state.dockerAvailable = false;

    const { getActiveSandboxHighRiskPolicy } = await import('@electron/utils/active-sandbox-high-risk-policy');
    const policy = await getActiveSandboxHighRiskPolicy();
    expect(policy.strengthRequired).toBe(false);
    expect(policy.requestedProviderId).toBe('policy-light');
  });
});
