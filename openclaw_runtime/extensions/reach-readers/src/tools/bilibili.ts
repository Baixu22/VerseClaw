/**
 * bilibili_read —— 重构自 agent_reach/channels/bilibili.py。
 *
 * 多后端：bili-cli / OpenCLI / 搜索 API。
 * yt-dlp 已在 Python 版移除（412 风控），shadow 不引入。
 *
 * 后端探活两段式选后端逻辑用 core/router.ts 的 selectBackend。
 */
import { existsSync, readdirSync } from 'node:fs';
import { Schema } from '../common/schema.js';
import {
  type AnyAgentTool,
  asToolParamsRecord,
  errorResult,
  jsonResult,
  readStringParam,
  readOptionalInt,
} from '../common/tool-shape.js';
import { probeCommand } from '../core/probe.js';
import { httpJson } from '../core/http.js';
import { canHandle, orderedBackends, selectBackend } from '../core/router.js';
import { getConfig } from '../core/config.js';
import type { Availability, BackendFinding } from '../types.js';
import { readBrowserFallbackPage } from '../core/browser-bridge.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const DOMAINS = ['bilibili.com', 'b23.tv'] as const;
const TIMEOUT = 10_000;
const SEARCH_API = 'https://api.bilibili.com/x/web-interface/search/all/v2?keyword=test&page=1';
const DEFAULT_BACKENDS = ['bili-cli', 'OpenCLI', 'B站搜索 API'] as const;

export function canHandleUrl(url: string): boolean {
  return canHandle(url, DOMAINS);
}

// -------------------- 后端探活（对齐 bilibili.py 的 _check_*） --------------------

async function checkBiliCli(): Promise<BackendFinding | undefined> {
  const probe = await probeCommand('bili', ['--version'], { timeoutMs: 10_000, pkg: 'bilibili-cli' });
  if (probe.status === 'missing') return undefined;
  if (probe.status === 'broken') {
    return { backend: 'bili-cli', status: 'error', message: `bili 命令存在但无法执行\n${probe.hint}` };
  }
  if (probe.status !== 'ok') {
    return {
      backend: 'bili-cli',
      status: 'warn',
      message: `bili-cli 探测失败（${probe.status}），运行 \`bili status\` 查看详情`,
    };
  }
  return {
    backend: 'bili-cli',
    status: 'ok',
    message: 'bili-cli 可用（搜索/热门/排行/视频详情/音频，无需登录；字幕需 OpenCLI。上游 2026-03 起停更）',
  };
}

/**
 * OpenCLI 探活 —— 对齐 backends/opencli.py: opencli_status。
 *
 * 多维状态检查（不止 --version）：
 *   1) opencli --version（installed/broken/version）
 *   2) opencli daemon status（daemon_running/extension_connected）
 *   3) Chrome 扩展目录检查（extension_installed，disambiguate sleeping vs never-installed）
 *
 * ready 判定：installed && !broken && (extension_connected || extension_installed)
 * —— 对齐 OpenCLIStatus.ready 属性。
 */
const OPENCLI_PACKAGE = '@jackwener/opencli';
const OPENCLI_EXTENSION_ID = 'ildkmabpimmkaediidaifkhjpohdnifk';
const OPENCLI_EXTENSION_URL = `https://chromewebstore.google.com/detail/opencli/${OPENCLI_EXTENSION_ID}`;

interface OpenCLIStatus {
  installed: boolean;
  broken: boolean;
  daemonRunning: boolean;
  extensionConnected: boolean;
  extensionInstalled: boolean;
  version: string;
  hint: string;
  ready: boolean;
}

/** Chrome 扩展目录检查 —— 对齐 opencli.py: _extension_installed_on_disk。 */
function extensionInstalledOnDisk(): boolean {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const roots = [
    // macOS Chrome / Chromium
    `${home}/Library/Application Support/Google/Chrome`,
    `${home}/Library/Application Support/Chromium`,
    // Linux Chrome / Chromium
    `${home}/.config/google-chrome`,
    `${home}/.config/chromium`,
  ];
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) roots.push(`${localAppData}/Google/Chrome/User Data`);
  // glob 检查 <root>/*/Extensions/<id>/ —— 对齐 Python glob.glob
  for (const root of roots) {
    try {
      const profiles = readdirSync(root, { withFileTypes: true });
      for (const p of profiles) {
        if (!p.isDirectory()) continue;
        const extPath = `${root}/${p.name}/Extensions/${OPENCLI_EXTENSION_ID}`;
        try {
          if (existsSync(extPath)) return true;
        } catch {
          // continue
        }
      }
    } catch {
      // root 不存在或无权限，继续
    }
  }
  return false;
}

/** 探测 OpenCLI 完整状态 —— 对齐 opencli.py: opencli_status。 */
async function opencliStatus(timeoutMs = 10_000): Promise<OpenCLIStatus> {
  const versionProbe = await probeCommand('opencli', ['--version'], { timeoutMs, pkg: OPENCLI_PACKAGE });
  if (versionProbe.status === 'missing') {
    return { installed: false, broken: false, daemonRunning: false, extensionConnected: false, extensionInstalled: false, version: '', hint: '', ready: false };
  }
  if (versionProbe.status !== 'ok') {
    return {
      installed: true,
      broken: true,
      daemonRunning: false,
      extensionConnected: false,
      extensionInstalled: false,
      version: '',
      hint: `opencli 命令存在但无法执行（node 环境损坏），重装：\n  npm install -g ${OPENCLI_PACKAGE}`,
      ready: false,
    };
  }
  const version = versionProbe.output.trim();
  // opencli daemon status —— 纯查询，不会自动启动 daemon（对齐 opencli.py:99-111）
  const daemonProbe = await probeCommand('opencli', ['daemon', 'status'], { timeoutMs, pkg: OPENCLI_PACKAGE });
  const output = daemonProbe.status === 'ok' ? daemonProbe.output : '';
  let daemonRunning = false;
  let extensionConnected = false;
  for (const line of output.split('\n')) {
    const lower = line.trim().toLowerCase();
    if (lower.startsWith('daemon:')) {
      daemonRunning = !lower.includes('not running') && lower.includes('running');
    } else if (lower.startsWith('extension:')) {
      extensionConnected = !lower.includes('disconnected') && lower.includes('connected');
    }
  }
  let extensionInstalled = false;
  let hint = '';
  if (!extensionConnected) {
    extensionInstalled = extensionInstalledOnDisk();
    if (!extensionInstalled) {
      hint = `OpenCLI 已安装，但 Chrome 扩展未安装。\n  1. 安装扩展（需手动点一次）：${OPENCLI_EXTENSION_URL}\n  2. 保持 Chrome 打开，运行 \`opencli doctor\` 验证`;
    }
  }
  // 对齐 OpenCLIStatus.ready: installed && !broken && (extension_connected || extension_installed)
  // 走到这里 installed=true, broken=false
  const ready = extensionConnected || extensionInstalled;
  return { installed: true, broken: false, daemonRunning, extensionConnected, extensionInstalled, version, hint, ready };
}

/** OpenCLI 探活（channel 视角）—— 对齐 bilibili.py: _check_opencli。 */
async function checkOpencli(): Promise<BackendFinding | undefined> {
  const st = await opencliStatus();
  if (!st.installed) return undefined; // not installed — not a candidate
  if (st.broken) return { backend: 'OpenCLI', status: 'error', message: st.hint };
  if (st.ready) {
    return {
      backend: 'OpenCLI',
      status: 'ok',
      message: 'OpenCLI 可用（复用浏览器登录态）。用法：opencli bilibili search/video/subtitle/ranking -f yaml',
    };
  }
  return { backend: 'OpenCLI', status: 'warn', message: st.hint || 'OpenCLI 已安装但未就绪，运行 `opencli doctor` 诊断' };
}

async function checkSearchApi(): Promise<BackendFinding | undefined> {
  try {
    const data = await httpJson<{ code?: number }>(SEARCH_API, { headers: { 'User-Agent': UA }, timeoutMs: TIMEOUT });
    if (data?.code === 0) {
      return {
        backend: 'B站搜索 API',
        status: 'ok',
        message: 'B站搜索 API 可达（仅搜索，curl 直连）。完整功能建议安装 bili-cli：pipx install bilibili-cli',
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function check(): Promise<Availability> {
  const order = orderedBackends('bilibili', DEFAULT_BACKENDS, (k) => getConfig().get(k));
  const findings: BackendFinding[] = [];
  for (const backend of order) {
    let r: BackendFinding | undefined;
    if (backend === 'bili-cli') r = await checkBiliCli();
    else if (backend === 'OpenCLI') r = await checkOpencli();
    else r = await checkSearchApi();
    if (r) findings.push(r);
  }
  const selected = selectBackend(findings);
  if (selected) {
    return {
      channel: 'bilibili',
      status: selected.status,
      activeBackend: selected.activeBackend,
      message: selected.message,
    };
  }
  return {
    channel: 'bilibili',
    status: 'off',
    activeBackend: undefined,
    message:
      '没有可用的 B站后端（搜索 API 也不可达，可能是网络问题）。推荐：\n  pipx install bilibili-cli（搜索/热门/视频详情，无需登录）\n  或桌面装 OpenCLI（额外解锁字幕）：agent-reach install --channels opencli',
  };
}

// -------------------- 数据获取（搜索 API 兜底） --------------------

interface BiliSearchItem {
  title: string;
  url: string;
  author: string;
  play: string;
  danmaku: string;
  description: string;
}

/** 通过搜索 API 兜底搜索 —— 对齐 bilibili.py 的搜索 API 用法。 */
export async function searchByApi(keyword: string, limit = 10): Promise<BiliSearchItem[]> {
  const url = `https://api.bilibili.com/x/web-interface/search/all/v2?keyword=${encodeURIComponent(keyword)}&page=1`;
  const data = await httpJson<{
    data?: {
      result?: Array<{
        result_type?: string;
        data?: Array<{
          title?: string;
          arcurl?: string;
          author?: string;
          play?: string;
          video_review?: string;
          description?: string;
        }>;
      }>;
    };
  }>(url, { headers: { 'User-Agent': UA }, timeoutMs: TIMEOUT });
  const videoSection = (data?.data?.result ?? []).find((s) => s.result_type === 'video');
  const items = videoSection?.data ?? [];
  return items.slice(0, limit).map((x) => ({
    title: stripTags(x.title ?? ''),
    url: x.arcurl ?? '',
    author: x.author ?? '',
    play: x.play ?? '',
    danmaku: x.video_review ?? '',
    description: x.description ?? '',
  }));
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

// -------------------- 工具注册 --------------------

const ACTIONS = ['search', 'check'] as const;

export const bilibiliReadTool: AnyAgentTool = {
  label: 'Bilibili Read',
  name: 'bilibili_read',
  description:
    '读取 B站内容。action: search=搜索视频（搜索 API 兜底，零配置）, check=探测可用后端（bili-cli/OpenCLI/搜索 API）。完整功能建议装 bili-cli。yt-dlp 已停用（412 风控）。',
  parameters: Schema.object({
    action: Schema.enum(ACTIONS, '读取动作（默认 search）'),
    keyword: Schema.optional(Schema.string('action=search 时的搜索关键词')),
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
      // search
      const keyword = readStringParam(params, 'keyword', { required: true, label: 'keyword' });
      if (!keyword) return errorResult('keyword is required for action=search');
      const items = await searchByApi(keyword, limit);
      return jsonResult({ status: 'ok', success: true, action, backend: 'B站搜索 API', count: items.length, items });
    } catch (e) {
      const originalError = String(e instanceof Error ? e.message : e);
      const policy = getConfig().get<string>('browser_fallback', 'auto');
      if (policy !== 'auto') return errorResult(originalError, {
        action, browserFallback: policy === 'off' ? 'disabled' : 'unavailable',
      });
      const keyword = readStringParam(params, 'keyword');
      const url = `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`;
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
