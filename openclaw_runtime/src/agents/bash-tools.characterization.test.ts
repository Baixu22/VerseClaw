/**
 * Characterization tests for the pure-logic layer of the native bash-tools
 * family (exec/process). This family is the REAL production shell surface
 * (8218 lines, previously zero direct tests). Process-spawning behavior is out
 * of scope here; these pin the deterministic helpers: output slicing, env
 * coercion, docker arg construction, session labels, render placeholders,
 * model-facing descriptions, and the send-keys result contract.
 *
 * Where a behavior looks questionable it carries a `characterization:` comment
 * — recorded, not endorsed.
 */
import { describe, expect, it } from "vitest";
import type { ProcessSession } from "./bash-process-registry.js";
import { describeProcessTool, describeExecTool } from "./bash-tools.descriptions.js";
import { renderExecOutputText, renderExecUpdateText } from "./bash-tools.exec-output.js";
import { handleProcessSendKeys, type WritableStdin } from "./bash-tools.process-send-keys.js";
import {
  buildDockerExecArgs,
  buildSandboxEnv,
  chunkString,
  clampWithDefault,
  coerceEnv,
  deriveSessionName,
  pad,
  sliceLogLines,
  truncateMiddle,
} from "./bash-tools.shared.js";

describe("sliceLogLines", () => {
  const text = "l1\nl2\nl3\nl4\nl5\n";

  it("returns everything with counts when no offset/limit given", () => {
    expect(sliceLogLines(text)).toEqual({
      slice: "l1\nl2\nl3\nl4\nl5",
      totalLines: 5,
      totalChars: 15,
    });
  });

  it("slices forward from a 0-based offset", () => {
    expect(sliceLogLines(text, 2).slice).toBe("l3\nl4\nl5");
  });

  it("slices offset+limit as a forward window", () => {
    expect(sliceLogLines(text, 1, 2).slice).toBe("l2\nl3");
  });

  it("treats limit WITHOUT offset as a tail slice", () => {
    // characterization: limit-only means "last N lines", not "first N lines".
    // The process tool's log action leans on this for recent-output views.
    expect(sliceLogLines(text, undefined, 2).slice).toBe("l4\nl5");
  });

  it("normalizes CRLF and drops the trailing empty line from the count", () => {
    const result = sliceLogLines("a\r\nb\r\n");
    expect(result.slice).toBe("a\nb");
    expect(result.totalLines).toBe(2);
    // characterization: totalChars counts the ORIGINAL text including \r bytes.
    expect(result.totalChars).toBe(6);
  });

  it("returns zeros for empty input", () => {
    expect(sliceLogLines("")).toEqual({ slice: "", totalLines: 0, totalChars: 0 });
  });

  it("clamps a negative offset to 0", () => {
    expect(sliceLogLines(text, -5, 2).slice).toBe("l1\nl2");
  });
});

describe("deriveSessionName", () => {
  it("uses verb plus first non-flag argument", () => {
    expect(deriveSessionName("npm run build --silent")).toBe("npm run");
  });

  it("skips flags to find the target", () => {
    expect(deriveSessionName("tail -f /var/log/app.log")).toBe("tail /var/log/app.log");
  });

  it("strips quotes from tokens", () => {
    expect(deriveSessionName('git commit -m "some message"')).toBe("git commit");
  });

  it("falls back to the flag when only flags follow the verb", () => {
    expect(deriveSessionName("ls -la")).toBe("ls -la");
  });

  it("returns just the verb for a bare command", () => {
    expect(deriveSessionName("htop")).toBe("htop");
  });

  it("returns undefined for an empty command", () => {
    expect(deriveSessionName("")).toBeUndefined();
  });

  it("middle-truncates long targets at 48 chars", () => {
    const longPath = `/very/${"deep/".repeat(20)}file.txt`;
    const name = deriveSessionName(`cat ${longPath}`);
    expect(name).toBeDefined();
    expect(name!.startsWith("cat ")).toBe(true);
    expect(name!).toContain("...");
    expect(name!.length).toBeLessThanOrEqual(4 + 48);
  });
});

describe("truncateMiddle / chunkString / pad / clampWithDefault", () => {
  it("truncateMiddle keeps head and tail around an ellipsis", () => {
    expect(truncateMiddle("abcdefghij", 7)).toBe("ab...ij");
    expect(truncateMiddle("short", 10)).toBe("short");
  });

  it("chunkString splits by UTF-16 length with a default 8KiB chunk", () => {
    expect(chunkString("aaabbbcc", 3)).toEqual(["aaa", "bbb", "cc"]);
    expect(chunkString("", 3)).toEqual([]);
    expect(chunkString("x".repeat(8 * 1024 + 1))).toHaveLength(2);
  });

  it("pad right-pads and never truncates", () => {
    expect(pad("ab", 5)).toBe("ab   ");
    expect(pad("abcdef", 3)).toBe("abcdef");
  });

  it("clampWithDefault clamps and substitutes NaN/undefined", () => {
    expect(clampWithDefault(undefined, 10, 0, 100)).toBe(10);
    expect(clampWithDefault(Number.NaN, 10, 0, 100)).toBe(10);
    expect(clampWithDefault(-5, 10, 0, 100)).toBe(0);
    expect(clampWithDefault(500, 10, 0, 100)).toBe(100);
    expect(clampWithDefault(42, 10, 0, 100)).toBe(42);
  });
});

describe("coerceEnv / buildSandboxEnv", () => {
  it("coerceEnv keeps only string-valued entries", () => {
    expect(
      coerceEnv({ A: "1", B: undefined, C: "x" } as unknown as Record<string, string>),
    ).toEqual({ A: "1", C: "x" });
    expect(coerceEnv(undefined)).toEqual({});
  });

  it("buildSandboxEnv layers params over sandbox env over PATH/HOME base", () => {
    const env = buildSandboxEnv({
      defaultPath: "/usr/bin",
      containerWorkdir: "/workspace",
      sandboxEnv: { FROM_SANDBOX: "s", SHARED: "sandbox" },
      paramsEnv: { FROM_PARAMS: "p", SHARED: "params" },
    });
    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/workspace",
      FROM_SANDBOX: "s",
      FROM_PARAMS: "p",
      SHARED: "params",
    });
  });
});

describe("buildDockerExecArgs", () => {
  it("builds a login-shell exec, passing env via -e but never PATH directly", () => {
    // characterization: PATH is smuggled via OPENCLAW_PREPEND_PATH and prepended
    // after /etc/profile sourcing, because -e PATH=<host path> poisons lookup
    // (notably with Windows host paths).
    const args = buildDockerExecArgs({
      containerName: "box",
      command: "echo hi",
      workdir: "/workspace/sub",
      env: { PATH: "/custom/bin", FOO: "bar" },
      tty: false,
    });
    expect(args).toEqual([
      "exec",
      "-i",
      "-w",
      "/workspace/sub",
      "-e",
      "FOO=bar",
      "-e",
      "OPENCLAW_PREPEND_PATH=/custom/bin",
      "box",
      "/bin/sh",
      "-lc",
      'export PATH="${OPENCLAW_PREPEND_PATH}:$PATH"; unset OPENCLAW_PREPEND_PATH; echo hi',
    ]);
  });

  it("adds -t for tty and omits the PATH export when no custom PATH", () => {
    const args = buildDockerExecArgs({
      containerName: "box",
      command: "top",
      env: {},
      tty: true,
    });
    expect(args).toEqual(["exec", "-i", "-t", "box", "/bin/sh", "-lc", "top"]);
  });
});

describe("exec output rendering", () => {
  it("substitutes a stable placeholder for empty output", () => {
    expect(renderExecOutputText(undefined)).toBe("(no output)");
    expect(renderExecOutputText("")).toBe("(no output)");
    expect(renderExecOutputText("real")).toBe("real");
  });

  it("puts warnings before the tail text", () => {
    expect(renderExecUpdateText({ tailText: "out", warnings: ["w1", "w2"] })).toBe(
      "w1\nw2\n\nout",
    );
    expect(renderExecUpdateText({ warnings: [] })).toBe("(no output)");
  });
});

describe("tool descriptions", () => {
  it("describeProcessTool lists the process actions and adds cron guidance only when available", () => {
    const withoutCron = describeProcessTool();
    expect(withoutCron).toContain("list, poll, log, write, send-keys, submit, paste, kill");
    expect(withoutCron).not.toContain("use cron");
    expect(describeProcessTool({ hasCronTool: true })).toContain(
      "use cron for scheduled follow-ups",
    );
  });

  it("describeExecTool keeps the stable base guidance", () => {
    const description = describeExecTool();
    expect(description).toContain("Execute shell commands with background continuation");
    expect(description).toContain("Use pty=true for TTY-required commands");
    if (process.platform === "win32") {
      // characterization: on Windows the description embeds host-specific
      // guidance (and may append a disk-derived approved-executables list,
      // which is environment-dependent and deliberately not pinned here).
      expect(description).toContain("IMPORTANT (Windows)");
    }
  });
});

describe("handleProcessSendKeys", () => {
  function fakeStdin(written: string[]): WritableStdin {
    return {
      write: (data, cb) => {
        written.push(data);
        cb?.(null);
      },
      end: () => {},
    };
  }

  function fakeSession(overrides?: Partial<{ cursorKeyMode: string; command: string }>) {
    return {
      cursorKeyMode: "normal",
      command: "vim notes.txt",
      ...overrides,
    } as unknown as ProcessSession;
  }

  it("writes literal data and returns the running-session result shape", async () => {
    const written: string[] = [];
    const result = await handleProcessSendKeys({
      sessionId: "s1",
      session: fakeSession(),
      stdin: fakeStdin(written),
      literal: "abc",
    });
    expect(written).toEqual(["abc"]);
    expect(result.content).toEqual([{ type: "text", text: "Sent 3 bytes to session s1." }]);
    expect(result.details).toEqual({
      status: "running",
      sessionId: "s1",
      name: "vim notes.txt",
    });
  });

  it("fails without writing when no key data is provided", async () => {
    const written: string[] = [];
    const result = await handleProcessSendKeys({
      sessionId: "s1",
      session: fakeSession(),
      stdin: fakeStdin(written),
    });
    expect(written).toEqual([]);
    expect(result.content[0]).toMatchObject({ text: "No key data provided." });
    expect(result.details).toEqual({ status: "failed" });
  });

  it("refuses cursor-mode-sensitive keys while the session mode is unknown", async () => {
    // characterization: arrow keys depend on DECCKM state; the tool asks the
    // model to poll for startup output first instead of guessing an encoding.
    const written: string[] = [];
    const result = await handleProcessSendKeys({
      sessionId: "s1",
      session: fakeSession({ cursorKeyMode: "unknown" }),
      stdin: fakeStdin(written),
      keys: ["up"],
    });
    expect(written).toEqual([]);
    expect(result.details).toEqual({ status: "failed" });
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining("cursor key mode is not known yet"),
    });
  });
});
