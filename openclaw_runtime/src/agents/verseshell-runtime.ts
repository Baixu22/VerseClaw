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
import { resolveVerseShellCommandArgv } from "./verseshell/shell-command.js";

// ── Types ────────────────────────────────────────────────────────────────

export type VerseShellExecResult = {
  id: string;
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
const _DEFAULT_REQUEST_TIMEOUT_MS = DEFAULT_TIMEOUT_MS + 5_000;
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

function normalizeToolPath(inputPath: string, fallback = "."): string {
  let s = String(inputPath ?? fallback).trim();
  if (!s) s = fallback;
  if (process.platform === "win32") {
    s = s.replace(/\\/g, "/");
    s = s.replace(/^\/([A-Za-z])\//, "$1:/");
    s = s.replace(/^([A-Za-z]):(?!\/)/, "$1:/");
  }
  return s;
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

// ── Degradation State ────────────────────────────────────────────────────
// When VerseShell fails with the same error fingerprint 3+ consecutive times,
// we degrade to native shell to avoid blocking the user. After a cooldown
// period, a lightweight probe runs on the next request to see if the issue
// has resolved.

const DEGRADE_CONSECUTIVE_THRESHOLD = 3;
const DEGRADE_COOLDOWN_MS = 60_000;

interface DegradeState {
  active: boolean;
  degradedAt: number; // Date.now()
  lastErrorFingerprint: string;
  consecutiveCount: number;
}

const degradeState: DegradeState = {
  active: false,
  degradedAt: 0,
  lastErrorFingerprint: "",
  consecutiveCount: 0,
};

const DEGRADED_ERROR = new Error(
  "VerseShell is degraded; caller should use native shell fallback",
);
Object.assign(DEGRADED_ERROR, { code: "E_VERSESHELL_DEGRADED" });

function errorFingerprint(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as Error & { code?: unknown }).code ?? "";
    return `${code}:${err.message}`;
  }
  return String(err);
}

function recordDegradeError(err: unknown): void {
  const fp = errorFingerprint(err);
  if (fp === degradeState.lastErrorFingerprint) {
    degradeState.consecutiveCount++;
  } else {
    degradeState.lastErrorFingerprint = fp;
    degradeState.consecutiveCount = 1;
  }

  if (
    !degradeState.active &&
    degradeState.consecutiveCount >= DEGRADE_CONSECUTIVE_THRESHOLD
  ) {
    degradeState.active = true;
    degradeState.degradedAt = Date.now();
    logWarn(
      `[verseshell] DEGRADED — ${degradeState.consecutiveCount} consecutive errors ` +
        `(fingerprint: ${fp.slice(0, 120)}). Falling back to native shell ` +
        `for the next ${DEGRADE_COOLDOWN_MS / 1000}s.`,
    );
  }
}

function resetDegradeOnSuccess(): void {
  if (degradeState.consecutiveCount > 0) {
    degradeState.lastErrorFingerprint = "";
    degradeState.consecutiveCount = 0;
  }
  if (degradeState.active) {
    logInfo("[verseshell] Degradation cleared — probe succeeded.");
    degradeState.active = false;
    degradeState.degradedAt = 0;
  }
}

/** Is VerseShell currently in degraded mode (routing to native shell)? */
export function isVerseShellDegraded(): boolean {
  return degradeState.active;
}

/**
 * Check whether the degradation cooldown has expired and we should probe.
 * Returns true if a probe is worth trying.
 */
function shouldProbeDegradeRecovery(): boolean {
  if (!degradeState.active) return false;
  return Date.now() - degradeState.degradedAt > DEGRADE_COOLDOWN_MS;
}

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

  // Recursively decode compact value from remaining parts starting at parts[3]
  const valueResult = parseCompactValue(parts, 3);
  const value: unknown = valueResult ? valueResult.value : null;

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

/**
 * Recursively parse a compact-encoded value from token array starting at index.
 * Returns { value, nextIndex } or null on parse failure.
 *
 * Compact encoding:
 *   N  → null
 *   T  → true, F → false
 *   <number> → number
 *   S<len>:<content> → string
 *   L<len> <item1> <item2> ... → array
 *   R<len> <key1> <val1> ... → record
 */
function parseCompactValue(
  parts: string[],
  idx: number,
): { value: unknown; nextIndex: number } | null {
  if (idx >= parts.length) return null;
  const token = parts[idx];

  if (token === "N") return { value: null, nextIndex: idx + 1 };
  if (token === "T") return { value: true, nextIndex: idx + 1 };
  if (token === "F") return { value: false, nextIndex: idx + 1 };

  // String: S<len>:<content>
  if (token.startsWith("S")) {
    return { value: token, nextIndex: idx + 1 };
  }

  // Array: L<len> <item>...
  if (token.startsWith("L")) {
    const len = parseInt(token.slice(1), 10);
    if (isNaN(len)) return { value: [], nextIndex: idx + 1 };
    const arr: unknown[] = [];
    let next = idx + 1;
    for (let i = 0; i < len; i++) {
      const r = parseCompactValue(parts, next);
      if (!r) break;
      arr.push(r.value);
      next = r.nextIndex;
    }
    return { value: arr, nextIndex: next };
  }

  // Record: R<len> <key1> <val1> ...
  if (token.startsWith("R")) {
    const len = parseInt(token.slice(1), 10);
    if (isNaN(len)) return { value: {}, nextIndex: idx + 1 };
    const rec: Record<string, unknown> = {};
    let next = idx + 1;
    for (let i = 0; i < len; i++) {
      if (next >= parts.length) break;
      const key = parts[next];
      next++;
      const r = parseCompactValue(parts, next);
      if (!r) break;
      rec[key] = r.value;
      next = r.nextIndex;
    }
    return { value: rec, nextIndex: next };
  }

  // Number
  const n = Number(token);
  if (!isNaN(n)) return { value: n, nextIndex: idx + 1 };

  // Unknown token: return as-is
  return { value: token, nextIndex: idx + 1 };
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
    "--format",
    "compact",
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
      AE_FORMAT: "compact",
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
        // Not JSON, fall through to compact parse
      }
    }

    // Primary: parse compact protocol lines (always used because --format compact)
    const compactResult = parseCompactLine(line);
    if (compactResult && pendingRequests.has(compactResult.id)) {
      resolvePending(compactResult.id, compactResult);
      return;
    }

    // Mark as ready on first successful parse of any kind
    if (!aeReady && (compactResult || line.trim().length > 0)) {
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
    for (const [_id, entry] of pendingRequests) {
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
 *
 * Uses compact protocol (AE_FORMAT=compact) for 50-70% token savings
 * vs JSON. The parseCompactLine parser handles the compact D/E protocol
 * messages, including recursive decode of arrays and records.
 */
export async function verseshellEval(
  cmd: string,
  opts?: { timeoutMs?: number; agentId?: string },
): Promise<VerseShellExecResult> {
  // ── Degradation check ──────────────────────────────────────────────────
  if (degradeState.active) {
    if (shouldProbeDegradeRecovery()) {
      // Cooldown expired — try a lightweight probe to see if VS recovered.
      try {
        const probeResult = await verseshellEvalRaw("1 + 1", { timeoutMs: 5000 });
        if (probeResult.ok) {
          resetDegradeOnSuccess();
          // Continue to real request below.
        } else {
          degradeState.degradedAt = Date.now(); // extend cooldown
          throw DEGRADED_ERROR;
        }
      } catch {
        degradeState.degradedAt = Date.now(); // extend cooldown
        throw DEGRADED_ERROR;
      }
    } else {
      // Still in cooldown — reject immediately so callers fall back.
      throw DEGRADED_ERROR;
    }
  }

  try {
    const result = await verseshellEvalRaw(cmd, opts);
    resetDegradeOnSuccess();
    return result;
  } catch (err) {
    recordDegradeError(err);
    throw err;
  }
}

/**
 * Raw eval — no degradation logic (used internally and by the probe path).
 */
export async function verseshellEvalRaw(
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
  const cmd = shellExecArgvExpression(resolveVerseShellCommandArgv(command, opts?.cwd));
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

/**
 * Send multiple VerseShell expressions in a single JSON-RPC batch request.
 *
 * The VerseShell serve protocol supports sending a JSON array of requests.
 * They are evaluated in order, with responses returned as separate lines.
 * This is ideal when you need several independent values at once
 * (e.g. hostname + cpu + memory for a status bar).
 */
export async function verseshellBatchEval(
  cmds: string[],
  opts?: { timeoutMs?: number; agentId?: string },
): Promise<VerseShellExecResult[]> {
  const proc = ensureVerseShell();
  await waitForReady();

  const agent = opts?.agentId ?? "openclaw";
  const timeoutMs = clampTimeoutMs(opts?.timeoutMs);
  const batchId = `ae-batch-${++requestCounter}`;
  const requests = cmds.map((cmd, i) => ({
    id: `${batchId}-${i}`,
    agent,
    cmd,
    timeout_ms: timeoutMs,
  }));

  const requestJson = JSON.stringify(requests);

  const pending = cmds.map((_, i) => {
    const id = `${batchId}-${i}`;
    return new Promise<VerseShellExecResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`Batch request ${id} timed out`));
      }, timeoutMs + 250);

      pendingRequests.set(id, { resolve, reject, timer });
    });
  });

  // Write the full batch array after pending promises are set up
  try {
    proc.stdin!.write(requestJson + "\n");
  } catch (err) {
    // Reject all pending batch requests
    cmds.forEach((_, i) => {
      const id = `${batchId}-${i}`;
      const entry = pendingRequests.get(id);
      if (entry) {
        clearTimeout(entry.timer);
        pendingRequests.delete(id);
        entry.reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    throw err;
  }

  return Promise.all(pending).finally(() => {
    // Timeout safety: if any promises reject, clean up the remaining pending entries
    setTimeout(() => {
      cmds.forEach((_, i) => {
        const id = `${batchId}-${i}`;
        const entry = pendingRequests.get(id);
        if (entry) {
          clearTimeout(entry.timer);
          pendingRequests.delete(id);
          entry.reject(new Error(`Batch cleanup: ${id}`));
        }
      });
    }, timeoutMs + 500);
  });
}

// ── Typed Module Wrappers ───────────────────────────────────────────────────
//
// Each wrapper sends a VerseShell expression via verseshellEval and returns a
// typed result. These cover the full module surface of the open-source
// VerseShell (Rust) kernel — 26 modules, 987 builtins.
//
// Safe functions (no capability required): math, str, arr, json, type queries.
// Gated functions require the matching capability (e.g. file.read, net.http.get).

function aeStr(value: string): string {
  return JSON.stringify(value);
}

function buildAeCall(module: string, func: string, ...args: string[]): string {
  return `${module}.${func}(${args.join(", ")})`;
}

/** Parse a verseshellEval result, throwing on error. */
function unwrapResult<T>(
  result: VerseShellExecResult,
  transform: (v: unknown) => T,
  label: string,
): T {
  if (!result.ok) {
    const err = result.error;
    throw new Error(
      `VerseShell ${label} failed: ${err?.message ?? "unknown"}` +
        (err?.hint ? ` (hint: ${err.hint})` : ""),
    );
  }
  return transform(result.value);
}

// ── System Information ──────────────────────────────────────────────────────

export interface VerseShellCpuInfo {
  name: string;
  cores: number;
  mhz: number;
}

export interface VerseShellMemInfo {
  total: number;
  free: number;
  available: number;
}

export interface VerseShellDiskInfo {
  filesystem: string;
  size: number;
  used: number;
  available: number;
  use_percent: number;
  mounted_on: string;
}

export interface VerseShellLoadAvg {
  "1min": number;
  "5min": number;
  "15min": number;
}

export interface VerseShellSystemInfo {
  hostname: string;
  os: string;
  arch: string;
  kernel: string;
  uptime: number;
  cpuCount: number;
}

export async function verseshellSysInfo(
  opts?: { timeoutMs?: number },
): Promise<VerseShellSystemInfo> {
  const result = await verseshellEval(
    `{hostname: sys.hostname(), os: sys.os(), arch: sys.arch(), kernel: sys.kernel(), uptime: sys.uptime(), cpuCount: sys.cpu_count()}`,
    opts,
  );
  return unwrapResult(result, (v) => v as VerseShellSystemInfo, "sys.info");
}

export async function verseshellCpuInfo(
  opts?: { timeoutMs?: number },
): Promise<VerseShellCpuInfo> {
  const result = await verseshellEval("sys.cpu_info()", opts);
  return unwrapResult(result, (v) => v as VerseShellCpuInfo, "sys.cpu_info");
}

export async function verseshellMemInfo(
  opts?: { timeoutMs?: number },
): Promise<VerseShellMemInfo> {
  const result = await verseshellEval("sys.mem_info()", opts);
  return unwrapResult(result, (v) => v as VerseShellMemInfo, "sys.mem_info");
}

export async function verseshellDiskInfo(
  opts?: { timeoutMs?: number },
): Promise<VerseShellDiskInfo[]> {
  const result = await verseshellEval("sys.disk_info()", opts);
  return unwrapResult(result, (v) => v as VerseShellDiskInfo[], "sys.disk_info");
}

export async function verseshellLoadAvg(
  opts?: { timeoutMs?: number },
): Promise<VerseShellLoadAvg> {
  const result = await verseshellEval("sys.load_avg()", opts);
  return unwrapResult(result, (v) => v as VerseShellLoadAvg, "sys.load_avg");
}

export async function verseshellHostname(
  opts?: { timeoutMs?: number },
): Promise<string> {
  const result = await verseshellEval("sys.hostname()", opts);
  return unwrapResult(result, (v) => v as string, "sys.hostname");
}

export async function verseshellEnvAll(
  opts?: { timeoutMs?: number },
): Promise<Record<string, string>> {
  const result = await verseshellEval("sys.env_all()", opts);
  return unwrapResult(result, (v) => v as Record<string, string>, "sys.env_all");
}

export async function verseshellProcessInfo(
  pid: number,
  opts?: { timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const result = await verseshellEval(`sys.process_info(${pid})`, opts);
  return unwrapResult(result, (v) => v as Record<string, unknown>, "sys.process_info");
}

// ── File Operations ─────────────────────────────────────────────────────────

export interface VerseShellFileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

/** Full file stat (size, ext, modified, permissions). Use file.stat() on demand. */
export interface VerseShellFileStat {
  size: number;
  is_file: boolean;
  is_dir: boolean;
  is_symlink: boolean;
  readonly: boolean;
  ext: string;
  modified?: number;
  accessed?: number;
  created?: number;
}

export async function verseshellFileLs(
  dirPath = ".",
  opts?: { timeoutMs?: number },
): Promise<VerseShellFileEntry[]> {
  const p = normalizeToolPath(dirPath);
  const result = await verseshellEval(buildAeCall("file", "ls", aeStr(p)), opts);
  return unwrapResult(result, (v) => v as VerseShellFileEntry[], "file.ls");
}

/**
 * Get full metadata for a single file or directory.
 * This is the "detail on demand" companion to file.ls(),
 * which returns only name+is_dir for speed.
 */
export async function verseshellFileStat(
  filePath: string,
  opts?: { timeoutMs?: number },
): Promise<VerseShellFileStat> {
  const p = normalizeToolPath(filePath);
  const result = await verseshellEval(buildAeCall("file", "stat", aeStr(p)), opts);
  return unwrapResult(result, (v) => v as VerseShellFileStat, "file.stat");
}

export async function verseshellFileRead(
  filePath: string,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const p = normalizeToolPath(filePath);
  const result = await verseshellEval(buildAeCall("file", "read", aeStr(p)), opts);
  return unwrapResult(result, (v) => v as string, "file.read");
}

export async function verseshellFileWrite(
  filePath: string,
  content: string,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const p = normalizeToolPath(filePath);
  const result = await verseshellEval(
    buildAeCall("file", "write", aeStr(p), JSON.stringify(content)),
    opts,
  );
  unwrapResult(result, () => {}, "file.write");
}

export async function verseshellFileExists(
  filePath: string,
  opts?: { timeoutMs?: number },
): Promise<boolean> {
  const p = normalizeToolPath(filePath);
  const result = await verseshellEval(buildAeCall("file", "exists", aeStr(p)), opts);
  return unwrapResult(result, (v) => Boolean(v), "file.exists");
}

export async function verseshellFileGrep(
  pattern: string,
  filePath: string,
  opts?: { timeoutMs?: number },
): Promise<string[]> {
  const p = normalizeToolPath(filePath);
  const result = await verseshellEval(
    buildAeCall("file", "grep", aeStr(pattern), aeStr(p)),
    opts,
  );
  return unwrapResult(result, (v) => v as string[], "file.grep");
}

export async function verseshellFileHead(
  filePath: string,
  n = 10,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const p = normalizeToolPath(filePath);
  const result = await verseshellEval(buildAeCall("file", "head", aeStr(p), String(n)), opts);
  return unwrapResult(result, (v) => v as string, "file.head");
}

export async function verseshellFileTail(
  filePath: string,
  n = 10,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const p = normalizeToolPath(filePath);
  const result = await verseshellEval(buildAeCall("file", "tail", aeStr(p), String(n)), opts);
  return unwrapResult(result, (v) => v as string, "file.tail");
}

export async function verseshellFileCopy(
  src: string,
  dst: string,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const result = await verseshellEval(
    buildAeCall("file", "copy", aeStr(normalizeToolPath(src)), aeStr(normalizeToolPath(dst))),
    opts,
  );
  unwrapResult(result, () => {}, "file.copy");
}

export async function verseshellFileMove(
  src: string,
  dst: string,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const result = await verseshellEval(
    buildAeCall("file", "move", aeStr(normalizeToolPath(src)), aeStr(normalizeToolPath(dst))),
    opts,
  );
  unwrapResult(result, () => {}, "file.move");
}

export async function verseshellFileMkdir(
  dirPath: string,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const p = normalizeToolPath(dirPath);
  const result = await verseshellEval(buildAeCall("file", "mkdir", aeStr(p)), opts);
  unwrapResult(result, () => {}, "file.mkdir");
}

export async function verseshellFilePwd(
  opts?: { timeoutMs?: number },
): Promise<string> {
  const result = await verseshellEval("file.pwd()", opts);
  return unwrapResult(result, (v) => v as string, "file.pwd");
}

// ── Process Management ──────────────────────────────────────────────────────

export interface VerseShellProcessInfo {
  pid: number;
  name: string;
  cpu_percent: number;
  mem_bytes: number;
  status: string;
  threads: number;
  exe: string;
  cmdline: string[];
  cwd: string;
  parent: number;
}

export async function verseshellProcList(
  opts?: { timeoutMs?: number },
): Promise<VerseShellProcessInfo[]> {
  const result = await verseshellEval("proc.list()", opts);
  return unwrapResult(result, (v) => v as VerseShellProcessInfo[], "proc.list");
}

export async function verseshellProcKill(
  pid: number,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const result = await verseshellEval(buildAeCall("proc", "kill", String(pid)), opts);
  unwrapResult(result, () => {}, "proc.kill");
}

export async function verseshellProcInfo(
  pid: number,
  opts?: { timeoutMs?: number },
): Promise<VerseShellProcessInfo> {
  const result = await verseshellEval(buildAeCall("proc", "info", String(pid)), opts);
  return unwrapResult(result, (v) => v as VerseShellProcessInfo, "proc.info");
}

export async function verseshellProcChildren(
  pid: number,
  opts?: { timeoutMs?: number },
): Promise<number[]> {
  const result = await verseshellEval(buildAeCall("proc", "children", String(pid)), opts);
  return unwrapResult(result, (v) => v as number[], "proc.children");
}

export async function verseshellProcExists(
  pid: number,
  opts?: { timeoutMs?: number },
): Promise<boolean> {
  const result = await verseshellEval(buildAeCall("proc", "exists", String(pid)), opts);
  return unwrapResult(result, (v) => Boolean(v), "proc.exists");
}

// ── Network Operations ──────────────────────────────────────────────────────

export interface VerseShellNetInterface {
  name: string;
  ips: string[];
  mac: string;
  up: boolean;
}

export async function verseshellNetInterfaces(
  opts?: { timeoutMs?: number },
): Promise<VerseShellNetInterface[]> {
  const result = await verseshellEval("net.interfaces()", opts);
  return unwrapResult(result, (v) => v as VerseShellNetInterface[], "net.interfaces");
}

export async function verseshellNetPing(
  host: string,
  opts?: { timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const result = await verseshellEval(buildAeCall("net", "ping", aeStr(host)), opts);
  return unwrapResult(result, (v) => v as Record<string, unknown>, "net.ping");
}

export async function verseshellNetDns(
  host: string,
  opts?: { timeoutMs?: number },
): Promise<string[]> {
  const result = await verseshellEval(buildAeCall("net", "dns_lookup", aeStr(host)), opts);
  return unwrapResult(result, (v) => v as string[], "net.dns_lookup");
}

export async function verseshellNetConnections(
  opts?: { timeoutMs?: number },
): Promise<Record<string, unknown>[]> {
  const result = await verseshellEval("net.connections()", opts);
  return unwrapResult(result, (v) => v as Record<string, unknown>[], "net.connections");
}

export async function verseshellNetPorts(
  opts?: { timeoutMs?: number },
): Promise<Record<string, unknown>[]> {
  const result = await verseshellEval("net.ports()", opts);
  return unwrapResult(result, (v) => v as Record<string, unknown>[], "net.ports");
}

// ── Hardware Information ────────────────────────────────────────────────────

export async function verseshellHwCpu(
  opts?: { timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const result = await verseshellEval("hw.cpu()", opts);
  return unwrapResult(result, (v) => v as Record<string, unknown>, "hw.cpu");
}

export async function verseshellHwMemory(
  opts?: { timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const result = await verseshellEval("hw.memory()", opts);
  return unwrapResult(result, (v) => v as Record<string, unknown>, "hw.memory");
}

export async function verseshellHwDisks(
  opts?: { timeoutMs?: number },
): Promise<Record<string, unknown>[]> {
  const result = await verseshellEval("hw.disks()", opts);
  return unwrapResult(result, (v) => v as Record<string, unknown>[], "hw.disks");
}

export async function verseshellHwGpus(
  opts?: { timeoutMs?: number },
): Promise<Record<string, unknown>[]> {
  const result = await verseshellEval("hw.gpus()", opts);
  return unwrapResult(result, (v) => v as Record<string, unknown>[], "hw.gpus");
}

export async function verseshellHwBattery(
  opts?: { timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const result = await verseshellEval("hw.battery()", opts);
  return unwrapResult(result, (v) => v as Record<string, unknown>, "hw.battery");
}

// ── Platform Detection ──────────────────────────────────────────────────────

export async function verseshellPlatformSummary(
  opts?: { timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const result = await verseshellEval("platform.hardware_summary()", opts);
  return unwrapResult(result, (v) => v as Record<string, unknown>, "platform.hardware_summary");
}

export async function verseshellPlatformOsVersion(
  opts?: { timeoutMs?: number },
): Promise<string> {
  const result = await verseshellEval("platform.os()", opts);
  return unwrapResult(result, (v) => v as string, "platform.os");
}

export async function verseshellPlatformTools(
  opts?: { timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const result = await verseshellEval("platform.detect_tools()", opts);
  return unwrapResult(result, (v) => v as Record<string, unknown>, "platform.detect_tools");
}

export async function verseshellPlatformHasTool(
  tool: string,
  opts?: { timeoutMs?: number },
): Promise<boolean> {
  const result = await verseshellEval(
    buildAeCall("platform", "has_tool", aeStr(tool)),
    opts,
  );
  return unwrapResult(result, (v) => Boolean(v), "platform.has_tool");
}

// ── Windows-Specific ────────────────────────────────────────────────────────

export async function verseshellWinSnapshot(
  opts?: { timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const result = await verseshellEval("win.snapshot()", opts);
  return unwrapResult(result, (v) => v as Record<string, unknown>, "win.snapshot");
}

export async function verseshellWinRegistryGet(
  key: string,
  valueName = "ProductName",
  opts?: { timeoutMs?: number },
): Promise<string> {
  const result = await verseshellEval(
    buildAeCall("win", "registry_get", aeStr(key), aeStr(valueName)),
    opts,
  );
  return unwrapResult(result, (v) => v as string, "win.registry_get");
}

export async function verseshellWinServiceList(
  opts?: { timeoutMs?: number },
): Promise<string[]> {
  const result = await verseshellEval("win.service_list()", opts);
  return unwrapResult(result, (v) => v as string[], "win.service_list");
}

export async function verseshellWinServiceStatus(
  name: string,
  opts?: { timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const result = await verseshellEval(
    buildAeCall("win", "service_status", aeStr(name)),
    opts,
  );
  return unwrapResult(result, (v) => v as Record<string, unknown>, "win.service_status");
}

export async function verseshellWinIsAdmin(
  opts?: { timeoutMs?: number },
): Promise<boolean> {
  const result = await verseshellEval("win.is_admin()", opts);
  return unwrapResult(result, (v) => Boolean(v), "win.is_admin");
}

export async function verseshellWinEnvPath(
  opts?: { timeoutMs?: number },
): Promise<string[]> {
  const result = await verseshellEval("win.env_path()", opts);
  return unwrapResult(result, (v) => v as string[], "win.env_path");
}

// ── Crypto ──────────────────────────────────────────────────────────────────

export async function verseshellCryptoHash(
  data: string,
  algo: "sha256" | "md5" = "sha256",
  opts?: { timeoutMs?: number },
): Promise<string> {
  const result = await verseshellEval(
    buildAeCall("crypto", "hash", aeStr(data), aeStr(algo)),
    opts,
  );
  return unwrapResult(result, (v) => v as string, "crypto.hash");
}

export async function verseshellCryptoUuid(
  opts?: { timeoutMs?: number },
): Promise<string> {
  const result = await verseshellEval("crypto.uuid()", opts);
  return unwrapResult(result, (v) => v as string, "crypto.uuid");
}

export async function verseshellCryptoRandomBytes(
  n = 16,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const result = await verseshellEval(buildAeCall("crypto", "random_bytes", String(n)), opts);
  return unwrapResult(result, (v) => v as string, "crypto.random_bytes");
}

export async function verseshellCryptoBase64Encode(
  data: string,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const result = await verseshellEval(
    buildAeCall("crypto", "base64_encode", aeStr(data)),
    opts,
  );
  return unwrapResult(result, (v) => v as string, "crypto.base64_encode");
}

export async function verseshellCryptoBase64Decode(
  data: string,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const result = await verseshellEval(
    buildAeCall("crypto", "base64_decode", aeStr(data)),
    opts,
  );
  return unwrapResult(result, (v) => v as string, "crypto.base64_decode");
}

// ── HTTP ────────────────────────────────────────────────────────────────────

export async function verseshellHttpGet(
  url: string,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const result = await verseshellEval(buildAeCall("http", "get", aeStr(url)), opts);
  return unwrapResult(result, (v) => v as string, "http.get");
}

export async function verseshellHttpPost(
  url: string,
  body: string,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const result = await verseshellEval(
    buildAeCall("http", "post", aeStr(url), JSON.stringify(body)),
    opts,
  );
  return unwrapResult(result, (v) => v as string, "http.post");
}

export async function verseshellHttpJsonPost(
  url: string,
  data: Record<string, unknown>,
  opts?: { timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const result = await verseshellEval(
    buildAeCall("http", "json_post", aeStr(url), JSON.stringify(data)),
    opts,
  );
  return unwrapResult(result, (v) => v as Record<string, unknown>, "http.json_post");
}

// ── JSON ────────────────────────────────────────────────────────────────────

export async function verseshellJsonParse(
  json: string,
  opts?: { timeoutMs?: number },
): Promise<unknown> {
  const result = await verseshellEval(buildAeCall("json", "parse", JSON.stringify(json)), opts);
  return unwrapResult(result, (v) => v, "json.parse");
}

export async function verseshellJsonStringify(
  value: unknown,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const result = await verseshellEval(`json.stringify(${JSON.stringify(value)})`, opts);
  return unwrapResult(result, (v) => v as string, "json.stringify");
}

// ── Data Pipeline ───────────────────────────────────────────────────────────

/**
 * Execute a typed pipeline expression.
 *
 * Uses VerseShell's typed pipeline engine (not shell pipes).
 * Supports: map, where/filter, sort, reduce, take, par_map, group_by, etc.
 *
 * Example pipeline:
 *   '[1,2,3,4,5] | where fn(x)=>x>2 | map fn(x)=>x*10'
 */
export async function verseshellPipeline(
  pipeline: string,
  opts?: { timeoutMs?: number },
): Promise<unknown> {
  const result = await verseshellEval(pipeline, opts);
  return unwrapResult(result, (v) => v, "pipeline");
}

// ── Math & String Utilities ─────────────────────────────────────────────────

export async function verseshellMath(
  expr: string,
  opts?: { timeoutMs?: number },
): Promise<number> {
  const result = await verseshellEval(`math.${expr}`, opts);
  return unwrapResult(result, (v) => Number(v), `math.${expr}`);
}

export async function verseshellStrTransform(
  expr: string,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const result = await verseshellEval(`str.${expr}`, opts);
  return unwrapResult(result, (v) => v as string, `str.${expr}`);
}

// ── Git ─────────────────────────────────────────────────────────────────────

export async function verseshellGitStatus(
  opts?: { timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const result = await verseshellEval("git.status()", opts);
  return unwrapResult(result, (v) => v as Record<string, unknown>, "git.status");
}

export async function verseshellGitBranch(
  opts?: { timeoutMs?: number },
): Promise<string> {
  const result = await verseshellEval("git.branch()", opts);
  return unwrapResult(result, (v) => v as string, "git.branch");
}

export async function verseshellGitLog(
  opts?: { timeoutMs?: number },
): Promise<Record<string, unknown>[]> {
  const result = await verseshellEval("git.log()", opts);
  return unwrapResult(result, (v) => v as Record<string, unknown>[], "git.log");
}

export async function verseshellGitDiff(
  opts?: { timeoutMs?: number },
): Promise<string> {
  const result = await verseshellEval("git.diff()", opts);
  return unwrapResult(result, (v) => v as string, "git.diff");
}

// ── Archive / Compression ───────────────────────────────────────────────────

export async function verseshellTarCreate(
  archive: string,
  sources: string[],
  opts?: { timeoutMs?: number },
): Promise<string> {
  const srcs = `[${sources.map((s) => aeStr(s)).join(", ")}]`;
  const result = await verseshellEval(
    buildAeCall("archive", "tar_create", aeStr(normalizeToolPath(archive)), srcs),
    opts,
  );
  return unwrapResult(result, (v) => v as string, "archive.tar_create");
}

export async function verseshellTarExtract(
  archive: string,
  dest = ".",
  opts?: { timeoutMs?: number },
): Promise<string> {
  const result = await verseshellEval(
    buildAeCall("archive", "tar_extract", aeStr(normalizeToolPath(archive)), aeStr(normalizeToolPath(dest))),
    opts,
  );
  return unwrapResult(result, (v) => v as string, "archive.tar_extract");
}

export async function verseshellZipCreate(
  archive: string,
  sources: string[],
  opts?: { timeoutMs?: number },
): Promise<string> {
  const srcs = `[${sources.map((s) => aeStr(s)).join(", ")}]`;
  const result = await verseshellEval(
    buildAeCall("archive", "zip_create", aeStr(normalizeToolPath(archive)), srcs),
    opts,
  );
  return unwrapResult(result, (v) => v as string, "archive.zip_create");
}

export async function verseshellZipExtract(
  archive: string,
  dest = ".",
  opts?: { timeoutMs?: number },
): Promise<string> {
  const result = await verseshellEval(
    buildAeCall("archive", "zip_extract", aeStr(normalizeToolPath(archive)), aeStr(normalizeToolPath(dest))),
    opts,
  );
  return unwrapResult(result, (v) => v as string, "archive.zip_extract");
}

// ── Database / SQLite ───────────────────────────────────────────────────────

export async function verseshellDbSqliteQuery(
  dbPath: string,
  query: string,
  opts?: { timeoutMs?: number },
): Promise<Record<string, unknown>[]> {
  // First open, then query
  const openResult = await verseshellEval(
    buildAeCall("db", "sqlite_open", aeStr(normalizeToolPath(dbPath))),
    opts,
  );
  unwrapResult(openResult, () => {}, "db.sqlite_open");
  const result = await verseshellEval(
    buildAeCall("db", "sqlite_query", aeStr(query)),
    opts,
  );
  return unwrapResult(result, (v) => v as Record<string, unknown>[], "db.sqlite_query");
}

// ── Clipboard ───────────────────────────────────────────────────────────────

export async function verseshellClipboardRead(
  opts?: { timeoutMs?: number },
): Promise<string> {
  const result = await verseshellEval("clip.read()", opts);
  return unwrapResult(result, (v) => v as string, "clip.read");
}

export async function verseshellClipboardWrite(
  text: string,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const result = await verseshellEval(
    buildAeCall("clip", "write", aeStr(text)),
    opts,
  );
  unwrapResult(result, () => {}, "clip.write");
}

// ── VerseShell Server Control ───────────────────────────────────────────────

/**
 * Send a server control command (STATS, GC, REFRESH, SHUTDOWN).
 * These are not request/response — they modify server state directly.
 */
export function verseshellControl(command: "STATS" | "GC" | "REFRESH" | "SHUTDOWN"): void {
  if (!aeProcess || aeProcess.killed) return;
  try {
    aeProcess.stdin!.write(`${command}\n`);
  } catch {
    // ignore write errors
  }
}
