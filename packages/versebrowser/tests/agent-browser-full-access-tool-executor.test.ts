/**
 * 完全访问工具执行器单元测试 — 抄写自 browser-ai-assistant-master/tests/unit/background/fullAccessToolExecutor.test.ts
 * 适配点：
 * 1. import 路径改为 ClawX 约定
 * 2. 去掉 ModelToolCall/createToolCall，直接调用 executor.executeScript/fetchFromPage/getNetworkDetails/readStorage/revokeFullAccess
 * 3. 由于 API 改为直接方法调用（无工具名分发），删除“未知工具名”测试；保留参数校验测试（用 as unknown as 绕过 TS 类型）
 * 4. 保留 isError 断言（与 FullAccessResult.isError 字段对齐，避免与 HostSuccess.error?: string 冲突）
 */
import { describe, expect, it, vi } from 'vitest';
import { FullAccessToolExecutor } from '../src/engine/browser-control/full-access-tool-executor';
import type { NetworkRequestDetail } from '../src/core/types';

type EvaluateMock = ReturnType<typeof vi.fn<(params: Record<string, unknown>) => Promise<unknown>>>;
type GetDetailsMock = ReturnType<typeof vi.fn<(requestIds: string[], options?: { redacted?: boolean }) => Promise<NetworkRequestDetail[]>>>;
type RevokeMock = ReturnType<typeof vi.fn<() => void>>;

describe('完全访问工具执行器', () => {
  it('非完全访问模式下 fail closed', async () => {
    const executor = new FullAccessToolExecutor(
      { evaluate: vi.fn() },
      { isEnabled: true, getDetails: vi.fn() },
      () => ({ tabId: 7, origin: 'https://example.com', expectedTabId: 7, expectedOrigin: 'https://example.com', fullAccess: false }),
      vi.fn(),
    );

    const result = await executor.executeScript({ script: 'document.cookie' });

    expect(result).toMatchObject({
      isError: true,
      content: '当前不是完全访问模式，已拒绝执行 full_access.* 工具。',
    });
  });

  it('execute_script 执行任意脚本并返回 Runtime 原始结果', async () => {
    const evaluate = vi.fn(async () => ({ result: { value: { password: '123456', token: 'secret' } } }));
    const executor = createExecutor({ evaluate });

    const result = await executor.executeScript({
      script: '({ password: document.querySelector(\'#password\')?.value, token: localStorage.token })',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('123456');
    expect(result.content).toContain('secret');
    expect(evaluate).toHaveBeenCalledWith({
      expression: '({ password: document.querySelector(\'#password\')?.value, token: localStorage.token })',
      awaitPromise: true,
      returnByValue: true,
    });
  });

  it('fetch 默认携带页面凭据并返回原始响应', async () => {
    const evaluate = vi.fn(async () => ({ result: { value: { status: 200, body: '{"password":"123456"}' } } }));
    const executor = createExecutor({ evaluate });

    const result = await executor.fetchFromPage({
      url: '/api/login',
      method: 'POST',
      headers: { Authorization: 'Bearer secret' },
      body: '{"password":"123456"}',
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('123456');
    const params = (evaluate.mock.calls as unknown[][])[0]?.[0] as unknown as { expression: string; awaitPromise: boolean; returnByValue: boolean };
    expect(params.awaitPromise).toBe(true);
    expect(params.returnByValue).toBe(true);
    expect(params.expression).toContain('"credentials":"include"');
    expect(params.expression).toContain('"Authorization":"Bearer secret"');
  });

  it('get_network_details 返回未脱敏 Network 原文', async () => {
    const getDetails = vi.fn(async (): Promise<NetworkRequestDetail[]> => [{
      id: 'req-1',
      url: 'https://example.com/api?token=secret',
      method: 'POST',
      requestHeaders: [{ name: 'Authorization', value: 'Bearer secret' }],
      requestBody: '{"password":"123456"}',
      responseBody: '{"token":"secret"}',
      truncated: false,
      redacted: false,
    }]);
    const executor = createExecutor({ getDetails });

    const result = await executor.getNetworkDetails({ requestIds: ['req-1'] });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('Bearer secret');
    expect(result.content).toContain('123456');
    expect(result.toolAttachments?.[0]).toMatchObject({
      kind: 'network',
      redacted: false,
      fullAccess: true,
      requests: [expect.objectContaining({
        requestBody: '{"password":"123456"}',
        responseBody: '{"token":"secret"}',
        redacted: false,
      })],
    });
    expect(getDetails).toHaveBeenCalledWith(['req-1'], { redacted: false });
  });

  it('read_storage 返回 Cookie 和 Web Storage 原文', async () => {
    const evaluate = vi.fn(async () => ({
      result: {
        value: {
          cookie: 'sid=secret',
          localStorage: { token: 'local-token' },
          sessionStorage: { password: '123456' },
        },
      },
    }));
    const executor = createExecutor({ evaluate });

    const result = await executor.readStorage();

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('sid=secret');
    expect(result.content).toContain('local-token');
    expect(result.content).toContain('123456');
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({
      expression: expect.stringContaining('document.cookie'),
      returnByValue: true,
    }));
  });

  it('revoke 会撤销完全访问运行态', () => {
    const revoke = vi.fn();
    const executor = createExecutor({ revoke });

    const result = executor.revokeFullAccess();

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('完全访问模式已撤销');
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('execute_script 参数无效时返回错误', async () => {
    const executor = createExecutor();

    await expect(executor.executeScript({ script: '' })).resolves.toMatchObject({
      isError: true,
    });
  });

  it('fetch 在 headers 非对象时返回错误', async () => {
    const executor = createExecutor();

    await expect(executor.fetchFromPage({
      url: '/api',
      headers: 'bad' as unknown as Record<string, string>,
    })).resolves.toMatchObject({
      isError: true,
    });
  });

  it('get_network_details 拒绝过多 requestIds', async () => {
    const getDetails = vi.fn(async () => [] as NetworkRequestDetail[]);
    const executor = createExecutor({ getDetails });
    const requestIds = Array.from({ length: 101 }, (_, index) => `req-${index}`);

    await expect(executor.getNetworkDetails({ requestIds })).resolves.toMatchObject({
      isError: true,
    });
    expect(getDetails).not.toHaveBeenCalled();
  });

  it('recorder 未启用时 canExpose 返回 false', () => {
    const executor = new FullAccessToolExecutor(
      { evaluate: vi.fn() },
      { isEnabled: false, getDetails: vi.fn() },
      () => ({ tabId: 7, origin: 'https://example.com', expectedTabId: 7, expectedOrigin: 'https://example.com', fullAccess: true }),
      vi.fn(),
    );

    expect(executor.canExpose()).toBe(false);
  });
});

function createExecutor(overrides: {
  evaluate?: EvaluateMock;
  getDetails?: GetDetailsMock;
  revoke?: RevokeMock;
} = {}): FullAccessToolExecutor {
  return new FullAccessToolExecutor(
    { evaluate: overrides.evaluate ?? vi.fn(async () => ({ result: { value: true } })) },
    { isEnabled: true, getDetails: overrides.getDetails ?? vi.fn(async () => [] as NetworkRequestDetail[]) },
    () => ({ tabId: 7, origin: 'https://example.com', expectedTabId: 7, expectedOrigin: 'https://example.com', fullAccess: true }),
    overrides.revoke ?? vi.fn(),
  );
}
