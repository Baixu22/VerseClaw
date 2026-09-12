import { afterEach, describe, expect, it, vi } from "vitest";

const gatewayCall = vi.hoisted(() => vi.fn());
vi.mock("./tools/gateway.js", () => ({ callGatewayTool: gatewayCall }));

import {
  formatNodeRunToolResult,
  invokeNodeSystemRunDirect,
} from "./bash-tools.exec-host-node-phases.js";

afterEach(() => vi.clearAllMocks());

describe("node-host result and delivery contracts", () => {
  it("TF-0180 preserves stdout, stderr and failure text in the visible result", () => {
    const result = formatNodeRunToolResult({
      raw: {
        payload: {
          stdout: "build started",
          stderr: "compile error",
          error: "timed out",
          success: false,
          exitCode: null,
          timedOut: true,
        },
      },
      startedAt: Date.now(),
      cwd: undefined,
    });
    expect(result.content).toEqual([
      { type: "text", text: "build started\ncompile error\ntimed out" },
    ]);
    expect(result.details).toMatchObject({
      status: "failed",
      timedOut: true,
      aggregated: "build started\ncompile error\ntimed out",
    });
  });

  it("TF-0181 keeps the originating delivery route for direct node execution", async () => {
    gatewayCall.mockResolvedValue({ payload: { stdout: "done", success: true, exitCode: 0 } });
    const route = {
      turnSourceChannel: "telegram",
      turnSourceTo: "chat-1",
      turnSourceAccountId: "account-1",
      turnSourceThreadId: 0,
    };
    await invokeNodeSystemRunDirect({
      request: {
        command: "echo done",
        workdir: undefined,
        env: {},
        security: "full",
        ask: "off",
        defaultTimeoutSec: 30,
        approvalRunningNoticeMs: 0,
        warnings: [],
        ...route,
      },
      target: {
        nodeId: "node-1",
        argv: ["sh", "-lc", "echo done"],
        env: undefined,
        invokeTimeoutMs: 35_000,
        runTimeoutSec: 30,
        supportsSystemRunPrepare: false,
      },
    });
    expect(gatewayCall).toHaveBeenCalledWith(
      "node.invoke",
      expect.anything(),
      expect.objectContaining({ params: expect.objectContaining(route) }),
    );
  });
});
