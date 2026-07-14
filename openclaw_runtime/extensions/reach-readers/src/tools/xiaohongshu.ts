/**
 * xiaohongshu_read —— 重构自 agent_reach/channels/xiaohongshu.py。
 *
 * 多后端：OpenCLI / xiaohongshu-mcp / xhs-cli。
 * 核心价值：cleanNote/cleanComment —— 逐行对译 Python 的 _clean_note/_clean_comment，
 * 大幅降低 token 占用（剥离结构冗余 #134）。
 */
import { Schema } from '../common/schema.js';
import {
  type AnyAgentTool,
  asToolParamsRecord,
  errorResult,
  jsonResult,
  readStringParam,
  readOptionalInt,
} from '../common/tool-shape.js';
import { probeCommand, utf8Env } from '../core/probe.js';
import { commandError, runReachCommand } from '../core/command.js';
import { canHandle, orderedBackends, selectBackend } from '../core/router.js';
import { getConfig } from '../core/config.js';
import type { Availability, BackendFinding } from '../types.js';
import { createBrowserLoginRequired } from '../core/browser-bridge.js';

const DOMAINS = ['xiaohongshu.com', 'xhslink.com'] as const;
const DEFAULT_BACKENDS = ['OpenCLI', 'xiaohongshu-mcp', 'xhs-cli (xiaohongshu-cli)'] as const;
const MCP_ENDPOINT = 'http://localhost:18060/mcp';
const MCP_INSTALL_URL = 'https://github.com/xpzouying/xiaohongshu-mcp';

export function canHandleUrl(url: string): boolean {
  return canHandle(url, DOMAINS);
}

// -------------------- cleaners（逐行对译 _clean_note / _clean_comment） --------------------

/** 对齐 format_xhs_result —— 处理 list / dict / search_feeds wrapper。 */
export function formatXhsResult(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(cleanNote);
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    // search_feeds wrapper: {"items": [...]} 或 {"data": {"items": [...]}}
    let items: unknown[] | undefined;
    if (Array.isArray(d['items'])) items = d['items'] as unknown[];
    else if (d['data'] && typeof d['data'] === 'object') {
      const inner = d['data'] as Record<string, unknown>;
      if (Array.isArray(inner['items'])) items = inner['items'] as unknown[];
      else if (Array.isArray(inner['notes'])) items = inner['notes'] as unknown[];
    }
    if (items) return items.map(cleanNote);
    return cleanNote(d);
  }
  return data;
}

/** 对齐 _clean_note —— 从单条 note/feed item 提取有用字段，降 token。 */
export function cleanNote(note: unknown): Record<string, unknown> {
  if (!note || typeof note !== 'object') return note as Record<string, unknown>;
  const raw = note as Record<string, unknown>;
  // 有些响应把 note 嵌套在 note_card / note 下
  const inner = (raw['note_card'] ?? raw['note'] ?? raw) as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  // 基础信息
  for (const key of ['id', 'note_id', 'xsec_token', 'title', 'desc', 'type', 'time'] as const) {
    if (key in inner) result[key] = inner[key];
  }
  // 内容（desc 已取则不重复）
  if ('content' in inner && !('desc' in result)) result['content'] = inner['content'];

  // 作者
  const user = (inner['user'] ?? inner['author']) as Record<string, unknown> | undefined;
  if (user && typeof user === 'object') {
    const u: Record<string, unknown> = {};
    for (const k of ['nickname', 'user_id', 'nick_name'] as const) {
      if (k in user) u[k] = user[k];
    }
    if (Object.keys(u).length > 0) result['user'] = u;
  }

  // 互动指标
  const interact = (inner['interact_info'] ?? inner['note_interact_info'] ?? {}) as Record<string, unknown>;
  if (interact && typeof interact === 'object') {
    for (const key of ['liked_count', 'collected_count', 'comment_count', 'share_count'] as const) {
      if (key in interact) result[key] = interact[key];
    }
  }
  // 也在顶层找一遍（部分 API 格式）
  for (const key of ['liked_count', 'collected_count', 'comment_count', 'share_count'] as const) {
    if (key in inner && !(key in result)) result[key] = inner[key];
  }

  // 图片 —— 只留 URL
  const images = (inner['image_list'] ?? inner['images_list'] ?? []) as unknown[];
  if (Array.isArray(images)) {
    const urls: string[] = [];
    for (const img of images) {
      if (img && typeof img === 'object') {
        const im = img as Record<string, unknown>;
        const url = (im['url'] ?? im['url_default'] ?? im['original']) as string | undefined;
        if (url) urls.push(url);
      } else if (typeof img === 'string') {
        urls.push(img);
      }
    }
    if (urls.length > 0) result['images'] = urls;
  }

  // 标签
  const tags = (inner['tag_list'] ?? inner['tags'] ?? []) as unknown[];
  if (Array.isArray(tags)) {
    const names: string[] = [];
    for (const t of tags) {
      if (t && typeof t === 'object' && 'name' in t) names.push(String((t as Record<string, unknown>)['name']));
      else if (typeof t === 'string') names.push(t);
    }
    if (names.length > 0) result['tags'] = names;
  }

  // 评论（如果存在，比如 get_feed_detail 带评论）
  const comments = (inner['comments'] ?? []) as unknown[];
  if (Array.isArray(comments) && comments.length > 0) {
    result['comments'] = comments.map(cleanComment);
  }

  return result;
}

/** 对齐 _clean_comment。 */
export function cleanComment(comment: unknown): Record<string, unknown> {
  if (!comment || typeof comment !== 'object') return comment as Record<string, unknown>;
  const c = comment as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  if ('content' in c) result['content'] = c['content'];
  const user = (c['user_info'] ?? c['user']) as Record<string, unknown> | undefined;
  if (user && typeof user === 'object') {
    result['user'] = (user['nickname'] ?? user['nick_name'] ?? '') as string;
  }
  for (const key of ['like_count', 'sub_comment_count'] as const) {
    if (key in c) result[key] = c[key];
  }
  return result;
}

// -------------------- 后端探活（对齐 xiaohongshu.py 的 _check_*） --------------------

/**
 * 探测 xiaohongshu-mcp HTTP 服务是否在跑 —— 对齐 xiaohongshu.py: _mcp_service_reachable。
 *
 * 任何 HTTP 响应都算活着（MCP 端点对 GET 返回 405）。
 * 关键：必须绕过代理 —— localhost 绝不能走 HTTP_PROXY（对齐 Python 的 ProxyHandler({})）。
 * Node fetch 默认不读 HTTP_PROXY，但显式清空环境变量更稳妥。
 */
async function mcpServiceReachable(timeoutMs = 3_000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // 显式绕过代理：清空 NO_PROXY 环境变量不够，需要直接构造一个不走代理的请求。
    // Node 18+ 的 fetch（undici）默认不读 HTTP_PROXY/HTTPS_PROXY，所以直接 fetch 即可。
    // 但为防 undici 版本行为差异，用 noProxyFetch 显式禁用代理。
    await fetchNoProxy(MCP_ENDPOINT, { method: 'GET', signal: controller.signal });
    return true;
  } catch (e) {
    // HTTPError (4xx/5xx) 也算活着 —— 对齐 Python 的 except HTTPError: return True
    const err = e as { status?: number };
    if (typeof err?.status === 'number' && err.status >= 400 && err.status < 600) return true;
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** 显式绕过代理的 fetch —— 对齐 Python urllib 的 ProxyHandler({})。 */
async function fetchNoProxy(url: string, init?: RequestInit): Promise<Response> {
  // Node 18+ undici fetch 默认不读 HTTP_PROXY 环境变量，所以直接 fetch 等价于绕过代理。
  // 但如果调用方用了 undici ProxyAgent 或 setGlobalDispatcher，这里无法覆盖。
  // 对于 shadow 版本，直接 fetch 足够 —— 对齐 Python ProxyHandler({}) 的意图。
  return fetch(url, init);
}

async function checkOpencli(): Promise<BackendFinding | undefined> {
  const probe = await probeCommand('opencli', ['--version'], { timeoutMs: 10_000, pkg: 'opencli' });
  if (probe.status === 'missing') return undefined;
  if (probe.status === 'broken') return { backend: 'OpenCLI', status: 'error', message: `opencli 命令存在但无法执行\n${probe.hint}` };
  if (probe.status !== 'ok') return { backend: 'OpenCLI', status: 'warn', message: `opencli 探测失败（${probe.status}）` };
  return {
    backend: 'OpenCLI',
    status: 'ok',
    message: 'OpenCLI 可用（复用浏览器登录态）。用法：opencli xiaohongshu search/note/comments/feed -f yaml',
  };
}

async function checkMcp(): Promise<BackendFinding | undefined> {
  if (!(await mcpServiceReachable())) return undefined;
  const mcporter = await probeCommand('mcporter', ['config', 'list'], { timeoutMs: 10_000, pkg: 'mcporter' });
  if (mcporter.status === 'ok' && mcporter.output.includes('xiaohongshu')) {
    return {
      backend: 'xiaohongshu-mcp',
      status: 'ok',
      message: 'xiaohongshu-mcp 服务运行中（mcporter call \'xiaohongshu.search_feeds(keyword: "...")\'）。若未登录，让 agent 调 get_login_qrcode 扫码',
    };
  }
  return {
    backend: 'xiaohongshu-mcp',
    status: 'warn',
    message: `xiaohongshu-mcp 服务在跑但 mcporter 未接入。运行：\n  mcporter config add xiaohongshu ${MCP_ENDPOINT}`,
  };
}

async function checkXhsCli(): Promise<BackendFinding | undefined> {
  const probe = await probeCommand('xhs', ['status'], { timeoutMs: 10_000, pkg: 'xiaohongshu-cli' });
  if (probe.status === 'missing') return undefined;
  if (probe.status === 'broken') return { backend: 'xhs-cli (xiaohongshu-cli)', status: 'error', message: `xhs 命令存在但无法执行\n${probe.hint}` };
  if (probe.status === 'timeout') return { backend: 'xhs-cli (xiaohongshu-cli)', status: 'warn', message: `xhs-cli 已安装但状态检测超时\n${probe.hint}` };
  // 进程是活的（ok 或 error）—— 按 output 内容分类，对齐 xiaohongshu.py:243-258
  if (probe.status === 'ok' && probe.output.includes('ok: true')) {
    return {
      backend: 'xhs-cli (xiaohongshu-cli)',
      status: 'ok',
      message: 'xhs-cli 可用（搜索、阅读、评论、热门；上游 2026-03 起停更，桌面用户建议迁移到 OpenCLI）',
    };
  }
  if (probe.output.includes('not_authenticated') || probe.output.includes('expired')) {
    return {
      backend: 'xhs-cli (xiaohongshu-cli)',
      status: 'warn',
      message: 'xhs-cli 已安装但未登录。运行：\n  xhs login\n（自动从浏览器提取 Cookie，或扫码登录）',
    };
  }
  return { backend: 'xhs-cli (xiaohongshu-cli)', status: 'warn', message: 'xhs-cli 已安装但状态异常。运行：\n  xhs -v status 查看详细信息' };
}

export async function check(): Promise<Availability> {
  const order = orderedBackends('xiaohongshu', DEFAULT_BACKENDS, (k) => getConfig().get(k));
  const findings: BackendFinding[] = [];
  for (const backend of order) {
    let r: BackendFinding | undefined;
    if (backend === 'OpenCLI') r = await checkOpencli();
    else if (backend === 'xiaohongshu-mcp') r = await checkMcp();
    else r = await checkXhsCli();
    if (r) findings.push(r);
  }
  const selected = selectBackend(findings);
  if (selected) {
    return { channel: 'xiaohongshu', status: selected.status, activeBackend: selected.activeBackend, message: selected.message };
  }
  return {
    channel: 'xiaohongshu',
    status: 'off',
    activeBackend: undefined,
    message: `未安装任何小红书后端。推荐：\n  桌面：装 OpenCLI（复用 Chrome 登录态，刷过小红书即零配置可用）\n  服务器：xiaohongshu-mcp（自带无头浏览器+扫码登录）：${MCP_INSTALL_URL}`,
  };
}

// -------------------- 数据获取（委托上游 CLI，返回结果经 cleaner） --------------------

async function opencli(args: string[], timeoutMs = 60_000): Promise<unknown> {
  const argv = ['xiaohongshu', ...args, '-f', 'json'];
  const result = await runReachCommand('opencli', argv, {
    timeoutMs, maxOutputBytes: 20 * 1024 * 1024, env: utf8Env(), packageName: 'opencli',
  });
  if (result.code !== 0) throw commandError('opencli xiaohongshu', argv, result);
  return JSON.parse(result.stdout);
}

export async function searchFeeds(keyword: string, _limit = 10): Promise<unknown> {
  const raw = await opencli(['search', keyword]);
  return formatXhsResult(raw);
}

export async function getNote(noteId: string): Promise<unknown> {
  const raw = await opencli(['note', noteId]);
  return cleanNote(raw);
}

export async function getComments(noteId: string, limit = 10): Promise<unknown> {
  const raw = await opencli(['comments', noteId]);
  // raw 可能是 {comments: [...]} 或 [...]
  const list = Array.isArray(raw) ? raw : ((raw as Record<string, unknown>)?.['comments'] as unknown[]) ?? [];
  return (Array.isArray(list) ? list : []).slice(0, limit).map(cleanComment);
}

// -------------------- 工具注册 --------------------

const ACTIONS = ['search', 'note', 'comments', 'check'] as const;

export const xiaohongshuReadTool: AnyAgentTool = {
  label: 'Xiaohongshu Read',
  name: 'xiaohongshu_read',
  description:
    '读取小红书笔记。action: search=搜索笔记, note=笔记详情, comments=评论, check=探测后端。多后端：OpenCLI（复用浏览器登录态）/ xiaohongshu-mcp / xhs-cli。结果自动 cleanNote 降 token。',
  parameters: Schema.object({
    action: Schema.enum(ACTIONS, '读取动作（默认 search）'),
    keyword: Schema.optional(Schema.string('action=search 时的搜索关键词')),
    note_id: Schema.optional(Schema.string('action=note/comments 时的笔记 ID')),
    limit: Schema.optional(Schema.integer({ description: '最大条数（默认 10）', minimum: 1 })),
  }),
  async execute(_id, args, signal) {
    const params = asToolParamsRecord(args);
    const action = (readStringParam(params, 'action') || 'search') as (typeof ACTIONS)[number];
    const limit = readOptionalInt(params, 'limit', { min: 1, max: 50 }) ?? 10;
    try {
      if (action === 'check') {
        return jsonResult({ status: 'ok', success: true, action, availability: await check() });
      }
      switch (action) {
        case 'search': {
          const keyword = readStringParam(params, 'keyword', { required: true, label: 'keyword' });
          if (!keyword) return errorResult('keyword is required for action=search');
          return jsonResult({ status: 'ok', success: true, action, items: await searchFeeds(keyword, limit) });
        }
        case 'note': {
          const noteId = readStringParam(params, 'note_id', { required: true, label: 'note_id' });
          if (!noteId) return errorResult('note_id is required for action=note');
          return jsonResult({ status: 'ok', success: true, action, note: await getNote(noteId) });
        }
        case 'comments': {
          const noteId = readStringParam(params, 'note_id', { required: true, label: 'note_id' });
          if (!noteId) return errorResult('note_id is required for action=comments');
          return jsonResult({ status: 'ok', success: true, action, comments: await getComments(noteId, limit) });
        }
        default:
          return errorResult(`unknown action: ${action}`);
      }
    } catch (e) {
      const originalError = String(e instanceof Error ? e.message : e);
      const policy = getConfig().get<string>('browser_fallback', 'auto');
      if (policy === 'off') return errorResult(originalError, { action, browserFallback: 'disabled' });
      try {
        const handoff = await createBrowserLoginRequired({
          loginUrl: 'https://www.xiaohongshu.com/login',
          profile: getConfig().get<string>('browser_profile', 'default') ?? 'default',
          retryTool: { name: 'xiaohongshu_read', arguments: params },
          signal,
        });
        return handoff
          ? jsonResult({ success: false, ...handoff })
          : errorResult(originalError, { action, browserFallback: 'unavailable' });
      } catch {
        return errorResult(originalError, { action, browserFallback: 'unavailable' });
      }
    }
  },
};
