#!/usr/bin/env node
/**
 * VerseShell MCP Server — bridges VerseShell (ae --serve) to MCP-compatible AI agents.
 *
 * Usage:
 *   node verseshell-mcp-server.js [--ae-path <path>] [--workspace <dir>]
 *
 * The server spawns `ae --serve --json` as a child process and forwards
 * MCP tool calls to it via JSON-RPC over stdin/stdout.
 *
 * Configure in ClawX's openclaw.json:
 *   "mcp": { "servers": { "verseshell": {
 *     "command": "node",
 *     "args": ["resources/verseshell-mcp/src/index.js", "--ae-path", "./verseshell/ae"]
 *   }}}
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

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────

const AE_PATH = process.argv.includes("--ae-path")
  ? resolve(process.argv[process.argv.indexOf("--ae-path") + 1])
  : resolve(__dirname, "..", "..", "..", "verseshell-runtime", "target", "release", "verseshell.exe") || "verseshell.exe";

const WORKSPACE = process.argv.includes("--workspace")
  ? process.argv[process.argv.indexOf("--workspace") + 1]
  : process.env.VERSESHELL_WORKSPACE || process.cwd();

const AGENT_MODE = process.argv.includes("--agent") || process.env.VERSESHELL_AGENT === "1";
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

function osShellArgv(command) {
  const requested = (process.env.VERSESHELL_OS_SHELL || "").toLowerCase();
  const windowsCmd = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
  if (requested === "git-bash" || requested === "bash") {
    return ["C:\\Program Files\\Git\\bin\\bash.exe", "-lc", command];
  }
  if (requested === "powershell") {
    return ["powershell", "-NoProfile", "-Command", command];
  }
  if (requested === "pwsh") {
    return ["pwsh", "-NoProfile", "-Command", command];
  }
  if (requested === "cmd") {
    return [windowsCmd, "/C", command];
  }
  return process.platform === "win32"
    ? [windowsCmd, "/C", command]
    : ["sh", "-lc", command];
}

function toolErrorPayload(error, cmd) {
  return {
    error: error?.message || String(error),
    code: error?.code,
    timed_out: error?.timedOut === true,
    timeoutMs: error?.timeoutMs,
    serverRestarted: error?.serverRestarted,
    cmd,
  };
}

// ── VerseShell Process Manager ────────────────────────────────────────

let aeProcess = null;
let responseResolvers = new Map();
let requestId = 0;
let aeReady = false;
const readyWaiters = [];

function startAeShell() {
  const args = ["--serve", "--json"];
  if (AGENT_MODE) args.push("--agent");
  if (WORKSPACE) args.push("--workspace", WORKSPACE);

  console.error(`[verseshell-mcp] Starting: ${AE_PATH} ${args.join(" ")}`);

  aeProcess = spawn(AE_PATH, args, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: WORKSPACE,
    env: sanitizeProcessEnv({
      AETHER_WORKSPACE: WORKSPACE,
      VERSESHELL_WORKSPACE: WORKSPACE,
    }),
    windowsHide: true,
  });

  const rl = createInterface({ input: aeProcess.stdout });

  rl.on("line", (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg.type === "done" && responseResolvers.has(msg.id)) {
        const { resolve, timer } = responseResolvers.get(msg.id);
        clearTimeout(timer);
        responseResolvers.delete(msg.id);
        resolve({ ok: msg.ok !== false, value: msg.value, error: msg.error, meta: msg.meta });
      }
      // Check if this is the first response (server ready)
      if (!aeReady) {
        aeReady = true;
        readyWaiters.forEach((r) => r());
        readyWaiters.length = 0;
        console.error(`[verseshell-mcp] VerseShell server ready`);
      }
    } catch (e) {
      console.error(`[verseshell-mcp] Parse error: ${e.message}`);
    }
  });

  aeProcess.stderr.on("data", (data) => {
    const text = data.toString().trim();
    if (text) console.error(`[verseshell-mcp] ae: ${text}`);
  });

  aeProcess.on("close", (code) => {
    console.error(`[verseshell-mcp] VerseShell exited (code=${code}). Restarting in 1s...`);
    aeReady = false;
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
  if (aeReady) return;
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

// ── Tool Definitions ──────────────────────────────────────────────────

const TOOLS = [
  // System
  { name: "verseshell_sys_info", description: "Get system info (OS, arch, CPU, memory, disks, load)", parameters: { type: "object", properties: {} } },
  { name: "verseshell_sys_cpu", description: "Get CPU info: name, cores, frequency", parameters: { type: "object", properties: {} } },
  { name: "verseshell_sys_memory", description: "Get memory info: total, free, available bytes", parameters: { type: "object", properties: {} } },
  { name: "verseshell_sys_disk", description: "Get disk info: filesystem, size, used, available", parameters: { type: "object", properties: {} } },
  { name: "verseshell_sys_hostname", description: "Get system hostname", parameters: { type: "object", properties: {} } },
  { name: "verseshell_sys_process", description: "Get detailed process info by PID", parameters: { type: "object", properties: { pid: { type: "number", description: "Process ID" } }, required: ["pid"] } },

  // Files
  { name: "verseshell_file_ls", description: "List directory contents with metadata (structured)", parameters: { type: "object", properties: { path: { type: "string", description: "Directory path (default: .)" } } } },
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
  { name: "verseshell_shell_exec", description: "Execute an OS shell script (structured output: stdout, stderr, exit_code). On Windows defaults to cmd /C; set VERSESHELL_OS_SHELL=git-bash|cmd|powershell|pwsh to choose.", parameters: { type: "object", properties: { cmd: { type: "string", description: "Shell command to execute" }, command: { type: "string", description: "Alias for cmd" }, timeoutMs: { type: "number", description: "Optional MCP-side timeout in milliseconds (default 30000)." } } } },
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
];

// ── Tool → Command Mapping ────────────────────────────────────────────

const COMMAND_MAP = {
  "verseshell_sys_info": 'sys.info()',
  "verseshell_sys_cpu": 'sys.cpu_info()',
  "verseshell_sys_memory": 'sys.mem_info()',
  "verseshell_sys_disk": 'sys.disk_info()',
  "verseshell_sys_hostname": 'sys.hostname()',
  "verseshell_sys_process": (args) => `sys.process_info(${args.pid})`,
  "verseshell_file_ls": (args) => `file.ls(${aeString(normalizeToolPath(args.path || "."))})`,
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
  "verseshell_shell_exec": (args) => shellExecArgv(osShellArgv(args.command ?? args.cmd)),
  "verseshell_process_exec": (args) => shellExecArgv([args.program, ...(Array.isArray(args.args) ? args.args : [])]),
  "verseshell_shell_echo": (args) => `shell.echo(${JSON.stringify(args.msg)})`,
  "verseshell_crypto_hash": (args) => `crypto.hash(${aeString(args.data)}, ${aeString(args.algo || "sha256")})`,
  "verseshell_crypto_uuid": 'crypto.uuid()',
  "verseshell_crypto_random": (args) => `crypto.random_bytes(${args.n || 16})`,
  "verseshell_http_get": (args) => `http.get(${aeString(args.url)})`,
  "verseshell_http_post": (args) => `http.post(${aeString(args.url)}, ${JSON.stringify(args.body || "")})`,
  "verseshell_math": (args) => `math.${args.expr}`,
  "verseshell_eval": (args) => args.code,
};

// ── MCP Server ────────────────────────────────────────────────────────

async function main() {
  console.error(`[verseshell-mcp] VerseShell MCP Server v0.3.1`);
  console.error(`[verseshell-mcp] AE_PATH: ${AE_PATH}`);
  console.error(`[verseshell-mcp] WORKSPACE: ${WORKSPACE}`);

  startAeShell();

  const server = new Server(
    { name: "verseshell", version: "0.3.1" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const cmdBuilder = COMMAND_MAP[name];

    if (!cmdBuilder) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        isError: true,
      };
    }

    const toolArgs = args || {};
    const cmd = typeof cmdBuilder === "function" ? cmdBuilder(toolArgs) : cmdBuilder;

    try {
      const result = await sendRequest(cmd, toolArgs.timeoutMs);

      if (result.ok) {
        return {
          content: [{ type: "text", text: JSON.stringify(result.value, null, 2) }],
        };
      } else {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: result.error, cmd }),
          }],
          isError: true,
        };
      }
    } catch (e) {
      return {
        content: [{ type: "text", text: JSON.stringify(toolErrorPayload(e, cmd)) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[verseshell-mcp] MCP server ready (stdio transport)");
}

main().catch((e) => {
  console.error(`[verseshell-mcp] Fatal: ${e.message}`);
  process.exit(1);
});
