import { beforeEach, afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { setWorkspaceRoot } from '../src/host/workspace-paths.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { loadSessionRecord, loadWindow, saveSessionRecord, saveWindow, removeSession, sessionDir, sessionsRoot, listSessionRecords } from '../src/engine/persistent-sessions.ts';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'vb-session-jail-')); setWorkspaceRoot(root); });
afterEach(async () => { setWorkspaceRoot(undefined); await rm(root, { recursive: true, force: true }); });

it.each(['', '.', '..', '../outside', '..\\outside', 'a/b', 'a\\b', 'C:\\temp', 's:stream', 's.', ' s', 's ', 'con', 'COM1', 's'.repeat(65)])('rejects a malformed persistent session id: %j', id => {
  expect(() => sessionDir(id)).toThrow();
});

it.each(['read', 'write', 'remove'] as const)('does not %s outside the sessions directory through a traversal id', async operation => {
  const outside = join(root, 'outside');
  const id = '../../outside';
  // Even the old vulnerable implementation is confined to this test's own temp workspace.
  expect(join(sessionsRoot(), id)).toBe(outside);
  expect(relative(root, outside)).toBe('outside');
  await mkdir(outside);
  const original = JSON.stringify({ schemaVersion: 1, id, marker: 'outside' });
  await writeFile(join(outside, 'session.json'), original);
  await writeFile(join(outside, 'window.json'), JSON.stringify({ schemaVersion: 1, marker: 'outside' }));
  if (operation === 'read') {
    expect(await loadSessionRecord(id)).toBeNull();
    expect(await loadWindow(id)).toBeNull();
  } else if (operation === 'write') {
    await expect(saveSessionRecord({ schemaVersion: 1, id, pid: 0, endpoint: '', port: 0, mode: 'headless', createdAt: '', profileDir: '' })).rejects.toThrow();
    await expect(saveWindow(id, { schemaVersion: 1, at: '', requests: [], consoleLines: [] })).rejects.toThrow();
  } else {
    await expect(removeSession(id)).rejects.toThrow();
  }
  expect(await readFile(join(outside, 'session.json'), 'utf8')).toBe(original);
});

it('does not load or list a record whose id differs from its directory', async () => {
  const dir = sessionDir('s-real');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'session.json'), JSON.stringify({ schemaVersion: 1, id: 's-other' }));
  expect(await loadSessionRecord('s-real')).toBeNull();
  expect(await listSessionRecords()).toEqual([]);
});

it('close refuses a traversal id without touching an outside record', async () => {
  const outside = join(root, 'outside');
  await mkdir(outside);
  const original = JSON.stringify({ schemaVersion: 1, id: '../../outside', external: true });
  await writeFile(join(outside, 'session.json'), original);
  const facade = new AgentBrowserFacade({ api: await createPlaywrightHostApi({ persistent: true }) });
  const result = await facade.close('../../outside');
  expect(result.ok).toBe(false);
  expect(result.error?.code).toBe('E_NO_SESSION');
  expect(await readFile(join(outside, 'session.json'), 'utf8')).toBe(original);
});

it('rejects a session directory junction without reading, writing or deleting its outside target', async () => {
  const outside = join(root, 'outside');
  await mkdir(outside);
  await mkdir(sessionsRoot(), { recursive: true });
  const sentinel = JSON.stringify({ schemaVersion: 1, id: 'linked', marker: 'outside' });
  await writeFile(join(outside, 'session.json'), sentinel);
  await symlink(outside, join(sessionsRoot(), 'linked'), 'junction');
  expect(await loadSessionRecord('linked')).toBeNull();
  await expect(saveWindow('linked', { schemaVersion: 1, at: '', requests: [], consoleLines: [] })).rejects.toThrow();
  await expect(removeSession('linked')).rejects.toThrow();
  expect(await readFile(join(outside, 'session.json'), 'utf8')).toBe(sentinel);
});
