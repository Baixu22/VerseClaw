/**
 * 默认 playwright 驱动：snapshot 可操作，clickByUid/fillByUid 可用。
 * 无 Chromium 时 SKIP，不红 CI。
 */
import { describe, expect, it } from 'vitest';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';

const PAGE = `data:text/html,${encodeURIComponent(`<!doctype html>
<html><body>
  <h1 id="ok">Checkout</h1>
  <label for="email">Email</label>
  <input id="email" type="email" placeholder="you@example.com" />
  <button id="buy" type="button">Buy now</button>
  <a href="#home">Home</a>
</body></html>`)}`;

async function tryApi() {
  try {
    return await createPlaywrightHostApi();
  } catch {
    return null;
  }
}

describe('playwright actionable snapshot + by-ref actions', () => {
  it('snapshot exposes refs and clickByUid/fillByUid work', async () => {
    const api = await tryApi();
    if (!api) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }

    const opened = await api.open({ url: PAGE, mode: 'headless' });
    expect(opened.success).toBe(true);
    const sessionId = opened.session.id;

    try {
      const snap = await api.takeSnapshot({ sessionId });
      expect(snap.success).toBe(true);
      const text = snap.snapshot;
      expect(text).toContain('## Interactive');
      expect(text).toMatch(/sel=\[data-vb-ref="e\d+"\]/u);
      expect(text).toMatch(/button \| "Buy now"/u);
      expect(text).toMatch(/textbox/u);

      const buy = /- \[(e\d+)\] button \| "Buy now"/u.exec(text);
      const email = /- \[(e\d+)\] textbox/u.exec(text);
      expect(buy?.[1]).toBeTruthy();
      expect(email?.[1]).toBeTruthy();

      // fill email via ref, click buy via ref — no CSS guessing
      const filled = await api.fillByUid({
        sessionId,
        uid: email![1]!,
        value: 'buyer@test.com',
        clear: true,
      });
      expect(filled.success).toBe(true);

      const clicked = await api.clickByUid({ sessionId, uid: buy![1]! });
      expect(clicked.success).toBe(true);

      const value = await api.evaluate({
        sessionId,
        expression: `document.querySelector('[data-vb-ref="${email![1]}"]').value`,
      });
      expect(value.success).toBe(true);
      expect(String(value.value)).toBe('buyer@test.com');

      // second snapshot rebinds refs (no stale uid crash after retake)
      const snap2 = await api.takeSnapshot({ sessionId });
      expect(snap2.success).toBe(true);
      expect(snap2.snapshot).toContain('## Interactive');
    } finally {
      await Promise.resolve(api.close({ sessionId })).catch(() => undefined);
    }
  }, 30_000);

  it('TF-0092：可点击元素发现规则默认关、开启后能点到 cursor:pointer 的非语义元素', async () => {
    const api = await tryApi();
    if (!api) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }

    const page = `data:text/html,${encodeURIComponent(`<!doctype html>
<html><body>
  <span id="link" class="alink">Neque</span>
  <span id="deco">Vel</span>
  <button id="btn" type="button">Go</button>
  <style>.alink { cursor: pointer; }</style>
  <script>
    document.getElementById('link').addEventListener('click', function () { window.__clicked = 'Neque'; });
  </script>
</body></html>`)}`;

    const opened = await api.open({ url: page, mode: 'headless' });
    expect(opened.success).toBe(true);
    const sessionId = opened.session.id;
    const previous = process.env.VERSEBROWSER_SNAPSHOT_CLICKABLE;
    try {
      delete process.env.VERSEBROWSER_SNAPSHOT_CLICKABLE;
      const off = await api.takeSnapshot({ sessionId });
      expect(off.success).toBe(true);
      // 默认不收录非语义元素（既有快照面不变）
      expect(off.snapshot).not.toContain('"Neque"');
      expect(off.snapshot).toMatch(/button \| "Go"/u);

      process.env.VERSEBROWSER_SNAPSHOT_CLICKABLE = 'pointer';
      const on = await api.takeSnapshot({ sessionId });
      expect(on.success).toBe(true);
      // 只补 cursor:pointer 的叶子式元素；装饰性 span 不得被收进来
      expect(on.snapshot).toMatch(/clickable \| "Neque"/u);
      expect(on.snapshot).not.toContain('"Vel"');
      expect(on.snapshot.length, '开启后发现规则应让快照变长（受上限约束）').toBeGreaterThan(off.snapshot.length);

      // 用发现到的 ref 直接点击，证明整条链（发现→定位→动作）真的可用
      const ref = /- \[(e\d+)\] clickable \| "Neque"/u.exec(on.snapshot)?.[1];
      expect(ref).toBeTruthy();
      const clicked = await api.clickByUid({ sessionId, uid: ref! });
      expect(clicked.success).toBe(true);
      const fired = await api.evaluate({ sessionId, expression: 'window.__clicked' });
      expect(String(fired.value)).toBe('Neque');

      // 读数（供 C49 登记）：同一受控页面的快照字符数与元素条数
      const count = (text: string): number => (text.match(/^- \[e\d+\]/gmu) ?? []).length;
      console.log(
        `snapshot discovery readings — off: ${off.snapshot.length} chars / ${count(off.snapshot)} items；` +
          `pointer: ${on.snapshot.length} chars / ${count(on.snapshot)} items`,
      );
      expect(count(off.snapshot)).toBe(1);
      expect(count(on.snapshot)).toBe(2);
    } finally {
      if (previous === undefined) delete process.env.VERSEBROWSER_SNAPSHOT_CLICKABLE;
      else process.env.VERSEBROWSER_SNAPSHOT_CLICKABLE = previous;
      await Promise.resolve(api.close({ sessionId })).catch(() => undefined);
    }
  }, 30_000);
});
