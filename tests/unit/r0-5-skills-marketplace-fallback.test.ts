// R0-5.5: the marketplace degradation flag (fallbackReason) must reach the
// user — the skills store surfaces it as a visible warning toast.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

const { capabilityMock, searchMock } = vi.hoisted(() => ({
  capabilityMock: vi.fn(),
  searchMock: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    skills: {
      status: vi.fn(),
      local: vi.fn(),
      clawhubCapability: () => capabilityMock(),
      clawhubSearch: (input: unknown) => searchMock(input),
      clawhubInstall: vi.fn(),
      clawhubUninstall: vi.fn(),
      updateConfigs: vi.fn(),
    },
  },
}));

describe('R0-5 skills marketplace fallback visibility', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    searchMock.mockResolvedValue({ success: true, results: [] });
    capabilityMock.mockResolvedValue({ success: true, capability: { available: true } });
  });

  it('toasts and records the fallback reason when the marketplace degrades', async () => {
    capabilityMock.mockResolvedValue({
      success: true,
      capability: { available: true, provider: 'built-in', fallbackReason: 'marketplace unreachable' },
    });
    const { useSkillsStore } = await import('@/stores/skills');

    await useSkillsStore.getState().searchSkills('pdf');

    expect(useSkillsStore.getState().marketplaceFallbackReason).toBe('marketplace unreachable');
    expect(vi.mocked(toast.warning)).toHaveBeenCalledTimes(1);
  });

  it('stays silent when the marketplace is healthy', async () => {
    const { useSkillsStore } = await import('@/stores/skills');

    await useSkillsStore.getState().searchSkills('pdf');

    expect(useSkillsStore.getState().marketplaceFallbackReason).toBeNull();
    expect(vi.mocked(toast.warning)).not.toHaveBeenCalled();
  });

  it('clears the flag once the marketplace recovers', async () => {
    capabilityMock.mockResolvedValueOnce({
      success: true,
      capability: { available: true, fallbackReason: 'marketplace unreachable' },
    }).mockResolvedValue({ success: true, capability: { available: true } });
    const { useSkillsStore } = await import('@/stores/skills');

    await useSkillsStore.getState().searchSkills('pdf');
    expect(useSkillsStore.getState().marketplaceFallbackReason).toBe('marketplace unreachable');

    await useSkillsStore.getState().searchSkills('docx');
    expect(useSkillsStore.getState().marketplaceFallbackReason).toBeNull();
  });
});
