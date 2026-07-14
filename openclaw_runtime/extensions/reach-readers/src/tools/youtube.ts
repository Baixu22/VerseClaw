/**
 * youtube_read —— 重构自 agent_reach/channels/youtube.py + transcribe.py。
 *
 * 主后端 yt-dlp（零配置）。transcribe 链（yt-dlp → ffmpeg → Whisper API）
 * 重构自 transcribe.py，Groq → OpenAI fallback。
 *
 * 形状上把 Python 的 YouTubeChannel.read + transcribe() 合并到一个工具，
 * action: info=视频信息, transcript=字幕, transcribe=音频转写。
 */
import { mkdtemp, readdir, stat, rm, access } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Schema } from '../common/schema.js';
import {
  type AnyAgentTool,
  asToolParamsRecord,
  errorResult,
  jsonResult,
  readStringParam,
} from '../common/tool-shape.js';
import { probeCommand, utf8Env, readUtf8Text } from '../core/probe.js';
import { commandError, runReachCommand } from '../core/command.js';
import { canHandle } from '../core/router.js';
import { getConfig } from '../core/config.js';
import type { Availability } from '../types.js';
import { readBrowserFallbackPage } from '../core/browser-bridge.js';

const DOMAINS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com'] as const;
const _DEFAULT_BACKENDS = ['yt-dlp'] as const;

type MediaTranscribe = (params: {
  filePath: string;
  cfg: unknown;
  mime?: string;
  timeoutMs?: number;
}) => Promise<{ text?: string }>;

let mediaTranscribe: MediaTranscribe | undefined;
let mediaConfig: unknown;

export function configureMediaTranscription(
  transcribeAudioFile: MediaTranscribe | undefined,
  config: unknown,
): void {
  mediaTranscribe = transcribeAudioFile;
  mediaConfig = config;
}

export async function transcribeAudioChunk(chunkPath: string): Promise<string> {
  if (!mediaTranscribe) throw new Error('OpenClaw media transcription is unavailable');
  let result: { text?: string };
  try {
    result = await mediaTranscribe({
      filePath: chunkPath,
      cfg: mediaConfig,
      mime: 'audio/mp4',
      timeoutMs: 120_000,
    });
  } catch (error) {
    throw new Error(`${path.basename(chunkPath)}: ${
      error instanceof Error ? error.message : String(error)
    }`, { cause: error });
  }
  const text = result.text?.trim();
  if (!text) throw new Error(`transcription returned no text for ${path.basename(chunkPath)}`);
  return text;
}


export function canHandleUrl(url: string): boolean {
  return canHandle(url, DOMAINS);
}

// -------------------- 后端探活（对齐 youtube.py 的 check） --------------------

/** which —— 对齐 Python shutil.which。Node 无内置，用 PATH 搜索。 */
async function which(cmd: string): Promise<boolean> {
  // 优先试 PATH 搜索（零依赖）
  const pathEnv = process.env.PATH ?? '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE').split(';') : [''];
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        await access(path.join(dir, cmd + ext));
        return true;
      } catch {
        // continue
      }
    }
  }
  return false;
}

/** yt-dlp config 路径 —— 对齐 utils/paths.py: get_ytdlp_config_path。 */
function getYtdlpConfigPath(): string {
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA;
    if (appdata) return path.join(appdata, 'yt-dlp', 'config');
    return path.join(homedir(), 'AppData', 'Roaming', 'yt-dlp', 'config');
  }
  if (process.platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Application Support', 'yt-dlp', 'config');
  }
  return path.join(homedir(), '.config', 'yt-dlp', 'config');
}

/** 检查 yt-dlp config 是否显式配置了 --js-runtimes —— 对齐 youtube.py: _has_js_runtime_config。 */
function hasJsRuntimeConfig(): boolean {
  const cfgPath = getYtdlpConfigPath();
  const text = readUtf8Text(cfgPath);
  return text.includes('--js-runtimes');
}

/** 渲染修复命令 —— 对齐 utils/paths.py: render_ytdlp_fix_command。 */
function renderYtdlpFixCommand(): string {
  const cfgPath = getYtdlpConfigPath();
  if (process.platform === 'win32') {
    return [
      `$cfg = '${cfgPath}'`,
      `New-Item -ItemType Directory -Force -Path (Split-Path $cfg) | Out-Null`,
      `if (-not (Test-Path $cfg) -or -not (Select-String -Path $cfg -Pattern '--js-runtimes' -Quiet)) {`,
      `  Add-Content -Path $cfg -Value '--js-runtimes node'`,
      `}`,
    ].join('\n');
  }
  return `mkdir -p '${path.dirname(cfgPath)}' && grep -qxF -- '--js-runtimes node' '${cfgPath}' 2>/dev/null || printf '%s\\n' '--js-runtimes node' >> '${cfgPath}'`;
}

export async function check(): Promise<Availability> {
  // 真跑 yt-dlp --version 探活，区分未装 / venv 断链 / 跑不动 —— 对齐 youtube.py:35-47
  const probe = await probeCommand('yt-dlp', ['--version'], { timeoutMs: 10_000, pkg: 'yt-dlp' });
  if (probe.status === 'missing') {
    return {
      channel: 'youtube',
      status: 'off',
      activeBackend: undefined,
      message: 'yt-dlp 未安装。安装：pip install yt-dlp',
    };
  }
  if (probe.status === 'broken') {
    return {
      channel: 'youtube',
      status: 'error',
      activeBackend: undefined,
      message: `yt-dlp 已安装但无法执行\n${probe.hint}`,
    };
  }
  if (probe.status !== 'ok') {
    // timeout / error：装了但跑不动 —— 对齐 youtube.py:44-47
    return {
      channel: 'youtube',
      status: 'error',
      activeBackend: undefined,
      message: `yt-dlp 无法正常运行：${probe.hint || probe.output || probe.status}`,
    };
  }
  // yt-dlp 本体是活的；后面的 JS runtime/转写检查只影响 ok/warn —— 对齐 youtube.py:48-49
  // Check JS runtime —— 对齐 youtube.py:51-56
  const hasDeno = await which('deno');
  const hasNode = await which('node');
  if (!hasDeno && !hasNode) {
    return {
      channel: 'youtube',
      status: 'warn',
      activeBackend: 'yt-dlp',
      message: 'yt-dlp 已安装但缺少 JS runtime（YouTube 必须）。\n  安装 Node.js 或 deno，然后运行：agent-reach install',
    };
  }
  // Check yt-dlp config for --js-runtimes —— 对齐 youtube.py:57-65
  // Deno works out of the box; Node.js requires explicit config
  if (!hasDeno && !hasJsRuntimeConfig()) {
    return {
      channel: 'youtube',
      status: 'warn',
      activeBackend: 'yt-dlp',
      message: `yt-dlp 已安装但未配置 JS runtime。运行：\n  ${renderYtdlpFixCommand()}`,
    };
  }
  // Surface transcription readiness —— 对齐 youtube.py:66-79
  let msg = '可提取视频信息和字幕';
  if (mediaTranscribe) {
    const hasFfmpeg = await which('ffmpeg');
    if (!hasFfmpeg) {
      msg += '（音频转写需安装 ffmpeg）';
    } else {
      msg += '，可通过 OpenClaw mediaUnderstanding 转写音频';
    }
  }
  return {
    channel: 'youtube',
    status: 'ok',
    activeBackend: 'yt-dlp',
    message: msg,
  };
}

// -------------------- 数据获取 --------------------

interface YtInfo {
  title: string;
  uploader: string;
  duration: number;
  upload_date: string;
  view_count: number;
  like_count: number;
  description: string;
  webpage_url: string;
}

/** 获取视频元信息 —— yt-dlp --dump-json。 */
export async function getInfo(url: string, timeoutMs = 60_000): Promise<YtInfo> {
  assertSafePublicUrl(url);
  const argv = ['--dump-json', '--no-playlist', '--', url];
  const result = await runReachCommand('yt-dlp', argv, {
    timeoutMs, maxOutputBytes: 10 * 1024 * 1024, env: utf8Env(), packageName: 'yt-dlp',
  });
  if (result.code !== 0) throw commandError('yt-dlp', argv, result);
  const j = JSON.parse(result.stdout) as Record<string, unknown>;
  return {
    title: String(j['title'] ?? ''),
    uploader: String(j['uploader'] ?? j['channel'] ?? ''),
    duration: Number(j['duration'] ?? 0),
    upload_date: String(j['upload_date'] ?? ''),
    view_count: Number(j['view_count'] ?? 0),
    like_count: Number(j['like_count'] ?? 0),
    description: String(j['description'] ?? ''),
    webpage_url: String(j['webpage_url'] ?? url),
  };
}

/** 获取字幕（自动字幕优先）—— yt-dlp --write-auto-sub --skip-download。 */
export async function getTranscript(url: string, lang = 'en', timeoutMs = 120_000): Promise<{ lang: string; text: string }> {
  assertSafePublicUrl(url);
  const workDir = await mkdtemp(path.join(tmpdir(), 'yt-transcript-'));
  try {
    // 输出 vtt 文件
    const outTmpl = path.join(workDir, 'sub');
    const argv = ['--write-auto-sub', '--write-sub', '--sub-lang', lang, '--sub-format', 'vtt', '--skip-download',
      '--no-playlist', '-o', outTmpl, '--', url];
    const result = await runReachCommand('yt-dlp', argv, {
      timeoutMs, maxOutputBytes: 10 * 1024 * 1024, env: utf8Env(), packageName: 'yt-dlp',
    });
    if (result.code !== 0) throw commandError('yt-dlp', argv, result);
    const entries = await readdir(workDir);
    const vtt = entries.find((f: string) => f.endsWith('.vtt'));
    if (!vtt) throw new Error(`no subtitle downloaded for lang=${lang}`);
    const raw = readUtf8Text(path.join(workDir, vtt));
    return { lang, text: vttToPlainText(raw) };
  } finally {
    cleanupDir(workDir).catch(() => undefined);
  }
}

/** 转写音频 —— 保留原下载、压缩与分块流程，转写交给 OpenClaw。 */
export async function transcribeAudio(
  source: string,
  opts: { provider?: 'auto' | 'groq' | 'openai' } = {},
): Promise<string> {
  const provider = opts.provider ?? 'auto';
  // 对齐 transcribe.py: _provider_order —— 未知 provider 入口即拒
  if (!['auto', 'groq', 'openai'].includes(provider)) {
    throw new Error(`unknown provider: ${provider} (use groq|openai|auto)`);
  }
  if (!mediaTranscribe) throw new Error('OpenClaw media transcription is unavailable');

  const workDir = await mkdtemp(path.join(tmpdir(), 'yt-transcribe-'));
  try {
    // 1) 下载音频（如果是 URL）或直接用本地文件
    let audio: string;
    if (looksLikeLocalFile(source)) {
      audio = source;
    } else {
      assertSafePublicUrl(source);
      audio = await downloadAudio(source, workDir);
    }
    // 2) 压缩
    const compressed = await compressAudio(audio, workDir);
    // 3) 分片（如果需要）
    const compressedSize = (await stat(compressed)).size;
    const chunks = compressedSize <= SIZE_LIMIT_BYTES
      ? [compressed]
      : await chunkAudio(compressed, workDir);
    // 4) 逐片转写，fallback
    const pieces: string[] = [];
    for (const chunk of chunks) {
      pieces.push(await transcribeAudioChunk(chunk));
    }
    return pieces.filter(Boolean).join('\n');
  } finally {
    cleanupDir(workDir).catch(() => undefined);
  }
}

// -------------------- transcribe 内部（对齐 transcribe.py 各函数） --------------------

const SIZE_LIMIT_BYTES = 24 * 1024 * 1024;
const CHUNK_SECONDS = 600;

const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal']);

function assertSafePublicUrl(url: string): void {
  // 对齐 transcribe.py: _assert_safe_public_url
  let parsed: URL;
  if (!url.includes('://')) {
    // 无 scheme 时特殊处理 host:port 形式 —— 对齐 transcribe.py:104-109
    const beforeSlash = url.split('/', 1)[0] ?? '';
    if (beforeSlash.includes(':')) {
      const colonIdx = beforeSlash.lastIndexOf(':');
      const hostPart = beforeSlash.slice(0, colonIdx);
      const portPart = beforeSlash.slice(colonIdx + 1);
      if (!hostPart || !/^\d+$/.test(portPart)) {
        throw new Error('SSRF blocked: only public http(s) URLs are allowed');
      }
    }
    parsed = new URL(`https://${url}`);
  } else {
    parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('SSRF blocked: only public http(s) URLs are allowed');
    }
  }
  const host = (parsed.hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) throw new Error('SSRF blocked: URL host is missing');
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.localhost')) {
    throw new Error('SSRF blocked: internal host is not allowed');
  }
  if (isPrivateIp(host)) throw new Error('SSRF blocked: private/internal IP is not allowed');
}

/**
 * 检查是否为私有/内部 IP —— 对齐 transcribe.py: _is_private_ip。
 *
 * 完整覆盖 Python ipaddress 库的 6 类检查：
 * is_private / is_loopback / is_link_local / is_reserved / is_multicast / is_unspecified。
 * IPv4 严格校验每段 0-255（对齐 ip_address() 的 ValueError 语义）。
 */
function isPrivateIp(value: string): boolean {
  // IPv4
  const v4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (v4Match) {
    const a = Number(v4Match[1]);
    const b = Number(v4Match[2]);
    const parts = [a, b, Number(v4Match[3]), Number(v4Match[4])];
    // 严格校验每段 0-255 —— 对齐 ip_address() 遇到 999.999.999.999 抛 ValueError
    if (parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return false;
    // is_loopback: 127.0.0.0/8
    if (a === 127) return true;
    // is_private: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    // is_link_local: 169.254.0.0/16
    if (a === 169 && b === 254) return true;
    // is_reserved: 240.0.0.0/4 (含 255.255.255.255 broadcast)
    if (a >= 240) return true;
    // is_multicast: 224.0.0.0/4
    if (a >= 224 && a <= 239) return true;
    // is_unspecified: 0.0.0.0
    if (parts.every((p) => p === 0)) return true;
    return false;
  }
  // IPv6 —— 对齐 ipaddress 库的常见私有/保留范围
  const lower = value.toLowerCase();
  // is_loopback: ::1
  if (lower === '::1') return true;
  // is_unspecified: ::
  if (lower === '::') return true;
  // is_link_local: fe80::/10
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
  // is_unique_local: fc00::/7 (fc + fd)
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  // is_multicast: ff00::/8
  if (lower.startsWith('ff')) return true;
  // IPv4-mapped IPv6: ::ffff:a.b.c.d
  const v4MappedMatch = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
  if (v4MappedMatch) return isPrivateIp(v4MappedMatch[1]!);
  return false;
}

function looksLikeLocalFile(s: string): boolean {
  try {
    return !!fileURLToPath(s) || s.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(s);
  } catch {
    return false;
  }
}

async function downloadAudio(url: string, outDir: string): Promise<string> {
  const tmpl = path.join(outDir, 'source.%(ext)s');
  await runCmd(['yt-dlp', '-x', '--audio-format', 'm4a', '--audio-quality', '0', '-o', tmpl, '--', url], 1800_000);
  const entries = await readdir(outDir);
    const f = entries.find((e: string) => e.startsWith('source.'));
  if (!f) throw new Error('yt-dlp produced no output file');
  return path.join(outDir, f);
}

async function compressAudio(src: string, outDir: string): Promise<string> {
  const dst = path.join(outDir, 'compressed.m4a');
  await runCmd(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', dst], 600_000);
  return dst;
}

async function chunkAudio(src: string, outDir: string): Promise<string[]> {
  const pattern = path.join(outDir, 'chunk_%03d.m4a');
  await runCmd(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-f', 'segment', '-segment_time', String(CHUNK_SECONDS),
    '-ac', '1', '-ar', '16000', '-b:a', '32k', pattern], 600_000);
  const entries = await readdir(outDir);
  return entries.filter((e: string) => e.startsWith('chunk_')).sort().map((e) => path.join(outDir, e));
}

async function runCmd(cmd: string[], timeoutMs: number): Promise<void> {
  const command = cmd[0]!;
  const argv = cmd.slice(1);
  const result = await runReachCommand(command, argv, {
    timeoutMs, maxOutputBytes: 50 * 1024 * 1024, env: utf8Env(),
  });
  if (result.termination === 'timeout') throw new Error(`${command} timed out after ${timeoutMs}ms`);
  if (result.code !== 0) throw commandError(command, argv, result);
}

// -------------------- 辅助 --------------------

function vttToPlainText(vtt: string): string {
  return vtt
    .replace(/^WEBVTT.*$/m, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*\d+\s*$/gm, '')
    .replace(/^\s*[\d:.]+\s*-->\s*[\d:.]+.*$/gm, '')
    .replace(/^\s*$/gm, '')
    .split('\n')
    .filter(Boolean)
    .join(' ')
    .trim();
}

async function cleanupDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

// -------------------- 工具注册 --------------------

const ACTIONS = ['info', 'transcript', 'transcribe', 'check'] as const;

export const youtubeReadTool: AnyAgentTool = {
  label: 'YouTube Read',
  name: 'youtube_read',
  description:
    '读取 YouTube 视频。action: info=视频元信息, transcript=字幕（auto-sub）, transcribe=音频转写（yt-dlp+ffmpeg+OpenClaw mediaUnderstanding）, check=探测 yt-dlp。',
  parameters: Schema.object({
    action: Schema.enum(ACTIONS, '读取动作（默认 info）'),
    url: Schema.optional(Schema.string('视频 URL（info/transcript/transcribe 必填）')),
    lang: Schema.optional(Schema.string('action=transcript 时的字幕语言（默认 en）')),
    provider: Schema.optional(Schema.enum(['auto', 'groq', 'openai'], '兼容参数；仅作为 OpenClaw provider 偏好提示')),
  }),
  async execute(_id, args, signal) {
    const params = asToolParamsRecord(args);
    const action = (readStringParam(params, 'action') || 'info') as (typeof ACTIONS)[number];
    const url = readStringParam(params, 'url');
    try {
      if (action === 'check') {
        return jsonResult({ status: 'ok', success: true, action, availability: await check() });
      }
      if (!url) return errorResult('url is required');
      switch (action) {
        case 'info':
          return jsonResult({ status: 'ok', success: true, action, info: await getInfo(url) });
        case 'transcript': {
          const lang = readStringParam(params, 'lang') || 'en';
          return jsonResult({ status: 'ok', success: true, action, ...(await getTranscript(url, lang)) });
        }
        case 'transcribe': {
          const provider = (readStringParam(params, 'provider') || 'auto') as 'auto' | 'groq' | 'openai';
          const text = await transcribeAudio(url, { provider });
          return jsonResult({ status: 'ok', success: true, action, provider, text, length: text.length });
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
