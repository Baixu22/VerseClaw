import { describe, expect, it, vi } from 'vitest';
import { createHostInvokeDispatcher, HostApiRegistry } from '../../electron/main/ipc/host-invoke';

describe('host invoke dispatcher', () => {
  it('dispatches a typed request to the matching service action', async () => {
    const payload = { scope: 'all' };
    const services = {
      settings: {
        getAll: vi.fn(async (receivedPayload: unknown) => ({ theme: 'dark', receivedPayload })),
      },
    };
    const dispatch = createHostInvokeDispatcher(services);

    await expect(dispatch({
      id: 'req-1',
      module: 'settings',
      action: 'getAll',
      payload,
    })).resolves.toEqual({
      id: 'req-1',
      ok: true,
      data: { theme: 'dark', receivedPayload: payload },
    });

    expect(services.settings.getAll).toHaveBeenCalledWith(payload);
  });

  it('returns a validation error for malformed requests', async () => {
    const dispatch = createHostInvokeDispatcher({});

    await expect(dispatch({ id: 'bad', module: '', action: 'getAll' })).resolves.toMatchObject({
      id: 'bad',
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });

  it('returns unsupported for unknown module/action pairs', async () => {
    const dispatch = createHostInvokeDispatcher({ settings: {} });

    await expect(dispatch({
      id: 'req-2',
      module: 'settings',
      action: 'missing',
    })).resolves.toMatchObject({
      id: 'req-2',
      ok: false,
      error: { code: 'UNSUPPORTED' },
    });
  });

  it('returns unsupported for inherited module and action names', async () => {
    const inheritedAction = vi.fn();
    const inheritedModule = vi.fn();
    const settings = Object.create({ toString: inheritedAction });
    const services = Object.create({
      inherited: { getAll: inheritedModule },
    });
    services.settings = settings;
    const dispatch = createHostInvokeDispatcher(services);

    await expect(dispatch({
      id: 'req-3',
      module: 'settings',
      action: 'toString',
    })).resolves.toMatchObject({
      id: 'req-3',
      ok: false,
      error: { code: 'UNSUPPORTED' },
    });

    await expect(dispatch({
      id: 'req-4',
      module: 'inherited',
      action: 'getAll',
    })).resolves.toMatchObject({
      id: 'req-4',
      ok: false,
      error: { code: 'UNSUPPORTED' },
    });

    expect(inheritedAction).not.toHaveBeenCalled();
    expect(inheritedModule).not.toHaveBeenCalled();
  });

  it('returns internal when a service action throws', async () => {
    const dispatch = createHostInvokeDispatcher({
      settings: {
        getAll: vi.fn(() => {
          throw new Error('settings unavailable');
        }),
      },
    });

    await expect(dispatch({
      id: 'req-5',
      module: 'settings',
      action: 'getAll',
    })).resolves.toEqual({
      id: 'req-5',
      ok: false,
      error: { code: 'INTERNAL', message: 'settings unavailable' },
    });
  });

  it('dispatches extension-contributed actions registered after dispatcher creation', async () => {
    const registry = new HostApiRegistry();
    const dispatch = createHostInvokeDispatcher(registry);
    const gatewaySnapshot = vi.fn(() => ({ capturedAt: 123 }));

    const unregister = registry.registerExtensionContributions('builtin/diagnostics', [{
      module: 'diagnostics',
      actions: { gatewaySnapshot },
    }]);

    await expect(dispatch({
      id: 'req-6',
      module: 'diagnostics',
      action: 'gatewaySnapshot',
    })).resolves.toEqual({
      id: 'req-6',
      ok: true,
      data: { capturedAt: 123 },
    });
    expect(gatewaySnapshot).toHaveBeenCalledWith(undefined);

    unregister();

    await expect(dispatch({
      id: 'req-7',
      module: 'diagnostics',
      action: 'gatewaySnapshot',
    })).resolves.toMatchObject({
      id: 'req-7',
      ok: false,
      error: { code: 'UNSUPPORTED' },
    });
  });

  it('prevents extension actions from overriding existing host actions', () => {
    const registry = new HostApiRegistry();
    registry.registerCoreServices({
      settings: {
        getAll: vi.fn(() => ({ theme: 'dark' })),
      },
    });

    expect(() => registry.registerExtensionContributions('extension/conflict', [{
      module: 'settings',
      actions: { getAll: vi.fn() },
    }])).toThrow('Host API action already registered: settings.getAll');
  });
});


describe('host invoke security (P1-002)', () => {
  it('rejects unauthorized senders when senderAuth is configured', async () => {
    const dispatch = createHostInvokeDispatcher({
      settings: { getAll: vi.fn(async () => ({ theme: 'dark' })) },
    }, {
      senderAuth: { allowedWebContentsIds: new Set([42]) },
    });

    await expect(dispatch({
      id: 'sec-1',
      module: 'settings',
      action: 'getAll',
    }, { sender: { id: 99 } })).resolves.toMatchObject({
      id: 'sec-1',
      ok: false,
      error: { code: 'VALIDATION', message: 'Host request sender is not authorized' },
    });

    await expect(dispatch({
      id: 'sec-2',
      module: 'settings',
      action: 'getAll',
    }, { sender: { id: 42 } })).resolves.toMatchObject({
      id: 'sec-2',
      ok: true,
    });
  });

  it('rejects payloads that exceed size limits', async () => {
    const dispatch = createHostInvokeDispatcher({
      settings: { getAll: vi.fn(async () => ({})) },
    });
    const huge = 'x'.repeat(1_100_000);

    await expect(dispatch({
      id: 'sec-3',
      module: 'settings',
      action: 'getAll',
      payload: { blob: huge },
    })).resolves.toMatchObject({
      id: 'sec-3',
      ok: false,
      error: { code: 'VALIDATION', message: 'Host request payload exceeds size limit' },
    });
  });

  it('rejects prototype-polluting payload keys', async () => {
    const dispatch = createHostInvokeDispatcher({
      settings: { getAll: vi.fn(async () => ({})) },
    });
    const payload = JSON.parse('{"__proto__":{"polluted":true},"ok":1}');

    await expect(dispatch({
      id: 'sec-4',
      module: 'settings',
      action: 'getAll',
      payload,
    })).resolves.toMatchObject({
      id: 'sec-4',
      ok: false,
      error: { code: 'VALIDATION', message: 'Host request payload contains dangerous keys' },
    });
  });

  it('sanitizes internal errors so renderer does not see stack/path/secret', async () => {
    const dispatch = createHostInvokeDispatcher({
      settings: {
        getAll: vi.fn(() => {
          throw new Error('Failed at C:\\Users\\alice\\secret-project\\file.ts\n    at Object.handler (C:\\Users\\alice\\app\\main.js:10:5)\napiKey=sk-live-secret-value');
        }),
      },
    });

    const result = await dispatch({
      id: 'sec-5',
      module: 'settings',
      action: 'getAll',
    });

    expect(result).toMatchObject({ id: 'sec-5', ok: false, error: { code: 'INTERNAL' } });
    const message = (result as { error: { message: string } }).error.message;
    expect(message).not.toMatch(/Users\\alice/);
    expect(message).not.toMatch(/sk-live-secret-value/);
    expect(message).not.toMatch(/\bat\s+Object\.handler\b/);
    expect(message).toMatch(/redacted/i);
  });

  it('rejects unauthorized sender session URL prefixes when configured', async () => {
    const dispatch = createHostInvokeDispatcher({
      settings: { getAll: vi.fn(async () => ({ theme: 'dark' })) },
    }, {
      senderAuth: {
        allowedWebContentsIds: new Set([7]),
        allowedUrlPrefixes: ['app://verse-claw/'],
      },
    });

    await expect(dispatch({
      id: 'sec-6',
      module: 'settings',
      action: 'getAll',
    }, {
      sender: { id: 7, getURL: () => 'https://evil.example/' },
      senderFrame: { url: 'https://evil.example/' },
    })).resolves.toMatchObject({
      id: 'sec-6',
      ok: false,
      error: { code: 'VALIDATION', message: 'Host request sender session is not authorized' },
    });

    await expect(dispatch({
      id: 'sec-7',
      module: 'settings',
      action: 'getAll',
    }, {
      sender: { id: 7, getURL: () => 'app://verse-claw/index.html' },
      senderFrame: { url: 'app://verse-claw/index.html' },
    })).resolves.toMatchObject({
      id: 'sec-7',
      ok: true,
    });
  });
});
