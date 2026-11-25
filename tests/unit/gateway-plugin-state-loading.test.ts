// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createPluginRegistry } from '../../openclaw_runtime/src/plugins/registry';
import { createPluginRecord } from '../../openclaw_runtime/src/plugins/loader-records';
import type { PluginRuntime } from '../../openclaw_runtime/src/plugins/runtime/types';

it('opens trusted plugin stores without materializing other runtime services', async () => {
  const getRuntimeProperty = vi.fn(() => { throw new Error('heavy runtime loaded'); });
  const runtime = new Proxy({} as PluginRuntime, { get: getRuntimeProperty });
  const { createApi } = createPluginRegistry({ runtime, logger: { info() {}, warn() {}, error() {}, debug() {} } });
  const record = createPluginRecord({ id: 'fixture', name: 'fixture', source: 'fixture.js', origin: 'bundled', enabled: true, configSchema: true });
  const api = createApi(record, { config: {} });
  const store = api.runtime.state.openKeyedStore({ namespace: 'fixture', maxEntries: 1 });
  expect(store.entries).toBeTypeOf('function');
  expect(getRuntimeProperty).not.toHaveBeenCalled();
  expect(() => api.runtime.state.resolveStateDir()).toThrow('heavy runtime loaded');

  const untrusted = createApi({ ...record, id: 'untrusted', origin: 'global' }, { config: {} });
  expect(() => untrusted.runtime.state.openKeyedStore({ namespace: 'fixture', maxEntries: 1 }))
    .toThrow('only available for trusted plugins');
});
