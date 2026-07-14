/**
 * P1-2 新增：BrowserNetworkRecorder 单测。
 *
 * 覆盖：
 * - start/stop 启用与停用
 * - listRequests 过滤（urlIncludes / method / status / limit）
 * - getDetails 读取响应体（含二进制 MIME 跳过）
 * - clear 清空缓存
 * - waitForRequests 已有匹配立即返回 / 超时返回空
 * - LRU 缓存上限 trim
 * - CDP 事件处理（requestWillBeSent / responseReceived / loadingFinished / loadingFailed）
 */

import { describe, expect, it, vi } from 'vitest';
import { BrowserNetworkRecorder, type BrowserNetworkConnection } from '@electron/services/agent-browser/browser-control/network-recorder';

class FakeNetworkConnection implements BrowserNetworkConnection {
  private listeners = new Set<(method: string, params?: Record<string, unknown>) => void>();
  readonly getResponseBody = vi.fn(async (_requestId: string) => ({ body: '', base64Encoded: false }));

  addEventListener(listener: (method: string, params?: Record<string, unknown>) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(listener: (method: string, params?: Record<string, unknown>) => void): void {
    this.listeners.delete(listener);
  }

  emit(method: string, params?: Record<string, unknown>): void {
    for (const listener of this.listeners) {
      listener(method, params);
    }
  }
}

function makeRequestWillBeSent(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    requestId: 'req-1',
    timestamp: 1.0,
    wallTime: 1000.0,
    type: 'XHR',
    request: {
      url: 'https://example.com/api',
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    },
    ...overrides,
  };
}

function makeResponseReceived(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    requestId: 'req-1',
    timestamp: 1.5,
    type: 'XHR',
    response: {
      url: 'https://example.com/api',
      status: 200,
      statusText: 'OK',
      mimeType: 'application/json',
      headers: { 'Content-Type': 'application/json' },
    },
    ...overrides,
  };
}

describe('P1-2 BrowserNetworkRecorder start/stop', () => {
  it('start 后 isEnabled=true', () => {
    const conn = new FakeNetworkConnection();
    const recorder = new BrowserNetworkRecorder(conn);
    expect(recorder.isEnabled).toBe(false);
    recorder.start(1);
    expect(recorder.isEnabled).toBe(true);
  });

  it('stop 后 isEnabled=false 且清空缓存', () => {
    const conn = new FakeNetworkConnection();
    const recorder = new BrowserNetworkRecorder(conn);
    recorder.start(1);
    conn.emit('Network.requestWillBeSent', makeRequestWillBeSent());
    expect(recorder.listRequests()).toHaveLength(1);
    recorder.stop();
    expect(recorder.isEnabled).toBe(false);
    expect(recorder.listRequests()).toHaveLength(0);
  });
});

describe('P1-2 BrowserNetworkRecorder listRequests', () => {
  it('列出已捕获请求', () => {
    const conn = new FakeNetworkConnection();
    const recorder = new BrowserNetworkRecorder(conn);
    recorder.start(1);
    conn.emit('Network.requestWillBeSent', makeRequestWillBeSent({ requestId: 'a' }));
    conn.emit('Network.requestWillBeSent', makeRequestWillBeSent({ requestId: 'b', request: { url: 'https://example.com/other', method: 'POST' } }));
    const requests = recorder.listRequests();
    expect(requests).toHaveLength(2);
    expect(requests.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('urlIncludes 过滤', () => {
    const conn = new FakeNetworkConnection();
    const recorder = new BrowserNetworkRecorder(conn);
    recorder.start(1);
    conn.emit('Network.requestWillBeSent', makeRequestWillBeSent({ requestId: 'a', request: { url: 'https://example.com/api', method: 'GET' } }));
    conn.emit('Network.requestWillBeSent', makeRequestWillBeSent({ requestId: 'b', request: { url: 'https://example.com/other', method: 'GET' } }));
    const requests = recorder.listRequests({ urlIncludes: '/api' });
    expect(requests).toHaveLength(1);
    expect(requests[0].id).toBe('a');
  });

  it('method 过滤（大小写不敏感）', () => {
    const conn = new FakeNetworkConnection();
    const recorder = new BrowserNetworkRecorder(conn);
    recorder.start(1);
    conn.emit('Network.requestWillBeSent', makeRequestWillBeSent({ requestId: 'a', request: { url: 'https://example.com/a', method: 'GET' } }));
    conn.emit('Network.requestWillBeSent', makeRequestWillBeSent({ requestId: 'b', request: { url: 'https://example.com/b', method: 'POST' } }));
    const posts = recorder.listRequests({ method: 'post' });
    expect(posts).toHaveLength(1);
    expect(posts[0].id).toBe('b');
  });

  it('status 过滤', () => {
    const conn = new FakeNetworkConnection();
    const recorder = new BrowserNetworkRecorder(conn);
    recorder.start(1);
    conn.emit('Network.requestWillBeSent', makeRequestWillBeSent({ requestId: 'a' }));
    conn.emit('Network.responseReceived', makeResponseReceived({ requestId: 'a', response: { status: 200, mimeType: 'application/json', headers: {} } }));
    conn.emit('Network.requestWillBeSent', makeRequestWillBeSent({ requestId: 'b' }));
    conn.emit('Network.responseReceived', makeResponseReceived({ requestId: 'b', response: { status: 404, mimeType: 'text/html', headers: {} } }));
    const ok = recorder.listRequests({ status: 200 });
    expect(ok).toHaveLength(1);
    expect(ok[0].id).toBe('a');
  });

  it('limit 限制返回数量', () => {
    const conn = new FakeNetworkConnection();
    const recorder = new BrowserNetworkRecorder(conn);
    recorder.start(1);
    for (let i = 0; i < 10; i++) {
      conn.emit('Network.requestWillBeSent', makeRequestWillBeSent({ requestId: `r${i}` }));
    }
    const requests = recorder.listRequests({ limit: 3 });
    expect(requests).toHaveLength(3);
  });

  it('默认脱敏敏感字段', () => {
    const conn = new FakeNetworkConnection();
    const recorder = new BrowserNetworkRecorder(conn);
    recorder.start(1);
    conn.emit('Network.requestWillBeSent', {
      requestId: 'a',
      timestamp: 1,
      wallTime: 1000,
      type: 'XHR',
      request: {
        url: 'https://example.com/api?token=secret',
        method: 'GET',
        headers: { Authorization: 'Bearer xyz' },
      },
    });
    const requests = recorder.listRequests({}, {});
    expect(requests[0].url).toContain('[已脱敏]');
    const auth = requests[0].requestHeaders?.find((h) => h.name === 'Authorization');
    expect(auth?.value).toBe('[已脱敏]');
  });

  it('redacted=false 返回原始数据', () => {
    const conn = new FakeNetworkConnection();
    const recorder = new BrowserNetworkRecorder(conn);
    recorder.start(1);
    conn.emit('Network.requestWillBeSent', {
      requestId: 'a',
      timestamp: 1,
      wallTime: 1000,
      type: 'XHR',
      request: {
        url: 'https://example.com/api?token=secret',
        method: 'GET',
        headers: { Authorization: 'Bearer xyz' },
      },
    });
    const requests = recorder.listRequests({}, { redacted: false });
    expect(requests[0].url).toBe('https://example.com/api?token=secret');
    const auth = requests[0].requestHeaders?.find((h) => h.name === 'Authorization');
    expect(auth?.value).toBe('Bearer xyz');
  });
});

describe('P1-2 BrowserNetworkRecorder clear', () => {
  it('清空缓存', () => {
    const conn = new FakeNetworkConnection();
    const recorder = new BrowserNetworkRecorder(conn);
    recorder.start(1);
    conn.emit('Network.requestWillBeSent', makeRequestWillBeSent());
    expect(recorder.listRequests()).toHaveLength(1);
    recorder.clear();
    expect(recorder.listRequests()).toHaveLength(0);
  });
});

describe('P1-2 BrowserNetworkRecorder getDetails', () => {
  it('返回详情含响应体', async () => {
    const conn = new FakeNetworkConnection();
    conn.getResponseBody.mockResolvedValue({ body: '{"ok":true}', base64Encoded: false });
    const recorder = new BrowserNetworkRecorder(conn);
    recorder.start(1);
    conn.emit('Network.requestWillBeSent', makeRequestWillBeSent());
    conn.emit('Network.responseReceived', makeResponseReceived());
    conn.emit('Network.loadingFinished', { requestId: 'req-1', timestamp: 2.0 });
    const details = await recorder.getDetails(['req-1'], { redacted: false });
    expect(details).toHaveLength(1);
    expect(details[0].responseBody).toBe('{"ok":true}');
    expect(details[0].truncated).toBe(false);
  });

  it('二进制 MIME 跳过响应体读取', async () => {
    const conn = new FakeNetworkConnection();
    conn.getResponseBody.mockResolvedValue({ body: '', base64Encoded: false });
    const recorder = new BrowserNetworkRecorder(conn);
    recorder.start(1);
    conn.emit('Network.requestWillBeSent', makeRequestWillBeSent());
    conn.emit('Network.responseReceived', makeResponseReceived({
      response: { status: 200, mimeType: 'image/png', headers: {} },
    }));
    conn.emit('Network.loadingFinished', { requestId: 'req-1', timestamp: 2.0 });
    const details = await recorder.getDetails(['req-1'], { redacted: false });
    expect(details[0].responseBody).toBeUndefined();
  });

  it('未知 requestId 返回空数组', async () => {
    const conn = new FakeNetworkConnection();
    const recorder = new BrowserNetworkRecorder(conn);
    recorder.start(1);
    const details = await recorder.getDetails(['unknown-id'], { redacted: false });
    expect(details).toEqual([]);
  });
});

describe('P1-2 BrowserNetworkRecorder waitForRequests', () => {
  it('已有匹配立即返回', async () => {
    const conn = new FakeNetworkConnection();
    const recorder = new BrowserNetworkRecorder(conn);
    recorder.start(1);
    conn.emit('Network.requestWillBeSent', makeRequestWillBeSent({ requestId: 'a' }));
    const result = await recorder.waitForRequests({ urlIncludes: '/api' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  it('无匹配时超时返回空', async () => {
    const conn = new FakeNetworkConnection();
    const recorder = new BrowserNetworkRecorder(conn);
    recorder.start(1);
    const result = await recorder.waitForRequests({ urlIncludes: '/api', timeoutMs: 50 });
    expect(result).toEqual([]);
  });

  it('等待期间出现匹配则返回', async () => {
    const conn = new FakeNetworkConnection();
    const recorder = new BrowserNetworkRecorder(conn);
    recorder.start(1);
    const promise = recorder.waitForRequests({ urlIncludes: '/api', timeoutMs: 1000 });
    // 模拟延迟到达的请求
    setTimeout(() => {
      conn.emit('Network.requestWillBeSent', makeRequestWillBeSent({ requestId: 'late' }));
    }, 20);
    const result = await promise;
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('late');
  });
});

describe('P1-2 BrowserNetworkRecorder loadingFailed', () => {
  it('记录失败请求的 failed 与 error', () => {
    const conn = new FakeNetworkConnection();
    const recorder = new BrowserNetworkRecorder(conn);
    recorder.start(1);
    conn.emit('Network.requestWillBeSent', makeRequestWillBeSent());
    conn.emit('Network.loadingFailed', { requestId: 'req-1', timestamp: 2.0, errorText: 'net::ERR_FAILED' });
    const requests = recorder.listRequests({}, { redacted: false });
    expect(requests[0].failed).toBe(true);
    expect(requests[0].error).toBe('net::ERR_FAILED');
  });
});

describe('P1-2 BrowserNetworkRecorder LRU trim', () => {
  it('超过 1000 条缓存时淘汰最旧已完成请求', () => {
    const conn = new FakeNetworkConnection();
    const recorder = new BrowserNetworkRecorder(conn);
    recorder.start(1);
    // 注入 1001 条已完成请求
    for (let i = 0; i < 1001; i++) {
      conn.emit('Network.requestWillBeSent', makeRequestWillBeSent({ requestId: `r${i}` }));
      conn.emit('Network.loadingFinished', { requestId: `r${i}`, timestamp: 2.0 });
    }
    // 第一条应被淘汰
    expect(recorder.getRawRequestMeta('r0')).toBeUndefined();
    // 最后一条应保留
    expect(recorder.getRawRequestMeta('r1000')).toBeDefined();
  });
});
