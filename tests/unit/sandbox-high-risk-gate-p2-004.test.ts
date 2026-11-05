import { describe, expect, it } from 'vitest';
import {
  buildForcedDegradedVisibility,
  classifyAgentBrowserAction,
  classifyCronHostAction,
  classifyGatewayMethodForSandboxGate,
  classifyTerminalRiskForSandboxGate,
  composeWithSandboxHighRiskGate,
  decideSandboxHighRiskAction,
  loadSandboxHighRiskPolicy,
  setSandboxHighRiskPolicyLoader,
} from '@electron/utils/sandbox-high-risk-gate';

import { SandboxStrengthUnavailableError, resolveSandboxEffectivePolicy } from '@electron/utils/sandbox-policy-resolver';
import { normalizeSandboxProviderId } from '@electron/utils/workspace-runtime-permissions';

describe('explicit strong sandbox requests fail closed (#156)', () => {
  it('throws when docker-strong is explicitly required but unavailable', () => {
    expect(() => resolveSandboxEffectivePolicy({
      permissionMode: 'readOnly',
      requestedProviderId: 'docker-strong',
      requireStrong: true,
      providers: [{ id: 'docker-strong', label: 'Docker', available: false, runtimeLevel: 'strong', capabilities: [] }],
    })).toThrow(SandboxStrengthUnavailableError);
  });

  it('keeps automatic selection degradable when strong is not explicitly required', () => {
    const policy = resolveSandboxEffectivePolicy({
      permissionMode: 'readOnly',
      requestedProviderId: 'docker-strong',
      providers: [{ id: 'docker-strong', label: 'Docker', available: false, runtimeLevel: 'strong', capabilities: [] }],
    });
    expect(policy.effectiveProviderId).toBe('policy-light');
    expect(policy.degraded).toBe(true);
  });

  it('does not treat policy-light as a strong request', () => {
    expect(normalizeSandboxProviderId('policy-light')).toBe('policy-light');
  });
});

describe('sandbox high-risk gate (P2-004 / F-ISO-001)', () => {
  const degradedPolicy = {
    degraded: true,
    degradeReason: 'Docker strong sandbox is unavailable; using policy-light controls.',
    requestedProviderId: 'docker-strong',
    effectiveProviderId: 'policy-light',
    runtimeLevel: 'policy',
  };

  const healthyPolicy = {
    degraded: false,
    requestedProviderId: 'policy-light',
    effectiveProviderId: 'policy-light',
    runtimeLevel: 'policy',
  };

  it('classifies gateway cron/browser/exec methods as high-risk', () => {
    expect(classifyGatewayMethodForSandboxGate('cron.add')).toBe('cron');
    expect(classifyGatewayMethodForSandboxGate('cron.run')).toBe('cron');
    expect(classifyGatewayMethodForSandboxGate('browser.open')).toBe('browser');
    expect(classifyGatewayMethodForSandboxGate('agent_browser.navigate')).toBe('browser');
    expect(classifyGatewayMethodForSandboxGate('tools.exec')).toBe('exec');
    expect(classifyGatewayMethodForSandboxGate('chat.history')).toBeNull();
  });

  it('treats non-read terminal risks as exec under sandbox gate', () => {
    expect(classifyTerminalRiskForSandboxGate('read')).toBeNull();
    expect(classifyTerminalRiskForSandboxGate('write')).toBe('exec');
    expect(classifyTerminalRiskForSandboxGate('destructive')).toBe('exec');
  });

  it('keeps completion verification behind an explicit strong requirement even in full access', () => {
    const action = classifyGatewayMethodForSandboxGate('task_loop.verifyCompletion');
    expect(action).toBe('exec');
    expect(classifyGatewayMethodForSandboxGate('task_loop.completionEvidence')).toBeNull();
    const base = { allowed: true, risk: 'write' };
    const gate = action ? decideSandboxHighRiskAction({ ...degradedPolicy, strengthRequired: true }, action, { allowApproval: true }) : null;
    expect(composeWithSandboxHighRiskGate(base, gate)).toMatchObject({ allowed: false, requiresApproval: false });
  });

  it('classifies agent-browser and cron host actions', () => {
    expect(classifyAgentBrowserAction('status')).toBeNull();
    expect(classifyAgentBrowserAction('open')).toBe('browser');
    expect(classifyAgentBrowserAction('navigate')).toBe('browser');
    expect(classifyCronHostAction('list')).toBeNull();
    expect(classifyCronHostAction('create')).toBe('cron');
    expect(classifyCronHostAction('trigger')).toBe('cron');
  });

  it('allows high-risk when sandbox is not degraded', () => {
    const decision = decideSandboxHighRiskAction(healthyPolicy, 'exec');
    expect(decision).toMatchObject({
      allowed: true,
      requiresApproval: false,
      forceVisible: false,
    });
  });

  it('requires approval for high-risk under degraded strong sandbox (stepwise)', () => {
    const decision = decideSandboxHighRiskAction(degradedPolicy, 'exec', { allowApproval: true });
    expect(decision.allowed).toBe(false);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.forceVisible).toBe(true);
    expect(decision.reason).toContain('Docker strong sandbox is unavailable');
    expect(decision.reason).toContain('requested=docker-strong');
  });

  it('fail-closes high-risk under degraded when approval path is unavailable', () => {
    for (const action of ['exec', 'browser', 'cron'] as const) {
      const decision = decideSandboxHighRiskAction(degradedPolicy, action, { allowApproval: false });
      expect(decision.allowed).toBe(false);
      expect(decision.requiresApproval).toBe(false);
      expect(decision.forceVisible).toBe(true);
      expect(decision.reason).toMatch(/degraded|unavailable/i);
    }
  });

  it('composes with workspace decisions without weakening hard deny', () => {
    const hardDeny = { allowed: false as const, risk: 'write', reason: 'Read-only' };
    const sandbox = decideSandboxHighRiskAction(degradedPolicy, 'exec', { allowApproval: true });
    expect(composeWithSandboxHighRiskGate(hardDeny, sandbox)).toEqual(hardDeny);

    const allow = { allowed: true as const, risk: 'write' };
    const composed = composeWithSandboxHighRiskGate(allow, sandbox);
    expect(composed.allowed).toBe(false);
    expect((composed as { requiresApproval?: boolean }).requiresApproval).toBe(true);
    expect((composed as { reason?: string }).reason).toContain('Sandbox degraded');
  });

  it('force-visible degraded summary always reports status', () => {
    expect(buildForcedDegradedVisibility(healthyPolicy)).toMatchObject({
      degraded: false,
      forceVisible: true,
      label: 'healthy',
    });
    const degraded = buildForcedDegradedVisibility(degradedPolicy);
    expect(degraded.degraded).toBe(true);
    expect(degraded.forceVisible).toBe(true);
    expect(degraded.reason).toContain('Docker');
    expect(degraded.warnings.length).toBeGreaterThan(0);
  });

  it('uses injectable policy loader without requiring Electron/store', async () => {
    setSandboxHighRiskPolicyLoader(async () => ({
      degraded: true,
      degradeReason: 'injected',
      requestedProviderId: 'docker-strong',
      effectiveProviderId: 'policy-light',
      runtimeLevel: 'policy',
    }));
    try {
      const policy = await loadSandboxHighRiskPolicy();
      expect(policy.degraded).toBe(true);
      expect(policy.degradeReason).toBe('injected');
      const decision = decideSandboxHighRiskAction(policy, 'browser', { allowApproval: false });
      expect(decision.allowed).toBe(false);
      expect(decision.forceVisible).toBe(true);
    } finally {
      setSandboxHighRiskPolicyLoader(null);
    }
  });
});
