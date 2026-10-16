import { inlineMarkdown, inlineText, codeSpan, fencedBlock } from '../security/markdown.ts';
import { redactSecretsInValue } from '../security/redact-secrets.ts';
/**
 * explain_error：console stack → 过滤 → source map → 原始文件:行 + 片段。
 * 栈解析纯函数可单测；source map 解析委托已有 SourceMapToolExecutor / host API。
 * Offline CLI can also resolve via local `.js.map` files (createFsSourceMapResolver).
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import type {
  ExplainErrorFrameResult,
  ExplainErrorResult,
  StackFrame,
} from '../contracts/index.ts';

const FRAME_PATTERNS: RegExp[] = [
  // at fn (url:line:col)
  /^\s*at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)\s*$/,
  // at url:line:col
  /^\s*at\s+(.+?):(\d+):(\d+)\s*$/,
  // fn (url:line:col)  — Firefox style without leading at
  /^(.+?)\s+\((.+?):(\d+):(\d+)\)\s*$/,
  // fn@url:line:col — Firefox / Safari style
  /^(.+?)@(.+?):(\d+):(\d+)\s*$/,
  // url:line:col
  /^(.+?):(\d+):(\d+)\s*$/,
];

const NOISE_URL_PATTERNS = [
  /node_modules\//u,
  /^chrome-extension:/u,
  /^moz-extension:/u,
  /^webkit-masked-url:/u,
  /^<anonymous>$/u,
  /^native$/u,
  /^node:/u,
  /\/vitest\//u,
  /\/@vitest\//u,
];

export function isNoiseStackFrame(frame: StackFrame): boolean {
  const url = frame.url ?? '';
  if (!url) return true;
  return NOISE_URL_PATTERNS.some((pattern) => pattern.test(url));
}

export function parseErrorStack(stack: string | undefined | null): {
  message: string;
  frames: StackFrame[];
} {
  const text = String(stack ?? '').replace(/\r\n/g, '\n');
  const lines = text.split('\n').map((line) => line.trimEnd());
  const messageLines: string[] = [];
  const frames: StackFrame[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const frame = parseStackLine(line);
    if (frame) {
      frames.push(frame);
      continue;
    }
    if (frames.length === 0) {
      messageLines.push(line.trim());
    }
  }

  return {
    message: messageLines.join('\n').trim() || text.trim().split('\n')[0] || 'Unknown error',
    frames,
  };
}

function parseStackLine(line: string): StackFrame | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;

  for (const pattern of FRAME_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (!match) continue;

    if (pattern === FRAME_PATTERNS[0] || pattern === FRAME_PATTERNS[2] || pattern === FRAME_PATTERNS[3]) {
      const [, functionName, url, lineNo, colNo] = match;
      return {
        functionName: functionName.trim(),
        url: stripUrlNoise(url),
        line: Number(lineNo),
        column: Number(colNo),
        raw: trimmed,
      };
    }
    const [, url, lineNo, colNo] = match;
    return {
      url: stripUrlNoise(url),
      line: Number(lineNo),
      column: Number(colNo),
      raw: trimmed,
    };
  }
  return undefined;
}

function stripUrlNoise(url: string): string {
  return url.replace(/^['"]|['"]$/g, '').trim();
}

export type SourceMapResolver = (frame: StackFrame) => Promise<ExplainErrorFrameResult>;

export type ExplainErrorOptions = {
  /** Optional live-session resolver (source map + snippet). */
  resolve?: SourceMapResolver;
  /** Keep at most N app frames after filtering. Default 8. */
  maxFrames?: number;
};

export async function explainError(
  errorText: string,
  options: ExplainErrorOptions = {},
): Promise<ExplainErrorResult> {
  const maxFrames = options.maxFrames ?? 8;
  const { message, frames: allFrames } = parseErrorStack(errorText);
  const appFrames = allFrames.filter((frame) => !isNoiseStackFrame(frame)).slice(0, maxFrames);

  const frames: ExplainErrorFrameResult[] = [];
  for (const frame of appFrames) {
    if (options.resolve) {
      try {
        frames.push(await options.resolve(frame));
        continue;
      } catch (error) {
        frames.push({
          ...frame,
          mapped: false,
          reason: error instanceof Error ? error.message : 'source map resolve failed',
        });
        continue;
      }
    }
    frames.push({
      ...frame,
      mapped: false,
      reason: 'no source-map resolver attached (session offline or map unavailable)',
    });
  }

  const primary = frames.find((frame) => frame.mapped && frame.originalLine) ?? frames[0];
  const suggestion = buildSuggestion(primary, message);

  const content = formatExplainContent(message, frames, primary, suggestion);
  return redactSecretsInValue({
    message,
    frames,
    ...(primary ? { primary } : {}),
    ...(suggestion ? { suggestion } : {}),
    content,
  });
}

function buildSuggestion(
  primary: ExplainErrorFrameResult | undefined,
  message: string,
): string | undefined {
  if (!primary) {
    return '未解析到应用栈帧。请确认错误包含 stack，且资源非 node_modules / 扩展。';
  }
  const loc = primary.originalLine
    ? `${primary.source ?? primary.url}:${primary.originalLine}:${primary.originalColumn ?? 0}`
    : `${primary.url}:${primary.line}:${primary.column ?? 0}`;
  const kind = /undefined|null|is not a function|Cannot read/u.test(message)
    ? '优先检查空值与可选链'
    : /timeout|aborted/i.test(message)
      ? '检查异步时序与加载状态'
      : '从该源码行入手定位';
  return `建议先改 ${loc} — ${kind}。`;
}

function formatExplainContent(
  message: string,
  frames: ExplainErrorFrameResult[],
  primary: ExplainErrorFrameResult | undefined,
  suggestion: string | undefined,
): string {
  const lines: string[] = [`## explain_error`, ``];
  if (primary) {
    const file = primary.source ?? primary.url ?? '(unknown)';
    const line = primary.originalLine ?? primary.line ?? '?';
    const col = primary.originalColumn ?? primary.column ?? '?';
    lines.push(inlineMarkdown`**Primary mapping:** ${primary.mapped ? 'mapped' : 'unmapped'}`);
    lines.push(inlineMarkdown`**Primary source:** ${codeSpan(inlineMarkdown`${file}:${line}:${col}`)}`, '');
  }
  // Keep attribution ahead of page-controlled text that can exhaust the MCP budget.
  lines.push(inlineMarkdown`**Error:** ${inlineText(message)}`, '');
  if (frames.length === 0) {
    lines.push('（无可用应用栈帧）');
  } else {
    lines.push('### Frames', '');
    frames.forEach((frame, index) => {
      const loc = frame.mapped && frame.originalLine
        ? inlineMarkdown`${frame.source ?? frame.url}:${frame.originalLine}:${frame.originalColumn ?? 0}`
        : inlineMarkdown`${frame.url ?? '?'}:${frame.line ?? '?'}:${frame.column ?? '?'}`;
      const mark = frame.mapped ? '✓' : '·';
      lines.push(inlineMarkdown`${index + 1}. ${mark} ${frame.functionName ? inlineMarkdown`${inlineText(frame.functionName)} → ` : ''}${inlineText(loc)}`);
      if (frame.snippet) {
        lines.push('');
        lines.push(fencedBlock(frame.snippet));
      } else if (frame.reason) {
        lines.push(inlineMarkdown`   _${inlineText(frame.reason)}_`);
      }
    });
  }
  if (suggestion) {
    lines.push('', `### Suggestion`, '', inlineText(suggestion));
  }
  return lines.join('\n');
}

/**
 * Offline resolver: local `.js.map` files on disk.
 * Matches frame URL basename → `basename.map` (or explicit mapPaths).
 */
export function createFsSourceMapResolver(options: {
  /** Absolute or cwd-relative paths to source map files. */
  mapPaths?: string[];
  /** Extra directories to search for `<script>.map` (e.g. dist/, public/). */
  searchDirs?: string[];
}): SourceMapResolver {
  return async (frame) => {
    const url = frame.url ?? '';
    if (!url || frame.line == null) {
      return { ...frame, mapped: false, reason: 'frame missing url/line' };
    }
    const loaded = await loadLocalSourceMaps(options);
    const base = basenameFromUrl(url);
    const entry = loaded.get(base) ?? [...loaded.values()][0];
    if (!entry) {
      return {
        ...frame,
        mapped: false,
        reason: 'local source map not found (pass --map or place <script>.js.map beside the bundle)',
      };
    }
    const pos = originalPositionFor(entry.map, {
      line: frame.line,
      column: Math.max(0, (frame.column ?? 1) - 1),
    });
    if (!pos.source || pos.line == null) {
      return { ...frame, mapped: false, reason: 'source map did not resolve this generated position' };
    }
    const clean = pos.source.replace(/^spec:/u, '').replace(/^\.\//u, '');
    const text =
      entry.sources.get(pos.source) ??
      entry.sources.get(clean) ??
      entry.sources.get(basenameFromUrl(clean)) ??
      '';
    const snippetLine = text.split('\n')[pos.line - 1]?.trim();
    return {
      ...frame,
      mapped: true,
      source: clean,
      originalLine: pos.line,
      originalColumn: (pos.column ?? 0) + 1,
      name: pos.name ?? frame.functionName,
      snippet: snippetLine ? `L${pos.line}: ${snippetLine}` : undefined,
    };
  };
}

function basenameFromUrl(url: string): string {
  const noQuery = url.split(/[?#]/u)[0] ?? url;
  const parts = noQuery.split(/[\\/]/u);
  return parts[parts.length - 1] || noQuery;
}

type LoadedMap = {
  map: TraceMap;
  sources: Map<string, string>;
};

async function loadLocalSourceMaps(options: {
  mapPaths?: string[];
  searchDirs?: string[];
}): Promise<Map<string, LoadedMap>> {
  const out = new Map<string, LoadedMap>();
  const candidates: string[] = [...(options.mapPaths ?? [])];
  for (const dir of options.searchDirs ?? []) {
    try {
      const names = await readdir(dir);
      for (const name of names) {
        if (name.endsWith('.map')) candidates.push(join(dir, name));
      }
    } catch {
      /* ignore missing dirs */
    }
  }
  for (const mapPath of candidates) {
    try {
      const raw = JSON.parse(await readFile(mapPath, 'utf8')) as {
        sources?: string[];
        sourcesContent?: (string | null)[];
      };
      const map = new TraceMap(raw as never);
      const sources = new Map<string, string>();
      raw.sources?.forEach((source, index) => {
        const content = raw.sourcesContent?.[index];
        if (typeof content === 'string') {
          sources.set(source, content);
          sources.set(source.replace(/^spec:/u, ''), content);
          sources.set(basenameFromUrl(source), content);
        }
      });
      const key = basenameFromUrl(mapPath).replace(/\.map$/u, '');
      out.set(key, { map, sources });
      out.set(basenameFromUrl(mapPath), { map, sources });
    } catch {
      /* skip unreadable maps */
    }
  }
  return out;
}

/** Build a SourceMapResolver from the host API sourceMapExtractOriginalContext. */
export function createHostSourceMapResolver(
  extract: (args: {
    sessionId: string;
    resourceId: string;
    line: number;
    column: number;
    radius?: number;
    allowSameOriginFetch?: boolean;
  }) => Promise<{
    originalContexts?: Array<{
      source?: string;
      originalLine?: number;
      originalColumn?: number;
      name?: string;
      snippet?: string;
      redacted?: boolean;
      truncated?: boolean;
    }>;
  }>,
  options: { sessionId: string; urlToResourceId: (url: string) => string | undefined; allowSameOriginFetch?: boolean },
): SourceMapResolver {
  return async (frame) => {
    const resourceId = frame.url ? options.urlToResourceId(frame.url) : undefined;
    if (!resourceId || !frame.line) {
      return {
        ...frame,
        mapped: false,
        reason: resourceId ? 'frame missing line/column' : 'resource not in JS source index',
      };
    }
    const result = await extract({
      sessionId: options.sessionId,
      resourceId,
      line: frame.line,
      column: frame.column ?? 0,
      radius: 8,
      allowSameOriginFetch: options.allowSameOriginFetch,
    });
    const context = result.originalContexts?.[0];
    if (!context?.originalLine) {
      return {
        ...frame,
        mapped: false,
        reason: 'source map did not resolve this generated position',
      };
    }
    return {
      ...frame,
      mapped: true,
      source: context.source,
      originalLine: context.originalLine,
      originalColumn: context.originalColumn,
      name: context.name ?? frame.functionName,
      snippet: context.snippet,
      redacted: context.redacted,
      truncated: context.truncated,
    };
  };
}
