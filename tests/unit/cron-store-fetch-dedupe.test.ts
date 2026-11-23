import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
  hostApi: {
    cron: {
      list: () => hostApiFetchMock('/api/cron/jobs'),
    },
  },
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: {
    getState: () => ({
      currentAgentId: 'main',
    }),
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

describe('cron store fetchJobs dedupe', () => {
  it('retains the last snapshot on a failed refresh and accepts a real empty list', async () => {
    const { useCronStore } = await import('@/stores/cron');
    useCronStore.setState({ jobs: [{ id: 'retained' } as never], error: null });
    hostApiFetchMock.mockRejectedValueOnce(new Error('Gateway offline'));
    await useCronStore.getState().fetchJobs();
    expect(useCronStore.getState().jobs.map(job => job.id)).toEqual(['retained']);
    expect(useCronStore.getState().error).toContain('Gateway offline');
    hostApiFetchMock.mockResolvedValueOnce([]);
    await useCronStore.getState().fetchJobs();
    expect(useCronStore.getState().jobs).toEqual([]);
    expect(useCronStore.getState().error).toBeNull();
  });
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('reuses in-flight fetchJobs request when called concurrently', async () => {
    const listDeferred = deferred<Array<{ id: string }>>();
    hostApiFetchMock.mockReturnValueOnce(listDeferred.promise);

    const { useCronStore } = await import('@/stores/cron');
    useCronStore.setState({ jobs: [], loading: false, error: null });

    const first = useCronStore.getState().fetchJobs();
    const second = useCronStore.getState().fetchJobs();
    await Promise.resolve();

    expect(hostApiFetchMock).toHaveBeenCalledTimes(1);
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/cron/jobs');

    listDeferred.resolve([{ id: 'job-1' }]);
    await Promise.all([first, second]);

    expect(useCronStore.getState().jobs.map((job) => job.id)).toEqual(['job-1']);
  });

  it('replaces stale renderer jobs with the host-api snapshot', async () => {
    hostApiFetchMock.mockResolvedValueOnce([{ id: 'job-current' }]);

    const { useCronStore } = await import('@/stores/cron');
    useCronStore.setState({
      jobs: [{ id: 'job-stale' } as never],
      loading: false,
      error: null,
    });

    await useCronStore.getState().fetchJobs();

    expect(useCronStore.getState().jobs.map((job) => job.id)).toEqual(['job-current']);
  });
});
