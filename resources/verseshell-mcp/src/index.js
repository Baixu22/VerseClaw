#!/usr/bin/env node
/**
 * VerseShell MCP Server — bridges VerseShell (ae --serve) to MCP-compatible AI agents.
 *
 * Usage:
 *   node verseshell-mcp-server.js [--ae-path <path>] [--workspace <dir>] [--profile product|development] [--cap <caps>] [--no-compact]
 *
 * The server spawns `ae --serve --format compact` as a child process and forwards
 * MCP tool calls to it via JSON-RPC over stdin/stdout. Compact protocol saves
 * 50-70% tokens vs JSON. Pass --no-compact to fall back to JSON.
 *
 * Capabilities are deny-by-default and can be granted only by explicit names:
 *   --cap file.read,shell.exec
 * Wildcard grants such as `--cap all` are rejected.
 *
 * Configure in ClawX's openclaw.json:
 *   "mcp": { "servers": { "verseshell": {
 *     "command": "node",
 *     "args": ["resources/verseshell-mcp/src/index.js", "--ae-path", "./verseshell/ae"]
 *   }}}
 *
 * Aligned with the pinned VerseShell runtime and its externally compatible
 * legacy command surface. The MCP package remains an adapter, not an
 * internal execution path.
 *   - verseshell_health tool (protocol/runtime metadata)
 *   - verseshell_transpile_bash tool (bash → verseshell)
 *   - verseshell_list_commands tool (enumerate 650+ builtins)
 *   - Smart error hint system for common LLM API mistakes
 *   - Compact token-efficient protocol (parity with TS bridge)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "child_process";
import { createInterface } from "readline";
import path, { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  OPERATION_CATALOG_COUNT,
  OPERATION_CATALOG_DIGEST,
  RUNTIME_SERVER_PROTOCOL,
  RUNTIME_VERSION,
} from "./identity.js";
import {
  assertToolAllowed,
  filterTools,
  parseRestrictedArgv,
  resolveMcpPolicy,
} from "./policy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────

const AE_PATH = process.argv.includes("--ae-path")
  ? resolve(process.argv[process.argv.indexOf("--ae-path") + 1])
  : resolve(__dirname, "..", "..", "..", "verseshell-runtime", "target", "release", "verseshell.exe") || "verseshell.exe";

const WORKSPACE = process.argv.includes("--workspace")
  ? process.argv[process.argv.indexOf("--workspace") + 1]
  : process.env.VERSESHELL_WORKSPACE || process.cwd();

const PROFILE_FLAG_INDEX = process.argv.indexOf("--profile");
const PROFILE = PROFILE_FLAG_INDEX >= 0 ? process.argv[PROFILE_FLAG_INDEX + 1] : (process.env.VERSESHELL_PROFILE || "product");
const CAP_FLAG_INDEX = process.argv.indexOf("--cap");
const CAPABILITY_RAW = CAP_FLAG_INDEX >= 0 ? process.argv[CAP_FLAG_INDEX + 1] : process.env.VERSESHELL_CAPS;
const MCP_POLICY = resolveMcpPolicy({ profile: PROFILE, caps: CAPABILITY_RAW });
const CAPS = MCP_POLICY.capabilities.join(",");
const RUNTIME_CAPS = MCP_POLICY.capabilities.filter((capability) => ![
  "catalog.read",
  "compat.transpile",
  "health.read",
].includes(capability)).join(",");

// Compact protocol toggle (parity with TS bridge). Pass --no-compact to disable.
const USE_COMPACT = !process.argv.includes("--no-compact") && process.env.VERSESHELL_NO_COMPACT !== "1";

const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
const MAX_TOOL_TIMEOUT_MS = 10 * 60_000;

function clampTimeoutMs(value, fallback = DEFAULT_TOOL_TIMEOUT_MS) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.max(Math.trunc(n), 100), MAX_TOOL_TIMEOUT_MS);
}

function findPathKey(env = process.env) {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") || (process.platform === "win32" ? "Path" : "PATH");
}

function uniquePathEntries(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const trimmed = String(entry || "").trim().replace(/^"|"$/g, "");
    if (!trimmed || trimmed.includes("\0") || /^%PATH%$/i.test(trimmed)) continue;
    const key = process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function sanitizeProcessEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  const key = findPathKey(env);
  const existing = String(env[key] || "");
  const defaults = process.platform === "win32"
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
  env[key] = uniquePathEntries([...existing.split(path.delimiter), ...defaults]).join(path.delimiter);
  return env;
}

function normalizeToolPath(inputPath, fallback = ".") {
  let s = String(inputPath ?? fallback).trim();
  if (!s) s = fallback;
  if (process.platform === "win32") {
    s = s.replace(/\\/g, "/");
    s = s.replace(/^\/([A-Za-z])\//, "$1:/");
    s = s.replace(/^([A-Za-z]):(?!\/)/, "$1:/");
  }
  return s;
}

function aeString(value) {
  return JSON.stringify(String(value));
}

function shellExecArgv(argv) {
  return `shell.exec([${argv.map(aeString).join(", ")}])`;
}

function toolErrorPayload(error, toolName, extra = {}) {
  return {
    tool: toolName,
    error: String(error?.message || error).slice(0, 512),
    code: error?.code,
    timed_out: error?.timedOut === true,
    timeoutMs: error?.timeoutMs,
    serverRestarted: error?.serverRestarted,
    ...extra,
  };
}

// ── Compact Protocol Parser ───────────────────────────────────────────
//
// VerseShell `--format compact` encodes responses as positional tokens with
// single-char type tags. Saves 50-70% tokens vs JSON. Format:
//
//   D <id> <ok:T|F> <value> <elapsed_ms> <cache:T|F|N> <session_age_ms>
//   E <id> <code> <message> <recoverable:T|F>
//
// Value encoding:
//   N              → null
//   T | F          → boolean
//   <number>       → int or float
//   S<len>:<content> → string
//   L<len> <items>   → array
//   R<len> <k1> <v1> ... → record
//
// Mirrors the parser in openclaw_runtime/src/agents/verseshell-runtime.ts
// so both paths stay in sync.

function splitCompactTokens(line) {
  const tokens = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && line[i] === " ") i++;
    if (i >= line.length) break;

    if (line[i] === "S") {
      i++;
      let lenStr = "";
      while (i < line.length && line[i] >= "0" && line[i] <= "9") {
        lenStr += line[i];
        i++;
      }
      if (line[i] === ":") i++;
      const len = parseInt(lenStr, 10);
      if (isNaN(len) || i + len > line.length) {
        tokens.push(line.slice(i - 1 - lenStr.length));
        break;
      }
      tokens.push(line.slice(i, i + len));
      i += len;
    } else if (line[i] === "R" || line[i] === "L") {
      const tag = line[i];
      i++;
      let countStr = "";
      while (i < line.length && line[i] >= "0" && line[i] <= "9") {
        countStr += line[i];
        i++;
      }
      tokens.push(tag + countStr);
    } else {
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

function parseCompactValue(parts, idx) {
  if (idx >= parts.length) return null;
  const token = parts[idx];

  if (token === "N") return { value: null, nextIndex: idx + 1 };
  if (token === "T") return { value: true, nextIndex: idx + 1 };
  if (token === "F") return { value: false, nextIndex: idx + 1 };
  if (token.startsWith("S")) return { value: token, nextIndex: idx + 1 };

  if (token.startsWith("L")) {
    const len = parseInt(token.slice(1), 10);
    if (isNaN(len)) return { value: [], nextIndex: idx + 1 };
    const arr = [];
    let next = idx + 1;
    for (let i = 0; i < len; i++) {
      const r = parseCompactValue(parts, next);
      if (!r) break;
      arr.push(r.value);
      next = r.nextIndex;
    }
    return { value: arr, nextIndex: next };
  }

  if (token.startsWith("R")) {
    const len = parseInt(token.slice(1), 10);
    if (isNaN(len)) return { value: {}, nextIndex: idx + 1 };
    const rec = {};
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

  const n = Number(token);
  if (!isNaN(n)) return { value: n, nextIndex: idx + 1 };

  return { value: token, nextIndex: idx + 1 };
}

function parseCompactDone(parts) {
  if (parts.length < 6) return null;
  const id = parts[1];
  const ok = parts[2] === "T";
  const elapsedMs = parseInt(parts[4], 10) || 0;
  const cacheTag = parts[5];
  const sessionAgeMs = parseInt(parts[6], 10) || 0;
  const valueResult = parseCompactValue(parts, 3);
  const value = valueResult ? valueResult.value : null;
  return {
    id,
    ok,
    value,
    meta: {
      elapsed_ms: elapsedMs,
      cache_hit: cacheTag === "T" ? true : cacheTag === "F" ? false : undefined,
      session_age_ms: sessionAgeMs,
    },
  };
}

function parseCompactError(parts) {
  if (parts.length < 5) return null;
  const id = parts[1];
  const code = parts[2];
  const message = parts[3].replace(/\\s/g, " ");
  const recoverable = parts[4] === "T";
  return {
    id,
    ok: false,
    error: { code, message, recoverable },
    meta: { elapsed_ms: 0, session_age_ms: 0 },
  };
}

function parseCompactLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parts = splitCompactTokens(trimmed);
  if (parts.length === 0) return null;
  if (parts[0] === "D") return parseCompactDone(parts);
  if (parts[0] === "E") return parseCompactError(parts);
  return null;
}

function normalizeJsonResponse(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (obj.type === "done") {
    return {
      id: String(obj.id ?? ""),
      ok: obj.ok !== false,
      value: obj.value,
      error: obj.ok === false ? {
        code: String(obj.error?.code ?? "E_UNKNOWN"),
        message: String(obj.error?.message ?? "Unknown error"),
        recoverable: obj.error?.recoverable !== false,
      } : undefined,
      meta: {
        elapsed_ms: obj.meta?.elapsed_ms ?? 0,
        cache_hit: obj.meta?.cache_hit,
        session_age_ms: obj.meta?.session_age_ms ?? 0,
      },
    };
  }
  if (obj.type === "error" || obj.ok === false) {
    return {
      id: String(obj.id ?? ""),
      ok: false,
      error: {
        code: String(obj.error?.code ?? "E_UNKNOWN"),
        message: String(obj.error?.message ?? "Unknown error"),
        recoverable: obj.error?.recoverable !== false,
      },
      meta: { elapsed_ms: 0, session_age_ms: 0 },
    };
  }
  return null;
}

// ── Smart Error Hint System ───────────────────────────────────────────
//
// Catches common verseshell API mistakes and suggests corrections to save
// LLM token spend on retries. Mirrors ae-mcp's suggest_hint in mcp.rs.

function suggestHint(code, error) {
  const err = String(error ?? "");
  if (err.includes("field 'env' not found")) {
    return "sys.env(KEY) not available. Use sys.env_all() to get all env vars";
  }
  if (err.includes("field 'map' not found")) {
    return "arr.map() not available. Use arr.filter(list, fn(x)=>condition) or arr.each(list, fn(x)=>action)";
  }
  if (err.includes("field 'ls' not found") && code.includes("fs.ls")) {
    return "fs.ls() not available. Use file.ls(path) for directory listing";
  }
  if (err.includes("field 'size' not found") && code.includes("file.size")) {
    return "file.size() not available. Use file.stat(path) for file metadata including size";
  }
  if (err.includes("field 'len' not found") && code.includes("str.len")) {
    return "str.len() not available. Use str.length(s) for string length";
  }
  if (err.includes("field '") && err.includes("not found")) {
    const m = err.match(/field '([^']+)'/);
    if (m && m[1]) {
      return `'${m[1]}' not found in that module. Use verseshell_list_commands to see available functions`;
    }
  }
  if (err.includes("cannot call non-function value") && code.includes("({")) {
    return "Cannot wrap record in parens. Use {a:1}.a instead of ({a:1}).a";
  }
  if (err.includes("cat: no file specified") ||
      (err.includes("no file specified") && code.includes("file.read("))) {
    return 'file.read(path) needs a path: file.read("C:\\\\path\\\\to\\\\file.txt")';
  }
  return null;
}

// ── VerseShell Process Manager ────────────────────────────────────────

let aeProcess = null;
let responseResolvers = new Map();
let requestId = 0;
let aeReady = false;
const readyWaiters = [];

function startAeShell() {
  const needsCatalogRuntime = MCP_POLICY.capabilities.includes("catalog.read");
  if (!RUNTIME_CAPS && !needsCatalogRuntime) {
    console.error("[verseshell-mcp] Runtime start skipped: no runtime capability is enabled.");
    return;
  }
  const args = ["--serve", "--agent", "--policy", "strict"];
  if (USE_COMPACT) {
    args.push("--format", "compact");
  } else {
    args.push("--json");
  }
  if (WORKSPACE) args.push("--workspace", WORKSPACE);
  args.push("--cap", RUNTIME_CAPS);

  console.error(`[verseshell-mcp] Starting: ${AE_PATH} ${args.join(" ")}`);
  console.error(`[verseshell-mcp] Protocol: ${USE_COMPACT ? "compact" : "json"} | Profile: ${MCP_POLICY.profile} | Caps: ${CAPS || "<none>"}`);

  aeProcess = spawn(AE_PATH, args, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: WORKSPACE,
    env: sanitizeProcessEnv({
      AE_FORMAT: USE_COMPACT ? "compact" : "json",
      AETHER_WORKSPACE: WORKSPACE,
      VERSESHELL_WORKSPACE: WORKSPACE,
    }),
    windowsHide: true,
  });

  const rl = createInterface({ input: aeProcess.stdout });

  rl.on("line", (rawLine) => {
    const line = String(rawLine || "").trim();
    if (!line) return;

    // Control responses from STATS/GC/REFRESH arrive as JSON without a type tag.
    if (line.startsWith("{")) {
      try {
        const obj = JSON.parse(line);
        if (obj.id === "__gc__" || obj.id === "__refresh__") return;
        const normalized = normalizeJsonResponse(obj);
        if (normalized && responseResolvers.has(normalized.id)) {
          const { resolve, timer } = responseResolvers.get(normalized.id);
          clearTimeout(timer);
          responseResolvers.delete(normalized.id);
          resolve(normalized);
          if (!aeReady) {
            aeReady = true;
            readyWaiters.forEach((r) => r());
            readyWaiters.length = 0;
            console.error(`[verseshell-mcp] VerseShell server ready`);
          }
          return;
        }
      } catch {
        // fall through to compact parse
      }
    }

    // Primary path when USE_COMPACT: parse compact D/E lines.
    if (USE_COMPACT) {
      const compactResult = parseCompactLine(line);
      if (compactResult && responseResolvers.has(compactResult.id)) {
        const { resolve, timer } = responseResolvers.get(compactResult.id);
        clearTimeout(timer);
        responseResolvers.delete(compactResult.id);
        resolve(compactResult);
        if (!aeReady) {
          aeReady = true;
          readyWaiters.forEach((r) => r());
          readyWaiters.length = 0;
          console.error(`[verseshell-mcp] VerseShell server ready (compact)`);
        }
        return;
      }
    }

    // Mark ready on first parseable line regardless of pending map.
    if (!aeReady) {
      aeReady = true;
      readyWaiters.forEach((r) => r());
      readyWaiters.length = 0;
      console.error(`[verseshell-mcp] VerseShell server ready`);
    }
  });

  aeProcess.stderr.on("data", (data) => {
    const text = data.toString().trim();
    if (text) console.error(`[verseshell-mcp] ae: ${text}`);
  });

  aeProcess.on("close", (code) => {
    console.error(`[verseshell-mcp] VerseShell exited (code=${code}). Restarting in 1s...`);
    aeReady = false;
    aeProcess = null;
    for (const [id, entry] of responseResolvers) {
      clearTimeout(entry.timer);
      responseResolvers.delete(id);
      const err = new Error(`VerseShell exited (code=${code})`);
      err.code = "E_VERSESHELL_EXIT";
      entry.reject(err);
    }
    setTimeout(startAeShell, 1000);
  });
}

async function waitForReady(timeoutMs = 10000) {
  if (aeReady || (aeProcess && !aeProcess.killed)) return;
  if (!aeProcess) startAeShell();
  if (aeReady || (aeProcess && !aeProcess.killed)) return;
  return new Promise((resolve, reject) => {
    readyWaiters.push(resolve);
    setTimeout(() => {
      if (!aeReady) reject(new Error("VerseShell startup timeout"));
    }, timeoutMs);
  });
}

async function sendRequest(cmd, timeoutMs = 30000) {
  const effectiveTimeoutMs = clampTimeoutMs(timeoutMs);
  if (!aeReady) await waitForReady();

  const id = `vs-${++requestId}`;
  const request = JSON.stringify({
    id,
    agent: "clawx-agent",
    cmd,
    timeout_ms: effectiveTimeoutMs,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      responseResolvers.delete(id);
      const err = new Error(`VerseShell request timeout after ${effectiveTimeoutMs}ms`);
      err.code = "E_TIMEOUT";
      err.timedOut = true;
      err.timeoutMs = effectiveTimeoutMs;
      err.serverRestarted = true;
      killAeTree();
      reject(err);
    }, effectiveTimeoutMs + 250);

    responseResolvers.set(id, { resolve, reject, timer });

    aeProcess.stdin.write(request + "\n");
  });
}

function killAeTree() {
  const proc = aeProcess;
  if (!proc || !proc.pid || proc.killed) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
        stdio: "ignore",
        env: sanitizeProcessEnv(),
        windowsHide: true,
      }).on("error", () => {
        try { proc.kill("SIGKILL"); } catch {}
      });
      return;
    } catch {}
  }
  try {
    proc.kill("SIGKILL");
  } catch {}
}

// ── Known Module Names ────────────────────────────────────────────────
//
// Used by verseshell_list_commands to enumerate builtins across all
// registered modules. Matches the module list documented in verseshell v0.3.0
// README. Missing modules are silently skipped (try/catch on the ae side).

const KNOWN_MODULES = [
  "sys", "file", "arr", "win", "str", "math", "shell",
  "crypto", "json", "http", "proc", "net", "hw", "platform",
  "git", "db", "archive", "clip", "svc", "cron", "user", "perm", "pkg", "input",
];

// ── Tool Definitions ──────────────────────────────────────────────────

const ALL_TOOLS = [
  // ── Aligned with verseshell v0.3.0 native ae-mcp ──────────────────────
  { name: "verseshell_health", description: "Check whether the VerseShell MCP server is responsive and report protocol/runtime metadata (modules, commands, protocol version).", parameters: { type: "object", properties: {} } },
  { name: "verseshell_transpile_bash", description: "Transpile a bash script into VerseShell syntax using the ae --bash transpiler. Useful for migrating shell scripts to typed pipelines.", parameters: { type: "object", properties: { bash_code: { type: "string", description: "Bash script to transpile into verseshell" } }, required: ["bash_code"] } },
  { name: "verseshell_list_commands", description: "List all available VerseShell built-in commands grouped by module (e.g. sys.hostname, file.read, arr.map). Use this to discover available functions when composing verseshell_eval calls.", parameters: { type: "object", properties: {} } },

  // System
  { name: "verseshell_sys_info", description: "Get system info (OS, arch, CPU, memory, disks, load)", parameters: { type: "object", properties: {} } },
  { name: "verseshell_sys_cpu", description: "Get CPU info: name, cores, frequency", parameters: { type: "object", properties: {} } },
  { name: "verseshell_sys_memory", description: "Get memory info: total, free, available bytes", parameters: { type: "object", properties: {} } },
  { name: "verseshell_sys_disk", description: "Get disk info: filesystem, size, used, available", parameters: { type: "object", properties: {} } },
  { name: "verseshell_sys_hostname", description: "Get system hostname", parameters: { type: "object", properties: {} } },
  { name: "verseshell_sys_process", description: "Get detailed process info by PID", parameters: { type: "object", properties: { pid: { type: "number", description: "Process ID" } }, required: ["pid"] } },

  // Files
  { name: "verseshell_file_ls", description: "List directory contents (names and directory/not, minimal syscalls). Use file.stat for per-entry size/ext/modified.", parameters: { type: "object", properties: { path: { type: "string", description: "Directory path (default: .)" } } } },
  { name: "verseshell_file_stat", description: "Get detailed file/directory metadata: size, is_file, is_dir, ext, modified, accessed, created", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "verseshell_file_read", description: "Read file content", parameters: { type: "object", properties: { path: { type: "string", description: "File path" } }, required: ["path"] } },
  { name: "verseshell_file_write", description: "Write content to file (atomic: temp→fsync→rename)", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "verseshell_file_exists", description: "Check if file/directory exists", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "verseshell_file_grep", description: "Search file for pattern", parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" } }, required: ["pattern", "path"] } },
  { name: "verseshell_file_head", description: "Read first N lines of file", parameters: { type: "object", properties: { path: { type: "string" }, n: { type: "number", description: "Lines (default: 10)" } }, required: ["path"] } },

  // Arrays / Data
  { name: "verseshell_arr_pipeline", description: "Execute a typed data pipeline: map, filter/where, sort, reduce, take, etc.", parameters: { type: "object", properties: { pipeline: { type: "string", description: "Pipeline expression, e.g. '[1,2,3,4,5] | where fn(x)=>x>2 | map fn(x)=>x*10'" } }, required: ["pipeline"] } },
  { name: "verseshell_json_parse", description: "Parse JSON string to structured data", parameters: { type: "object", properties: { json: { type: "string" } }, required: ["json"] } },
  { name: "verseshell_json_stringify", description: "Convert structured data to JSON string", parameters: { type: "object", properties: { value: { type: "string", description: "Expression that returns a value, e.g. '{a:1,b:2}'" } }, required: ["value"] } },

  // Windows
  { name: "verseshell_win_registry", description: "Read Windows registry value", parameters: { type: "object", properties: { key: { type: "string", description: "Registry key path, e.g. HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion" }, value: { type: "string", description: "Value name (default: ProductName)" } }, required: ["key"] } },
  { name: "verseshell_win_service_list", description: "List all Windows services", parameters: { type: "object", properties: {} } },
  { name: "verseshell_win_service_status", description: "Get Windows service status", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "verseshell_win_env_path", description: "Get PATH environment variable entries", parameters: { type: "object", properties: {} } },
  { name: "verseshell_win_is_admin", description: "Check if running with administrator privileges", parameters: { type: "object", properties: {} } },

  // Shell
  { name: "verseshell_shell_exec", description: "Development-only compatibility adapter. Execute an explicit argv vector through the governed shell.exec boundary.", parameters: { type: "object", properties: { argv: { type: "array", items: { type: "string" }, minItems: 1, description: "Explicit executable and arguments; shell strings are not accepted." }, timeoutMs: { type: "number", description: "Optional MCP-side timeout in milliseconds (default 30000)." } }, required: ["argv"] } },
  { name: "verseshell_process_exec", description: "Execute a process through VerseShell with explicit argv. Preferred for commands with spaces, quotes, Windows paths, or -c script arguments.", parameters: { type: "object", properties: { program: { type: "string", description: "Executable path or name" }, args: { type: "array", items: { type: "string" }, description: "Argument vector, one argument per item" }, timeoutMs: { type: "number", description: "Optional MCP-side timeout in milliseconds (default 30000)." } }, required: ["program"] } },
  { name: "verseshell_shell_echo", description: "Print a message (for debugging)", parameters: { type: "object", properties: { msg: { type: "string" } }, required: ["msg"] } },

  // Crypto
  { name: "verseshell_crypto_hash", description: "Compute SHA-256 hash of data", parameters: { type: "object", properties: { data: { type: "string" }, algo: { type: "string", description: "sha256 (default), md5" } }, required: ["data"] } },
  { name: "verseshell_crypto_uuid", description: "Generate UUID v4", parameters: { type: "object", properties: {} } },
  { name: "verseshell_crypto_random", description: "Generate random hex bytes", parameters: { type: "object", properties: { n: { type: "number", description: "Number of bytes (default: 16)" } } } },

  // HTTP
  { name: "verseshell_http_get", description: "HTTP GET request", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "verseshell_http_post", description: "HTTP POST request", parameters: { type: "object", properties: { url: { type: "string" }, body: { type: "string" } }, required: ["url"] } },

  // Math
  { name: "verseshell_math", description: "Evaluate a math expression", parameters: { type: "object", properties: { expr: { type: "string", description: "Math expression, e.g. 'abs(-5)', 'sqrt(144)', 'sum([1,2,3])'" } }, required: ["expr"] } },

  // Generic
  { name: "verseshell_eval", description: "Execute any VerseShell expression and return structured result", parameters: { type: "object", properties: { code: { type: "string", description: "VerseShell code to evaluate" }, timeoutMs: { type: "number", description: "Optional MCP-side timeout in milliseconds (default 30000)." } }, required: ["code"] } },

  // ── Process Management ────────────────────────────────────────────────
  { name: "verseshell_proc_list", description: "List all running processes with PID, name, CPU%, memory, status, threads", parameters: { type: "object", properties: {} } },
  { name: "verseshell_proc_info", description: "Get detailed process info by PID", parameters: { type: "object", properties: { pid: { type: "number" } }, required: ["pid"] } },
  { name: "verseshell_proc_kill", description: "Kill a process by PID", parameters: { type: "object", properties: { pid: { type: "number" } }, required: ["pid"] } },
  { name: "verseshell_proc_children", description: "Get child process PIDs for a given parent PID", parameters: { type: "object", properties: { pid: { type: "number" } }, required: ["pid"] } },
  { name: "verseshell_proc_exists", description: "Check if a process exists by PID", parameters: { type: "object", properties: { pid: { type: "number" } }, required: ["pid"] } },

  // ── Network ───────────────────────────────────────────────────────────
  { name: "verseshell_net_interfaces", description: "List network interfaces with IPs, MAC, status", parameters: { type: "object", properties: {} } },
  { name: "verseshell_net_ping", description: "Ping a host and return latency stats", parameters: { type: "object", properties: { host: { type: "string" } }, required: ["host"] } },
  { name: "verseshell_net_dns", description: "DNS lookup for a hostname", parameters: { type: "object", properties: { host: { type: "string" } }, required: ["host"] } },
  { name: "verseshell_net_connections", description: "List active network connections", parameters: { type: "object", properties: {} } },
  { name: "verseshell_net_ports", description: "List listening ports", parameters: { type: "object", properties: {} } },

  // ── Hardware ───────────────────────────────────────────────────────────
  { name: "verseshell_hw_cpu", description: "Get CPU hardware details (model, sockets, cores, threads)", parameters: { type: "object", properties: {} } },
  { name: "verseshell_hw_memory", description: "Get physical memory hardware details", parameters: { type: "object", properties: {} } },
  { name: "verseshell_hw_disks", description: "List physical disk drives", parameters: { type: "object", properties: {} } },
  { name: "verseshell_hw_gpus", description: "List GPU devices", parameters: { type: "object", properties: {} } },
  { name: "verseshell_hw_battery", description: "Get battery status (percent, charging, time remaining)", parameters: { type: "object", properties: {} } },

  // ── Platform ───────────────────────────────────────────────────────────
  { name: "verseshell_platform_summary", description: "Comprehensive hardware and OS platform summary", parameters: { type: "object", properties: {} } },
  { name: "verseshell_platform_os", description: "OS version string", parameters: { type: "object", properties: {} } },
  { name: "verseshell_platform_tools", description: "Detect installed developer tools (compilers, runtimes, package managers)", parameters: { type: "object", properties: {} } },
  { name: "verseshell_platform_has_tool", description: "Check if a specific tool is available", parameters: { type: "object", properties: { tool: { type: "string" } }, required: ["tool"] } },

  // ── Files Extended ────────────────────────────────────────────────────
  { name: "verseshell_file_tail", description: "Read last N lines of file", parameters: { type: "object", properties: { path: { type: "string" }, n: { type: "number", description: "Lines (default: 10)" } }, required: ["path"] } },
  { name: "verseshell_file_copy", description: "Copy a file from src to dst", parameters: { type: "object", properties: { src: { type: "string" }, dst: { type: "string" } }, required: ["src", "dst"] } },
  { name: "verseshell_file_move", description: "Move/rename a file from src to dst", parameters: { type: "object", properties: { src: { type: "string" }, dst: { type: "string" } }, required: ["src", "dst"] } },
  { name: "verseshell_file_mkdir", description: "Create a directory (including parents)", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "verseshell_file_pwd", description: "Get current working directory", parameters: { type: "object", properties: {} } },

  // ── Git ───────────────────────────────────────────────────────────────
  { name: "verseshell_git_status", description: "Git working tree status", parameters: { type: "object", properties: {} } },
  { name: "verseshell_git_branch", description: "Current git branch name", parameters: { type: "object", properties: {} } },
  { name: "verseshell_git_log", description: "Git commit log", parameters: { type: "object", properties: {} } },
  { name: "verseshell_git_diff", description: "Git working tree diff", parameters: { type: "object", properties: {} } },

  // ── Archive ───────────────────────────────────────────────────────────
  { name: "verseshell_tar_create", description: "Create a tar archive", parameters: { type: "object", properties: { archive: { type: "string" }, sources: { type: "array", items: { type: "string" } } }, required: ["archive", "sources"] } },
  { name: "verseshell_tar_extract", description: "Extract a tar archive", parameters: { type: "object", properties: { archive: { type: "string" }, dest: { type: "string", description: "Extract destination (default: .)" } }, required: ["archive"] } },
  { name: "verseshell_zip_create", description: "Create a zip archive", parameters: { type: "object", properties: { archive: { type: "string" }, sources: { type: "array", items: { type: "string" } } }, required: ["archive", "sources"] } },
  { name: "verseshell_zip_extract", description: "Extract a zip archive", parameters: { type: "object", properties: { archive: { type: "string" }, dest: { type: "string", description: "Extract destination (default: .)" } }, required: ["archive"] } },

  // ── Crypto Extended ───────────────────────────────────────────────────
  { name: "verseshell_crypto_base64_encode", description: "Base64 encode data", parameters: { type: "object", properties: { data: { type: "string" } }, required: ["data"] } },
  { name: "verseshell_crypto_base64_decode", description: "Base64 decode data", parameters: { type: "object", properties: { data: { type: "string" } }, required: ["data"] } },

  // ── HTTP Extended ─────────────────────────────────────────────────────
  { name: "verseshell_http_json_post", description: "HTTP POST with JSON content-type, returns parsed JSON", parameters: { type: "object", properties: { url: { type: "string" }, data: { type: "object" } }, required: ["url", "data"] } },

  // ── Sys Extended ──────────────────────────────────────────────────────
  { name: "verseshell_sys_env", description: "Get all environment variables", parameters: { type: "object", properties: {} } },
  { name: "verseshell_sys_load_avg", description: "Get system load average (1/5/15 min)", parameters: { type: "object", properties: {} } },

  // ── Clipboard ─────────────────────────────────────────────────────────
  { name: "verseshell_clipboard_read", description: "Read text from the clipboard", parameters: { type: "object", properties: {} } },
  { name: "verseshell_clipboard_write", description: "Write text to the clipboard", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
];

// The MCP catalog is a capability-filtered compatibility view. Internal
// foundation callers never consume this list; they use the typed facade.
const TOOLS = filterTools(ALL_TOOLS, MCP_POLICY);

// ── Tool → Command Mapping ────────────────────────────────────────────
//
// Tools marked with `__special__: true` in the map value are handled by
// the tool dispatcher directly rather than via a single ae eval call.
// This covers health (local metadata), transpile_bash (ae -b one-shot),
// and list_commands (parallel arr.keys() across modules).

const SPECIAL_HANDLERS = {
  verseshell_health: "health",
  verseshell_transpile_bash: "transpile_bash",
  verseshell_list_commands: "list_commands",
};

const COMMAND_MAP = {
  "verseshell_sys_info": 'sys.info()',
  "verseshell_sys_cpu": 'sys.cpu_info()',
  "verseshell_sys_memory": 'sys.mem_info()',
  "verseshell_sys_disk": 'sys.disk_info()',
  "verseshell_sys_hostname": 'sys.hostname()',
  "verseshell_sys_process": (args) => `sys.process_info(${args.pid})`,
  "verseshell_file_ls": (args) => `file.ls(${aeString(normalizeToolPath(args.path || "."))})`,
  "verseshell_file_stat": (args) => `file.stat(${aeString(normalizeToolPath(args.path))})`,
  "verseshell_file_read": (args) => `file.read(${aeString(normalizeToolPath(args.path))})`,
  "verseshell_file_write": (args) => `file.write(${aeString(normalizeToolPath(args.path))}, ${JSON.stringify(args.content)})`,
  "verseshell_file_exists": (args) => `file.exists(${aeString(normalizeToolPath(args.path))})`,
  "verseshell_file_grep": (args) => `file.grep(${aeString(args.pattern)}, ${aeString(normalizeToolPath(args.path))})`,
  "verseshell_file_head": (args) => `file.head(${aeString(normalizeToolPath(args.path))}, ${args.n || 10})`,
  "verseshell_arr_pipeline": (args) => args.pipeline,
  "verseshell_json_parse": (args) => `json.parse(${JSON.stringify(args.json)})`,
  "verseshell_json_stringify": (args) => `json.stringify(${args.value})`,
  "verseshell_win_registry": (args) => `win.registry_get(${aeString(args.key)}, ${aeString(args.value || "ProductName")})`,
  "verseshell_win_service_list": 'win.service_list()',
  "verseshell_win_service_status": (args) => `win.service_status(${aeString(args.name)})`,
  "verseshell_win_env_path": 'win.env_path()',
  "verseshell_win_is_admin": 'win.is_admin()',
  "verseshell_shell_exec": (args) => shellExecArgv(parseRestrictedArgv(args.argv)),
  "verseshell_process_exec": (args) => shellExecArgv(parseRestrictedArgv([args.program, ...(Array.isArray(args.args) ? args.args : [])])),
  "verseshell_shell_echo": (args) => `shell.echo(${JSON.stringify(args.msg)})`,
  "verseshell_crypto_hash": (args) => `crypto.hash(${aeString(args.data)}, ${aeString(args.algo || "sha256")})`,
  "verseshell_crypto_uuid": 'crypto.uuid()',
  "verseshell_crypto_random": (args) => `crypto.random_bytes(${args.n || 16})`,
  "verseshell_http_get": (args) => `http.get(${aeString(args.url)})`,
  "verseshell_http_post": (args) => `http.post(${aeString(args.url)}, ${JSON.stringify(args.body || "")})`,
  "verseshell_math": (args) => `math.${args.expr}`,
  "verseshell_eval": (args) => args.code,

  // Process Management
  "verseshell_proc_list": "proc.list()",
  "verseshell_proc_info": (args) => `proc.info(${args.pid})`,
  "verseshell_proc_kill": (args) => `proc.kill(${args.pid})`,
  "verseshell_proc_children": (args) => `proc.children(${args.pid})`,
  "verseshell_proc_exists": (args) => `proc.exists(${args.pid})`,

  // Network
  "verseshell_net_interfaces": "net.interfaces()",
  "verseshell_net_ping": (args) => `net.ping(${aeString(args.host)})`,
  "verseshell_net_dns": (args) => `net.dns_lookup(${aeString(args.host)})`,
  "verseshell_net_connections": "net.connections()",
  "verseshell_net_ports": "net.ports()",

  // Hardware
  "verseshell_hw_cpu": "hw.cpu()",
  "verseshell_hw_memory": "hw.memory()",
  "verseshell_hw_disks": "hw.disks()",
  "verseshell_hw_gpus": "hw.gpus()",
  "verseshell_hw_battery": "hw.battery()",

  // Platform
  "verseshell_platform_summary": "platform.hardware_summary()",
  "verseshell_platform_os": "platform.os()",
  "verseshell_platform_tools": "platform.detect_tools()",
  "verseshell_platform_has_tool": (args) => `platform.has_tool(${aeString(args.tool)})`,

  // Files Extended
  "verseshell_file_tail": (args) => `file.tail(${aeString(normalizeToolPath(args.path))}, ${args.n || 10})`,
  "verseshell_file_copy": (args) => `file.copy(${aeString(normalizeToolPath(args.src))}, ${aeString(normalizeToolPath(args.dst))})`,
  "verseshell_file_move": (args) => `file.move(${aeString(normalizeToolPath(args.src))}, ${aeString(normalizeToolPath(args.dst))})`,
  "verseshell_file_mkdir": (args) => `file.mkdir(${aeString(normalizeToolPath(args.path))})`,
  "verseshell_file_pwd": "file.pwd()",

  // Git
  "verseshell_git_status": "git.status()",
  "verseshell_git_branch": "git.branch()",
  "verseshell_git_log": "git.log()",
  "verseshell_git_diff": "git.diff()",

  // Archive
  "verseshell_tar_create": (args) => `archive.tar_create(${aeString(normalizeToolPath(args.archive))}, [${args.sources.map((s) => aeString(s)).join(", ")}])`,
  "verseshell_tar_extract": (args) => `archive.tar_extract(${aeString(normalizeToolPath(args.archive))}, ${aeString(normalizeToolPath(args.dest || "."))})`,
  "verseshell_zip_create": (args) => `archive.zip_create(${aeString(normalizeToolPath(args.archive))}, [${args.sources.map((s) => aeString(s)).join(", ")}])`,
  "verseshell_zip_extract": (args) => `archive.zip_extract(${aeString(normalizeToolPath(args.archive))}, ${aeString(normalizeToolPath(args.dest || "."))})`,

  // Crypto Extended
  "verseshell_crypto_base64_encode": (args) => `crypto.base64_encode(${aeString(args.data)})`,
  "verseshell_crypto_base64_decode": (args) => `crypto.base64_decode(${aeString(args.data)})`,

  // HTTP Extended
  "verseshell_http_json_post": (args) => `http.json_post(${aeString(args.url)}, ${JSON.stringify(args.data)})`,

  // Sys Extended
  "verseshell_sys_env": "sys.env_all()",
  "verseshell_sys_load_avg": "sys.load_avg()",

  // Clipboard
  "verseshell_clipboard_read": "clip.read()",
  "verseshell_clipboard_write": (args) => `clip.write(${aeString(args.text)})`,
};

// ── MCP Server ────────────────────────────────────────────────────────

async function main() {
  console.error(`[verseshell-mcp] VerseShell MCP Server v${MCP_SERVER_VERSION}`);
  console.error(`[verseshell-mcp] AE_PATH: ${AE_PATH}`);
  console.error(`[verseshell-mcp] WORKSPACE: ${WORKSPACE}`);
  console.error(`[verseshell-mcp] Protocol: ${USE_COMPACT ? "compact" : "json"} | Caps: ${CAPS}`);

  startAeShell();

  const server = new Server(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const toolArgs = args || {};

    try {
      assertToolAllowed(name, MCP_POLICY);
    } catch (error) {
      return {
        content: [{ type: "text", text: JSON.stringify(toolErrorPayload(error, name)) }],
        isError: true,
      };
    }

    // ── Special handlers (aligned with verseshell v0.3.0 ae-mcp) ──────────
    if (SPECIAL_HANDLERS[name]) {
      try {
        const handlerResult = await runSpecialHandler(SPECIAL_HANDLERS[name], toolArgs);
        return {
          content: [{ type: "text", text: typeof handlerResult === "string" ? handlerResult : JSON.stringify(handlerResult, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: JSON.stringify(toolErrorPayload(e, name)) }],
          isError: true,
        };
      }
    }

    const cmdBuilder = COMMAND_MAP[name];

    if (!cmdBuilder) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        isError: true,
      };
    }

    const cmd = typeof cmdBuilder === "function" ? cmdBuilder(toolArgs) : cmdBuilder;

    try {
      const result = await sendRequest(cmd, toolArgs.timeoutMs);

      if (result.ok) {
        return {
          content: [{ type: "text", text: JSON.stringify(result.value, null, 2) }],
        };
      } else {
        // Smart hint: catch common LLM API mistakes to save retry tokens.
        const errMsg = result.error?.message || "";
        const hint = suggestHint(cmd, errMsg);
        const payload = toolErrorPayload(result.error, name);
        if (hint) payload.hint = hint;
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          isError: true,
        };
      }
    } catch (e) {
      const hint = suggestHint(cmd, e?.message || "");
      const payload = toolErrorPayload(e, name);
      if (hint) payload.hint = hint;
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[verseshell-mcp] MCP server ready (stdio transport)");
}

// ── Special Tool Handlers ─────────────────────────────────────────────
//
// These three handlers mirror verseshell v0.3.0's native ae-mcp tools:
// health, transpile_bash, list_commands. They are dispatched directly
// rather than via a single ae eval call.

async function runSpecialHandler(kind, args) {
  switch (kind) {
    case "health":
      return healthPayload();

    case "transpile_bash": {
      const bashCode = String(args.bash_code ?? "");
      if (!bashCode) {
        const err = new Error("Missing 'bash_code' argument");
        err.code = "E_ARG";
        throw err;
      }
      return transpileBash(bashCode, args.timeoutMs);
    }

    case "list_commands":
      return listCommands();

    default: {
      const err = new Error(`Unknown special handler: ${kind}`);
      err.code = "E_UNKNOWN_HANDLER";
      throw err;
    }
  }
}

function healthPayload() {
  return {
    ok: true,
    server: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
    protocol_version: MCP_PROTOCOL_VERSION,
    runtime_version: RUNTIME_VERSION,
    runtime_server_protocol: RUNTIME_SERVER_PROTOCOL,
    operation_catalog: {
      digest: OPERATION_CATALOG_DIGEST,
      count: OPERATION_CATALOG_COUNT,
    },
    protocol: USE_COMPACT ? "compact" : "json",
    profile: MCP_POLICY.profile,
    capabilities_granted: MCP_POLICY.capabilities,
    agent_mode: true,
    runtime_policy: "agent_strict",
    ae_ready: aeReady,
    tools: TOOLS.length,
    known_modules: KNOWN_MODULES.length,
    mcp_transport: "stdio",
    compatibility_only: true,
  };
}

/**
 * Transpile bash → verseshell via the `ae -b <code>` one-shot CLI flag.
 * The serve protocol does not expose the transpiler as a builtin, so we
 * spawn a one-shot ae process. Mirrors `transpile_bash` in ae-mcp.
 */
async function transpileBash(bashCode, timeoutMs) {
  const effectiveTimeoutMs = clampTimeoutMs(timeoutMs);
  return new Promise((resolve, reject) => {
    const proc = spawn(AE_PATH, ["-b", bashCode], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: WORKSPACE,
      env: sanitizeProcessEnv({
        AETHER_WORKSPACE: WORKSPACE,
        VERSESHELL_WORKSPACE: WORKSPACE,
      }),
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      const err = new Error(`transpile_bash timed out after ${effectiveTimeoutMs}ms`);
      err.code = "E_TIMEOUT";
      err.timedOut = true;
      reject(err);
    }, effectiveTimeoutMs + 250);

    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        const err = new Error(`transpile_bash failed (exit ${code}): ${stderr.trim()}`);
        err.code = "E_TRANSPILE";
        err.exitCode = code;
        err.stderr = stderr;
        reject(err);
      }
    });

    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/**
 * List all available verseshell builtins grouped by module.
 * Sends parallel `arr.keys(<module>)` requests for each known module
 * and aggregates the results. Missing modules are silently skipped
 * (their request returns an error which we ignore).
 *
 * Mirrors the external compatibility `list_commands` surface.
 */
async function listCommands() {
  const results = await Promise.all(
    KNOWN_MODULES.map(async (modName) => {
      try {
        const r = await sendRequest(`arr.keys(${modName})`, 10_000);
        if (r.ok && Array.isArray(r.value)) {
          return { module: modName, fns: r.value };
        }
        return null;
      } catch {
        return null;
      }
    })
  );
  const present = results.filter(Boolean);
  const totalFns = present.reduce((acc, r) => acc + r.fns.length, 0);
  return {
    modules: present,
    module_count: present.length,
    total_functions: totalFns,
    note: "Use verseshell_eval with module.function(args) syntax to call any listed function.",
  };
}

main().catch((e) => {
  console.error(`[verseshell-mcp] Fatal: ${e.message}`);
  process.exit(1);
});
