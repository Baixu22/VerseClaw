import { beforeEach, describe, expect, it, vi } from 'vitest';

const statusMock = vi.fn();
const localMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    skills: {
      status: () => statusMock(),
      local: () => localMock(),
      clawhubSearch: vi.fn(),
      clawhubInstall: vi.fn(),
      clawhubUninstall: vi.fn(),
      updateConfigs: vi.fn(),
    },
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('skills store local-only fetch', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('loads local skills without querying gateway skills.status', async () => {
    const localDeferred = deferred<{ success: boolean; skills: Array<Record<string, unknown>> }>();
    localMock.mockReturnValueOnce(localDeferred.promise);

    const { useSkillsStore } = await import('@/stores/skills');
    useSkillsStore.setState({ skills: [], loading: false, error: null });

    const fetchPromise = useSkillsStore.getState().fetchSkills();
    await Promise.resolve();

    expect(statusMock).not.toHaveBeenCalled();
    expect(localMock).toHaveBeenCalledTimes(1);

    localDeferred.resolve({
      success: true,
      skills: [{ id: 'pdf', name: 'PDF', description: 'local', enabled: true }],
    });

    await expect(fetchPromise).resolves.toBe(true);
    expect(useSkillsStore.getState().skills).toHaveLength(1);
    expect(useSkillsStore.getState().skills[0]).toMatchObject({ id: 'pdf', description: 'local', enabled: true });
  });

  it('does not append bundled gateway skills that are missing from local scan', async () => {
    localMock.mockResolvedValueOnce({ success: true, skills: [] });

    const { useSkillsStore } = await import('@/stores/skills');
    useSkillsStore.setState({ skills: [], loading: false, error: null });

    const fetchPromise = useSkillsStore.getState().fetchSkills();
    await expect(fetchPromise).resolves.toBe(true);

    expect(statusMock).not.toHaveBeenCalled();
    expect(useSkillsStore.getState().skills.map((skill) => skill.id)).toEqual([]);
  });

  it('does not resurrect gateway-managed skills that are missing from local scan', async () => {
    localMock.mockResolvedValueOnce({ success: true, skills: [] });

    const { useSkillsStore } = await import('@/stores/skills');
    useSkillsStore.setState({ skills: [], loading: false, error: null });

    const fetchPromise = useSkillsStore.getState().fetchSkills();
    await expect(fetchPromise).resolves.toBe(true);

    expect(statusMock).not.toHaveBeenCalled();
    expect(useSkillsStore.getState().skills.map((skill) => skill.id)).toEqual([]);
  });
});
