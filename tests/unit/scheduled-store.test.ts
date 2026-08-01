import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CronJob } from '@/types/cron';
import type { AgentBrowserTask } from '@shared/host-api/contract';

const mocks = vi.hoisted(() => ({
  browserTasks: vi.fn(),
  approveTask: vi.fn(),
  rejectTask: vi.fn(),
  retryTask: vi.fn(),
  cancelTask: vi.fn(),
  inboxRefresh: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    agentBrowser: {
      tasks: mocks.browserTasks,
      approveTask: mocks.approveTask,
      rejectTask: mocks.rejectTask,
      retryTask: mocks.retryTask,
      cancelTask: mocks.cancelTask,
    },
  },
}));

vi.mock('@/stores/inbox', () => ({
  useInboxStore: {
    getState: () => ({ refresh: mocks.inboxRefresh }),
  },
}));

import {
  getBrowserScheduledActions,
  projectScheduledItems,
  useScheduledStore,
} from '@/stores/scheduled';

const cronJob: CronJob = {
  id: 'cron-1',
  name: 'Daily report',
  message: 'Summarize progress',
  schedule: { kind: 'cron', expr: '0 9 * * *' },
  enabled: true,
  createdAt: '2026-07-31T08:00:00.000Z',
  updatedAt: '2026-07-31T08:00:00.000Z',
  nextRun: '2026-08-01T09:00:00.000Z',
  agentId: 'main',
};

const browserTask: AgentBrowserTask = {
  id: 'browser-1',
  name: 'Verify release',
  url: 'https://example.com/releases',
  objective: 'Verify the latest release heading',
  profile: 'work',
  mode: 'visible',
  allowedDomains: ['example.com'],
  permissionScope: ['navigate', 'read-page'],
  steps: [{ id: 'step-1', action: 'wait-for-selector', selector: 'h1', status: 'pending' }],
  successCriteria: { kind: 'selector-visible', value: 'h1' },
  approval: { status: 'pending', requestedAt: '2026-07-31T10:00:00.000Z' },
  counters: { totalSteps: 1, passedSteps: 0, failedSteps: 0 },
  status: 'waiting-approval',
  retryCount: 0,
  createdAt: '2026-07-31T10:00:00.000Z',
  updatedAt: '2026-07-31T10:00:00.000Z',
};

describe('Scheduled store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useScheduledStore.setState({
      browserTasks: [],
      loadingBrowserTasks: false,
      browserLoaded: false,
      browserError: null,
      busyKey: null,
    });
    mocks.browserTasks.mockResolvedValue({ success: true, tasks: [] });
    mocks.approveTask.mockResolvedValue({ success: true, task: { ...browserTask, status: 'running' } });
    mocks.rejectTask.mockResolvedValue({ success: true, task: { ...browserTask, status: 'cancelled' } });
    mocks.retryTask.mockResolvedValue({ success: true, task: { ...browserTask, status: 'waiting-approval' } });
    mocks.cancelTask.mockResolvedValue({ success: true, task: { ...browserTask, status: 'cancelled' } });
    mocks.inboxRefresh.mockResolvedValue(undefined);
  });

  it('projects Cron and Browser models into a discriminated ScheduledItem union', () => {
    const items = projectScheduledItems({ cronJobs: [cronJob], browserTasks: [browserTask] });

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.source).sort()).toEqual(['browser-task', 'cron-job']);
    expect(items.find((item) => item.source === 'cron-job')).toMatchObject({ enabled: true, status: 'enabled' });
    expect(items.find((item) => item.source === 'browser-task')).toMatchObject({ actions: ['approve-and-run', 'reject'] });
  });

  it('constrains Browser actions by persisted task status', () => {
    expect(getBrowserScheduledActions(browserTask)).toEqual(['approve-and-run', 'reject']);
    expect(getBrowserScheduledActions({ ...browserTask, status: 'running', approval: { ...browserTask.approval, status: 'consumed' } })).toEqual(['cancel']);
    expect(getBrowserScheduledActions({ ...browserTask, status: 'failed', approval: { ...browserTask.approval, status: 'consumed' } })).toEqual(['retry']);
    expect(getBrowserScheduledActions({ ...browserTask, status: 'completed', approval: { ...browserTask.approval, status: 'consumed' } })).toEqual([]);
  });

  it('preserves cached Browser tasks when a refresh fails', async () => {
    mocks.browserTasks.mockResolvedValueOnce({ success: true, tasks: [browserTask] });
    await useScheduledStore.getState().refreshBrowserTasks();
    mocks.browserTasks.mockRejectedValueOnce(new Error('browser service unavailable'));

    await useScheduledStore.getState().refreshBrowserTasks();

    expect(useScheduledStore.getState().browserTasks).toEqual([browserTask]);
    expect(useScheduledStore.getState().browserError).toBe('browser service unavailable');
  });

  it('runs the exact Browser action and refreshes Scheduled and Inbox state', async () => {
    mocks.browserTasks.mockResolvedValue({ success: true, tasks: [browserTask] });

    await useScheduledStore.getState().actOnBrowserTask(browserTask.id, 'approve-and-run');

    expect(mocks.approveTask).toHaveBeenCalledWith({ taskId: browserTask.id });
    expect(mocks.browserTasks).toHaveBeenCalled();
    expect(mocks.inboxRefresh).toHaveBeenCalled();
    expect(useScheduledStore.getState().busyKey).toBeNull();
  });
});
