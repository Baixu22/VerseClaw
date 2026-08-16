// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  hasExplicitVerseShellSyntax,
  inferVerseShellCommandProfile,
  resolveVerseShellCommandPlan,
} from "../../openclaw_runtime/src/agents/verseshell/command-profiles";

describe("VerseShell P2-02 command profile contract", () => {
  it("keeps the stable model facade independent from host profile inference", () => {
    expect(inferVerseShellCommandProfile(["pnpm", "test"])).toBe("test");
    expect(inferVerseShellCommandProfile(["git", "status"])).toBe("git");
  });

  it("uses direct argv for ordinary package-manager commands on Windows", () => {
    const plan = resolveVerseShellCommandPlan({
      command: "pnpm test",
      cwd: "C:\\repo with spaces\\项目",
      env: { VERSESHELL_OS_SHELL: "powershell" },
      platform: "win32",
    });
    expect(plan.mode).toBe("argv");
    expect(plan.profile).toBe("test");
    expect(plan.argv.at(-1)).toBe("test");
    expect(plan.argv.join(" ")).not.toMatch(/(?:cmd|powershell|bash|sh)\s*(?:\/|-)c/iu);
  });

  it("keeps explicit shell syntax visible as a terminal-shell plan", () => {
    expect(hasExplicitVerseShellSyntax("pnpm test && git status", "win32")).toBe(true);
    expect(resolveVerseShellCommandPlan({
      command: "pnpm test && git status",
      cwd: "C:\\repo",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      platform: "win32",
    }).mode).toBe("explicit-shell");
  });

  it("keeps a .cmd shim under an audited windows-cmd profile without shell wrapping", () => {
    const script = "C:\\repo\\build.cmd";
    const plan = resolveVerseShellCommandPlan({
      command: script,
      argv: [script, "--watch"],
      platform: "win32",
      allowExplicitShell: false,
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe", PATH: "C:\\Windows\\System32" },
    });
    expect(plan).toMatchObject({
      mode: "argv",
      resolvedScript: script,
      interpreter: "C:\\Windows\\System32\\cmd.exe",
      interpreterProfile: "windows-cmd",
    });
    expect(plan.argv[0]).toBe(script);
    expect(plan.argv.join(" ")).not.toMatch(/(?:cmd|powershell|bash|sh)\s*(?:\/|-)c/iu);
  });

  it("keeps a PATHEXT-resolved .exe direct without an interpreter", () => {
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
    expect(plan).toMatchObject({ mode: "argv", profile: "git", resolvedExecutable: resolved });
    expect(plan.interpreterProfile).toBeUndefined();
  });

  it("fails closed on a batch script without resolved identity", () => {
    expect(() => resolveVerseShellCommandPlan({
      argv: ["build.cmd"],
      platform: "win32",
      allowExplicitShell: false,
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    })).toThrow(/resolved script path/u);
  });
});
