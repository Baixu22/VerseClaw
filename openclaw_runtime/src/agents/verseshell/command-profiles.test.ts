import { describe, expect, it } from "vitest";
import {
  hasExplicitVerseShellSyntax,
  getVerseShellCommandProfileDefinition,
  inferVerseShellCommandProfile,
  isExplicitVerseShellInterpreter,
  resolveVerseShellCommandPlan,
  VerseShellCommandPlanError,
} from "./command-profiles.js";

function expectPlanError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(VerseShellCommandPlanError);
    expect((error as VerseShellCommandPlanError).code).toBe(code);
    return;
  }
  expect.unreachable("expected VerseShellCommandPlanError " + code);
}

describe("VerseShell argv-only command profiles", () => {
  it.each([
    ["pnpm test", "test"],
    ["npm run build", "build"],
    ["corepack pnpm lint", "lint"],
    ["git status --short", "git"],
    ["pytest -q", "test"],
    ["cargo clippy --workspace", "lint"],
    ["npm test", "test"],
    ["pnpm run test", "test"],
    ["pnpm build", "build"],
    ["yarn lint --fix", "lint"],
    ["bun test --watch", "test"],
    ["corepack pnpm test", "test"],
    ["pnpm exec vitest run", "test"],
    ["npm exec eslint .", "lint"],
    ["pnpm exec tsc --noEmit", "build"],
    ["pnpm dlx prettier --check .", "lint"],
    ["pnpm exec cargo build", "generic"],
  ])("infers %s as %s", (command, profile) => {
    const argv = command.split(" ");
    expect(inferVerseShellCommandProfile(argv)).toBe(profile);
  });

  it("keeps ordinary commands direct even when shell selection is present in the environment", () => {
    const plan = resolveVerseShellCommandPlan({
      command: "pnpm test",
      cwd: "C:\\repo with spaces\\项目",
      env: { VERSESHELL_OS_SHELL: "powershell" },
      platform: "win32",
    });
    expect(plan).toMatchObject({ mode: "argv", profile: "test" });
    expect(plan.argv.at(-1)).toBe("test");
    expect(plan.argv[0]?.toLowerCase()).toMatch(/(?:^|[\\/])pnpm$/u);
    expect(plan.argv.some((entry) => /(?:cmd|powershell|bash|sh)/iu.test(entry))).toBe(false);
  });

  it("uses the policy segment effective argv and keeps executable identity", () => {
    const plan = resolveVerseShellCommandPlan({
      command: "git status",
      segments: [{
        raw: "git status",
        argv: ["git", "status"],
        resolution: {
          policyBlocked: false,
          effectiveArgv: ["C:\\Program Files\\Git\\cmd\\git.exe", "status"],
          execution: { resolvedPath: "C:\\Program Files\\Git\\cmd\\git.exe" },
        } as never,
      }],
      platform: "win32",
    });
    expect(plan).toMatchObject({
      mode: "argv",
      profile: "git",
      argv: ["C:\\Program Files\\Git\\cmd\\git.exe", "status"],
      resolvedExecutable: "C:\\Program Files\\Git\\cmd\\git.exe",
    });
  });

  it("does not silently convert shell syntax into direct argv", () => {
    expect(hasExplicitVerseShellSyntax("pnpm test && git status", "win32")).toBe(true);
    const plan = resolveVerseShellCommandPlan({
      command: "pnpm test && git status",
      cwd: "C:\\repo",
      platform: "win32",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    });
    expect(plan.mode).toBe("explicit-shell");
    expect(plan.profile).toBe("terminal-shell");
    expect(plan.argv.slice(0, 3)).toEqual(["C:\\Windows\\System32\\cmd.exe", "/D", "/C"]);
  });

  it("recognizes explicit interpreter argv only at the shell boundary", () => {
    expect(isExplicitVerseShellInterpreter(["powershell", "-NoProfile", "-Command", "git status"])).toBe(true);
    expect(isExplicitVerseShellInterpreter(["pnpm", "run", "build"])).toBe(false);
  });

  it("keeps cwd/env/output/write policy host-owned and bounded", () => {
    const build = getVerseShellCommandProfileDefinition("build");
    expect(build).toMatchObject({
      cwdPolicy: "workspace-relative",
      envPolicy: "host-sanitized",
      writePolicy: "deny-unless-policy",
    });
    expect(build.maxTimeoutMs).toBeGreaterThan(0);
    expect(build.maxOutputBytes).toBeGreaterThan(0);
    expect(build.declaredWriteDirs).toContain("dist");
    expect(() => resolveVerseShellCommandPlan({
      command: "pnpm build",
      cwd: "C:\\repo\0bad",
      platform: "win32",
    })).toThrow(/cwd|NUL/u);
    expect(() => resolveVerseShellCommandPlan({
      command: "pnpm build",
      cwd: "C:\\repo",
      env: Object.fromEntries(Array.from({ length: 513 }, (_, index) => [`K${index}`, "x"])),
      platform: "win32",
    })).toThrow(/environment/u);
  });

  it.each([
    ["C:\\repo with spaces\\tool.exe", ["C:\\repo with spaces\\tool.exe", "--name", "项目"]],
    ["C:\\repo\\tool.com", ["C:\\repo\\tool.com", "--compact", "x"]],
  ])("preserves Windows PE executable path %s as direct argv data", (command, argv) => {
    const plan = resolveVerseShellCommandPlan({ command, argv, platform: "win32", allowExplicitShell: false });
    expect(plan.mode).toBe("argv");
    expect(plan.argv).toEqual(argv);
    expect(plan).toMatchObject({ resolvedExecutable: command });
    expect(plan.interpreterProfile).toBeUndefined();
  });

  it.each([
    ["C:\\repo\\tool.cmd", ["C:\\repo\\tool.cmd", "--value", "x"]],
    ["C:\\repo\\tool.bat", ["C:\\repo\\tool.bat", "--value", "x"]],
  ])("keeps batch script %s as data under an audited cmd.exe profile", (script, argv) => {
    const plan = resolveVerseShellCommandPlan({
      command: script,
      argv,
      platform: "win32",
      allowExplicitShell: false,
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe", PATH: "C:\\Windows\\System32" },
    });
    expect(plan.mode).toBe("argv");
    expect(plan.argv).toEqual(argv);
    expect(plan.argv[0]).toBe(script);
    expect(plan).toMatchObject({
      executable: script,
      resolvedExecutable: script,
      resolvedScript: script,
      interpreter: "C:\\Windows\\System32\\cmd.exe",
      interpreterProfile: "windows-cmd",
    });
  });
});

describe("VerseShell Windows batch interpreter identity", () => {
  it("derives cmd.exe from SystemRoot when ComSpec is absent", () => {
    const plan = resolveVerseShellCommandPlan({
      argv: ["C:\\repo\\run.bat", "x"],
      platform: "win32",
      allowExplicitShell: false,
      env: { SystemRoot: "C:\\Windows", PATH: "C:\\Windows\\System32" },
    });
    expect(plan.interpreter).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(plan.interpreterProfile).toBe("windows-cmd");
  });

  it.each([
    ["no ComSpec or SystemRoot", {}, "E_VERSESHELL_INTERPRETER_IDENTITY"],
    ["a bare interpreter name", { ComSpec: "cmd.exe" }, "E_VERSESHELL_INTERPRETER_IDENTITY"],
    ["a NUL interpreter path", { ComSpec: "C:\\Windows\\cmd.exe\0" }, "E_VERSESHELL_ENV_INVALID"],
  ])("fails closed when given %s", (_label, env, code) => {
    expectPlanError(
      () => resolveVerseShellCommandPlan({
        argv: ["C:\\repo\\run.cmd", "x"],
        platform: "win32",
        allowExplicitShell: false,
        env: { PATH: "C:\\Windows\\System32", ...env },
      }),
      code,
    );
  });

  it("fails closed when a batch script has no resolved path identity", () => {
    expectPlanError(
      () => resolveVerseShellCommandPlan({
        argv: ["build.cmd", "x"],
        platform: "win32",
        allowExplicitShell: false,
        env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      }),
      "E_VERSESHELL_SCRIPT_IDENTITY",
    );
  });
});

describe("VerseShell pre-approval analysis resolution matrix", () => {
  it("keeps a PATHEXT-resolved .exe as direct argv without a shell interpreter", () => {
    const resolved = "C:\\Program Files\\Git\\cmd\\git.exe";
    const plan = resolveVerseShellCommandPlan({
      command: "git status",
      segments: [{
        raw: "git status",
        argv: ["git", "status"],
        resolution: {
          policyBlocked: false,
          effectiveArgv: [resolved, "status"],
          execution: { resolvedPath: resolved },
        } as never,
      }],
      platform: "win32",
    });
    expect(plan).toMatchObject({
      mode: "argv",
      profile: "git",
      argv: [resolved, "status"],
      resolvedExecutable: resolved,
    });
    expect(plan.interpreterProfile).toBeUndefined();
  });

  it("turns a resolved pnpm.cmd shim into an audited windows-cmd plan", () => {
    const script = "C:\\Program Files\\nodejs\\pnpm.cmd";
    const plan = resolveVerseShellCommandPlan({
      command: "pnpm test",
      segments: [{
        raw: "pnpm test",
        argv: ["pnpm", "test"],
        resolution: {
          policyBlocked: false,
          effectiveArgv: [script, "test"],
          execution: { resolvedPath: script },
        } as never,
      }],
      platform: "win32",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    });
    expect(plan).toMatchObject({
      mode: "argv",
      profile: "test",
      argv: [script, "test"],
      resolvedScript: script,
      interpreter: "C:\\Windows\\System32\\cmd.exe",
      interpreterProfile: "windows-cmd",
    });
  });

  it("fails closed when the policy analysis blocks the segment", () => {
    expectPlanError(
      () => resolveVerseShellCommandPlan({
        command: "rm -rf out",
        segments: [{
          raw: "rm -rf out",
          argv: ["rm", "-rf", "out"],
          resolution: { policyBlocked: true } as never,
        }],
        platform: "win32",
      }),
      "E_VERSESHELL_COMMAND_PLAN",
    );
  });
});

describe("VerseShell explicit shell boundary", () => {
  it("rejects an explicit interpreter argv when the shell profile is disabled", () => {
    expectPlanError(
      () => resolveVerseShellCommandPlan({
        command: "bash -lc echo hi",
        argv: ["bash", "-lc", "echo hi"],
        platform: "win32",
        allowExplicitShell: false,
      }),
      "E_VERSESHELL_SHELL_EXPLICIT",
    );
  });

  it("rejects a Windows shell builtin argv when the shell profile is disabled", () => {
    expectPlanError(
      () => resolveVerseShellCommandPlan({
        command: "echo hello",
        argv: ["echo", "hello"],
        platform: "win32",
        allowExplicitShell: false,
      }),
      "E_VERSESHELL_SHELL_EXPLICIT",
    );
  });

  it.each([
    ["pipeline", "a | b"],
    ["chain", "a && b"],
    ["or chain", "a || b"],
    ["separator", "a; b"],
    ["redirect", "a > b"],
    ["input redirect", "a < b"],
    ["stderr redirect", "a 2>&1"],
    ["heredoc", "cat <<EOF"],
    ["inline evaluation", "echo $(date)"],
    ["backtick evaluation", "echo `date`"],
    ["variable expansion", "echo $HOME"],
  ])("detects %s as explicit shell syntax", (_label, command) => {
    expect(hasExplicitVerseShellSyntax(command, "linux")).toBe(true);
  });

  it("does not flag ordinary commands or quoted shell tokens", () => {
    expect(hasExplicitVerseShellSyntax("pnpm test", "win32")).toBe(false);
    expect(hasExplicitVerseShellSyntax("git status --short", "win32")).toBe(false);
    expect(hasExplicitVerseShellSyntax('echo "a && b"', "win32")).toBe(false);
  });

  it("treats %% variable pairs as syntax only on win32", () => {
    expect(hasExplicitVerseShellSyntax("echo %PATH%", "win32")).toBe(true);
    expect(hasExplicitVerseShellSyntax("echo %PATH%", "linux")).toBe(false);
    expect(hasExplicitVerseShellSyntax("echo 100% done", "win32")).toBe(false);
  });
});

describe("VerseShell bounded plan inputs", () => {
  it("rejects an empty cwd", () => {
    expectPlanError(
      () => resolveVerseShellCommandPlan({ command: "pnpm test", cwd: "", platform: "win32" }),
      "E_VERSESHELL_CWD_INVALID",
    );
  });

  it("rejects argv beyond the item bound", () => {
    expectPlanError(
      () => resolveVerseShellCommandPlan({
        command: "tool",
        argv: Array.from({ length: 257 }, (_, index) => "a" + index),
        platform: "win32",
      }),
      "E_VERSESHELL_ARGV_BOUNDS",
    );
  });

  it("rejects an oversized single argument", () => {
    expectPlanError(
      () => resolveVerseShellCommandPlan({
        command: "tool.exe",
        argv: ["tool.exe", "a".repeat(64 * 1024 + 1)],
        platform: "win32",
        allowExplicitShell: false,
      }),
      "E_VERSESHELL_ARGV_BOUNDS",
    );
  });

  it("rejects a NUL argument", () => {
    expectPlanError(
      () => resolveVerseShellCommandPlan({
        command: "tool.exe",
        argv: ["tool.exe", "a\0b"],
        platform: "win32",
        allowExplicitShell: false,
      }),
      "E_VERSESHELL_ARGV_INVALID",
    );
  });

  it("rejects a NUL environment value", () => {
    expectPlanError(
      () => resolveVerseShellCommandPlan({
        command: "pnpm test",
        cwd: "C:\\repo",
        env: { BAD: "x\0y" },
        platform: "win32",
      }),
      "E_VERSESHELL_ENV_INVALID",
    );
  });

  it("rejects oversized environment bytes", () => {
    expectPlanError(
      () => resolveVerseShellCommandPlan({
        command: "pnpm test",
        cwd: "C:\\repo",
        env: { BIG: "x".repeat(300 * 1024) },
        platform: "win32",
      }),
      "E_VERSESHELL_ENV_BOUNDS",
    );
  });
});
