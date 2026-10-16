/**
 * TF-0111 / TF-0112：三个由真实验收 run 暴露的缺口。
 *
 *  1. **console 分级**按驱动给的 `[level]` 前缀，而不是行内文字子串。
 *     旧规则把 `[warning] Error with Feature-Policy header…` 分进 errors，
 *     而 `newErrors` 是硬失败 → 健康页面被判 `verify_flow FAIL`（已复现）。
 *  2. 紧凑摘要**只计数不显示 warning 文本**，agent 知道有 warning 却读不到内容。
 *  3. 快照展示**相对 href**，而 `vb_nav` 只接受绝对 URL → 观察到的链接地址无法使用。
 *     原生 `<details>/<summary>` 披露同时补齐：给 ref + 状态。
 *
 * 无 Chromium 时 live 用例 SKIP，不红 CI。
 */
import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';

const page = (body: string): string =>
  `data:text/html,${encodeURIComponent(`<!doctype html><html><head><title>T</title></head><body>${body}</body></html>`)}`;

async function live(): Promise<{ facade: AgentBrowserFacade; api: AgentBrowserHostApi } | null> {
  try {
    const api = await createPlaywrightHostApi();
    const root = await mkdtemp(join(tmpdir(), 'vb-gaps-'));
    return { facade: new AgentBrowserFacade({ api, evidenceRoot: root }), api };
  } catch {
    return null;
  }
}

describe('console severity + warning text (TF-0111)', () => {
  it('文字里含 "Error" 的 **warning** 不再被判成 error（健康页面不再假 FAIL）', async () => {
    const ctx = await live();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const { facade } = ctx;
    const opened = await facade.open({
      url: page(`<h1>healthy</h1><script>console.warn("Error with Feature-Policy header: Unrecognized feature: '*'");</script>`),
      mode: 'headless',
    });
    const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;
    try {
      const verify = await facade.verifyFlow({ sessionId, selectors: ['h1'], screenshot: false });
      const text = String(verify.content);
      expect(text).toContain('# verify_flow PASS');
      expect(text).toContain('+0 errors');
      // warning 文本必须可见（旧行为：只计数、不显示）
      expect(text).toContain('Feature-Policy');
      expect((verify.data as { outcome?: string }).outcome).toBe('pass');
    } finally {
      await facade.close(sessionId).catch(() => undefined);
    }
  }, 60_000);

  it('纯 log 含 "error" 字样也不算错误', async () => {
    const ctx = await live();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const { facade } = ctx;
    const opened = await facade.open({
      url: page(`<h1>healthy</h1><script>console.log("error rate is 0%");</script>`),
      mode: 'headless',
    });
    const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;
    try {
      const verify = await facade.verifyFlow({ sessionId, selectors: ['h1'], screenshot: false });
      const text = String(verify.content);
      expect(text).toContain('# verify_flow PASS');
      expect(text).toContain('+0 errors');
      expect(text).toContain('+0 warnings');
    } finally {
      await facade.close(sessionId).catch(() => undefined);
    }
  }, 60_000);

  it('真正的 console.error 仍然判 FAIL（修复不能把该报的错也放过）', async () => {
    const ctx = await live();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const { facade } = ctx;
    const opened = await facade.open({
      url: page(`<h1>broken</h1><script>console.error("real failure happened");</script>`),
      mode: 'headless',
    });
    const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;
    try {
      const verify = await facade.verifyFlow({ sessionId, selectors: ['h1'], screenshot: false });
      const text = String(verify.content);
      expect(text).toContain('# verify_flow FAIL');
      expect(text).toContain('real failure happened');
    } finally {
      await facade.close(sessionId).catch(() => undefined);
    }
  }, 60_000);
});

describe('snapshot href resolution + native details (TF-0112)', () => {
  it('相对 href 被解析成绝对 URL，因此观察到的地址可直接用于导航', async () => {
    const ctx = await live();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const { facade, api } = ctx;
    // A real HTTP origin is needed, but the regression must not depend on W3C's
    // availability (the unchanged baseline also hit ERR_CONNECTION_CLOSED).
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(req.url?.includes('/examples/') ? '<h1>Example destination</h1>' : '<a href="examples/accordion/">Accordion Example</a>');
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/patterns/accordion/`;
    const opened = await facade.open({ url, mode: 'headless' });
    const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;
    try {
      expect(opened.ok, JSON.stringify(opened.error)).toBe(true);
      const snap = await facade.snapshot(sessionId);
      const text = String(snap.content);
      // 该页面上示例链接的原始 href 是 "examples/accordion/"
      const linkLine = text.split('\n').find((l) => /Accordion Example/u.test(l) && l.includes('link'));
      expect(linkLine, `Actual snapshot: ${text}`).toBeTruthy();
      const href = /href=(\S+)/u.exec(linkLine as string)?.[1];
      expect(href).toBe(`${url}examples/accordion/`);
      expect(href).not.toBe('examples/accordion/');

      // 关键：观察到的值可以直接交给导航
      const nav = await api.navigate({ sessionId, url: href as string });
      expect(nav.success).toBe(true);
      expect(String(nav.session.url)).toBe(`${url}examples/accordion/`);
    } finally {
      await facade.close(sessionId).catch(() => undefined);
      server.closeAllConnections(); await new Promise<void>((done, reject) => server.close(e => e ? reject(e) : done()));
    }
  }, 60_000);

  it('原生 <details>/<summary> 现在有 ref，并暴露 open 状态', async () => {
    const ctx = await live();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const { facade } = ctx;
    const opened = await facade.open({
      url: page(
        '<details id="d1"><summary>Shipping options</summary><p>Express delivery.</p></details>' +
          '<details id="d2" open><summary>Payment</summary><p>Card accepted.</p></details>',
      ),
      mode: 'headless',
    });
    const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;
    try {
      const snap = await facade.snapshot(sessionId);
      const text = String(snap.content);
      expect(text).toContain('button | "Shipping options" | expanded=false');
      expect(text).toContain('button | "Payment" | expanded=true');
    } finally {
      await facade.close(sessionId).catch(() => undefined);
    }
  }, 60_000);
});
