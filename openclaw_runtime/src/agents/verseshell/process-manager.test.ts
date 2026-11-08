import { createHash } from "node:crypto";
import type { SpawnOptions } from "node:child_process";
import { realpathSync } from "node:fs";
import { EventEmitter, getEventListeners } from "node:events";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AciProcessExitedError,
  AciProtocolError,
  AciTimeoutError,
} from "./aci-client.js";
import {
  type AciChildProcess,
  type AciSpawn,
  resolveDefaultVerseShellBinary,
  VerseShellProcessManager,
  type VerseShellProcessConfig,
  type VerseShellProcessManagerOptions,
} from "./process-manager.js";
import { parseAciFrame } from "./normalizer.js";
import {
  resolveVerseShellPolicyProfile,
  VERSESHELL_GOVERNED_EXEC_PROFILE_ID,
} from "./policy-profile.js";

const SCHEMA = "verseshell.observation/v1";

describe("poll control capacity", () => {
  it("leaves an executor slot for stdin while long polls are pending", async () => {
    const config = { ...baseConfig(), maxConcurrency: 2, requestTimeoutMs: 5000 };
    const h = harness((request, child) => {
      if (request.op === "runtime.handshake") child.respond(request, { data: { ...handshakeData(config), max_concurrency: 2 } });
      else if (request.op !== "process.poll") child.respond(request);
    });
    h.setConfig(config);
    const client = await h.manager.getClient(config);
    const polls = Array.from({ length: 4 }, () => client.execute("process.poll", { wait_ms: 1000 }).catch(error => error));
    const input = client.execute("process.write", { data: "control" });
    try {
      await expect(input).resolves.toMatchObject({ ok: true });
      expect(h.children[0].requests.filter(request => request.op === "process.poll")).toHaveLength(1);
    } finally { await h.manager.shutdownAll(); await Promise.all(polls); }
  });
  it("removes successful request abort listeners and keeps a retained idle executor", async () => {
    const h = harness(undefined, { idleTtlMs: 1 }); const client = await h.manager.getClient(baseConfig());
    const release = h.manager.retainProcess(client.processKey); const controller = new AbortController();
    for (let i = 0; i < 20; i++) await client.execute("file.view", {}, { signal: controller.signal });
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    await new Promise(resolve => setTimeout(resolve, 5)); expect(await h.manager.collectIdle()).toBe(0);
    await release(); await release(); expect(h.manager.list()).toHaveLength(0);
    await h.manager.shutdownAll();
  });
  it("stops dispatch under stdin backpressure and removes the drain listener on shutdown", async () => {
    const h = harness(); const client = await h.manager.getClient(baseConfig()); const child = h.children[0];
    const write = child.stdin.write.bind(child.stdin);
    vi.spyOn(child.stdin, "write").mockImplementation(((...args: Parameters<typeof child.stdin.write>) => { write(...args); return false; }) as typeof child.stdin.write);
    await client.execute("file.view", {});
    expect(child.stdin.listenerCount("drain")).toBe(1);
    const pending = client.execute("file.view", {}).catch(error => error);
    await Promise.resolve(); expect(child.requests.filter(request => request.op === "file.view")).toHaveLength(1);
    await h.manager.shutdownAll(); await pending; expect(child.stdin.listenerCount("drain")).toBe(0);
  });
});

type Request = {
  id: string;
  op: string;
  args: Record<string, unknown>;
  agent: string;
  timeout_ms: number;
  budget: { max_tokens: number };
};

type FakeHandler = (request: Request, child: FakeChild) => void;

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly requests: Request[] = [];
  readonly stdin: Writable;
  pid = undefined;
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  private buffer = "";

  constructor(private readonly handler: FakeHandler) {
    super();
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        this.buffer += chunk.toString("utf8");
        while (this.buffer.includes("\n")) {
          const newline = this.buffer.indexOf("\n");
          const line = this.buffer.slice(0, newline).trim();
          this.buffer = this.buffer.slice(newline + 1);
          if (line === "SHUTDOWN") {
            queueMicrotask(() => this.close(0, null));
          } else if (line) {
            const request = JSON.parse(line) as Request;
            this.requests.push(request);
            this.handler(request, this);
          }
        }
        callback();
      },
    });
  }

  respond(request: Request, overrides: Record<string, unknown> = {}): void {
    const observation = {
      schema: SCHEMA,
      id: request.id,
      op: request.op,
      ok: true,
      status: "ok",
      data: { echoed_op: request.op },
      meta: { elapsed_ms: 1, profile: "test", token_estimate: 1 },
      ...overrides,
    };
    queueMicrotask(() => this.stdout.write(`${JSON.stringify(observation)}\n`));
  }

  raw(line: string): void {
    queueMicrotask(() => this.stdout.write(line));
  }

  crash(code = 1): void {
    queueMicrotask(() => this.close(code, null));
  }

  kill(signal: NodeJS.Signals | number = "SIGTERM"): boolean {
    this.killed = true;
    const normalized = typeof signal === "string" ? signal : "SIGTERM";
    queueMicrotask(() => this.close(null, normalized));
    return true;
  }

  private close(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("close", code, signal);
  }
}

function canonicalWorkspaceId(workspace: string): string {
  const resolved = path.resolve(workspace);
  // Mirror the manager's canonicalWorkspace contract: realpath first (junctions
  // and symlinks must resolve to the same workspace id), then normalize.
  let canonical = resolved;
  try {
    canonical = realpathSync(resolved);
  } catch {
    // Workspace may not exist on disk in some fixtures; path.resolve is the
    // best available canonical form there.
  }
  if (process.platform === "win32") canonical = canonical.replace(/\\/g, "/").toLowerCase();
  return `ws_sha256_${createHash("sha256").update(canonical).digest("hex")}`;
}

function handshakeData(config: VerseShellProcessConfig) {
  const profile = resolveVerseShellPolicyProfile(config.policyProfile);
  return {
    crate_version: config.expectedBinaryVersion,
    runtime_version: config.expectedBinaryVersion,
    server_protocol: config.expectedProtocolVersion,
    observation_schema: SCHEMA,
    operation_catalog_schema: "verseshell.operation-catalog/v1",
    workspace: { id: canonicalWorkspaceId(config.workspace), canonical: true },
    capabilities: { mode: "allow_list", granted: [...profile.capabilities].sort() },
    policy_mode: "agent_strict",
    policy_profile: { id: profile.id, digest: profile.digest },
    artifact_defaults: { ttl_seconds: 86_400, max_total_bytes: 536_870_912 },
    max_concurrency: 4,
    operation_catalog: { digest: config.expectedCatalogDigest, count: config.expectedCatalogCount },
    features: ["typed_operations", "result_artifacts", "bound_approvals", "legacy_cmd"],
  };
}

function baseConfig(workspace = process.cwd()): VerseShellProcessConfig {
  return {
    workspace,
    policyProfile: VERSESHELL_GOVERNED_EXEC_PROFILE_ID,
    expectedBinaryVersion: "1.0.0",
    expectedProtocolVersion: "verseshell.jsonl/v1",
    expectedCatalogDigest: `sha256:${"a".repeat(64)}`,
    expectedCatalogCount: 26,
    requestTimeoutMs: 50,
    handshakeTimeoutMs: 100,
    maxLineBytes: 4_096,
  };
}

function harness(handler?: FakeHandler, options: VerseShellProcessManagerOptions = {}) {
  const children: FakeChild[] = [];
  const invocations: Array<{
    command: string;
    args: readonly string[];
    options: SpawnOptions;
  }> = [];
  let config = baseConfig();
  const defaultHandler: FakeHandler = (request, child) => {
    if (request.op === "runtime.handshake") {
      child.respond(request, { data: handshakeData(config) });
    } else {
      child.respond(request);
    }
  };
  const spawnProcess: AciSpawn = (command, args, options) => {
    invocations.push({ command, args, options });
    const child = new FakeChild(handler ?? defaultHandler);
    children.push(child);
    return child as unknown as AciChildProcess;
  };
  const manager = new VerseShellProcessManager({
    spawnProcess,
    resolveBinary: () => ({ path: "C:/fixture/ae.exe", source: "test", verified: true }),
    restartBaseDelayMs: 5,
    restartMaxDelayMs: 5,
    shutdownGraceMs: 5,
    idleTtlMs: 10_000,
    ...options,
  });
  return {
    manager,
    children,
    invocations,
    setConfig(value: VerseShellProcessConfig) {
      config = value;
    },
  };
}

const managers: VerseShellProcessManager[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.allSettled(managers.splice(0).map((manager) => manager.shutdownAll()));
});

describe("typed ACI framing", () => {
  it("decodes schema/op/data observations without the legacy value envelope", () => {
    const raw = JSON.stringify({
      schema: SCHEMA,
      id: "r1",
      op: "file.view",
      ok: true,
      status: "ok",
      data: { content: "hello" },
      diagnostics: [],
      meta: { elapsed_ms: 2, profile: "minimal", token_estimate: 4 },
      suggested_next: [],
    });
    const frame = parseAciFrame(raw, 4_096);
    expect(frame?.kind).toBe("observation");
    if (frame?.kind === "observation") {
      expect(frame.observation.op).toBe("file.view");
      expect(frame.observation.data).toEqual({ content: "hello" });
      expect("value" in frame.observation).toBe(false);
    }
  });
});

describe("VerseShellProcessManager", () => {
  function gate() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  }

  it("shares one pending resolver, spawn and handshake across concurrent callers", async () => {
    const entered = gate();
    const ready = gate();
    const resolveBinary = vi.fn(async () => {
      entered.resolve();
      await ready.promise;
      return { path: "fixture-ae", source: "test" as const, verified: true };
    });
    const h = harness(undefined, { resolveBinary, maxProcesses: 1 });
    managers.push(h.manager);
    const config = { ...baseConfig(), handshakeTimeoutMs: 2_000 };
    const clients = Promise.all(Array.from({ length: 8 }, () => h.manager.getClient(config)));
    await entered.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    ready.resolve();
    const results = await clients;
    expect(new Set(results.map((client) => client.processKey)).size).toBe(1);
    expect(resolveBinary).toHaveBeenCalledOnce();
    expect(h.invocations).toHaveLength(1);
    await h.manager.shutdownAll();
    expect(h.children.every((child) => child.exitCode === 0)).toBe(true);
  });

  it("counts pending binary resolution against the cap for distinct keys", async () => {
    const entered = gate();
    const ready = gate();
    const h = harness(undefined, {
      maxProcesses: 1,
      resolveBinary: async () => {
        entered.resolve();
        await ready.promise;
        return { path: "fixture-ae", source: "test", verified: true };
      },
    });
    managers.push(h.manager);
    const config = baseConfig();
    const results = Promise.allSettled([
      h.manager.getClient(config),
      h.manager.getClient({ ...config, approvalToken: "apv_0123456789abcdef" }),
    ]);
    await entered.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    ready.resolve();
    const settled = await results;
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected")).toMatchObject([
      { reason: { code: "E_ACI_PROCESS_LIMIT" } },
    ]);
    expect(h.invocations).toHaveLength(1);
  });

  it("does not publish a second client before the shared handshake completes", async () => {
    const requests: Array<{ request: Request; child: FakeChild }> = [];
    const h = harness((request, child) => { requests.push({ request, child }); });
    managers.push(h.manager);
    const config = { ...baseConfig(), handshakeTimeoutMs: 2_000 };
    const first = h.manager.getClient(config);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    let published = false;
    const second = h.manager.getClient(config).then((client) => { published = true; return client; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(published).toBe(false);
    const held = requests[0];
    held.child.respond(held.request, { data: handshakeData(config) });
    await Promise.all([first, second]);
    expect(h.invocations).toHaveLength(1);
  });

  it("rejects all concurrent clients when the shared handshake fails", async () => {
    const requests: Array<{ request: Request; child: FakeChild }> = [];
    const h = harness((request, child) => { requests.push({ request, child }); });
    managers.push(h.manager);
    const config = { ...baseConfig(), handshakeTimeoutMs: 2_000 };
    const first = h.manager.getClient(config).catch((error: unknown) => error);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const second = h.manager.getClient(config).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 20));
    requests[0].child.respond(requests[0].request, { data: { ...handshakeData(config), policy_mode: "permissive" } });
    expect(await first).toMatchObject({ code: "E_ACI_PROTOCOL" });
    expect(await second).toMatchObject({ code: "E_ACI_PROTOCOL" });
    expect(h.invocations).toHaveLength(1);
    expect(h.manager.list()).toEqual([]);
  });

  it("shares concurrent workspace shutdown and rejects new work until owned cleanup finishes", async () => {
    let finishClose!: () => void;
    let startedClose!: () => void;
    const closing = new Promise<void>((resolve) => { startedClose = resolve; });
    const h = harness(undefined, { shutdownGraceMs: 2_000 });
    managers.push(h.manager);
    const client = await h.manager.getClient(baseConfig());
    const child = h.children[0];
    child.stdin.write = vi.fn(() => {
      finishClose = () => child.emit("close", 0, null);
      startedClose();
      return true;
    }) as typeof child.stdin.write;
    const first = h.manager.shutdownWorkspace(process.cwd());
    await closing;
    const second = h.manager.shutdownWorkspace(process.cwd());
    await expect(h.manager.getClient(baseConfig())).rejects.toMatchObject({ code: "E_ACI_SHUTDOWN" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    finishClose();
    expect(await first).toBe(1);
    expect(await second).toBe(1);
    expect(h.manager.health(client.processKey)).toBeUndefined();
  });

  it("rejects every waiter on a failed startup and permits a later retry", async () => {
    const entered = gate();
    const ready = gate();
    let fail = true;
    const h = harness(undefined, {
      maxProcesses: 1,
      resolveBinary: async () => {
        entered.resolve();
        await ready.promise;
        if (fail) throw new Error("injected resolution failure");
        return { path: "fixture-ae", source: "test", verified: true };
      },
    });
    managers.push(h.manager);
    const pending = Promise.allSettled(Array.from({ length: 4 }, () => h.manager.getClient(baseConfig())));
    await entered.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    ready.resolve();
    expect(await pending).toEqual(Array.from({ length: 4 }, () => ({
      status: "rejected", reason: expect.objectContaining({ message: "injected resolution failure" }),
    })));
    expect(h.manager.list()).toEqual([]);
    fail = false;
    await h.manager.getClient(baseConfig());
    expect(h.invocations).toHaveLength(1);
  });

  it.each(["all", "workspace", "kill-switch"] as const)(
    "fences pending binary resolution during %s shutdown without a late spawn",
    async (scope) => {
      const entered = gate();
      const ready = gate();
      const h = harness(undefined, { resolveBinary: async () => {
        entered.resolve();
        await ready.promise;
        return { path: "fixture-ae", source: "test", verified: true };
      } });
      managers.push(h.manager);
      const pending = h.manager.getClient(baseConfig()).catch((error: unknown) => error);
      await entered.promise;
      if (scope === "all") await h.manager.shutdownAll();
      else if (scope === "workspace") await h.manager.shutdownWorkspace(process.cwd());
      else await h.manager.tripKillSwitch();
      expect(await pending).toMatchObject({ code: scope === "kill-switch" ? "E_ACI_KILL_SWITCH" : "E_ACI_SHUTDOWN" });
      ready.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(h.invocations).toHaveLength(0);
      expect(h.manager.list()).toEqual([]);
      if (scope === "workspace") {
        await h.manager.getClient(baseConfig());
        expect(h.invocations).toHaveLength(1);
      }
    },
  );

  it("closes a process while its handshake is pending and rejects every waiter", async () => {
    const h = harness(() => {});
    managers.push(h.manager);
    const config = { ...baseConfig(), handshakeTimeoutMs: 2_000 };
    const first = h.manager.getClient(config).catch((error: unknown) => error);
    await vi.waitFor(() => expect(h.manager.list()).toHaveLength(1));
    const second = h.manager.getClient(config).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await h.manager.shutdownProcess(h.manager.list()[0].key)).toBe(true);
    expect(await first).toMatchObject({ code: "E_ACI_SHUTDOWN" });
    expect(await second).toMatchObject({ code: "E_ACI_SHUTDOWN" });
    expect(h.children.every((child) => child.exitCode === 0)).toBe(true);
    expect(h.manager.list()).toEqual([]);
  });

  it("fences shutdownAll before workspace canonicalization completes", async () => {
    const h = harness();
    managers.push(h.manager);
    const pending = h.manager.getClient(baseConfig()).catch((error: unknown) => error);
    await h.manager.shutdownAll();
    expect(await pending).toMatchObject({ code: "E_ACI_SHUTDOWN" });
    expect(h.invocations).toHaveLength(0);
  });

  it("uses handshake data, JSON mode, non-permissive policy, and one comma-separated --cap", async () => {
    const h = harness();
    managers.push(h.manager);
    const config = baseConfig();
    h.setConfig(config);
    const client = await h.manager.getClient(config);

    expect(client.capabilities).toEqual(["shell.exec"]);
    const args = h.invocations[0].args;
    expect(args).toContain("--agent");
    expect(args.slice(args.indexOf("--format"), args.indexOf("--format") + 2)).toEqual([
      "--format",
      "json",
    ]);
    expect(args.filter((arg) => arg === "--cap")).toHaveLength(1);
    expect(args[args.indexOf("--cap") + 1]).toBe("shell.exec");
    expect(args).not.toContain("all");
    expect(args).not.toContain("permissive");
    expect(args.slice(args.indexOf("--policy"), args.indexOf("--policy") + 2)).toEqual([
      "--policy",
      "strict",
    ]);
    expect(h.children[0].requests[0]).toMatchObject({
      op: "runtime.handshake",
      args: {},
      budget: { max_tokens: 4_000 },
    });
  });

  it("isolates process keys by canonical workspace and action-bound approval token", async () => {
    const h = harness();
    managers.push(h.manager);
    const first = baseConfig();
    h.setConfig(first);
    const client1 = await h.manager.getClient(first);

    const equivalent = baseConfig();
    h.setConfig(equivalent);
    const client2 = await h.manager.getClient(equivalent);
    expect(client2.processKey).toBe(client1.processKey);
    expect(client1.capabilities).toEqual(["shell.exec"]);
    expect(h.children).toHaveLength(1);

    const distinct = baseConfig();
    distinct.approvalToken = "apv_0123456789abcdef";
    h.setConfig(distinct);
    const client3 = await h.manager.getClient(distinct);
    expect(client3.processKey).not.toBe(client1.processKey);
    expect(h.children).toHaveLength(2);
  });

  it("removes inherited broad approvals and redacts action tokens from health", async () => {
    const previousApproval = process.env.AETHER_APPROVE;
    const previousApprovalAll = process.env.AETHER_APPROVE_ALL;
    process.env.AETHER_APPROVE = "apv_ffffffffffffffff";
    process.env.AETHER_APPROVE_ALL = "1";
    try {
      const h = harness();
      managers.push(h.manager);
      const config = {
        ...baseConfig(),
        approvalToken: "apv_0123456789abcdef",
      };
      h.setConfig(config);
      await h.manager.getClient(config);

      const childEnv = h.invocations[0].options.env as NodeJS.ProcessEnv;
      expect(childEnv.AETHER_APPROVE).toBe(config.approvalToken);
      expect(childEnv.AETHER_APPROVE_ALL).toBeUndefined();
      expect(h.invocations[0].args.join(" ")).not.toContain(config.approvalToken);

      h.children[0].stderr.write(`failed token=${config.approvalToken}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const health = JSON.stringify(h.manager.list());
      expect(health).not.toContain(config.approvalToken);
      expect(health).toContain("[REDACTED_APPROVAL_TOKEN]");
    } finally {
      if (previousApproval === undefined) delete process.env.AETHER_APPROVE;
      else process.env.AETHER_APPROVE = previousApproval;
      if (previousApprovalAll === undefined) delete process.env.AETHER_APPROVE_ALL;
      else process.env.AETHER_APPROVE_ALL = previousApprovalAll;
    }
  });

  it("fails closed when the default binary identity was not Electron-verified", async () => {
    const previousPath = process.env.VERSESHELL_AE_PATH;
    const previousSha = process.env.VERSESHELL_AE_SHA256;
    const previousProvenance = process.env.VERSESHELL_RUNTIME_PROVENANCE;
    delete process.env.VERSESHELL_AE_PATH;
    delete process.env.VERSESHELL_AE_SHA256;
    delete process.env.VERSESHELL_RUNTIME_PROVENANCE;
    try {
      await expect(resolveDefaultVerseShellBinary()).rejects.toMatchObject({
        code: "E_ACI_BINARY_UNAVAILABLE",
      });
    } finally {
      if (previousPath === undefined) delete process.env.VERSESHELL_AE_PATH;
      else process.env.VERSESHELL_AE_PATH = previousPath;
      if (previousSha === undefined) delete process.env.VERSESHELL_AE_SHA256;
      else process.env.VERSESHELL_AE_SHA256 = previousSha;
      if (previousProvenance === undefined) delete process.env.VERSESHELL_RUNTIME_PROVENANCE;
      else process.env.VERSESHELL_RUNTIME_PROVENANCE = previousProvenance;
    }
  });

  it("rejects an unverified custom binary resolver", async () => {
    const manager = new VerseShellProcessManager({
      resolveBinary: () => ({ path: "fixture-ae", source: "test", verified: false }),
    });
    managers.push(manager);
    await expect(manager.getClient(baseConfig())).rejects.toMatchObject({
      code: "E_ACI_BINARY_UNVERIFIED",
    });
    expect(manager.list()).toEqual([]);
  });

  it("rejects a handshake whose actual server state mismatches config", async () => {
    const config = baseConfig();
    const h = harness((request, child) => {
      if (request.op === "runtime.handshake") {
        child.respond(request, {
          data: {
            ...handshakeData(config),
            capabilities: { mode: "allow_list", granted: ["file.read", "net.http"] },
          },
        });
      }
    });
    managers.push(h.manager);
    await expect(h.manager.getClient(config)).rejects.toThrow(/handshake mismatch: capabilities/);
  });

  it("rejects a handshake whose immutable policy profile binding mismatches config", async () => {
    const config = baseConfig();
    const h = harness((request, child) => {
      if (request.op === "runtime.handshake") {
        child.respond(request, {
          data: {
            ...handshakeData(config),
            policy_profile: { ...handshakeData(config).policy_profile, digest: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" },
          },
        });
      }
    });
    managers.push(h.manager);
    await expect(h.manager.getClient(config)).rejects.toThrow(/handshake mismatch: policy_profile/);
  });

  it.each([
    [
      "capability mode",
      (config: VerseShellProcessConfig) => ({
        ...handshakeData(config),
        capabilities: {
          mode: "all",
          granted: [...resolveVerseShellPolicyProfile(config.policyProfile).capabilities],
        },
      }),
      "capabilities.mode",
    ],
    [
      "operation catalog schema",
      (config: VerseShellProcessConfig) => ({
        ...handshakeData(config),
        operation_catalog_schema: "verseshell.operation-catalog/v0",
      }),
      "operation_catalog_schema",
    ],
    [
      "operation catalog count",
      (config: VerseShellProcessConfig) => ({
        ...handshakeData(config),
        operation_catalog: {
          ...handshakeData(config).operation_catalog,
          count: config.expectedCatalogCount + 1,
        },
      }),
      "operation_catalog.count",
    ],
  ])("rejects a handshake with an incompatible %s", async (_name, invalidHandshake, mismatch) => {
    const config = baseConfig();
    const h = harness((request, child) => {
      if (request.op === "runtime.handshake") {
        child.respond(request, { data: invalidHandshake(config) });
      }
    });
    managers.push(h.manager);
    await expect(h.manager.getClient(config)).rejects.toThrow(
      new RegExp(`handshake mismatch: ${mismatch}`),
    );
  });

  it.each([
    ["malformed", (_request: Request, child: FakeChild) => child.raw("not-json\n")],
    [
      "oversized",
      (_request: Request, child: FakeChild) => child.raw(`${"x".repeat(5_000)}\n`),
    ],
    [
      "request id mismatch",
      (request: Request, child: FakeChild) => child.respond(request, { id: "wrong-id" }),
    ],
  ])("rejects %s frames as transport protocol failures", async (_name, badResponse) => {
    const config = baseConfig();
    let handshaken = false;
    const h = harness((request, child) => {
      if (request.op === "runtime.handshake") {
        handshaken = true;
        child.respond(request, { data: handshakeData(config) });
      } else if (handshaken) {
        badResponse(request, child);
      }
    });
    managers.push(h.manager);
    const client = await h.manager.getClient(config);
    await expect(client.execute("file.view", { path: "a" })).rejects.toBeInstanceOf(
      AciProtocolError,
    );
  });

  it("resolves operation ok=false separately from transport errors", async () => {
    const config = baseConfig();
    const h = harness((request, child) => {
      if (request.op === "runtime.handshake") {
        child.respond(request, { data: handshakeData(config) });
      } else {
        child.respond(request, {
          ok: false,
          status: "blocked",
          data: undefined,
          error: { code: "E_DENIED", message: "denied", recoverable: false },
        });
      }
    });
    managers.push(h.manager);
    const client = await h.manager.getClient(config);
    await expect(client.execute("exec.run", { argv: ["false"] })).resolves.toMatchObject({
      op: "exec.run",
      ok: false,
      error: { code: "E_DENIED" },
    });
  });

  it("rejects pending requests on crash and never replays the effectful request", async () => {
    const config = baseConfig();
    let effectfulRequests = 0;
    const h = harness((request, child) => {
      if (request.op === "runtime.handshake") {
        child.respond(request, { data: handshakeData(config) });
      } else {
        effectfulRequests++;
        child.crash(9);
      }
    });
    managers.push(h.manager);
    const client = await h.manager.getClient(config);
    await expect(
      client.execute("exec.run", { argv: ["touch", "x"] }, { effectful: true }),
    ).rejects.toBeInstanceOf(AciProcessExitedError);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(effectfulRequests).toBe(1);
    expect(h.children.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects timed-out pending requests without native shell fallback", async () => {
    const config = baseConfig();
    const h = harness((request, child) => {
      if (request.op === "runtime.handshake") {
        child.respond(request, { data: handshakeData(config) });
      }
    });
    managers.push(h.manager);
    const client = await h.manager.getClient(config);
    await expect(client.execute("exec.run", {}, { timeoutMs: 20 })).rejects.toBeInstanceOf(
      AciTimeoutError,
    );
    expect(h.children[0].requests.filter((request) => request.op === "exec.run")).toHaveLength(1);
  });

  it("enforces per-process concurrency and drains its bounded queue", async () => {
    const config = { ...baseConfig(), maxConcurrency: 1, maxQueueSize: 2 };
    const held: Array<{ request: Request; child: FakeChild }> = [];
    const h = harness((request, child) => {
      if (request.op === "runtime.handshake") {
        child.respond(request, { data: handshakeData(config) });
      } else {
        held.push({ request, child });
      }
    });
    managers.push(h.manager);
    const client = await h.manager.getClient(config);
    const first = client.execute("file.view", { path: "one" });
    const second = client.execute("file.view", { path: "two" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(held).toHaveLength(1);
    held.shift()!.child.respond(h.children[0].requests[1]);
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(held).toHaveLength(1);
    const secondHeld = held.shift()!;
    secondHeld.child.respond(secondHeld.request);
    await second;
  });

  it("collects idle processes after the configured TTL", async () => {
    let now = 1_000;
    const children: FakeChild[] = [];
    const config = baseConfig();
    const manager = new VerseShellProcessManager({
      now: () => now,
      idleTtlMs: 10,
      idleSweepMs: 10_000,
      shutdownGraceMs: 5,
      resolveBinary: () => ({ path: "fixture-ae", source: "test", verified: true }),
      spawnProcess: (_command, _args) => {
        const child = new FakeChild((request, target) =>
          target.respond(request, { data: handshakeData(config) }),
        );
        children.push(child);
        return child as unknown as AciChildProcess;
      },
    });
    managers.push(manager);
    await manager.getClient(config);
    now += 11;
    await expect(manager.collectIdle()).resolves.toBe(1);
    expect(manager.list()).toEqual([]);
    expect(children[0].exitCode).toBe(0);
  });

  it("gracefully sends SHUTDOWN and removes all processes", async () => {
    const h = harness();
    managers.push(h.manager);
    const config = baseConfig();
    h.setConfig(config);
    await h.manager.getClient(config);
    await h.manager.shutdownAll();
    expect(h.manager.list()).toEqual([]);
    expect(h.children[0].exitCode).toBe(0);
  });

  it("binds timeout errors to host-owned request and trace metadata", async () => {
    const config = baseConfig();
    const h = harness((request, child) => {
      if (request.op === "runtime.handshake") {
        child.respond(request, { data: handshakeData(config) });
      }
    });
    managers.push(h.manager);
    const client = await h.manager.getClient(config);

    await expect(
      client.execute("file.view", { path: "slow" }, { timeoutMs: 20, traceId: "trace-p1" }),
    ).rejects.toMatchObject({
      code: "E_ACI_TIMEOUT",
      metadata: {
        requestId: expect.stringMatching(/^aci-/u),
        traceId: "trace-p1",
        processKey: client.processKey,
        lifecycleStage: "ready",
      },
    });
  });

  it("retries one explicitly read-only request after a transport restart", async () => {
    const config = baseConfig();
    let firstChild: FakeChild | undefined;
    const h = harness((request, child) => {
      if (request.op === "runtime.handshake") {
        firstChild ??= child;
        child.respond(request, { data: handshakeData(config) });
      } else if (firstChild === child) {
        child.crash(9);
      } else {
        child.respond(request);
      }
    });
    managers.push(h.manager);
    const client = await h.manager.getClient(config);

    await expect(
      client.execute("file.view", { path: "readonly" }, {
        timeoutMs: 1_000,
        traceId: "trace-retry",
        retryable: true,
      }),
    ).resolves.toMatchObject({ op: "file.view", ok: true });
    expect(h.children.length).toBeGreaterThanOrEqual(2);
    expect(h.children[0].requests.filter((request) => request.op === "file.view")).toHaveLength(1);
    expect(h.children[1].requests.filter((request) => request.op === "file.view")).toHaveLength(1);
  });

  it("rejects retry opt-in for effectful and unknown operations", async () => {
    const h = harness();
    managers.push(h.manager);
    const config = baseConfig();
    const client = await h.manager.getClient(config);

    await expect(
      client.execute("exec.run", {}, { retryable: true, effectful: true }),
    ).rejects.toMatchObject({ code: "E_ACI_RETRY_FORBIDDEN" });
    await expect(
      client.execute("custom.unknown", {}, { retryable: true }),
    ).rejects.toMatchObject({ code: "E_ACI_RETRY_FORBIDDEN" });
  });

  it("exposes handshaking health and fails closed on the operator kill switch", async () => {
    const config = baseConfig();
    let handshakeChild: FakeChild | undefined;
    let handshakeRequest: Request | undefined;
    // Deterministic hold: resolve exactly when the manager has written the
    // handshake request to the fake child's stdin. That write happens strictly
    // after `state = "handshaking"` (process-manager start()) and strictly
    // before any response, so awaiting this signal observes the handshaking
    // state without gambling on scheduler timing (issue #42).
    let captureHandshake: () => void = () => {};
    const handshakeCaptured = new Promise<void>((resolve) => {
      captureHandshake = resolve;
    });
    const h = harness((request, _child) => {
      if (request.op !== "runtime.handshake") return;
      handshakeRequest = request;
      handshakeChild = _child;
      captureHandshake();
      // Keep readiness pending long enough to inspect the handshaking state.
    });
    managers.push(h.manager);
    const pendingClient = h.manager.getClient(config);
    await handshakeCaptured;
    expect(h.manager.list()[0]?.state).toBe("handshaking");

    handshakeChild!.respond(handshakeRequest!, { data: handshakeData(config) });
    const client = await pendingClient;
    expect(client.processKey).toBe(h.manager.list()[0]?.key);
    await h.manager.tripKillSwitch("operator-test");
    await expect(h.manager.getClient(config)).rejects.toMatchObject({ code: "E_ACI_KILL_SWITCH" });
    expect(h.manager.list()[0]?.lastErrorCode).toBe("E_ACI_KILL_SWITCH");
  });
});
