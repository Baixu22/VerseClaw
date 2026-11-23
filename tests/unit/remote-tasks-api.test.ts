import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const { state } = vi.hoisted(() => ({
  state: {
    dataDir: '',
    settings: {
      theme: 'dark',
      language: 'en',
      gatewayAutoStart: true,
      telemetryEnabled: true,
      cdpRemoteControlEnabled: false,
      cdpRemoteDebuggingPort: 9222,
    },
    setManyMock: vi.fn(),
    doctorMock: vi.fn(),
    doctorFixMock: vi.fn(),
  },
}));

vi.mock('@electron/utils/paths', () => ({
  getDataDir: () => state.dataDir,
}));

vi.mock('@electron/utils/store', () => ({
  getAllSettings: () => state.settings,
}));

vi.mock('@electron/utils/openclaw-doctor', () => ({
  runOpenClawDoctor: () => state.doctorMock(),
  runOpenClawDoctorFix: () => state.doctorFixMock(),
}));

vi.mock('@electron/services/settings-api', () => ({
  createSettingsApi: () => ({
    setMany: (...args: unknown[]) => state.setManyMock(...args),
  }),
}));

describe('remote tasks api', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    state.dataDir = await mkdtemp(join(tmpdir(), 'clawx-remote-tasks-'));
    state.setManyMock.mockResolvedValue({ success: true });
    state.doctorMock.mockResolvedValue({
      success: true,
      command: 'openclaw doctor',
      exitCode: 0,
      stdout: '',
      stderr: '',
      cwd: state.dataDir,
      durationMs: 1,
    });
  });

  afterEach(async () => {
    await rm(state.dataDir, { recursive: true, force: true });
  });

  it('requires approval before executing a settings patch', async () => {
    const { createRemoteTasksApi } = await import('@electron/services/remote-tasks-api');
    const api = createRemoteTasksApi({ gatewayManager: {} as never });

    const created = await api.create({
      source: 'local',
      command: {
        kind: 'settingsPatch',
        patch: { theme: 'system', cdpRemoteDebuggingPort: 9333 },
      },
    });

    expect(created.task.status).toBe('pendingApproval');
    await expect(api.execute({ id: created.task.id })).rejects.toThrow('requires approval');
    expect(state.setManyMock).not.toHaveBeenCalled();

    const preview = await api.preview({ id: created.task.id });
    expect(preview.requiresApproval).toBe(true);
    expect(preview.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'theme', before: 'dark', after: 'system' }),
      expect.objectContaining({ key: 'cdpRemoteDebuggingPort', before: 9222, after: 9333 }),
    ]));
  });

  it('executes an approved settings patch through the settings api', async () => {
    const { createRemoteTasksApi } = await import('@electron/services/remote-tasks-api');
    const api = createRemoteTasksApi({ gatewayManager: {} as never });

    const created = await api.create({
      command: {
        kind: 'settingsPatch',
        patch: { gatewayAutoStart: false },
      },
    });

    const approved = await api.approve({ id: created.task.id });
    expect(approved.task.status).toBe('pending');

    const executed = await api.execute({ id: created.task.id });
    expect(executed.task.status).toBe('completed');
    expect(state.setManyMock).toHaveBeenCalledWith({ patch: { gatewayAutoStart: false } });
  });

  it('rejects settings keys outside the remote task whitelist', async () => {
    const { createRemoteTasksApi } = await import('@electron/services/remote-tasks-api');
    const api = createRemoteTasksApi({ gatewayManager: {} as never });

    await expect(api.create({
      command: {
        kind: 'settingsPatch',
        patch: { gatewayToken: 'nope' } as never,
      },
    })).rejects.toThrow('not allowed');
  });

  it('executes doctor tasks without approval', async () => {
    const { createRemoteTasksApi } = await import('@electron/services/remote-tasks-api');
    const api = createRemoteTasksApi({ gatewayManager: {} as never });

    const created = await api.create({ command: { kind: 'doctor', mode: 'diagnose' } });
    expect(created.task.status).toBe('pending');

    const executed = await api.execute({ id: created.task.id });
    expect(executed.task.status).toBe('completed');
    expect(state.doctorMock).toHaveBeenCalled();
  });

  it('claims an execution once across concurrent requests and API instances', async () => {
    const { createRemoteTasksApi } = await import('@electron/services/remote-tasks-api');
    const first = createRemoteTasksApi({ gatewayManager: {} as never });
    const second = createRemoteTasksApi({ gatewayManager: {} as never });
    const task = (await first.create({ command: { kind: 'doctor', mode: 'fix' } })).task;
    let finish!: (value: unknown) => void;
    state.doctorFixMock.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const running = first.execute({ id: task.id });
    await vi.waitFor(() => expect(state.doctorFixMock).toHaveBeenCalledTimes(1));
    await expect(second.execute({ id: task.id })).rejects.toThrow('already running');
    await expect(second.reject({ id: task.id })).rejects.toThrow('already running');
    expect((await second.list()).tasks[0].status).toBe('running');
    finish({ success: true, command: 'fixture doctor fix', exitCode: 0 });
    expect((await running).success).toBe(true);
    expect((await second.execute({ id: task.id })).task.status).toBe('completed');
    expect(state.doctorFixMock).toHaveBeenCalledTimes(1);
  });

  it.each(['{"old-task":', '{}', '[{}]'])('preserves invalid task store bytes and rejects writes: %s', async (raw) => {
    const { createRemoteTasksApi } = await import('@electron/services/remote-tasks-api');
    const file = join(state.dataDir, 'remote-tasks', 'tasks.json');
    await mkdir(join(state.dataDir, 'remote-tasks'));
    await writeFile(file, raw);
    const api = createRemoteTasksApi({ gatewayManager: {} as never });
    await expect(api.list()).rejects.toMatchObject({ code: 'CORRUPT' });
    await expect(api.create({ command: { kind: 'message', title: 'new', body: 'new' } })).rejects.toMatchObject({ code: 'CORRUPT' });
    expect(await readFile(file, 'utf8')).toBe(raw);
  });

  it('retains concurrent creates and holds a persisted running task after restart', async () => {
    const { createRemoteTasksApi } = await import('@electron/services/remote-tasks-api');
    const api = createRemoteTasksApi({ gatewayManager: {} as never });
    await Promise.all(['one', 'two'].map(title => api.create({ command: { kind: 'message', title, body: title } })));
    const tasks = (await api.list()).tasks;
    expect(tasks).toHaveLength(2);
    tasks[0].status = 'running';
    await writeFile(join(state.dataDir, 'remote-tasks', 'tasks.json'), JSON.stringify(tasks));
    await expect(createRemoteTasksApi({ gatewayManager: {} as never }).execute({ id: tasks[0].id })).rejects.toThrow('already running');
  });

  it('recovers a missing primary from its backup instead of accepting an empty queue', async () => {
    const { createRemoteTasksApi } = await import('@electron/services/remote-tasks-api');
    const api = createRemoteTasksApi({ gatewayManager: {} as never });
    const one = (await api.create({ command: { kind: 'message', title: 'retained', body: 'old task' } })).task;
    await api.create({ command: { kind: 'message', title: 'later', body: 'new task' } });
    await rm(join(state.dataDir, 'remote-tasks', 'tasks.json'));
    expect((await api.list()).tasks.map(task => task.id)).toEqual([one.id]);
  });
});
