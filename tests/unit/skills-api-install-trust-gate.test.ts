/**
 * Regression for issue #131, Main-process half of the install contract.
 *
 * `skills.clawhubInstall` must forward the requested version to the installer and
 * must only enable the skill after the installed bytes pass integrity
 * verification. A skill whose recorded digest cannot be re-verified stays
 * disabled even though the download itself succeeded.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { installMock, verifyMock, updateSkillConfigMock } = vi.hoisted(() => ({
  installMock: vi.fn(),
  verifyMock: vi.fn(),
  updateSkillConfigMock: vi.fn(),
}));

vi.mock('@electron/gateway/skill-catalog', () => ({
  findCatalogEntry: (slug: string) => ({
    slug,
    name: 'PDF Reader',
    description: 'fixture entry',
    version: '1.2.0',
    author: 'fixture',
    github: 'openclaw/skill-pdf',
    tags: [],
  }),
  searchCatalog: () => [],
}));

vi.mock('@electron/gateway/skill-installer', () => ({
  installSkillFromCatalog: installMock,
  resolveInstalledSkillDir: (slug: string) => `/fixture/skills/${slug}`,
  verifyInstalledSkillIntegrity: verifyMock,
}));

vi.mock('@electron/utils/skill-config', () => ({
  getAllSkillConfigs: vi.fn(async () => ({})),
  getSkillConfig: vi.fn(async () => undefined),
  updateSkillConfig: (...args: unknown[]) => updateSkillConfigMock(...args),
  updateSkillConfigs: vi.fn(async () => ({ success: true })),
}));

vi.mock('@electron/services/skills/local-skill-service', () => ({
  listLocalSkills: vi.fn(async () => []),
}));

vi.mock('@electron/utils/skill-quick-access', () => ({
  collectQuickAccessSkills: vi.fn(async () => []),
  filterEnabledQuickAccessSkills: vi.fn(() => []),
}));

import { createSkillsApi } from '@electron/services/skills-api';

function createApi(): ReturnType<typeof createSkillsApi> {
  return createSkillsApi({
    clawHubService: {} as Parameters<typeof createSkillsApi>[0]['clawHubService'],
    gatewayManager: {} as Parameters<typeof createSkillsApi>[0]['gatewayManager'],
  });
}

const VERIFIED_IDENTITY = {
  slug: 'pdf',
  github: 'openclaw/skill-pdf',
  installedAt: '2026-10-10T00:00:00.000Z',
  declaredCatalogVersion: '1.2.0',
  requestedVersionStatus: 'honored',
  installSource: 'git-clone',
  trackedRef: 'v1.2.0',
  trackedRefKind: 'pinned',
  contentDigest: 'a'.repeat(64),
  contentDigestAlgorithm: 'sha256',
};

describe('skills.clawhubInstall install-trust gate (#131)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    installMock.mockResolvedValue(VERIFIED_IDENTITY);
    updateSkillConfigMock.mockResolvedValue({ success: true });
    verifyMock.mockReturnValue({ verified: true, reason: 'verified' });
  });

  it('forwards the requested version and enables only after integrity verification', async () => {
    const result = await createApi().clawhubInstall({ slug: 'pdf', version: '1.2.0' });

    expect(result).toEqual({ success: true, result: null });
    expect(installMock).toHaveBeenCalledWith(expect.objectContaining({ slug: 'pdf' }), '1.2.0');
    expect(verifyMock).toHaveBeenCalledWith('/fixture/skills/pdf');
    expect(updateSkillConfigMock).toHaveBeenCalledWith('pdf', { enabled: true });
  });

  it('ignores an unusable requested version instead of passing it to the installer', async () => {
    const result = await createApi().clawhubInstall({ slug: 'pdf', version: 'x'.repeat(500) });

    expect(result.success).toBe(true);
    expect(installMock).toHaveBeenCalledWith(expect.objectContaining({ slug: 'pdf' }), undefined);
  });

  it('keeps the skill disabled when the installed bytes cannot be verified', async () => {
    verifyMock.mockReturnValue({ verified: false, reason: 'digest-mismatch' });

    const result = await createApi().clawhubInstall({ slug: 'pdf' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/failed integrity verification \(digest-mismatch\)/);
    expect(updateSkillConfigMock).not.toHaveBeenCalled();
  });

  it('returns failure when enabling the verified install cannot persist', async () => {
    updateSkillConfigMock.mockResolvedValue({ success: false, error: 'config write failed' });
    const result = await createApi().clawhubInstall({ slug: 'pdf' });
    expect(result).toEqual({ success: false, error: 'config write failed' });
  });

  it('refuses slugs outside the built-in catalog without invoking the installer', async () => {
    const result = await createApi().clawhubInstall({ slug: 'not-in-catalog' });

    expect(result.success).toBe(false);
    expect(installMock).not.toHaveBeenCalled();
    expect(updateSkillConfigMock).not.toHaveBeenCalled();
  });
});

describe('managed skill uninstall routing', () => {
  it('calls the existing uninstall service and propagates its failure', async () => {
    const uninstall = vi.fn().mockResolvedValue(undefined);
    const api = createSkillsApi({ clawHubService: { uninstall } as never, gatewayManager: {} as never });
    expect(await api.clawhubUninstall({ slug: 'pdf' })).toEqual({ success: true, result: null });
    expect(uninstall).toHaveBeenCalledWith({ slug: 'pdf' });
    uninstall.mockRejectedValueOnce(new Error('cleanup failed'));
    expect(await api.clawhubUninstall({ slug: 'pdf' })).toEqual({ success: false, error: 'cleanup failed' });
    uninstall.mockClear();
    expect((await api.clawhubUninstall({ slug: '../escape' })).success).toBe(false);
    expect(uninstall).not.toHaveBeenCalled();
  });
});
