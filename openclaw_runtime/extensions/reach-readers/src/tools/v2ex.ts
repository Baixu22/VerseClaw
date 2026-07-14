/**
 * v2ex_read —— 重构自 agent_reach/channels/v2ex.py。
 *
 * 纯 HTTP，零配置。覆盖 Python 版的 4 个方法：
 *   getHotTopics / getNodeTopics / getTopic / getUser
 * search() 在 Python 版里就是返回"用 Exa"的提示，这里照搬。
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
import { httpJson } from '../core/http.js';
import { canHandle } from '../core/router.js';
import type { Availability } from '../types.js';

const UA = 'agent-reach/1.0';
const DOMAINS = ['v2ex.com'] as const;
const TIMEOUT = 10_000;

type Maybe<T> = T | undefined;

interface V2exTopicRaw {
  id?: number;
  title?: string;
  url?: string;
  replies?: number;
  content?: string;
  created?: number;
  node?: Maybe<{ name?: string; title?: string }>;
  member?: Maybe<{ username?: string }>;
}

export function canHandleUrl(url: string): boolean {
  return canHandle(url, DOMAINS);
}

export async function check(): Promise<Availability> {
  try {
    await httpJson<unknown>(
      'https://www.v2ex.com/api/topics/show.json?node_name=python&page=1',
      { headers: { 'User-Agent': UA }, timeoutMs: TIMEOUT },
    );
    return {
      channel: 'v2ex',
      status: 'ok',
      activeBackend: 'V2EX API (public)',
      message: '公开 API 可用（热门主题、节点浏览、主题详情、用户信息）',
    };
  } catch (e) {
    return {
      channel: 'v2ex',
      status: 'warn',
      activeBackend: undefined,
      message: `V2EX API 连接失败（可能需要代理）：${e instanceof Error ? e.message : e}`,
    };
  }
}

// -------------------- 数据获取（对齐 v2ex.py 各方法） --------------------

interface V2exTopicSummary {
  id: number;
  title: string;
  url: string;
  replies: number;
  node_name: string;
  node_title: string;
  content: string;
  created: number;
}

export async function getHotTopics(limit = 20): Promise<V2exTopicSummary[]> {
  const data = await httpJson<V2exTopicRaw[]>('https://www.v2ex.com/api/topics/hot.json', {
    headers: { 'User-Agent': UA }, timeoutMs: TIMEOUT,
  });
  return (data ?? []).slice(0, limit).map((x) => toSummary(x));
}

export async function getNodeTopics(nodeName: string, limit = 20): Promise<V2exTopicSummary[]> {
  const data = await httpJson<V2exTopicRaw[]>(
    `https://www.v2ex.com/api/topics/show.json?node_name=${encodeURIComponent(nodeName)}&page=1`,
    { headers: { 'User-Agent': UA }, timeoutMs: TIMEOUT },
  );
  return (data ?? []).slice(0, limit).map((x) => toSummary(x, nodeName));
}

/**
 * 主题详情 —— 对齐 v2ex.py:152-163 的 get_topic 返回结构。
 *
 * Python 的 detail 是独立 dict（不继承 summary），用 `replies_count`（数字）+
 * `replies`（列表）两个字段。TS 版同样独立定义，避免 summary.replies(number)
 * 与 detail.replies(list) 同名冲突。
 */
interface V2exTopicDetail {
  id: number;
  title: string;
  url: string;
  content: string;
  replies_count: number;
  node_name: string;
  node_title: string;
  author: string;
  created: number;
  replies: { author: string; content: string; created: number }[];
}

export async function getTopic(topicId: number): Promise<V2exTopicDetail> {
  const arr = await httpJson<V2exTopicRaw[]>(
    `https://www.v2ex.com/api/topics/show.json?id=${topicId}`,
    { headers: { 'User-Agent': UA }, timeoutMs: TIMEOUT },
  );
  const topic = (arr ?? [])[0] ?? {};
  let replies: { author: string; content: string; created: number }[] = [];
  try {
    const r = await httpJson<Array<{ member?: { username?: string }; content?: string; created?: number }>>(
      `https://www.v2ex.com/api/replies/show.json?topic_id=${topicId}&page=1`,
      { headers: { 'User-Agent': UA }, timeoutMs: TIMEOUT },
    );
    replies = (r ?? []).map((x) => ({
      author: x.member?.username ?? '',
      content: x.content ?? '',
      created: x.created ?? 0,
    }));
  } catch {
    // Replies are optional; preserve the empty fallback initialized above.
  }
  const node = topic.node ?? {};
  return {
    id: topic.id ?? topicId,
    title: topic.title ?? '',
    url: topic.url ?? `https://www.v2ex.com/t/${topicId}`,
    content: topic.content ?? '',
    replies_count: topic.replies ?? 0,
    node_name: node.name ?? '',
    node_title: node.title ?? '',
    author: topic.member?.username ?? '',
    created: topic.created ?? 0,
    replies,
  };
}

export async function getUser(username: string): Promise<Record<string, unknown>> {
  const data = await httpJson<Record<string, unknown>>(
    `https://www.v2ex.com/api/members/show.json?username=${encodeURIComponent(username)}`,
    { headers: { 'User-Agent': UA }, timeoutMs: TIMEOUT },
  );
  return {
    id: data['id'] ?? 0,
    username: data['username'] ?? username,
    url: data['url'] ?? `https://www.v2ex.com/member/${username}`,
    website: data['website'] ?? '',
    twitter: data['twitter'] ?? '',
    psn: data['psn'] ?? '',
    github: data['github'] ?? '',
    btc: data['btc'] ?? '',
    location: data['location'] ?? '',
    bio: data['bio'] ?? '',
    avatar: data['avatar_large'] ?? data['avatar_normal'] ?? '',
    created: data['created'] ?? 0,
  };
}

function toSummary(raw: V2exTopicRaw, fallbackNode = ''): V2exTopicSummary {
  const node = raw.node ?? {};
  return {
    id: raw.id ?? 0,
    title: raw.title ?? '',
    url: raw.url ?? '',
    replies: raw.replies ?? 0,
    node_name: node.name ?? fallbackNode,
    node_title: node.title ?? '',
    content: (raw.content ?? '').slice(0, 200),
    created: raw.created ?? 0,
  };
}

// -------------------- 工具注册 --------------------

const ACTIONS = ['hot', 'node', 'topic', 'user', 'search'] as const;
type Action = (typeof ACTIONS)[number];

/** search —— 对齐 v2ex.py:193-214。公开 API 无搜索端点，返回提示。 */
export function search(query: string): { error: string }[] {
  return [
    {
      error: `V2EX 公开 API 不提供搜索端点。建议改用：https://www.v2ex.com/?q=${encodeURIComponent(query)} 或通过 Exa channel 使用 site:v2ex.com 搜索。`,
    },
  ];
}

export const v2exReadTool: AnyAgentTool = {
  label: 'V2EX Read',
  name: 'v2ex_read',
  description:
    '读取 V2EX 节点/主题/用户。零配置（公开 API）。action: hot=热门主题, node=指定节点最新帖, topic=主题详情+回复, user=用户信息, search=提示（公开 API 不支持搜索）。',
  parameters: Schema.object({
    action: Schema.enum(ACTIONS, '读取动作'),
    node: Schema.optional(Schema.string('action=node 时的节点名，如 python/tech/jobs')),
    topic_id: Schema.optional(Schema.integer({ description: 'action=topic 时的主题 ID' })),
    username: Schema.optional(Schema.string('action=user 时的用户名')),
    query: Schema.optional(Schema.string('action=search 时的搜索词')),
    limit: Schema.optional(Schema.integer({ description: 'hot/node 的最大条数（默认 20）', minimum: 1 })),
  }),
  async execute(_id, args) {
    const params = asToolParamsRecord(args);
    const action = (readStringParam(params, 'action') || 'hot') as Action;
    const limit = readOptionalInt(params, 'limit', { min: 1, max: 50 }) ?? 20;
    try {
      switch (action) {
        case 'hot':
          return jsonResult({ status: 'ok', success: true, action, items: await getHotTopics(limit) });
        case 'node': {
          const node = readStringParam(params, 'node', { required: true, label: 'node' });
          if (!node) return errorResult('node is required for action=node');
          return jsonResult({ status: 'ok', success: true, action, node, items: await getNodeTopics(node, limit) });
        }
        case 'topic': {
          const topicId = readOptionalInt(params, 'topic_id');
          if (!topicId) return errorResult('topic_id is required for action=topic');
          return jsonResult({ status: 'ok', success: true, action, topic: await getTopic(topicId) });
        }
        case 'user': {
          const username = readStringParam(params, 'username', { required: true, label: 'username' });
          if (!username) return errorResult('username is required for action=user');
          return jsonResult({ status: 'ok', success: true, action, user: await getUser(username) });
        }
        case 'search': {
          const query = readStringParam(params, 'query', { required: true, label: 'query' });
          if (!query) return errorResult('query is required for action=search');
          return jsonResult({ status: 'ok', success: true, action, results: search(query) });
        }
        default:
          return errorResult(`unknown action: ${action}`);
      }
    } catch (e) {
      return errorResult(String(e instanceof Error ? e.message : e), { action });
    }
  },
};
