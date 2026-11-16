import { afterEach, describe, expect, it, vi } from "vitest";
import { configureManagedProcessCapacity, managedProcessCapacityStats, resetManagedProcessCapacity } from "./managed-process-capacity.js";
import { managedProcessReservations } from "./managed-process-reservation.js";
import type { JsonObject, Observation } from "../../../../shared/verseshell/types.js";
import { AciTransportError, type AciExecuteOptions } from "./aci-client.js";
import {
  startGovernedVerseShellProcess,
  executeGovernedVerseShellProcessObserved,
  type GovernedVerseShellProcessOptions,
} from "./governed-process.js";
import type { VerseShellProcessConfig, VerseShellProcessManager } from "./process-manager.js";
import { getVerseShellCommandProfileDefinition } from "./command-profiles.js";
import { resolveVerseShellExternalWritePolicy } from "./external-write-policy.js";

const CONTRACT_ENV = {
  VERSESHELL_RUNTIME_VERSION: "1.0.0",
  VERSESHELL_SERVER_PROTOCOL: "verseshell.jsonl/v1",
  VERSESHELL_OPERATION_CATALOG_DIGEST: `sha256:${"a".repeat(64)}`,
  VERSESHELL_OPERATION_CATALOG_COUNT: "31",
};

const OWNER = {
  process_id: "proc-1",
  runtime_id: "runtime-1",
  agent_id: "agent-1",
  session_id: "session-1",
};

type ExecuteCall = {
  op: string;
  args: JsonObject;
  options?: AciExecuteOptions;
};

function observation(
  op: string,
  data: JsonObject,
  overrides: Partial<Observation> = {},
): Observation {
  return {
    schema: "verseshell.observation/v1",
    id: `request-${op}`,
    op,
    ok: true,
    status: "ok",
    data,
    meta: { elapsed_ms: 1, profile: "generic", token_estimate: 1 },
    ...overrides,
  };
}

function snapshot(options: {
  state?: "running" | "exited" | "killed" | "lost";
  cursor?: number;
  text?: string;
  owner?: Partial<typeof OWNER>;
  exitCode?: number | null;
  timedOut?: boolean;
  terminationReason?: string;
} = {}): JsonObject {
  const state = options.state ?? "running";
  return {
    ...OWNER,
    ...options.owner,
    state,
    pid: 4321,
    mode: "pipe",
    exit_code: options.exitCode === undefined ? (state === "exited" ? 0 : null) : options.exitCode,
    timed_out: options.timedOut === true,
    ...(options.terminationReason ? { termination_reason: options.terminationReason } : {}),
    output: {
      cursor: options.cursor ?? 0,
      retained_start_cursor: 0,
      truncated: false,
      lost_bytes: 0,
      chunks: options.text
        ? [{ stream: "stdout", start_cursor: 0, end_cursor: options.cursor ?? 0, text: options.text }]
        : [],
    },
    artifacts: state === "running"
      ? []
      : [{ handle: `result://sha256/${"b".repeat(64)}` }],
  };
}

function baseOptions(
  manager: VerseShellProcessManager,
  overrides: Partial<GovernedVerseShellProcessOptions> = {},
): GovernedVerseShellProcessOptions {
  return {
    command: "echo lifecycle",
    cwd: process.cwd(),
    processEnv: { ComSpec: "C:\\Windows\\System32\\cmd.exe", PATH: "C:\\Windows\\System32" },
    timeoutMs: 12_345,
    maxOutputBytes: 2_048,
    usePty: false,
    agentId: OWNER.agent_id,
    sessionId: OWNER.session_id,
    identity: { sessionKey: "agent:main:managed-process", sessionGeneration: "generation-1", runId: "run-1" },
    hostPolicyApproved: true,
    runtimeEnv: CONTRACT_ENV,
    manager,
    ...overrides,
  };
}

function fakeManager(
  clients: Array<{
    processKey: string;
    execute: (op: string, args: JsonObject, options?: AciExecuteOptions) => Promise<Observation>;
  }>,
) {
  const configs: VerseShellProcessConfig[] = [];
  const shutdownProcess = vi.fn(async (_key: string) => true);
  const references = new Map<string, number>();
  const retainProcess = (key: string) => {
    references.set(key, (references.get(key) ?? 0) + 1); let released = false;
    return async () => { if (released) return; released = true;
      const remaining = references.get(key)! - 1; references.set(key, remaining);
      if (remaining === 0) await shutdownProcess(key);
    };
  };
  let index = 0;
  const getClient = vi.fn(async (config: VerseShellProcessConfig) => {
    configs.push(config);
    const client = clients[index++];
    if (!client) throw new Error("unexpected getClient call");
    return client;
  });
  const manager = {
    getClient,
    shutdownProcess,
    retainProcess,
  } as unknown as VerseShellProcessManager;
  return { manager, configs, getClient, shutdownProcess };
}

afterEach(() => resetManagedProcessCapacity());

describe("VerseShell startup capacity rollback", () => {
  it("returns a confirmed terminal reservation even when executor cleanup fails", async () => {
    configureManagedProcessCapacity({ maxLiveProcesses: 1 });
    const client = {
      processKey: "terminal-before-cleanup-failure",
      execute: vi.fn(async (op: string) => observation(op, snapshot({ state: "exited" }))),
    };
    const fake = fakeManager([client]);
    fake.shutdownProcess.mockRejectedValueOnce(new Error("cleanup failed"));
    const handle = await startGovernedVerseShellProcess(baseOptions(fake.manager));
    expect(managedProcessReservations()).toContainEqual(expect.objectContaining({
      sessionKey: "agent:main:managed-process", sessionGeneration: "generation-1", runId: "run-1",
    }));
    await expect(handle.wait()).rejects.toThrow("cleanup failed");
    expect(managedProcessCapacityStats()).toMatchObject({ live: 0, completed: 1, doubleRelease: 0 });
  });

  it("returns capacity when executor acquisition fails before dispatch and permits retry", async () => {
    configureManagedProcessCapacity({ maxLiveProcesses: 1 });
    const client = {
      processKey: "retry-after-resolution-failure",
      execute: vi.fn(async (op: string) => observation(op, snapshot({ state: "exited" }))),
    };
    const fake = fakeManager([client]);
    fake.getClient.mockRejectedValueOnce(new Error("injected resolution failure"));
    await expect(startGovernedVerseShellProcess(baseOptions(fake.manager))).rejects.toThrow("injected resolution failure");
    expect(managedProcessCapacityStats()).toMatchObject({ live: 0, completed: 1, doubleRelease: 0 });
    const handle = await startGovernedVerseShellProcess(baseOptions(fake.manager));
    await handle.wait();
    expect(managedProcessCapacityStats()).toMatchObject({ live: 0, admitted: 2, completed: 2, doubleRelease: 0 });
  });

  it("returns capacity when approval transport acquisition fails after a confirmed denial", async () => {
    configureManagedProcessCapacity({ maxLiveProcesses: 1 });
    const client = {
      processKey: "denied-first-start",
      execute: vi.fn(async (op: string) => observation(op, { approval_token: "apv_0123456789abcdef" }, {
        ok: false, error: { code: "E_NEEDS_APPROVAL", message: "approval required", recoverable: true },
      })),
    };
    const fake = fakeManager([client]);
    fake.getClient.mockImplementationOnce(async () => client).mockRejectedValueOnce(new Error("approval executor unavailable"));
    await expect(startGovernedVerseShellProcess(baseOptions(fake.manager))).rejects.toThrow("approval executor unavailable");
    expect(client.execute).toHaveBeenCalledOnce();
    expect(managedProcessCapacityStats()).toMatchObject({ live: 0, completed: 1, doubleRelease: 0 });
  });

  it("returns a rejected start reservation even if approval transport cleanup fails", async () => {
    configureManagedProcessCapacity({ maxLiveProcesses: 1 });
    const denied = {
      processKey: "denied",
      execute: vi.fn(async (op: string) => observation(op, { approval_token: "apv_0123456789abcdef" }, {
        ok: false, error: { code: "E_NEEDS_APPROVAL", message: "approval required", recoverable: true },
      })),
    };
    const refused = {
      processKey: "refused",
      execute: vi.fn(async (op: string) => observation(op, {}, {
        ok: false, error: { code: "E_INVALID_ARGS", message: "start refused", recoverable: false },
      })),
    };
    const fake = fakeManager([denied, refused]);
    fake.shutdownProcess.mockRejectedValueOnce(new Error("cleanup failed"));
    await expect(startGovernedVerseShellProcess(baseOptions(fake.manager))).rejects.toThrow("cleanup failed");
    expect(managedProcessCapacityStats()).toMatchObject({ live: 0, completed: 1, doubleRelease: 0 });
  });

  it.each(["start", "poll", "malformed-start"] as const)(
    "keeps the managed reservation when %s delivery or terminal state is unknown",
    async (phase) => {
      configureManagedProcessCapacity({ maxLiveProcesses: 1 });
      const client = {
        processKey: "unknown-delivery",
        execute: vi.fn(async (op: string) => {
          if (phase === "start" || op === "process.poll") throw new Error("unknown delivery");
          return observation(op, phase === "malformed-start" ? {} : snapshot());
        }),
      };
      const fake = fakeManager([client]);
      if (phase === "poll") {
        const handle = await startGovernedVerseShellProcess(baseOptions(fake.manager));
        await expect(handle.wait()).rejects.toThrow("unknown delivery");
      } else {
        await expect(startGovernedVerseShellProcess(baseOptions(fake.manager))).rejects.toThrow();
      }
      expect(managedProcessCapacityStats()).toMatchObject({ live: 1, completed: 0 });
      expect(client.execute.mock.calls.filter(([op]) => op === "process.start")).toHaveLength(1);
    },
  );
});

describe("VerseShell governed process lifecycle", () => {
  it("drains terminal output through the final cursor before releasing its executor", async () => {
    let polls = 0; const client = { processKey: "terminal-pages", execute: vi.fn(async (op: string) => {
      if (op === "process.start") return observation(op, snapshot());
      polls++;
      const data = snapshot({ state: "exited", text: polls === 1 ? "first" : "last", cursor: polls === 1 ? 5 : 9 });
      (data.output as JsonObject).next_cursor = 9;
      return observation(op, data);
    }) };
    const fake = fakeManager([client]); const chunks: string[] = [];
    const handle = await startGovernedVerseShellProcess(baseOptions(fake.manager, { onStdout: text => chunks.push(text) }));
    await handle.wait(); expect(chunks).toEqual(["first", "last"]); expect(polls).toBe(2);
    expect(client.execute.mock.calls.filter(([op]) => op === "process.poll")).toHaveLength(2);
    expect(fake.shutdownProcess).toHaveBeenCalledOnce();
  });
  it("keeps a shared executor alive until both lifecycle references settle", async () => {
    let starts = 0; const ends = new Map<string, (value: Observation) => void>();
    const client = { processKey: "shared-lifecycle", execute: vi.fn(async (op: string, args: JsonObject) => {
      if (op === "process.start") return observation(op, snapshot({ owner: { process_id: `proc-${++starts}` } }));
      if (op === "process.poll") return new Promise<Observation>(resolve => { ends.set(String(args.process_id), resolve); });
      return observation(op, {});
    }) };
    const fake = fakeManager([client, client]);
    const first = await startGovernedVerseShellProcess(baseOptions(fake.manager));
    const second = await startGovernedVerseShellProcess(baseOptions(fake.manager));
    ends.get("proc-1")!(observation("process.poll", snapshot({ state: "exited", owner: { process_id: "proc-1" } })));
    await first.wait();
    const closedEarly = fake.shutdownProcess.mock.calls.length;
    ends.get("proc-2")!(observation("process.poll", snapshot({ state: "exited", owner: { process_id: "proc-2" } })));
    await second.wait();
    expect(closedEarly).toBe(0); expect(fake.shutdownProcess).toHaveBeenCalledOnce();
  });
  it("bounds accumulated UTF-8 output while keeping terminal artifact references", async () => {
    let polls = 0; const text = "汉".repeat(400);
    const client = { processKey: "bounded-output", execute: vi.fn(async (op: string) => {
      if (op === "process.start") return observation(op, snapshot());
      polls++;
      return observation(op, snapshot({ text, cursor: polls * 1200, state: polls === 4 ? "exited" : "running" }));
    }) };
    const fake = fakeManager([client]); Object.assign(fake.manager, { list: () => [{ pid: 4321, key: client.processKey }] });
    const result = await executeGovernedVerseShellProcessObserved(baseOptions(fake.manager, { maxOutputBytes: 1024 }));
    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(1024);
    expect(result.observation.data?.artifacts).toEqual([`result://sha256/${"b".repeat(64)}`]);
  });
  it("uses the pre-approval argv plan without reparsing the display command", async () => {
    const calls: ExecuteCall[] = [];
    const client = {
      processKey: "preplanned",
      execute: vi.fn(async (op: string, args: JsonObject, options?: AciExecuteOptions) => {
        calls.push({ op, args, options });
        return observation(op, snapshot({ state: "exited", exitCode: 0 }));
      }),
    };
    const fake = fakeManager([client]);
    const handle = await startGovernedVerseShellProcess(baseOptions(fake.manager, {
      command: "pnpm test && this text is never reparsed",
      executionPlan: {
        mode: "argv",
        profile: "test",
        argv: ["pnpm", "test", "argument with spaces && literals"],
        displayCommand: "pnpm test && this text is never reparsed",
        executable: "pnpm",
        profileDefinition: getVerseShellCommandProfileDefinition("test"),
        externalWritePolicy: resolveVerseShellExternalWritePolicy({
          profile: "test",
          argv: ["pnpm", "test", "argument with spaces && literals"],
        }),
      },
    }));

    await expect(handle.wait()).resolves.toMatchObject({ state: "exited", exitCode: 0 });
    expect(calls.find((call) => call.op === "process.start")?.args.argv).toEqual([
      "pnpm",
      "test",
      "argument with spaces && literals",
    ]);
  });

  it("retries effectful start exactly once in the approval-scoped transport", async () => {
    const unapprovedCalls: ExecuteCall[] = [];
    const approvedCalls: ExecuteCall[] = [];
    const denied = observation(
      "process.start",
      { approval_token: "apv_0123456789abcdef" },
      {
        ok: false,
        error: { code: "E_NEEDS_APPROVAL", message: "approval required", recoverable: true },
      },
    );
    const firstClient = {
      processKey: "unapproved",
      execute: vi.fn(async (op: string, args: JsonObject, options?: AciExecuteOptions) => {
        unapprovedCalls.push({ op, args, options });
        return denied;
      }),
    };
    const approvedClient = {
      processKey: "approved",
      execute: vi.fn(async (op: string, args: JsonObject, options?: AciExecuteOptions) => {
        approvedCalls.push({ op, args, options });
        return denied;
      }),
    };
    const fake = fakeManager([firstClient, approvedClient]);

    await expect(startGovernedVerseShellProcess(baseOptions(fake.manager))).rejects.toMatchObject({
      code: "E_NEEDS_APPROVAL",
    });

    expect(unapprovedCalls.map((call) => call.op)).toEqual(["process.start"]);
    expect(approvedCalls.map((call) => call.op)).toEqual(["process.start"]);
    expect(unapprovedCalls[0]?.options).toMatchObject({ effectful: true });
    expect(approvedCalls[0]?.options).toMatchObject({ effectful: true });
    expect(fake.configs.map((config) => config.approvalToken)).toEqual([
      undefined,
      "apv_0123456789abcdef",
    ]);
    expect(fake.shutdownProcess).toHaveBeenCalledTimes(2);
    expect(fake.shutdownProcess).toHaveBeenLastCalledWith("approved");
  });

  it("maps start, poll, stdin, EOF, and kill and cleans up after terminal state", async () => {
    const calls: ExecuteCall[] = [];
    let finishPoll!: (value: Observation) => void;
    const pollResult = new Promise<Observation>((resolve) => {
      finishPoll = resolve;
    });
    const client = {
      processKey: "lifecycle",
      execute: vi.fn(async (op: string, args: JsonObject, options?: AciExecuteOptions) => {
        calls.push({ op, args, options });
        if (op === "process.start") return observation(op, snapshot());
        if (op === "process.poll") return await pollResult;
        if (op === "process.write" || op === "process.kill") return observation(op, {});
        throw new Error(`unexpected operation ${op}`);
      }),
    };
    const fake = fakeManager([client]);
    const stdout: string[] = [];
    const traceId = "5".repeat(32);
    const handle = await startGovernedVerseShellProcess(baseOptions(fake.manager, {
      traceId,
      onStdout: (chunk) => stdout.push(chunk),
    }));

    await new Promise<void>((resolve, reject) => {
      handle.stdin.write("hello", (error) => error ? reject(error) : resolve());
    });
    await new Promise<void>((resolve, reject) => {
      handle.stdin.end((error) => error ? reject(error) : resolve());
    });
    expect(calls.filter((call) => call.op === "process.write")).toHaveLength(2);
    await handle.kill("agent_abort");
    finishPoll(observation("process.poll", snapshot({ state: "killed", cursor: 4, text: "done", exitCode: null, terminationReason: "agent_abort" })));
    await expect(handle.wait()).resolves.toMatchObject({
      state: "killed",
      exitCode: null,
      terminationReason: "agent_abort",
    });

    const start = calls.find((call) => call.op === "process.start");
    expect(start?.args).toMatchObject({
      argv: ["C:\\Windows\\System32\\cmd.exe", "/D", "/C", "echo lifecycle"],
      cwd: ".",
      agent_id: OWNER.agent_id,
      session_id: OWNER.session_id,
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe", PATH: "C:\\Windows\\System32" },
      stdin_mode: "pipe",
      pty: false,
      timeout_ms: 12_345,
      max_output_bytes: 2_048,
      wait_ms: 0,
    });
    expect(calls.find((call) => call.op === "process.poll")?.args).toMatchObject({
      ...OWNER,
      cursor: 0,
      max_bytes: 64 * 1024,
      wait_ms: 1_000,
    });
    expect(calls.filter((call) => call.op === "process.write").map((call) => call.args)).toEqual([
      { ...OWNER, data: "hello", encoding: "utf8", eof: false },
      { ...OWNER, data: "", encoding: "utf8", eof: true },
    ]);
    expect(calls.find((call) => call.op === "process.kill")?.args).toEqual({
      ...OWNER,
      reason: "agent_abort",
      wait_ms: 0,
    });
    expect(calls
      .filter((call) => call.op === "process.start" || call.op === "process.poll" || call.op === "process.kill")
      .map((call) => call.options?.traceId)).toEqual([traceId, traceId, traceId]);
    expect(stdout).toEqual(["done"]);
    expect(handle.stdin).toMatchObject({ destroyed: true, writable: false, writableEnded: true });
    expect(fake.shutdownProcess).toHaveBeenCalledWith("lifecycle");
  });

  it.each([
    {
      name: "cursor rewind",
      start: snapshot({ cursor: 5 }),
      poll: snapshot({ state: "exited", cursor: 4 }),
      code: "E_VERSESHELL_LIFECYCLE_CURSOR",
    },
    {
      name: "owner drift",
      start: snapshot(),
      poll: snapshot({ state: "exited", owner: { runtime_id: "runtime-2" } }),
      code: "E_VERSESHELL_LIFECYCLE_OWNER",
    },
  ])("fails closed on $name", async ({ start, poll, code }) => {
    const client = {
      processKey: "drift",
      execute: vi.fn(async (op: string) => observation(op, op === "process.start" ? start : poll)),
    };
    const fake = fakeManager([client]);
    const handle = await startGovernedVerseShellProcess(baseOptions(fake.manager));
    await expect(handle.wait()).rejects.toMatchObject({ code });
    expect(fake.shutdownProcess).not.toHaveBeenCalled();
  });

  it("retries only read-only poll after a transport restart and never replays start", async () => {
    const calls: ExecuteCall[] = [];
    let pollAttempts = 0;
    const client = {
      processKey: "restart",
      execute: vi.fn(async (op: string, args: JsonObject, options?: AciExecuteOptions) => {
        calls.push({ op, args, options });
        if (op === "process.start") return observation(op, snapshot());
        pollAttempts += 1;
        if (pollAttempts === 1) {
          throw new AciTransportError("E_ACI_TRANSPORT", "transport restarted");
        }
        return observation(op, snapshot({ state: "exited", cursor: 2, text: "ok" }));
      }),
    };
    const fake = fakeManager([client]);
    const handle = await startGovernedVerseShellProcess(baseOptions(fake.manager));

    await expect(handle.wait()).resolves.toMatchObject({ state: "exited", exitCode: 0 });
    expect(calls.filter((call) => call.op === "process.start")).toHaveLength(1);
    expect(calls.filter((call) => call.op === "process.poll")).toHaveLength(2);
    expect(calls.filter((call) => call.op === "process.poll").every((call) => call.options?.effectful !== true)).toBe(true);
    expect(fake.getClient.mock.calls).toHaveLength(1);
  });

  it("returns an explicit EOF error instead of acknowledging a failed close", async () => {
    let finishPoll!: (value: Observation) => void;
    const pollResult = new Promise<Observation>((resolve) => {
      finishPoll = resolve;
    });
    const client = {
      processKey: "eof-failure",
      execute: vi.fn(async (op: string, args: JsonObject) => {
        if (op === "process.start") return observation(op, snapshot());
        if (op === "process.poll") return await pollResult;
        if (op === "process.write" && args.eof === true) {
          return observation(op, {}, {
            ok: false,
            error: { code: "E_PROCESS_EXITED", message: "process already exited", recoverable: false },
          });
        }
        if (op === "process.kill" || op === "process.write") return observation(op, {});
        throw new Error(`unexpected operation ${op}`);
      }),
    };
    const fake = fakeManager([client]);
    const handle = await startGovernedVerseShellProcess(baseOptions(fake.manager));

    await expect(new Promise<void>((resolve, reject) => {
      handle.stdin.end((error) => error ? reject(error) : resolve());
    })).rejects.toMatchObject({ code: "E_PROCESS_EXITED" });
    expect(handle.stdin).toMatchObject({ destroyed: true, writable: false, writableEnded: true });

    finishPoll(observation("process.poll", snapshot({ state: "exited", exitCode: 0 })));
    await handle.wait();
  });

  it("keeps a windows-cmd plan auditable without reparsing the display command", async () => {
    const calls: ExecuteCall[] = [];
    const client = {
      processKey: "batch",
      execute: vi.fn(async (op: string, args: JsonObject, options?: AciExecuteOptions) => {
        calls.push({ op, args, options });
        return observation(op, snapshot({ state: "exited", exitCode: 0 }));
      }),
    };
    const fake = fakeManager([client]);
    const script = "C:\\repo\\build.cmd";
    const handle = await startGovernedVerseShellProcess(baseOptions(fake.manager, {
      command: "build.cmd && this text is never reparsed",
      executionPlan: {
        mode: "argv",
        profile: "build",
        argv: [script, "--watch"],
        displayCommand: "build.cmd && this text is never reparsed",
        executable: script,
        resolvedExecutable: script,
        resolvedScript: script,
        interpreter: "C:\\Windows\\System32\\cmd.exe",
        interpreterProfile: "windows-cmd",
        profileDefinition: getVerseShellCommandProfileDefinition("build"),
        externalWritePolicy: resolveVerseShellExternalWritePolicy({
          profile: "build",
          argv: [script, "--watch"],
        }),
      },
    }));

    await expect(handle.wait()).resolves.toMatchObject({ state: "exited", exitCode: 0 });
    const start = calls.find((call) => call.op === "process.start");
    const startArgv = start?.args.argv;
    expect(startArgv).toEqual([script, "--watch"]);
    expect(start?.args).not.toHaveProperty("interpreter");
  });

  it("fails closed when a windows-cmd plan drifts from its script identity", async () => {
    const fake = fakeManager([]);
    await expect(startGovernedVerseShellProcess(baseOptions(fake.manager, {
      command: "ignored",
      executionPlan: {
        mode: "argv",
        profile: "build",
        argv: ["C:\\other\\path.cmd"],
        displayCommand: "ignored",
        executable: "C:\\other\\path.cmd",
        resolvedScript: "C:\\repo\\build.cmd",
        interpreter: "C:\\Windows\\System32\\cmd.exe",
        interpreterProfile: "windows-cmd",
        profileDefinition: getVerseShellCommandProfileDefinition("build"),
        externalWritePolicy: resolveVerseShellExternalWritePolicy({
          profile: "build",
          argv: ["C:\\other\\path.cmd"],
        }),
      },
    }))).rejects.toMatchObject({ code: "E_VERSESHELL_SCRIPT_IDENTITY" });
    expect(fake.getClient.mock.calls).toHaveLength(0);
  });

  it("clamps timeout and output above the profile bounds", async () => {
    const calls: ExecuteCall[] = [];
    const client = {
      processKey: "clamp",
      execute: vi.fn(async (op: string, args: JsonObject, options?: AciExecuteOptions) => {
        calls.push({ op, args, options });
        return observation(op, snapshot({ state: "exited", exitCode: 0 }));
      }),
    };
    const fake = fakeManager([client]);
    const handle = await startGovernedVerseShellProcess(baseOptions(fake.manager, {
      timeoutMs: 2 * 60 * 60 * 1000,
      maxOutputBytes: 128 * 1024 * 1024,
      executionPlan: {
        mode: "argv",
        profile: "build",
        argv: ["pnpm", "run", "build"],
        displayCommand: "pnpm run build",
        executable: "pnpm",
        profileDefinition: getVerseShellCommandProfileDefinition("build"),
        externalWritePolicy: resolveVerseShellExternalWritePolicy({
          profile: "build",
          argv: ["pnpm", "run", "build"],
        }),
      },
    }));

    await expect(handle.wait()).resolves.toMatchObject({ state: "exited", exitCode: 0 });
    const start = calls.find((call) => call.op === "process.start");
    expect(start?.args.timeout_ms).toBe(60 * 60 * 1000);
    expect(start?.args.max_output_bytes).toBe(32 * 1024 * 1024);
  });

  it("clamps the timeout floor to 1ms and uses the profile default when unset", async () => {
    const calls: ExecuteCall[] = [];
    const client = {
      processKey: "floor",
      execute: vi.fn(async (op: string, args: JsonObject, options?: AciExecuteOptions) => {
        calls.push({ op, args, options });
        return observation(op, snapshot({ state: "exited", exitCode: 0 }));
      }),
    };
    const fake = fakeManager([client, client]);
    const plan = {
      mode: "argv" as const,
      profile: "generic" as const,
      argv: ["node", "--version"],
      displayCommand: "node --version",
      executable: "node",
      profileDefinition: getVerseShellCommandProfileDefinition("generic"),
      externalWritePolicy: resolveVerseShellExternalWritePolicy({
        profile: "generic",
        argv: ["node", "--version"],
      }),
    };
    const floored = await startGovernedVerseShellProcess(baseOptions(fake.manager, { timeoutMs: 0, executionPlan: plan }));
    const defaulted = await startGovernedVerseShellProcess(baseOptions(fake.manager, { timeoutMs: undefined, executionPlan: plan }));
    await expect(floored.wait()).resolves.toMatchObject({ state: "exited" });
    await expect(defaulted.wait()).resolves.toMatchObject({ state: "exited" });
    expect(calls.filter((call) => call.op === "process.start").map((call) => call.args.timeout_ms)).toEqual([1, 10 * 60 * 1000]);
  });
  it('sends the requested Job limits and records how enforcement was established', async () => {
    const calls: ExecuteCall[] = [];
    const client = {
      processKey: 'resource-limits',
      execute: vi.fn(async (op: string, args: JsonObject) => {
        calls.push({ op, args });
        if (op === 'process.start') return observation(op, snapshot());
        if (op === 'process.poll') return observation(op, { ...snapshot(), state: 'exited', exit_code: 0 });
        if (op === 'process.kill') return observation(op, {});
        throw new Error('unexpected operation ' + op);
      }),
    };
    const fake = fakeManager([client]);
    const handle = await startGovernedVerseShellProcess(baseOptions(fake.manager, {
      resourceLimits: { maxMemoryBytes: 64 * 1024 * 1024, maxProcesses: 4, requireEnforcement: true },
    }));

    const startArgs = calls.find((call) => call.op === 'process.start')?.args;
    expect(startArgs).toMatchObject({ max_memory_mb: 64, max_processes: 4 });
    expect(handle.resourceReceipt).toMatchObject({
      requested: { maxMemoryBytes: 64 * 1024 * 1024, maxProcesses: 4, requireEnforcement: true },
      applied: { maxMemoryMb: 64, maxProcesses: 4 },
      enforced: true,
      enforcement: 'job-object',
      evidence: 'job-object-configured',
      readback: 'unavailable',
    });
    expect(handle.resourceReceipt.detail ?? '').toContain('no');
    expect(handle.resourceReceipt.detail ?? '').toContain('QueryInformationJobObject');
    await handle.wait();
  });

  it('does not claim enforcement when no limits were requested', async () => {
    const client = {
      processKey: 'resource-receipt',
      execute: vi.fn(async (op: string) => {
        if (op === 'process.start') return observation(op, snapshot());
        if (op === 'process.poll') return observation(op, { ...snapshot(), state: 'exited', exit_code: 0 });
        if (op === 'process.kill') return observation(op, {});
        throw new Error('unexpected operation ' + op);
      }),
    };
    const fake = fakeManager([client]);
    const handle = await startGovernedVerseShellProcess(baseOptions(fake.manager));
    expect(handle.resourceReceipt).toMatchObject({
      requested: {},
      applied: {},
      enforced: false,
      enforcement: 'unsupported',
      evidence: 'none',
      readback: 'unavailable',
    });
    await handle.wait();
  });

  it('fails closed when the executor refuses to start with the requested limits', async () => {
    const calls: ExecuteCall[] = [];
    const client = {
      processKey: 'resource-refused',
      execute: vi.fn(async (op: string, args: JsonObject) => {
        calls.push({ op, args });
        return observation(op, {}, {
          ok: false,
          error: { code: 'E_INVALID_ARGS', message: 'max_processes is not supported', recoverable: false },
        });
      }),
    };
    const fake = fakeManager([client]);
    await expect(startGovernedVerseShellProcess(baseOptions(fake.manager, {
      resourceLimits: { maxProcesses: 2, requireEnforcement: true },
    }))).rejects.toMatchObject({ code: 'E_INVALID_ARGS' });
    expect(calls.find((call) => call.op === 'process.start')?.args).toMatchObject({ max_processes: 2 });
  });
});
