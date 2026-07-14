/**
 * xueqiu_read —— 重构自 agent_reach/channels/xueqiu.py。
 *
 * 雪球的反爬依赖 session cookie。Python 版三段式获取 cookie：
 *   1) config.yaml 的 xueqiu_cookie
 *   2) rookiepy/browser_cookie3 从本地 Chrome 提取
 *   3) 访问首页拿 acw_tc（不够，但避免硬失败）
 *
 * shadow 版同样三段式：
 *   1) config.json 的 xueqiu_cookie
 *   2) 跳过浏览器提取（Node 无 rookiepy 等价物，注释说明迁移到 ClawX 时
 *      可复用 agent_browser 的 cookie store）
 *   3) 访问首页 fallback —— 手动解析 Set-Cookie 并存入 cookieJar，
 *      使后续请求能带上 acw_tc 等 session cookie（对齐 Python 的 HTTPCookieProcessor）
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
import { canHandle } from '../core/router.js';
import { getConfig } from '../core/config.js';
import { readResponseWithLimit } from 'openclaw/plugin-sdk/response-limit-runtime';
import { withGuardedResponse } from '../core/http.js';
import { getReachBrowserBridge } from '../core/browser-bridge.js';
import type { Availability } from '../types.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REFERER = 'https://xueqiu.com/';
const DOMAINS = ['xueqiu.com'] as const;
const TIMEOUT = 10_000;
const HOME = 'https://xueqiu.com';

// 模块级 cookie store —— 对齐 xueqiu.py 的 _cookie_jar。
// Map<name, value>，手动维护以弥补 fetch 无 cookie jar 的缺陷。
const cookieJar = new Map<string, string>();
let cookiesInitialized = false;

/** 注入 cookie 字符串 —— 对齐 _inject_cookie_string。 */
export function injectCookieString(s: string): void {
  for (const pair of s.split(';')) {
    const trimmed = pair.trim();
    if (!trimmed.includes('=')) continue;
    const eqIdx = trimmed.indexOf('=');
    const name = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (name) cookieJar.set(name, value);
  }
}

/** 把 cookieJar 序列化成 Cookie 请求头值。 */
function cookieHeader(): string {
  if (cookieJar.size === 0) return '';
  return Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * 从 Set-Cookie 响应头提取 cookie 名值对 —— 对齐 Python http.cookiejar 的解析行为。
 * Set-Cookie 值形如 "name=value; Path=/; Domain=.xueqiu.com; ..."，只取第一段的 name=value。
 */
function parseSetCookie(headers: Headers): void {
  // getSetCookie 是 Node 18+ undici 的 API，返回所有 Set-Cookie 值数组
  const setCookies = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const sc of setCookies) {
    const firstPart = sc.split(';')[0] ?? '';
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = firstPart.slice(0, eqIdx).trim();
    const value = firstPart.slice(eqIdx + 1).trim();
    if (name) cookieJar.set(name, value);
  }
}

/** 三段式 cookie 获取 —— 对齐 _ensure_cookies。 */
async function ensureCookies(): Promise<void> {
  if (cookiesInitialized) return;
  // 1) config.json 的 xueqiu_cookie
  const fromConfig = getConfig().get<string>('xueqiu_cookie');
  if (fromConfig) {
    injectCookieString(fromConfig);
    cookiesInitialized = true;
    return;
  }
  const browserPolicy = getConfig().get<string>('browser_fallback', 'auto');
  const bridge = getReachBrowserBridge();
  if (browserPolicy === 'auto' && bridge) {
    try {
      const cookies = await bridge.readCookies(
        ['.xueqiu.com', 'xueqiu.com'],
        undefined,
        { profile: getConfig().get<string>('browser_profile', 'default') ?? 'default' },
      );
      if (cookies.some((cookie) => cookie.name === 'xq_a_token' && cookie.value)) {
        for (const cookie of cookies) {
          if (cookie.name) cookieJar.set(cookie.name, cookie.value);
        }
        cookiesInitialized = true;
        return;
      }
    } catch {
      // Preserve the original homepage fallback when the bridge is unavailable.
    }
  }
  // 2) 浏览器提取 —— Node 无 rookiepy 等价物；迁移到 ClawX 时可复用 agent_browser 的 cookie store。
  //    这里跳过（对齐 Python 版在无 browser_cookie3 时的 fallback 行为）。
  // 3) 访问首页 fallback —— 拿 acw_tc（反 DDOS cookie）。
  //    手动解析 Set-Cookie 存入 cookieJar，使后续请求能带上 session cookie。
  //    对齐 xueqiu.py:126-128 的 _opener.open(req) + HTTPCookieProcessor(_cookie_jar)。
  try {
    await withGuardedResponse(HOME, { headers: { 'User-Agent': UA }, timeoutMs: TIMEOUT }, async (resp) => {
      // 解析 Set-Cookie 并存入 cookieJar —— 对齐 HTTPCookieProcessor 自动持久化
      parseSetCookie(resp.headers);
    });
  } catch {
    // ignore —— 首页访问失败不阻塞，后续 API 请求会自然 400/403
  }
  cookiesInitialized = true;
}

/** 带 cookie 的 JSON 请求 —— 对齐 _get_json。 */
async function getXueqiuJson<T>(url: string): Promise<T> {
  await ensureCookies();
  const headers: Record<string, string> = { 'User-Agent': UA, Referer: REFERER };
  const ck = cookieHeader();
  if (ck) headers['Cookie'] = ck;
  return withGuardedResponse(url, { headers, timeoutMs: TIMEOUT }, async (resp) => {
    // 即使是 API 请求，也把新 Set-Cookie 存入 jar（session 续期）
    parseSetCookie(resp.headers);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${url}`);
    }
    const body = await readResponseWithLimit(resp, 10 * 1024 * 1024);
    return JSON.parse(body.toString('utf8')) as T;
  });
}

export function canHandleUrl(url: string): boolean {
  return canHandle(url, DOMAINS);
}

export async function check(): Promise<Availability> {
  try {
    const data = await getXueqiuJson<{ data?: { items?: unknown[] } }>(
      'https://stock.xueqiu.com/v5/stock/batch/quote.json?symbol=SH000001',
    );
    const items = data?.data?.items ?? [];
    if (items.length > 0) {
      return {
        channel: 'xueqiu',
        status: 'ok',
        activeBackend: 'Xueqiu API (需要登录 Cookie)',
        message: '公开 API 可用（行情、搜索、热帖、热股）',
      };
    }
    return { channel: 'xueqiu', status: 'warn', activeBackend: undefined, message: 'API 响应异常（返回数据为空）' };
  } catch (e) {
    return {
      channel: 'xueqiu',
      status: 'warn',
      activeBackend: undefined,
      message: `Xueqiu API 连接失败：${e instanceof Error ? e.message : e}。请先登录雪球后运行：agent-reach configure --from-browser chrome`,
    };
  }
}

// -------------------- 数据获取（对齐 xueqiu.py 各方法） --------------------

export async function getStockQuote(symbol: string): Promise<Record<string, unknown>> {
  const data = await getXueqiuJson<{ data?: { items?: Array<{ quote?: Record<string, unknown> }> } }>(
    `https://stock.xueqiu.com/v5/stock/batch/quote.json?symbol=${encodeURIComponent(symbol)}`,
  );
  const q = data?.data?.items?.[0]?.quote ?? {};
  return {
    symbol: q['symbol'] ?? symbol,
    name: q['name'] ?? '',
    current: q['current'],
    percent: q['percent'],
    chg: q['chg'],
    high: q['high'],
    low: q['low'],
    open: q['open'],
    last_close: q['last_close'],
    volume: q['volume'],
    amount: q['amount'],
    market_capital: q['market_capital'],
    turnover_rate: q['turnover_rate'],
    pe_ttm: q['pe_ttm'],
    timestamp: q['timestamp'],
  };
}

export async function searchStock(query: string, limit = 10): Promise<{ symbol: string; name: string; exchange: string }[]> {
  const data = await getXueqiuJson<{ stocks?: Array<{ code?: string; name?: string; exchange?: string }> }>(
    `https://xueqiu.com/stock/search.json?code=${encodeURIComponent(query)}&size=${limit}`,
  );
  return (data?.stocks ?? []).slice(0, limit).map((s) => ({
    symbol: s.code ?? '',
    name: s.name ?? '',
    exchange: s.exchange ?? '',
  }));
}

export async function getHotPosts(limit = 20): Promise<{ id: number; title: string; text: string; author: string; likes: number; url: string }[]> {
  const data = await getXueqiuJson<{ list?: Array<{ data?: string }> }>(
    'https://xueqiu.com/v4/statuses/public_timeline_by_category.json?since_id=-1&max_id=-1&count=20&category=-1',
  );
  const items = data?.list ?? [];
  const out: { id: number; title: string; text: string; author: string; likes: number; url: string }[] = [];
  for (const item of items.slice(0, limit)) {
    let post: Record<string, unknown>;
    try {
      post = typeof item.data === 'string' ? (JSON.parse(item.data) as Record<string, unknown>) : {};
    } catch {
      post = {};
    }
    const user = (post['user'] as Record<string, unknown> | undefined) ?? {};
    const text = stripHtml(String(post['text'] ?? post['description'] ?? ''));
    const target = String(post['target'] ?? '');
    out.push({
      id: Number(post['id'] ?? 0),
      title: String(post['title'] ?? ''),
      text: text.slice(0, 200),
      author: String(user['screen_name'] ?? ''),
      likes: Number(post['like_count'] ?? 0),
      url: target ? `https://xueqiu.com${target}` : '',
    });
  }
  return out;
}

export async function getHotStocks(limit = 10, stockType = 10): Promise<{ symbol: string; name: string; current: unknown; percent: unknown; rank: number }[]> {
  const data = await getXueqiuJson<{ data?: { items?: Array<Record<string, unknown>> } }>(
    `https://stock.xueqiu.com/v5/stock/hot_stock/list.json?size=${limit}&type=${stockType}`,
  );
  const items = data?.data?.items ?? [];
  return items.slice(0, limit).map((item, idx) => ({
    symbol: String(item['code'] ?? item['symbol'] ?? ''),
    name: String(item['name'] ?? ''),
    current: item['current'],
    percent: item['percent'],
    rank: idx + 1,
  }));
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

// -------------------- 工具注册 --------------------

const ACTIONS = ['quote', 'search', 'hot_posts', 'hot_stocks'] as const;

export const xueqiuReadTool: AnyAgentTool = {
  label: 'Xueqiu Read',
  name: 'xueqiu_read',
  description:
    '读取雪球股票行情与社区动态。action: quote=实时行情, search=搜索股票, hot_posts=热门帖子, hot_stocks=热门股票排行。行情 API 需要 xueqiu_cookie（登录雪球后配置）。',
  parameters: Schema.object({
    action: Schema.enum(ACTIONS, '读取动作'),
    symbol: Schema.optional(Schema.string('action=quote 时的股票代码，如 SH600519/SZ000858/AAPL/00700')),
    query: Schema.optional(Schema.string('action=search 时的搜索词（代码或中文名）')),
    limit: Schema.optional(Schema.integer({ description: '最大条数（默认 10/20）', minimum: 1 })),
  }),
  async execute(_id, args) {
    const params = asToolParamsRecord(args);
    const action = readStringParam(params, 'action') as (typeof ACTIONS)[number] | '';
    if (!action) return errorResult('action is required');
    const limit = readOptionalInt(params, 'limit', { min: 1, max: 50 }) ?? 10;
    try {
      switch (action) {
        case 'quote': {
          const symbol = readStringParam(params, 'symbol', { required: true, label: 'symbol' });
          if (!symbol) return errorResult('symbol is required for action=quote');
          return jsonResult({ status: 'ok', success: true, action, quote: await getStockQuote(symbol) });
        }
        case 'search': {
          const query = readStringParam(params, 'query', { required: true, label: 'query' });
          if (!query) return errorResult('query is required for action=search');
          return jsonResult({ status: 'ok', success: true, action, items: await searchStock(query, limit) });
        }
        case 'hot_posts':
          return jsonResult({ status: 'ok', success: true, action, items: await getHotPosts(Math.max(20, limit)) });
        case 'hot_stocks':
          return jsonResult({ status: 'ok', success: true, action, items: await getHotStocks(limit) });
        default:
          return errorResult(`unknown action: ${action}`);
      }
    } catch (e) {
      return errorResult(String(e instanceof Error ? e.message : e), { action });
    }
  },
};
