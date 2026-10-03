import { afterEach, describe, expect, it, vi } from "vitest";

const phases = vi.hoisted(() => ({
  resolveNodeExecutionTarget: vi.fn(),
  invokeNodeSystemRunDirect: vi.fn(),
  prepareNodeSystemRun: vi.fn(),
  shouldSkipNodeApprovalPrepare: vi.fn(),
  analyzeNodeApprovalRequirement: vi.fn(),
}));

const approvals = vi.hoisted(() => ({ register: vi.fn(), gateway: vi.fn() }));
vi.mock("./tools/gateway.js", () => ({ callGatewayTool: approvals.gateway }));
vi.mock("./bash-tools.exec-approval-request.js", () => ({
  registerExecApprovalRequestForHostOrThrow: approvals.register,
  buildExecApprovalRequesterContext: () => ({}),
  buildExecApprovalTurnSourceContext: (params: {
    turnSourceChannel?: string;
    turnSourceTo?: string;
    turnSourceAccountId?: string;
    turnSourceThreadId?: string | number;
  }) => ({
    turnSourceChannel: params.turnSourceChannel,
    turnSourceTo: params.turnSourceTo,
    turnSourceAccountId: params.turnSourceAccountId,
    turnSourceThreadId: params.turnSourceThreadId,
  }),
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

describe("node-host exec cancellation", () => {
  it.each(["review", "registration"] as const)(
    "TF-0179 stops automatic approval after cancellation during %s",
    async (phase) => {
      const abort = new AbortController();
      const reason = new DOMException("operator cancelled", "AbortError");
      phases.resolveNodeExecutionTarget.mockResolvedValue(target);
      phases.shouldSkipNodeApprovalPrepare.mockReturnValue(false);
      phases.prepareNodeSystemRun.mockResolvedValue({
        plan: {},
        argv: ["echo", "done"],
        rawCommand: "echo done",
        cwd: "/tmp",
        agentId: "main",
        sessionKey: "session",
      });
      phases.analyzeNodeApprovalRequirement.mockResolvedValue({
        analysisOk: true,
        allowlistSatisfied: false,
        durableApprovalSatisfied: false,
        nodeApprovalPolicyKnown: true,
        nodeSecurity: "allowlist",
        nodeAsk: "on-miss",
        inlineEvalHit: null,
        requiresSecurityAuditSuppressionApproval: false,
        autoReviewArgv: ["echo", "done"],
      });
      approvals.register.mockImplementation(async () => {
        if (phase === "registration") abort.abort(reason);
      });
      const params = {
        ...baseParams(abort.signal),
        security: "allowlist" as const,
        ask: "on-miss" as const,
        autoReview: true,
        autoReviewer: async () => {
          if (phase === "review") abort.abort(reason);
          return {
            decision: "allow-once" as const,
            risk: "low" as const,
            rationale: "test command",
          };
        },
      };
      await expect(executeNodeHostCommand(params)).rejects.toBe(reason);
      expect(approvals.register).toHaveBeenCalledTimes(phase === "review" ? 0 : 1);
      expect(approvals.gateway).not.toHaveBeenCalled();
    },
  );

  it("TF-0181 keeps the originating delivery route after node preparation", async () => {
    phases.resolveNodeExecutionTarget.mockResolvedValue(target);
    phases.shouldSkipNodeApprovalPrepare.mockReturnValue(false);
    phases.prepareNodeSystemRun.mockResolvedValue({
      plan: {},
      argv: ["echo", "done"],
      rawCommand: "echo done",
      cwd: "/tmp",
      agentId: "main",
      sessionKey: "session",
    });
    phases.analyzeNodeApprovalRequirement.mockResolvedValue({
      analysisOk: true,
      allowlistSatisfied: true,
      durableApprovalSatisfied: false,
      inlineEvalHit: null,
      requiresSecurityAuditSuppressionApproval: false,
    });
    approvals.gateway.mockResolvedValue({
      payload: { stdout: "done", success: true, exitCode: 0 },
    });
    const route = {
      turnSourceChannel: "telegram",
      turnSourceTo: "chat-1",
      turnSourceAccountId: "account-1",
      turnSourceThreadId: 0,
    };
    await executeNodeHostCommand({ ...baseParams(new AbortController().signal), ...route });
    expect(approvals.gateway).toHaveBeenCalledWith(
      "node.invoke",
      expect.anything(),
      expect.objectContaining({ params: expect.objectContaining(route) }),
    );
  });

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

  it("TF-0217 releases a pending automatic reviewer wait on cancellation", async () => {
    const abort = new AbortController();
    const reason = new DOMException("operator cancelled", "AbortError");
    phases.resolveNodeExecutionTarget.mockResolvedValue(target);
    phases.shouldSkipNodeApprovalPrepare.mockReturnValue(false);
    phases.prepareNodeSystemRun.mockResolvedValue({
      plan: {},
      argv: ["echo", "done"],
      rawCommand: "echo done",
      cwd: "/tmp",
      agentId: "main",
      sessionKey: "session",
    });
    phases.analyzeNodeApprovalRequirement.mockResolvedValue({
      analysisOk: true,
      allowlistSatisfied: false,
      durableApprovalSatisfied: false,
      nodeApprovalPolicyKnown: true,
      nodeSecurity: "allowlist",
      nodeAsk: "on-miss",
      inlineEvalHit: null,
      requiresSecurityAuditSuppressionApproval: false,
      autoReviewArgv: ["echo", "done"],
    });
    let resolveReview!: (value: {
      decision: "deny";
      risk: "low";
      rationale: string;
    }) => void;
    let reviewerStarted!: () => void;
    const reviewerStartedPromise = new Promise<void>((resolve) => {
      reviewerStarted = resolve;
    });
    const review = new Promise<{ decision: "deny"; risk: "low"; rationale: string }>((resolve) => {
      resolveReview = resolve;
    });
    const pending = executeNodeHostCommand({
      ...baseParams(abort.signal),
      security: "allowlist",
      ask: "on-miss",
      autoReview: true,
      autoReviewer: () => {
        reviewerStarted();
        return review;
      },
    });
    await reviewerStartedPromise;
    abort.abort(reason);
    const outcome = await Promise.race([
      pending.then(
        () => "resolved",
        (error) => error,
      ),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 100)),
    ]);
    await expect(outcome).toBe(reason);
    resolveReview({ decision: "deny", risk: "low", rationale: "late" });
    expect(approvals.register).not.toHaveBeenCalled();
    expect(approvals.gateway).not.toHaveBeenCalled();
  });

  it("TF-0218 releases a pending approval registration wait on cancellation", async () => {
    const abort = new AbortController();
    const reason = new DOMException("operator cancelled", "AbortError");
    phases.resolveNodeExecutionTarget.mockResolvedValue(target);
    phases.shouldSkipNodeApprovalPrepare.mockReturnValue(false);
    phases.prepareNodeSystemRun.mockResolvedValue({
      plan: {},
      argv: ["echo", "done"],
      rawCommand: "echo done",
      cwd: "/tmp",
      agentId: "main",
      sessionKey: "session",
    });
    phases.analyzeNodeApprovalRequirement.mockResolvedValue({
      analysisOk: true,
      allowlistSatisfied: false,
      durableApprovalSatisfied: false,
      nodeApprovalPolicyKnown: true,
      nodeSecurity: "allowlist",
      nodeAsk: "on-miss",
      inlineEvalHit: null,
      requiresSecurityAuditSuppressionApproval: false,
    });
    let resolveRegistration!: (value: unknown) => void;
    approvals.register.mockReturnValue(
      new Promise((resolve) => {
        resolveRegistration = resolve;
      }),
    );
    const pending = executeNodeHostCommand({
      ...baseParams(abort.signal),
      security: "allowlist",
      ask: "on-miss",
    });
    await vi.waitFor(() => expect(approvals.register).toHaveBeenCalledOnce());
    abort.abort(reason);
    await expectAbortWithin(pending, reason);
    resolveRegistration({ id: "late", expiresAtMs: Date.now(), finalDecision: null });
    await Promise.resolve();
    expect(approvals.gateway).not.toHaveBeenCalled();
  });
});
