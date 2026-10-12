import { describe, expect, it, vi } from 'vitest';
import { dispatchProtocolEvent, dispatchJsonRpcNotification, normalizePromptCacheBreak } from '@electron/gateway/event-dispatch';

function createMockEmitter() {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  return {
    emit: vi.fn((event: string, payload: unknown) => {
      emitted.push({ event, payload });
      return true;
    }),
    emitted,
  };
}

describe('dispatchProtocolEvent', () => {
  it('dispatches gateway.ready event to gateway:ready', () => {
    const emitter = createMockEmitter();
    dispatchProtocolEvent(emitter, 'gateway.ready', { version: '4.11' });
    expect(emitter.emit).toHaveBeenCalledWith('gateway:ready', { version: '4.11' });
  });

  it('dispatches ready event to gateway:ready', () => {
    const emitter = createMockEmitter();
    dispatchProtocolEvent(emitter, 'ready', { skills: 31 });
    expect(emitter.emit).toHaveBeenCalledWith('gateway:ready', { skills: 31 });
  });

  it('dispatches channel.status to channel:status', () => {
    const emitter = createMockEmitter();
    dispatchProtocolEvent(emitter, 'channel.status', { channelId: 'telegram', status: 'connected' });
    expect(emitter.emit).toHaveBeenCalledWith('channel:status', { channelId: 'telegram', status: 'connected' });
  });

  it('dispatches native health and presence events separately from generic notifications', () => {
    const emitter = createMockEmitter();
    dispatchProtocolEvent(emitter, 'health', { ok: true });
    dispatchProtocolEvent(emitter, 'presence', [{ mode: 'gateway', ts: 1 }]);

    expect(emitter.emit).toHaveBeenCalledWith('gateway:health', { ok: true });
    expect(emitter.emit).toHaveBeenCalledWith('gateway:presence', [{ mode: 'gateway', ts: 1 }]);
    expect(emitter.emit).not.toHaveBeenCalledWith('notification', expect.objectContaining({ method: 'health' }));
    expect(emitter.emit).not.toHaveBeenCalledWith('notification', expect.objectContaining({ method: 'presence' }));
  });

  it('dispatches chat to chat:message', () => {
    const emitter = createMockEmitter();
    dispatchProtocolEvent(emitter, 'chat', { text: 'hello' });
    expect(emitter.emit).toHaveBeenCalledWith('chat:message', { message: { text: 'hello' } });
  });

  it('does not normalize non-terminal lifecycle phase=end as run.ended', () => {
    const emitter = createMockEmitter();
    const payload = {
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      stream: 'lifecycle',
      seq: 4,
      ts: 10,
      data: {
        phase: 'end',
        endedAt: 11,
      },
    };

    dispatchProtocolEvent(emitter, 'agent', payload);

    expect(emitter.emit).not.toHaveBeenCalledWith('chat:runtime-event', expect.objectContaining({
      type: 'run.ended',
      runId: 'run-1',
    }));
    expect(emitter.emit).toHaveBeenCalledWith('notification', {
      method: 'agent',
      params: payload,
    });
  });

  it('normalizes terminal lifecycle phases as run.ended', () => {
    const emitter = createMockEmitter();
    dispatchProtocolEvent(emitter, 'agent', {
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      stream: 'lifecycle',
      seq: 5,
      ts: 12,
      data: {
        phase: 'completed',
        endedAt: 13,
      },
    });

    expect(emitter.emit).toHaveBeenCalledWith('chat:runtime-event', {
      type: 'run.ended',
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      seq: 5,
      ts: 12,
      status: 'completed',
      endedAt: 13,
      livenessState: undefined,
      replayInvalid: undefined,
      stopReason: undefined,
    });
  });

  it('dispatches normalized agent runtime events alongside the legacy notification path', () => {
    const emitter = createMockEmitter();
    dispatchProtocolEvent(emitter, 'agent', {
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      stream: 'tool',
      seq: 3,
      ts: 10,
      data: {
        phase: 'start',
        name: 'read',
        toolCallId: 'call-1',
        args: { filePath: '/tmp/demo.md' },
      },
    });

    expect(emitter.emit).toHaveBeenCalledWith('chat:runtime-event', {
      type: 'tool.started',
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      seq: 3,
      ts: 10,
      toolCallId: 'call-1',
      name: 'read',
      args: { filePath: '/tmp/demo.md' },
    });
    expect(emitter.emit).toHaveBeenCalledWith('notification', {
      method: 'agent',
      params: expect.objectContaining({ runId: 'run-1', stream: 'tool' }),
    });
  });

  it('suppresses tick events', () => {
    const emitter = createMockEmitter();
    dispatchProtocolEvent(emitter, 'tick', {});
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('dispatches unknown events as notifications', () => {
    const emitter = createMockEmitter();
    dispatchProtocolEvent(emitter, 'some.custom.event', { data: 1 });
    expect(emitter.emit).toHaveBeenCalledWith('notification', { method: 'some.custom.event', params: { data: 1 } });
  });

  it('dispatches exec.approval.requested as approval:requested with the runtime fields', () => {
    const emitter = createMockEmitter();
    dispatchProtocolEvent(emitter, 'exec.approval.requested', {
      id: 'approval-1',
      request: {
        command: 'node --test',
        cwd: 'C:/workspace',
        host: 'gateway',
        agentId: 'main',
        allowedDecisions: ['allow-once', 'deny'],
      },
      createdAtMs: 1,
      expiresAtMs: 2,
    });

    expect(emitter.emit).toHaveBeenCalledWith('approval:requested', {
      approvalId: 'approval-1',
      command: 'node --test',
      commandPreview: null,
      cwd: 'C:/workspace',
      host: 'gateway',
      agentId: 'main',
      sessionKey: null,
      allowedDecisions: ['allow-once', 'deny'],
      createdAtMs: 1,
      expiresAtMs: 2,
    });
    expect(emitter.emit).not.toHaveBeenCalledWith('notification', expect.anything());
  });

  it('dispatches exec.approval.resolved as approval:resolved', () => {
    const emitter = createMockEmitter();
    dispatchProtocolEvent(emitter, 'exec.approval.resolved', {
      id: 'approval-1',
      decision: 'allow-once',
      resolvedBy: 'operator',
      ts: 3,
    });

    expect(emitter.emit).toHaveBeenCalledWith('approval:resolved', {
      approvalId: 'approval-1',
      decision: 'allow-once',
      resolvedBy: 'operator',
      ts: 3,
    });
  });

  it('routes prompt-cache break frames to a typed observation, not chat or notifications', () => {
    const emitter = createMockEmitter();
    dispatchProtocolEvent(emitter, 'agent', {
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      stream: 'prompt_cache',
      seq: 7,
      ts: 20,
      data: {
        phase: 'break',
        eventId: 'run-1:0',
        previousCacheRead: 12_000,
        cacheRead: 3_000,
        changes: ['tools', 'systemPrompt'],
      },
    });

    expect(emitter.emit).toHaveBeenCalledWith('prompt-cache:break', {
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      eventId: 'run-1:0',
      previousCacheRead: 12_000,
      cacheRead: 3_000,
      changes: ['tools', 'systemPrompt'],
    });
    expect(emitter.emit).not.toHaveBeenCalledWith('chat:runtime-event', expect.anything());
    expect(emitter.emit).not.toHaveBeenCalledWith('notification', expect.anything());
  });

  it('drops prompt-cache frames with missing or malformed fields', () => {
    const emitter = createMockEmitter();
    dispatchProtocolEvent(emitter, 'agent', {
      runId: 'run-1',
      stream: 'prompt_cache',
      data: { phase: 'break', eventId: 'run-1:0', cacheRead: 1 },
    });
    dispatchProtocolEvent(emitter, 'agent', {
      runId: 'run-1',
      stream: 'prompt_cache',
      data: { phase: 'start', eventId: 'run-1:0', previousCacheRead: 1, cacheRead: 1 },
    });
    expect(emitter.emit).not.toHaveBeenCalledWith('prompt-cache:break', expect.anything());
    expect(emitter.emit).not.toHaveBeenCalledWith('notification', expect.anything());
  });

  it('drops unknown change codes while keeping known ones', () => {
    const observation = normalizePromptCacheBreak({
      runId: 'run-1',
      stream: 'prompt_cache',
      data: {
        phase: 'break',
        eventId: 'run-1:0',
        previousCacheRead: 5_000,
        cacheRead: 1_000,
        changes: ['tools', 'bogus', 'systemPrompt'],
      },
    });
    expect(observation?.changes).toEqual(['tools', 'systemPrompt']);
  });

  it('routes JSON-RPC prompt-cache notifications without a generic notification', () => {
    const emitter = createMockEmitter();
    dispatchJsonRpcNotification(emitter, {
      jsonrpc: '2.0',
      method: 'agent',
      params: {
        runId: 'run-2',
        sessionKey: 'agent:main:main',
        stream: 'prompt_cache',
        data: {
          phase: 'break',
          eventId: 'run-2:0',
          previousCacheRead: 8_000,
          cacheRead: 2_000,
          changes: ['model'],
        },
      },
    } as never);

    expect(emitter.emit).toHaveBeenCalledWith('prompt-cache:break', expect.objectContaining({
      eventId: 'run-2:0',
      changes: ['model'],
    }));
    expect(emitter.emit).not.toHaveBeenCalledWith('notification', expect.anything());
  });

  it('drops approval frames without an approval id instead of opening an unanswerable dialog', () => {
    const emitter = createMockEmitter();
    dispatchProtocolEvent(emitter, 'exec.approval.requested', { request: { command: 'node --test' } });
    dispatchProtocolEvent(emitter, 'exec.approval.resolved', { decision: 'deny' });

    expect(emitter.emit).not.toHaveBeenCalledWith('approval:requested', expect.anything());
    expect(emitter.emit).not.toHaveBeenCalledWith('approval:resolved', expect.anything());
  });
});
