import type { GeneratedFile } from '@/lib/generated-files';
import type { TaskStep } from '@/pages/Chat/task-visualization';

export type TurnWorkStatus = 'idle' | 'running' | 'completed' | 'blocked' | 'error';
export type TurnWorkPrimaryKind = 'tasks' | 'reports' | 'sources' | null;

export type TurnTaskItem = {
  id: string;
  label: string;
  status: 'running' | 'completed' | 'error';
  detail?: string;
  kind: TaskStep['kind'];
};

export type TurnReportItem = {
  id: string;
  file: GeneratedFile;
  fileName: string;
  filePath: string;
  action: GeneratedFile['action'];
  contentType: GeneratedFile['contentType'];
};

export type TurnSourceItem = {
  id: string;
  url: string;
  domain: string;
  label: string;
  status: 'running' | 'completed' | 'error';
};

export type TurnWorkModel = {
  id: string;
  status: TurnWorkStatus;
  primaryKind: TurnWorkPrimaryKind;
  tasks: TurnTaskItem[];
  reports: TurnReportItem[];
  sources: TurnSourceItem[];
};

function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url.replace(/^https?:\/\//i, '').split('/')[0] || url;
  }
}

function normalizeTask(step: TaskStep): TurnTaskItem {
  return {
    id: step.id,
    label: step.label,
    status: step.status,
    detail: step.detail,
    kind: step.kind,
  };
}

function deriveStatus(input: {
  active: boolean;
  tasks: TurnTaskItem[];
  reports: TurnReportItem[];
  sources: TurnSourceItem[];
}): TurnWorkStatus {
  if (input.tasks.some((task) => task.status === 'error') || input.sources.some((source) => source.status === 'error')) {
    return 'error';
  }
  if (input.active || input.tasks.some((task) => task.status === 'running') || input.sources.some((source) => source.status === 'running')) {
    return 'running';
  }
  if (input.tasks.length > 0 || input.reports.length > 0 || input.sources.length > 0) {
    return 'completed';
  }
  return 'idle';
}

function primaryKind(input: {
  status: TurnWorkStatus;
  tasks: TurnTaskItem[];
  reports: TurnReportItem[];
  sources: TurnSourceItem[];
}): TurnWorkPrimaryKind {
  if (input.status === 'running' && input.tasks.length > 0) return 'tasks';
  if (input.reports.length > 0) return 'reports';
  if (input.sources.length > 0) return 'sources';
  if (input.tasks.length > 0) return 'tasks';
  return null;
}

export function buildTurnWorkModel(input: {
  id: string;
  active: boolean;
  steps: TaskStep[];
  reports: GeneratedFile[];
}): TurnWorkModel | null {
  const tasks = input.steps.map(normalizeTask);
  const reports = input.reports.map((file, index): TurnReportItem => ({
    id: `${file.filePath}:${file.lastSeenIndex}:${index}`,
    file,
    fileName: file.fileName,
    filePath: file.filePath,
    action: file.action,
    contentType: file.contentType,
  }));
  const sources = input.steps
    .filter((step) => step.url)
    .map((step, index): TurnSourceItem => ({
      id: `${step.id}:${step.url}:${index}`,
      url: step.url!,
      domain: sourceDomain(step.url!),
      label: step.label || 'web_fetch',
      status: step.status,
    }));
  const status = deriveStatus({ active: input.active, tasks, reports, sources });
  const primary = primaryKind({ status, tasks, reports, sources });
  if (primary == null) return null;
  return {
    id: input.id,
    status,
    primaryKind: primary,
    tasks,
    reports,
    sources,
  };
}
