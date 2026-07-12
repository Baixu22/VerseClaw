/**
 * 上游 CLI 命令探活 —— 重构自 agent_reach/probe.py: probe_command。
 *
 * 分类语义对齐 Python 版：
 *   - missing: 不在 PATH
 *   - broken: 在 PATH 但 exec 失败（venv 断链 / shebang 解释器丢失）
 *   - timeout: 跑了但超时
 *   - error: 跑了但非零退出
 *   - ok: 零退出
 *
 * Node 实现：公共 runtime runner 替代 subprocess.run；ENOENT 对应
 * Python 的 FileNotFoundError。126/127 同 Python 的 _BROKEN_EXIT_CODES。
 */
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { ProbeResult } from '../types.js';
import { runReachCommand } from './command.js';

/** shell 用来表示"找到但不可执行/找不到"的退出码 —— 对齐 Python _BROKEN_EXIT_CODES。 */
const BROKEN_EXIT_CODES = new Set([126, 127]);

/** 重装处方 —— 对齐 Python reinstall_hint。 */
export function reinstallHint(pkg: string): string {
  return [
    `命令存在但无法执行——通常是系统 Python 升级后 venv 解释器丢失。重装即可修复：`,
    `  uv tool install --force ${pkg}`,
    `或：pipx reinstall ${pkg}`,
  ].join('\n');
}

/** which —— 等价 Python shutil.which。Node 用 createRequire.resolve 不可靠，直接用 PATH 搜索。 */
function which(cmd: string): string | undefined {
  const require = createRequire(import.meta.url);
  // 优先用 which npm 包（如果环境恰好装了）；否则退回到 PATH 搜索。
  try {
    const whichPkg = require('which');
    const syncWhich = whichPkg?.sync;
    if (typeof syncWhich === 'function') {
      try {
        const resolved = syncWhich(cmd, { nothrow: true });
        return typeof resolved === 'string' ? resolved : undefined;
      } catch {
        // fall through
      }
    }
  } catch {
    // which 包不存在，走 PATH 搜索
  }
  return whichFromPath(cmd);
}

function whichFromPath(cmd: string): string | undefined {
  const pathEnv = process.env.PATH ?? '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE').split(';') : [''];
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      try {
        // 同步 stat 够用：probe 是冷启动一次性
        const stat = statSyncOrNull(candidate);
        if (stat?.isFile()) return candidate;
      } catch {
        // ignore
      }
    }
  }
  return undefined;
}

function statSyncOrNull(p: string) {
  try {
    // 内联 require fs 只为这一处同步 stat；避免顶部 import fs 整包
    return statSyncShim(p);
  } catch {
    return undefined;
  }
}

function statSyncShim(p: string) {
  return statSync(p);
}

/**
 * 探活上游命令。仅用于无副作用的 version/status 探测。
 *
 * @param pkg pip/pipx 包名，用于 broken 处方；默认同 cmd
 */
export async function probeCommand(
  cmd: string,
  args: string[] = ['--version'],
  opts: { timeoutMs?: number; retries?: number; pkg?: string; signal?: AbortSignal } = {},
): Promise<ProbeResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retries = opts.retries ?? 0;
  const pkg = opts.pkg ?? cmd;

  const resolved = which(cmd);
  if (!resolved) {
    return { status: 'missing', output: '', hint: '' };
  }

  let last: ProbeResult = { status: 'error', output: '', hint: '' };
  for (let attempt = 0; attempt < retries + 1; attempt++) {
    last = await runOnce(resolved, args, timeoutMs, pkg, opts.signal);
    if (last.status === 'ok') return last;
    // missing/broken 不会跨重试自愈，只有 timeout/error 才值得重试
    if (last.status === 'missing' || last.status === 'broken') return last;
  }
  return last;
}

async function runOnce(
  binPath: string,
  args: string[],
  timeoutMs: number,
  pkg: string,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  try {
    const result = await runReachCommand(binPath, args, {
      timeoutMs,
      signal,
      maxOutputBytes: 1024 * 1024,
      env: utf8Env(),
    });
    const output = `${result.stdout}${result.stderr}`.trim();
    if (result.termination === 'timeout' || result.termination === 'no-output-timeout') {
      return { status: 'timeout', output, hint: `\`${binPath}\` timed out after ${timeoutMs}ms` };
    }
    if (result.code === 0) return { status: 'ok', output, hint: '' };
    if (result.code !== null && BROKEN_EXIT_CODES.has(result.code)) {
      return { status: 'broken', output, hint: reinstallHint(pkg) };
    }
    return { status: 'error', output, hint: '' };
  } catch (e: unknown) {
    // Spawn/resolver errors may carry errno and process termination metadata.
    const err = e as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
      signal?: NodeJS.Signals;
      exitCode?: number;
    };
    // ENOENT: which 命中但 exec 失败 = shebang 解释器丢失（venv 断链）
    if (err.code === 'ENOENT') {
      return { status: 'broken', output: '', hint: reinstallHint(pkg) };
    }
    // 其他 OSError 类 errno（EACCES/EPERM/EISDIR 等）—— 对齐 Python probe.py:92-93 的 except OSError→broken
    // 这些表示二进制存在但不可执行（权限问题、是目录等），归类为 broken 带重装处方
    if (typeof err.code === 'string' && err.code.startsWith('E') && err.code !== 'ENOENT') {
      return { status: 'broken', output: '', hint: reinstallHint(pkg) };
    }
    // Compatibility fallback for runner/resolver errors carrying timeout metadata.
    if (err.killed === true || err.signal === 'SIGTERM') {
      return { status: 'timeout', output: '', hint: `\`${binPath}\` 响应超时（>${timeoutMs}ms）` };
    }
    const code = typeof err.code === 'number' ? err.code : (typeof err.exitCode === 'number' ? err.exitCode : null);
    if (code !== null && BROKEN_EXIT_CODES.has(code)) {
      return { status: 'broken', output: '', hint: reinstallHint(pkg) };
    }
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
    if (code !== null && code !== 0) {
      return { status: 'error', output, hint: '' };
    }
    // 其他未知错误归类为 error
    return { status: 'error', output, hint: err.message ?? '' };
  }
}

/** UTF-8 安全的子进程环境 —— 对齐 agent_reach/utils/process.py: utf8_subprocess_env。 */
export function utf8Env(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // 强制 UTF-8 输出，避免 Windows GBK 控制台把上游输出弄乱
  env.LANG = `${env.LANG ?? 'en_US.UTF-8'}`.replace(/\.[A-Z0-9-]+$/i, '.UTF-8');
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONUTF8 = '1';
  return env;
}

// ------------------------------------------------------------------
// HTTP helper —— 重构自 channels/v2ex.py / xueqiu.py / bilibili.py 里的 urllib 调用
// ------------------------------------------------------------------

const _DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface HttpJsonOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** 跳过代理（localhost 探活用）。 */
  noProxy?: boolean;
}

/** fetch JSON —— 对齐 channels/* 里的 _get_json。Node 18+ 内置 fetch。 */
export async function httpJson<T = unknown>(url: string, opts: HttpJsonOptions = {}): Promise<T> {
  const { httpJson: guardedHttpJson } = await import('./http.js');
  return guardedHttpJson<T>(url, opts);
}

/** fetch text —— 用于 Jina Reader / RSS。 */
export async function httpText(url: string, opts: HttpJsonOptions = {}): Promise<string> {
  const { httpText: guardedHttpText } = await import('./http.js');
  return guardedHttpText(url, opts);
}

/**
 * 带代理控制的 fetch —— 对齐 Python urllib 的 ProxyHandler({}) / 默认 opener 行为。
 *
 * Node 18+ undici fetch 默认不读 HTTP_PROXY/HTTPS_PROXY 环境变量，
 * 所以 noProxy=true 时直接 fetch 即可（等价于 Python 的 ProxyHandler({})）。
 * noProxy=false 时也直接 fetch（等价于 Python 的默认 opener，但 Node 行为不同——
 * Python 默认读 HTTP_PROXY，Node 默认不读）。这是有意分歧：shadow 版不自动走代理。
 */
async function _fetchWithProxyControl(url: string, init: RequestInit & { noProxy?: boolean }): Promise<Response> {
  // Node fetch 默认不走代理环境变量，noProxy 参数在此实现里是 no-op（但保留 API 兼容）。
  // 迁移到 ClawX 时如需代理支持，可在此处注入 undici ProxyAgent 或 setGlobalDispatcher。
  return fetch(url, init);
}

/** 同步读 UTF-8 文本 —— 对齐 utils/text.py: read_utf8_text（迁移用，shadow 不常调）。 */
export function readUtf8Text(filePath: string, def = ''): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return def;
  }
}
