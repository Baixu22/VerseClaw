import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeGatewayTool } from "../tools-invoke-shared.js";
import {
  clearSecurityVerificationShadowRecords,
  getSecurityVerificationShadowRecords,
} from "../../security-verification-shadow/index.js";

const mocks = vi.hoisted(() => ({
  materializeBundleMcpToolsForRun: vi.fn(),
  peekSessionMcpRuntime: vi.fn(),
  runBeforeToolCallHook: vi.fn(),
  resolveGatewayScopedTools: vi.fn(),
  getPluginToolMeta: vi.fn(),
  getChannelAgentToolMeta: vi.fn(),
  isKnownCoreToolId: vi.fn(),
}));

vi.mock("../../agents/agent-bundle-mcp-materialize.js", () => ({
  materializeBundleMcpToolsForRun: mocks.materializeBundleMcpToolsForRun,
}));

vi.mock("../../agents/agent-bundle-mcp-runtime.js", () => ({
  peekSessionMcpRuntime: mocks.peekSessionMcpRuntime,
}));

vi.mock("../../agents/agent-tools.before-tool-call.js", () => ({
  runBeforeToolCallHook: mocks.runBeforeToolCallHook,
}));

vi.mock("../../agents/agent-tools.js", () => ({
  resolveToolLoopDetectionConfig: () => ({}),
}));

vi.mock("../../agents/channel-tools.js", () => ({
  getChannelAgentToolMeta: mocks.getChannelAgentToolMeta,
}));

vi.mock("../../agents/tool-catalog.js", () => ({
  isKnownCoreToolId: mocks.isKnownCoreToolId,
  CORE_TOOL_GROUPS: {},
}));

vi.mock("../../plugins/config-state.js", () => ({
  isTestDefaultMemorySlotDisabled: () => false,
}));

vi.mock("../../plugins/slots.js", () => ({
  defaultSlotIdForKey: () => "default",
}));

vi.mock("../../plugins/tools.js", () => ({
  getPluginToolMeta: mocks.getPluginToolMeta,
}));

vi.mock("../tool-resolution.js", () => ({
  resolveGatewayScopedTools: mocks.resolveGatewayScopedTools,
}));

function invoke(input: Record<string, unknown>, cfg: Record<string, unknown> = {}) {
  return invokeGatewayTool({
    cfg: cfg as never,
    input,
    toolCallIdPrefix: "test",
    approvalMode: "report",
  });
}

describe("invokeGatewayTool warm MCP fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENCLAW_SECURITY_VERIFICATION_SHADOW;
    clearSecurityVerificationShadowRecords();
    mocks.peekSessionMcpRuntime.mockReturnValue(null);
    mocks.materializeBundleMcpToolsForRun.mockResolvedValue({ tools: [], dispose: vi.fn() });
    mocks.runBeforeToolCallHook.mockImplementation(async ({ params }) => ({
      blocked: false,
      params,
    }));
    mocks.resolveGatewayScopedTools.mockReturnValue({ agentId: "main", tools: [] });
    mocks.getPluginToolMeta.mockReturnValue(null);
    mocks.getChannelAgentToolMeta.mockReturnValue(null);
    mocks.isKnownCoreToolId.mockReturnValue(false);
  });

  it("keeps pre-warm MCP tool invocation on the existing not_found path", async () => {
    const outcome = await invoke({
      name: "test-echo__echo",
      sessionKey: "agent:main:r12-test",
      args: { text: "hello" },
    });

    expect(outcome).toMatchObject({
      ok: false,
      status: 404,
      toolName: "test-echo__echo",
      error: { type: "not_found" },
    });
    expect(mocks.materializeBundleMcpToolsForRun).not.toHaveBeenCalled();
  });

  it("invokes an already-warm MCP tool through the MCP materialized catalog", async () => {
    const dispose = vi.fn();
    const execute = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "hello" }],
    });
    mocks.peekSessionMcpRuntime.mockReturnValue({ peekCatalog: () => ({ tools: [] }) });
    mocks.materializeBundleMcpToolsForRun.mockResolvedValue({
      tools: [{ name: "test-echo__echo", parameters: {}, execute }],
      dispose,
    });
    mocks.runBeforeToolCallHook.mockImplementation(async ({ params }) => ({
      blocked: false,
      params,
    }));

    const outcome = await invoke({
      name: "test-echo__echo",
      sessionKey: "agent:main:r12-test",
      args: { text: "hello" },
      idempotencyKey: "echo",
    });

    expect(outcome).toMatchObject({
      ok: true,
      status: 200,
      toolName: "test-echo__echo",
      source: "mcp",
      result: { content: [{ type: "text", text: "hello" }] },
    });
    expect(execute).toHaveBeenCalledWith("test-echo", { text: "hello" });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(mocks.resolveGatewayScopedTools).not.toHaveBeenCalled();
  });

  it("keeps the original core tool path when no warm MCP tool matches", async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, source: "core" });
    mocks.resolveGatewayScopedTools.mockReturnValue({
      agentId: "main",
      tools: [{ name: "local_core_tool", parameters: {}, execute }],
    });

    const outcome = await invoke({
      name: "local_core_tool",
      sessionKey: "agent:main:r12-test",
      args: { value: 1 },
      idempotencyKey: "core",
    });

    expect(outcome).toMatchObject({
      ok: true,
      status: 200,
      toolName: "local_core_tool",
      source: "core",
      result: { ok: true, source: "core" },
    });
    expect(execute).toHaveBeenCalledWith("test-core", { value: 1 });
    expect(getSecurityVerificationShadowRecords()).toHaveLength(0);
  });

  it("records a sanitized shadow result when the security verification flag is enabled", async () => {
    process.env.OPENCLAW_SECURITY_VERIFICATION_SHADOW = "1";
    const execute = vi.fn().mockResolvedValue({ ok: true, source: "core", secret: "do-not-store" });
    mocks.resolveGatewayScopedTools.mockReturnValue({
      agentId: "main",
      tools: [{ name: "local_core_tool", parameters: {}, execute }],
    });

    const outcome = await invoke({
      name: "local_core_tool",
      sessionKey: "agent:main:r12-test",
      args: { value: 1, apiToken: "hidden-token" },
      idempotencyKey: "core",
    });

    expect(outcome).toMatchObject({
      ok: true,
      status: 200,
      toolName: "local_core_tool",
      source: "core",
      result: { ok: true, source: "core", secret: "do-not-store" },
    });
    const records = getSecurityVerificationShadowRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      source: "tools.invoke",
      request: {
        toolName: "local_core_tool",
        argKeys: ["apiToken", "value"],
        sensitiveArgKeyCount: 1,
      },
      result: { status: "success" },
    });
    expect(JSON.stringify(records[0])).not.toContain("hidden-token");
    expect(JSON.stringify(records[0])).not.toContain("do-not-store");
  });

  it("keeps success payload shape identical when the shadow layer is enabled through config", async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, source: "core", secret: "do-not-store" });
    mocks.resolveGatewayScopedTools.mockReturnValue({
      agentId: "main",
      tools: [{ name: "local_core_tool", parameters: {}, execute }],
    });
    const input = {
      name: "local_core_tool",
      sessionKey: "agent:main:r12-test",
      args: { value: 1, apiToken: "hidden-token" },
      idempotencyKey: "core",
      runId: "run_tools_contract",
    };

    const disabledOutcome = await invoke(input);
    clearSecurityVerificationShadowRecords();
    const enabledOutcome = await invoke(input, {
      security: { validationShadow: { enabled: true } },
    });

    expect(enabledOutcome).toEqual(disabledOutcome);
    expect(getSecurityVerificationShadowRecords()).toHaveLength(1);
    expect(getSecurityVerificationShadowRecords()[0]).toMatchObject({
      runId: "run_tools_contract",
    });
    expect(JSON.stringify(getSecurityVerificationShadowRecords()[0])).not.toContain("hidden-token");
    expect(JSON.stringify(getSecurityVerificationShadowRecords()[0])).not.toContain("do-not-store");
  });

  it("keeps tool error payload shape identical while recording only sanitized error metadata", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("complete tool output with hidden-token"));
    mocks.resolveGatewayScopedTools.mockReturnValue({
      agentId: "main",
      tools: [{ name: "local_core_tool", parameters: {}, execute }],
    });
    const input = {
      name: "local_core_tool",
      sessionKey: "agent:main:r12-test",
      args: { value: 1, apiToken: "hidden-token" },
      idempotencyKey: "core",
    };

    const disabledOutcome = await invoke(input);
    clearSecurityVerificationShadowRecords();
    const enabledOutcome = await invoke(input, {
      security: { validationShadow: { enabled: true } },
    });

    expect(enabledOutcome).toEqual(disabledOutcome);
    expect(enabledOutcome).toMatchObject({
      ok: false,
      status: 500,
      toolName: "local_core_tool",
      error: { type: "tool_error", message: "tool execution failed" },
    });
    const records = getSecurityVerificationShadowRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      source: "tools.invoke",
      result: { status: "error", errorType: "tool", hasErrorMessage: true },
      verification: { status: "failed" },
    });
    expect(JSON.stringify(records[0])).not.toContain("hidden-token");
    expect(JSON.stringify(records[0])).not.toContain("complete tool output");
  });

  it("keeps approval-blocked payload shape identical while recording a denied shadow result", async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true });
    mocks.resolveGatewayScopedTools.mockReturnValue({
      agentId: "main",
      tools: [{ name: "local_core_tool", parameters: {}, execute }],
    });
    mocks.runBeforeToolCallHook.mockResolvedValue({
      blocked: true,
      reason: "approval required",
      deniedReason: "plugin-approval",
    });
    const input = {
      name: "local_core_tool",
      sessionKey: "agent:main:r12-test",
      args: { value: 1 },
      idempotencyKey: "approval",
    };

    const disabledOutcome = await invoke(input);
    clearSecurityVerificationShadowRecords();
    const enabledOutcome = await invoke(input, {
      security: { validationShadow: { enabled: true } },
    });

    expect(enabledOutcome).toEqual(disabledOutcome);
    expect(enabledOutcome).toMatchObject({
      ok: false,
      status: 403,
      toolName: "local_core_tool",
      error: {
        type: "tool_call_blocked",
        message: "approval required",
        requiresApproval: true,
      },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(getSecurityVerificationShadowRecords()).toHaveLength(1);
    expect(getSecurityVerificationShadowRecords()[0]).toMatchObject({
      source: "tools.invoke",
      result: { status: "denied", errorType: "permission", hasErrorMessage: true },
      security: { decision: "would_block" },
      verification: { status: "failed" },
    });
  });
});
