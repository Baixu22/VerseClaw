import { beforeEach, describe, expect, it, vi } from 'vitest';

const on = vi.fn();
const off = vi.fn();

beforeEach(() => {
  on.mockReset();
  off.mockReset();
  vi.resetModules();
  vi.stubGlobal('window', {
    electron: { ipcRenderer: { on, off } },
  });
});

describe('hostEvents', () => {
  it('subscribes to gateway status over IPC', async () => {
    on.mockReturnValueOnce(() => undefined);
    const { hostEvents } = await import('@/lib/host-events');
    const handler = vi.fn();

    hostEvents.onGatewayStatus(handler);

    expect(on).toHaveBeenCalledWith('gateway:status-changed', expect.any(Function));
  });

  it('passes typed app navigation payloads from IPC callbacks', async () => {
    const { hostEvents } = await import('@/lib/host-events');
    const handler = vi.fn();

    hostEvents.onNavigate(handler);
    const callback = on.mock.calls[0]?.[1] as ((payload: string) => void) | undefined;
    callback?.('/settings');

    expect(on).toHaveBeenCalledWith('navigate', expect.any(Function));
    expect(handler).toHaveBeenCalledWith('/settings');
  });

  it('subscribes to chat runtime events over IPC', async () => {
    const { hostEvents } = await import('@/lib/host-events');
    const handler = vi.fn();

    hostEvents.onChatRuntimeEvent(handler);
    const callback = on.mock.calls[0]?.[1] as ((payload: unknown) => void) | undefined;
    callback?.({ type: 'run.started', runId: 'run-1' });

    expect(on).toHaveBeenCalledWith('chat:runtime-event', expect.any(Function));
    expect(handler).toHaveBeenCalledWith({ type: 'run.started', runId: 'run-1' });
  });

  it('subscribes to subagent lifecycle events over IPC', async () => {
    const { hostEvents } = await import('@/lib/host-events');
    const handler = vi.fn();

    hostEvents.onSubagentLifecycle(handler);
    const callback = on.mock.calls[0]?.[1] as ((payload: unknown) => void) | undefined;
    callback?.({ runId: 'run-1', status: 'started' });

    expect(on).toHaveBeenCalledWith('agent:subagent-lifecycle', expect.any(Function));
    expect(handler).toHaveBeenCalledWith({ runId: 'run-1', status: 'started' });
  });

  it('subscribes to mission lifecycle events over IPC', async () => {
    const { hostEvents } = await import('@/lib/host-events');
    const handler = vi.fn();

    hostEvents.onMissionControlLifecycle(handler);
    const callback = on.mock.calls[0]?.[1] as ((payload: unknown) => void) | undefined;
    callback?.({
      missionId: 'mission-1',
      sessionKey: 'agent:main:session',
      phase: 'reflect',
      status: 'running',
      tick: 1,
      progress: 72,
      controlSignals: [{ kind: 'validation_missing', severity: 'warning', message: 'tests not run' }],
      validationState: { status: 'missing', checks: ['unit tests'], evidenceRefs: [] },
      ts: 1,
    });

    expect(on).toHaveBeenCalledWith('agent:mission-lifecycle', expect.any(Function));
    expect(handler).toHaveBeenCalledWith({
      missionId: 'mission-1',
      sessionKey: 'agent:main:session',
      phase: 'reflect',
      status: 'running',
      tick: 1,
      progress: 72,
      controlSignals: [{ kind: 'validation_missing', severity: 'warning', message: 'tests not run' }],
      validationState: { status: 'missing', checks: ['unit tests'], evidenceRefs: [] },
      ts: 1,
    });
  });

  it('subscribes to observability runtime events over IPC', async () => {
    const { hostEvents } = await import('@/lib/host-events');
    const handler = vi.fn();

    hostEvents.onObservabilityRuntimeEvent(handler);
    const callback = on.mock.calls[0]?.[1] as ((payload: unknown) => void) | undefined;
    callback?.({ type: 'trace.started', trace: { id: 'trace-1' } });

    expect(on).toHaveBeenCalledWith('observability:runtime-event', expect.any(Function));
    expect(handler).toHaveBeenCalledWith({ type: 'trace.started', trace: { id: 'trace-1' } });
  });

  it('subscribes to Office Tools install events over IPC', async () => {
    const { hostEvents } = await import('@/lib/host-events');
    const handler = vi.fn();

    hostEvents.onOfficeToolsInstallEvent(handler);
    const callback = on.mock.calls[0]?.[1] as ((payload: unknown) => void) | undefined;
    callback?.({ taskId: 'task-1', kind: 'log', payload: 'Downloading officecli' });

    expect(on).toHaveBeenCalledWith('office-tools:install-event', expect.any(Function));
    expect(handler).toHaveBeenCalledWith({ taskId: 'task-1', kind: 'log', payload: 'Downloading officecli' });
  });

  it('subscribes to dynamic channel QR events', async () => {
    const { hostEvents } = await import('@/lib/host-events');
    const handler = vi.fn();

    hostEvents.onChannelQr('wechat', handler);

    expect(on).toHaveBeenCalledWith('channel:wechat-qr', expect.any(Function));
  });

  it('does not create EventSource fallback', async () => {
    const eventSource = vi.fn();
    vi.stubGlobal('EventSource', eventSource);
    on.mockReturnValueOnce(() => undefined);
    const { hostEvents } = await import('@/lib/host-events');

    hostEvents.onGatewayNotification(vi.fn());

    expect(eventSource).not.toHaveBeenCalled();
  });
});
