/**
 * TF-0097：跨进程会话的“账本”部分（纯 fs，无浏览器）。
 *
 * 会话记录落在 <workspace>/.ae/sessions/<id>/：记录本身 + 当前页观察窗口。
 * 这里只测纯逻辑：读写、列举、探活、清理；浏览器生命周期在 live 用例里测。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listSessionRecords,
  loadSessionRecord,
  loadWindow,
  probeEndpoint,
  closeBrowserThroughCdp,
  waitForEndpointDown,
  allocatePort,
  removeSession,
  saveSessionRecord,
  saveWindow,
  sessionDir,
  sessionsRoot,
  sweepDeadSessions,
  type PersistentSessionRecord,
} from '../src/engine/persistent-sessions.ts';
import { setWorkspaceRoot } from '../src/host/workspace-paths.ts';

function record(id: string, endpoint: string): PersistentSessionRecord {
  return {
    schemaVersion: 1,
    id,
    pid: 12345,
    endpoint,
    port: Number(new URL(endpoint).port),
    mode: 'headless',
    createdAt: '2026-09-30T00:00:00.000Z',
    profileDir: join(sessionDir(id), 'profile'),
  };
}

describe('persistent session store (TF-0097)', () => {
  let root: string;
  let server: Server | undefined;
  let liveEndpoint = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vb-sessions-'));
    setWorkspaceRoot(root);
  });

  afterEach(async () => {
    setWorkspaceRoot(undefined);
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
    await rm(root, { recursive: true, force: true });
  });

  async function startFakeCdp(): Promise<string> {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"Browser":"fake"}');
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    liveEndpoint = `http://127.0.0.1:${port}`;
    return liveEndpoint;
  }

  it('记录与窗口写在工作区的 .ae/sessions 下，并能读回', async () => {
    const endpoint = await startFakeCdp();
    await saveSessionRecord({ ...record('s-one', endpoint), targetId: 'page-target-1' });
    await saveWindow('s-one', {
      schemaVersion: 1,
      at: '2026-09-30T00:00:01.000Z',
      url: 'https://example.test/current',
      requests: [{ id: 'n-1', url: 'https://example.test/api', method: 'GET', status: 404, failed: true }],
      consoleLines: [{ type: 'error', text: '[error] boom' }],
    });

    expect(sessionsRoot()).toBe(join(root, '.ae', 'sessions'));
    expect(existsSync(sessionDir('s-one'))).toBe(true);

    const loaded = await loadSessionRecord('s-one');
    expect(loaded?.endpoint).toBe(endpoint);
    expect(loaded?.targetId).toBe('page-target-1');
    const window = await loadWindow('s-one');
    expect(window?.requests[0]?.status).toBe(404);
    expect(window?.consoleLines[0]?.text).toContain('boom');
  });

  it('列举按创建时间排序，缺失/损坏记录被忽略', async () => {
    const endpoint = await startFakeCdp();
    await saveSessionRecord({ ...record('s-late', endpoint), createdAt: '2026-09-30T02:00:00.000Z' });
    await saveSessionRecord({ ...record('s-early', endpoint), createdAt: '2026-09-30T01:00:00.000Z' });

    const records = await listSessionRecords();
    expect(records.map((item) => item.id)).toEqual(['s-early', 's-late']);
  });

  it('探活看 CDP endpoint（pid 可能是已交接的启动器）', async () => {
    const endpoint = await startFakeCdp();
    expect(await probeEndpoint(endpoint)).toBe(true);
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    expect(await probeEndpoint(endpoint, 500)).toBe(false);
  });

  it('清理只删掉不再应答的会话，活会话保留', async () => {
    const endpoint = await startFakeCdp();
    await saveSessionRecord(record('s-live', endpoint));
    await saveSessionRecord(record('s-dead', `http://127.0.0.1:${await allocatePort()}`));

    const removed = await sweepDeadSessions();
    expect(removed).toEqual(['s-dead']);
    expect(existsSync(sessionDir('s-dead'))).toBe(false);
    expect(existsSync(sessionDir('s-live'))).toBe(true);
    expect((await listSessionRecords()).map((item) => item.id)).toEqual(['s-live']);
  });

  it('an HTTP failure is not proof of browser exit; close and sweep retain the record', async () => {
    server = createServer((_req, res) => { res.writeHead(503); res.end('busy'); });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    await saveSessionRecord(record('s-busy', endpoint));
    expect(await closeBrowserThroughCdp(endpoint)).toBe(false);
    expect(await waitForEndpointDown(endpoint, 100)).toBe(false);
    expect(await sweepDeadSessions()).toEqual([]);
    expect(await loadSessionRecord('s-busy')).not.toBeNull();
  });

  it('removeSession 连 profile 目录一起删掉', async () => {
    const endpoint = await startFakeCdp();
    await saveSessionRecord(record('s-gone', endpoint));
    await removeSession('s-gone');
    expect(existsSync(sessionDir('s-gone'))).toBe(false);
  });

  it.each([
    { createdAt: null }, { pid: -1 }, { endpoint: {} }, { mode: 'invalid' },
    { profileDir: [] }, { external: 'false' }, { targetId: null }, { targetId: 3 }, { targetId: '' }, { targetId: ' '.repeat(3) }, { targetId: 'x'.repeat(257) },
  ])('ignores malformed record fields without breaking session listing: %j', async fields => {
    const endpoint = await startFakeCdp();
    await saveSessionRecord(record('s-valid', endpoint));
    await saveSessionRecord(record('s-invalid', endpoint));
    await writeFile(join(sessionDir('s-invalid'), 'session.json'), JSON.stringify({ ...record('s-invalid', endpoint), ...fields }));
    expect(await loadSessionRecord('s-invalid')).toBeNull();
    expect((await listSessionRecords()).map(item => item.id)).toEqual(['s-valid']);
    expect(existsSync(sessionDir('s-invalid'))).toBe(true);
  });

  it.each([{ requests: {} }, { consoleLines: null }, { requests: [{ id: 3 }] }])(
    'ignores malformed observation windows instead of crashing reattachment: %j', async fields => {
      await saveWindow('s-window', { schemaVersion: 1, at: '2026-10-03T00:00:00Z', requests: [], consoleLines: [] });
      await writeFile(join(sessionDir('s-window'), 'window.json'), JSON.stringify({ schemaVersion: 1, at: '2026-10-03T00:00:00Z', requests: [], consoleLines: [], ...fields }));
      expect(await loadWindow('s-window')).toBeNull();
    },
  );
});

/**
 * TF-0167: profile-backed session state is isolated per workspace.
 *
 * listSessionRecords/sweepDeadSessions used to read sessionsRoot() with no argument, so they
 * always resolved the process default workspace: listing one workspace could report another
 * workspace's profile-backed sessions, and --clean could delete their directories. This is
 * pure fs (no browser), so it stays runnable while the machine is busy.
 */
describe('workspace isolation for persistent sessions (TF-0167)', () => {
  let alpha!: string;
  let beta!: string;

  beforeEach(async () => {
    alpha = await mkdtemp(join(tmpdir(), 'vb-ws-alpha-'));
    beta = await mkdtemp(join(tmpdir(), 'vb-ws-beta-'));
  });

  afterEach(async () => {
    await rm(alpha, { recursive: true, force: true });
    await rm(beta, { recursive: true, force: true });
  });

  // loadSessionRecord validates schemaVersion and the numeric fields, so a real record
  // shape is required; a partial object is silently treated as absent.
  const record = (id: string, workspaceRoot: string) => ({
    schemaVersion: 1 as const,
    id,
    endpoint: 'http://127.0.0.1:1/devtools/browser/never-there',
    pid: 0,
    port: 1,
    mode: 'headless' as const,
    createdAt: '2026-10-10T00:00:00.000Z',
    profileDir: join(workspaceRoot, '.ae', 'profiles', id),
  });

  it('lists only the requested workspace and never the process default', async () => {
    await saveSessionRecord(record('alpha-only', alpha), alpha);
    await saveSessionRecord(record('beta-only', beta), beta);

    const inAlpha = await listSessionRecords(alpha);
    const inBeta = await listSessionRecords(beta);
    expect(inAlpha.map((entry) => entry.id)).toEqual(['alpha-only']);
    expect(inBeta.map((entry) => entry.id)).toEqual(['beta-only']);

    // the default workspace listing must not pick either of them up
    const empty = await mkdtemp(join(tmpdir(), 'vb-ws-empty-'));
    try {
      expect(await listSessionRecords(empty)).toEqual([]);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('removes a session only from the workspace that owns it', async () => {
    await saveSessionRecord(record('shared-id', alpha), alpha);
    await saveSessionRecord(record('shared-id', beta), beta);

    await removeSession('shared-id', alpha);

    expect(await loadSessionRecord('shared-id', alpha)).toBeNull();
    // the same id in the other workspace must survive untouched
    expect(await loadSessionRecord('shared-id', beta)).not.toBeNull();
  });
});
