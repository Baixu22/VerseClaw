import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeGatewayTool } from "../tools-invoke-shared.js";

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

function invoke(input: Record<string, unknown>) {
  return invokeGatewayTool({
    cfg: {},
    input,
    toolCallIdPrefix: "test",
    approvalMode: "report",
  });
}

describe("invokeGatewayTool warm MCP fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });
});
