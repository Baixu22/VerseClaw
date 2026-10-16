/**
 * TF-0106 / ANOM-01：正文抽取的**保真度**。
 *
 * 背景：真实验收 run（MODEL-01）里，模型按产品返回的正文原样引用了维基首句，
 * 但产品输出是 "...or minimization ) is..."，而页面原文是 "...or minimization) is..."。
 * 根因在 `PageTextExtractor` 的可见文本 walker：它对**每个文本节点**先 `normalizeText`
 * 再用 `' '` 连接，等于在每个内联元素边界插入一个空格。
 *
 * 后果不止引用：代码 token 也被改写（`unlink(path);` → `unlink (path) ;`），
 * 在真实站点实测 7/7 页面命中、2608 处伪影（详见 `.local/scratch/`）。
 *
 * 这里钉住：**内联元素边界不得插入空格；块级边界与 `<br>` 必须保留分隔**。
 * 无 Chromium 时 SKIP，不红 CI。
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { PageTextExtractor } from '../src/engine/browser-control/page-text-extractor.ts';

const require = createRequire(import.meta.url);

type Page = {
  goto: (url: string, opts?: Record<string, unknown>) => Promise<unknown>;
  evaluate: (expr: string) => Promise<unknown>;
  url: () => string;
};

async function withPage<T>(body: (page: Page) => Promise<T>): Promise<T | null> {
  let chromium: { launch: (opts?: Record<string, unknown>) => Promise<unknown> } | undefined;
  try {
    chromium = require('playwright-core').chromium;
  } catch {
    return null;
  }
  let browser: { newContext: () => Promise<{ newPage: () => Promise<unknown> }>; close: () => Promise<void> } | undefined;
  try {
    browser = (await chromium!.launch({ headless: true })) as typeof browser;
  } catch {
    return null;
  }
  if (!browser) return null;
  const context = await browser.newContext();
  const page = (await context.newPage()) as Page;
  try {
    return await body(page);
  } finally {
    await browser.close();
  }
}

/** 与 playwright-host-api 的 extractPageText 完全同构。 */
async function extract(page: Page, html: string): Promise<string> {
  const url = `data:text/html,${encodeURIComponent(`<!doctype html><html><body>${html}</body></html>`)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const extractor = new PageTextExtractor({
    evaluate: async (params) => ({ result: { value: await page.evaluate(String(params.expression)) } }),
  });
  const result = await extractor.extract({ url: page.url(), rules: [], maxLength: 4000 });
  return result.text;
}

describe('page text fidelity (TF-0106 / ANOM-01)', () => {
  it('内联元素边界不插入空格：正是维基首句那个形态', async () => {
    const out = await withPage((page) => extract(page, '<p>or <b>minimization</b>) is the process.</p>'));
    if (out === null) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    expect(out).toBe('or minimization) is the process.');
    expect(out).not.toContain('minimization )');
  }, 60_000);

  it('代码 token 不被拆开：unlink(path); 保持原样', async () => {
    const out = await withPage((page) => extract(page, '<p>await <code>unlink</code>(path);</p>'));
    if (out === null) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    expect(out).toBe('await unlink(path);');
    expect(out).not.toContain('unlink (path)');
  }, 60_000);

  it('缩写、连字符、相邻内联元素都不被补空格', async () => {
    const out = await withPage((page) =>
      extract(
        page,
        '<p>the <abbr title="World Health Organization">WHO</abbr>\'s <b>well</b>-known report</p>' +
          '<p>foo<b>bar</b>baz</p>',
      ),
    );
    if (out === null) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    expect(out).toContain("the WHO's well-known report");
    expect(out).toContain('foobarbaz');
    expect(out).not.toContain("WHO 's");
    expect(out).not.toContain('well -known');
  }, 60_000);

  it('块级边界与 <br> 仍然有分隔（修复不能把该有的空格一起去掉）', async () => {
    const out = await withPage((page) =>
      extract(page, '<p>first</p><p>second</p><p>line one<br>line two</p><ul><li>alpha</li><li>beta</li></ul>'),
    );
    if (out === null) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    expect(out).toContain('first second');
    expect(out).toContain('line one line two');
    expect(out).toContain('alpha beta');
  }, 60_000);

  it('源码本来有空白时保持单空格，不因修复而丢分隔', async () => {
    const out = await withPage((page) => extract(page, '<p>foo <b>bar</b> baz</p>'));
    if (out === null) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    expect(out).toBe('foo bar baz');
  }, 60_000);
});
