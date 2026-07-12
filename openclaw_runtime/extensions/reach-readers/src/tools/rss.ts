/**
 * rss_read —— 重构自 agent_reach/channels/rss.py。
 *
 * Python 版用 feedparser。shadow 改用零依赖的极简 RSS/Atom 解析器
 * （只取 channel/item 与 feed/entry 两套命名，足够覆盖 99% 订阅源）。
 *
 * 迁移到 ClawX 时可换 rss-parser（ClawX 已知缺失），逻辑结构不变。
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
import { httpText } from '../core/http.js';
import { canHandleRss } from '../core/router.js';
import type { Availability } from '../types.js';

export function canHandle(url: string): boolean {
  return canHandleRss(url);
}

export async function check(): Promise<Availability> {
  // 对齐 rss.py：feedparser 改成"内置解析器"后恒可用
  return {
    channel: 'rss',
    status: 'ok',
    activeBackend: 'built-in parser',
    message: '可读取 RSS/Atom 源（内置解析器，零依赖）',
  };
}

interface FeedItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

/** 极简 RSS/Atom 解析 —— 替代 feedparser。只识别常见字段，足够做读取。 */
export function parseFeed(xml: string, limit = 20): { title: string; items: FeedItem[] } {
  const items: FeedItem[] = [];
  // RSS: <item>...</item>；Atom: <entry>...</entry>
  const itemRegex = /<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) && items.length < limit) {
    const body = m[1] ?? '';
    items.push({
      title: pickTag(body, 'title'),
      link: pickTag(body, 'link') || pickAttr(body, 'link', 'href'),
      description: pickTag(body, 'description') || pickTag(body, 'summary'),
      pubDate: pickTag(body, 'pubDate') || pickTag(body, 'published') || pickTag(body, 'updated'),
    });
  }
  const feedTitle = pickTag(xml, 'title');
  return { title: feedTitle, items };
}

function pickTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(xml);
  if (!m) return '';
  return stripCdata(stripHtml(m[1] ?? '')).trim();
}

function pickAttr(xml: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*\\s${attr}=["']([^"']+)["']`, 'i');
  const m = re.exec(xml);
  return m ? (m[1] ?? '').trim() : '';
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

/** 读取订阅源 —— 对齐 rss.py 的 read 概念（Python 版未实现 read，这里补全）。 */
export async function readFeed(url: string, limit = 20): Promise<{ title: string; items: FeedItem[] }> {
  const xml = await httpText(url, { timeoutMs: 20_000 });
  return parseFeed(xml, limit);
}

export const rssReadTool: AnyAgentTool = {
  label: 'RSS Read',
  name: 'rss_read',
  description:
    '读取 RSS/Atom 订阅源，返回条目列表（title/link/description/pubDate）。零配置。支持 RSS 2.0 与 Atom 两套命名。',
  parameters: Schema.object({
    url: Schema.string('订阅源 URL'),
    limit: Schema.optional(Schema.integer({ description: '最多返回条数（默认 20）', minimum: 1 })),
  }),
  async execute(_id, args) {
    const params = asToolParamsRecord(args);
    const url = readStringParam(params, 'url', { required: true, label: 'url' });
    if (!url) return errorResult('url is required');
    const limit = readOptionalInt(params, 'limit', { min: 1, max: 100 }) ?? 20;
    try {
      const feed = await readFeed(url, limit);
      return jsonResult({
        status: 'ok',
        success: true,
        feedTitle: feed.title,
        count: feed.items.length,
        items: feed.items,
      });
    } catch (e) {
      return errorResult(String(e instanceof Error ? e.message : e), { url });
    }
  },
};
