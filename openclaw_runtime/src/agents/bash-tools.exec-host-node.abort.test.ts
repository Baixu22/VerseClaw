import { afterEach, describe, expect, it, vi } from "vitest";

const phases = vi.hoisted(() => ({
  resolveNodeExecutionTarget: vi.fn(),
  invokeNodeSystemRunDirect: vi.fn(),
  prepareNodeSystemRun: vi.fn(),
  shouldSkipNodeApprovalPrepare: vi.fn(),
  analyzeNodeApprovalRequirement: vi.fn(),
}));

vi.mock("./bash-tools.exec-host-node-phases.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bash-tools.exec-host-node-phases.js")>();
  return {
    ...actual,
    resolveNodeExecutionTarget: phases.resolveNodeExecutionTarget,
    invokeNodeSystemRunDirect: phases.invokeNodeSystemRunDirect,
    prepareNodeSystemRun: phases.prepareNodeSystemRun,
    shouldSkipNodeApprovalPrepare: phases.shouldSkipNodeApprovalPrepare,
    analyzeNodeApprovalRequirement: phases.analyzeNodeApprovalRequirement,
  };
});

import { executeNodeHostCommand } from "./bash-tools.exec-host-node.js";

const target = {
  nodeId: "node-1",
  argv: ["echo", "done"],
  env: undefined,
  invokeTimeoutMs: 15_000,
  runTimeoutSec: 30,
  supportsSystemRunPrepare: false,
};

function baseParams(signal: AbortSignal) {
  return {
    command: "echo done",
    workdir: "/tmp",
    env: {},
    security: "full" as const,
    ask: "off" as const,
    defaultTimeoutSec: 30,
    approvalRunningNoticeMs: 0,
    warnings: [] as string[],
    signal,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("node-host exec cancellation", () => {
  it("does not invoke after cancellation during target resolution", async () => {
    const abort = new AbortController();
    const reason = new DOMException("operator cancelled", "AbortError");
    phases.shouldSkipNodeApprovalPrepare.mockReturnValue(true);
    phases.resolveNodeExecutionTarget.mockImplementation(async () => {
      abort.abort(reason);
      return target;
    });
    await expect(executeNodeHostCommand(baseParams(abort.signal))).rejects.toBe(reason);
    expect(phases.invokeNodeSystemRunDirect).not.toHaveBeenCalled();
  });

  it("does not invoke after cancellation during prepare", async () => {
    const abort = new AbortController();
    const reason = new DOMException("operator cancelled", "AbortError");
    phases.shouldSkipNodeApprovalPrepare.mockReturnValue(false);
    phases.resolveNodeExecutionTarget.mockResolvedValue(target);
    phases.prepareNodeSystemRun.mockImplementation(async () => {
      abort.abort(reason);
      return {
        plan: {},
        argv: ["echo", "done"],
        rawCommand: "echo done",
        cwd: "/tmp",
        agentId: "main",
        sessionKey: "session",
      };
    });
    await expect(executeNodeHostCommand(baseParams(abort.signal))).rejects.toBe(reason);
    expect(phases.invokeNodeSystemRunDirect).not.toHaveBeenCalled();
    expect(phases.analyzeNodeApprovalRequirement).not.toHaveBeenCalled();
  });
});
