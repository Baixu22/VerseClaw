export const MCP_PROFILES = Object.freeze(["product", "development"]);

// These names are the only capabilities the compatibility adapter may accept.
// `all` and wildcard grants are intentionally not valid configuration values.
export const MCP_CAPABILITIES = Object.freeze([
  "catalog.read",
  "compat.transpile",
  "crypto.hash",
  "crypto.random",
  "db.read",
  "db.write",
  "file.delete",
  "file.read",
  "file.lock",
  "file.write",
  "file.watch",
  "health.read",
  "git.read",
  "git.write",
  "net.dns",
  "net.http.delete",
  "net.http.get",
  "net.http.post",
  "net.ping",
  "proc.kill",
  "proc.list",
  "proc.spawn",
  "shell.exec",
  "sys.env",
  "sys.read",
  "sys.uptime",
  "win.admin",
  "win.env",
  "win.registry",
  "win.service",
]);

const CAPABILITY_SET = new Set(MCP_CAPABILITIES);

export class McpPolicyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "McpPolicyError";
    this.code = code;
    Object.assign(this, details);
  }
}

export function parseCapabilityList(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return [];
  const values = String(raw)
    .split(/[\s,]+/u)
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.some((value) => value === "all" || value === "*")) {
    throw new McpPolicyError("E_CAPABILITY_CONFIG", "Wildcard capability grants are forbidden; enumerate capabilities.");
  }
  const unknown = values.filter((value) => !CAPABILITY_SET.has(value));
  if (unknown.length > 0) {
    throw new McpPolicyError(
      "E_CAPABILITY_CONFIG",
      `Unknown capability: ${unknown[0]}`,
      { unknown_capabilities: unknown },
    );
  }
  return [...new Set(values)];
}

export function resolveMcpPolicy({ profile = "product", caps, env = process.env } = {}) {
  const normalizedProfile = String(profile || "product").trim().toLowerCase();
  if (!MCP_PROFILES.includes(normalizedProfile)) {
    throw new McpPolicyError("E_PROFILE_CONFIG", `Unknown MCP profile: ${normalizedProfile}`);
  }
  const rawCaps = caps ?? env.VERSESHELL_CAPS;
  const capabilities = parseCapabilityList(rawCaps);
  if (normalizedProfile === "product" && capabilities.includes("compat.transpile")) {
    throw new McpPolicyError(
      "E_PROFILE_CONFIG",
      "transpile compatibility is development-only and cannot be enabled in the product profile.",
    );
  }
  return Object.freeze({
    profile: normalizedProfile,
    capabilities: Object.freeze(capabilities),
    development: normalizedProfile === "development",
  });
}

export function isDevelopmentOnlyTool(name) {
  return name === "verseshell_eval" || name === "verseshell_shell_exec";
}

// File mutation and external side effects remain outside the P1 compatibility
// boundary. Their capability names are retained for forward-compatible config
// parsing, but no current MCP tool may publish them.
const DEFERRED_EFFECTFUL_TOOLS = new Set([
  "verseshell_file_write",
  "verseshell_file_copy",
  "verseshell_file_move",
  "verseshell_file_mkdir",
  "verseshell_tar_create",
  "verseshell_tar_extract",
  "verseshell_zip_create",
  "verseshell_zip_extract",
  "verseshell_clipboard_write",
]);

export function isDeferredEffectfulTool(name) {
  return DEFERRED_EFFECTFUL_TOOLS.has(name);
}

export function requiredCapability(name) {
  if (name === "verseshell_health") return null;
  if (name === "verseshell_transpile_bash") return "compat.transpile";
  if (name === "verseshell_list_commands") return "catalog.read";
  if (name === "verseshell_eval") return "shell.exec";
  if (name === "verseshell_shell_exec" || name === "verseshell_process_exec") return "shell.exec";

  if (/^verseshell_file_(read|ls|stat|exists|grep|head|tail|pwd)$/u.test(name)) return "file.read";
  if (/^verseshell_file_(write|copy|move|mkdir)$/u.test(name)) return "file.write";
  if (/^verseshell_sys_(info|cpu|memory|disk|hostname|process)$/u.test(name)) return "sys.read";
  if (name === "verseshell_sys_env") return "sys.env";
  if (name === "verseshell_sys_load_avg") return "sys.uptime";
  if (name === "verseshell_win_registry") return "win.registry";
  if (/^verseshell_win_service_/u.test(name)) return "win.service";
  if (name === "verseshell_win_env_path") return "win.env";
  if (name === "verseshell_win_is_admin") return "win.admin";
  if (/^verseshell_proc_(list|info|children|exists)$/u.test(name)) return "proc.list";
  if (name === "verseshell_proc_kill") return "proc.kill";
  if (name === "verseshell_net_ping") return "net.ping";
  if (name === "verseshell_net_dns") return "net.dns";
  if (/^verseshell_http_get$/u.test(name)) return "net.http.get";
  if (/^verseshell_http_(post|json_post)$/u.test(name)) return "net.http.post";
  if (name === "verseshell_crypto_hash") return "crypto.hash";
  if (name === "verseshell_crypto_random") return "crypto.random";
  if (/^verseshell_git_/u.test(name)) return "git.read";
  return undefined;
}

export function isToolAllowed(name, policy) {
  if (isDeferredEffectfulTool(name)) return false;
  if (isDevelopmentOnlyTool(name) && !policy.development) return false;
  const capability = requiredCapability(name);
  return capability === null || (capability !== undefined && policy.capabilities.includes(capability));
}

export function assertToolAllowed(name, policy) {
  if (isDeferredEffectfulTool(name)) {
    throw new McpPolicyError("E_PROFILE_DENY", `${name} is deferred until the governed write boundary is available.`);
  }
  if (isDevelopmentOnlyTool(name) && !policy.development) {
    throw new McpPolicyError("E_PROFILE_DENY", `${name} is available only in the development MCP profile.`);
  }
  const capability = requiredCapability(name);
  if (capability === undefined) {
    throw new McpPolicyError("E_TOOL_DENY", `Unknown compatibility tool: ${name}`);
  }
  if (capability !== null && !policy.capabilities.includes(capability)) {
    throw new McpPolicyError("E_CAPABILITY_DENY", `${name} requires capability ${capability}.`, {
      required_capability: capability,
    });
  }
  return capability;
}

export function filterTools(tools, policy) {
  return tools.filter((tool) => isToolAllowed(tool.name, policy));
}

function rejectUnsafeText(value, label) {
  if (value.includes("\0")) throw new McpPolicyError("E_ARG", `${label} contains a NUL byte.`);
  if (/[\r\n;&|<>`]/u.test(value)) {
    throw new McpPolicyError("E_ARG", `${label} contains shell metacharacters; provide explicit argv.`);
  }
}

export function parseRestrictedArgv(input) {
  if (Array.isArray(input)) {
    if (input.length === 0 || input.length > 64) {
      throw new McpPolicyError("E_ARG", "argv must contain between 1 and 64 items.");
    }
    return input.map((value, index) => {
      if (typeof value !== "string" || value.length === 0 || value.length > 8192) {
        throw new McpPolicyError("E_ARG", `argv[${index}] must be a non-empty string of at most 8192 bytes.`);
      }
      rejectUnsafeText(value, `argv[${index}]`);
      return value;
    });
  }
  if (typeof input !== "string" || input.trim() === "") {
    throw new McpPolicyError("E_ARG", "An explicit argv array or restricted command string is required.");
  }
  rejectUnsafeText(input, "command");
  const argv = [];
  let token = "";
  let quote = null;
  let escaping = false;
  for (const char of input.trim()) {
    if (escaping) {
      token += char;
      escaping = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else token += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      if (token) {
        argv.push(token);
        token = "";
      }
      continue;
    }
    token += char;
  }
  if (escaping || quote) throw new McpPolicyError("E_ARG", "command contains an unterminated escape or quote.");
  if (token) argv.push(token);
  return parseRestrictedArgv(argv);
}
