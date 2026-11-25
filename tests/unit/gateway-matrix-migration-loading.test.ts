// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => ({ sync: 0, idb: 0 }));
vi.mock('../../openclaw_runtime/extensions/matrix/src/matrix/client/file-sync-store.js', async original => {
  loaded.sync++;
  return original();
});
vi.mock('../../openclaw_runtime/extensions/matrix/src/matrix/sdk/idb-persistence.js', async original => {
  loaded.idb++;
  return original();
});
import { stateMigrations } from '../../openclaw_runtime/extensions/matrix/doctor-contract-api';

const root = mkdtempSync(join(tmpdir(), 'matrix-migrations-'));
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('loads Matrix persistence only for discovered legacy files and preserves detection', async () => {
  const params = {
    config: {}, env: {}, stateDir: root, oauthDir: join(root, 'credentials'),
    context: { openPluginStateKeyedStore: vi.fn() },
  };
  for (const migration of stateMigrations) expect(await migration.detectLegacyState(params)).toBeNull();
  expect(loaded).toEqual({ sync: 0, idb: 0 });
  const legacy = join(root, 'matrix/account');
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, 'bot-storage.json'), JSON.stringify({
    version: 1, savedSync: { nextBatch: 'batch', accountData: [], roomsData: {} },
  }));
  writeFileSync(join(legacy, 'crypto-idb-snapshot.json'), JSON.stringify([
    { name: 'crypto', version: 1, stores: [] },
  ]));
  const sync = stateMigrations.find(m => m.id === 'matrix-sync-cache-json-to-plugin-state')!;
  const idb = stateMigrations.find(m => m.id === 'matrix-idb-snapshot-json-to-plugin-state')!;
  expect(await sync.detectLegacyState(params)).toEqual({ preview: [`Matrix sync cache JSON can migrate to SQLite: ${legacy}`] });
  expect(await idb.detectLegacyState(params)).toEqual({ preview: [`Matrix IndexedDB snapshot JSON can migrate to SQLite: ${legacy}`] });
  expect(loaded).toEqual({ sync: 1, idb: 1 });
  expect(params.context.openPluginStateKeyedStore).not.toHaveBeenCalled();
});
