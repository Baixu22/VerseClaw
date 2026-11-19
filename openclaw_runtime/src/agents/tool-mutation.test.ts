import { describe, expect, it } from "vitest";
import { isMutatingToolCall, requiresSessionTaskScope } from "./tool-mutation.ts";

function isReadOnlyExec(command: string): boolean {
  return !isMutatingToolCall("exec", { command });
}

describe("git command read-only classification", () => {
  it('allows waiting for delegated work without claiming the delegated writer', () => {
    expect(requiresSessionTaskScope('sessions_yield', {})).toBe(false);
    expect(requiresSessionTaskScope('sessions_spawn', {})).toBe(true);
  });
  it("requires a task writer for output-producing modes of otherwise read-only tools", () => {
    for (const command of [
      "file -C -m magic",
      "file -bC -m magic",
      "file --compile -m magic",
      "file --co -m magic",
    ]) {
      expect(requiresSessionTaskScope("exec", { command })).toBe(true);
    }
    expect(requiresSessionTaskScope("exec", { command: "file input.txt" })).toBe(false);
    expect(requiresSessionTaskScope("exec", { command: "file --check -m magic" })).toBe(false);
  });
  it("treats plain read-only subcommands as read-only", () => {
    expect(isReadOnlyExec("git status")).toBe(true);
    expect(isReadOnlyExec("git diff")).toBe(true);
    expect(isReadOnlyExec("git log --oneline")).toBe(true);
    expect(isReadOnlyExec("git rev-parse HEAD")).toBe(true);
    expect(isReadOnlyExec("git remote -v")).toBe(true);
  });

  it("resolves the subcommand behind harmless global flags", () => {
    // Previously these read tokens[1] === '--no-pager' and fell through to
    // mutating, so a read-only command was needlessly gated.
    expect(isReadOnlyExec("git --no-pager status")).toBe(true);
    expect(isReadOnlyExec("git --no-optional-locks diff")).toBe(true);
    expect(isReadOnlyExec("git --no-pager log --oneline")).toBe(true);
  });

  it("rejects config-injection global flags whatever the subcommand", () => {
    // -c / --config-env can point core.pager, core.editor or alias.* at an
    // arbitrary command, so the subcommand name proves nothing about safety.
    expect(isReadOnlyExec("git -c core.pager=x status")).toBe(false);
    expect(isReadOnlyExec("git -c core.pager=/tmp/evil diff")).toBe(false);
    expect(isReadOnlyExec("git -c alias.st=!sh st")).toBe(false);
    expect(isReadOnlyExec("git --config-env=core.pager=EVIL status")).toBe(false);
  });

  it("rejects flags that redirect git's helper binaries", () => {
    expect(isReadOnlyExec("git --exec-path=/tmp/evil status")).toBe(false);
    expect(isReadOnlyExec("git --exec-path /tmp/evil status")).toBe(false);
  });

  it("rejects flags that move the operation off the intended repository", () => {
    expect(isReadOnlyExec("git --git-dir=/other/repo status")).toBe(false);
    expect(isReadOnlyExec("git --work-tree=/other status")).toBe(false);
    expect(isReadOnlyExec("git -C /other/repo status")).toBe(false);
    expect(isReadOnlyExec("git --namespace=other status")).toBe(false);
  });

  it("still rejects mutating subcommands, including behind global flags", () => {
    expect(isReadOnlyExec("git commit -m wip")).toBe(false);
    expect(isReadOnlyExec("git push")).toBe(false);
    expect(isReadOnlyExec("git reset --hard")).toBe(false);
    expect(isReadOnlyExec("git --no-pager reset --hard")).toBe(false);
  });

  it("does not mistake a global flag value for the subcommand", () => {
    // `-C status` must not resolve to the read-only `status` subcommand: the
    // value is a directory, and the flag itself is unsafe.
    expect(isReadOnlyExec("git -C status commit -m x")).toBe(false);
    expect(isReadOnlyExec("git --exec-path status push")).toBe(false);
  });

  it("keeps existing unsafe-flag rejections for read-only subcommands", () => {
    expect(isReadOnlyExec("git diff --ext-diff")).toBe(false);
    expect(isReadOnlyExec("git log --output=/tmp/out")).toBe(false);
  });

  it("rejects a bare git invocation with no subcommand", () => {
    expect(isReadOnlyExec("git")).toBe(false);
    expect(isReadOnlyExec("git --no-pager")).toBe(false);
    expect(isReadOnlyExec("git -- status")).toBe(false);
  });

  it("rejects commands the simple tokenizer cannot prove safe", () => {
    // Shell metacharacters mean the tokenizer bails out and the command is
    // treated as mutating rather than parsed optimistically.
    expect(isReadOnlyExec("git status; rm -rf /")).toBe(false);
    expect(isReadOnlyExec("git status && git push")).toBe(false);
    expect(isReadOnlyExec("git status | sh")).toBe(false);
    expect(isReadOnlyExec("git status $(evil)")).toBe(false);
  });
});
