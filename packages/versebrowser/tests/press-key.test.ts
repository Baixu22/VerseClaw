/**
 * TF-0113：键盘输入原语 `vb_press`。
 *
 * 背景：`vb_type` 只填字段、**不按键**，而 MCP 面上原本没有任何按键工具 ——
 * 「按 Enter 提交」的表单与键盘驱动的部件（roving tabindex 菜单/标签页、Escape 关弹窗、
 * 方向键选择）**完全无法驱动**。引擎里其实早有 `press_key` 动作与
 * `service.pressKey`，只是薄驱动返回 `notImplemented` 且没有工具接线。
 *
 * 这里钉住：合法键可发送、非法键被拒（不是静默无操作）、别名/大小写可接受、
 * 聚焦 selector 生效。无 Chromium 时 SKIP，不红 CI。
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeKeyName, KeyNotAllowedError } from '../src/engine/playwright-host-api.ts';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';

it('does not report success when the host refuses a key', async () => {
  const facade = new AgentBrowserFacade({ api: { pressKey: async () => ({ success: false, error: 'host refused key' }) } as unknown as AgentBrowserHostApi });
  const result = await facade.pressKey('host-session', 'Enter');
  expect(result.ok).toBe(false);
  expect(result.error?.message).toContain('host refused key');
});

const FORM = `data:text/html,${encodeURIComponent(`<!doctype html><html><head><title>EnterForm</title></head><body>
<form id="f"><input id="q" name="q" placeholder="query"><span id="out">not submitted</span></form>
<script>
  const input = document.getElementById('q');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('out').textContent = 'SUBMITTED';
    if (e.key === 'Escape') document.getElementById('out').textContent = 'ESCAPED';
  });
</script>
</body></html>`)}`;

describe('key allow-list (TF-0113)', () => {
  it('接受审查过的键，并规范化别名与大小写', () => {
    expect(normalizeKeyName('Enter')).toBe('Enter');
    expect(normalizeKeyName('enter')).toBe('Enter');
    expect(normalizeKeyName('Esc')).toBe('Escape');
    expect(normalizeKeyName('Spacebar')).toBe('Space');
    expect(normalizeKeyName('ctrl+a')).toBe('Control+A');
    expect(normalizeKeyName('Shift+Tab')).toBe('Shift+Tab');
  });

  it('拒绝未审查的键（含注入尝试），不是静默丢弃', () => {
    for (const bad of ['F13', 'KeyA', 'Enter;rm -rf /', '', '   ', 'Control+Shift+Delete']) {
      expect(() => normalizeKeyName(bad), `expected ${JSON.stringify(bad)} to be rejected`).toThrow(
        KeyNotAllowedError,
      );
    }
  });
});

describe('vb_press drives Enter-submit (TF-0113)', () => {
  it('type 不提交，press Enter 提交；非法键返回 E_KEY_NOT_ALLOWED', async () => {
    let api;
    try {
      api = await createPlaywrightHostApi();
    } catch {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const root = await mkdtemp(join(tmpdir(), 'vb-press-'));
    const facade = new AgentBrowserFacade({ api, evidenceRoot: root });
    const opened = await facade.open({ url: FORM, mode: 'headless' });
    const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;
    expect(sessionId).toBeTruthy();

    try {
      const snap = await facade.snapshot(sessionId);
      const ref = /\[(e\d+)\] textbox/u.exec(String(snap.content))?.[1] as string;
      expect(ref).toBeTruthy();

      const typed = await facade.type(sessionId, `[data-vb-ref="${ref}"]`, 'hello');
      expect(typed.ok).toBe(true);
      // type 只填字段，不按键 —— 这正是缺口所在
      const afterType = await facade.extractPageText({ sessionId, maxLength: 500 });
      expect(String(afterType.content)).not.toContain('SUBMITTED');

      const pressed = await facade.pressKey(sessionId, 'Enter');
      expect(pressed.ok).toBe(true);
      const afterPress = await facade.extractPageText({ sessionId, maxLength: 500 });
      expect(String(afterPress.content)).toContain('SUBMITTED');

      // 非法键：必须是明确错误，不能"成功了但什么都没发生"
      const bad = await facade.pressKey(sessionId, 'F13');
      expect(bad.ok).toBe(false);
      expect(bad.error?.code).toBe('E_KEY_NOT_ALLOWED');
    } finally {
      await facade.close(sessionId).catch(() => undefined);
    }
  }, 60_000);

  it('按 Escape 可关闭/取消（键盘驱动部件的基本能力）', async () => {
    let api;
    try {
      api = await createPlaywrightHostApi();
    } catch {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const root = await mkdtemp(join(tmpdir(), 'vb-press-esc-'));
    const facade = new AgentBrowserFacade({ api, evidenceRoot: root });
    const opened = await facade.open({ url: FORM, mode: 'headless' });
    const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;

    try {
      const esc = await facade.pressKey(sessionId, 'Escape', '#q');
      expect(esc.ok).toBe(true);
      const text = await facade.extractPageText({ sessionId, maxLength: 500 });
      expect(String(text.content)).toContain('ESCAPED');
    } finally {
      await facade.close(sessionId).catch(() => undefined);
    }
  }, 60_000);
});
