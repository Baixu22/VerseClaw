import { beforeEach, describe, expect, it, vi } from 'vitest';

const statusMock = vi.fn();
const localMock = vi.fn();
const clawhubSearchMock = vi.fn();
const clawhubInstallMock = vi.fn();
const updateConfigsMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    skills: {
      status: () => statusMock(),
      local: () => localMock(),
      clawhubSearch: (input: unknown) => clawhubSearchMock(input),
      clawhubInstall: (input: unknown) => clawhubInstallMock(input),
      clawhubUninstall: vi.fn(),
      updateConfigs: (input: unknown) => updateConfigsMock(input),
    },
  },
}));

describe('skills store error mapping', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('maps fetchSkills rate-limit error when both local and gateway loading fail', async () => {
    statusMock.mockRejectedValueOnce(new Error('gateway unavailable'));
    localMock.mockRejectedValueOnce(new Error('rate limit exceeded'));

    const { useSkillsStore } = await import('@/stores/skills');
    await useSkillsStore.getState().fetchSkills();

    expect(useSkillsStore.getState().error).toBe('fetchRateLimitError');
  });

  it('maps searchSkills timeout error by AppError code', async () => {
    clawhubSearchMock.mockRejectedValueOnce(new Error('request timeout'));

    const { useSkillsStore } = await import('@/stores/skills');
    await useSkillsStore.getState().searchSkills('git');

    expect(clawhubSearchMock).toHaveBeenCalledWith({ query: 'git' });
    expect(useSkillsStore.getState().searchError).toBe('searchTimeoutError');
  });

  it('maps installSkill timeout result into installTimeoutError', async () => {
    clawhubInstallMock.mockResolvedValueOnce({ success: false, error: 'request timeout' });

    const { useSkillsStore } = await import('@/stores/skills');
    await expect(useSkillsStore.getState().installSkill('demo-skill')).rejects.toThrow('installTimeoutError');
    expect(clawhubInstallMock).toHaveBeenCalledWith({ slug: 'demo-skill', version: undefined });
  });

  // Issue #131: the renderer must not enable a skill whose Main-side install was
  // rejected (including the integrity-verification gate).
  it('never enables a skill when the install result is unsuccessful', async () => {
    clawhubInstallMock.mockResolvedValueOnce({
      success: false,
      error: 'Skill "pdf" failed integrity verification (digest-mismatch); it was not enabled.',
    });

    const { useSkillsStore } = await import('@/stores/skills');
    await expect(useSkillsStore.getState().installSkill('pdf')).rejects.toThrow();
    expect(updateConfigsMock).not.toHaveBeenCalled();
  });

  it('enables the skill only after a successful install result', async () => {
    clawhubInstallMock.mockResolvedValueOnce({ success: true, result: null });
    localMock.mockResolvedValueOnce({ success: true, skills: [] });
    updateConfigsMock.mockResolvedValueOnce({ success: true });

    const { useSkillsStore } = await import('@/stores/skills');
    await useSkillsStore.getState().installSkill('pdf', '1.2.0');

    expect(clawhubInstallMock).toHaveBeenCalledWith({ slug: 'pdf', version: '1.2.0' });
    expect(updateConfigsMock).toHaveBeenCalledWith([{ skillKey: 'pdf', enabled: true }]);
  });
});
