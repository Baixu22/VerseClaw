import { describe, expect, it } from "vitest";
import { resolveExplicitVerseShellCommandArgv, resolveVerseShellCommandArgv } from "./shell-command.js";

describe("VerseShell explicit shell command argv", () => {
  it("builds an audited cmd.exe argv for win32", () => {
    expect(resolveExplicitVerseShellCommandArgv("echo ok", "C:\\repo", { ComSpec: "C:\\Windows\\cmd.exe" }, "win32")).toEqual([
      "C:\\Windows\\cmd.exe", "/D", "/C", "cd /d C:/repo && echo ok",
    ]);
  });

  it("uses the default cmd.exe identity on win32 when ComSpec is absent", () => {
    expect(resolveExplicitVerseShellCommandArgv("echo ok", undefined, {}, "win32")).toEqual([
      "C:\\Windows\\System32\\cmd.exe", "/D", "/C", "echo ok",
    ]);
  });

  it("honors an explicit git-bash selection", () => {
    expect(resolveExplicitVerseShellCommandArgv("ls", "/repo with spaces", { VERSESHELL_OS_SHELL: "git-bash" }, "win32")).toEqual([
      "C:\\Program Files\\Git\\bin\\bash.exe", "-lc", "cd '/repo with spaces' && ls",
    ]);
  });

  it("honors an explicit powershell selection", () => {
    expect(resolveExplicitVerseShellCommandArgv("echo hi", "C:\\repo", { VERSESHELL_OS_SHELL: "powershell" }, "win32")).toEqual([
      "powershell", "-NoProfile", "-Command", "Set-Location -LiteralPath 'C:\\repo'; echo hi",
    ]);
  });

  it("uses posix sh -lc on non-win32 platforms", () => {
    expect(resolveExplicitVerseShellCommandArgv("printf ok", "/repo", {}, "linux")).toEqual([
      "sh", "-lc", "cd '/repo' && printf ok",
    ]);
  });

  it("keeps the legacy alias bound to the explicit-shell helper", () => {
    expect(resolveVerseShellCommandArgv).toBe(resolveExplicitVerseShellCommandArgv);
  });
});
