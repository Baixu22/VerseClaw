/**
 * twitter_read —— 重构自 agent_reach/channels/twitter.py。
 *
 * 多后端：twitter-cli / OpenCLI / bird CLI (legacy)。
 * 需登录态（twitter_auth_token + twitter_ct0，或 opencli 复用浏览器登录）。
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

const DOMAINS = ['x.com', 'twitter.com'] as const;
const DEFAULT_BACKENDS = ['twitter-cli', 'OpenCLI', 'bird CLI (legacy)'] as const;

export function canHandleUrl(url: string): boolean {
  return canHandle(url, DOMAINS);
}

// -------------------- 后端探活（对齐 twitter.py 的 _check_*） --------------------

/**
 * 探测 twitter-cli —— 对齐 twitter.py: _check_twitter_cli。
 *
 * `twitter status` 才是健康信号：已登录时输出 "ok: true"，
 * 未登录时以非零退出码输出 "not_authenticated"——工具本身是活的，
 * 所以 probe 的 error 状态也要看 output 内容再分类。
 */
async function checkTwitterCli(): Promise<BackendFinding | undefined> {
  const probe = await probeCommand('twitter', ['status'], { timeoutMs: 15_000, retries: 1, pkg: 'twitter-cli' });
  if (probe.status === 'missing') return undefined;
  if (probe.status === 'broken') {
    return { backend: 'twitter-cli', status: 'error', message: `twitter-cli 命令存在但无法执行。\n${probe.hint}` };
  }
  if (probe.status === 'timeout') {
    return { backend: 'twitter-cli', status: 'error', message: `twitter-cli 健康检查超时（已重试 1 次）。\n${probe.hint}` };
  }
  // probe 可能是 error（非零退出）或 ok —— 都要看 output 内容分类
  const output = probe.output;
  if (output.includes('ok: true')) {
    return {
      backend: 'twitter-cli',
      status: 'ok',
      message: 'twitter-cli 完整可用（搜索、读推文、时间线、长文/Article、用户查询、Thread）',
    };
  }
  if (output.includes('not_authenticated')) {
    return {
      backend: 'twitter-cli',
      status: 'warn',
      message: 'twitter-cli 已安装但未认证。设置方式：\n  export TWITTER_AUTH_TOKEN="xxx"\n  export TWITTER_CT0="yyy"\n或确保已在浏览器中登录 x.com',
    };
  }
  return {
    backend: 'twitter-cli',
    status: 'warn',
    message: 'twitter-cli 已安装但认证检查失败。运行：\n  twitter -v status 查看详细信息',
  };
}

async function checkOpencli(): Promise<BackendFinding | undefined> {
  const probe = await probeCommand('opencli', ['--version'], { timeoutMs: 10_000, pkg: 'opencli' });
  if (probe.status === 'missing') return undefined;
  if (probe.status === 'broken') return { backend: 'OpenCLI', status: 'error', message: `opencli 命令存在但无法执行\n${probe.hint}` };
  if (probe.status !== 'ok') return { backend: 'OpenCLI', status: 'warn', message: `opencli 探测失败（${probe.status}）` };
  return {
    backend: 'OpenCLI',
    status: 'ok',
    message: 'OpenCLI 可用（复用浏览器登录态）。用法：opencli twitter search/timeline/tweet/user -f yaml',
  };
}

/**
 * 探测 bird/birdx（legacy 回退）—— 对齐 twitter.py: _check_bird。
 *
 * 用 `bird check` / `birdx check` 子命令真正验证 credentials：
 * 已配置输出成功状态；未配置输出 "Missing credentials"。
 */
async function checkBird(): Promise<BackendFinding | undefined> {
  let lastFailure: BackendFinding | undefined;
  for (const cmd of ['bird', 'birdx']) {
    const probe = await probeCommand(cmd, ['check'], { timeoutMs: 15_000, retries: 1, pkg: '@steipete/bird' });
    if (probe.status === 'missing') continue;
    if (probe.status === 'broken') {
      lastFailure = {
        backend: 'bird CLI (legacy)',
        status: 'error',
        message: `${cmd} 命令存在但无法执行（bird 是 npm 包，可用 npm install -g @steipete/bird 重装）。\n${probe.hint}`,
      };
      continue; // bird 坏了再试 birdx
    }
    if (probe.status === 'timeout') {
      lastFailure = {
        backend: 'bird CLI (legacy)',
        status: 'error',
        message: `${cmd} 健康检查超时（已重试 1 次）。\n${probe.hint}`,
      };
      continue;
    }
    const output = probe.output;
    if (probe.status === 'ok') {
      return { backend: 'bird CLI (legacy)', status: 'ok', message: 'bird CLI 可用（读取、搜索推文，含长文/X Article）' };
    }
    // error 状态——看 output 内容分类
    if (output.includes('Missing credentials') || output.toLowerCase().includes('missing')) {
      return {
        backend: 'bird CLI (legacy)',
        status: 'warn',
        message: 'bird CLI 已安装但未配置认证。设置环境变量：\n  export AUTH_TOKEN="xxx"\n  export CT0="yyy"',
      };
    }
    return { backend: 'bird CLI (legacy)', status: 'warn', message: 'bird CLI 已安装但认证检查失败。' };
  }
  return lastFailure;
}

export async function check(): Promise<Availability> {
  const order = orderedBackends('twitter', DEFAULT_BACKENDS, (k) => getConfig().get<string>(k));
  const findings: BackendFinding[] = [];
  for (const backend of order) {
    let r: BackendFinding | undefined;
    if (backend === 'twitter-cli') r = await checkTwitterCli();
    else if (backend === 'OpenCLI') r = await checkOpencli();
    else if (backend === 'bird CLI (legacy)') r = await checkBird();
    if (r) findings.push(r);
  }
  const selected = selectBackend(findings);
  if (selected) {
    return { channel: 'twitter', status: selected.status, activeBackend: selected.activeBackend, message: selected.message };
  }
  return {
    channel: 'twitter',
    status: 'off',
    activeBackend: undefined,
    message:
      '未安装任何 Twitter 后端。推荐：\n  pipx install twitter-cli（需从浏览器 Cookie 提取 auth_token/ct0）\n  或桌面装 OpenCLI（复用浏览器登录态）',
  };
}

// -------------------- 数据获取（委托上游 CLI） --------------------

async function twitterCli(args: string[], timeoutMs = 60_000): Promise<unknown> {
  const argv = [...args, '-f', 'json'];
  const result = await runReachCommand('twitter', argv, {
    timeoutMs, maxOutputBytes: 20 * 1024 * 1024, env: utf8Env(), packageName: 'twitter-cli',
  });
  if (result.code !== 0) throw commandError('twitter', argv, result);
  return JSON.parse(result.stdout);
}

async function opencli(args: string[], timeoutMs = 60_000): Promise<unknown> {
  const argv = ['twitter', ...args, '-f', 'json'];
  const result = await runReachCommand('opencli', argv, {
    timeoutMs, maxOutputBytes: 20 * 1024 * 1024, env: utf8Env(), packageName: 'opencli',
  });
  if (result.code !== 0) throw commandError('opencli twitter', argv, result);
  return JSON.parse(result.stdout);
}

export async function searchTweets(query: string, limit = 10): Promise<unknown> {
  // 优先 twitter-cli，失败回退 opencli
  try {
    return await twitterCli(['search', query, '--limit', String(limit)]);
  } catch {
    return opencli(['search', query]);
  }
}

export async function getTimeline(username: string, limit = 10): Promise<unknown> {
  try {
    return await twitterCli(['timeline', username, '--limit', String(limit)]);
  } catch {
    return opencli(['timeline', username]);
  }
}

export async function getTweet(tweetId: string): Promise<unknown> {
  try {
    return await twitterCli(['tweet', tweetId]);
  } catch {
    return opencli(['tweet', tweetId]);
  }
}

// -------------------- 工具注册 --------------------

const ACTIONS = ['search', 'timeline', 'tweet', 'check'] as const;

export const twitterReadTool: AnyAgentTool = {
  label: 'Twitter Read',
  name: 'twitter_read',
  description:
    '读取 Twitter/X 推文。action: search=搜索, timeline=用户时间线, tweet=单条推文, check=探测后端。多后端：twitter-cli / OpenCLI / bird (legacy)。需登录态。',
  parameters: Schema.object({
    action: Schema.enum(ACTIONS, '读取动作（默认 search）'),
    query: Schema.optional(Schema.string('action=search 时的搜索词')),
    username: Schema.optional(Schema.string('action=timeline 时的用户名')),
    tweet_id: Schema.optional(Schema.string('action=tweet 时的推文 ID')),
    limit: Schema.optional(Schema.integer({ description: '最大条数（默认 10）', minimum: 1 })),
  }),
  async execute(_id, args) {
    const params = asToolParamsRecord(args);
    const action = (readStringParam(params, 'action') || 'search') as (typeof ACTIONS)[number];
    const limit = readOptionalInt(params, 'limit', { min: 1, max: 50 }) ?? 10;
    try {
      if (action === 'check') {
        return jsonResult({ status: 'ok', success: true, action, availability: await check() });
      }
      switch (action) {
        case 'search': {
          const query = readStringParam(params, 'query', { required: true, label: 'query' });
          if (!query) return errorResult('query is required for action=search');
          return jsonResult({ status: 'ok', success: true, action, items: await searchTweets(query, limit) });
        }
        case 'timeline': {
          const username = readStringParam(params, 'username', { required: true, label: 'username' });
          if (!username) return errorResult('username is required for action=timeline');
          return jsonResult({ status: 'ok', success: true, action, items: await getTimeline(username, limit) });
        }
        case 'tweet': {
          const tweetId = readStringParam(params, 'tweet_id', { required: true, label: 'tweet_id' });
          if (!tweetId) return errorResult('tweet_id is required for action=tweet');
          return jsonResult({ status: 'ok', success: true, action, tweet: await getTweet(tweetId) });
        }
        default:
          return errorResult(`unknown action: ${action}`);
      }
    } catch (e) {
      return errorResult(String(e instanceof Error ? e.message : e), { action });
    }
  },
};
