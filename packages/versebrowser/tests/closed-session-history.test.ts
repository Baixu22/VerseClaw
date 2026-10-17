import { afterEach, expect, it, vi } from 'vitest';
import { chromium } from 'playwright-core';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';

afterEach(() => vi.restoreAllMocks());

it('keeps only the last 1024 closed ids, preserving recent retries and live sessions', async () => {
  const browser = {
    isConnected: () => true,
    newPage: async () => ({ on: () => undefined, close: async () => undefined }),
    close: async () => undefined,
  };
  vi.spyOn(chromium, 'launch').mockResolvedValue(browser as unknown as Awaited<ReturnType<typeof chromium.launch>>);
  const api = await createPlaywrightHostApi();
  const live = (await api.open()).session.id;
  const closed: string[] = [];
  for (let i = 0; i < 1024; i++) {
    const id = (await api.open()).session.id;
    closed.push(id);
    await api.close({ sessionId: id });
  }
  expect(await api.close({ sessionId: closed[0]! })).toEqual({ success: true });
  const next = (await api.open()).session.id;
  await api.close({ sessionId: next });
  await expect(api.close({ sessionId: closed[0]! })).rejects.toMatchObject({ code: 'E_NO_SESSION' });
  expect(await api.close({ sessionId: closed[1]! })).toEqual({ success: true });
  expect(await api.close({ sessionId: next })).toEqual({ success: true });
  await expect(api.close({ sessionId: 'never-opened' })).rejects.toMatchObject({ code: 'E_NO_SESSION' });
  expect((await api.status()).sessions?.map((session) => session.id)).toEqual([live]);
  await api.close({ sessionId: live });
});
