import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runOpenClawDoctorMock, runOpenClawDoctorFixMock, buildSandboxStatusMock } = vi.hoisted(() => ({
  runOpenClawDoctorMock: vi.fn(),
  runOpenClawDoctorFixMock: vi.fn(),
  buildSandboxStatusMock: vi.fn(),
}));

vi.mock('@electron/utils/openclaw-doctor', () => ({
  runOpenClawDoctor: (...args: unknown[]) => runOpenClawDoctorMock(...args),
  runOpenClawDoctorFix: (...args: unknown[]) => runOpenClawDoctorFixMock(...args),
}));

vi.mock('@electron/services/sandbox-api', () => ({
  buildSandboxStatus: (...args: unknown[]) => buildSandboxStatusMock(...args),
}));

describe('app api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runOpenClawDoctorMock.mockResolvedValue({
      mode: 'diagnose',
      success: true,
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      command: 'openclaw doctor',
      cwd: 'C:/openclaw',
      durationMs: 10,
    });
    runOpenClawDoctorFixMock.mockResolvedValue({
      mode: 'fix',
      success: true,
      exitCode: 0,
      stdout: 'fixed',
      stderr: '',
      command: 'openclaw doctor --fix --yes --non-interactive',
      cwd: 'C:/openclaw',
      durationMs: 12,
    });
    buildSandboxStatusMock.mockResolvedValue({
      requestedProviderId: 'policy-light',
      effectiveProviderId: 'policy-light',
      runtimeLevel: 'policy',
      degraded: false,
      permissionMode: 'acceptEdits',
      summary: 'Policy-light / acceptEdits / policy / network=disabled',
      updatedAt: 1,
    });
  });

  it('attaches the effective sandbox policy to doctor results', async () => {
    const { createAppApi } = await import('@electron/services/app-api');

    await expect(createAppApi().openClawDoctor({ mode: 'diagnose' })).resolves.toMatchObject({
      success: true,
      stdout: 'ok',
      sandbox: {
        effectiveProviderId: 'policy-light',
        runtimeLevel: 'policy',
      },
    });
  });

  it('does not fail doctor when sandbox status is unavailable', async () => {
    buildSandboxStatusMock.mockRejectedValueOnce(new Error('sandbox unavailable'));
    const { createAppApi } = await import('@electron/services/app-api');

    await expect(createAppApi().openClawDoctor({ mode: 'fix' })).resolves.toMatchObject({
      success: true,
      stdout: 'fixed',
    });
    await expect(createAppApi().openClawDoctor({ mode: 'fix' })).resolves.toHaveProperty('sandbox');
  });
});
