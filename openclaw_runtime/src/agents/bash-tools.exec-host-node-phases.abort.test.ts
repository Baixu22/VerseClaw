import { afterEach, describe, expect, it, vi } from "vitest";

const gatewayCall = vi.hoisted(() => vi.fn());
const listNodes = vi.hoisted(() => vi.fn());

vi.mock("./tools/gateway.js", () => ({ callGatewayTool: gatewayCall }));
vi.mock("./tools/nodes-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tools/nodes-utils.js")>();
  return { ...actual, listNodes };
});

import {
  analyzeNodeApprovalRequirement,
  prepareNodeSystemRun,
  resolveNodeExecutionTarget,
} from "./bash-tools.exec-host-node-phases.js";

const targetRequest = {
  command: "echo done",
  workdir: "/tmp",
  env: {},
  security: "allowlist" as const,
  ask: "always" as const,
  defaultTimeoutSec: 30,
  approvalRunningNoticeMs: 0,
  warnings: [],
};

const target = {
  nodeId: "node-1",
  argv: ["sh", "-lc", "echo done"],
  env: undefined,
  invokeTimeoutMs: 35_000,
  runTimeoutSec: 30,
  supportsSystemRunPrepare: true,
};

const prepared = {
  plan: {
    argv: target.argv,
    commandText: "echo done",
    cwd: "/tmp",
  },
  argv: target.argv,
  rawCommand: "echo done",
  cwd: "/tmp",
  agentId: undefined,
  sessionKey: undefined,
};

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function expectAbortWithin<T>(promise: Promise<T>, reason: unknown) {
  const outcome = await Promise.race([
    promise.then(
      () => "resolved",
      (error) => error,
    ),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 100)),
  ]);
  expect(outcome).toBe(reason);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("node-host phase cancellation", () => {
  it("TF-0214 releases the local wait while resolving a node target", async () => {
    const deferred = pending<unknown[]>();
    listNodes.mockReturnValue(deferred.promise);
    const abort = new AbortController();
    const reason = new DOMException("operator cancelled", "AbortError");
    const request = { ...targetRequest, signal: abort.signal };
    const result = resolveNodeExecutionTarget(request);
    abort.abort(reason);
    await expectAbortWithin(result, reason);
    deferred.resolve([{ nodeId: "node-1", connected: true, commands: ["system.run"] }]);
  });

  it("TF-0215 releases the local wait while preparing a remote system run", async () => {
    const deferred = pending<unknown>();
    gatewayCall.mockReturnValue(deferred.promise);
    const abort = new AbortController();
    const reason = new DOMException("operator cancelled", "AbortError");
    const result = prepareNodeSystemRun({
      request: { ...targetRequest, signal: abort.signal },
      target,
    });
    abort.abort(reason);
    await expectAbortWithin(result, reason);
    deferred.resolve({ payload: { plan: prepared.plan } });
  });

  it("TF-0216 releases the local wait while reading remote approval policy", async () => {
    const deferred = pending<unknown>();
    gatewayCall.mockReturnValue(deferred.promise);
    const abort = new AbortController();
    const reason = new DOMException("operator cancelled", "AbortError");
    const result = analyzeNodeApprovalRequirement({
      request: { ...targetRequest, signal: abort.signal },
      target: { ...target, supportsSystemRunPrepare: false },
      prepared,
      hostSecurity: "full",
      hostAsk: "always",
    });
    expect(gatewayCall).toHaveBeenCalledOnce();
    abort.abort(reason);
    await expectAbortWithin(result, reason);
    deferred.resolve({ file: {} });
  });

  it("TF-0223 uses the configured default timeout for a non-positive node timeout", async () => {
    listNodes.mockResolvedValue([
      { nodeId: "node-1", connected: true, platform: "linux", commands: ["system.run"] },
    ]);
    const resolved = await resolveNodeExecutionTarget({ ...targetRequest, timeoutSec: 0 });
    expect(resolved.runTimeoutSec).toBe(30);
  });
});
