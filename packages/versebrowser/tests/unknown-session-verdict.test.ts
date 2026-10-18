/**
 * TF-0118：会话级错误不得伪装成页面判词。
 *
 * 背景：未知 session 时，`verify_flow` / `vb_errors` / `vb_diagnose_page` /
 * `vb_record_start` 都返回 **`ok: true`**，其中 verify 的判词是 `# verify_flow FAIL` ——
 * 与「页面真的坏了」在首行**完全相同**：
 *
 *   真实坏页   : ok=true  首行=# verify_flow FAIL
 *   会话不存在 : ok=true  首行=# verify_flow FAIL
 *
 * 而兄弟工具（snapshot / click / network_* / wait…）都返回 `ok: false` + 错误码。
 * 判词是产品的主输出（CLI 退出码绑定它），把「什么都没观察到」算成「页面失败」
 * 会让调用方去追一个不存在的 bug。
 *
 * 修法：会话存在性检查前置，返回 `E_NO_SESSION`；驱动无法回答时（无 `status`）保持原行为。
 * 无 Chromium 时 live 用例 SKIP，不红 CI。
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';

const PAGE = `data:text/html,${encodeURIComponent('<!doctype html><html><head><title>T</title></head><body><h1>ok</h1></body></html>')}`;

async function live(): Promise<{ facade: AgentBrowserFacade; sessionId: string } | null> {
  let api;
  try {
    api = await createPlaywrightHostApi();
  } catch {
    return null;
  }
  const root = await mkdtemp(join(tmpdir(), 'vb-nosession-'));
  const facade = new AgentBrowserFacade({ api, evidenceRoot: root });
  const opened = await facade.open({ url: PAGE, mode: 'headless' });
  const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;
  if (!sessionId) return null;
  return { facade, sessionId };
}

describe('unknown session is an operational error, not a page verdict (TF-0118)', () => {
  it('verify_flow 对未知 session 返回 ok:false + E_NO_SESSION，且不产生 FAIL 判词', async () => {
    const ctx = await live();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const { facade, sessionId } = ctx;
    try {
      const result = await facade.verifyFlow({ sessionId: 'no-such-session', selectors: ['#x'], screenshot: false });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('E_NO_SESSION');
      expect(String(result.content)).toContain('unknown session');
      // 关键：不得出现页面级判词
      expect(String(result.content)).not.toContain('verify_flow FAIL');
      expect((result.data as { outcome?: string } | undefined)?.outcome).toBeUndefined();
    } finally {
      await facade.close(sessionId).catch(() => undefined);
    }
  }, 60_000);

  it('「页面真坏了」与「会话不存在」可以区分', async () => {
    const ctx = await live();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const { facade, sessionId } = ctx;
    try {
      // 真实页面上的真失败：selector 找不到 → 仍应 ok:true + FAIL 判词
      const broken = await facade.verifyFlow({ sessionId, selectors: ['#definitely-missing'], screenshot: false });
      expect(String(broken.content)).toContain('verify_flow FAIL');
      expect((broken.data as { outcome?: string }).outcome).toBe('fail');

      const missing = await facade.verifyFlow({ sessionId: 'no-such-session', selectors: ['#definitely-missing'], screenshot: false });
      // 两者必须可区分
      expect(missing.ok).toBe(false);
      expect(String(missing.content)).not.toContain('verify_flow FAIL');
      expect(missing.error?.code).toBe('E_NO_SESSION');
    } finally {
      await facade.close(sessionId).catch(() => undefined);
    }
  }, 60_000);

  it('record_start 不再为不存在的会话报告「已开始录制」', async () => {
    const ctx = await live();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const { facade, sessionId } = ctx;
    try {
      const started = await facade.recordStart('no-such-session', { dirName: 'tf0118' });
      expect(started.ok).toBe(false);
      expect(started.error?.code).toBe('E_NO_SESSION');
      expect(String(started.content)).not.toContain('recording started');
    } finally {
      await facade.close(sessionId).catch(() => undefined);
    }
  }, 60_000);

  it('健康页面仍然 PASS（修复不得把正常判词也挡掉）', async () => {
    const ctx = await live();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const { facade, sessionId } = ctx;
    try {
      const ok = await facade.verifyFlow({ sessionId, selectors: ['h1'], screenshot: false });
      expect(ok.ok).toBe(true);
      expect(String(ok.content)).toContain('verify_flow PASS');
      expect((ok.data as { outcome?: string }).outcome).toBe('pass');
    } finally {
      await facade.close(sessionId).catch(() => undefined);
    }
  }, 60_000);

  it('驱动无法回答存在性时（无 status）保持原行为，不误伤 stub/host 驱动', async () => {
    // 与 tests/verify-collection-integrity.test.ts 同形的 stub：没有 status 方法
    const stub = {
      waitForSelector: async () => ({ success: true }),
      networkListRequests: async () => ({ success: true, requests: [] }),
      getConsoleMessages: async () => ({ success: true, content: '' }),
      screenshot: async () => ({
        success: true,
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        format: 'png',
        session: { id: 's-mock' },
      }),
      evaluate: async () => ({ success: true, value: undefined, session: { id: 's-mock' } }),
      close: async () => ({ success: true }),
      note: async () => undefined,
    } as unknown as AgentBrowserHostApi;
    const root = await mkdtemp(join(tmpdir(), 'vb-nosession-stub-'));
    const facade = new AgentBrowserFacade({ api: stub, evidenceRoot: root });

    const result = await facade.verifyFlow({ sessionId: 's-mock', screenshot: false });
    // 没有 E_NO_SESSION 信号 → 不能假设会话不存在 → 走原有采集路径（此处两个通道都 ok）
    expect(result.ok).toBe(true);
    expect(String(result.content)).toContain('# verify_flow PASS');
  }, 30_000);

  /**
   * 回归防线：探针**不能**基于 `status().sessions`。
   *
   * 新进程里的 `status()` 只列出**本进程已 attach** 的会话，
   * 所以跨进程持久会话（`vb verify --session <id>`，TF-0097）在那个列表里是空的。
   * 我第一版实现正是用 status() 判断，会把**合法会话**误判为不存在 —— 这个用例钉住它。
   */
  it('跨进程持久会话不被误判为不存在（探针不得依赖 status().sessions）', async () => {
    const { createPlaywrightHostApi: create } = await import('../src/engine/playwright-host-api.ts');
    const { AgentBrowserFacade: Facade } = await import('../src/engine/facade.ts');
    const { setWorkspaceRoot } = await import('../src/host/workspace-paths.ts');
    const { rm } = await import('node:fs/promises');
    const { randomUUID } = await import('node:crypto');

    const root = await mkdtemp(join(tmpdir(), `vb-xproc-${randomUUID().slice(0, 8)}-`));
    setWorkspaceRoot(root);
    let apiA: AgentBrowserHostApi | undefined;
    let sid = '';
    try {
      let a;
      try {
        a = await create({ persistent: true });
      } catch {
        console.warn('SKIP: playwright-core / chromium unavailable');
        return;
      }
      apiA = a;
      const facadeA = new Facade({ api: a, evidenceRoot: join(root, 'ev') });
      const opened = await facadeA.open({ url: PAGE, mode: 'headless' });
      sid = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;
      // 带出底层错误：本行在双全量并发的压力下曾失败过一次（2026-10-02，stress-A），
      // 当时只报 "expected undefined to be truthy"，无法区分是 launch 失败还是持久会话记录没写成。
      expect(
        sid,
        `persistent open did not return a session: ok=${opened.ok} error=${JSON.stringify(opened.error)}`,
      ).toBeTruthy();

      // 「第二个进程」：全新 api + facade，内存里没有该会话
      const b = await create({ persistent: true });
      const facadeB = new Facade({ api: b, evidenceRoot: join(root, 'ev') });
      // 前提：status() 此时看不到该会话（正是不能用它做判据的原因）
      const statusB = await Promise.resolve(b.status());
      expect(statusB.sessions.some((session) => session.id === sid)).toBe(false);

      // 断言：verify 仍然能驱动该会话，**不得**返回 E_NO_SESSION
      const result = await facadeB.verifyFlow({ sessionId: sid, selectors: ['h1'], screenshot: false });
      expect(result.error?.code).not.toBe('E_NO_SESSION');
      expect(String(result.content)).not.toContain('unknown session');
      // 会话确实可用：采集通道成功
      expect((result.data as { collection?: { overall?: string } } | undefined)?.collection?.overall, JSON.stringify(result)).toBe('ok');
    } finally {
      if (apiA && sid) await Promise.resolve(apiA.close({ sessionId: sid })).catch(() => undefined);
      setWorkspaceRoot(undefined);
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
    }
  }, 90_000);

  /**
   * 2026-10-03 负例回归：`close` 不得对**从未存在**的会话报成功。
   *
   * 旧行为：驱动对任何找不到的 id 都回 `{ success: true }`，于是「id 写错」与「真的关掉了一个会话」
   * 在返回上完全一样——CLI `vb close --session <typo>` 报成功而浏览器仍在跑（本轮实测清理过 85 个
   * 因此泄漏的 ms-playwright 浏览器）。现在的判据：从未见过的 id → `E_NO_SESSION`；
   * **本进程关过的 id** 维持幂等成功（重复 close 不再是错误）。
   */
  it('close 对从未存在的 session 返回 E_NO_SESSION；重复 close 仍成功', async () => {
    const ctx = await live();
    if (!ctx) {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const { facade, sessionId } = ctx;
    try {
      const unknown = await facade.close('vb-never-opened-session');
      expect(unknown.ok).toBe(false);
      expect(unknown.error?.code).toBe('E_NO_SESSION');
      expect(String(unknown.error?.message)).toContain('vb-never-opened-session');

      const first = await facade.close(sessionId);
      expect(first.ok).toBe(true);
      // 幂等：同一个进程里再关一次仍然成功（不能把「重复 close」变成错误）
      const second = await facade.close(sessionId);
      expect(second.ok).toBe(true);
      expect(second.error?.code).toBeUndefined();
    } finally {
      await facade.close(sessionId).catch(() => undefined);
    }
  }, 60_000);
});
