/**
 * TF-0098：agent 必须能**读到页面正文**（可引用、带预算、截断可见）。
 *
 * 背景：真实任务 run 里模型拿不到正文（snapshot 8003 字符只有交互项与 metrics），
 * 于是把"原样引用"写成了与页面不符的句子。这里钉住读正文这条路。
 * 无 Chromium 时 SKIP，不红 CI。
 */
import { describe, expect, it } from 'vitest';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';
import { PLAYWRIGHT_DRIVER_METHODS } from '../src/engine/driver-profile.ts';

const SENTENCE =
  'Minification is the process of removing all unnecessary characters from the source code without changing its functionality.';

const PAGE = `data:text/html,${encodeURIComponent(`<!doctype html>
<html><head><title>Doc</title></head>
<body>
  <nav>nav noise</nav>
  <article id="lead"><p>${SENTENCE}</p></article>
  <script>/* script noise that must not be extracted */</script>
</body></html>`)}`;

async function tryApi(): Promise<AgentBrowserHostApi | null> {
  try {
    return await createPlaywrightHostApi();
  } catch {
    return null;
  }
}

describe('page text read (TF-0098)', () => {
  it('whole-page read returns quotable text; selector narrows it; truncation is declared', async () => {
    const api = await tryApi();
    if (!api) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const opened = await api.open({ url: PAGE, mode: 'headless' });
    expect(opened.success).toBe(true);
    const sessionId = opened.session.id;

    try {
      const whole = await api.extractPageText({ sessionId, rules: [], maxLength: 4000 });
      expect(whole.success).toBe(true);
      expect(whole.text).toContain(SENTENCE);
      expect(whole.truncated).toBe(false);
      expect(whole.text).not.toContain('script noise');

      const scoped = await api.extractPageText({
        sessionId,
        maxLength: 4000,
        rules: [
          {
            id: 'inline-selector',
            alias: 'inline-selector',
            urlPattern: '.*',
            selectorsText: '#lead',
            sortOrder: 0,
            createdAt: 0,
            updatedAt: 0,
          },
        ],
      });
      expect(scoped.text).toContain('unnecessary characters');
      expect(scoped.text).not.toContain('nav noise');

      const tiny = await api.extractPageText({ sessionId, rules: [], maxLength: 40 });
      expect(tiny.truncated).toBe(true);
      expect(tiny.text.length).toBeLessThanOrEqual(40);
    } finally {
      await Promise.resolve(api.close({ sessionId })).catch(() => undefined);
    }
  }, 60_000);

  it('facade 面同样可读，并把预算与截断如实带回', async () => {
    const api = await tryApi();
    if (!api) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const root = await mkdtemp(join(tmpdir(), 'vb-pagetext-'));
    const facade = new AgentBrowserFacade({ api, evidenceRoot: root });
    const opened = await facade.open({ url: PAGE, mode: 'headless' });
    const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id;
    expect(sessionId).toBeTruthy();

    try {
      const result = await facade.extractPageText({ sessionId: sessionId as string, maxLength: 4000 });
      expect(result.ok).toBe(true);
      expect(String(result.content)).toContain('without changing its functionality');
      expect((result.data as { truncated?: boolean }).truncated).toBe(false);

      const scoped = await facade.extractPageText({
        sessionId: sessionId as string,
        selector: '#lead',
        maxLength: 4000,
      });
      expect((scoped.data as { text?: string }).text).toContain('unnecessary characters');
    } finally {
      if (sessionId) await facade.close(sessionId).catch(() => undefined);
    }
  }, 60_000);

  /**
   * 2026-10-03 负例回归：调用方**给了 selector** 却没命中时，不得静默回退成整页。
   *
   * 旧行为（实测）：`vb_page_text {selector:'#does-not-exist'}` 返回 ok:true，content 却是整页正文，
   * 唯一信号是 `data.usedFallback`——而 payload 大时信封会省略 `data`，恰好在正文长到需要预算时信号丢失；
   * 导航期间还会回退成**上一页**的文本。调用方按 selector 取到的可能不是它要的东西。
   */
  it('selector 未命中 → E_PAGE_TEXT 并指名 selector；不给 selector 时仍是整页', async () => {
    const api = await tryApi();
    if (!api) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const root = await mkdtemp(join(tmpdir(), 'vb-pagetext-selector-'));
    const facade = new AgentBrowserFacade({ api, evidenceRoot: root });
    const opened = await facade.open({ url: PAGE, mode: 'headless' });
    const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;
    expect(sessionId).toBeTruthy();
    try {
      const miss = await facade.extractPageText({ sessionId, selector: '#does-not-exist' });
      expect(miss.ok).toBe(false);
      expect(miss.error?.code).toBe('E_PAGE_TEXT');
      expect(String(miss.error?.message)).toContain('#does-not-exist');
      // 关键：不得把整页正文当成「你要的那段」递出去
      expect(String(miss.content)).not.toContain(SENTENCE);

      const hit = await facade.extractPageText({ sessionId, selector: '#lead' });
      expect(hit.ok).toBe(true);
      expect((hit.data as { text?: string }).text).toContain(SENTENCE);

      const whole = await facade.extractPageText({ sessionId });
      expect(whole.ok).toBe(true);
      expect((whole.data as { text?: string }).text).toContain(SENTENCE);
    } finally {
      if (sessionId) await facade.close(sessionId).catch(() => undefined);
    }
  }, 60_000);

  it('驱动档案登记了 extractPageText —— 否则工具会在运行期被可用性门控拒掉', () => {
    // 实测踩过：MCP 工具已接线、驱动也已实现，但 PLAYWRIGHT_DRIVER_METHODS 漏登记，
    // 结果是 `driver "playwright" does not serve extractPageText`——工具面看得见、调不动。
    expect(PLAYWRIGHT_DRIVER_METHODS).toContain('extractPageText');
  });

  /**
   * C96 / TF-0123: `page_text {rows}` is a second page-context producer, and it carried its own
   * shorter secret-name list. Measured with real Chromium (2026-10-14): a field named
   * `authorization`, `cookie` or `private_key` came back as `{status:'present', value:'<raw>'}`
   * while `api_key` and `type=password` were redacted. Both producers now inline the same
   * `isSecretFieldName` source.
   */
  it('rows extraction withholds authorization/cookie/private_key values', async () => {
    const api = await tryApi();
    if (!api) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const secrets = ['Bearer deadbeefcafe', 'sid=abcdef123456', 'PRIVATEKEY-MATERIAL'];
    const page = `data:text/html,${encodeURIComponent(`<!doctype html><html><body><table><tbody>
  <tr><td><input id="api" name="api_key" value="${secrets[0]}"></td></tr>
  <tr><td><input id="auth" name="authorization" value="${secrets[0]}"></td></tr>
  <tr><td><input id="ck" name="cookie" value="${secrets[1]}"></td></tr>
  <tr><td><input id="pk" name="private_key" value="${secrets[2]}"></td></tr>
  <tr><td><input id="pw" type="password" value="password-attribute"></td></tr>
</tbody></table></body></html>`)}`;
    const opened = await api.open({ url: page, mode: 'headless' });
    expect(opened.success).toBe(true);
    const sessionId = opened.session.id;
    try {
      const res = await api.extractPageText({
        sessionId,
        rules: [],
        extractMode: 'text',
        selectorType: 'css',
        rows: {
          selector: 'tr',
          fields: {
            f1: { selector: '#api', attribute: 'value' },
            f2: { selector: '#auth', attribute: 'value' },
            f3: { selector: '#ck', attribute: 'value' },
            f4: { selector: '#pk', attribute: 'value' },
            f5: { selector: '#pw', attribute: 'value' },
          },
        },
      });
      expect(res.success).toBe(true);
      const text = String(res.text);
      for (const secret of secrets) expect(text).not.toContain(secret);
      expect(text).not.toContain('password-attribute');
      expect((text.match(/"status":"redacted"/g) ?? []).length).toBeGreaterThanOrEqual(4);
    } finally {
      await Promise.resolve(api.close({ sessionId })).catch(() => undefined);
    }
  }, 60_000);
});
