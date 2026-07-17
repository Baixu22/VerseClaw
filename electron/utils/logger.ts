/**
 * Logger Utility
 * Centralized logging with levels, file output, rotation/retention,
 * write-failure visibility, secret redaction, and log retrieval for UI.
 *
 * File writes use an async buffered writer so that high-frequency logging
 * (e.g. during gateway startup) never blocks the Electron main thread.
 * Only the final `process.on('exit')` handler uses synchronous I/O to
 * guarantee the last few messages are flushed before the process exits.
 *
 * P5-003 (F-REL-005 / F-DATA-004 partial):
 * - size + day/total retention limits
 * - observable write health (no silent swallow of disk failures)
 * - secret / canary redaction before ring buffer and disk
 */
import { app } from 'electron';
import { join } from 'path';
import {
  existsSync,
  mkdirSync,
  appendFileSync,
  unlinkSync,
  readdirSync,
  statSync,
} from 'fs';
import { appendFile, open, readdir, rename, stat, unlink } from 'fs/promises';

/** Test-only override for async append (disk-full / read-only injection). */
type AppendImpl = (filePath: string, data: string) => Promise<void>;
let appendImpl: AppendImpl = (filePath, data) => appendFile(filePath, data);
export function setLogAppendImplForTests(impl: AppendImpl | null): void {
  appendImpl = impl ?? ((filePath, data) => appendFile(filePath, data));
}


/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export type LoggerLimits = {
  /** Max bytes for the active log file before size rotation. */
  maxFileBytes: number;
  /** Delete log files older than this many days (by mtime). */
  maxRetentionDays: number;
  /** Cap total bytes of all *.log under the log dir. */
  maxTotalBytes: number;
};

export type LoggerWriteHealth = {
  healthy: boolean;
  lastWriteOkAt: string | null;
  lastWriteError: string | null;
  lastWriteErrorCode: string | null;
  lastWriteErrorAt: string | null;
  consecutiveFailures: number;
  currentFileBytes: number;
  rotatedCount: number;
  purgedCount: number;
};

const DEFAULT_LIMITS: LoggerLimits = {
  maxFileBytes: 10 * 1024 * 1024, // 10 MiB
  maxRetentionDays: 14,
  maxTotalBytes: 200 * 1024 * 1024, // 200 MiB
};

const RING_BUFFER_SIZE = 500;
const FLUSH_INTERVAL_MS = 500;
const FLUSH_SIZE_THRESHOLD = 20;
const LOG_FILE_PREFIX = 'verse-claw-';
const REDACTED = '[REDACTED]';

let currentLevel = LogLevel.DEBUG;
let logFilePath: string | null = null;
let logDir: string | null = null;
let limits: LoggerLimits = { ...DEFAULT_LIMITS };
let currentFileBytes = 0;
let rotatedCount = 0;
let purgedCount = 0;

const recentLogs: string[] = [];
let writeBuffer: string[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let flushing = false;

let lastWriteOkAt: string | null = null;
let lastWriteError: string | null = null;
let lastWriteErrorCode: string | null = null;
let lastWriteErrorAt: string | null = null;
let consecutiveFailures = 0;
let writeFailureAnnounced = false;

// ── Secret / canary redaction ────────────────────────────────────

/**
 * Redact secret-shaped and canary strings from log text.
 * Applied before ring-buffer and disk so A3 holds for retrieval surfaces.
 */
export function redactLogText(input: string): string {
  if (!input) return input;
  let text = input;

  // Explicit canary tokens used by maturity / boundary tests.
  text = text.replace(/\bCLAWX_CANARY_[A-Za-z0-9_\-]{6,}\b/g, `[${REDACTED}_CANARY]`);
  text = text.replace(/\bOPENCLAW_CANARY_[A-Za-z0-9_\-]{6,}\b/g, `[${REDACTED}_CANARY]`);

  // Bearer / Basic auth headers and inline tokens.
  text = text.replace(/\bBearer\s+[A-Za-z0-9._\-+=/]{12,}\b/gi, `Bearer ${REDACTED}`);
  text = text.replace(/\bBasic\s+[A-Za-z0-9+/=]{12,}\b/gi, `Basic ${REDACTED}`);

  // Common provider key shapes (OpenAI sk-, sk-proj-, Anthropic-style).
  text = text.replace(/\bsk-proj-[A-Za-z0-9_\-]{16,}\b/g, `sk-proj-${REDACTED}`);
  text = text.replace(/\bsk-ant-[A-Za-z0-9_\-]{16,}\b/g, `sk-ant-${REDACTED}`);
  text = text.replace(/\bsk-[A-Za-z0-9]{20,}\b/g, `sk-${REDACTED}`);

  // ENV / assignment forms: API_KEY=..., token: "...", "apiKey":"..."
  text = text.replace(
    /\b([A-Z][A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN))\b\s*[=:]\s*(["']?)([^\s"',;]+)\2/g,
    `$1=$2${REDACTED}$2`,
  );
  text = text.replace(
    /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|app[_-]?secret|auth[_-]?token|password|passwd|secret|token)\b\s*[=:]\s*(["']?)([^\s"',;]+)\2/gi,
    `$1=$2${REDACTED}$2`,
  );
  text = text.replace(
    /"(apiKey|api_key|accessToken|refreshToken|clientSecret|appSecret|password|passwd|token|secret)"\s*:\s*"[^"]+"/gi,
    `"$1":"${REDACTED}"`,
  );

  // Authorization / x-api-key header dumps.
  text = text.replace(
    /\b(Authorization|X-Api-Key|X-Auth-Token|x-openclaw-token)\s*[:=]\s*([^\s"',;]+)/gi,
    `$1: ${REDACTED}`,
  );

  return text;
}

function stringifyArg(arg: unknown): string {
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ''}`;
  }
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

// ── Write health ─────────────────────────────────────────────────

function recordWriteSuccess(bytesWritten: number): void {
  lastWriteOkAt = new Date().toISOString();
  consecutiveFailures = 0;
  writeFailureAnnounced = false;
  lastWriteError = null;
  lastWriteErrorCode = null;
  currentFileBytes += bytesWritten;
}

function recordWriteFailure(err: unknown): void {
  consecutiveFailures += 1;
  const code =
    err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string'
      ? (err as { code: string }).code
      : null;
  const message = err instanceof Error ? err.message : String(err);
  lastWriteError = message;
  lastWriteErrorCode = code;
  lastWriteErrorAt = new Date().toISOString();

  // Surface once per failure streak so operators see it without spam.
  if (!writeFailureAnnounced) {
    writeFailureAnnounced = true;
    console.error(
      `[logger] write failure${code ? ` (${code})` : ''}: ${message} [consecutiveFailures=${consecutiveFailures}]`,
    );
  }
}

export function getWriteHealth(): LoggerWriteHealth {
  return {
    healthy: consecutiveFailures === 0 && lastWriteError == null,
    lastWriteOkAt,
    lastWriteError,
    lastWriteErrorCode,
    lastWriteErrorAt,
    consecutiveFailures,
    currentFileBytes,
    rotatedCount,
    purgedCount,
  };
}

// ── Limits / test hooks ──────────────────────────────────────────

export function getLoggerLimits(): LoggerLimits {
  return { ...limits };
}

export function configureLoggerLimits(partial: Partial<LoggerLimits>): void {
  limits = {
    maxFileBytes: partial.maxFileBytes ?? limits.maxFileBytes,
    maxRetentionDays: partial.maxRetentionDays ?? limits.maxRetentionDays,
    maxTotalBytes: partial.maxTotalBytes ?? limits.maxTotalBytes,
  };
}

/** Reset module state between unit tests. */
export function resetLoggerForTests(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  writeBuffer = [];
  flushing = false;
  flushChain = Promise.resolve();
  recentLogs.length = 0;
  logFilePath = null;
  logDir = null;
  currentFileBytes = 0;
  rotatedCount = 0;
  purgedCount = 0;
  lastWriteOkAt = null;
  lastWriteError = null;
  lastWriteErrorCode = null;
  lastWriteErrorAt = null;
  consecutiveFailures = 0;
  writeFailureAnnounced = false;
  limits = { ...DEFAULT_LIMITS };
  currentLevel = LogLevel.DEBUG;
  appendImpl = (filePath, data) => appendFile(filePath, data);
}

/** Await pending buffered writes (tests). */
export async function flushLogsForTests(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  // Drain any in-flight + newly scheduled buffer fully.
  await flushChain;
  await flushBuffer();
  await flushChain;
  await flushBuffer();
}

// ── Rotation / retention ─────────────────────────────────────────

function dayStamp(d = new Date()): string {
  return d.toISOString().split('T')[0];
}

function activeLogName(d = new Date()): string {
  return `${LOG_FILE_PREFIX}${dayStamp(d)}.log`;
}

function rotatedLogName(d = new Date()): string {
  const iso = d.toISOString().replace(/[:.]/g, '-');
  return `${LOG_FILE_PREFIX}${dayStamp(d)}.${iso}.log`;
}

function parseDayFromLogName(name: string): Date | null {
  const m = name.match(/^verse-claw-(\d{4}-\d{2}-\d{2})(?:\.|\.log$)/);
  if (!m) return null;
  const d = new Date(`${m[1]}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function rotateActiveLogIfNeeded(): Promise<void> {
  if (!logDir || !logFilePath) return;
  if (currentFileBytes < limits.maxFileBytes) return;

  const rotatedPath = join(logDir, rotatedLogName());
  try {
    await rename(logFilePath, rotatedPath);
    rotatedCount += 1;
    logFilePath = join(logDir, activeLogName());
    const header =
      `\n${'='.repeat(80)}\n` +
      `[${new Date().toISOString()}] === Log rotated (size limit ${limits.maxFileBytes} bytes) ===\n` +
      `${'='.repeat(80)}\n`;
    await appendFile(logFilePath, header);
    currentFileBytes = Buffer.byteLength(header, 'utf-8');
  } catch (err) {
    recordWriteFailure(err);
  }
}

/**
 * Purge logs past maxRetentionDays and/or over maxTotalBytes.
 * Returns number of files deleted.
 */
export async function enforceLogRetention(): Promise<number> {
  if (!logDir) return 0;
  let deleted = 0;
  try {
    const names = await readdir(logDir);
    const entries: Array<{ name: string; path: string; size: number; mtimeMs: number; day: Date | null }> = [];
    for (const name of names) {
      if (!name.endsWith('.log') || !name.startsWith(LOG_FILE_PREFIX)) continue;
      const fullPath = join(logDir, name);
      try {
        const s = await stat(fullPath);
        entries.push({
          name,
          path: fullPath,
          size: s.size,
          mtimeMs: s.mtimeMs,
          day: parseDayFromLogName(name),
        });
      } catch {
        // skip unreadable
      }
    }

    const now = Date.now();
    const maxAgeMs = limits.maxRetentionDays * 24 * 60 * 60 * 1000;
    const keepActive = logFilePath;

    for (const entry of [...entries]) {
      if (entry.path === keepActive) continue;
      const ageBase = entry.day ? entry.day.getTime() : entry.mtimeMs;
      if (now - ageBase > maxAgeMs) {
        try {
          await unlink(entry.path);
          deleted += 1;
          const idx = entries.indexOf(entry);
          if (idx >= 0) entries.splice(idx, 1);
        } catch {
          // ignore single delete failure
        }
      }
    }

    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let total = entries.reduce((sum, e) => sum + e.size, 0);
    for (const entry of entries) {
      if (total <= limits.maxTotalBytes) break;
      if (entry.path === keepActive) continue;
      try {
        await unlink(entry.path);
        total -= entry.size;
        deleted += 1;
      } catch {
        // ignore
      }
    }
  } catch {
    // directory may be missing
  }
  purgedCount += deleted;
  return deleted;
}

function enforceLogRetentionSync(): number {
  if (!logDir || !existsSync(logDir)) return 0;
  let deleted = 0;
  try {
    const names = readdirSync(logDir);
    const entries: Array<{ name: string; path: string; size: number; mtimeMs: number; day: Date | null }> = [];
    for (const name of names) {
      if (!name.endsWith('.log') || !name.startsWith(LOG_FILE_PREFIX)) continue;
      const fullPath = join(logDir, name);
      try {
        const s = statSync(fullPath);
        entries.push({
          name,
          path: fullPath,
          size: s.size,
          mtimeMs: s.mtimeMs,
          day: parseDayFromLogName(name),
        });
      } catch {
        // skip
      }
    }
    const now = Date.now();
    const maxAgeMs = limits.maxRetentionDays * 24 * 60 * 60 * 1000;
    const keepActive = logFilePath;
    for (const entry of [...entries]) {
      if (entry.path === keepActive) continue;
      const ageBase = entry.day ? entry.day.getTime() : entry.mtimeMs;
      if (now - ageBase > maxAgeMs) {
        try {
          unlinkSync(entry.path);
          deleted += 1;
          const idx = entries.indexOf(entry);
          if (idx >= 0) entries.splice(idx, 1);
        } catch {
          // ignore
        }
      }
    }
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let total = entries.reduce((sum, e) => sum + e.size, 0);
    for (const entry of entries) {
      if (total <= limits.maxTotalBytes) break;
      if (entry.path === keepActive) continue;
      try {
        unlinkSync(entry.path);
        total -= entry.size;
        deleted += 1;
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  purgedCount += deleted;
  return deleted;
}

// ── Async write buffer ───────────────────────────────────────────

let flushChain: Promise<void> = Promise.resolve();

async function flushBuffer(): Promise<void> {
  // Serialize flushes so callers (and tests) can await completion.
  const run = async (): Promise<void> => {
    if (writeBuffer.length === 0 || !logFilePath) return;
    flushing = true;
    const batch = writeBuffer.join('');
    writeBuffer = [];
    try {
      await appendImpl(logFilePath, batch);
      recordWriteSuccess(Buffer.byteLength(batch, 'utf-8'));
      await rotateActiveLogIfNeeded();
      if (rotatedCount > 0) {
        void enforceLogRetention();
      }
    } catch (err) {
      recordWriteFailure(err);
      // Do not re-queue batch on ENOSPC/EACCES — would grow forever.
    } finally {
      flushing = false;
    }
  };
  const next = flushChain.then(run, run);
  flushChain = next.then(
    () => undefined,
    () => undefined,
  );
  await next;
}

/** Synchronous flush for the `exit` handler — guaranteed best-effort write. */
function flushBufferSync(): void {
  if (writeBuffer.length === 0 || !logFilePath) return;
  const batch = writeBuffer.join('');
  writeBuffer = [];
  try {
    appendFileSync(logFilePath, batch);
    recordWriteSuccess(Buffer.byteLength(batch, 'utf-8'));
  } catch (err) {
    recordWriteFailure(err);
  }
}

// Ensure all buffered data reaches disk before the process exits.
process.on('exit', flushBufferSync);

// ── Initialisation ───────────────────────────────────────────────

/**
 * Initialize logger — safe to call before app.isReady()
 */
export function initLogger(): void {
  try {
    if (app.isPackaged && currentLevel < LogLevel.INFO) {
      currentLevel = LogLevel.INFO;
    }

    logDir = join(app.getPath('userData'), 'logs');

    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    logFilePath = join(logDir, activeLogName());

    const sessionHeader =
      `\n${'='.repeat(80)}\n` +
      `[${new Date().toISOString()}] === Verse Claw Session Start (v${app.getVersion()}) ===\n` +
      `${'='.repeat(80)}\n`;
    try {
      appendFileSync(logFilePath, sessionHeader);
      recordWriteSuccess(Buffer.byteLength(sessionHeader, 'utf-8'));
    } catch (err) {
      recordWriteFailure(err);
    }

    try {
      currentFileBytes = statSync(logFilePath).size;
    } catch {
      // keep recorded value
    }

    // Enforce retention on every process start.
    enforceLogRetentionSync();
  } catch (error) {
    console.error('Failed to initialize logger:', error);
    recordWriteFailure(error);
  }
}

// ── Level / path accessors ───────────────────────────────────────

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogDir(): string | null {
  return logDir;
}

export function getLogFilePath(): string | null {
  return logFilePath;
}

// ── Formatting ───────────────────────────────────────────────────

function formatMessage(level: string, message: string, ...args: unknown[]): string {
  const timestamp = new Date().toISOString();
  const rawMessage = redactLogText(String(message));
  const formattedArgs =
    args.length > 0
      ? ' ' + args.map((a) => redactLogText(stringifyArg(a))).join(' ')
      : '';
  return `[${timestamp}] [${level}] ${rawMessage}${formattedArgs}`;
}

// ── Core write ───────────────────────────────────────────────────

/**
 * Write to ring buffer + schedule an async flush to disk.
 */
function writeLog(formatted: string): void {
  recentLogs.push(formatted);
  if (recentLogs.length > RING_BUFFER_SIZE) {
    recentLogs.shift();
  }

  if (logFilePath) {
    writeBuffer.push(formatted + '\n');
    if (writeBuffer.length >= FLUSH_SIZE_THRESHOLD) {
      void flushBuffer();
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushBuffer();
      }, FLUSH_INTERVAL_MS);
    }
  }
}

// ── Public log methods ───────────────────────────────────────────

export function debug(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.DEBUG) {
    const formatted = formatMessage('DEBUG', message, ...args);
    console.debug(formatted);
    writeLog(formatted);
  }
}

export function info(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.INFO) {
    const formatted = formatMessage('INFO', message, ...args);
    console.info(formatted);
    writeLog(formatted);
  }
}

export function warn(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.WARN) {
    const formatted = formatMessage('WARN', message, ...args);
    console.warn(formatted);
    writeLog(formatted);
  }
}

export function error(message: string, ...args: unknown[]): void {
  if (currentLevel <= LogLevel.ERROR) {
    const formatted = formatMessage('ERROR', message, ...args);
    console.error(formatted);
    writeLog(formatted);
  }
}

// ── Log retrieval (for UI / diagnostics) ─────────────────────────

export function getRecentLogs(count?: number, minLevel?: LogLevel): string[] {
  const filtered =
    minLevel != null
      ? recentLogs.filter((line) => {
          if (minLevel <= LogLevel.DEBUG) return true;
          if (minLevel === LogLevel.INFO) return !line.includes('] [DEBUG');
          if (minLevel === LogLevel.WARN) return line.includes('] [WARN') || line.includes('] [ERROR');
          return line.includes('] [ERROR');
        })
      : recentLogs;

  return count ? filtered.slice(-count) : [...filtered];
}

/**
 * Read the current day's log file content (last N lines).
 * Uses async I/O to avoid blocking.
 */
export async function readLogFile(tailLines = 200): Promise<string> {
  if (!logFilePath) return '(No log file found)';
  const safeTailLines = Math.max(1, Math.floor(tailLines));
  try {
    const file = await open(logFilePath, 'r');
    try {
      const fileStat = await file.stat();
      if (fileStat.size === 0) return '';

      const chunkSize = 64 * 1024;
      let position = fileStat.size;
      let content = '';
      let lineCount = 0;

      while (position > 0 && lineCount <= safeTailLines) {
        const bytesToRead = Math.min(chunkSize, position);
        position -= bytesToRead;
        const buffer = Buffer.allocUnsafe(bytesToRead);
        await file.read(buffer, 0, bytesToRead, position);
        content = `${buffer.toString('utf-8')}${content}`;
        lineCount = content.split('\n').length - 1;
      }

      const lines = content.split('\n');
      if (lines.length <= safeTailLines) return content;
      return lines.slice(-safeTailLines).join('\n');
    } finally {
      await file.close();
    }
  } catch (err) {
    return `(Failed to read log file: ${err})`;
  }
}

/**
 * List available log files.
 * Uses async I/O to avoid blocking.
 */
export async function listLogFiles(): Promise<
  Array<{ name: string; path: string; size: number; modified: string }>
> {
  if (!logDir) return [];
  try {
    const files = await readdir(logDir);
    const results: Array<{ name: string; path: string; size: number; modified: string }> = [];
    for (const f of files) {
      if (!f.endsWith('.log')) continue;
      const fullPath = join(logDir, f);
      const s = await stat(fullPath);
      results.push({
        name: f,
        path: fullPath,
        size: s.size,
        modified: s.mtime.toISOString(),
      });
    }
    return results.sort((a, b) => b.modified.localeCompare(a.modified));
  } catch {
    return [];
  }
}

/**
 * Logger namespace export
 */
export const logger = {
  debug,
  info,
  warn,
  error,
  setLevel: setLogLevel,
  init: initLogger,
  getLogDir,
  getLogFilePath,
  getRecentLogs,
  readLogFile,
  listLogFiles,
  getWriteHealth,
  configureLoggerLimits,
  enforceLogRetention,
  redactLogText,
  flushLogsForTests,
  resetLoggerForTests,
  setLogAppendImplForTests,
};