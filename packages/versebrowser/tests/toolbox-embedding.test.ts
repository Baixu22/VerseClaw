import { expect, it, vi } from 'vitest';
import { mkdtemp, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { createStandaloneFacade } from '../src/engine/standalone.ts';
import { setWorkspaceRoot } from '../src/host/workspace-paths.ts';
import { saveSessionRecord, loadSessionRecord, removeSession, type PersistentSessionRecord } from '../src/engine/persistent-sessions.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';

it('keeps two embedded workspaces isolated after the global workspace changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vb-embed-'));
  const aRoot = join(root, 'a'), bRoot = join(root, 'b');
  const a = (await createStandaloneFacade({ preferPlaywright: true, workspaceRoot: aRoot })).facade;
  const b = (await createStandaloneFacade({ preferPlaywright: true, workspaceRoot: bRoot })).facade;
  setWorkspaceRoot(join(root, 'unrelated'));
  try {
    const openedA = await a.open({ mode: 'headless', url: 'data:text/html,<body><p id="name">Alpha</p></body>' });
    const openedB = await b.open({ mode: 'headless', url: 'data:text/html,<body><p id="name">Beta</p></body>' });
    const aId = (openedA.data as { session: { id: string } }).session.id;
    const bId = (openedB.data as { session: { id: string } }).session.id;
    expect((await b.extractPageText({ sessionId: aId })).ok).toBe(false);
    const result = await a.verifyFlow({ sessionId: aId, screenshot: false, expect: [{ type: 'text', selector: '#name', equals: 'Alpha' }] });
    const path = result.evidence!.find(e => e.kind === 'verify')!.path!;
    expect(path.startsWith('.ae/')).toBe(true);
    await access(resolve(aRoot, path));
    await expect(access(resolve(bRoot, path))).rejects.toThrow();
    const waiting = a.wait({ sessionId: aId, selector: '#never', timeoutMs: 5000 });
    expect((await a.dispose()).ok).toBe(true);
    expect((await waiting).ok).toBe(false);
    expect((await b.extractPageText({ sessionId: bId })).content).toContain('Beta');
    expect((await a.open()).error?.code).toBe('E_DISPOSED');
  } finally {
    await a.dispose(); await b.dispose(); setWorkspaceRoot(undefined);
  }
});

it('pins persistent records to their explicit workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vb-record-root-'));
  const a = join(root, 'a'), b = join(root, 'b');
  const record: PersistentSessionRecord = { schemaVersion: 1, id: 'same-id', pid: 0, endpoint: 'http://127.0.0.1:1', port: 1, mode: 'headless', createdAt: new Date().toISOString(), profileDir: join(a, '.ae/sessions/same-id/profile') };
  await saveSessionRecord(record, a);
  setWorkspaceRoot(b);
  try {
    expect(await loadSessionRecord('same-id', a)).toMatchObject({ id: 'same-id' });
    expect(await loadSessionRecord('same-id', b)).toBeNull();
    await removeSession('same-id', b);
    expect(await loadSessionRecord('same-id', a)).not.toBeNull();
    await removeSession('same-id', a);
  } finally { setWorkspaceRoot(undefined); }
});

it('disposal drains an in-flight open and retains failed cleanup for retry', async () => {
  let release!: (result: unknown) => void;
  const close = vi.fn().mockResolvedValueOnce({ success: false, error: 'busy' }).mockResolvedValue({ success: true });
  const api = { open: () => new Promise(done => { release = done; }), close } as unknown as AgentBrowserHostApi;
  const facade = new AgentBrowserFacade({ api });
  const opening = facade.open();
  const disposal = facade.dispose();
  expect(facade.dispose()).toBe(disposal);
  release({ success: true, session: { id: 'owned' } });
  await opening;
  expect((await disposal).error?.code).toBe('E_DISPOSE');
  expect((await facade.dispose()).ok).toBe(true);
  expect(close).toHaveBeenCalledTimes(2);
});

it('does not report disposal success while a failed open left a recovery session', async () => {
  const close = vi.fn().mockResolvedValueOnce({ success: false, error: 'still busy' }).mockResolvedValue({ success: true });
  const api = { open: async () => { throw Object.assign(new Error('startup cleanup unconfirmed'), { recoverySessionId: 'recovery' }); }, close } as unknown as AgentBrowserHostApi;
  const facade = new AgentBrowserFacade({ api });
  const opened = await facade.open();
  expect(opened.error?.details).toMatchObject({ recoverySessionId: 'recovery' });
  expect((await facade.dispose()).ok).toBe(false);
  expect((await facade.dispose()).ok).toBe(true);
  expect(close).toHaveBeenCalledWith({ sessionId: 'recovery' });
});
