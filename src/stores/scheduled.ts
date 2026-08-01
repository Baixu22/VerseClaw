import { create } from 'zustand';
import { hostApi } from '@/lib/host-api';
import { useInboxStore } from '@/stores/inbox';
import type { CronJob } from '@/types/cron';
import type { AgentBrowserTask } from '@shared/host-api/contract';

export type ScheduledSource = 'cron-job' | 'browser-task';
export type BrowserScheduledAction = 'approve-and-run' | 'reject' | 'retry' | 'cancel';

type ScheduledItemBase = {
  key: string;
  id: string;
  source: ScheduledSource;
  title: string;
  summary: string;
  status: string;
  timestamp: number;
  searchText: string;
};

export type CronScheduledItem = ScheduledItemBase & {
  source: 'cron-job';
  enabled: boolean;
  nextRun?: string;
  job: CronJob;
};

export type BrowserScheduledItem = ScheduledItemBase & {
  source: 'browser-task';
  actions: BrowserScheduledAction[];
  task: AgentBrowserTask;
};

export type ScheduledItem = CronScheduledItem | BrowserScheduledItem;

function safeTimestamp(value: string | undefined): number {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function getBrowserScheduledActions(task: AgentBrowserTask): BrowserScheduledAction[] {
  if (task.status === 'waiting-approval' && task.approval.status === 'pending') {
    return ['approve-and-run', 'reject'];
  }
  if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'interrupted') {
    return ['retry'];
  }
  if (task.status === 'running') return ['cancel'];
  return [];
}

export function projectCronScheduledItem(job: CronJob): CronScheduledItem {
  const summary = job.taskKind === 'browserAutomation' && job.browserAutomation
    ? `${job.browserAutomation.url} ${job.browserAutomation.objective}`
    : job.message;
  return {
    key: `cron-job:${job.id}`,
    id: job.id,
    source: 'cron-job',
    title: job.name,
    summary,
    status: job.enabled ? 'enabled' : 'paused',
    timestamp: safeTimestamp(job.nextRun ?? job.updatedAt ?? job.createdAt),
    searchText: [job.name, summary, job.agentId, job.delivery?.channel, job.delivery?.to]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
    enabled: job.enabled,
    nextRun: job.nextRun,
    job,
  };
}

export function projectBrowserScheduledItem(task: AgentBrowserTask): BrowserScheduledItem {
  return {
    key: `browser-task:${task.id}`,
    id: task.id,
    source: 'browser-task',
    title: task.name,
    summary: task.objective,
    status: task.status,
    timestamp: safeTimestamp(task.updatedAt ?? task.createdAt),
    searchText: [task.name, task.objective, task.url, task.profile, ...task.allowedDomains]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
    actions: getBrowserScheduledActions(task),
    task,
  };
}

export function projectScheduledItems(input: {
  cronJobs?: CronJob[];
  browserTasks?: AgentBrowserTask[];
}): ScheduledItem[] {
  return [
    ...(input.cronJobs ?? []).map(projectCronScheduledItem),
    ...(input.browserTasks ?? []).map(projectBrowserScheduledItem),
  ].sort((left, right) => right.timestamp - left.timestamp || left.title.localeCompare(right.title));
}

type ScheduledState = {
  browserTasks: AgentBrowserTask[];
  loadingBrowserTasks: boolean;
  browserLoaded: boolean;
  browserError: string | null;
  busyKey: string | null;
  refreshBrowserTasks: () => Promise<void>;
  actOnBrowserTask: (id: string, action: BrowserScheduledAction) => Promise<void>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertHostSuccess(result: { success: boolean; error?: string }): void {
  if (!result.success) throw new Error(result.error || 'Host action failed');
}

let browserRefreshInFlight: Promise<void> | null = null;

export const useScheduledStore = create<ScheduledState>((set, get) => ({
  browserTasks: [],
  loadingBrowserTasks: false,
  browserLoaded: false,
  browserError: null,
  busyKey: null,

  refreshBrowserTasks: async () => {
    if (browserRefreshInFlight) return browserRefreshInFlight;
    browserRefreshInFlight = (async () => {
      if (!get().browserLoaded) set({ loadingBrowserTasks: true });
      set({ browserError: null });
      try {
        const result = await hostApi.agentBrowser.tasks();
        assertHostSuccess(result);
        set({ browserTasks: result.tasks ?? [], browserLoaded: true });
      } catch (error) {
        set({ browserError: errorMessage(error), browserLoaded: true });
      } finally {
        set({ loadingBrowserTasks: false });
      }
    })();

    try {
      await browserRefreshInFlight;
    } finally {
      browserRefreshInFlight = null;
    }
  },

  actOnBrowserTask: async (id, action) => {
    set({ busyKey: `browser-task:${id}` });
    try {
      const result = action === 'approve-and-run'
        ? await hostApi.agentBrowser.approveTask({ taskId: id })
        : action === 'reject'
          ? await hostApi.agentBrowser.rejectTask({ taskId: id })
          : action === 'retry'
            ? await hostApi.agentBrowser.retryTask({ taskId: id })
            : await hostApi.agentBrowser.cancelTask({ taskId: id });
      assertHostSuccess(result);
    } finally {
      await Promise.allSettled([
        get().refreshBrowserTasks(),
        useInboxStore.getState().refresh(),
      ]);
      set({ busyKey: null });
    }
  },
}));
