/**
 * VerseShell Runtime Bridge
 *
 * Manages the `ae --serve` long-lived child process and provides a typed
 * JSON-RPC interface for executing VerseShell commands from the OpenClaw runtime.
 *
 * Architecture:
 *   verseshell --serve --json --cap all --workspace <dir>
 *     → stdin:  one JSON-RPC request per line
 *     → stdout: one JSON-formatted response per line
 *
 * The process is auto-started on first use and auto-restarted on crash
 * (with exponential backoff, max 3 attempts). If VerseShell is unavailable,
 * callers fall back to the native shell path.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { logWarn, logInfo } from "../logger.js";

// ── Types ────────────────────────────────────────────────────────────────

export type VerseShellExecResult = {
  ok: boolean;
  value?: unknown;
  error?: {
    code: string;
    message: string;
    hint?: string;
    recoverable: boolean;
  };
  meta: {
    elapsedMs: number;
    cacheHit?: boolean;
    sessionAgeMs: number;
  };
};

type PendingRequest = {
  resolve: (result: VerseShellExecResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

// ── Config ───────────────────────────────────────────────────────────────

const DEFAULT_MAX_CONCURRENCY = 8;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = DEFAULT_TIMEOUT_MS + 5_000;
const MAX_REQUEST_TIMEOUT_MS = 10 * 60_000;
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_BASE_DELAY_MS = 1000;
const RESTART_MAX_DELAY_MS = 30_000;
const GC_INTERVAL_MS = 60_000;

function resolveAePath(): string {
  // Prefer AE_PATH env var, then check relative to the runtime package,
  // then fall back to PATH lookup.
  if (process.env.VERSESHELL_AE_PATH?.trim()) {
    return process.env.VERSESHELL_AE_PATH.trim();
  }
  if (process.env.VERSESHELL_RUNTIME_PATH?.trim()) {
    return process.env.VERSESHELL_RUNTIME_PATH.trim();
  }
  const platform = process.platform;
  const ext = platform === "win32" ? ".exe" : "";
  const names = [`verseshell${ext}`, `ae${ext}`];
  const roots = [
    path.resolve(process.cwd(), "..", "verseshell-runtime", "target", "release"),
    path.resolve(process.cwd(), "verseshell-runtime", "target", "release"),
  ];
  for (const root of roots) {
    for (const name of names) {
      const candidate = path.join(root, name);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return `verseshell${ext}`;
}

function resolveWorkspace(): string {
  return (
    process.env.VERSESHELL_WORKSPACE?.trim() ||
    process.env.OPENCLAW_WORKSPACE?.trim() ||
    process.cwd()
  );
}

function clampTimeoutMs(value?: number, fallback = DEFAULT_TIMEOUT_MS): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.max(Math.trunc(n), 100), MAX_REQUEST_TIMEOUT_MS);
}

function findPathKey(env: NodeJS.ProcessEnv): string {
  return (
    Object.keys(env).find((key) => key.toLowerCase() === "path") ??
    (process.platform === "win32" ? "Path" : "PATH")
  );
}

function uniquePathEntries(entries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    const trimmed = String(entry || "").trim().replace(/^"|"$/g, "");
    if (!trimmed || trimmed.includes("\0") || /^%PATH%$/i.test(trimmed)) {
      continue;
    }
    const key = process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function sanitizeProcessEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  const pathKey = findPathKey(env);
  const currentPath = String(env[pathKey] ?? "");
  const defaults =
    process.platform === "win32"
      ? [
          path.dirname(process.execPath),
          process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : "",
          "C:\\Windows\\System32",
          "C:\\Windows",
          "C:\\Windows\\System32\\Wbem",
          "C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
          "C:\\Program Files\\nodejs",
          "C:\\Program Files\\Git\\bin",
          "C:\\Program Files\\Git\\cmd",
        ]
      : [path.dirname(process.execPath), "/usr/local/bin", "/usr/bin", "/bin"];
  env[pathKey] = uniquePathEntries([
    ...currentPath.split(path.delimiter),
    ...defaults,
  ]).join(path.delimiter);
  return env;
}

function aeString(value: string): string {
  return JSON.stringify(value);
}

function shellExecArgvExpression(argv: string[]): string {
  return `shell.exec([${argv.map((arg) => aeString(arg)).join(", ")}])`;
}

function quoteCmdPath(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function cmdCdPath(value: string): string {
  const slashPath = value.replace(/\\/g, "/");
  if (/^[A-Za-z]:\/[^\s&|<>^"]+$/.test(slashPath)) {
    return slashPath;
  }
  return quoteCmdPath(value);
}

function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function shellArgvForCommand(command: string, cwd?: string): string[] {
  const requested = (process.env.VERSESHELL_OS_SHELL || "").toLowerCase();
  const windowsCmd = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
  if (requested === "git-bash" || requested === "bash") {
    const prefix = cwd ? `cd ${quotePosix(cwd.replace(/\\/g, "/"))} && ` : "";
    return ["C:\\Program Files\\Git\\bin\\bash.exe", "-lc", `${prefix}${command}`];
  }
  if (requested === "powershell") {
    const prefix = cwd ? `Set-Location -LiteralPath ${quotePowerShellLiteral(cwd)}; ` : "";
    return ["powershell", "-NoProfile", "-Command", `${prefix}${command}`];
  }
  if (requested === "pwsh") {
    const prefix = cwd ? `Set-Location -LiteralPath ${quotePowerShellLiteral(cwd)}; ` : "";
    return ["pwsh", "-NoProfile", "-Command", `${prefix}${command}`];
  }
  if (process.platform === "win32" || requested === "cmd") {
    const prefix = cwd ? `cd /d ${cmdCdPath(cwd)} && ` : "";
    return [windowsCmd, "/D", "/C", `${prefix}${command}`];
  }
  const prefix = cwd ? `cd ${quotePosix(cwd)} && ` : "";
  return ["sh", "-lc", `${prefix}${command}`];
}

// ── State ─────────────────────────────────────────────────────────────────

let aeProcess: ChildProcess | null = null;
let aeReady = false;
let aeRestartCount = 0;
let aeRestartBackoff = RESTART_BASE_DELAY_MS;
let aeShuttingDown = false;
const readyWaiters: Array<() => void> = [];
const pendingRequests = new Map<string, PendingRequest>();
let requestCounter = 0;
let gcTimer: NodeJS.Timeout | null = null;

// ── Compact Protocol Parser ───────────────────────────────────────────────

/**
 * Parse a compact-formatted response line.
 *
 * Format:
 *   D <id> <ok:T|F> <value> <elapsed_ms> <cache:T|F|N> <session_age_ms>
 *   E <id> <code> <message> <recoverable:T|F>
 *
 * Value encoding:
 *   N          → null
 *   T | F      → boolean
 *   <number>   → int or float
 *   S<len>:<content> → string
 *   L<len> <items>   → array
 *   R<len> <k1> <v1> ... → record
 */
function parseCompactLine(line: string): VerseShellExecResult | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const parts = splitCompactTokens(trimmed);
  if (parts.length === 0) return null;

  const typeTag = parts[0];
  if (typeTag === "D") {
    return parseCompactDone(parts);
  }
  if (typeTag === "E") {
    return parseCompactError(parts);
  }

  // Fall back to JSON parse for non-compact lines
  try {
    const obj = JSON.parse(trimmed);
    return normalizeJsonResponse(obj);
  } catch {
    return null;
  }
}

function splitCompactTokens(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < line.length) {
    // skip whitespace
    while (i < line.length && line[i] === " ") i++;
    if (i >= line.length) break;

    if (line[i] === "S") {
      // S<len>:<content>
      i++; // skip S
      let lenStr = "";
      while (i < line.length && line[i] >= "0" && line[i] <= "9") {
        lenStr += line[i];
        i++;
      }
      if (line[i] === ":") i++; // skip colon
      const len = parseInt(lenStr, 10);
      if (isNaN(len) || i + len > line.length) {
        // Malformed; treat remainder as one token
        tokens.push(line.slice(i - 1 - lenStr.length));
        break;
      }
      tokens.push(line.slice(i, i + len));
      i += len;
    } else if (line[i] === "R" || line[i] === "L") {
      // R<len> or L<len> — read the length marker but collect the type tag + count
      const tag = line[i];
      i++;
      let countStr = "";
      while (i < line.length && line[i] >= "0" && line[i] <= "9") {
        countStr += line[i];
        i++;
      }
      tokens.push(tag + countStr);
    } else {
      // bare token
      let token = "";
      while (i < line.length && line[i] !== " ") {
        token += line[i];
        i++;
      }
      tokens.push(token);
    }
  }
  return tokens;
}

function parseCompactDone(parts: string[]): VerseShellExecResult | null {
  // D <id> <ok:T|F> <value> <elapsed_ms> <cache:T|F|N> <session_age_ms>
  if (parts.length < 6) return null;
  const id = parts[1];
  const ok = parts[2] === "T";
  const elapsedMs = parseInt(parts[4], 10) || 0;
  const cacheTag = parts[5];
  const sessionAgeMs = parseInt(parts[6], 10) || 0;

  // Reconstruct value from parts[3]; for complex types we'd need recursive parsing.
  // For shell.exec results, the value is a string (S<len>:<text>) or a record.
  // We attempt to get the raw JSON value by re-executing with --json for complex cases,
  // but for simple values we parse inline.
  const valueToken = parts[3];
  let value: unknown = null;
  if (valueToken === "N") value = null;
  else if (valueToken === "T") value = true;
  else if (valueToken === "F") value = false;
  else if (valueToken.startsWith("S")) {
    // String value; the splitCompactTokens already extracted it
    value = valueToken;
  } else {
    // Number
    const n = Number(valueToken);
    value = isNaN(n) ? valueToken : n;
  }

  return {
    id,
    ok,
    value,
    meta: {
      elapsedMs,
      cacheHit: cacheTag === "T" ? true : cacheTag === "F" ? false : undefined,
      sessionAgeMs,
    },
  };
}

function parseCompactError(parts: string[]): VerseShellExecResult | null {
  // E <id> <code> <message> <recoverable:T|F>
  if (parts.length < 5) return null;
  const id = parts[1];
  const code = parts[2];
  const message = parts[3].replace(/\\s/g, " ");
  const recoverable = parts[4] === "T";
  return {
    id,
    ok: false,
    error: { code, message, recoverable },
    meta: { elapsedMs: 0, sessionAgeMs: 0 },
  };
}

function normalizeJsonResponse(obj: Record<string, unknown>): VerseShellExecResult | null {
  if (!obj || typeof obj !== "object") return null;
  if (obj.type === "done") {
    const ok = obj.ok !== false;
    const err = obj.error as Record<string, unknown> | undefined;
    return {
      id: String(obj.id ?? ""),
      ok,
      value: obj.value,
      error: ok
        ? undefined
        : {
            code: String(err?.code ?? "E_UNKNOWN"),
            message: String(err?.message ?? "Unknown error"),
            hint: err?.hint as string | undefined,
            recoverable: err?.recoverable !== false,
          },
      meta: {
        elapsedMs: (obj.meta as Record<string, unknown>)?.elapsed_ms as number ?? 0,
        cacheHit: (obj.meta as Record<string, unknown>)?.cache_hit as boolean | undefined,
        sessionAgeMs: (obj.meta as Record<string, unknown>)?.session_age_ms as number ?? 0,
      },
    };
  }
  if (obj.type === "error" || obj.ok === false) {
    const err = obj.error as Record<string, unknown> | undefined;
    return {
      id: String(obj.id ?? ""),
      ok: false,
      error: {
        code: String(err?.code ?? "E_UNKNOWN"),
        message: String(err?.message ?? "Unknown error"),
        hint: err?.hint as string | undefined,
        recoverable: err?.recoverable !== false,
      },
      meta: { elapsedMs: 0, sessionAgeMs: 0 },
    };
  }
  return null;
}

// ── Process Lifecycle ─────────────────────────────────────────────────────

function startAeProcess(): ChildProcess {
  const aePath = resolveAePath();
  const workspace = resolveWorkspace();
  const args = [
    "--serve",
    "--agent",
    "--policy",
    "permissive",
    "--json",
    "--cap",
    "all",
    "--workspace",
    workspace,
    "--max-concurrency",
    String(DEFAULT_MAX_CONCURRENCY),
  ];

  logInfo(`[verseshell] Starting: ${aePath} ${args.join(" ")} (cwd: ${workspace})`);

  const proc = spawn(aePath, args, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: workspace,
    env: sanitizeProcessEnv({
      AE_FORMAT: "json",
      AETHER_WORKSPACE: workspace,
      VERSESHELL_WORKSPACE: workspace,
    }),
    windowsHide: true,
  });

  const rl = createInterface({ input: proc.stdout! });

  rl.on("line", (rawLine: string) => {
    const line = rawLine.trim();
    if (!line) return;

    // Handle control messages (STATS/GC output) — these don't have a request id format
    if (line.startsWith("{")) {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (obj.id === "__gc__" || obj.id === "__refresh__") {
          return; // control response, no pending request
        }
        const id = String(obj.id ?? "");
        const parsed = normalizeJsonResponse(obj);
        if (parsed && pendingRequests.has(id)) {
          resolvePending(id, parsed);
          return;
        }
      } catch {
        // Not JSON, try compact parse below
      }
    }

    const compactResult = parseCompactLine(line);
    if (compactResult && pendingRequests.has(compactResult.id)) {
      resolvePending(compactResult.id, compactResult);
      return;
    }

    // Mark as ready on first successful parse
    if (!aeReady) {
      aeReady = true;
      aeRestartCount = 0;
      aeRestartBackoff = RESTART_BASE_DELAY_MS;
      logInfo("[verseshell] Server ready");
      readyWaiters.forEach((r) => r());
      readyWaiters.length = 0;
    }
  });

  proc.stderr!.on("data", (data: Buffer) => {
    const text = data.toString().trim();
    if (text.includes("[ae-serve]")) {
      // Server status messages
      if (text.includes("ready")) {
        aeReady = true;
        aeRestartCount = 0;
        aeRestartBackoff = RESTART_BASE_DELAY_MS;
        logInfo(`[verseshell] ${text}`);
        readyWaiters.forEach((r) => r());
        readyWaiters.length = 0;
      } else {
        logInfo(`[verseshell] ${text}`);
      }
    } else if (text) {
      logWarn(`[verseshell] stderr: ${text}`);
    }
  });

  proc.on("close", (code, signal) => {
    logWarn(`[verseshell] Process exited (code=${code}, signal=${signal})`);
    aeReady = false;
    aeProcess = null;

    // Reject all pending requests
    for (const [id, entry] of pendingRequests) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`VerseShell process exited (code=${code})`));
    }
    pendingRequests.clear();

    // Auto-restart with backoff
    if (!aeShuttingDown && aeRestartCount < MAX_RESTART_ATTEMPTS) {
      const delay = Math.min(aeRestartBackoff, RESTART_MAX_DELAY_MS);
      logWarn(
        `[verseshell] Restarting in ${delay}ms (attempt ${aeRestartCount + 1}/${MAX_RESTART_ATTEMPTS})`,
      );
      setTimeout(() => {
        aeRestartCount++;
        aeRestartBackoff *= 2;
        aeProcess = startAeProcess();
      }, delay);
    } else if (aeRestartCount >= MAX_RESTART_ATTEMPTS) {
      logWarn("[verseshell] Max restart attempts reached; will retry on next request");
    }
  });

  proc.on("error", (err) => {
    logWarn(`[verseshell] Process error: ${err.message}`);
    aeReady = false;
  });

  // Periodic GC
  if (!gcTimer) {
    gcTimer = setInterval(() => {
      if (aeProcess && aeReady) {
        try {
          aeProcess.stdin!.write("GC\n");
        } catch {
          // ignore write errors — process will be restarted
        }
      }
    }, GC_INTERVAL_MS);
  }

  return proc;
}

function resolvePending(id: string, result: VerseShellExecResult): void {
  const entry = pendingRequests.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pendingRequests.delete(id);
  entry.resolve(result);
}

function ensureVerseShell(): ChildProcess {
  if (aeProcess && !aeProcess.killed && aeReady) {
    return aeProcess;
  }
  if (!aeProcess || aeProcess.killed) {
    aeProcess = startAeProcess();
  }
  return aeProcess;
}

async function waitForReady(timeoutMs = 10_000): Promise<void> {
  if (aeReady) return;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("VerseShell startup timeout"));
    }, timeoutMs);
    readyWaiters.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Send a VerseShell expression for evaluation.
 *
 * Returns a structured result. On failure (process not ready, timeout,
 * parse error), throws an Error so callers can fall back to native shell.
 */
export async function verseshellEval(
  cmd: string,
  opts?: { timeoutMs?: number; agentId?: string },
): Promise<VerseShellExecResult> {
  const proc = ensureVerseShell();
  await waitForReady();

  const id = `ae-${++requestCounter}`;
  const timeoutMs = clampTimeoutMs(opts?.timeoutMs);
  const request = JSON.stringify({
    id,
    agent: opts?.agentId ?? "openclaw",
    cmd,
    timeout_ms: timeoutMs,
  });

  return new Promise<VerseShellExecResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      const err = new Error(`VerseShell request timeout after ${timeoutMs}ms: ${cmd.slice(0, 80)}`);
      Object.assign(err, {
        code: "E_TIMEOUT",
        timedOut: true,
        timeoutMs,
        serverRestarted: true,
      });
      killProcessTree(proc);
      reject(err);
    }, timeoutMs + 250);

    pendingRequests.set(id, { resolve, reject, timer });

    try {
      proc.stdin!.write(request + "\n");
    } catch (err) {
      clearTimeout(timer);
      pendingRequests.delete(id);
      reject(new Error(`VerseShell write failed: ${(err as Error).message}`));
    }
  });
}

function killProcessTree(proc: ChildProcess | null): void {
  if (!proc || !proc.pid || proc.killed) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
        stdio: "ignore",
        env: sanitizeProcessEnv(),
        windowsHide: true,
      }).on("error", () => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // best effort
        }
      });
      return;
    } catch {
      // fall back to proc.kill below
    }
  }
  try {
    proc.kill("SIGKILL");
  } catch {
    // best effort; close/error handlers will surface failures
  }
}

/**
 * Execute a shell command via VerseShell's `shell.exec()`.
 *
 * Returns structured output: { stdout, stderr, success, exit_code }.
 * This is the preferred path for agent command execution.
 */
export async function verseshellExec(
  command: string,
  opts?: { timeoutMs?: number; agentId?: string; cwd?: string },
): Promise<{
  stdout: string;
  stderr: string;
  success: boolean;
  exitCode: number;
}> {
  // Route through an explicit OS shell argv. This preserves pipes,
  // redirection, quoting, and Windows paths instead of relying on
  // VerseShell's whitespace splitter for `shell.exec("...")`.
  const cmd = shellExecArgvExpression(shellArgvForCommand(command, opts?.cwd));
  const result = await verseshellEval(cmd, opts);

  if (!result.ok) {
    throw new Error(
      `VerseShell shell.exec failed: ${result.error?.message ?? "unknown error"}` +
        (result.error?.hint ? ` (hint: ${result.error.hint})` : ""),
    );
  }

  const value = result.value as Record<string, unknown> | undefined;
  return {
    stdout: String(value?.stdout ?? ""),
    stderr: String(value?.stderr ?? ""),
    success: Boolean(value?.success ?? true),
    exitCode: Number(value?.exit_code ?? 0),
  };
}

/**
 * Check if VerseShell is currently available.
 */
export function isVerseShellReady(): boolean {
  return aeReady && aeProcess !== null && !aeProcess.killed;
}

/**
 * Gracefully shut down the VerseShell process.
 */
export function shutdownVerseShell(): void {
  aeShuttingDown = true;
  if (gcTimer) {
    clearInterval(gcTimer);
    gcTimer = null;
  }
  if (aeProcess && !aeProcess.killed) {
    try {
      aeProcess.stdin!.write("SHUTDOWN\n");
    } catch {
      // ignore
    }
    setTimeout(() => {
      if (aeProcess && !aeProcess.killed) {
        aeProcess.kill();
      }
    }, 5000);
  }
  aeProcess = null;
  aeReady = false;
}

/**
 * Force a system snapshot refresh (cache bust).
 */
export async function refreshVerseShellSnapshot(): Promise<void> {
  if (!aeProcess || aeProcess.killed) return;
  try {
    aeProcess.stdin!.write("REFRESH\n");
  } catch {
    // ignore
  }
}
