/**
 * Console 记录器单元测试 — 适配自 SRC consoleRecorder（无 SRC 测试文件，新建）
 * 验证 CDP 事件累积、脱敏、格式化、start/stop 生命周期。
 */
import { describe, expect, it, vi } from 'vitest';
import { BrowserConsoleRecorder, type BrowserConsoleConnection } from '../../electron/services/agent-browser/browser-control/console-recorder';

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
    expect(formatted).toContain('[已脱敏]');
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
});
