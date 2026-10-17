import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { chromium } from 'playwright-core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import * as persistent from '../src/engine/persistent-sessions.ts';
import { setWorkspaceRoot } from '../src/host/workspace-paths.ts';

let root: string;
const sessionId = 'reattach-session';

type Browser = Awaited<ReturnType<typeof chromium.connectOverCDP>>;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function remoteStub() {
  let connected = true;
  const page = { on: vi.fn(), url: () => 'about:blank', title: async () => '' };
  const context = { pages: () => [page], newPage: vi.fn(async () => page) };
  const browser = {
    contexts: vi.fn(() => [context]),
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => { connected = false; }),
    isConnected: () => connected,
  };
  return { browser, context };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'vb-reattach-'));
  setWorkspaceRoot(root);
  await persistent.saveSessionRecord({
    schemaVersion: 1,
    id: sessionId,
    pid: 0,
    endpoint: 'http://127.0.0.1:9222',
    port: 9222,
    mode: 'headless',
    createdAt: '2026-10-03T00:00:00.000Z',
    profileDir: join(persistent.sessionDir(sessionId), 'profile'),
    external: true,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  setWorkspaceRoot(undefined);
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

it('concurrent accesses share one reattachment and close disconnects every acquired client', async () => {
  const remotes: ReturnType<typeof remoteStub>['browser'][] = [];
  const connect = vi.spyOn(chromium, 'connectOverCDP').mockImplementation(async () => {
    const { browser } = remoteStub();
    remotes.push(browser);
    return browser as unknown as Browser;
  });
  const api = await createPlaywrightHostApi({ persistent: true });
  await Promise.all(Array.from({ length: 8 }, () => api.getConsoleMessages({ sessionId })));
  await api.close({ sessionId });
  expect(connect).toHaveBeenCalledTimes(1);
  expect(remotes.every(browser => !browser.isConnected())).toBe(true);
  expect((await api.status()).sessions).toEqual([]);
});

it.each(['context', 'page'] as const)('an empty %s on legacy reattachment does not create replacement resources and keeps the record retryable', async failure => {
  const failed = remoteStub();
  if (failure === 'context') {
    failed.browser.contexts.mockReturnValue([]);
    failed.browser.newContext.mockRejectedValueOnce(new Error('context setup failed'));
  } else {
    failed.context.pages = () => [];
    failed.context.newPage.mockRejectedValueOnce(new Error('page setup failed'));
  }
  const retry = remoteStub();
  const connect = vi.spyOn(chromium, 'connectOverCDP')
    .mockResolvedValueOnce(failed.browser as unknown as Browser)
    .mockResolvedValueOnce(retry.browser as unknown as Browser);
  const shutdown = vi.spyOn(persistent, 'closeBrowserThroughCdp');
  const api = await createPlaywrightHostApi({ persistent: true });

  await expect(api.getConsoleMessages({ sessionId })).rejects.toThrow('E_PAGE_CLOSED');
  expect(failed.browser.newContext).not.toHaveBeenCalled();
  expect(failed.context.newPage).not.toHaveBeenCalled();
  expect(failed.browser.close).toHaveBeenCalledTimes(1);
  expect(failed.browser.isConnected()).toBe(false);
  expect((await api.status()).sessions).toEqual([]);
  expect(await persistent.loadSessionRecord(sessionId)).not.toBeNull();

  expect((await api.getConsoleMessages({ sessionId })).success).toBe(true);
  await api.close({ sessionId });
  expect(connect).toHaveBeenCalledTimes(2);
  expect(retry.browser.isConnected()).toBe(false);
  expect(shutdown).not.toHaveBeenCalled();
});

it('failed concurrent reattachment is shared, then a later access can retry', async () => {
  const { browser } = remoteStub();
  const connect = vi.spyOn(chromium, 'connectOverCDP')
    .mockRejectedValueOnce(new Error('attach failed'))
    .mockResolvedValue(browser as unknown as Browser);
  const api = await createPlaywrightHostApi({ persistent: true });
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => api.getConsoleMessages({ sessionId })));
  expect(results.every(result => result.status === 'rejected' && result.reason.message === 'attach failed')).toBe(true);
  expect(connect).toHaveBeenCalledTimes(1);
  expect((await api.status()).sessions).toEqual([]);
  expect(await persistent.loadSessionRecord(sessionId)).not.toBeNull();

  expect((await api.getConsoleMessages({ sessionId })).success).toBe(true);
  await api.close({ sessionId });
  expect(connect).toHaveBeenCalledTimes(2);
  expect(browser.isConnected()).toBe(false);
});

it('a disconnected cached client is reattached once instead of serving stale observations', async () => {
  const first = remoteStub();
  const second = remoteStub();
  const connect = vi.spyOn(chromium, 'connectOverCDP')
    .mockResolvedValueOnce(first.browser as unknown as Browser)
    .mockResolvedValueOnce(second.browser as unknown as Browser);
  const api = await createPlaywrightHostApi({ persistent: true });
  await api.getConsoleMessages({ sessionId });
  await first.browser.close();
  await Promise.all(Array.from({ length: 8 }, () => api.getConsoleMessages({ sessionId })));
  expect(connect).toHaveBeenCalledTimes(2);
  await api.close({ sessionId });
  expect(second.browser.close).toHaveBeenCalledTimes(1);
});

it('a failed reconnect after disconnect is an error rather than a stale success', async () => {
  const first = remoteStub();
  vi.spyOn(chromium, 'connectOverCDP')
    .mockResolvedValueOnce(first.browser as unknown as Browser)
    .mockRejectedValueOnce(new Error('CDP is down'));
  const api = await createPlaywrightHostApi({ persistent: true });
  await api.getConsoleMessages({ sessionId });
  await first.browser.close();
  await expect(api.getConsoleMessages({ sessionId })).rejects.toThrow('CDP is down');
  expect((await api.status()).sessions).toEqual([]);
  expect(await persistent.loadSessionRecord(sessionId)).not.toBeNull();
});

it('persistent cleanup failure is not a successful close and can be retried', async () => {
  const { browser } = remoteStub();
  vi.spyOn(chromium, 'connectOverCDP').mockResolvedValue(browser as unknown as Browser);
  const remove = vi.spyOn(persistent, 'removeSession').mockRejectedValueOnce(new Error('profile is locked'));
  const api = await createPlaywrightHostApi({ persistent: true });
  const facade = new AgentBrowserFacade({ api });
  await api.getConsoleMessages({ sessionId });
  expect(await facade.close(sessionId)).toMatchObject({ ok: false, error: { code: 'E_CLOSE', message: 'profile is locked' } });
  expect(await persistent.loadSessionRecord(sessionId)).not.toBeNull();
  expect((await facade.close(sessionId)).ok).toBe(true);
  expect(remove).toHaveBeenCalledTimes(2);
  expect(await persistent.loadSessionRecord(sessionId)).toBeNull();
});

it('close waits for an in-flight reattachment instead of resurrecting a removed session', async () => {
  const { browser } = remoteStub();
  const started = deferred<void>();
  const attached = deferred<Browser>();
  vi.spyOn(chromium, 'connectOverCDP').mockImplementation(() => {
    started.resolve();
    return attached.promise;
  });
  const api = await createPlaywrightHostApi({ persistent: true });
  const reading = api.getConsoleMessages({ sessionId });
  await started.promise;
  const closing = api.close({ sessionId });
  attached.resolve(browser as unknown as Browser);
  await Promise.all([reading, closing]);

  expect((await api.status()).sessions).toEqual([]);
  expect(browser.isConnected()).toBe(false);
  expect(await persistent.loadSessionRecord(sessionId)).toBeNull();
  await expect(api.getConsoleMessages({ sessionId })).rejects.toMatchObject({ code: 'E_NO_SESSION' });
});

it('an access arriving during close cannot reuse or recreate the closing session', async () => {
  const { browser } = remoteStub();
  const started = deferred<void>();
  const disconnected = deferred<void>();
  browser.close.mockImplementationOnce(() => {
    started.resolve();
    return disconnected.promise;
  });
  const connect = vi.spyOn(chromium, 'connectOverCDP').mockResolvedValue(browser as unknown as Browser);
  const api = await createPlaywrightHostApi({ persistent: true });
  await api.getConsoleMessages({ sessionId });

  const closing = api.close({ sessionId });
  await started.promise;
  const reading = Promise.resolve(api.getConsoleMessages({ sessionId })).catch((error: unknown) => error);
  disconnected.resolve();
  await closing;
  expect(await reading).toMatchObject({ code: 'E_NO_SESSION' });
  expect(connect).toHaveBeenCalledTimes(1);
  expect((await api.status()).sessions).toEqual([]);
});

it('concurrent closes share one disconnect and a failed close remains retryable', async () => {
  const { browser } = remoteStub();
  const started = deferred<void>();
  const disconnected = deferred<void>();
  browser.close.mockImplementationOnce(() => {
    started.resolve();
    return disconnected.promise;
  });
  vi.spyOn(chromium, 'connectOverCDP').mockResolvedValue(browser as unknown as Browser);
  const api = await createPlaywrightHostApi({ persistent: true });
  await api.getConsoleMessages({ sessionId });

  const first = Promise.resolve(api.close({ sessionId })).catch((error: unknown) => error);
  await started.promise;
  const second = Promise.resolve(api.close({ sessionId })).catch((error: unknown) => error);
  disconnected.reject(new Error('disconnect failed'));
  const results = await Promise.all([first, second]);
  expect(results.every(result => result instanceof Error && result.message === 'disconnect failed')).toBe(true);
  expect(browser.close).toHaveBeenCalledTimes(1);
  expect((await api.status()).sessions?.map(session => session.id)).toEqual([sessionId]);
  expect(await persistent.loadSessionRecord(sessionId)).not.toBeNull();

  await api.close({ sessionId });
  expect(browser.close).toHaveBeenCalledTimes(2);
  expect(browser.isConnected()).toBe(false);
  expect(await persistent.loadSessionRecord(sessionId)).toBeNull();
});

it('rejects ambiguous legacy records without target identity instead of choosing the first page',async()=>{
  const remote=remoteStub();const one=remote.context.pages()[0];const two={...one,title:vi.fn(async()=> 'another')};
  remote.context.pages=()=>[one,two];vi.spyOn(chromium,'connectOverCDP').mockResolvedValue(remote.browser as unknown as Browser);
  const api=await createPlaywrightHostApi({persistent:true});
  await expect(api.getConsoleMessages({sessionId})).rejects.toThrow('E_PAGE_ID');
  expect(remote.browser.close).toHaveBeenCalledTimes(1);expect(remote.context.newPage).not.toHaveBeenCalled();expect(remote.browser.newContext).not.toHaveBeenCalled();
  expect(two.title).not.toHaveBeenCalled();expect(await persistent.loadSessionRecord(sessionId)).not.toBeNull();expect((await api.status()).sessions).toEqual([]);
});
