/**
 * P1-2 新增：Network 脱敏与 prompt 格式化单测。
 *
 * 覆盖：
 * - redactNetworkRequestDetail / redactNetworkRequestMeta 敏感字段脱敏
 *   （authorization / cookie / token / password / secret / csrf / sid）
 * - redactNetworkText 表单与 JSON 脱敏
 * - parseRelevantNetworkRequestIds JSON / req-N / 文本候选解析
 * - createNetworkContextPrompt 格式化输出
 * - formatNetworkAttachmentSummary / formatNetworkAttachmentForExport
 */

import { describe, expect, it } from 'vitest';
import {
  redactNetworkRequestDetail,
  redactNetworkRequestMeta,
  redactNetworkText,
  parseRelevantNetworkRequestIds,
  createNetworkContextPrompt,
  formatNetworkAttachmentSummary,
  formatNetworkAttachmentForExport,
} from '@shared/agent-browser/network-context';
import type { NetworkHeader, NetworkRequestDetail, NetworkRequestMeta } from '@shared/agent-browser/types';

const REDACTED = '[已脱敏]';

function makeDetail(overrides: Partial<NetworkRequestDetail> = {}): NetworkRequestDetail {
  return {
    id: 'req-1',
    url: 'https://example.com/api?v=1',
    method: 'GET',
    status: 200,
    statusText: 'OK',
    mimeType: 'application/json',
    resourceType: 'XHR',
    requestHeaders: [{ name: 'Authorization', value: 'Bearer secret-token' }],
    responseHeaders: [{ name: 'Set-Cookie', value: 'session=abc123' }],
    requestBody: JSON.stringify({ username: 'ada', password: 'p@ss' }),
    responseBody: JSON.stringify({ token: 'tok-1', data: { ok: true } }),
    truncated: false,
    redacted: false,
    ...overrides,
  };
}

describe('P1-2 redactNetworkRequestDetail', () => {
  it('脱敏 Authorization 请求头', () => {
    const redacted = redactNetworkRequestDetail(makeDetail());
    const auth = redacted.requestHeaders?.find((h) => h.name === 'Authorization');
    expect(auth?.value).toBe(REDACTED);
  });

  it('脱敏 Set-Cookie 响应头', () => {
    const redacted = redactNetworkRequestDetail(makeDetail());
    const cookie = redacted.responseHeaders?.find((h) => h.name === 'Set-Cookie');
    expect(cookie?.value).toBe(REDACTED);
  });

  it('脱敏 JSON body 中的 password 字段', () => {
    const redacted = redactNetworkRequestDetail(makeDetail());
    const body = JSON.parse(redacted.requestBody ?? '{}') as Record<string, unknown>;
    expect(body.password).toBe(REDACTED);
    expect(body.username).toBe('ada');
  });

  it('脱敏 JSON body 中的 token 字段', () => {
    const redacted = redactNetworkRequestDetail(makeDetail());
    const body = JSON.parse(redacted.responseBody ?? '{}') as Record<string, unknown>;
    expect(body.token).toBe(REDACTED);
  });

  it('标记 redacted=true', () => {
    const redacted = redactNetworkRequestDetail(makeDetail());
    expect(redacted.redacted).toBe(true);
  });

  it('脱敏 URL 中的 access_token 查询参数', () => {
    const detail = makeDetail({ url: 'https://example.com/api?access_token=secret&v=1' });
    const redacted = redactNetworkRequestDetail(detail);
    expect(redacted.url).toContain('access_token=' + REDACTED);
    expect(redacted.url).toContain('v=1');
  });

  it('保留非敏感字段不变', () => {
    const detail = makeDetail({
      requestHeaders: [{ name: 'Content-Type', value: 'application/json' }],
    });
    const redacted = redactNetworkRequestDetail(detail);
    const ct = redacted.requestHeaders?.find((h) => h.name === 'Content-Type');
    expect(ct?.value).toBe('application/json');
  });
});

describe('P1-2 redactNetworkRequestMeta', () => {
  it('脱敏 meta 中的敏感头', () => {
    const meta: NetworkRequestMeta = {
      id: 'req-2',
      url: 'https://example.com/',
      method: 'POST',
      requestHeaders: [{ name: 'Cookie', value: 'sid=xyz' }],
    };
    const redacted = redactNetworkRequestMeta(meta);
    const cookie = redacted.requestHeaders?.find((h) => h.name === 'Cookie');
    expect(cookie?.value).toBe(REDACTED);
  });

  it('脱敏 meta 中的表单 body', () => {
    const meta: NetworkRequestMeta = {
      id: 'req-3',
      url: 'https://example.com/',
      method: 'POST',
      requestBody: 'session=abc&keep=1',
    };
    const redacted = redactNetworkRequestMeta(meta);
    // URLSearchParams.toString() 会对值做 URL 编码，[已脱敏] 变成 %5B...%5D
    const decoded = decodeURIComponent(redacted.requestBody ?? '');
    expect(decoded).toContain('session=' + REDACTED);
    expect(decoded).toContain('keep=1');
  });
});

describe('P1-2 redactNetworkText', () => {
  it('脱敏 JSON 文本', () => {
    const text = JSON.stringify({ api_key: 'sk-xxx', name: 'ada' });
    const redacted = redactNetworkText(text);
    const parsed = JSON.parse(redacted) as Record<string, unknown>;
    expect(parsed.api_key).toBe(REDACTED);
    expect(parsed.name).toBe('ada');
  });

  it('脱敏表单文本', () => {
    const text = 'csrf=abc&value=1';
    const redacted = redactNetworkText(text);
    // URLSearchParams.toString() 会对值做 URL 编码
    const decoded = decodeURIComponent(redacted);
    expect(decoded).toContain('csrf=' + REDACTED);
    expect(decoded).toContain('value=1');
  });

  it('空字符串返回空', () => {
    expect(redactNetworkText('')).toBe('');
  });
});

describe('P1-2 parseRelevantNetworkRequestIds', () => {
  const available: NetworkRequestMeta[] = [
    { id: 'req-a', url: 'https://example.com/a', method: 'GET' },
    { id: 'req-b', url: 'https://example.com/b', method: 'POST' },
    { id: 'req-c', url: 'https://example.com/c', method: 'GET' },
  ];

  it('解析 JSON 数组中的 requestIds 字段', () => {
    const content = JSON.stringify({ requestIds: ['req-a', 'req-c'] });
    expect(parseRelevantNetworkRequestIds(content, available)).toEqual(['req-a', 'req-c']);
  });

  it('解析 req-N 序号', () => {
    const content = '请查看 req-1 和 req-3';
    expect(parseRelevantNetworkRequestIds(content, available)).toEqual(['req-a', 'req-c']);
  });

  it('去重', () => {
    const content = JSON.stringify({ requestIds: ['req-a', 'req-a'] });
    expect(parseRelevantNetworkRequestIds(content, available)).toEqual(['req-a']);
  });

  it('忽略不存在的 id', () => {
    const content = JSON.stringify({ requestIds: ['req-a', 'req-zzz'] });
    expect(parseRelevantNetworkRequestIds(content, available)).toEqual(['req-a']);
  });
});

describe('P1-2 createNetworkContextPrompt', () => {
  it('包含 method、url、status', () => {
    const prompt = createNetworkContextPrompt({
      userDemand: '分析请求',
      details: [makeDetail()],
    });
    expect(prompt).toContain('Network context:');
    expect(prompt).toContain('分析请求');
    expect(prompt).toContain('GET');
    expect(prompt).toContain('https://example.com/api?v=1');
    expect(prompt).toContain('Status: 200');
  });

  it('多请求以分隔符连接', () => {
    const prompt = createNetworkContextPrompt({
      userDemand: '对比',
      details: [makeDetail(), makeDetail({ id: 'req-2', method: 'POST' })],
    });
    expect(prompt).toContain('Request 1:');
    expect(prompt).toContain('Request 2:');
    expect(prompt).toContain('---');
  });
});

describe('P1-2 formatNetworkAttachmentSummary', () => {
  it('空列表返回未注入提示', () => {
    expect(formatNetworkAttachmentSummary([])).toBe('未注入 Network 请求');
  });

  it('非空列表返回首请求摘要', () => {
    const summary = formatNetworkAttachmentSummary([makeDetail()]);
    expect(summary).toContain('1 个 Network 请求');
    expect(summary).toContain('GET');
    expect(summary).toContain('200');
  });
});

describe('P1-2 formatNetworkAttachmentForExport', () => {
  it('空列表返回空字符串', () => {
    expect(formatNetworkAttachmentForExport([])).toBe('');
  });

  it('非空列表返回 prompt 文本', () => {
    const exportText = formatNetworkAttachmentForExport([makeDetail()]);
    expect(exportText).toContain('Network context:');
    expect(exportText).toContain('聊天记录中保存的 Network 请求详情');
  });
});
