/**
 * TF-0108：会话的页面身份（`session.url` / `session.title`）必须跟着真实页面走。
 *
 * 动机：真实验收 run（MODEL-02）里，模型点了一个链接跳到另一页后，工具返回的
 * `data.session.url` 仍是**上一页**：`open` / `navigate` 是当时唯一会写这两个字段的地方，
 * `click` / `type` / `evaluate` / `takeSnapshot` 都不会刷新。只读 `data.session.url`
 * 的 agent 会据此判断"我在哪一页"，从而判错文档。
 *
 * 实现说明：用 `file://` 双页 fixture —— Chromium 里 `data:` URL 的 fragment 导航
 * **不改变** `page.url()`（实测），所以 hash 导航不能用来测这件事。
 *
 * 无 Chromium 时 SKIP，不红 CI。
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';

type Ctx = { facade: AgentBrowserFacade; sessionId: string; pageA: string; pageB: string };

/** 两个真实文件页，A 上有一个指向 B 的链接。 */
async function setup(): Promise<Ctx | null> {
  let api: AgentBrowserHostApi;
  try {
    api = await createPlaywrightHostApi();
  } catch {
    return null;
  }
  const dir = await mkdtemp(join(tmpdir(), 'vb-loc-'));
  const pageB = join(dir, 'b.html');
  const pageA = join(dir, 'a.html');
  await writeFile(pageB, '<!doctype html><html><head><title>Doc B</title></head><body><h1>B</h1></body></html>', 'utf8');
  await writeFile(
    pageA,
    `<!doctype html><html><head><title>Doc A</title></head><body>` +
      `<a id="go" href="${pageB.replace(/\\/gu, '/')}">to B</a></body></html>`,
    'utf8',
  );

  const root = await mkdtemp(join(tmpdir(), 'vb-loc-ev-'));
  const facade = new AgentBrowserFacade({ api, evidenceRoot: root });
  const opened = await facade.open({ url: `file:///${pageA.replace(/\\/gu, '/')}`, mode: 'headless' });
  const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;
  if (!sessionId) return null;
  return { facade, sessionId, pageA, pageB };
}

const sessionOf = (result: { data?: unknown }) =>
  (result.data as { session?: { url?: string; title?: string } } | undefined)?.session;

describe('session location stays in step with the page (TF-0108)', () => {
  it('点击链接跳转后，返回的 session.url / title 是**新**页面而不是旧的', async () => {
    const ctx = await setup();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const { facade, sessionId } = ctx;
    try {
      const opened = await facade.snapshot(sessionId);
      const urlBefore = /^- url: (.*)$/mu.exec(String(opened.content))?.[1]?.trim() ?? '';
      expect(urlBefore).toContain('a.html');

      const clicked = await facade.click(sessionId, '#go');
      expect(clicked.ok).toBe(true);

      // 核心断言：这是 agent 用来判断"我在哪一页"的字段
      const session = sessionOf(clicked);
      expect(session?.url).toContain('b.html');
      expect(session?.title).toBe('Doc B');
    } finally {
      await facade.close(sessionId).catch(() => undefined);
    }
  }, 60_000);

  it('点击**不**跳转的元素时，url / title 保持不变（不为每次点击改写身份）', async () => {
    const ctx = await setup();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const { facade, sessionId } = ctx;
    try {
      const snap = await facade.snapshot(sessionId);
      const urlBefore = /^- url: (.*)$/mu.exec(String(snap.content))?.[1]?.trim() ?? '';
      expect(urlBefore).toContain('a.html');

      // 点一个不导航的元素（<a id="go"> 会跳转，这里点 body）
      const clicked = await facade.click(sessionId, 'body');
      expect(clicked.ok).toBe(true);
      const session = sessionOf(clicked);
      expect(session?.title).toBe('Doc A');
      expect(session?.url).toContain('a.html');
    } finally {
      await facade.close(sessionId).catch(() => undefined);
    }
  }, 60_000);

  it('takeSnapshot 之后 session 身份与快照读到的 url 一致（跨进程持久化用同一字段）', async () => {
    const ctx = await setup();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const { facade, sessionId } = ctx;
    try {
      // 先跳转，让页面动过
      const clicked = await facade.click(sessionId, '#go');
      expect(sessionOf(clicked)?.url).toContain('b.html');

      // 再取快照：快照文本里的 url 与后续动作返回的 session.url 必须是同一页
      const snap = await facade.snapshot(sessionId);
      const urlInText = /^- url: (.*)$/mu.exec(String(snap.content))?.[1]?.trim() ?? '';
      expect(urlInText).toContain('b.html');

      const after = await facade.click(sessionId, 'h1');
      expect(after.ok).toBe(true);
      expect(sessionOf(after)?.url).toBe(urlInText);
    } finally {
      await facade.close(sessionId).catch(() => undefined);
    }
  }, 60_000);
});
