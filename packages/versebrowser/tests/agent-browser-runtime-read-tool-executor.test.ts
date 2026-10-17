/**
 * 运行时只读工具执行器单元测试 — 抄写自 browser-ai-assistant-master/tests/unit/background/runtimeReadToolExecutor.test.ts
 * 适配点：
 * 1. import 路径改为 ClawX 约定
 * 2. 去掉 ModelToolCall/createToolCall，直接调用 executor.inspectGlobals/searchModules/describeFunction
 * 3. 保留 isError 断言（与 RuntimeReadResult.isError 字段对齐，避免与 HostSuccess.error?: string 冲突）
 * 4. 去掉 toolAttachments 断言（plain result 无附件）
 */
import { describe, expect, it, vi } from 'vitest';
import { RuntimeReadToolExecutor } from '../src/engine/browser-control/runtime-read-tool-executor';
import type { ToolAuthorizationContext } from '../src/core/tool-authorization';

function createAuthorization(mode: ToolAuthorizationContext['mode']): ToolAuthorizationContext {
  return { mode, tabId: 7, createdAt: 1, expiresAt: Date.now() + 1000, reason: '测试' };
}

describe('运行时只读工具执行器', () => {
  it('未授权和完全访问授权都会 fail closed，任意脚本执行必须走 full_access.*', async () => {
    const connection = { evaluate: vi.fn() };
    const normalExecutor = new RuntimeReadToolExecutor(connection, () => createAuthorization('normal'));
    const fullAccessExecutor = new RuntimeReadToolExecutor(connection, () => createAuthorization('full_access'));

    await expect(normalExecutor.inspectGlobals({ paths: ['window.__APP_CONFIG__'] })).resolves.toMatchObject({
      isError: true,
      content: '运行时只读分析未授权，无法执行 runtime.* 工具。请先显式开启运行时只读分析。',
    });
    await expect(fullAccessExecutor.inspectGlobals({ paths: ['window.__APP_CONFIG__'] })).resolves.toMatchObject({
      isError: true,
      content: '运行时只读分析未授权，无法执行 runtime.* 工具。请先显式开启运行时只读分析。',
    });
    expect(connection.evaluate).not.toHaveBeenCalled();
  });

  it('拒绝任意 JavaScript 表达式、危险路径和超长参数', async () => {
    const connection = { evaluate: vi.fn() };
    const executor = new RuntimeReadToolExecutor(connection, () => createAuthorization('runtime_readonly'));

    await expect(executor.inspectGlobals({ paths: ["window.fetch('https://evil.example')"] })).resolves.toMatchObject({
      isError: true,
      content: expect.stringContaining('不能传入 JavaScript 表达式'),
    });
    await expect(executor.describeFunction({ path: 'window.localStorage.getItem' })).resolves.toMatchObject({
      isError: true,
      content: '运行时路径包含高风险字段，已拒绝执行。',
    });
    await expect(executor.searchModules({ keywords: ['x'.repeat(81)] })).resolves.toMatchObject({
      isError: true,
      content: '关键词不能为空且单个长度不能超过 80。',
    });
    expect(connection.evaluate).not.toHaveBeenCalled();
  });

  it('读取公开全局摘要时使用固定 Runtime.evaluate 模板并脱敏截断结果', async () => {
    const connection = {
      evaluate: vi.fn(async (_params: Record<string, unknown>) => ({
        result: {
          value: [
            {
              path: '__APP_CONFIG__',
              exists: true,
              value: {
                entries: [
                  ['apiKey', { type: 'string', value: 'sk-secret-value' }],
                  ['safe', { type: 'string', value: 'ok' }],
                  ['long', { type: 'string', value: 'a'.repeat(1000) }],
                ],
              },
            },
          ],
        },
      })),
    };
    const executor = new RuntimeReadToolExecutor(connection, () => createAuthorization('runtime_readonly'));

    const result = await executor.inspectGlobals({ paths: ['window.__APP_CONFIG__'], limit: 5, maxDepth: 4 });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('运行时全局摘要');
    expect(result.content).toContain('Redacted: true');
    expect(result.content).toContain('Truncated: true');
    expect(result.content).toContain('[REDACTED]');
    expect(connection.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      awaitPromise: false,
      returnByValue: true,
      expression: expect.stringContaining('__APP_CONFIG__'),
    }));
    const evaluateArgs = connection.evaluate.mock.lastCall?.[0] as { expression?: unknown } | undefined;
    expect(String(evaluateArgs?.expression)).not.toContain('fetch(');
  });

  it('受控增强授权下仍只允许固定 Runtime 只读模板执行', async () => {
    const connection = {
      evaluate: vi.fn(async () => ({
        result: { value: [{ path: '__APP_CONFIG__', exists: true, value: { entries: [['safe', { value: 'ok' }]] } }] },
      })),
    };
    const executor = new RuntimeReadToolExecutor(connection, () => createAuthorization('controlled_enhanced'));

    const result = await executor.inspectGlobals({ paths: ['window.__APP_CONFIG__'] });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('运行时全局摘要');
    expect(connection.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      expression: expect.stringContaining('const paths'),
      returnByValue: true,
    }));
  });

  it('固定读取模板会跳过 accessor，避免只读摘要触发页面 getter', async () => {
    let getterCalled = false;
    const connection = {
      evaluate: vi.fn(async (params: Record<string, unknown>) => {
        Object.defineProperty(globalThis, '__RUNTIME_READ_TEST__', {
          configurable: true,
          value: {},
        });
        Object.defineProperty((globalThis as typeof globalThis & { __RUNTIME_READ_TEST__: Record<string, unknown> }).__RUNTIME_READ_TEST__, 'computed', {
          enumerable: true,
          get() {
            getterCalled = true;
            return 'should-not-read';
          },
        });
        try {
          return { result: { value: (0, eval)(String(params.expression)) } };
        } finally {
          Reflect.deleteProperty(globalThis, '__RUNTIME_READ_TEST__');
        }
      }),
    };
    const executor = new RuntimeReadToolExecutor(connection, () => createAuthorization('runtime_readonly'));

    const result = await executor.inspectGlobals({ paths: ['window.__RUNTIME_READ_TEST__.computed'], maxDepth: 4 });

    expect(getterCalled).toBe(false);
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('Accessor skipped');
    expect(result.content).not.toContain('should-not-read');
  });

  it('运行时字符串中的敏感值会整段或按值脱敏', async () => {
    const connection = {
      evaluate: vi.fn(async () => ({
        result: {
          value: {
            snippet: 'Authorization: Bearer very-secret-token-value',
            api: 'apiKey = "sk-runtime-secret"',
            jwt: 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
          },
        },
      })),
    };
    const executor = new RuntimeReadToolExecutor(connection, () => createAuthorization('runtime_readonly'));

    const result = await executor.searchModules({ keywords: ['token'] });

    expect(result.content).toContain('Redacted: true');
    expect(result.content).toContain('[REDACTED]');
    expect(result.content).not.toContain('very-secret-token-value');
    expect(result.content).not.toContain('sk-runtime-secret');
    expect(result.content).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('函数摘要只返回截断片段', async () => {
    const source = `function sign(payload) { return payload + "${'x'.repeat(1200)}"; }`;
    const connection = {
      evaluate: vi.fn(async (_params: Record<string, unknown>) => ({
        result: {
          value: {
            exists: true,
            type: 'function',
            name: 'sign',
            length: 1,
            source,
            truncated: true,
          },
        },
      })),
    };
    const executor = new RuntimeReadToolExecutor(connection, () => createAuthorization('runtime_readonly'));

    const result = await executor.describeFunction({ path: 'window.app.sign', radius: 100, keywords: ['payload'] });

    expect(result.content).toContain('运行时函数摘要');
    expect(result.content).toContain('Truncated: true');
    expect(result.content.length).toBeLessThan(13_000);
  });

  it('CDP 响应结构异常时按空摘要处理而不是抛出异常', async () => {
    const connection = {
      evaluate: vi.fn(async (_params: Record<string, unknown>) => ({
        result: 'bad-shape',
      })),
    };
    const executor = new RuntimeReadToolExecutor(connection, () => createAuthorization('runtime_readonly'));

    const result = await executor.inspectGlobals({ paths: ['window.__APP_CONFIG__'] });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('运行时全局摘要');
    expect(result.content).toContain('未读取到可用运行时摘要');
  });

  it('TF-0105：默认 maxDepth 下键与值仍可见，且页内自报的截断会汇总到头部标志', async () => {
    const connection = {
      evaluate: vi.fn(async (_params: Record<string, unknown>) => ({
        result: {
          // 页面模板真实返回的形状：类型化树 + 每路径一个信封。
          value: [
            {
              path: '__APP_CONFIG__',
              exists: true,
              value: {
                type: 'object',
                entries: [
                  ['region', { type: 'string', value: 'us-east-1' }],
                  [
                    'nested',
                    {
                      type: 'object',
                      entries: [['deep', { type: 'object', truncated: true }]],
                      truncated: false,
                    },
                  ],
                ],
                truncated: false,
              },
            },
          ],
        },
      })),
    };
    const executor = new RuntimeReadToolExecutor(connection, () => createAuthorization('runtime_readonly'));

    // 不给 maxDepth：外层脱敏遍历曾把 payload 折叠成 [Object]，默认参数等于不可用。
    const result = await executor.inspectGlobals({ paths: ['window.__APP_CONFIG__'] });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('"region"');
    expect(result.content).toContain('us-east-1');
    expect(result.content).toContain('"deep"');
    // 页内自己标了 truncated: true —— 头部标志不得说 false。
    expect(result.content).toContain('Truncated: true');
    expect(result.truncated).toBe(true);
    expect(result.redacted).toBe(false);
  });
});
