import { describe, expect, it } from "vitest";
import { sanitizeExecApprovalWarningText } from "../../infra/exec-approval-command-display.js";
import { resolveVerseShellCommandPlan } from "./command-profiles.js";
import {
  VERSESHELL_EXTERNAL_WRITE_WARNING_TEXT,
  appendVerseShellExternalWriteWarning,
  resolveVerseShellExternalWritePolicy,
} from "./external-write-policy.js";

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

describe("VerseShell external-write policy", () => {
  it.each([
    ["pnpm run build", "compiler"],
    ["pnpm test", "compiler"],
    ["pnpm lint", "compiler"],
  ])("classifies %s as an external compiler write", (command, trigger) => {
    expect(planFor(command).externalWritePolicy).toMatchObject({
      effectLevel: "external-write",
      trigger,
      rollbackClaim: false,
    });
  });

  it("classifies direct script execution as an external script write", () => {
    expect(planFor("node script.js").externalWritePolicy).toMatchObject({
      effectLevel: "external-write",
      trigger: "script",
      rollbackClaim: false,
    });
  });

  it("classifies mutating Git commands, including hook-triggering commits, as external writes", () => {
    expect(planFor("git commit -m test").externalWritePolicy).toMatchObject({
      effectLevel: "external-write",
      trigger: "git-hook",
      rollbackClaim: false,
    });
  });

  it.each([
    "git diff --output=C:\\tmp\\diff.patch",
    "git log -o C:\\tmp\\log.txt",
    "git diff --ext-diff",
    "git --config-env=alias.status=GIT_CONFIG_VALUE status",
    "git --git-dir=C:\\repo\\.git status",
  ])("fails closed for Git invocation %s", (command) => {
    expect(planFor(command).externalWritePolicy).toMatchObject({
      effectLevel: "external-write",
      trigger: "git-hook",
      rollbackClaim: false,
    });
  });

  it("fails closed for a Git alias override before command parsing", () => {
    expect(
      resolveVerseShellExternalWritePolicy({
        profile: "git",
        argv: ["git", "-c", "alias.status=!sh", "status"],
      }),
    ).toMatchObject({ effectLevel: "external-write", trigger: "git-hook" });
  });

  it("classifies explicit terminal-shell payloads as external writes", () => {
    expect(planFor("bash -lc echo hi").externalWritePolicy).toMatchObject({
      effectLevel: "external-write",
      trigger: "terminal-shell",
      rollbackClaim: false,
    });
  });

  it.each([
    "git status --short",
    "git -C C:\\repo diff",
    "git --version",
    "git -C C:\\repo --version",
    "git branch --show-current",
    "git tag --list",
    "git config --get user.name",
    "git remote -v",
    "git remote",
    "git grep foo",
    "rg pattern",
    "head -n 5 README.md",
    "tail -n 5 README.md",
    "wc -l README.md",
    "stat README.md",
    "file README.md",
  ])("does not claim %s as an external process write", (command) => {
    expect(planFor(command).externalWritePolicy).toEqual({
      effectLevel: "none",
      trigger: "none",
      rollbackClaim: false,
    });
  });

  it.each([
    "find . -delete",
    "rg --pre=sh pattern",
    "rg --pre-glob=*.md pattern",
    "C:\\repo\\cat.cmd README.md",
  ])("classifies write-capable read-like invocation %s as an external write", (command) => {
    expect(planFor(command).externalWritePolicy).toMatchObject({
      effectLevel: "external-write",
      trigger: command.startsWith("C:\\repo\\cat.cmd") ? "script" : "generic",
      rollbackClaim: false,
    });
  });

  it("classifies all find write predicates as external writes", () => {
    for (const predicate of [
      "-exec",
      "-execdir",
      "-fprint",
      "-fprint0",
      "-fprintf",
      "-fls",
      "-ok",
      "-okdir",
    ]) {
      expect(
        resolveVerseShellExternalWritePolicy({
          profile: "generic",
          argv: ["find", ".", predicate, "value"],
        }),
      ).toMatchObject({ effectLevel: "external-write", trigger: "generic" });
    }
    expect(
      resolveVerseShellExternalWritePolicy({
        profile: "generic",
        argv: ["find", ".", "-exec=sh -c echo {}"],
      }),
    ).toMatchObject({ effectLevel: "external-write", trigger: "generic" });
  });

  it("uses a static warning that cannot leak command content", () => {
    const command = "node C:\\Users\\private\\secret-script.js --token sk-test-value";
    const policy = resolveVerseShellExternalWritePolicy({
      profile: "generic",
      argv: ["node", "C:\\Users\\private\\secret-script.js", "--token", "sk-test-value"],
    });
    expect(policy.warningText).toBe(VERSESHELL_EXTERNAL_WRITE_WARNING_TEXT);
    expect(policy.warningText).not.toContain("private");
    expect(policy.warningText).not.toContain("secret-script");
    expect(policy.warningText).not.toContain("sk-test-value");
    expect(command.length).toBeGreaterThan(0);
  });

  it("appends one deduplicated warning and survives the approval sanitizer", () => {
    const plan = planFor("pnpm run build");
    const warnings: string[] = ["existing warning"];
    appendVerseShellExternalWriteWarning(warnings, plan);
    appendVerseShellExternalWriteWarning(warnings, plan);
    expect(warnings).toEqual(["existing warning", VERSESHELL_EXTERNAL_WRITE_WARNING_TEXT]);
    expect(sanitizeExecApprovalWarningText(warnings.join("\n"))).toContain(
      VERSESHELL_EXTERNAL_WRITE_WARNING_TEXT,
    );
  });

  it("ignores a dynamic warning supplied by the plan", () => {
    const warnings: string[] = [];
    appendVerseShellExternalWriteWarning(warnings, {
      externalWritePolicy: {
        effectLevel: "external-write",
        trigger: "generic",
        rollbackClaim: false,
        warningText: "attacker-controlled command and secret",
      },
    });
    expect(warnings).toEqual([VERSESHELL_EXTERNAL_WRITE_WARNING_TEXT]);
    expect(warnings.join("\n")).not.toContain("attacker-controlled");
  });

  it("does not append a warning for read-only plans", () => {
    const warnings: string[] = [];
    appendVerseShellExternalWriteWarning(warnings, planFor("git status --short"));
    expect(warnings).toEqual([]);
  });
});
