/**
 * P1-2 新增：Network 工具集 service 方法单测。
 *
 * 覆盖 7 个 service 方法：
 * - networkListRequests / networkClearRequests / networkWaitForRequests
 * - networkGetRequestDetails
 * - networkCompareRequests / networkFindParameterCandidates / networkExtractJsCandidates
 *
 * 安全校验：
 * - setEnabled(false) 时所有 network 动作被拒
 * - normal_restricted 模式下所有 network 动作被拒
 * - controlled_enhanced 模式下默认脱敏
 * - full_access 模式 + redacted=false 返回原始数据
 * - agent-browser-cli engine 拒绝 network 动作
 */

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { AgentBrowserService } from '@electron/services/agent-browser-service';

class FakeDebugger extends EventEmitter {
  readonly attach = vi.fn(async (_version: string) => undefined);
  readonly detach = vi.fn(async () => undefined);
  readonly sendCommand = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === 'Accessibility.getFullAXTree') {
      return {
        nodes: [
          { nodeId: 'root', backendDOMNodeId: 1, role: { value: 'RootWebArea' }, name: { value: 'Test' } },
        ],
      };
    }
    if (method === 'Network.getResponseBody') {
      return { body: '{"ok":true,"token":"secret"}', base64Encoded: false };
    }
    return {};
  });
}

class FakeWebContents extends EventEmitter {
  url = '';
  title = '';
  readonly debugger = new FakeDebugger();

  getURL() { return this.url; }
  getTitle() { return this.title; }
  async executeJavaScript() { return ''; }
  async capturePage() { return { toDataURL: () => 'data:image/png;base64,abc' }; }
}

class FakeWindow {
  readonly webContents = new FakeWebContents();
  closed = false;

  async loadURL(u: string) {
    this.webContents.url = u;
    this.webContents.title = 'Page';
    queueMicrotask(() => {
      this.webContents.emit('dom-ready');
      this.webContents.emit('did-finish-load');
    });
  }
  close() { this.closed = true; }
  isDestroyed() { return this.closed; }
  show() {}
  setBounds() {}
}

function createService() {
  const windows: FakeWindow[] = [];
  const service = new AgentBrowserService({
    createWindow: () => {
      const win = new FakeWindow();
      windows.push(win);
      return win as never;
    },
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
  return { service, windows };
}

async function setupControlledSession(service: AgentBrowserService, runtimeMode: 'controlled_enhanced' | 'full_access' = 'controlled_enhanced') {
  const opened = await service.open({ url: 'example.com', profile: 'Work', mode: 'headless', runtimeMode });
  const sessionId = opened.session.id;
  service.setEnabled(true);
  // takeSnapshot 触发 CDP attach + Network.enable + networkRecorder 创建
  await service.takeSnapshot({ sessionId });
  return { sessionId };
}

function emitNetworkEvent(debugger_: FakeDebugger, method: string, params: Record<string, unknown>) {
  debugger_.emit('message', {}, method, params);
}

describe('P1-2 Network service 安全校验', () => {
  it('setEnabled(false) 时 networkListRequests 被拒', async () => {
    const { service } = createService();
    const opened = await service.open({ url: 'example.com', profile: 'Work', mode: 'headless', runtimeMode: 'controlled_enhanced' });
    service.setEnabled(true);
    await service.takeSnapshot({ sessionId: opened.session.id });
    service.setEnabled(false);
    await expect(service.networkListRequests({ sessionId: opened.session.id })).rejects.toThrow('浏览器控制未开启');
  });

  it('normal_restricted 模式下 networkListRequests 被拒', async () => {
    const { service } = createService();
    // 先以 controlled_enhanced 开启并初始化 browser control
    const opened = await service.open({ url: 'example.com', profile: 'Work', mode: 'headless', runtimeMode: 'controlled_enhanced' });
    service.setEnabled(true);
    await service.takeSnapshot({ sessionId: opened.session.id });
    // 降级回 normal_restricted
    await service.requestModeUpgrade({ sessionId: opened.session.id, targetMode: 'normal_restricted' });
    // network 动作应被拒
    await expect(service.networkListRequests({ sessionId: opened.session.id })).rejects.toThrow('runtime mode upgrade');
  });

  it('agent-browser-cli engine 拒绝 network 动作', async () => {
    const runner = {
      isAvailable: vi.fn(() => true),
      open: vi.fn(async () => ({ url: 'https://example.com/', title: 'CLI' })),
      navigate: vi.fn(async () => ({ url: 'https://example.com/', title: 'CLI' })),
      waitForSelector: vi.fn(async () => ({ title: 'Ready' })),
      click: vi.fn(async () => ({ title: 'Clicked' })),
      type: vi.fn(async () => ({ title: 'Typed' })),
      evaluate: vi.fn(async () => ({ session: { title: 'Eval' }, value: 0 })),
      screenshot: vi.fn(async () => ({ session: { title: 'Shot' }, dataUrl: '' })),
      command: vi.fn(async () => ({ session: { title: 'Snap' }, data: {}, stdout: '', stderr: '', command: [] })),
      textSample: vi.fn(async () => ''),
      close: vi.fn(async () => undefined),
    };
    const service = new AgentBrowserService({
      cliRunner: runner,
      createWindow: vi.fn(() => { throw new Error('should not create window'); }) as never,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const opened = await service.open({ url: 'example.com', profile: 'Work' });
    service.setEnabled(true);
    await expect(service.networkListRequests({ sessionId: opened.session.id })).rejects.toThrow('browser-window 引擎');
  });
});

describe('P1-2 networkListRequests', () => {
  it('返回捕获的请求列表（controlled_enhanced 默认脱敏）', async () => {
    const { service, windows } = createService();
    const { sessionId } = await setupControlledSession(service);
    const dbg = windows[0].webContents.debugger;

    emitNetworkEvent(dbg, 'Network.requestWillBeSent', {
      requestId: 'r1',
      timestamp: 1,
      wallTime: 1000,
      type: 'XHR',
      request: { url: 'https://api.example.com/data?token=secret', method: 'GET', headers: {} },
    });

    const result = await service.networkListRequests({ sessionId });
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0].id).toBe('r1');
    expect(result.requests[0].url).toContain('[已脱敏]');
  });

  it('urlIncludes 过滤', async () => {
    const { service, windows } = createService();
    const { sessionId } = await setupControlledSession(service);
    const dbg = windows[0].webContents.debugger;

    emitNetworkEvent(dbg, 'Network.requestWillBeSent', {
      requestId: 'a', timestamp: 1, wallTime: 1000, type: 'XHR',
      request: { url: 'https://api.example.com/a', method: 'GET', headers: {} },
    });
    emitNetworkEvent(dbg, 'Network.requestWillBeSent', {
      requestId: 'b', timestamp: 2, wallTime: 2000, type: 'XHR',
      request: { url: 'https://other.example.com/b', method: 'GET', headers: {} },
    });

    const result = await service.networkListRequests({ sessionId, filter: { urlIncludes: 'api.example.com' } });
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0].id).toBe('a');
  });
});

describe('P1-2 networkClearRequests', () => {
  it('清空请求缓存', async () => {
    const { service, windows } = createService();
    const { sessionId } = await setupControlledSession(service);
    const dbg = windows[0].webContents.debugger;

    emitNetworkEvent(dbg, 'Network.requestWillBeSent', {
      requestId: 'r1', timestamp: 1, wallTime: 1000, type: 'XHR',
      request: { url: 'https://example.com/', method: 'GET', headers: {} },
    });
    expect((await service.networkListRequests({ sessionId })).requests).toHaveLength(1);

    await service.networkClearRequests({ sessionId });
    expect((await service.networkListRequests({ sessionId })).requests).toHaveLength(0);
  });
});

describe('P1-2 networkGetRequestDetails', () => {
  it('返回请求详情（controlled_enhanced 默认脱敏）', async () => {
    const { service, windows } = createService();
    const { sessionId } = await setupControlledSession(service);
    const dbg = windows[0].webContents.debugger;

    emitNetworkEvent(dbg, 'Network.requestWillBeSent', {
      requestId: 'r1', timestamp: 1, wallTime: 1000, type: 'XHR',
      request: { url: 'https://example.com/api', method: 'GET', headers: { Authorization: 'Bearer xyz' } },
    });
    emitNetworkEvent(dbg, 'Network.responseReceived', {
      requestId: 'r1', timestamp: 1.5, type: 'XHR',
      response: { status: 200, statusText: 'OK', mimeType: 'application/json', headers: {} },
    });
    emitNetworkEvent(dbg, 'Network.loadingFinished', { requestId: 'r1', timestamp: 2 });

    const result = await service.networkGetRequestDetails({ sessionId, requestIds: ['r1'] });
    expect(result.details).toHaveLength(1);
    const detail = result.details[0] as Record<string, unknown>;
    expect(detail.redacted).toBe(true);
    // Authorization 头应被脱敏
    const headers = detail.requestHeaders as Array<{ name: string; value: string }>;
    expect(headers.find((h) => h.name === 'Authorization')?.value).toBe('[已脱敏]');
  });

  it('full_access + redacted=false 返回原始数据', async () => {
    const { service, windows } = createService();
    const { sessionId } = await setupControlledSession(service, 'full_access');
    const dbg = windows[0].webContents.debugger;

    emitNetworkEvent(dbg, 'Network.requestWillBeSent', {
      requestId: 'r1', timestamp: 1, wallTime: 1000, type: 'XHR',
      request: { url: 'https://example.com/api', method: 'GET', headers: { Authorization: 'Bearer xyz' } },
    });
    emitNetworkEvent(dbg, 'Network.responseReceived', {
      requestId: 'r1', timestamp: 1.5, type: 'XHR',
      response: { status: 200, mimeType: 'application/json', headers: {} },
    });
    emitNetworkEvent(dbg, 'Network.loadingFinished', { requestId: 'r1', timestamp: 2 });

    const result = await service.networkGetRequestDetails({ sessionId, requestIds: ['r1'], redacted: false });
    const detail = result.details[0] as Record<string, unknown>;
    expect(detail.redacted).toBe(false);
    const headers = detail.requestHeaders as Array<{ name: string; value: string }>;
    expect(headers.find((h) => h.name === 'Authorization')?.value).toBe('Bearer xyz');
  });

  it('controlled_enhanced + redacted=false 仍脱敏', async () => {
    const { service, windows } = createService();
    const { sessionId } = await setupControlledSession(service, 'controlled_enhanced');
    const dbg = windows[0].webContents.debugger;

    emitNetworkEvent(dbg, 'Network.requestWillBeSent', {
      requestId: 'r1', timestamp: 1, wallTime: 1000, type: 'XHR',
      request: { url: 'https://example.com/api', method: 'GET', headers: { Authorization: 'Bearer xyz' } },
    });

    const result = await service.networkGetRequestDetails({ sessionId, requestIds: ['r1'], redacted: false });
    const detail = result.details[0] as Record<string, unknown>;
    expect(detail.redacted).toBe(true);
  });
});

describe('P1-2 networkCompareRequests', () => {
  it('至少需要两个请求', async () => {
    const { service, windows } = createService();
    const { sessionId } = await setupControlledSession(service);
    const dbg = windows[0].webContents.debugger;

    emitNetworkEvent(dbg, 'Network.requestWillBeSent', {
      requestId: 'r1', timestamp: 1, wallTime: 1000, type: 'XHR',
      request: { url: 'https://example.com/api', method: 'GET', headers: {} },
    });
    emitNetworkEvent(dbg, 'Network.responseReceived', {
      requestId: 'r1', timestamp: 1.5, type: 'XHR',
      response: { status: 200, mimeType: 'application/json', headers: {} },
    });
    emitNetworkEvent(dbg, 'Network.loadingFinished', { requestId: 'r1', timestamp: 2 });

    const result = await service.networkCompareRequests({ sessionId, requestIds: ['r1'] });
    expect(result.comparison).toContain('至少需要两个请求');
  });

  it('对比两个请求输出稳定与变化字段', async () => {
    const { service, windows } = createService();
    const { sessionId } = await setupControlledSession(service);
    const dbg = windows[0].webContents.debugger;

    for (const id of ['r1', 'r2']) {
      emitNetworkEvent(dbg, 'Network.requestWillBeSent', {
        requestId: id, timestamp: 1, wallTime: 1000, type: 'XHR',
        request: { url: `https://example.com/api?ts=${id}`, method: 'GET', headers: {} },
      });
      emitNetworkEvent(dbg, 'Network.responseReceived', {
        requestId: id, timestamp: 1.5, type: 'XHR',
        response: { status: 200, mimeType: 'application/json', headers: {} },
      });
      emitNetworkEvent(dbg, 'Network.loadingFinished', { requestId: id, timestamp: 2 });
    }

    const result = await service.networkCompareRequests({ sessionId, requestIds: ['r1', 'r2'] });
    expect(result.comparison).toContain('Network 请求对比结果');
    expect(result.comparison).toContain('稳定字段');
    expect(result.comparison).toContain('变化字段');
  });
});

describe('P1-2 networkFindParameterCandidates', () => {
  it('识别签名参数候选', async () => {
    const { service, windows } = createService();
    const { sessionId } = await setupControlledSession(service);
    const dbg = windows[0].webContents.debugger;

    emitNetworkEvent(dbg, 'Network.requestWillBeSent', {
      requestId: 'r1', timestamp: 1, wallTime: 1000, type: 'XHR',
      request: { url: 'https://example.com/api?sign=abc123&timestamp=123', method: 'GET', headers: {} },
    });
    emitNetworkEvent(dbg, 'Network.responseReceived', {
      requestId: 'r1', timestamp: 1.5, type: 'XHR',
      response: { status: 200, mimeType: 'application/json', headers: {} },
    });
    emitNetworkEvent(dbg, 'Network.loadingFinished', { requestId: 'r1', timestamp: 2 });

    const result = await service.networkFindParameterCandidates({ sessionId, requestIds: ['r1'] });
    expect(result.candidates).toContain('签名字段');
    expect(result.candidates).toContain('时间戳字段');
  });
});

describe('P1-2 networkExtractJsCandidates', () => {
  it('从 JS 资源中提取候选片段', async () => {
    const { service, windows } = createService();
    const { sessionId } = await setupControlledSession(service);
    const dbg = windows[0].webContents.debugger;

    // 模拟一个 JS 资源请求
    emitNetworkEvent(dbg, 'Network.requestWillBeSent', {
      requestId: 'js1', timestamp: 1, wallTime: 1000, type: 'Script',
      request: { url: 'https://example.com/app.js', method: 'GET', headers: {} },
    });
    emitNetworkEvent(dbg, 'Network.responseReceived', {
      requestId: 'js1', timestamp: 1.5, type: 'Script',
      response: { status: 200, mimeType: 'application/javascript', headers: {} },
    });
    emitNetworkEvent(dbg, 'Network.loadingFinished', { requestId: 'js1', timestamp: 2 });

    // 覆盖 getResponseBody 返回包含 sign 关键词的 JS
    dbg.sendCommand.mockImplementation(async (method: string) => {
      if (method === 'Network.getResponseBody') {
        return { body: 'function signRequest(data) { return md5(data + "secret"); }', base64Encoded: false };
      }
      if (method === 'Accessibility.getFullAXTree') {
        return { nodes: [{ nodeId: 'root', backendDOMNodeId: 1, role: { value: 'RootWebArea' }, name: { value: 'Test' } }] };
      }
      return {};
    });

    const result = await service.networkExtractJsCandidates({
      sessionId,
      requestIds: ['js1'],
      keywords: ['sign', 'md5'],
    });
    expect(result.candidates).toContain('JS 候选资源');
    expect(result.candidates).toContain('sign');
    expect(result.candidates).toContain('md5');
  });

  it('无匹配 JS 资源返回未找到提示', async () => {
    const { service, windows } = createService();
    const { sessionId } = await setupControlledSession(service);
    const dbg = windows[0].webContents.debugger;

    emitNetworkEvent(dbg, 'Network.requestWillBeSent', {
      requestId: 'doc1', timestamp: 1, wallTime: 1000, type: 'Document',
      request: { url: 'https://example.com/page.html', method: 'GET', headers: {} },
    });
    emitNetworkEvent(dbg, 'Network.responseReceived', {
      requestId: 'doc1', timestamp: 1.5, type: 'Document',
      response: { status: 200, mimeType: 'text/html', headers: {} },
    });
    emitNetworkEvent(dbg, 'Network.loadingFinished', { requestId: 'doc1', timestamp: 2 });

    const result = await service.networkExtractJsCandidates({
      sessionId,
      requestIds: ['doc1'],
      keywords: ['sign'],
    });
    expect(result.candidates).toContain('未找到匹配的 JS 候选资源');
  });
});

describe('P1-2 networkWaitForRequests', () => {
  it('已有匹配立即返回', async () => {
    const { service, windows } = createService();
    const { sessionId } = await setupControlledSession(service);
    const dbg = windows[0].webContents.debugger;

    emitNetworkEvent(dbg, 'Network.requestWillBeSent', {
      requestId: 'r1', timestamp: 1, wallTime: 1000, type: 'XHR',
      request: { url: 'https://api.example.com/data', method: 'GET', headers: {} },
    });

    const result = await service.networkWaitForRequests({
      sessionId,
      filter: { urlIncludes: 'api.example.com' },
    });
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0].id).toBe('r1');
  });

  it('无匹配超时返回空', async () => {
    const { service, windows } = createService();
    const { sessionId } = await setupControlledSession(service);

    const result = await service.networkWaitForRequests({
      sessionId,
      filter: { urlIncludes: 'nonexistent', timeoutMs: 50 },
    });
    expect(result.requests).toEqual([]);
  });
});
