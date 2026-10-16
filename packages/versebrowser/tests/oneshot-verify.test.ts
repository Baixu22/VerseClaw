/**
 * TF-0094（方案 b）：CLI 的一次性 live 闭环 —— 同一个进程里 open → verify → close。
 *
 * 背景：会话只存在于创建它的进程内，`vb open` + `vb verify --session <id>`
 * 两条命令无法接力（实测 `E_SNAPSHOT unknown session`）。这里用真实 facade +
 * 假宿主 api 验证一次性路径**必然关会话**，且失败不会吞掉判词。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { verifyUrlOneShot } from '../src/engine/oneshot-verify.ts';
import { verifyExitCode } from '../src/cli.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';
import type { ToolResult, VerifyReport } from '../src/contracts/index.ts';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type StubOptions = {
  openFails?: boolean;
  openWithoutSession?: boolean;
  closeFails?: boolean;
  requestStatus?: number;
};

function createStubApi(options: StubOptions = {}) {
  const calls = { open: 0, close: 0, navigate: 0 };
  const api = {
    open: async (payload: { url?: string }) => {
      calls.open += 1;
      if (options.openFails) return { success: false, error: 'chromium missing' };
      if (options.openWithoutSession) return { success: true };
      return {
        success: true,
        session: {
          id: 's-oneshot',
          profile: 'standalone',
          mode: 'headless',
          connection: { mode: 'managed' },
          createdAt: '2026-09-30T00:00:00.000Z',
          updatedAt: '2026-09-30T00:00:00.000Z',
          runtimeMode: 'normal_restricted',
          ...(payload.url ? { url: payload.url } : {}),
        },
      };
    },
    waitForSelector: async () => ({ success: true }),
    getConsoleMessages: async () => ({ success: true, content: '' }),
    networkListRequests: async () => ({
      success: true,
      requests:
        options.requestStatus === undefined
          ? []
          : [
              {
                id: 'n-1',
                url: 'https://example.test/page',
                method: 'GET',
                status: options.requestStatus,
                failed: options.requestStatus >= 400,
              },
            ],
    }),
    screenshot: async () => ({
      success: true,
      dataUrl: PNG_1PX,
      format: 'png',
      session: { id: 's-oneshot' },
    }),
    evaluate: async () => ({ success: true, value: undefined, session: { id: 's-oneshot' } }),
    close: async () => {
      calls.close += 1;
      if (options.closeFails) return { success: false, error: 'close refused' };
      return { success: true };
    },
    note: async () => undefined,
  };
  return { api: api as unknown as AgentBrowserHostApi, calls };
}

async function createFacade(api: AgentBrowserHostApi): Promise<AgentBrowserFacade> {
  const root = await mkdtemp(join(tmpdir(), 'vb-oneshot-'));
  return new AgentBrowserFacade({ api, evidenceRoot: root });
}

describe('verifyUrlOneShot (TF-0094)', () => {
  let facade: AgentBrowserFacade | undefined;

  afterEach(() => {
    facade = undefined;
  });

  it('一笔命令跑完 open → verify → close，并交出判词', async () => {
    const { api, calls } = createStubApi();
    facade = await createFacade(api);

    const outcome = await verifyUrlOneShot({
      facade,
      url: 'https://example.test/page',
      selectors: [],
      screenshot: false,
    });

    expect(calls.open).toBe(1);
    expect(calls.close).toBe(1);
    expect(outcome.sessionId).toBe('s-oneshot');
    expect(outcome.closed).toBe(true);
    expect(outcome.result.ok).toBe(true);
    expect((outcome.result.data as VerifyReport).outcome).toBe('pass');
  });

  it('页面自身 4xx → 判词 FAIL，但会话仍然关掉', async () => {
    const { api, calls } = createStubApi({ requestStatus: 404 });
    facade = await createFacade(api);

    const outcome = await verifyUrlOneShot({
      facade,
      url: 'https://example.test/page',
      selectors: [],
      screenshot: false,
    });

    // `result.ok` 表示调用成功；判词在 data.outcome 里（CLI 的退出码跟判词走）。
    expect(outcome.result.ok).toBe(true);
    expect((outcome.result.data as VerifyReport).outcome).toBe('fail');
    expect(calls.close).toBe(1);
    expect(outcome.closed).toBe(true);
  });

  it('open 失败时不产生会话，也不谎报已关闭', async () => {
    const { api, calls } = createStubApi({ openFails: true });
    facade = await createFacade(api);

    const outcome = await verifyUrlOneShot({ facade, url: 'https://example.test/page' });

    expect(outcome.result.ok).toBe(false);
    expect(outcome.sessionId).toBeUndefined();
    expect(outcome.closed).toBe(false);
    expect(calls.close).toBe(0);
  });

  it('open 没给出会话 id 时报 E_OPEN，而不是继续跑', async () => {
    const { api, calls } = createStubApi({ openWithoutSession: true });
    facade = await createFacade(api);

    const outcome = await verifyUrlOneShot({ facade, url: 'https://example.test/page' });

    expect(outcome.result.ok).toBe(false);
    expect(outcome.result.error?.code).toBe('E_OPEN');
    expect(outcome.closed).toBe(false);
    expect(calls.close).toBe(0);
  });

  it('close 失败不吞判词，但也不谎报已关闭（closed=false）', async () => {
    const { api, calls } = createStubApi({ closeFails: true });
    facade = await createFacade(api);

    const outcome = await verifyUrlOneShot({
      facade,
      url: 'https://example.test/page',
      selectors: [],
      screenshot: false,
    });

    expect(outcome.result.ok).toBe(true);
    expect(calls.close).toBe(1);
    // facade.close 现在透传宿主的失败（success:false → E_CLOSE）。
    expect(outcome.closed).toBe(false);
  });
});

describe('vb verify exit code follows the verdict (TF-0094)', () => {
  const report = (outcome: string): ToolResult =>
    ({ ok: true, content: '# verify_flow', data: { outcome } }) as ToolResult;

  it('pass → 0', () => {
    expect(verifyExitCode(report('pass'))).toBe(0);
  });

  it('fail / unknown → 1（否则 CI 步骤会把 FAIL 当成功）', () => {
    expect(verifyExitCode(report('fail'))).toBe(1);
    expect(verifyExitCode(report('unknown'))).toBe(1);
  });

  it('调用本身失败 → 1，非 verify 报告 → 0', () => {
    expect(verifyExitCode({ ok: false, content: 'E_OPEN' } as ToolResult)).toBe(1);
    expect(verifyExitCode({ ok: true, content: 'no session' } as ToolResult)).toBe(0);
  });
});
