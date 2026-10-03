/**
 * Read-only Git classification for the external-write policy.
 *
 * Every predicate here answers one question: can this exact argv only read? A
 * flag that is unrecognized, that can write a file, or that can reach a hook or
 * an arbitrary command must fall through to the caller's external-write branch.
 * Measured against git 2.51: the matrix in `external-write-policy.test.ts`
 * records which forms git itself accepts, because git rejects some read/write
 * flag combinations (`--list --add`) but silently accepts others
 * (`--show-scope --add`).
 */

const READ_ONLY_SUBCOMMANDS = new Set([
  "diff",
  "grep",
  "log",
  "ls-files",
  "ls-remote",
  "ls-tree",
  "rev-parse",
  "shortlog",
  "show",
  "status",
  "whatchanged",
]);

const TOP_LEVEL_FLAGS = new Set(["--version"]);

/** `git config` actions that only read. */
const CONFIG_READ_ACTIONS = new Set([
  "--get",
  "--get-all",
  "--get-regexp",
  "--get-urlmatch",
  "--list",
  "-l",
]);

/** `git config <subcommand>` (git >= 2.46) forms that only read. */
const CONFIG_READ_SUBCOMMANDS = new Set(["get", "list"]);

/**
 * `git config` actions that mutate. Enumerated separately from "not a read"
 * so an unrecognized flag is still rejected rather than assumed harmless.
 */
const CONFIG_WRITE_ACTIONS = new Set([
  "--add",
  "--edit",
  "-e",
  "--remove-section",
  "--rename-section",
  "--replace-all",
  "--unset",
  "--unset-all",
]);

const CONFIG_WRITE_SUBCOMMANDS = new Set([
  "edit",
  "remove-section",
  "rename-section",
  "set",
  "unset",
]);

/** Presentation and scope selectors that cannot write on their own. */
const CONFIG_READ_MODIFIERS = new Set([
  "--global",
  "--includes",
  "--local",
  "--name-only",
  "--no-includes",
  "--null",
  "--show-names",
  "--show-origin",
  "--show-scope",
  "--system",
  "--worktree",
  "-z",
]);

const CONFIG_READ_MODIFIER_PREFIXES = ["--blob=", "--default=", "--file=", "--type="];

/** `git branch`/`git tag` flags that only list. */
const REF_LIST_FLAGS = new Set([
  "--all",
  "--column",
  "--ignore-case",
  "--list",
  "--no-column",
  "--omit-empty",
  "--remotes",
  "--show-current",
  "--verbose",
  "-a",
  "-i",
  "-l",
  "-r",
  "-v",
  "-vv",
]);

const REF_LIST_FLAG_PREFIXES = ["--format=", "--sort="];

/** Read-only ref filters that consume the following token as their value. */
const REF_LIST_VALUE_FLAGS = new Set([
  "--contains",
  "--merged",
  "--no-contains",
  "--no-merged",
  "--points-at",
]);

/** `git tag -n[<num>]` only annotates the listing. */
const TAG_LIST_FLAG_PATTERN = /^-n\d*$/u;

const GLOBAL_FLAGS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--config-env",
  "--exec-path",
  "--git-dir",
  "--namespace",
  "--work-tree",
]);

/**
 * Global flags that can redirect config, hooks, or the object store before the
 * subcommand is even parsed, so they defeat any per-subcommand read-only claim.
 */
const UNSAFE_GLOBAL_FLAGS = new Set([
  "-c",
  "--config-env",
  "--exec-path",
  "--git-dir",
  "--namespace",
  "--work-tree",
]);

/** Flags that can write a file or run an external program from any subcommand. */
const UNSAFE_FLAGS = new Set(["--ext-diff", "--open-files-in-pager", "--output", "-o", "-O"]);

function flagName(token: string): string {
  const bare = token.includes("=") ? token.slice(0, token.indexOf("=")) : token;
  return bare.startsWith("--") ? bare.toLowerCase() : bare;
}

function hasReadModifierPrefix(token: string, prefixes: readonly string[]): boolean {
  const normalized = token.toLowerCase();
  return prefixes.some((prefix) => normalized.startsWith(prefix));
}

function subcommandIndex(argv: readonly string[]): number {
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token) continue;
    if (token === "--") return -1;
    if (!token.startsWith("-")) return index;
    if (!token.includes("=") && GLOBAL_FLAGS_WITH_VALUE.has(token)) index += 1;
  }
  return -1;
}

function hasUnsafeFlag(argv: readonly string[]): boolean {
  return argv.some((token) => {
    const normalized = token.toLowerCase();
    const bare = flagName(token);
    return (
      UNSAFE_FLAGS.has(bare) ||
      normalized.startsWith("--output=") ||
      normalized.startsWith("--open-files-in-pager=")
    );
  });
}

/**
 * Scan only the tokens before the subcommand. `git rev-parse --git-dir` asks
 * where the repository is; `git --git-dir=<path> status` retargets it.
 */
function hasUnsafeGlobalFlag(argv: readonly string[], index: number): boolean {
  const globalRegion = index < 0 ? argv.slice(1) : argv.slice(1, index);
  return globalRegion.some((token) => {
    const bare = flagName(token);
    if (bare.startsWith("-c") && !bare.startsWith("--")) return true;
    return UNSAFE_GLOBAL_FLAGS.has(bare.startsWith("--") ? bare.toLowerCase() : bare);
  });
}

function isReadOnlyTopLevelInvocation(argv: readonly string[]): boolean {
  let sawVersion = false;
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    const normalized = token.toLowerCase();
    if (normalized === "--version") {
      sawVersion = true;
      continue;
    }
    if (normalized === "--no-pager") continue;
    if (token === "-C") {
      if (index + 1 >= argv.length) return false;
      index += 1;
      continue;
    }
    if (token.startsWith("-C") && token.length > 2) continue;
    return false;
  }
  return sawVersion;
}

/**
 * `git config` reads only when it names an explicit read action and no write
 * action. The bare `git config <name>` read form is deliberately excluded: it
 * is one positional token away from `git config <name> <value>`, which writes.
 */
function isReadOnlyConfig(rest: readonly string[]): boolean {
  if (rest.length === 0) return false;
  let sawRead = false;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] ?? "";
    const bare = flagName(token).toLowerCase();
    if (index === 0 && CONFIG_WRITE_SUBCOMMANDS.has(bare)) return false;
    if (index === 0 && CONFIG_READ_SUBCOMMANDS.has(bare)) {
      sawRead = true;
      continue;
    }
    if (CONFIG_WRITE_ACTIONS.has(bare)) return false;
    if (CONFIG_READ_ACTIONS.has(bare)) {
      sawRead = true;
      continue;
    }
    if (CONFIG_READ_MODIFIERS.has(bare)) continue;
    if (hasReadModifierPrefix(token, CONFIG_READ_MODIFIER_PREFIXES)) continue;
    // Any other flag is unrecognized; a value is only safe once a read action
    // has already claimed the invocation.
    if (token.startsWith("-")) return false;
  }
  return sawRead;
}

/**
 * `git branch`/`git tag` read only while listing. A bare positional creates a
 * ref, so positionals are admitted solely as an explicit list pattern.
 */
function isReadOnlyRefListing(rest: readonly string[], kind: "branch" | "tag"): boolean {
  let sawListFlag = false;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] ?? "";
    const bare = flagName(token);
    const normalized = bare.toLowerCase();
    if (REF_LIST_VALUE_FLAGS.has(normalized)) {
      if (!token.includes("=")) index += 1;
      sawListFlag = true;
      continue;
    }
    if (REF_LIST_FLAGS.has(normalized)) {
      if (normalized === "--list" || normalized === "-l") sawListFlag = true;
      continue;
    }
    if (kind === "tag" && TAG_LIST_FLAG_PATTERN.test(normalized)) continue;
    if (hasReadModifierPrefix(token, REF_LIST_FLAG_PREFIXES)) continue;
    if (token.startsWith("-")) return false;
    // A positional pattern is a filter only when an explicit list flag is set.
    if (!sawListFlag) return false;
  }
  return true;
}

/** True only when this exact Git argv cannot write, run a hook, or run a command. */
export function isReadOnlyGitInvocation(argv: readonly string[]): boolean {
  if (argv.length < 2 || hasUnsafeFlag(argv)) return false;
  const index = subcommandIndex(argv);
  if (hasUnsafeGlobalFlag(argv, index)) return false;
  if (argv.slice(1).some((token) => TOP_LEVEL_FLAGS.has(token.toLowerCase()))) {
    return isReadOnlyTopLevelInvocation(argv);
  }
  if (index < 0) return false;
  const subcommand = (argv[index] ?? "").toLowerCase();
  const rest = argv.slice(index + 1);
  if (READ_ONLY_SUBCOMMANDS.has(subcommand)) return true;
  if (subcommand === "remote") {
    const flags = rest.map((token) => token.toLowerCase());
    return flags.length === 0 || (flags.length === 1 && flags[0] === "-v");
  }
  if (subcommand === "branch" || subcommand === "tag") {
    return isReadOnlyRefListing(rest, subcommand);
  }
  if (subcommand === "config") return isReadOnlyConfig(rest);
  return false;
}
