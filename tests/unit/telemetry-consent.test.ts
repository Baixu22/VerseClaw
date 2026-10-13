// @vitest-environment node
// Agent-driven synthetic consent tests. The real SDK queue uses a no-network sink;
// neither a real machine identifier nor collector traffic is used.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostHog as PostHogClient } from 'posthog-node';

const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  clients: [] as PostHogClient[],
  getSetting: vi.fn(),
  syncProxy: vi.fn(),
  machineId: vi.fn(() => 'synthetic-machine-not-a-user'),
}));

vi.mock('posthog-node', async (importOriginal) => {
  const actual = await importOriginal<typeof import('posthog-node')>();
  return { ...actual, PostHog: class extends actual.PostHog {
    constructor(...args: ConstructorParameters<typeof actual.PostHog>) {
      // Deterministic timing only; use the real capture, queue, disable and flush.
      super(args[0], { ...args[1], flushInterval: 0, flushAt: 1000, disableCompression: true, fetchRetryCount: 0 });
      state.clients.push(this);
    }
  } };
});
vi.mock('electron', () => ({ app: { getVersion: () => 'synthetic-test-version' } }));
vi.mock('node-machine-id', () => ({ machineIdSync: state.machineId }));
vi.mock('@electron/utils/logger', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@electron/utils/store', () => ({
  getSetting: state.getSetting,
  getAllSettings: async () => ({ ...state.settings }),
  setSetting: async (key: string, value: unknown) => { state.settings[key] = value; },
  resetSettings: async () => { state.settings.telemetryEnabled = true; },
}));
vi.mock('@electron/main/menu', () => ({ createMenu: vi.fn() }));
vi.mock('@electron/main/proxy', () => ({ applyProxySettings: vi.fn() }));
vi.mock('@electron/main/launch-at-startup', () => ({ syncLaunchAtStartupSettingFromStore: vi.fn() }));
vi.mock('@electron/utils/openclaw-proxy', () => ({ syncProxyConfigToOpenClaw: state.syncProxy }));

const fetchSink = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => new Response('{}', { status: 200 }));

async function services() {
  const telemetry = await import('@electron/utils/telemetry');
  const { createSettingsApi } = await import('@electron/services/settings-api');
  const api = createSettingsApi({ getStatus: () => ({ state: 'stopped' }), restart: vi.fn() } as never);
  return { telemetry, api };
}

async function waitForQueue(client: PostHogClient, count: number): Promise<void> {
  // Public SDK persistence accessor; the core enum is not re-exported by posthog-node.
  const queueKey = 'queue' as Parameters<PostHogClient['getPersistedProperty']>[0];
  await vi.waitFor(() => expect(client.getPersistedProperty(queueKey)).toHaveLength(count));
}

function sentEvents(): string[] {
  return fetchSink.mock.calls.flatMap(([, options]) => {
    if (typeof options?.body !== 'string') return [];
    const body = JSON.parse(options.body) as { batch?: Array<{ event: string }> };
    return (body.batch ?? []).map((event) => event.event);
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state.clients = [];
  state.settings = {
    telemetryEnabled: true,
    machineId: 'synthetic-existing-machine',
    hasReportedInstall: false,
    proxyEnabled: false,
    language: 'en',
  };
  state.getSetting.mockImplementation(async (key: string) => state.settings[key]);
  state.syncProxy.mockResolvedValue(undefined);
  fetchSink.mockImplementation(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchSink);
  vi.stubEnv('VERSE_CLAW_POSTHOG_API_KEY', 'phc_synthetic_test');
  vi.stubEnv('VERSE_CLAW_POSTHOG_HOST', 'https://telemetry.invalid');
});
afterEach(async () => {
  // Keep the synthetic transport in place through SDK shutdown, including failures.
  await Promise.allSettled(state.clients.map((client) => client.shutdown(500)));
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('runtime telemetry consent (#129)', () => {
  it('calibrates the real SDK: disable alone still flushes an already queued batch', async () => {
    const { PostHog } = await import('posthog-node');
    const sdk = new PostHog('synthetic-public-ingest-id');
    sdk.capture({ distinctId: 'synthetic-id', event: 'SYNTHETIC_NEGATIVE_CONTROL' });
    await waitForQueue(sdk, 1);
    await sdk.disable();
    await sdk.flush();
    expect(sentEvents()).toEqual(['SYNTHETIC_NEGATIVE_CONTROL']);
  });

  it('does not construct a client or read a machine identifier on cold opt-out', async () => {
    state.settings.telemetryEnabled = false;
    const { telemetry } = await services();
    await telemetry.initTelemetry();
    telemetry.captureTelemetryEvent('SYNTHETIC_COLD_DISABLED');
    expect(state.clients).toHaveLength(0);
    expect(state.machineId).not.toHaveBeenCalled();
    expect(state.getSetting).not.toHaveBeenCalledWith('machineId');
    expect(fetchSink).not.toHaveBeenCalled();
  });

  it('applies settings.set opt-out and discards pending events without a network flush', async () => {
    const { telemetry, api } = await services();
    await telemetry.initTelemetry();
    const client = state.clients[0];
    const capture = vi.spyOn(client, 'capture');
    telemetry.captureTelemetryEvent('SYNTHETIC_QUEUED_BEFORE_OPT_OUT');
    await waitForQueue(client, 3);
    capture.mockClear();
    await api.set({ key: 'telemetryEnabled', value: false });
    telemetry.captureTelemetryEvent('SYNTHETIC_AFTER_OPT_OUT');
    await client.flush();
    expect(state.settings.telemetryEnabled).toBe(false);
    expect(capture).not.toHaveBeenCalled();
    expect(fetchSink).not.toHaveBeenCalled();
  });

  it('revokes consent in settings.setMany before waiting for unrelated side effects', async () => {
    const { telemetry, api } = await services();
    await telemetry.initTelemetry();
    await waitForQueue(state.clients[0], 2);
    let release!: () => void;
    state.syncProxy.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const update = api.setMany({ patch: { telemetryEnabled: false, proxyEnabled: true } });
    await vi.waitFor(() => expect(state.syncProxy).toHaveBeenCalled());
    try {
      telemetry.captureTelemetryEvent('SYNTHETIC_DURING_PROXY_UPDATE');
      await state.clients[0].flush();
      expect(fetchSink).not.toHaveBeenCalled();
    } finally { release(); await update; }
  });

  it('re-enables with one new lifetime and never revives the revoked queue', async () => {
    const { telemetry, api } = await services();
    await telemetry.initTelemetry();
    const oldClient = state.clients[0];
    telemetry.captureTelemetryEvent('SYNTHETIC_OLD_QUEUE');
    await waitForQueue(oldClient, 3);
    await api.set({ key: 'telemetryEnabled', value: false });
    await api.set({ key: 'telemetryEnabled', value: false });
    await api.set({ key: 'telemetryEnabled', value: true });
    await api.setMany({ patch: { telemetryEnabled: true } });
    expect(state.clients).toHaveLength(2);
    telemetry.captureTelemetryEvent('SYNTHETIC_AFTER_REENABLE');
    await oldClient.flush();
    await waitForQueue(state.clients[1], 1);
    await state.clients[1].flush();
    expect(sentEvents()).toEqual(['SYNTHETIC_AFTER_REENABLE']);
  });

  it('initializes idempotently and reports installation/opening only once', async () => {
    const { telemetry, api } = await services();
    await Promise.all([telemetry.initTelemetry(), telemetry.initTelemetry()]);
    await api.set({ key: 'telemetryEnabled', value: true });
    expect(state.clients).toHaveLength(1);
    await waitForQueue(state.clients[0], 2);
    await state.clients[0].flush();
    expect(sentEvents()).toEqual(['app_installed', 'app_opened']);
    await api.set({ key: 'telemetryEnabled', value: false });
    await api.set({ key: 'telemetryEnabled', value: true });
    await state.clients[1].flush();
    expect(sentEvents()).toEqual(['app_installed', 'app_opened']);
  });

  it('does not finish stale initialization after an opt-out', async () => {
    state.settings.machineId = '';
    let release!: (value: string) => void;
    state.getSetting.mockImplementation(async (key: string) => key === 'machineId'
      ? await new Promise<string>((resolve) => { release = resolve; }) : state.settings[key]);
    const { telemetry, api } = await services();
    const initialization = telemetry.initTelemetry();
    await vi.waitFor(() => expect(state.getSetting).toHaveBeenCalledWith('machineId'));
    await api.set({ key: 'telemetryEnabled', value: false });
    release('synthetic-delayed-machine');
    await initialization;
    for (const client of state.clients) await client.flush();
    expect(state.machineId).not.toHaveBeenCalled();
    expect(fetchSink).not.toHaveBeenCalled();
    expect(state.settings.hasReportedInstall).toBe(false);
  });

  it('applies the existing default when settings are reset after opt-out', async () => {
    state.settings.telemetryEnabled = false;
    const { telemetry, api } = await services();
    await telemetry.initTelemetry();
    await api.reset();
    expect(state.settings.telemetryEnabled).toBe(true);
    expect(state.clients).toHaveLength(1);
    await waitForQueue(state.clients[0], 2);
    await state.clients[0].flush();
    expect(sentEvents()).toEqual(['app_installed', 'app_opened']);
  });

  it('aborts in-flight transport on opt-out without issuing another request', async () => {
    const { telemetry, api } = await services();
    await telemetry.initTelemetry();
    await waitForQueue(state.clients[0], 2);
    let requestSignal: AbortSignal | null | undefined;
    let finishRequest: (() => void) | undefined;
    fetchSink.mockImplementation((_url, options) => {
      requestSignal = options?.signal;
      return new Promise<Response>((resolve, reject) => {
        finishRequest = () => resolve(new Response('{}', { status: 200 }));
        requestSignal?.addEventListener('abort', () => reject(new DOMException('Synthetic abort', 'AbortError')), { once: true });
      });
    });
    const flushing = state.clients[0].flush().catch(() => undefined);
    await vi.waitFor(() => expect(fetchSink).toHaveBeenCalledTimes(1));
    try {
      await api.set({ key: 'telemetryEnabled', value: false });
      expect(requestSignal?.aborted).toBe(true);
      expect(fetchSink).toHaveBeenCalledTimes(1);
    } finally { finishRequest?.(); await flushing; }
  });
});
