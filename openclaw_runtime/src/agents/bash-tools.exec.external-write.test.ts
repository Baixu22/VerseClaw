import { describe, expect, it, vi } from "vitest";

const gatewayMock = vi.hoisted(() => ({
  processGatewayAllowlist: vi.fn(async () => ({
    pendingResult: {
      content: [{ type: "text", text: "approval pending" }],
    },
  })),
  callGatewayTool: vi.fn(async () => ({ id: "apv_test", expiresAtMs: 123 })),
}));

vi.mock("./bash-tools.exec-host-gateway.js", () => gatewayMock);
vi.mock("./tools/gateway.js", () => ({ callGatewayTool: gatewayMock.callGatewayTool }));

import { createExecTool } from "./bash-tools.exec.js";
import { registerExecApprovalRequest } from "./bash-tools.exec-approval-request.js";
import { VERSESHELL_EXTERNAL_WRITE_WARNING_TEXT } from "./verseshell/external-write-policy.js";

describe("exec external-write approval wiring", () => {
  it("passes the host-owned plan and static warning into the existing approval handler", async () => {
    gatewayMock.processGatewayAllowlist.mockClear();
    const tool = createExecTool({
      host: "verseshell",
      security: "full",
      ask: "always",
    });

    await tool.execute(
      "approval-wiring",
      {
        command: "git commit -m test",
      },
      undefined,
      undefined,
    );

    expect(gatewayMock.processGatewayAllowlist).toHaveBeenCalledOnce();
    const processCalls = gatewayMock.processGatewayAllowlist.mock.calls as unknown as Array<
      [unknown]
    >;
    const params = processCalls[0]?.[0] as {
      executionHost?: string;
      executionPlan?: {
        externalWritePolicy?: {
          effectLevel?: string;
          trigger?: string;
          rollbackClaim?: boolean;
        };
      };
      warnings: string[];
    };
    expect(params.executionHost).toBe("verseshell");
    expect(params.executionPlan?.externalWritePolicy).toMatchObject({
      effectLevel: "external-write",
      trigger: "git-hook",
      rollbackClaim: false,
    });
    expect(params.warnings).toContain(VERSESHELL_EXTERNAL_WRITE_WARNING_TEXT);
    expect(params.warnings.join("\n")).not.toContain("git commit -m test");
  });

  it("keeps the warning on the existing exec.approval.request payload", async () => {
    gatewayMock.callGatewayTool.mockClear();
    await registerExecApprovalRequest({
      id: "apv_test",
      command: "git commit -m test",
      cwd: "C:\\repo",
      host: "gateway",
      security: "full",
      ask: "always",
      warningText: VERSESHELL_EXTERNAL_WRITE_WARNING_TEXT,
    });

    expect(gatewayMock.callGatewayTool).toHaveBeenCalledWith(
      "exec.approval.request",
      expect.any(Object),
      expect.objectContaining({ warningText: VERSESHELL_EXTERNAL_WRITE_WARNING_TEXT }),
      { expectFinal: false },
    );
  });
});
