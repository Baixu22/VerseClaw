import {
  analyzeShellCommand,
  resolvePlannedSegmentArgv,
  type ExecCommandAnalysis,
  type ExecCommandSegment,
} from "../../infra/exec-approvals-analysis.js";
import { resolveExplicitVerseShellCommandArgv } from "./shell-command.js";

export const VERSESHELL_COMMAND_PROFILE_IDS = [
  "generic",
  "test",
  "build",
  "lint",
  "git",
  "terminal-shell",
] as const;

export type VerseShellCommandProfile = (typeof VERSESHELL_COMMAND_PROFILE_IDS)[number];
export type VerseShellCommandPlanMode = "argv" | "explicit-shell";

export type VerseShellCommandProfileDefinition = {
  id: VerseShellCommandProfile;
  maxTimeoutMs: number;
  maxOutputBytes: number;
  cwdPolicy: "workspace-relative";
  envPolicy: "host-sanitized";
  /** Classification only; P2-02 does not grant write authority. */
  writePolicy: "deny-unless-policy" | "external-write-visible";
  declaredWriteDirs: readonly string[];
};

/**
 * Host-owned execution identity. It is derived from OpenClaw's policy analysis
 * and is never accepted as a model-provided profile or interpreter choice.
 */
export type VerseShellCommandPlan = {
  mode: VerseShellCommandPlanMode;
  profile: VerseShellCommandProfile;
  argv: string[];
  displayCommand: string;
  executable: string;
  resolvedExecutable?: string;
  /** Canonical script identity retained when Windows executes a batch shim. */
  resolvedScript?: string;
  interpreter?: string;
  /** Runtime-owned interpreter path for an audited Windows batch payload. */
  interpreterProfile?: "windows-cmd";
  profileDefinition: VerseShellCommandProfileDefinition;
};

export class VerseShellCommandPlanError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VerseShellCommandPlanError";
  }
}

const SHELL_EXECUTABLES = new Set([
  "bash",
  "cmd",
  "fish",
  "ksh",
  "powershell",
  "pwsh",
  "sh",
  "zsh",
  "git-bash",
]);
const WINDOWS_SHELL_BUILTINS = new Set([
  "call",
  "cd",
  "copy",
  "del",
  "dir",
  "echo",
  "erase",
  "exit",
  "for",
  "if",
  "md",
  "mkdir",
  "move",
  "rd",
  "ren",
  "rmdir",
  "set",
  "shift",
  "start",
  "type",
]);

const TEST_RUNNERS = new Set(["jest", "mocha", "pytest", "vitest", "ava", "go", "cargo", "dotnet"]);
const BUILD_RUNNERS = new Set(["build", "make", "ninja", "vite", "tsc", "cargo", "go", "dotnet"]);
const LINT_RUNNERS = new Set(["eslint", "oxlint", "biome", "prettier", "ruff", "clippy", "cargo"]);
const PACKAGE_RUNNERS = new Set(["npm", "pnpm", "yarn", "bun", "corepack"]);

const MAX_ARGC = 256;
const MAX_ARG_BYTES = 64 * 1024;
const MAX_ENV_KEYS = 512;
const MAX_ENV_BYTES = 256 * 1024;

const PROFILE_DEFINITIONS: Readonly<Record<VerseShellCommandProfile, VerseShellCommandProfileDefinition>> = {
  generic: {
    id: "generic",
    maxTimeoutMs: 10 * 60 * 1000,
    maxOutputBytes: 8 * 1024 * 1024,
    cwdPolicy: "workspace-relative",
    envPolicy: "host-sanitized",
    writePolicy: "deny-unless-policy",
    declaredWriteDirs: [],
  },
  test: {
    id: "test",
    maxTimeoutMs: 30 * 60 * 1000,
    maxOutputBytes: 32 * 1024 * 1024,
    cwdPolicy: "workspace-relative",
    envPolicy: "host-sanitized",
    writePolicy: "deny-unless-policy",
    declaredWriteDirs: [".cache", ".pytest_cache", "coverage", "test-results"],
  },
  build: {
    id: "build",
    maxTimeoutMs: 60 * 60 * 1000,
    maxOutputBytes: 32 * 1024 * 1024,
    cwdPolicy: "workspace-relative",
    envPolicy: "host-sanitized",
    writePolicy: "deny-unless-policy",
    declaredWriteDirs: [".cache", "build", "dist", "out", "target"],
  },
  lint: {
    id: "lint",
    maxTimeoutMs: 20 * 60 * 1000,
    maxOutputBytes: 16 * 1024 * 1024,
    cwdPolicy: "workspace-relative",
    envPolicy: "host-sanitized",
    writePolicy: "deny-unless-policy",
    declaredWriteDirs: [".cache"],
  },
  git: {
    id: "git",
    maxTimeoutMs: 10 * 60 * 1000,
    maxOutputBytes: 16 * 1024 * 1024,
    cwdPolicy: "workspace-relative",
    envPolicy: "host-sanitized",
    writePolicy: "deny-unless-policy",
    declaredWriteDirs: [],
  },
  "terminal-shell": {
    id: "terminal-shell",
    maxTimeoutMs: 30 * 60 * 1000,
    maxOutputBytes: 32 * 1024 * 1024,
    cwdPolicy: "workspace-relative",
    envPolicy: "host-sanitized",
    writePolicy: "external-write-visible",
    declaredWriteDirs: [],
  },
};

export function getVerseShellCommandProfileDefinition(
  profile: VerseShellCommandProfile,
): VerseShellCommandProfileDefinition {
  return PROFILE_DEFINITIONS[profile];
}

function executableBase(value: string | undefined): string {
  const token = value?.trim() ?? "";
  const base = token.split(/[\\/]/u).at(-1)?.toLowerCase() ?? "";
  return base.replace(/\.(?:exe|com|cmd|bat)$/u, "");
}

function executableExtension(value: string | undefined): string {
  const token = value?.trim() ?? "";
  const base = token.split(/[\\/]/u).at(-1)?.toLowerCase() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

function isWindowsBatchExecutable(value: string | undefined): boolean {
  return executableExtension(value) === ".cmd" || executableExtension(value) === ".bat";
}

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const entry = Object.entries(env).find(([name]) => name.toLowerCase() === key.toLowerCase());
  return entry?.[1];
}

function resolveWindowsCommandInterpreter(env: NodeJS.ProcessEnv): string {
  const interpreter = envValue(env, "ComSpec")?.trim()
    || (envValue(env, "SystemRoot")?.trim()
      ? `${envValue(env, "SystemRoot")!.trim()}\\System32\\cmd.exe`
      : "");
  if (!interpreter || interpreter.includes("\0") || !/[\\/]/u.test(interpreter)) {
    throw new VerseShellCommandPlanError(
      "E_VERSESHELL_INTERPRETER_IDENTITY",
      "Windows batch execution requires an audited absolute ComSpec interpreter path",
    );
  }
  return interpreter;
}

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    if (char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f) return true;
  }
  return false;
}

function displayArgv(argv: readonly string[]): string {
  return argv
    .map((value) => {
      if (value.length === 0) return '""';
      return /[\s"]/u.test(value) || hasControlCharacter(value)
        ? `"${value.replace(/([\\"])/gu, "\\$1")}"`
        : value;
    })
    .join(" ");
}

function normalizeArgv(argv: readonly string[]): string[] {
  if (argv.length === 0 || argv.length > MAX_ARGC) {
    throw new VerseShellCommandPlanError("E_VERSESHELL_ARGV_BOUNDS", "argv item count is outside the profile bound");
  }
  const normalized = argv.map((value, index) => {
    if (typeof value !== "string" || value.includes("\0")) {
      throw new VerseShellCommandPlanError(
        "E_VERSESHELL_ARGV_INVALID",
        `argv[${index}] must be a NUL-free string`,
      );
    }
    if (new TextEncoder().encode(value).byteLength > MAX_ARG_BYTES) {
      throw new VerseShellCommandPlanError(
        "E_VERSESHELL_ARGV_BOUNDS",
        `argv[${index}] exceeds the command profile argument bound`,
      );
    }
    return value;
  });
  if (normalized[0]?.trim().length === 0) {
    throw new VerseShellCommandPlanError("E_VERSESHELL_ARGV_INVALID", "argv executable is empty");
  }
  return normalized;
}

function validateProfileEnvironment(env: NodeJS.ProcessEnv): void {
  const entries = Object.entries(env);
  if (entries.length > MAX_ENV_KEYS) {
    throw new VerseShellCommandPlanError("E_VERSESHELL_ENV_BOUNDS", "environment key count exceeds the profile bound");
  }
  let bytes = 0;
  for (const [key, value] of entries) {
    if (key.includes("\0") || value?.includes("\0")) {
      throw new VerseShellCommandPlanError("E_VERSESHELL_ENV_INVALID", "environment contains a NUL value");
    }
    bytes += new TextEncoder().encode(`${key}=${value ?? ""}`).byteLength;
  }
  if (bytes > MAX_ENV_BYTES) {
    throw new VerseShellCommandPlanError("E_VERSESHELL_ENV_BOUNDS", "environment bytes exceed the profile bound");
  }
}

function validateWorkspaceCwd(cwd: string | undefined): void {
  if (!cwd || cwd.trim().length === 0 || cwd.includes("\0")) {
    throw new VerseShellCommandPlanError("E_VERSESHELL_CWD_INVALID", "command profile requires a NUL-free workspace cwd");
  }
}

function packageRunnerSubcommand(argv: readonly string[]): string {
  const command = executableBase(argv[0]);
  let index = command === "corepack" ? 2 : 1;
  if (command === "corepack" && executableBase(argv[1]) === "") index = 1;
  while (index < argv.length) {
    const token = argv[index]?.trim() ?? "";
    if (!token || token === "--") {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      index += 1;
      continue;
    }
    if (token === "run" || token === "exec" || token === "dlx") {
      index += 1;
      continue;
    }
    return executableBase(token) || token.toLowerCase();
  }
  return "";
}

function classifyPackageRunner(argv: readonly string[]): VerseShellCommandProfile {
  const command = executableBase(argv[0]);
  const subcommand = packageRunnerSubcommand(argv);
  if (subcommand === "test" || subcommand === "check" || subcommand === "spec") return "test";
  if (subcommand === "build" || subcommand === "compile") return "build";
  if (subcommand === "lint" || subcommand === "format" || subcommand === "fmt") return "lint";
  if (command === "corepack" && PACKAGE_RUNNERS.has(executableBase(argv[1]))) {
    return classifyPackageRunner(argv.slice(1));
  }
  // exec/dlx passthrough: classify known single-verb runners. Multi-verb tools
  // (cargo/go/dotnet) stay conservative so a "cargo build" wrapper is never
  // mislabeled as a test profile.
  if (subcommand !== "cargo" && subcommand !== "go" && subcommand !== "dotnet") {
    if (TEST_RUNNERS.has(subcommand)) return "test";
    if (BUILD_RUNNERS.has(subcommand)) return "build";
    if (LINT_RUNNERS.has(subcommand)) return "lint";
  }
  return "generic";
}

/** Infer a host-owned profile from argv; no caller-supplied profile is accepted. */
export function inferVerseShellCommandProfile(argv: readonly string[]): VerseShellCommandProfile {
  const normalized = normalizeArgv(argv);
  const command = executableBase(normalized[0]);
  if (command === "git") return "git";
  if (PACKAGE_RUNNERS.has(command)) return classifyPackageRunner(normalized);
  if (command === "cargo") {
    if (normalized.some((value) => value === "test")) return "test";
    if (normalized.some((value) => value === "build")) return "build";
    if (normalized.some((value) => value === "clippy")) return "lint";
  }
  if (command === "go") {
    if (normalized[1] === "test") return "test";
    if (normalized[1] === "build") return "build";
  }
  if (command === "dotnet") {
    if (normalized[1] === "test") return "test";
    if (normalized[1] === "build") return "build";
  }
  if (TEST_RUNNERS.has(command) || command === "test") return "test";
  if (BUILD_RUNNERS.has(command)) return "build";
  if (LINT_RUNNERS.has(command)) return "lint";
  return "generic";
}

export function isExplicitVerseShellInterpreter(argv: readonly string[]): boolean {
  const command = executableBase(argv[0]);
  if (SHELL_EXECUTABLES.has(command)) return true;
  if (command.endsWith(".exe") && SHELL_EXECUTABLES.has(command.slice(0, -4))) return true;
  return false;
}

function isWindowsShellBuiltin(argv: readonly string[], platform: NodeJS.Platform): boolean {
  if (platform !== "win32") return false;
  const executable = argv[0] ?? "";
  return !/[\\/]/u.test(executable) && WINDOWS_SHELL_BUILTINS.has(executableBase(executable));
}

/** Detect shell syntax outside quotes without interpreting it. */
export function hasExplicitVerseShellSyntax(command: string, platform = process.platform): boolean {
  let single = false;
  let double = false;
  let escaped = false;
  let percentStart = false;
  for (let index = 0; index < command.length; index += 1) {
    const ch = command[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (!single && ch === "\\") {
      escaped = true;
      continue;
    }
    if (!double && ch === "'") {
      single = !single;
      continue;
    }
    if (!single && ch === '"') {
      double = !double;
      continue;
    }
    if (single || double) continue;
    if ("|&;<>\n\r`".includes(ch)) return true;
    if (ch === "$" && /[({A-Za-z_0-9?$]/u.test(command[index + 1] ?? "")) return true;
    if (platform === "win32" && ch === "%") {
      percentStart = !percentStart;
      if (!percentStart) return true;
    }
  }
  return false;
}

function explicitShellPlan(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): VerseShellCommandPlan {
  // The process.start/process.exec request already carries cwd as a typed field.
  // Do not duplicate it as shell source inside the explicit payload.
  const argv = resolveExplicitVerseShellCommandArgv(command, undefined, env, platform);
  const interpreter = executableBase(argv[0]) || undefined;
  const profileDefinition = getVerseShellCommandProfileDefinition("terminal-shell");
  return {
    mode: "explicit-shell",
    profile: "terminal-shell",
    argv,
    displayCommand: command.trim(),
    executable: argv[0] ?? "",
    interpreter,
    profileDefinition,
  };
}

function directArgvPlan(
  argv: readonly string[],
  displayCommand: string | undefined,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): VerseShellCommandPlan {
  const normalized = normalizeArgv(argv);
  const executable = normalized[0] ?? "";
  const profile = inferVerseShellCommandProfile(normalized);
  const profileDefinition = getVerseShellCommandProfileDefinition(profile);
  const isBatch = platform === "win32" && isWindowsBatchExecutable(executable);
  if (isBatch && !/[\\/]/u.test(executable)) {
    throw new VerseShellCommandPlanError(
      "E_VERSESHELL_SCRIPT_IDENTITY",
      "Windows batch execution requires a resolved script path from the approval analysis",
    );
  }
  const interpreter = isBatch ? resolveWindowsCommandInterpreter(env) : undefined;
  return {
    mode: "argv",
    profile,
    argv: normalized,
    displayCommand: displayCommand?.trim() || displayArgv(normalized),
    executable,
    ...(executable.includes("\\") || executable.includes("/")
      ? { resolvedExecutable: executable }
      : {}),
    ...(isBatch
      ? {
          resolvedScript: executable,
          interpreter,
          interpreterProfile: "windows-cmd" as const,
        }
      : {}),
    profileDefinition,
  };
}

export type VerseShellCommandPlanInput = {
  command?: string;
  argv?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Analysis created before approval by OpenClaw. */
  analysis?: ExecCommandAnalysis;
  segments?: readonly ExecCommandSegment[];
  allowExplicitShell?: boolean;
};

/**
 * Build the immutable plan used by the governed VerseShell route. A simple,
 * single-segment command becomes direct argv. Shell syntax is admitted only as
 * an explicit terminal-shell payload and never as an implicit default.
 */
export function resolveVerseShellCommandPlan(input: VerseShellCommandPlanInput): VerseShellCommandPlan {
  const platform = input.platform ?? process.platform;
  const env = input.env ?? process.env;
  validateWorkspaceCwd(input.cwd ?? process.cwd());
  validateProfileEnvironment(env);
  const command = input.command?.trim() ?? "";
  const analysis = input.analysis ?? (command
    ? analyzeShellCommand({ command, cwd: input.cwd, env, platform })
    : undefined);
  const segments = input.segments ?? analysis?.segments;
  const first = segments?.length === 1 ? segments[0] : undefined;
  const explicitByText = command.length > 0 && hasExplicitVerseShellSyntax(command, platform);

  if (input.argv !== undefined) {
    const direct = directArgvPlan(input.argv, command, platform, env);
    if (!isExplicitVerseShellInterpreter(direct.argv) && !isWindowsShellBuiltin(direct.argv, platform) && !explicitByText) return direct;
    if (input.allowExplicitShell !== false && command) return explicitShellPlan(command, env, platform);
    throw new VerseShellCommandPlanError("E_VERSESHELL_SHELL_EXPLICIT", "shell interpreter requires an explicit terminal profile");
  }

  if (first && !explicitByText && !isExplicitVerseShellInterpreter(first.argv) && !isWindowsShellBuiltin(first.argv, platform)) {
    const planned = resolvePlannedSegmentArgv(first);
    if (planned && planned.length > 0) return directArgvPlan(planned, command || first.raw, platform, env);
  }

  const explicitShell = explicitByText || Boolean(
    first && (isExplicitVerseShellInterpreter(first.argv) || isWindowsShellBuiltin(first.argv, platform)),
  );
  if (input.allowExplicitShell !== false && explicitShell && command) {
    return explicitShellPlan(command, env, platform);
  }

  throw new VerseShellCommandPlanError(
    "E_VERSESHELL_COMMAND_PLAN",
    analysis?.reason ?? "command cannot be represented as a bounded argv-only plan",
  );
}
