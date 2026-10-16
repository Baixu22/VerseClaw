/**
 * Console 记录器单元测试 — 适配自 SRC consoleRecorder（无 SRC 测试文件，新建）
 * 验证 CDP 事件累积、脱敏、格式化、start/stop 生命周期。
 */
import { describe, expect, it, vi } from 'vitest';
import { BrowserConsoleRecorder, type BrowserConsoleConnection } from '../src/engine/browser-control/console-recorder';

function createMockConnection(): BrowserConsoleConnection & {
  listeners: Array<(method: string, params?: Record<string, unknown>) => void>;
  emit(method: string, params?: Record<string, unknown>): void;
} {
  const listeners: Array<(method: string, params?: Record<string, unknown>) => void> = [];
  return {
    listeners,
    addEventListener: vi.fn((listener) => { listeners.push(listener); }),
    removeEventListener: vi.fn((listener) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) { listeners.splice(index, 1); }
    }),
    emit: (method: string, params?: Record<string, unknown>) => {
      for (const listener of listeners) { listener(method, params); }
    },
  };
}

describe('BrowserConsoleRecorder', () => {
  it('未 start 时 formatMessages 返回空提示', () => {
    const connection = createMockConnection();
    const recorder = new BrowserConsoleRecorder(connection);

    expect(recorder.formatMessages()).toContain('暂未采集到');
    expect(recorder.isEnabled).toBe(false);
  });

  it('start 后采集 Runtime.consoleAPICalled 事件', () => {
    const connection = createMockConnection();
    const recorder = new BrowserConsoleRecorder(connection);

    recorder.start(1);
    expect(recorder.isEnabled).toBe(true);

    connection.emit('Runtime.consoleAPICalled', {
      type: 'log',
      timestamp: 1000,
      args: [{ type: 'string', value: 'Hello World' }],
      stackTrace: { callFrames: [{ url: 'https://example.com/app.js', lineNumber: 10, columnNumber: 5 }] },
    });

    const formatted = recorder.formatMessages();
    expect(formatted).toContain('Hello World');
    expect(formatted).toContain('https://example.com/app.js:11:6');
    expect(formatted).toContain('[log]');
  });

  it('采集 Runtime.exceptionThrown 事件', () => {
    const connection = createMockConnection();
    const recorder = new BrowserConsoleRecorder(connection);

    recorder.start(1);
    connection.emit('Runtime.exceptionThrown', {
      timestamp: 2000,
      exceptionDetails: {
        text: 'Uncaught',
        url: 'https://example.com/error.js',
        lineNumber: 5,
        columnNumber: 3,
        exception: { description: 'TypeError: x is undefined' },
      },
    });

    const formatted = recorder.formatMessages();
    expect(formatted).toContain('TypeError: x is undefined');
    expect(formatted).toContain('[exception]');
  });

  it('采集 Log.entryAdded 事件', () => {
    const connection = createMockConnection();
    const recorder = new BrowserConsoleRecorder(connection);

    recorder.start(1);
    connection.emit('Log.entryAdded', {
      entry: {
        level: 'error',
        source: 'network',
        text: 'Failed to load resource',
        url: 'https://example.com/missing.js',
        lineNumber: 0,
        timestamp: 3000,
      },
    });

    const formatted = recorder.formatMessages();
    expect(formatted).toContain('Failed to load resource');
    expect(formatted).toContain('network:error');
  });

  it('脱敏敏感字段', () => {
    const connection = createMockConnection();
    const recorder = new BrowserConsoleRecorder(connection);

    recorder.start(1);
    connection.emit('Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ type: 'string', value: 'token=abc123secret password=mypass' }],
    });

    const formatted = recorder.formatMessages();
    expect(formatted).not.toContain('abc123secret');
    expect(formatted).not.toContain('mypass');
    expect(formatted).toContain('[REDACTED]');
  });

  it('超过 200 条消息时丢弃最旧的', () => {
    const connection = createMockConnection();
    const recorder = new BrowserConsoleRecorder(connection);

    recorder.start(1);
    for (let index = 0; index < 210; index += 1) {
      connection.emit('Runtime.consoleAPICalled', {
        type: 'log',
        args: [{ type: 'string', value: `msg-${index}` }],
      });
    }

    const formatted = recorder.formatMessages();
    expect(formatted).toContain('共 200 条');
    expect(formatted).toContain('msg-209');
    expect(formatted).not.toContain('msg-0');
  });

  it('stop 后停止采集并清空消息', () => {
    const connection = createMockConnection();
    const recorder = new BrowserConsoleRecorder(connection);

    recorder.start(1);
    connection.emit('Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ type: 'string', value: 'before-stop' }],
    });
    expect(recorder.formatMessages()).toContain('before-stop');

    recorder.stop();
    expect(recorder.isEnabled).toBe(false);
    expect(recorder.formatMessages()).toContain('暂未采集到');
    expect(connection.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('clear 清空消息但不停止监听', () => {
    const connection = createMockConnection();
    const recorder = new BrowserConsoleRecorder(connection);

    recorder.start(1);
    connection.emit('Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ type: 'string', value: 'will-clear' }],
    });

    recorder.clear();
    expect(recorder.formatMessages()).toContain('暂未采集到');
    expect(recorder.isEnabled).toBe(true);

    connection.emit('Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ type: 'string', value: 'after-clear' }],
    });
    expect(recorder.formatMessages()).toContain('after-clear');
  });

  it('重复 start 会先 stop 再重新开始', () => {
    const connection = createMockConnection();
    const recorder = new BrowserConsoleRecorder(connection);

    recorder.start(1);
    connection.emit('Runtime.consoleAPICalled', {
      type: 'log',
      args: [{ type: 'string', value: 'first' }],
    });

    recorder.start(2);
    expect(recorder.formatMessages()).toContain('暂未采集到');
    expect(connection.removeEventListener).toHaveBeenCalledTimes(1);
    expect(connection.addEventListener).toHaveBeenCalledTimes(2);
  });
  /**
   * 这里曾经维护第二份键名清单（缺 authorization / cookie / credential / sid），于是最常见的控制台输出
   * ——`Authorization: Bearer <token>`、`Cookie: sid=<value>`——在 SDK/CLI 出口原样带出（facade.console
   * 返回 content 时不再二次脱敏）。键名改走 redact-secrets 的规范判定后，这些必须被脱敏；
   * 同时确认没有把普通键值一起吃掉（author / responseTime 仍保留）。
   */
  it('按规范键名脱敏 console 文本，并保留非密钥键值', () => {
    const connection = createMockConnection();
    const recorder = new BrowserConsoleRecorder(connection);
    recorder.start(1);

    const secrets = [
      'Authorization: Bearer supersecrettoken123456',
      'authorization=Bearer supersecrettoken123456',
      'Cookie: sid=abcdef123456',
      'cookie=abcdef123456',
      'credential: abcdef123456',
      'apiKey: abcdef123456',
      'token: abcdef123456',
      'password=abcdef123456',
    ];
    for (const text of secrets) {
      connection.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ type: 'string', value: text }] });
    }
    connection.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ type: 'string', value: 'author: Alice' }] });
    connection.emit('Runtime.consoleAPICalled', { type: 'log', args: [{ type: 'string', value: 'responseTime=42' }] });

    const formatted = recorder.formatMessages();
    expect(formatted).not.toContain('supersecrettoken123456');
    expect(formatted).not.toContain('abcdef123456');
    expect(formatted).toContain('Authorization=[REDACTED]');
    expect(formatted).toContain('Cookie=[REDACTED]');
    expect(formatted).toContain('credential=[REDACTED]');
    // 普通键值不能被误伤
    expect(formatted).toContain('author: Alice');
    expect(formatted).toContain('responseTime=42');
  });

  /**
   * URL query 键名曾是本文件里的第三份清单，比 redact-secrets 的规范判定少 private_key / pass / auth，
   * 于是控制台位置里的 `?private_key=…` / `?pass=…` / `?auth=…` 在 SDK/CLI 出口原样带出
   * （facade.console 返回 content 时不再二次脱敏）。
   */
  it('按规范键名脱敏 console 位置的 query 参数', () => {
    const connection = createMockConnection();
    const recorder = new BrowserConsoleRecorder(connection);
    recorder.start(1);

    const urls = [
      'https://example.com/app.js?token=AAA111',
      'https://example.com/app.js?private_key=BBB222',
      'https://example.com/app.js?auth=CCC333',
      'https://example.com/app.js?pass=DDD444',
      'https://example.com/app.js?credential=EEE555',
      'https://example.com/app.js?q=harmless',
    ];
    for (const url of urls) {
      connection.emit('Runtime.consoleAPICalled', {
        type: 'log',
        args: [{ type: 'string', value: 'msg' }],
        stackTrace: { callFrames: [{ url, lineNumber: 0, columnNumber: 0 }] },
      });
    }

    const formatted = recorder.formatMessages();
    for (const secret of ['AAA111', 'BBB222', 'CCC333', 'DDD444', 'EEE555']) {
      expect(formatted, secret).not.toContain(secret);
    }
    expect(formatted).toContain('private_key=[REDACTED]');
    // 无害参数不能被误伤
    expect(formatted).toContain('q=harmless');
  });

});
