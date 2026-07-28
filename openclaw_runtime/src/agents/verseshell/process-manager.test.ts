import { createHash } from "node:crypto";
import type { SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AciProcessExitedError, AciProtocolError, AciTimeoutError } from "./aci-client.js";
import {
  type AciChildProcess,
  type AciSpawn,
  resolveDefaultVerseShellBinary,
  VerseShellProcessManager,
  type VerseShellProcessConfig,
} from "./process-manager.js";
import { parseAciFrame } from "./normalizer.js";
import {
  resolveVerseShellPolicyProfile,
  VERSESHELL_GOVERNED_EXEC_PROFILE_ID,
} from "./policy-profile.js";

const SCHEMA = "verseshell.observation/v1";

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
  const canonical = process.platform === "win32" ? resolved.replace(/\\/g, "/").toLowerCase() : resolved;
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

function harness(handler?: FakeHandler) {
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
    ["malformed", (request: Request, child: FakeChild) => child.raw("not-json\n")],
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
});
