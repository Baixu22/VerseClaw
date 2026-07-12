/**
 * github_read —— 重构自 agent_reach/channels/github.py。
 *
 * 后端：gh CLI（二进制安装，认证后完整可用）。
 * 健康检查对齐 Python 版：gh 本体能跑就算可用，rc!=0 视为"活着但未认证"（warn）。
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
import { canHandle } from '../core/router.js';
import type { Availability } from '../types.js';
import { getConfig } from '../core/config.js';
import { readBrowserFallbackPage } from '../core/browser-bridge.js';

const DOMAINS = ['github.com'] as const;

export function canHandleUrl(url: string): boolean {
  return canHandle(url, DOMAINS);
}

export async function check(): Promise<Availability> {
  // 对齐 github.py：真跑 gh auth status；未登录 rc!=0 是 warn（正常业务态）
  const probe = await probeCommand('gh', ['auth', 'status'], { timeoutMs: 10_000, pkg: 'gh' });
  if (probe.status === 'missing') {
    return {
      channel: 'github',
      status: 'warn',
      activeBackend: undefined,
      message: 'gh CLI 未安装。安装：https://cli.github.com',
    };
  }
  if (probe.status === 'broken') {
    return {
      channel: 'github',
      status: 'error',
      activeBackend: undefined,
      message: 'gh 命令存在但无法执行——安装已损坏。重装即可修复：\n  brew reinstall gh\n或从 https://cli.github.com 重新安装 gh CLI',
    };
  }
  if (probe.status === 'timeout') {
    return {
      channel: 'github',
      status: 'warn',
      activeBackend: 'gh CLI',
      message: 'gh CLI 状态检查超时，运行 gh auth status 查看详情',
    };
  }
  if (probe.status === 'ok') {
    return {
      channel: 'github',
      status: 'ok',
      activeBackend: 'gh CLI',
      message: '完整可用（读取、搜索、Fork、Issue、PR 等）',
    };
  }
  // error —— gh 活着但 rc!=0（通常未认证）
  return {
    channel: 'github',
    status: 'warn',
    activeBackend: 'gh CLI',
    message: 'gh CLI 已安装但未认证。运行 gh auth login 可解锁完整功能',
  };
}

// -------------------- 数据获取 --------------------

async function gh(args: string[], timeoutMs = 30_000): Promise<string> {
  const result = await runReachCommand('gh', args, {
    timeoutMs,
    maxOutputBytes: 20 * 1024 * 1024,
    env: utf8Env(),
    packageName: 'gh',
  });
  if (result.code !== 0) throw commandError('gh', args, result);
  return result.stdout;
}

/** 读取仓库文件/目录内容 —— gh api repos/:owner/:repo/contents/:path。 */
export async function readContents(owner: string, repo: string, p = '', ref?: string): Promise<unknown> {
  const pathPart = p ? `/contents/${encodeURIComponent(p).replace(/%2F/g, '/')}` : '/contents';
  const refPart = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const out = await gh(['api', `repos/${owner}/${repo}${pathPart}${refPart}`, '-H', 'Accept: application/vnd.github+json']);
  return JSON.parse(out);
}

/** 读取 README —— gh api repos/:owner/:repo/readme。 */
export async function readReadme(owner: string, repo: string, ref?: string): Promise<{ name: string; content: string; encoding: string }> {
  const refPart = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const out = await gh(['api', `repos/${owner}/${repo}/readme${refPart}`, '-H', 'Accept: application/vnd.github+json']);
  return JSON.parse(out);
}

/** 列 Issues —— gh api repos/:owner/:repo/issues。 */
export async function listIssues(owner: string, repo: string, limit = 10, state: 'open' | 'closed' | 'all' = 'open'): Promise<unknown[]> {
  const out = await gh(['api', `repos/${owner}/${repo}/issues?state=${state}&per_page=${limit}`]);
  return JSON.parse(out) as unknown[];
}

/** 列 PR —— gh api repos/:owner/:repo/pulls。 */
export async function listPRs(owner: string, repo: string, limit = 10, state: 'open' | 'closed' | 'all' = 'open'): Promise<unknown[]> {
  const out = await gh(['api', `repos/${owner}/${repo}/pulls?state=${state}&per_page=${limit}`]);
  return JSON.parse(out) as unknown[];
}

/** 搜索仓库/代码/Issues —— gh search。 */
export async function search(query: string, kind: 'repos' | 'code' | 'issues' = 'repos', limit = 10): Promise<unknown> {
  const out = await gh(['search', kind, query, `--limit=${limit}`, '--json=repository,path,title,number,state,url']);
  return JSON.parse(out);
}

// -------------------- 工具注册 --------------------

const ACTIONS = ['contents', 'readme', 'issues', 'prs', 'search', 'check'] as const;

export const githubReadTool: AnyAgentTool = {
  label: 'GitHub Read',
  name: 'github_read',
  description:
    '读取 GitHub 仓库（通过 gh CLI）。action: contents=文件/目录, readme=README, issues=Issues, prs=PRs, search=搜索仓库/代码/Issues, check=探测 gh。需 gh auth login。',
  parameters: Schema.object({
    action: Schema.enum(ACTIONS, '读取动作（默认 readme）'),
    owner: Schema.optional(Schema.string('仓库 owner（contents/readme/issues/prs 必填）')),
    repo: Schema.optional(Schema.string('仓库名（contents/readme/issues/prs 必填）')),
    path: Schema.optional(Schema.string('action=contents 时的路径（默认根目录）')),
    ref: Schema.optional(Schema.string('git ref（默认默认分支）')),
    query: Schema.optional(Schema.string('action=search 时的搜索词')),
    kind: Schema.optional(Schema.enum(['repos', 'code', 'issues'], 'search 的类型（默认 repos）')),
    state: Schema.optional(Schema.enum(['open', 'closed', 'all'], 'issues/prs 的状态（默认 open）')),
    limit: Schema.optional(Schema.integer({ description: '最大条数（默认 10）', minimum: 1 })),
  }),
  async execute(_id, args, signal) {
    const params = asToolParamsRecord(args);
    const action = (readStringParam(params, 'action') || 'readme') as (typeof ACTIONS)[number];
    const limit = readOptionalInt(params, 'limit', { min: 1, max: 100 }) ?? 10;
    try {
      if (action === 'check') {
        return jsonResult({ status: 'ok', success: true, action, availability: await check() });
      }
      if (action === 'search') {
        const query = readStringParam(params, 'query', { required: true, label: 'query' });
        if (!query) return errorResult('query is required for action=search');
        const kind = (readStringParam(params, 'kind') || 'repos') as 'repos' | 'code' | 'issues';
        return jsonResult({ status: 'ok', success: true, action, query, kind, results: await search(query, kind, limit) });
      }
      // 需要 owner/repo 的动作
      const owner = readStringParam(params, 'owner', { required: true, label: 'owner' });
      const repo = readStringParam(params, 'repo', { required: true, label: 'repo' });
      if (!owner || !repo) return errorResult('owner and repo are required');
      const ref = readStringParam(params, 'ref') || undefined;
      switch (action) {
        case 'contents': {
          const p = readStringParam(params, 'path') || '';
          return jsonResult({ status: 'ok', success: true, action, owner, repo, path: p, contents: await readContents(owner, repo, p, ref) });
        }
        case 'readme':
          return jsonResult({ status: 'ok', success: true, action, owner, repo, readme: await readReadme(owner, repo, ref) });
        case 'issues': {
          const state = (readStringParam(params, 'state') || 'open') as 'open' | 'closed' | 'all';
          return jsonResult({ status: 'ok', success: true, action, owner, repo, state, issues: await listIssues(owner, repo, limit, state) });
        }
        case 'prs': {
          const state = (readStringParam(params, 'state') || 'open') as 'open' | 'closed' | 'all';
          return jsonResult({ status: 'ok', success: true, action, owner, repo, state, prs: await listPRs(owner, repo, limit, state) });
        }
        default:
          return errorResult(`unknown action: ${action}`);
      }
    } catch (e) {
      const originalError = String(e instanceof Error ? e.message : e);
      const policy = getConfig().get<string>('browser_fallback', 'auto');
      if (policy !== 'auto') return errorResult(originalError, {
        action, browserFallback: policy === 'off' ? 'disabled' : 'unavailable',
      });
      const owner = readStringParam(params, 'owner');
      const repo = readStringParam(params, 'repo');
      const query = readStringParam(params, 'query');
      const url = owner && repo
        ? `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
        : `https://github.com/search?q=${encodeURIComponent(query)}`;
      try {
        const page = await readBrowserFallbackPage({
          url,
          profile: getConfig().get<string>('browser_profile', 'default') ?? 'default',
          signal,
        });
        return page
          ? jsonResult({ status: 'ok', success: true, action, browserFallback: 'used', ...page })
          : errorResult(originalError, { action, browserFallback: 'unavailable' });
      } catch {
        return errorResult(originalError, { action, browserFallback: 'unavailable' });
      }
    }
  },
};
