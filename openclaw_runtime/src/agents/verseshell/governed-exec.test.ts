import { describe, expect, it, vi } from "vitest";
import type { Observation } from "../../../../shared/verseshell/types.js";
import {
  executeGovernedVerseShell,
  GovernedVerseShellError,
  queryGovernedVerseShellResult,
} from "./governed-exec.js";
import type { VerseShellProcessManager, VerseShellProcessConfig } from "./process-manager.js";
import {
  resolveVerseShellPolicyProfile,
  VERSESHELL_GOVERNED_EXEC_PROFILE_ID,
} from "./policy-profile.js";
import { resolveVerseShellCommandArgv } from "./shell-command.js";

const CONTRACT_ENV = {
  VERSESHELL_RUNTIME_VERSION: "1.0.0",
  VERSESHELL_SERVER_PROTOCOL: "verseshell.jsonl/v1",
  VERSESHELL_OPERATION_CATALOG_DIGEST: `sha256:${"a".repeat(64)}`,
  VERSESHELL_OPERATION_CATALOG_COUNT: "31",
};

function observation(overrides: Partial<Observation>): Observation {
  return {
    schema: "verseshell.observation/v1",
    id: "request",
    op: "exec.run",
    ok: true,
    data: {},
    meta: { elapsed_ms: 1, profile: "generic", token_estimate: 10 },
    ...overrides,
  };
}

function fakeManager(responses: Observation[]) {
  const configs: VerseShellProcessConfig[] = [];
  const shutdownProcess = vi.fn(async () => true);
  let index = 0;
  const manager = {
    getClient: vi.fn(async (config: VerseShellProcessConfig) => {
      configs.push(config);
      const processKey = `process-${configs.length}`;
      return {
        processKey,
        execute: vi.fn(async () => responses[index++]!),
      };
    }),
    shutdownProcess,
  } as unknown as VerseShellProcessManager;
  return { manager, configs, shutdownProcess };
}

function fakeResultManager(response: Observation) {
  const configs: VerseShellProcessConfig[] = [];
  const queries: Array<{ handle: string; args: Record<string, unknown> }> = [];
  const manager = {
    getClient: vi.fn(async (config: VerseShellProcessConfig) => {
      configs.push(config);
      return {
        processKey: "result-process",
        queryResult: vi.fn(async (handle: string, args: Record<string, unknown>) => {
          queries.push({ handle, args });
          return response;
        }),
      };
    }),
  } as unknown as VerseShellProcessManager;
  return { manager, configs, queries };
}

describe("VerseShell governed exec adaptation", () => {
  it("derives a stable policy digest from the repository-owned definition", () => {
    const first = resolveVerseShellPolicyProfile(VERSESHELL_GOVERNED_EXEC_PROFILE_ID);
    const second = resolveVerseShellPolicyProfile(VERSESHELL_GOVERNED_EXEC_PROFILE_ID);
    expect(first).toBe(second);
    expect(first.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.capabilities).toEqual(["shell.exec"]);
    expect(first.definition).toMatchObject({
      runtime: { mode: "agent_strict", workspace_jail: true, approval: "action-bound-token" },
      host: { approval_before_retry: true, native_fallback: false },
    });
  });

  it("does not consume an upstream token before OpenClaw host policy approval", async () => {
    const denied = observation({
      ok: false,
      data: { approval_token: "apv_0123456789abcdef" },
      error: { code: "E_NEEDS_APPROVAL", message: "approval required", recoverable: true },
    });
    const fake = fakeManager([denied]);
    await expect(executeGovernedVerseShell({
      command: "echo denied",
      cwd: process.cwd(),
      hostPolicyApproved: false,
      env: CONTRACT_ENV,
      manager: fake.manager,
    })).rejects.toMatchObject(
        // vitest v4 matcher has no type arguments; the generic is asserted via satisfies instead
        { code: "E_NEEDS_APPROVAL" });
    expect(fake.configs).toHaveLength(1);
    expect(fake.configs[0].approvalToken).toBeUndefined();
    expect(fake.shutdownProcess).not.toHaveBeenCalled();
  });

  it("retries once in an approval-scoped process and preserves bounded recovery metadata", async () => {
    const denied = observation({
      ok: false,
      data: { approval_token: "apv_0123456789abcdef" },
      error: { code: "E_NEEDS_APPROVAL", message: "approval required", recoverable: true },
    });
    const completed = observation({
      data: {
        exit_code: 0,
        timed_out: false,
        stdout: { status: "reduced", summary: "3 tests passed", artifact: "result://sha256/stdout" },
        stderr: { status: "empty" },
      },
      diagnostics: [{ tool: "pytest", severity: "warning", message: "slow test", path: "tests/a.py", line: 4 }],
      meta: { elapsed_ms: 8, profile: "pytest", token_estimate: 22 },
    });
    const fake = fakeManager([denied, completed]);
    const result = await executeGovernedVerseShell({
      command: "pytest -q",
      cwd: process.cwd(),
      hostPolicyApproved: true,
      env: CONTRACT_ENV,
      manager: fake.manager,
    });
    expect(fake.configs.map((config) => config.approvalToken)).toEqual([
      undefined,
      "apv_0123456789abcdef",
    ]);
    expect(fake.shutdownProcess).toHaveBeenCalledWith("process-2");
    expect(result).toMatchObject({ success: true, profile: "pytest", tokenEstimate: 22 });
    expect(result.stdout).toContain("3 tests passed");
    expect(result.stdout).toContain("result://sha256/stdout");
    expect(result.stderr).toContain("tests/a.py:4: warning: slow test");
  });

  it("keeps shell-string compatibility at the typed argv boundary", () => {
    expect(resolveVerseShellCommandArgv("echo ok", "C:\\repo", { ComSpec: "C:\\Windows\\cmd.exe" }, "win32")).toEqual([
      "C:\\Windows\\cmd.exe",
      "/D",
      "/C",
      "cd /d C:/repo && echo ok",
    ]);
    expect(resolveVerseShellCommandArgv("printf ok", "/repo", {}, "linux")).toEqual([
      "sh",
      "-lc",
      "cd '/repo' && printf ok",
    ]);
  });

  it("rejects invalid artifact handles and mode-specific arguments before transport", async () => {
    const fake = fakeResultManager(observation({ op: "result.query" }));
    await expect(queryGovernedVerseShellResult({
      handle: "result://sha256/not-a-digest",
      mode: "head",
      cwd: process.cwd(),
      env: CONTRACT_ENV,
      manager: fake.manager,
    })).rejects.toMatchObject(
        // vitest v4 matcher has no type arguments; the generic is asserted via satisfies instead
        {
      code: "E_VERSESHELL_RESULT_HANDLE",
    });
    await expect(queryGovernedVerseShellResult({
      handle: `result://sha256/${"b".repeat(64)}`,
      mode: "grep",
      cwd: process.cwd(),
      env: CONTRACT_ENV,
      manager: fake.manager,
    })).rejects.toMatchObject(
        // vitest v4 matcher has no type arguments; the generic is asserted via satisfies instead
        {
      code: "E_VERSESHELL_RESULT_PATTERN",
    });
    await expect(queryGovernedVerseShellResult({
      handle: `result://sha256/${"b".repeat(64)}`,
      mode: "slice",
      cwd: process.cwd(),
      startLine: 1,
      endLine: 501,
      env: CONTRACT_ENV,
      manager: fake.manager,
    })).rejects.toMatchObject(
        // vitest v4 matcher has no type arguments; the generic is asserted via satisfies instead
        {
      code: "E_VERSESHELL_RESULT_RANGE",
    });
    expect(fake.configs).toHaveLength(0);
  });

  it("sends bounded result.query arguments through the verified process", async () => {
    const completed = observation({
      op: "result.query",
      data: { mode: "grep", matches: [{ line: 2, text: "failed" }] },
    });
    const fake = fakeResultManager(completed);
    const handle = `result://sha256/${"c".repeat(64)}`;
    await expect(queryGovernedVerseShellResult({
      handle,
      mode: "grep",
      pattern: " failed ",
      maxMatches: 999,
      cwd: process.cwd(),
      env: CONTRACT_ENV,
      manager: fake.manager,
    })).resolves.toBe(completed);
    expect(fake.configs).toHaveLength(1);
    expect(fake.queries).toEqual([{
      handle,
      args: {
        mode: "grep",
        max_bytes: 64 * 1024,
        max_tokens: 4_000,
        pattern: "failed",
        max_matches: 200,
      },
    }]);
  });
});
