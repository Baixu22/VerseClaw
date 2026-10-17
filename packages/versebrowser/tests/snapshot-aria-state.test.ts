/**
 * TF-0107：交互快照暴露 disclosure 状态（`aria-expanded` / `aria-controls`）。
 *
 * 动机：真实验收 run（MODEL-02）里，"找一个处于收起状态的可展开内容项" 这个前置问题
 * 工具面**没有直接答案** —— 快照只给 role/name/value/disabled/href，`aria-expanded`
 * 全库无人读取，模型只能去读正文里的示例源码（那是代码文本，不是运行态）或先点再 verify 反推。
 *
 * 约束：**没有 ARIA 状态的页面输出必须逐字节不变**（既有已发布读数 790/842 不能动），
 * 所以只在属性存在时才渲染。
 *
 * 无 Chromium 时 live 用例 SKIP，不红 CI。
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  COLLECT_INTERACTIVE_EXPRESSION,
  formatActionableSnapshot,
  type InteractiveElement,
} from '../src/engine/interactive-snapshot.ts';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';

const METRICS = { title: 'Doc', url: 'https://doc.test/a', htmlBytes: 100, textChars: 20 };

describe('snapshot disclosure state (TF-0107)', () => {
  it('渲染 expanded / controls，且顺序稳定', () => {
    const items: InteractiveElement[] = [
      { ref: 'e1', tag: 'button', role: 'button', name: 'Billing Address', expanded: false, controls: 'sect2' },
      { ref: 'e2', tag: 'button', role: 'button', name: 'Personal Information', expanded: true, controls: 'sect1' },
    ];
    const text = formatActionableSnapshot(METRICS, items);
    expect(text).toContain('button | "Billing Address" | expanded=false | controls=sect2');
    expect(text).toContain('button | "Personal Information" | expanded=true | controls=sect1');
  });

  it('没有 ARIA 状态的元素行与改动前**逐字节一致**', () => {
    const plain: InteractiveElement[] = [
      { ref: 'e1', tag: 'button', role: 'button', name: 'Buy' },
      { ref: 'e2', tag: 'input', role: 'textbox', name: 'Email', value: 'a@b.c' },
      { ref: 'e3', tag: 'a', role: 'link', name: 'Home', href: '/' },
      { ref: 'e4', tag: 'button', role: 'button', name: 'Submit', disabled: true },
    ];
    const text = formatActionableSnapshot(METRICS, plain);
    expect(text).toContain('- [e1] button | "Buy" | sel=[data-vb-ref="e1"]');
    expect(text).toContain('- [e2] textbox | "Email" | value="a@b.c" | sel=[data-vb-ref="e2"]');
    expect(text).toContain('- [e3] link | "Home" | href=/ | sel=[data-vb-ref="e3"]');
    expect(text).toContain('- [e4] button | "Submit" | disabled | sel=[data-vb-ref="e4"]');
    expect(text).not.toContain('expanded');
    expect(text).not.toContain('controls');
  });

  it('采集表达式读取 aria-expanded / aria-controls', () => {
    expect(COLLECT_INTERACTIVE_EXPRESSION).toContain('aria-expanded');
    expect(COLLECT_INTERACTIVE_EXPRESSION).toContain('aria-controls');
  });

  it('live：agent 能直接从快照看出哪个控件是收起的，点击后 diff 报出状态翻转', async () => {
    let api: AgentBrowserHostApi | null = null;
    try {
      api = await createPlaywrightHostApi();
    } catch {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const PAGE = `data:text/html,${encodeURIComponent(`<!doctype html><html><head><title>Acc</title></head><body>
      <button id="b1" aria-expanded="true" aria-controls="sect1">Personal Information</button>
      <div id="sect1" role="region">Name: Email:</div>
      <button id="b2" aria-expanded="false" aria-controls="sect2">Billing Address</button>
      <div id="sect2" role="region" hidden>Address 1: City: Zip Code:</div>
      <script>
        for (const id of ['b1','b2']) {
          const b = document.getElementById(id);
          b.addEventListener('click', () => {
            const next = b.getAttribute('aria-expanded') !== 'true';
            b.setAttribute('aria-expanded', String(next));
            document.getElementById(b.getAttribute('aria-controls')).hidden = !next;
          });
        }
      </script>
    </body></html>`)}`;

    const root = await mkdtemp(join(tmpdir(), 'vb-aria-'));
    const facade = new AgentBrowserFacade({ api, evidenceRoot: root });
    const opened = await facade.open({ url: PAGE, mode: 'headless' });
    const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;
    expect(sessionId).toBeTruthy();

    try {
      const before = await facade.snapshot(sessionId, { diff: true });
      const beforeText = String(before.content);
      // 核心验收点：收起项在快照里**直接可读**，不需要读正文源码、也不需要先点
      expect(beforeText).toContain('button | "Billing Address" | expanded=false | controls=sect2');
      expect(beforeText).toContain('button | "Personal Information" | expanded=true | controls=sect1');

      // 结构化 items 也带上状态，供 diff 使用
      const items = (before.data as { items?: unknown }).items;
      expect(Array.isArray(items) || items === undefined).toBe(true);

      const clicked = await facade.click(sessionId, '[data-vb-ref="e2"]');
      expect(clicked.ok).toBe(true);

      const after = await facade.snapshot(sessionId, { diff: true });
      const afterText = String(after.content);
      expect(afterText).toContain('button | "Billing Address" | expanded=true | controls=sect2');
      // 状态翻转应报为 state，而不是 added/removed（同一个元素，只是状态变了）
      expect(afterText).toMatch(/- state: button \| "Billing Address" expanded false -> true/u);
      expect(afterText).not.toContain('added: button | "Billing Address"');
      expect(afterText).not.toContain('removed: button | "Billing Address"');
    } finally {
      await facade.close(sessionId).catch(() => undefined);
    }
  }, 60_000);
});
