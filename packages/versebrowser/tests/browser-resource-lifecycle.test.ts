import { afterEach, expect, it, vi } from 'vitest';
import { chromium } from 'playwright-core';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import { AgentBrowserFacade } from '../src/engine/facade.ts';

afterEach(() => vi.restoreAllMocks());

function browserStub() {
  const page = { on() {}, close: vi.fn(async () => {}), goto: vi.fn(async () => {}), url: () => 'about:blank', title: async () => '' };
  const browser = { isConnected: () => true, newPage: vi.fn(async () => ({ ...page })), close: vi.fn(async () => {}) };
  const launch = vi.spyOn(chromium, 'launch').mockResolvedValue(browser as unknown as Awaited<ReturnType<typeof chromium.launch>>);
  return { browser, page, launch };
}

it('concurrent opens share one launch and closing all sessions closes that browser', async () => {
  const { browser, launch } = browserStub();
  const api = await createPlaywrightHostApi();
  const opened = await Promise.all(Array.from({ length: 8 }, () => api.open()));
  await Promise.all(opened.map(result => api.close({ sessionId: result.session.id })));
  expect(launch).toHaveBeenCalledTimes(1);
  expect(browser.close).toHaveBeenCalledTimes(1);
});

it('a failed launch does not poison later opens', async () => {
  const { launch } = browserStub();
  launch.mockRejectedValueOnce(new Error('launch failed'));
  const api = await createPlaywrightHostApi();
  await expect(api.open()).rejects.toThrow('launch failed');
  const opened = await api.open();
  expect(launch).toHaveBeenCalledTimes(2);
  await api.close({ sessionId: opened.session.id });
});

it('failed page creation releases an unused browser', async () => {
  const { browser } = browserStub();
  browser.newPage.mockRejectedValueOnce(new Error('page allocation failed'));
  const api = await createPlaywrightHostApi();
  await expect(api.open()).rejects.toThrow('page allocation failed');
  expect((await api.status()).sessions).toEqual([]);
  expect(browser.close).toHaveBeenCalledTimes(1);
});

it('failed navigation rolls back its session without closing another live session', async () => {
  const { browser, page } = browserStub();
  const api = await createPlaywrightHostApi();
  const live = await api.open();
  page.goto.mockRejectedValueOnce(new Error('navigation failed'));
  await expect(api.open({ url: 'https://example.test/' })).rejects.toThrow('navigation failed');
  expect((await api.status()).sessions?.map(s => s.id)).toEqual([live.session.id]);
  expect(browser.close).not.toHaveBeenCalled();
  await api.close({ sessionId: live.session.id });
  expect(browser.close).toHaveBeenCalledTimes(1);
});

it('opening the other browser mode does not close an existing live session', async () => {
  const make = () => ({ isConnected: () => true, newPage: async () => ({ on() {}, close: async () => {} }), close: vi.fn(async () => {}) });
  const headless = make();
  const visible = make();
  const launch = vi.spyOn(chromium, 'launch')
    .mockResolvedValueOnce(headless as unknown as Awaited<ReturnType<typeof chromium.launch>>)
    .mockResolvedValueOnce(visible as unknown as Awaited<ReturnType<typeof chromium.launch>>);
  const api = await createPlaywrightHostApi();
  const a = await api.open({ mode: 'headless' });
  const b = await api.open({ mode: 'visible' });
  expect(headless.close).not.toHaveBeenCalled();
  expect(launch).toHaveBeenNthCalledWith(1, expect.objectContaining({ headless: true }));
  expect(launch).toHaveBeenNthCalledWith(2, expect.objectContaining({ headless: false }));
  await api.close({ sessionId: a.session.id });
  expect(headless.close).toHaveBeenCalledTimes(1);
  expect(visible.close).not.toHaveBeenCalled();
  await api.close({ sessionId: b.session.id });
  expect(visible.close).toHaveBeenCalledTimes(1);
});

it('does not serve cached observations after an in-process browser disconnects', async () => {
  const { browser } = browserStub();
  const api = await createPlaywrightHostApi();
  const opened = await api.open();
  browser.isConnected = () => false;
  await expect(api.getConsoleMessages({ sessionId: opened.session.id })).rejects.toMatchObject({ code: 'E_NO_SESSION' });
  expect((await api.status()).sessions).toEqual([]);
});

it('stale sessions from a dead browser do not keep its replacement alive', async () => {
  const { browser, launch } = browserStub();
  const api = await createPlaywrightHostApi();
  await api.open();
  browser.isConnected = () => false;
  const replacement = { isConnected: () => true, newPage: browser.newPage, close: vi.fn(async () => {}) };
  launch.mockResolvedValue(replacement as unknown as Awaited<ReturnType<typeof chromium.launch>>);
  const opened = await api.open();
  await api.close({ sessionId: opened.session.id });
  expect(replacement.close).toHaveBeenCalledTimes(1);
  expect((await api.status()).sessions).toEqual([]);
});

it('a failed page close is reported and keeps that session available for retry', async () => {
  const { page, browser } = browserStub();
  const api = await createPlaywrightHostApi();
  const facade = new AgentBrowserFacade({ api });
  const live = await api.open();
  const closing = await api.open();
  page.close.mockRejectedValueOnce(new Error('page close failed'));
  const result = await facade.close(closing.session.id);
  expect(result).toMatchObject({ ok: false, error: { code: 'E_CLOSE', message: 'page close failed' } });
  expect((await api.status()).sessions?.map(s => s.id)).toContain(closing.session.id);
  expect(browser.close).not.toHaveBeenCalled();
  expect((await facade.close(closing.session.id)).ok).toBe(true);
  await api.close({ sessionId: live.session.id });
});

it('a failed last-browser close is reported and can be retried using the same session id', async () => {
  const { browser } = browserStub();
  browser.close.mockRejectedValueOnce(new Error('browser close failed'));
  const api = await createPlaywrightHostApi();
  const facade = new AgentBrowserFacade({ api });
  const opened = await api.open();
  expect(await facade.close(opened.session.id)).toMatchObject({ ok: false, error: { code: 'E_CLOSE' } });
  expect((await facade.close(opened.session.id)).ok).toBe(true);
  expect(browser.close).toHaveBeenCalledTimes(2);
});

it('an open arriving during last-browser close waits and launches a fresh browser', async () => {
  const { browser, launch } = browserStub();
  const api = await createPlaywrightHostApi();
  const opened = await api.open();
  let closingStarted!: () => void;
  const started = new Promise<void>(resolve => { closingStarted = resolve; });
  let finishClose!: () => void;
  browser.close.mockImplementationOnce(() => { closingStarted(); return new Promise<void>(resolve => { finishClose = resolve; }); });
  const closing = api.close({ sessionId: opened.session.id });
  await started;
  const replacement = { ...browser, close: vi.fn(async () => {}) };
  launch.mockResolvedValueOnce(replacement as unknown as Awaited<ReturnType<typeof chromium.launch>>);
  const opening = api.open();
  expect(launch).toHaveBeenCalledTimes(1);
  finishClose();
  await closing;
  const fresh = await opening;
  expect(launch).toHaveBeenCalledTimes(2);
  await api.close({ sessionId: fresh.session.id });
  expect(replacement.close).toHaveBeenCalledTimes(1);
});
