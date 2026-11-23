import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import type {
  RemoteTaskApprovePayload,
  RemoteTaskCreatePayload,
  RemoteTaskIdPayload,
} from '@shared/host-api/contract';
import type {
  RemoteTaskCommand,
  RemoteTaskPreview,
  RemoteTaskRecord,
  RemoteTaskSettingsPatch,
  RemoteTaskSnapshot,
  RemoteTaskSource,
} from '@shared/types/remote-tasks';
import { getDataDir } from '../utils/paths';
import { getAllSettings } from '../utils/store';
import { runOpenClawDoctor, runOpenClawDoctorFix } from '../utils/openclaw-doctor';
import { createSettingsApi } from './settings-api';
import { isRecord } from './payload-utils';
import { AtomicWriteError, readJsonStrict, withFileLock, writeJsonAtomic } from '../utils/durable-store';

const MAX_TASKS = 200;
const ALLOWED_SETTINGS_KEYS = new Set<keyof RemoteTaskSettingsPatch>([
  'theme',
  'language',
  'gatewayAutoStart',
  'telemetryEnabled',
  'cdpRemoteControlEnabled',
  'cdpRemoteDebuggingPort',
]);

function nowIso(): string {
  return new Date().toISOString();
}

function getRemoteTaskDir(): string {
  return join(getDataDir(), 'remote-tasks');
}

function getRemoteTaskFile(): string {
  return join(getRemoteTaskDir(), 'tasks.json');
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function validateSource(value: unknown): RemoteTaskSource {
  if (value === 'relay' || value === 'channel' || value === 'api') return value;
  return 'local';
}

function validateSettingsPatch(value: unknown): RemoteTaskSettingsPatch {
  if (!isRecord(value)) {
    throw new Error('settingsPatch.patch is required');
  }

  const patch: RemoteTaskSettingsPatch = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!ALLOWED_SETTINGS_KEYS.has(key as keyof RemoteTaskSettingsPatch)) {
      throw new Error(`settingsPatch.${key} is not allowed`);
    }

    if (key === 'theme') {
      if (rawValue !== 'light' && rawValue !== 'dark' && rawValue !== 'system') {
        throw new Error('settingsPatch.theme is invalid');
      }
      patch.theme = rawValue;
    } else if (key === 'language') {
      patch.language = requireString(rawValue, 'settingsPatch.language');
    } else if (key === 'cdpRemoteDebuggingPort') {
      if (typeof rawValue !== 'number' || !Number.isInteger(rawValue) || rawValue < 1024 || rawValue > 65535) {
        throw new Error('settingsPatch.cdpRemoteDebuggingPort is invalid');
      }
      patch.cdpRemoteDebuggingPort = rawValue;
    } else {
      if (typeof rawValue !== 'boolean') {
        throw new Error(`settingsPatch.${key} must be boolean`);
      }
      patch[key as Exclude<keyof RemoteTaskSettingsPatch, 'theme' | 'language' | 'cdpRemoteDebuggingPort'>] = rawValue;
    }
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('settingsPatch.patch must include at least one setting');
  }
  return patch;
}

function normalizeCommand(value: unknown): RemoteTaskCommand {
  if (!isRecord(value)) {
    throw new Error('command is required');
  }

  if (value.kind === 'message') {
    return {
      kind: 'message',
      title: requireString(value.title, 'message.title'),
      body: requireString(value.body, 'message.body'),
    };
  }

  if (value.kind === 'doctor') {
    const mode = value.mode === 'fix' ? 'fix' : 'diagnose';
    return { kind: 'doctor', mode };
  }

  if (value.kind === 'settingsPatch') {
    return {
      kind: 'settingsPatch',
      patch: validateSettingsPatch(value.patch),
    };
  }

  throw new Error('Unsupported remote task kind');
}

function normalizeTask(value: unknown): RemoteTaskRecord | null {
  if (!isRecord(value)) return null;
  try {
    const command = normalizeCommand(value.command);
    const status = value.status;
    if (
      status !== 'pending'
      && status !== 'pendingApproval'
      && status !== 'running'
      && status !== 'completed'
      && status !== 'failed'
      && status !== 'rejected'
    ) {
      return null;
    }
    return {
      id: requireString(value.id, 'id'),
      source: validateSource(value.source),
      status,
      command,
      reason: typeof value.reason === 'string' ? value.reason : undefined,
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : nowIso(),
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : nowIso(),
      approvedAt: typeof value.approvedAt === 'string' ? value.approvedAt : null,
      completedAt: typeof value.completedAt === 'string' ? value.completedAt : null,
      resultSummary: typeof value.resultSummary === 'string' ? value.resultSummary : undefined,
      error: typeof value.error === 'string' ? value.error : undefined,
    };
  } catch {
    return null;
  }
}

async function loadTasks(): Promise<RemoteTaskRecord[]> {
  const parsed = await readJsonStrict<unknown>(getRemoteTaskFile(), { fallback: [] });
  if (!Array.isArray(parsed)) throw new AtomicWriteError('Remote task store must contain an array', 'CORRUPT');
  const tasks = parsed.map(normalizeTask);
  if (tasks.some(task => task === null)) {
    throw new AtomicWriteError('Remote task store contains an invalid task', 'CORRUPT');
  }
  return tasks as RemoteTaskRecord[];
}

async function saveTasks(tasks: RemoteTaskRecord[]): Promise<void> {
  await writeJsonAtomic(getRemoteTaskFile(), tasks.slice(0, MAX_TASKS));
}

function snapshot(tasks: RemoteTaskRecord[]): RemoteTaskSnapshot {
  return {
    tasks: [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    generatedAt: nowIso(),
  };
}

async function updateTask(
  id: string,
  updater: (task: RemoteTaskRecord) => RemoteTaskRecord,
): Promise<RemoteTaskRecord> {
  return withFileLock(getRemoteTaskFile(), async () => {
    const tasks = await loadTasks();
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) throw new Error('Remote task not found');
    const updated = updater(tasks[index]);
    tasks[index] = updated;
    await saveTasks(tasks);
    return updated;
  });
}

export async function buildRemoteTaskPreview(task: RemoteTaskRecord): Promise<RemoteTaskPreview> {
  if (task.command.kind !== 'settingsPatch') {
    return { requiresApproval: false, changes: [] };
  }

  const settings = await getAllSettings();
  return {
    requiresApproval: true,
    changes: Object.entries(task.command.patch).map(([key, after]) => ({
      key,
      before: settings[key as keyof typeof settings],
      after,
    })),
  };
}

export function createRemoteTasksApi(ctx: { gatewayManager: GatewayManager }): CompleteHostServiceRegistry['remoteTasks'] {
  const settingsApi = createSettingsApi(ctx.gatewayManager);

  return {
    list: async () => ({ success: true, ...snapshot(await loadTasks()) }),

    create: async (payload: RemoteTaskCreatePayload) => {
      const command = normalizeCommand(payload?.command);
      const createdAt = nowIso();
      const task: RemoteTaskRecord = {
        id: randomUUID(),
        source: validateSource(payload?.source),
        status: command.kind === 'settingsPatch' ? 'pendingApproval' : 'pending',
        command,
        reason: typeof payload?.reason === 'string' ? payload.reason.trim() : undefined,
        createdAt,
        updatedAt: createdAt,
        approvedAt: null,
        completedAt: null,
      };
      await withFileLock(getRemoteTaskFile(), async () => {
        const tasks = [task, ...(await loadTasks())].slice(0, MAX_TASKS);
        await saveTasks(tasks);
      });
      return { success: true, task };
    },

    preview: async (payload: RemoteTaskIdPayload) => {
      const id = requireString(payload?.id, 'id');
      const task = (await loadTasks()).find((item) => item.id === id);
      if (!task) throw new Error('Remote task not found');
      return { success: true, ...(await buildRemoteTaskPreview(task)) };
    },

    approve: async (payload: RemoteTaskApprovePayload) => {
      const id = requireString(payload?.id, 'id');
      const task = await updateTask(id, (current) => {
        if (current.status !== 'pendingApproval') return current;
        const updatedAt = nowIso();
        return {
          ...current,
          status: payload.approved === false ? 'rejected' : 'pending',
          approvedAt: payload.approved === false ? null : updatedAt,
          completedAt: payload.approved === false ? updatedAt : null,
          updatedAt,
        };
      });
      return { success: true, task };
    },

    reject: async (payload: RemoteTaskIdPayload) => {
      const id = requireString(payload?.id, 'id');
      const updatedAt = nowIso();
      const task = await updateTask(id, (current) => {
        if (current.status === 'running') throw new Error('Remote task is already running');
        return {
          ...current,
          status: 'rejected',
          updatedAt,
          completedAt: updatedAt,
        };
      });
      return { success: true, task };
    },

    execute: async (payload: RemoteTaskIdPayload) => {
      const id = requireString(payload?.id, 'id');
      let task = await updateTask(id, (current) => {
        if (current.status === 'pendingApproval') {
          throw new Error('Remote task requires approval');
        }
        if (current.status === 'running') {
          throw new Error('Remote task is already running; reconcile the existing execution before retrying');
        }
        if (current.status === 'completed' || current.status === 'rejected') {
          return current;
        }
        return {
          ...current,
          status: 'running',
          updatedAt: nowIso(),
          error: undefined,
        };
      });

      if (task.status === 'completed' || task.status === 'rejected') {
        return { success: true, task };
      }

      try {
        let resultSummary = '';
        if (task.command.kind === 'message') {
          resultSummary = task.command.body;
        } else if (task.command.kind === 'doctor') {
          const result = task.command.mode === 'fix' ? await runOpenClawDoctorFix() : await runOpenClawDoctor();
          resultSummary = `${result.command} exited ${result.exitCode ?? 'null'}`;
          if (!result.success) {
            throw new Error(result.error || result.stderr || resultSummary);
          }
        } else {
          await settingsApi.setMany({ patch: task.command.patch });
          resultSummary = Object.keys(task.command.patch).join(', ');
        }

        const completedAt = nowIso();
        task = await updateTask(id, (current) => ({
          ...current,
          status: 'completed',
          resultSummary,
          updatedAt: completedAt,
          completedAt,
          error: undefined,
        }));
      } catch (error) {
        const updatedAt = nowIso();
        const message = error instanceof Error ? error.message : String(error);
        task = await updateTask(id, (current) => ({
          ...current,
          status: 'failed',
          error: message,
          updatedAt,
          completedAt: updatedAt,
        }));
      }

      return { success: task.status === 'completed', task, error: task.error };
    },
  };
}
