/**
 * TF-0095: verify_flow 的 network 判词必须针对「被验页面」，而不是整个会话历史。
 *
 * 真实使用复现（2026-09-30）：同一会话里先访问两个 404 目标，再访问健康页面，
 * verify 仍判 FAIL，失败列表里是先前两页的 404。
 * 负例同样重要：**当前页自身**的 404/5xx 必须继续 FAIL，不能把闸修松。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';
import type { VerifyReport } from '../src/contracts/index.ts';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type Row = { id: string; url: string; method: string; status?: number; failed?: boolean; error?: string };

/**
 * Host stub whose request list is mutated by navigation, so "before nav" and
 * "during nav" rows are distinguishable — exactly the ordering a real driver has.
 */
function createNavAwareApi() {
  const state = {
    requests: [] as Row[],
    consoleLines: [] as string[],
    seq: 0,
    closed: 0,
    /** Simulate a host that only keeps the most recent N rows (200 in practice). */
    cap: 0,
    /** Requests recorded while navigating to this URL (simulates the page's own traffic). */
    onNav: new Map<string, Row[]>(),
    /** Console lines emitted while navigating to this URL. */
    onNavConsole: new Map<string, string[]>(),
  };
  const api = {
    waitForSelector: async () => ({ success: true }),
    getConsoleMessages: async () => ({ success: true, content: state.consoleLines.join('\n') }),
    networkListRequests: async () => ({
      success: true,
      requests: state.cap > 0 ? state.requests.slice(-state.cap) : [...state.requests],
    }),
    navigate: async ({ url }: { url: string }) => {
      for (const row of state.onNav.get(url) ?? []) state.requests.push(row);
      for (const line of state.onNavConsole.get(url) ?? []) state.consoleLines.push(line);
      return { success: true, session: { id: 's-mock', url } };
    },
    screenshot: async () => ({
      success: true,
      dataUrl: PNG_1PX,
      format: 'png',
      session: { id: 's-mock' },
    }),
    evaluate: async () => ({ success: true, value: undefined, session: { id: 's-mock' } }),
    close: async () => {
      state.closed += 1;
      return { success: true };
    },
    note: async () => undefined,
  };
  return { api: api as unknown as AgentBrowserHostApi, state };
}

function row(seq: number, url: string, status: number): Row {
  return { id: `n-${seq}`, url, method: 'GET', status, failed: status >= 400 };
}

async function createFacade(api: AgentBrowserHostApi): Promise<AgentBrowserFacade> {
  const root = await mkdtemp(join(tmpdir(), 'vb-netbaseline-'));
  return new AgentBrowserFacade({ api, evidenceRoot: root });
}

function asReport(result: { data?: unknown }): VerifyReport {
  return result.data as VerifyReport;
}

describe('verify_flow network baseline (TF-0095)', () => {
  let facade: AgentBrowserFacade | undefined;

  afterEach(async () => {
    if (facade) {
      await facade.close('s-mock').catch(() => undefined);
      facade = undefined;
    }
  });

  it('多页会话：先前页面的 404 不再左右当前页判词', async () => {
    const { api, state } = createNavAwareApi();
    facade = await createFacade(api);

    // 先访问一个会 404 的目标（这些请求在窗口之外）。
    state.onNav.set('https://example.test/missing', [row(1, 'https://example.test/missing', 404)]);
    await facade.nav('s-mock', 'https://example.test/missing');

    // 再访问健康页面。
    await facade.nav('s-mock', 'https://example.test/healthy');

    const result = await facade.verifyFlow({ sessionId: 's-mock', selectors: [], screenshot: false });
    const report = asReport(result);

    expect(report.outcome).toBe('pass');
    expect(report.ok).toBe(true);
    expect(report.networkFailures.count).toBe(0);
    expect(report.networkFailures.baseline).toBe(1);
    expect(report.collection.notes.join('\n')).toContain('verdict scoped to the current page');
  });

  it('console 同口径：先前页面的报错不再是当前页的失败', async () => {
    const { api, state } = createNavAwareApi();
    facade = await createFacade(api);

    state.onNavConsole.set('https://example.test/noisy', [
      "[error] TypeError: boom at https://example.test/noisy.js:1:1",
    ]);
    await facade.nav('s-mock', 'https://example.test/noisy');
    await facade.nav('s-mock', 'https://example.test/clean');

    const report = asReport(
      await facade.verifyFlow({ sessionId: 's-mock', selectors: [], screenshot: false }),
    );

    expect(report.consoleDiff.newErrors).toEqual([]);
    expect(report.consoleDiff.baselineCount).toBe(1);
    expect(report.outcome).toBe('pass');
  });

  it('console 当前页的报错仍然 FAIL', async () => {
    const { api, state } = createNavAwareApi();
    facade = await createFacade(api);

    await facade.nav('s-mock', 'https://example.test/first');
    state.onNavConsole.set('https://example.test/broken', [
      '[error] ReferenceError: nope at https://example.test/broken.js:2:3',
    ]);
    await facade.nav('s-mock', 'https://example.test/broken');

    const report = asReport(
      await facade.verifyFlow({ sessionId: 's-mock', selectors: [], screenshot: false }),
    );

    expect(report.consoleDiff.newErrors).toHaveLength(1);
    expect(report.outcome).toBe('fail');
  });

  it('当前页自身的 404 仍然 FAIL（闸不得修松）', async () => {
    const { api, state } = createNavAwareApi();
    facade = await createFacade(api);

    state.onNav.set('https://example.test/first', [row(1, 'https://example.test/first', 404)]);
    await facade.nav('s-mock', 'https://example.test/first');

    // 第二次导航期间新页面自己产生 404 → 必须留在窗口内。
    state.onNav.set('https://example.test/broken', [row(2, 'https://example.test/broken', 500)]);
    await facade.nav('s-mock', 'https://example.test/broken');

    const result = await facade.verifyFlow({ sessionId: 's-mock', selectors: [], screenshot: false });
    const report = asReport(result);

    expect(report.outcome).toBe('fail');
    expect(report.networkFailures.count).toBe(1);
    expect(report.networkFailures.failures[0]?.url).toBe('https://example.test/broken');
  });

  it('无导航的会话仍是全量口径（open → verify）', async () => {
    const { api, state } = createNavAwareApi();
    facade = await createFacade(api);
    state.requests.push(row(1, 'https://example.test/opened', 404));

    const result = await facade.verifyFlow({ sessionId: 's-mock', selectors: [], screenshot: false });
    const report = asReport(result);

    expect(report.outcome).toBe('fail');
    expect(report.networkFailures.count).toBe(1);
    expect(report.networkFailures.baseline).toBeUndefined();
  });

  it('显式 baselineNetworkCount 覆盖导航水位（0 = 看整个会话）', async () => {
    const { api, state } = createNavAwareApi();
    facade = await createFacade(api);
    state.onNav.set('https://example.test/first', [row(1, 'https://example.test/first', 404)]);
    await facade.nav('s-mock', 'https://example.test/first');
    await facade.nav('s-mock', 'https://example.test/healthy');

    const scoped = asReport(
      await facade.verifyFlow({ sessionId: 's-mock', selectors: [], screenshot: false }),
    );
    expect(scoped.outcome).toBe('pass');

    const whole = asReport(
      await facade.verifyFlow({
        sessionId: 's-mock',
        selectors: [],
        screenshot: false,
        baselineNetworkCount: 0,
      }),
    );
    expect(whole.outcome).toBe('fail');
    expect(whole.networkFailures.count).toBe(1);
  });

  it('锚点本身被淘汰时退回全量并标注（宁可多报也不静默放行）', async () => {
    const { api, state } = createNavAwareApi();
    facade = await createFacade(api);
    state.requests.push({ id: 'n-seed', url: 'https://example.test/seed', method: 'GET', status: 200 });
    await facade.nav('s-mock', 'https://example.test/first');

    // 模拟 recorder 淘汰：连锚点 'n-seed' 都不在了。
    state.requests = [row(50, 'https://example.test/newer', 500)];

    const report = asReport(
      await facade.verifyFlow({ sessionId: 's-mock', selectors: [], screenshot: false }),
    );
    expect(report.outcome).toBe('fail');
    expect(report.networkFailures.failures[0]?.url).toBe('https://example.test/newer');
    expect(report.networkFailures.baselineMissing).toBe(true);
    expect(report.collection.notes.join('\n')).toContain('evicted');
  });

  it('列表被宿主削平（锚点仍在）时，当前页的 404 仍必须 FAIL —— 防假 PASS', async () => {
    const { api, state } = createNavAwareApi();
    facade = await createFacade(api);
    // 宿主上限 200：先塞满，让"列表长度"饱和
    state.cap = 200;
    state.requests = Array.from({ length: 199 }, (_, index) => ({
      id: `n-old-${index + 1}`,
      url: `https://example.test/old/${index + 1}`,
      method: 'GET',
      status: 200,
    }));
    const anchor = state.requests[state.requests.length - 1];
    if (!anchor) throw new Error('fixture setup failed');

    // 新页面自己产生 3 条请求，其中一条 404；旧行被削掉后列表长度仍是 200。
    state.onNav.set('https://example.test/current', [
      row(1001, 'https://example.test/current', 200),
      row(1002, 'https://example.test/current/api', 404),
      row(1003, 'https://example.test/current/ok', 200),
    ]);
    await facade.nav('s-mock', 'https://example.test/current');

    const capped = state.requests.slice(-200);
    expect(capped.length).toBe(200);
    expect(capped.some((item) => item.id === anchor.id)).toBe(true);

    const report = asReport(
      await facade.verifyFlow({ sessionId: 's-mock', selectors: [], screenshot: false }),
    );

    // 旧实现按「长度计数」切片：baseline=199、length=200 → slice(199) 只剩最后一条 200，
    // 于是当前页的 404 被切掉，判 PASS。锚点法必须仍然看到它。
    expect(report.outcome).toBe('fail');
    expect(report.networkFailures.count).toBe(1);
    expect(report.networkFailures.failures[0]?.url).toBe('https://example.test/current/api');
  });

  it('console 重复同一行时不得把它当成水位吃掉（去重雷区）', async () => {
    const { api, state } = createNavAwareApi();
    facade = await createFacade(api);
    const duplicated = '[error] Failed to load resource: the server responded with a status of 404 ()';
    state.onNavConsole.set('https://example.test/first', [duplicated]);
    await facade.nav('s-mock', 'https://example.test/first');

    // 新页面产生一条**文本完全相同**的报错（真实 Playwright 的 404 文本就是这样）。
    state.onNavConsole.set('https://example.test/second', [duplicated]);
    await facade.nav('s-mock', 'https://example.test/second');

    const report = asReport(
      await facade.verifyFlow({ sessionId: 's-mock', selectors: [], screenshot: false }),
    );
    expect(report.consoleDiff.newErrors).toHaveLength(1);
    expect(report.outcome).toBe('fail');
  });

  it('console 锚点被淘汰时退回全量并标注', async () => {
    const { api, state } = createNavAwareApi();
    facade = await createFacade(api);
    state.consoleLines.push('[log] page A chatter');
    await facade.nav('s-mock', 'https://example.test/first');

    // 宿主淘汰了旧行（锚点行不见了）。
    state.consoleLines = ['[error] ReferenceError: boom at https://example.test/x.js:1:1'];

    const report = asReport(
      await facade.verifyFlow({ sessionId: 's-mock', selectors: [], screenshot: false }),
    );
    expect(report.consoleDiff.newErrors).toHaveLength(1);
    expect(report.consoleDiff.watermarkMissing).toBe(true);
    expect(report.outcome).toBe('fail');
  });

  it('failed close retains the baseline for a still-active session', async () => {
    const { api, state } = createNavAwareApi();
    facade = await createFacade(api);
    state.consoleLines.push('[error] old page error');
    state.requests.push(row(1, 'https://example.test/old', 404));
    await facade.nav('s-mock', 'https://example.test/healthy');
    api.close = async () => ({ success: false, error: 'close refused' });
    expect((await facade.close('s-mock')).error?.code).toBe('E_CLOSE');
    expect(asReport(await facade.verifyFlow({ sessionId: 's-mock', selectors: [], screenshot: false })).outcome).toBe('pass');
  });
});
