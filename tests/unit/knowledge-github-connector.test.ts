import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKnowledgeGithubConnector, validateGithubConnector, type GithubSourceChange } from '@electron/services/knowledge-github-connector';
import { proxyAwareFetch } from '@electron/utils/proxy-fetch';
import type { KnowledgeGithubConnectorConfig } from '@shared/host-api/contract';

vi.mock('@electron/utils/proxy-fetch', () => ({ proxyAwareFetch: vi.fn() }));
const config: KnowledgeGithubConnectorConfig = { id: 'public-docs', kind: 'github-public-directory', owner: 'agent-fixture', repo: 'handbook', path: 'docs', ref: 'main', enabled: true, intervalSeconds: 60 };
let root: string;
const running: Array<ReturnType<typeof createKnowledgeGithubConnector>> = [];
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'knowledge-github-')); });
afterEach(async () => { for (const sync of running.splice(0)) { sync.stop(); await sync.settled(); } vi.useRealTimers(); vi.resetAllMocks(); await rm(root, { recursive: true, force: true }); });
function setup() {
  const files = new Map([['docs/a.md', 'Version one.']]);
  let status = 200, privateRepo = false;
  const sha = (body: string) => createHash('sha1').update(`blob ${Buffer.byteLength(body)}\0`).update(body).digest('hex');
  const fetch = vi.mocked(proxyAwareFetch).mockImplementation(async url => {
    const path = new URL(String(url)).pathname;
    if (status !== 200) return new Response('', { status, headers: { 'retry-after': '1' } });
    if (path.endsWith('/handbook')) return Response.json({ private: privateRepo });
    if (path.includes('/contents/')) return Response.json([...files].map(([path, body]) => ({ type: 'file', path, sha: sha(body), size: Buffer.byteLength(body) })));
    const hash = path.split('/').at(-1);
    const body = [...files.values()].find(value => sha(value) === hash);
    if (body === undefined) return new Response('', { status: 404 });
    return Response.json({ sha: hash, encoding: 'base64', content: Buffer.from(body).toString('base64') });
  });
  return { files, fetch, status: (value: number) => { status = value; }, private: () => { privateRepo = true; } };
}
function sync(capture: (change: GithubSourceChange) => Promise<void>) {
  const instance = createKnowledgeGithubConnector({ config, cursorPath: join(root, 'cursor.json'), receiptPath: join(root, 'receipt.json'), capture, onError: vi.fn() });
  running.push(instance); return instance;
}
describe('public GitHub continuous connector', () => {
  it('keeps repeated edit cycles and restoration as distinct governed transitions', async () => {
    const remote = setup(), changes: GithubSourceChange[] = [];
    const connector = sync(async change => { changes.push(change); });
    for (const body of ['A', 'B', 'A', 'B']) { remote.files.set('docs/a.md', body); await connector.sync(); }
    remote.files.clear(); await connector.sync(); remote.files.set('docs/a.md', 'A'); await connector.sync();
    expect(changes).toHaveLength(6);
    expect(new Set(changes.map(change => change.captureKey)).size).toBe(6);
    expect(new Set(changes.map(change => change.sourceId)).size).toBe(1);
    expect(JSON.parse(await readFile(join(root, 'cursor.json'), 'utf8')).sequence).toBe(6);
  });
  it('keeps stable identity through update, deletion, missed restart events and durable receipts', async () => {
    const remote = setup(), changes: GithubSourceChange[] = [];
    const first = sync(async change => { changes.push(change); });
    expect(await first.sync()).toMatchObject({ status: 'ok', created: 1, driven_by: 'agent' });
    expect(await first.sync()).toMatchObject({ unchanged: 1, created: 0 });
    expect(remote.fetch.mock.calls.filter(([url]) => String(url).includes('/git/blobs/'))).toHaveLength(1);
    remote.files.set('docs/a.md', 'Version two.');
    expect(await first.sync()).toMatchObject({ updated: 1 });
    expect(changes[0].sourceId).toBe(changes[1].sourceId);
    expect(changes[1].previousDigest).toBe(changes[0].digest);
    first.stop(); await first.settled();
    remote.files.delete('docs/a.md'); remote.files.set('docs/b.md', 'Created while stopped.');
    const restarted = sync(async change => { changes.push(change); });
    expect(await restarted.sync()).toMatchObject({ created: 1, withdrawn: 1 });
    expect(changes.find(change => change.kind === 'withdrawn')?.sourceId).toBe(changes[0].sourceId);
    expect(JSON.parse(await readFile(join(root, 'receipt.json'), 'utf8'))).toMatchObject({ status: 'ok', actor: 'knowledge-github-connector', lastSuccessAt: expect.any(String) });
    expect(JSON.parse(await readFile(join(root, 'cursor.json'), 'utf8')).files).not.toHaveProperty('docs/a.md');
    expect(remote.fetch.mock.calls.every(([url, init]) => new URL(String(url)).hostname === 'api.github.com' && init?.redirect === 'error')).toBe(true);
  });
  it.each(['404', 'private'])('captures access loss for upstream ACL transition %s', async mode => {
    const remote = setup(), changes: GithubSourceChange[] = [];
    const connector = sync(async change => { changes.push(change); });
    await connector.sync();
    if (mode === '404') remote.status(404); else remote.private();
    expect(await connector.sync()).toMatchObject({ status: 'access-lost', withdrawn: 1 });
    expect(changes[1].kind).toBe('access-lost');
    expect(changes[1].body).not.toContain('Version one');
  });
  it('never infers deletion from transient/rate-limit failures and resumes after bounded backoff', async () => {
    vi.useFakeTimers(); const remote = setup(), changes: GithubSourceChange[] = [];
    const connector = sync(async change => { changes.push(change); });
    await connector.sync(); remote.status(429);
    expect(await connector.sync()).toMatchObject({ status: 'error', withdrawn: 0, retryAt: expect.any(String) });
    const calls = remote.fetch.mock.calls.length;
    remote.status(200); remote.files.set('docs/a.md', 'After outage.');
    await connector.sync(); expect(remote.fetch).toHaveBeenCalledTimes(calls);
    vi.setSystemTime(Date.now() + 120_000);
    expect(await connector.sync()).toMatchObject({ status: 'ok', updated: 1 });
    expect(changes).toHaveLength(2);
  });
  it('retries a failed capture after restart without advancing its cursor', async () => {
    setup(); const first = sync(async () => { throw Error('Inbox unavailable'); });
    expect(await first.sync()).toMatchObject({ status: 'error' });
    await expect(readFile(join(root, 'cursor.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    first.stop(); const capture = vi.fn(async () => undefined);
    expect(await sync(capture).sync()).toMatchObject({ status: 'ok', created: 1 });
    expect(capture).toHaveBeenCalledTimes(1);
  });
  it('rejects corrupt blob data without committing any source or cursor', async () => {
    const remote = setup(); const original = remote.fetch.getMockImplementation()!;
    remote.fetch.mockImplementation(async (url, init) => String(url).includes('/git/blobs/')
      ? Response.json({ sha: String(url).split('/').at(-1), encoding: 'base64', content: Buffer.from('corrupt').toString('base64') }) : original(url, init));
    const capture = vi.fn(async () => undefined);
    expect(await sync(capture).sync()).toMatchObject({ status: 'error', error: expect.stringContaining('integrity') });
    expect(capture).not.toHaveBeenCalled();
  });
  it('does not mistake a transient blob 404 for a complete access-loss snapshot', async () => {
    const remote = setup(), changes: GithubSourceChange[] = [];
    const connector = sync(async change => { changes.push(change); });
    await connector.sync(); remote.files.set('docs/a.md', 'New body with unavailable blob.');
    const original = remote.fetch.getMockImplementation()!;
    remote.fetch.mockImplementation(async (url, init) => String(url).includes('/git/blobs/') ? new Response('', { status: 404 }) : original(url, init));
    expect(await connector.sync()).toMatchObject({ status: 'error', withdrawn: 0 });
    expect(changes).toHaveLength(1);
    expect(Object.keys(JSON.parse(await readFile(join(root, 'cursor.json'), 'utf8')).files)).toEqual(['docs/a.md']);
  });
  it.each([{ owner: 'http://localhost' }, { path: '../secret' }, { id: '../cursor' }, { intervalSeconds: 1 }])('rejects unsafe connector input %j', patch => {
    expect(() => validateGithubConnector({ ...config, ...patch })).toThrow();
  });
});
