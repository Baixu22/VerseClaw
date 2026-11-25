const normalizeLowercaseStringOrEmpty = (value: string | undefined): string => value?.trim().toLowerCase() ?? "";

const READ_ONLY_SHELL_COMMANDS = new Set([
  "cat",
  "file",
  "grep",
  "head",
  "ls",
  "pwd",
  "rg",
  "stat",
  "tail",
  "wc",
]);

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "diff",
  "grep",
  "log",
  "ls-files",
  "rev-parse",
  "show",
  "status",
]);

const READ_ONLY_GH_PR_SUBCOMMANDS = new Set(["checks", "diff", "list", "status", "view"]);
const READ_ONLY_GH_ISSUE_SUBCOMMANDS = new Set(["list", "status", "view"]);

const UNSAFE_RG_FLAGS = new Set(["--pre", "--pre-glob", "--hostname-bin"]);
const UNSAFE_GIT_FLAGS = new Set(["--ext-diff", "--output", "-o", "--open-files-in-pager"]);

/** Git global flags that consume the next token as their value, so that value
 * is not mistaken for the subcommand (`git -C /repo status`). */
const GIT_GLOBAL_FLAGS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
  "--exec-path",
]);

/** Git global flags that make any subcommand unsafe: `-c`/`--config-env` can
 * point core.pager, core.editor or alias.* at an arbitrary command,
 * `--exec-path` redirects git's own helper binaries, and
 * `-C`/`--git-dir`/`--work-tree`/`--namespace` move the operation off the
 * intended repository. Read-only-looking subcommands behind these must not be
 * treated as read-only. Case matters: `-c` sets config, `-C` changes directory. */
const UNSAFE_GIT_GLOBAL_FLAGS = new Set([
  "-c",
  "-C",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
  "--exec-path",
]);

export function readShellCommand(record: Record<string, unknown> | undefined): string | undefined {
  const command = record?.command ?? record?.cmd;
  if (typeof command !== "string") {
    return undefined;
  }
  const trimmed = command.trim();
  return trimmed || undefined;
}

function tokenizeSimpleShellCommand(command: string): string[] | undefined {
  if (/[;&|<>\n\r`]/.test(command) || command.includes("$(") || command.includes("\\")) {
    return undefined;
  }
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  for (const char of command) {
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote) {
    return undefined;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens.length > 0 ? tokens : undefined;
}

function isReadOnlySedCommand(tokens: readonly string[]): boolean {
  const args = tokens.slice(1);
  if (args.some((token) => token === "--in-place" || token.startsWith("--in-place="))) {
    return false;
  }
  if (args.some((token) => token.startsWith("-") && token !== "-" && token.includes("i"))) {
    return false;
  }
  // `sed -e 'w /tmp/out'` and mixed scripts are easy to misclassify. Only
  // allow the simple line-print shape that agents use for file inspection.
  if (args.some((token) => token === "-e" || token === "--expression")) {
    return false;
  }
  let sawSuppressAutoPrint = false;
  let expression: string | undefined;
  for (const token of args) {
    if (token === "--in-place" || token.startsWith("--in-place=")) {
      return false;
    }
    if (token === "--quiet" || token === "--silent") {
      sawSuppressAutoPrint = true;
      continue;
    }
    if (token.startsWith("-") && token !== "-") {
      if (token.includes("i")) {
        return false;
      }
      if (token.includes("n")) {
        sawSuppressAutoPrint = true;
      }
      continue;
    }
    expression ??= token;
    break;
  }
  return sawSuppressAutoPrint && expression != null && /^(\d+|\$)(,(\d+|\$))?p$/.test(expression);
}

function hasUnsafeRipgrepFlag(tokens: readonly string[]): boolean {
  return tokens.some((token) => {
    return UNSAFE_RG_FLAGS.has(normalizeLowercaseStringOrEmpty(token).split("=", 1)[0]);
  });
}

function hasUnsafeGitFlag(tokens: readonly string[]): boolean {
  return tokens.some((token) => {
    const normalized = normalizeLowercaseStringOrEmpty(token);
    return (
      UNSAFE_GIT_FLAGS.has(normalized) ||
      token.startsWith("-O") ||
      normalized.startsWith("--output=") ||
      normalized.startsWith("--open-files-in-pager=")
    );
  });
}

/** Resolve the real git subcommand, skipping global flags and their values.
 * Returns `unsafeFlag` when the invocation carries a flag that makes any
 * subcommand unsafe, so the caller fails closed instead of reading tokens[1]
 * and trusting a read-only-looking name. */
function resolveGitSubcommand(
  tokens: readonly string[],
): { subcommand: string; index: number } | { unsafeFlag: true } | undefined {
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    // Everything after `--` is a pathspec, so no subcommand follows.
    if (token === "--") {
      return undefined;
    }
    if (token.startsWith("-")) {
      const bare = token.includes("=") ? token.slice(0, token.indexOf("=")) : token;
      if (UNSAFE_GIT_GLOBAL_FLAGS.has(bare) || /^-[cC]/.test(token)) {
        return { unsafeFlag: true };
      }
      if (!token.includes("=") && GIT_GLOBAL_FLAGS_WITH_VALUE.has(token)) {
        index += 1;
      }
      continue;
    }
    return { subcommand: normalizeLowercaseStringOrEmpty(token), index };
  }
  return undefined;
}

function isReadOnlyGitCommand(tokens: readonly string[]): boolean {
  if (hasUnsafeGitFlag(tokens)) {
    return false;
  }
  const resolved = resolveGitSubcommand(tokens);
  if (!resolved || "unsafeFlag" in resolved) {
    return false;
  }
  const { subcommand, index } = resolved;
  if (READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
    return true;
  }
  const rest = tokens.slice(index + 1);
  return subcommand === "remote" && rest.length === 1 && rest[0] === "-v";
}

function isReadOnlyGhCommand(tokens: readonly string[]): boolean {
  if (
    tokens.some((token) => {
      const normalized = normalizeLowercaseStringOrEmpty(token);
      return (
        normalized === "--web" ||
        normalized.startsWith("--web=") ||
        /^-[a-z]*w[a-z]*(?:=.*)?$/.test(normalized)
      );
    })
  ) {
    return false;
  }
  const area = normalizeLowercaseStringOrEmpty(tokens[1]);
  const action = normalizeLowercaseStringOrEmpty(tokens[2]);
  if (area === "search") {
    return action.length > 0;
  }
  if (area === "pr") {
    return READ_ONLY_GH_PR_SUBCOMMANDS.has(action);
  }
  if (area === "issue") {
    return READ_ONLY_GH_ISSUE_SUBCOMMANDS.has(action);
  }
  return false;
}

export function isPlainReadOnlyShellCommand(command: string | undefined): boolean {
  if (!command) {
    return false;
  }
  const tokens = tokenizeSimpleShellCommand(command);
  if (!tokens) {
    return false;
  }
  const executable = normalizeLowercaseStringOrEmpty(tokens[0]);
  if (
    executable === "file" &&
    tokens.slice(1).some((token) => token.startsWith("--co") || /^-[^-]*C/.test(token))
  )
    return false;
  if (executable === "rg" && hasUnsafeRipgrepFlag(tokens)) {
    return false;
  }
  if (READ_ONLY_SHELL_COMMANDS.has(executable)) {
    return true;
  }
  if (executable === "sed") {
    return isReadOnlySedCommand(tokens);
  }
  if (executable === "git") {
    return isReadOnlyGitCommand(tokens);
  }
  if (executable === "gh") {
    return isReadOnlyGhCommand(tokens);
  }
  return false;
}

const READ_ONLY_TASK_TOOLS = new Set([
  "read", "grep", "glob", "find", "ls", "web_search", "web_fetch", "memory_search", "memory_get",
  "sessions_list", "sessions_history", "sessions_yield", "get_goal", "task_control",
  "read_file", "read_files", "search_content", "result_query", "list_directory",
  "context_read", "context_search", "memory_query", "memory_recall",
]);

export function isReadOnlyTaskTool(toolName: string, args?: unknown): boolean {
  const name = toolName.trim().toLowerCase();
  const record = args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : undefined;
  if (READ_ONLY_TASK_TOOLS.has(name)) return true;
  if (name === "session_status") return record?.model === undefined;
  if (name === "exec" || name === "bash") return isPlainReadOnlyShellCommand(readShellCommand(record));
  const action = typeof record?.action === "string" ? record.action.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (name === "process") return ["list", "poll", "log"].includes(action);
  if (name === "subagents") return ["list", "info"].includes(action);
  return false;
}
