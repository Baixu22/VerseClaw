// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hasPotentialConfiguredChannels, listPotentialConfiguredChannelPresenceSignals } from '../../openclaw_runtime/src/channels/config-presence';
import { discoverOpenClawPlugins, type PluginDiscoveryResult } from '../../openclaw_runtime/src/plugins/discovery';

vi.mock('../../openclaw_runtime/src/plugins/discovery', async (original) => ({
  ...await original<typeof import('../../openclaw_runtime/src/plugins/discovery')>(),
  discoverOpenClawPlugins: vi.fn(),
}));

let dir: string;
const discover = vi.mocked(discoverOpenClawPlugins);
function catalog(id: string): PluginDiscoveryResult {
  return { diagnostics: [], candidates: [{ origin: 'bundled', idHint: id, rootDir: dir,
    source: join(dir, 'entry.js'), packageManifest: { channel: { id,
      persistedAuthState: { specifier: './state.cjs', exportName: 'hasState' } } } }] };
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'presence-catalog-'));
  writeFileSync(join(dir, 'state.cjs'), 'exports.hasState = ({env}) => env.FIXTURE_AUTH === "yes";');
  discover.mockReset();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it('shares one discovery across env and stored-auth probes and reads the next catalog on the next call', () => {
  const env = { OPENCLAW_STATE_DIR: dir, FIRST_TOKEN: 'present', FIXTURE_AUTH: 'yes' };
  discover.mockReturnValue(catalog('first'));
  expect(listPotentialConfiguredChannelPresenceSignals({}, env)).toEqual([
    { channelId: 'first', source: 'env' }, { channelId: 'first', source: 'persisted-auth' },
  ]);
  expect(discover).toHaveBeenCalledTimes(1);
  expect(discover).toHaveBeenCalledWith({ env });
  discover.mockReturnValue(catalog('second'));
  expect(hasPotentialConfiguredChannels({}, env)).toBe(true);
  expect(discover).toHaveBeenCalledTimes(2);
  env.FIXTURE_AUTH = 'no';
  expect(hasPotentialConfiguredChannels({}, env)).toBe(false);
});

it('uses supplied discovery or channel ids and skips discovery on an explicit config hit', () => {
  const env = { OPENCLAW_STATE_DIR: dir, FIRST_TOKEN: 'present' };
  expect(listPotentialConfiguredChannelPresenceSignals({}, env, { discovery: catalog('first') })).toEqual([{ channelId: 'first', source: 'env' }]);
  expect(hasPotentialConfiguredChannels({}, env, { channelIds: ['first'] })).toBe(true);
  expect(hasPotentialConfiguredChannels({ channels: { defaults: {}, custom: { enabled: true, account: 'x' } } }, env)).toBe(true);
  expect(discover).not.toHaveBeenCalled();
});
