/**
 * web_read —— 重构自 agent_reach/channels/web.py。
 *
 * 唯一动作：Jina Reader 读任意 URL → Markdown 全文。恒可用兜底，零配置。
 * 形状对齐 ClawX web_fetch（但只走 Jina Reader，不引 SSRF guard —— 那是 ClawX 侧职责）。
 */
import { Schema } from '../common/schema.js';
import {
  type AnyAgentTool,
  asToolParamsRecord,
  errorResult,
  jsonResult,
  readStringParam,
} from '../common/tool-shape.js';
import { httpText } from '../core/http.js';
import { canHandleAny } from '../core/router.js';
import type { Availability } from '../types.js';
import { getConfig } from '../core/config.js';
import { getReachBrowserBridge } from '../core/browser-bridge.js';

const JINA_PREFIX = 'https://r.jina.ai/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

export function canHandle(url: string): boolean {
  return canHandleAny(url);
}

export async function check(): Promise<Availability> {
  // 对齐 web.py：恒可用兜底，不做网络探测
  return {
    channel: 'web',
    status: 'ok',
    activeBackend: 'Jina Reader',
    message: '通过 Jina Reader 读取任意网页（curl https://r.jina.ai/URL）',
  };
}

/** 通过 Jina Reader 读取网页，返回 Markdown 全文 —— 对齐 web.py: read()。 */
export async function readUrl(url: string, timeoutMs = 30_000): Promise<string> {
  const target = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
  return httpText(`${JINA_PREFIX}${target}`, {
    headers: { 'User-Agent': UA, Accept: 'text/plain' },
    timeoutMs,
  });
}

export const webReadTool: AnyAgentTool = {
  label: 'Web Read',
  name: 'web_read',
  description:
    '读取任意网页全文（Markdown）。零配置，恒可用。通过 Jina Reader 代理。适合普通文章/博客/文档；JS 重渲染或需登录的页面效果差。',
  parameters: Schema.object({
    url: Schema.string('要读取的网页 URL（http/https 可省略）'),
  }),
  async execute(_id, args, signal) {
    const params = asToolParamsRecord(args);
    const url = readStringParam(params, 'url', { required: true, label: 'url' });
    if (!url) return errorResult('url is required');
    try {
      const text = await readUrl(url);
      return jsonResult({
        status: 'ok',
        success: true,
        backend: 'Jina Reader',
        url,
        content: text,
        length: text.length,
      });
    } catch (e) {
      const originalError = String(e instanceof Error ? e.message : e);
      const policy = getConfig().get<string>('browser_fallback', 'auto');
      const bridge = getReachBrowserBridge();
      if (policy === 'off') {
        return errorResult(originalError, { url, browserFallback: 'disabled' });
      }
      if (!bridge) {
        return errorResult(originalError, { url, browserFallback: 'unavailable' });
      }
      try {
        const profile = getConfig().get<string>('browser_profile', 'default') ?? 'default';
        if (policy === 'handoff') {
          const handoff = await bridge.openLoginSession(url, { profile, signal });
          return jsonResult({
            status: 'browser_login_required',
            success: false,
            ...handoff,
            retryTool: { name: 'web_read', arguments: params },
          });
        }
        const page = await bridge.readPage(url, { profile, signal });
        return jsonResult({
          status: 'ok',
          success: true,
          backend: 'agent-browser',
          browserFallback: 'used',
          url: page.url,
          title: page.title,
          content: page.text,
          length: page.text.length,
        });
      } catch {
        return errorResult(originalError, { url, browserFallback: 'unavailable' });
      }
    }
  },
};
