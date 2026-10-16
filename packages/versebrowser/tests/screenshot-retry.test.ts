/**
 * 2026-10-03 负例回归：`screenshotToDisk` 只对 Chromium 的**瞬态截图协议错误**重试一次。
 *
 * 现场来自一次干净检出 P7（commit `5798d9c`）：在整套并发测试的资源画像下（15 fork × 数十个
 * Chromium、空闲内存降到 ~1 GB），Chromium 偶发返回
 *
 *   Protocol error (Page.captureScreenshot): Unable to capture screenshot
 *
 * 日志显示字体已加载完，但尚不能据此排除页面因素；产品当时如实返回 `E_SCREENSHOT`，
 * 但 agent 的 `verify_flow` 证据包会因此缺截图。改动：仅对该协议错误重试**一次**（150ms 短路延迟），
 * 二次仍失败就原样抛出。
 *
 * 三条判据（全部用桩，确定性、不需要 Chromium）：
 *   1. 瞬态失败 → 重试一次并成功落盘；
 *   2. **非**瞬态错误（未知会话等）→ 不重试，`calls === 1`；
 *   3. 两次都瞬态失败 → 如实报 `E_SCREENSHOT`（重试不是「把失败洗成成功」）。
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';

const PNG_URL = `data:image/png;base64,${Buffer.from('fake-png-bytes').toString('base64')}`;

const transientError = () =>
  new Error(
    'page.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot',
  );

async function facadeWith(
  screenshot: (payload: unknown) => Promise<unknown>,
): Promise<{ facade: AgentBrowserFacade; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'vb-shot-retry-'));
  const api = { screenshot } as unknown as AgentBrowserHostApi;
  return { facade: new AgentBrowserFacade({ api, evidenceRoot: root }), root };
}

const cleanup = (root: string) =>
  rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);

describe('screenshotToDisk retries the transient Chromium capture error once', () => {
  it.each([
    'Protocol error (Page.captureScreenshot): Target closed',
    'Protocol error (Page.captureScreenshot): Invalid parameters',
  ])('does not retry another screenshot protocol error: %s', async (message) => {
    let calls = 0;
    const { facade, root } = await facadeWith(async () => { calls++; throw new Error(message); });
    try {
      const result = await facade.screenshotToDisk('s1');
      expect(result.error?.code).toBe('E_SCREENSHOT');
      expect(result.error?.message).toBe(message);
      expect(calls).toBe(1);
    } finally { await cleanup(root); }
  });

  it('瞬态协议错误 → 重试一次并成功落盘', async () => {
    let calls = 0;
    const { facade, root } = await facadeWith(async () => {
      calls += 1;
      if (calls === 1) throw transientError();
      return { success: true, dataUrl: PNG_URL };
    });
    try {
      const result = await facade.screenshotToDisk('s1', { fileName: 'retry.png' });
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
      expect(calls).toBe(2);
      expect(String((result.data as { path?: string }).path)).toContain('retry.png');
    } finally {
      await cleanup(root);
    }
  }, 30_000);

  it('非瞬态错误 → 不重试，失败语义不变', async () => {
    let calls = 0;
    const { facade, root } = await facadeWith(async () => {
      calls += 1;
      throw new Error('unknown session: s1');
    });
    try {
      const result = await facade.screenshotToDisk('s1');
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('E_SCREENSHOT');
      expect(calls).toBe(1);
    } finally {
      await cleanup(root);
    }
  }, 30_000);

  it('两次都瞬态失败 → 重试一次后如实报错（不假装成功）', async () => {
    let calls = 0;
    const { facade, root } = await facadeWith(async () => {
      calls += 1;
      throw transientError();
    });
    try {
      const result = await facade.screenshotToDisk('s1');
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('E_SCREENSHOT');
      expect(String(result.error?.message)).toContain('captureScreenshot');
      expect(calls).toBe(2);
    } finally {
      await cleanup(root);
    }
  }, 30_000);
});

it('rejects undeclared element screenshots before calling an injected host', async () => {
  let calls = 0;
  const { facade, root } = await facadeWith(async () => { calls++; return { success: true, dataUrl: PNG_URL }; });
  try {
    const result = await facade.screenshotToDisk('s1', { selector: '#card' });
    expect(result.error?.code).toBe('E_NOT_IMPLEMENTED'); expect(calls).toBe(0);
  } finally { await cleanup(root); }
});
it('does not turn a failed host screenshot result into saved evidence', async () => {
  const { facade, root } = await facadeWith(async () => ({ success: false, error: 'capture refused', dataUrl: PNG_URL }));
  try {
    const result = await facade.screenshotToDisk('s1');
    expect(result).toMatchObject({ ok: false, error: { code: 'E_SCREENSHOT', message: 'capture refused' } });
    expect(result.evidence?.length ?? 0).toBe(0);
  } finally { await cleanup(root); }
});
