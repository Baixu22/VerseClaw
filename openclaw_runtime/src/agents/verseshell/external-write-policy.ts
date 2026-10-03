import type { VerseShellCommandPlan } from "./command-profiles.js";
import { isReadOnlyGitInvocation } from "./external-write-git.js";

export const VERSESHELL_EXTERNAL_WRITE_WARNING_TEXT =
  "External process write: this command may write outside the ClawX write journal; those changes have no automatic rollback.";

export type VerseShellExternalWriteEffectLevel = "none" | "external-write";

export type VerseShellExternalWriteTrigger =
  | "none"
  | "compiler"
  | "script"
  | "git-hook"
  | "terminal-shell"
  | "generic";

export type VerseShellExternalWritePolicy = {
  effectLevel: VerseShellExternalWriteEffectLevel;
  trigger: VerseShellExternalWriteTrigger;
  rollbackClaim: false;
  warningText?: string;
};

const READ_ONLY_COMMANDS = new Set([
  "cat",
  "dir",
  "file",
  "find",
  "findstr",
  "grep",
  "head",
  "ls",
  "pwd",
  "rg",
  "stat",
  "tail",
  "type",
  "where",
  "wc",
]);

const SCRIPT_INTERPRETERS = new Set([
  "bun",
  "deno",
  "node",
  "perl",
  "php",
  "python",
  "python3",
  "ruby",
]);

const FIND_WRITE_PREDICATES = new Set([
  "-delete",
  "-exec",
  "-execdir",
  "-fprint",
  "-fprint0",
  "-fprintf",
  "-fls",
  "-ok",
  "-okdir",
]);

/**
 * Flags whose value ripgrep executes as a command. `--hostname-bin` runs its
 * argument for the `--hostname` replacement, so it is as write-capable as
 * `--pre` despite reading like a diagnostic.
 */
const RG_WRITE_CAPABLE_FLAGS = new Set(["--hostname-bin", "--pre", "--pre-glob"]);

function executableBase(value: string | undefined): string {
  const token = value?.trim() ?? "";
  const base = token.split(/[\\/]/u).at(-1)?.toLowerCase() ?? "";
  return base.replace(/\.(?:exe|com|cmd|bat)$/u, "");
}

function isReadOnlyFind(argv: readonly string[]): boolean {
  return !argv.slice(1).some((token) => {
    const normalized = token.toLowerCase();
    return (
      FIND_WRITE_PREDICATES.has(normalized) ||
      [...FIND_WRITE_PREDICATES].some((predicate) => normalized.startsWith(`${predicate}=`))
    );
  });
}

function isReadOnlyRipgrep(argv: readonly string[]): boolean {
  return !argv.slice(1).some((token) => {
    const normalized = token.toLowerCase();
    const bare = normalized.includes("=")
      ? normalized.slice(0, normalized.indexOf("="))
      : normalized;
    return (
      RG_WRITE_CAPABLE_FLAGS.has(bare) ||
      normalized.startsWith("--pre=") ||
      normalized.startsWith("--pre-glob=")
    );
  });
}

function isScriptPath(value: string | undefined): boolean {
  return /\.(?:bat|cmd|php|pl|ps1|py|rb|sh)$/iu.test(value?.trim() ?? "");
}

function hasPathSeparator(value: string | undefined): boolean {
  return /[\\/]/u.test(value?.trim() ?? "");
}

/**
 * A read-only claim is only as trustworthy as the name it is keyed on.
 * `C:\evil\grep.exe` shares a basename with the real `grep` and nothing else, so
 * the fast paths below require that the operator wrote a bare command name and
 * that host PATH resolution kept the same identity. An explicit path is never
 * granted a read-only claim here; PATH contents themselves remain the safe-bin
 * trust authority's concern, not this classifier's.
 */
function hasTrustedReadOnlyIdentity(
  plan: Pick<VerseShellCommandPlan, "argv" | "sourceExecutable">,
): boolean {
  const source = plan.sourceExecutable?.trim() || plan.argv[0]?.trim() || "";
  if (!source || hasPathSeparator(source)) return false;
  if (isScriptPath(source)) return false;
  const sourceBase = executableBase(source);
  return sourceBase.length > 0 && sourceBase === executableBase(plan.argv[0]);
}

function externalWrite(
  trigger: Exclude<VerseShellExternalWriteTrigger, "none">,
): VerseShellExternalWritePolicy {
  return Object.freeze({
    effectLevel: "external-write",
    trigger,
    rollbackClaim: false,
    warningText: VERSESHELL_EXTERNAL_WRITE_WARNING_TEXT,
  });
}

const NO_EXTERNAL_WRITE: VerseShellExternalWritePolicy = Object.freeze({
  effectLevel: "none",
  trigger: "none",
  rollbackClaim: false,
});

/**
 * Classifies process writes that are outside the ClawX write journal. The
 * policy never grants authority; the existing exec approval pipeline remains
 * the only authorization surface.
 */
export function resolveVerseShellExternalWritePolicy(
  plan: Pick<
    VerseShellCommandPlan,
    "profile" | "argv" | "sourceExecutable" | "resolvedScript" | "interpreterProfile"
  >,
): VerseShellExternalWritePolicy {
  if (plan.profile === "terminal-shell") return externalWrite("terminal-shell");

  // Script identity is decided before the profile, because the profile is
  // inferred from the executable's basename: `C:\evil\git.cmd` infers the `git`
  // profile while actually handing an arbitrary batch file to cmd.exe. A batch
  // payload is a script write no matter which profile its name resembles.
  if (
    plan.interpreterProfile === "windows-cmd" ||
    isScriptPath(plan.resolvedScript) ||
    isScriptPath(plan.argv[0]) ||
    isScriptPath(plan.sourceExecutable)
  ) {
    return externalWrite("script");
  }

  const executable = executableBase(plan.argv[0]);
  const trustedIdentity = hasTrustedReadOnlyIdentity(plan);
  if (plan.profile === "git") {
    return trustedIdentity && isReadOnlyGitInvocation(plan.argv)
      ? NO_EXTERNAL_WRITE
      : externalWrite("git-hook");
  }

  if (plan.profile === "build" || plan.profile === "test" || plan.profile === "lint") {
    return externalWrite("compiler");
  }
  if (SCRIPT_INTERPRETERS.has(executable)) return externalWrite("script");
  if (!trustedIdentity) return externalWrite("generic");
  if (executable === "find") return isReadOnlyFind(plan.argv) ? NO_EXTERNAL_WRITE : externalWrite("generic");
  if (executable === "rg")
    return isReadOnlyRipgrep(plan.argv) ? NO_EXTERNAL_WRITE : externalWrite("generic");
  if (READ_ONLY_COMMANDS.has(executable)) return NO_EXTERNAL_WRITE;
  return externalWrite("generic");
}

/** Append the static external-write warning to the existing exec warning channel. */
export function appendVerseShellExternalWriteWarning(
  warnings: string[],
  plan: Pick<VerseShellCommandPlan, "externalWritePolicy"> | undefined,
): void {
  const warning =
    plan?.externalWritePolicy.effectLevel === "external-write"
      ? VERSESHELL_EXTERNAL_WRITE_WARNING_TEXT
      : undefined;
  if (warning && !warnings.includes(warning)) {
    warnings.push(warning);
  }
}
