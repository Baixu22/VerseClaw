/**
 * TF-0101：一次调用同时拿"交互项 + 预算内正文"（`vb_snapshot { includeText }`）。
 *
 * 真实任务里模型为读正文额外花了往返（snapshot ×3 + page_text ×2）；这个开关把
 * "看一眼并读一段"合成一次调用。**默认输出保持逐字节不变**——既有快照读数
 * （例如可点击发现的 790/842 字符）不能被顺手改掉。
 * 无 Chromium 时 live 用例 SKIP，不红 CI。
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import { renderToolResultForTool } from '../src/mcp/result-envelope.ts';
import { PLAYWRIGHT_DRIVER_METHODS, type DriverProfile } from '../src/engine/driver-profile.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';

const SENTENCE =
  'Minification is the process of removing all unnecessary characters from the source code without changing its functionality.';

const PAGE = `data:text/html,${encodeURIComponent(`<!doctype html>
<html><body>
  <h1 id="ok">Doc</h1>
  <p id="lead">${SENTENCE}</p>
</body></html>`)}`;

async function tryLiveFacade(): Promise<AgentBrowserFacade | null> {
  try {
    const api: AgentBrowserHostApi = await createPlaywrightHostApi();
    const root = await mkdtemp(join(tmpdir(), 'vb-observe-'));
    return new AgentBrowserFacade({ api, evidenceRoot: root });
  } catch {
    return null;
  }
}

function stubApi(): AgentBrowserHostApi {
  const base = {
    takeSnapshot: async () => ({
      success: true,
      snapshot:
        '# snapshot\n- title: stub\n- url: data:text/html,\n\n## Interactive (0)\n- (none observed)\n\n## Metrics\n- html_bytes: 42\n- text_chars: 7',
    }),
    close: async () => ({ success: true }),
    note: async () => undefined,
  };
  return base as unknown as AgentBrowserHostApi;
}

describe('vb_snapshot includeText (TF-0101)', () => {
  it('默认输出不变；开启后同一次调用带回正文，且遵守 textChars 预算', async () => {
    const facade = await tryLiveFacade();
    if (!facade) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const opened = await facade.open({ url: PAGE, mode: 'headless' });
    const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;
    expect(sessionId).toBeTruthy();

    try {
      const plain = await facade.snapshot(sessionId);
      expect(plain.ok).toBe(true);
      expect(String(plain.content)).toContain('## Interactive');
      expect(String(plain.content)).not.toContain('## Text');
      expect((plain.data as { text?: unknown }).text).toBeUndefined();

      const withText = await facade.snapshot(sessionId, { includeText: true, textChars: 2_000 });
      expect(withText.ok).toBe(true);
      expect(String(withText.content)).toContain('## Text (');
      expect(String(withText.content)).toContain('unnecessary characters');
      const data = withText.data as { text?: { chars: number; truncated: boolean } };
      expect(data.text?.truncated).toBe(false);
      expect(data.text?.chars).toBeGreaterThan(50);

      // 预算是硬上限：给一个比页面正文更小的值，必须截断并如实标注。
      const tiny = await facade.snapshot(sessionId, { includeText: true, textChars: 60 });
      const tinyData = tiny.data as { text?: { chars: number; truncated: boolean } };
      expect(tinyData.text?.truncated).toBe(true);
      expect(tinyData.text?.chars).toBeLessThanOrEqual(60);
    } finally {
      await facade.close(sessionId).catch(() => undefined);
    }
  }, 60_000);

  it('驱动不提供 extractPageText 时明确说"unavailable"，不静默漏掉正文', async () => {
    const methods = new Set([...PLAYWRIGHT_DRIVER_METHODS].filter((m) => m !== 'extractPageText'));
    const driverProfile: DriverProfile = { kind: 'playwright', methods };
    const root = await mkdtemp(join(tmpdir(), 'vb-observe-stub-'));
    const facade = new AgentBrowserFacade({ api: stubApi(), driverProfile, evidenceRoot: root });

    const result = await facade.snapshot('s-stub', { includeText: true });
    expect(result.ok).toBe(true);
    expect(String(result.content)).toContain('## Interactive');
    expect(String(result.content)).toContain('unavailable: this driver does not serve extractPageText');
    expect((result.data as { textUnavailable?: boolean }).textUnavailable).toBe(true);
    expect((result.data as { text?: unknown }).text).toBeUndefined();
  });

  /**
   * OBS-03 / TF-0109：`## Since last snapshot` 必须排在 `## Text` **之前**。
   *
   * 模型侧信封把 content 限制在 12,000 字符并从**尾部**截断，而 facade 最多组装
   * 8,000（交互）+ 20,000（正文）。当 diff 追加在最后时，`includeText` + `diff` 一起用
   * 会把「变了什么」整段挤出模型上下文 —— 而那正是用来省掉整页重读的东西。
   */
  it('diff 段排在正文之前，因此大 textChars 下不会被信封从尾部截掉', async () => {
    const methods = new Set([...PLAYWRIGHT_DRIVER_METHODS]);
    const driverProfile: DriverProfile = { kind: 'playwright', methods };
    const longText = 'x'.repeat(30_000);
    const snap = (title: string, bytes: number, count: number): string =>
      [
        '# snapshot',
        `- title: ${title}`,
        '- url: https://doc.test/a',
        '',
        `## Interactive (${count})`,
        '- (see items)',
        '',
        '## Metrics',
        `- html_bytes: ${bytes}`,
        '- text_chars: 10',
      ].join('\n');
    const stub = {
      takeSnapshot: async () => ({
        success: true,
        snapshot: snap('Doc', 100, 1),
        items: [{ ref: 'e1', role: 'button', name: 'Buy' }],
      }),
      extractPageText: async () => ({ success: true, text: longText, truncated: false, usedFallback: false }),
      close: async () => ({ success: true }),
      note: async () => undefined,
    } as unknown as AgentBrowserHostApi;
    const root = await mkdtemp(join(tmpdir(), 'vb-order-'));
    const facade = new AgentBrowserFacade({ api: stub, driverProfile, evidenceRoot: root });

    // 第一次建立基线
    await facade.snapshot('s-order', { includeText: true, textChars: 20_000 });
    const second = await facade.snapshot('s-order', { includeText: true, textChars: 20_000, diff: true });
    const content = String(second.content);

    const diffAt = content.indexOf('## Since last snapshot');
    const textAt = content.indexOf('## Text');
    expect(diffAt).toBeGreaterThan(-1);
    expect(textAt).toBeGreaterThan(-1);
    expect(diffAt).toBeLessThan(textAt);

    // 经模型侧信封渲染后，diff 必须仍然在（正文可以是被截断的那部分）
    const rendered = renderToolResultForTool('vb_snapshot', second);
    expect(rendered).toContain('## Since last snapshot');
  });
});
