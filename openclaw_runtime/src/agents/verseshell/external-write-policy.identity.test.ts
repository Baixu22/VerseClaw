import { describe, expect, it } from "vitest";
import { resolveVerseShellCommandPlan } from "./command-profiles.js";
import { resolveVerseShellExternalWritePolicy } from "./external-write-policy.js";

function planFor(command: string) {
  return resolveVerseShellCommandPlan({
    command,
    cwd: "C:\\repo",
    platform: "win32",
    env: {
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      SystemRoot: "C:\\Windows",
      PATH: "C:\\Windows\\System32;C:\\Program Files\\nodejs",
    },
  });
}

function policyFor(command: string) {
  return planFor(command).externalWritePolicy;
}

const NONE = { effectLevel: "none", trigger: "none", rollbackClaim: false };

/**
 * Every expectation below was measured against real git 2.51.0.windows.1 in a
 * throwaway repository: the "writes" cases exit 0 and change config/refs, and
 * the "reads" cases exit 0 without mutating anything.
 */
describe("VerseShell external-write policy: mutating Git that reads as read-only", () => {
  it.each([
    // git rejects --list/--get combined with --add, but accepts --show-scope,
    // so a read flag in argv[0] position cannot vouch for the invocation.
    "git config --show-scope --add diff.external payload",
    "git config --show-scope --replace-all diff.external payload",
    "git config --show-origin --unset-all core.pager",
    "git config --add core.pager payload",
    "git config --unset-all core.pager",
    "git config --replace-all core.pager payload",
    "git config --remove-section probe",
    "git config --rename-section probe other",
    "git config --edit",
    // The two-positional form writes with no flag at all.
    "git config core.pager payload",
    // git >= 2.46 subcommand spellings.
    "git config set core.pager payload",
    "git config unset core.pager",
    "git config edit",
  ])("classifies %s as an external write", (command) => {
    expect(policyFor(command)).toMatchObject({
      effectLevel: "external-write",
      trigger: "git-hook",
      rollbackClaim: false,
    });
  });

  it.each([
    "git config --get user.name",
    "git config --get-all user.name",
    "git config --get-regexp user",
    "git config --list",
    "git config --show-scope --list",
    "git config --show-scope --get user.name",
    "git config --show-origin --get user.name",
    "git config --name-only --list",
    "git config --type=bool --get core.bare",
    "git config --global --get user.name",
    "git config get user.name",
    "git config list",
  ])("does not claim read-only config %s as a write", (command) => {
    expect(policyFor(command)).toEqual(NONE);
  });

  it("treats an unrecognized config flag as a write rather than assuming it reads", () => {
    expect(policyFor("git config --future-flag --get user.name")).toMatchObject({
      effectLevel: "external-write",
      trigger: "git-hook",
    });
  });
});

describe("VerseShell external-write policy: Git ref listing versus mutation", () => {
  it.each([
    "git branch --list feat-x",
    "git branch -v",
    "git branch -vv",
    "git branch -a",
    "git branch -r",
    "git branch --show-current",
    "git branch --sort=-committerdate",
    "git branch --merged HEAD",
    "git branch --contains HEAD",
    "git tag -l v1",
    "git tag --list v1",
    "git tag -n",
    "git tag -n3",
    "git tag --sort=v:refname",
    "git tag --points-at HEAD",
  ])("does not claim ref listing %s as a write", (command) => {
    expect(policyFor(command)).toEqual(NONE);
  });

  it("recognizes a --format listing that the win32 plan builder rejects for %", () => {
    // `%` is an unsupported Windows shell token, so this form only reaches the
    // classifier through an already-planned argv.
    expect(
      resolveVerseShellExternalWritePolicy({
        profile: "git",
        argv: ["git", "branch", "--format=%(refname)"],
        sourceExecutable: "git",
      }),
    ).toEqual(NONE);
  });

  it.each([
    // A bare positional creates a ref, so it must never ride the list allowlist.
    "git branch newbranch",    "git tag newtag",
    "git branch -d nope",
    "git branch -D nope",
    "git branch -m old new",
    "git branch --set-upstream-to=origin/main",
    "git branch --unset-upstream",
    "git branch --edit-description",
    "git tag -d nope",
    "git tag -a v1 -m msg",
    "git tag -f v1",
  ])("classifies ref mutation %s as an external write", (command) => {
    expect(policyFor(command)).toMatchObject({
      effectLevel: "external-write",
      trigger: "git-hook",
    });
  });
});

describe("VerseShell external-write policy: Git global flag scope", () => {
  it.each([
    // These retarget config, hooks, or the object store before the subcommand runs.
    "git -c alias.status=x status",
    "git -c core.pager=x diff",
    "git --git-dir=C:\\repo\\.git status",
    "git --work-tree=C:\\other status",
    "git --namespace=x status",
    "git --exec-path=C:\\evil status",
    "git --config-env=alias.status=VAR status",
  ])("fails closed for pre-subcommand override %s", (command) => {
    expect(policyFor(command)).toMatchObject({
      effectLevel: "external-write",
      trigger: "git-hook",
    });
  });

  it.each([
    // Same spellings after the subcommand are that subcommand's read-only
    // arguments; scanning all of argv made these false positives.
    "git rev-parse --git-dir",
    "git rev-parse --show-toplevel",
    "git ls-files --exclude-standard",
  ])("does not claim post-subcommand argument %s as a write", (command) => {
    expect(policyFor(command)).toEqual(NONE);
  });

  it.each([
    "git ls-remote",
    "git ls-tree HEAD",
    "git shortlog",
    "git whatchanged",
  ])("recognizes additional read-only subcommand %s", (command) => {
    expect(policyFor(command)).toEqual(NONE);
  });
});

describe("VerseShell external-write policy: executable identity", () => {
  it.each([
    // The profile is inferred from the basename, so a batch file named `git`
    // would otherwise inherit the Git read-only branch while cmd.exe runs it.
    ["C:\\evil\\git.cmd status", "script"],
    ["C:\\evil\\git.bat status", "script"],
    ["C:\\repo\\cat.cmd README.md", "script"],
    ["C:\\repo\\deploy.sh", "script"],
    ["C:\\repo\\task.ps1", "script"],
  ])("classifies script payload %s as an external write", (command, trigger) => {
    expect(policyFor(command)).toMatchObject({ effectLevel: "external-write", trigger });
  });

  it("keeps the audited windows-cmd interpreter and the script classification together", () => {
    const plan = planFor("C:\\evil\\git.cmd status");
    expect(plan.interpreterProfile).toBe("windows-cmd");
    expect(plan.externalWritePolicy).toMatchObject({
      effectLevel: "external-write",
      trigger: "script",
    });
  });

  it.each([
    // A read-only claim keyed on a basename would let any binary borrow it.
    "C:\\evil\\grep.exe pattern",
    "C:\\evil\\cat.exe README.md",
    "C:\\evil\\rg.exe pattern",
    "C:\\evil\\find.exe .",
    "/tmp/evil/grep pattern",
  ])("refuses a read-only claim for path-specified executable %s", (command) => {
    expect(policyFor(command)).toMatchObject({
      effectLevel: "external-write",
      trigger: "generic",
    });
  });

  it("still classifies a path-specified git by its Git argv", () => {
    expect(policyFor("C:\\evil\\git.exe status")).toMatchObject({
      effectLevel: "external-write",
      trigger: "git-hook",
    });
  });

  it("keeps the read-only claim when host PATH resolution rewrites argv[0]", () => {
    // The plan carries the operator's bare command name separately from the
    // resolved absolute path, so resolution does not revoke the claim.
    expect(
      resolveVerseShellExternalWritePolicy({
        profile: "generic",
        argv: ["C:\\Program Files\\Git\\usr\\bin\\grep.exe", "pattern"],
        sourceExecutable: "grep",
      }),
    ).toEqual(NONE);
  });

  it("rejects a source executable that disagrees with the resolved binary", () => {
    expect(
      resolveVerseShellExternalWritePolicy({
        profile: "generic",
        argv: ["C:\\evil\\payload.exe", "pattern"],
        sourceExecutable: "grep",
      }),
    ).toMatchObject({ effectLevel: "external-write", trigger: "generic" });
  });
});

describe("VerseShell external-write policy: read-only tools with command flags", () => {
  it.each([
    // ripgrep runs the value of both of these as a command.
    "rg --pre=sh pattern",
    "rg --pre sh pattern",
    "rg --pre-glob=*.md pattern",
    "rg --hostname-bin=cmd pattern",
    "rg --hostname-bin cmd pattern",
    "find . -delete",
    "find . -exec sh -c payload",
  ])("classifies command-capable read tool %s as an external write", (command) => {
    expect(policyFor(command)).toMatchObject({
      effectLevel: "external-write",
      trigger: "generic",
    });
  });

  it.each(["rg pattern", "find . -name x", "grep -r pattern .", "wc -l README.md"])(
    "does not claim plain read invocation %s as a write",
    (command) => {
      expect(policyFor(command)).toEqual(NONE);
    },
  );
});
