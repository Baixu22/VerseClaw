import { describe, expect, it, vi } from "vitest";

const { createExecTool } = vi.hoisted(() => ({
  createExecTool: vi.fn((defaults: unknown) => ({
    defaults,
    execute: vi.fn(),
  })),
}));

vi.mock("./bash-tools.js", () => ({ createExecTool }));

import { createOpenClawCodingTools } from "./agent-tools.js";
import { createExternalProvenance } from "../../../shared/security/content-provenance.js";

describe("command-exec provenance wiring", () => {
  it("carries the structured sidecar into the lazily-created exec sink", async () => {
    const provenance = createExternalProvenance({
      sourceKind: "channel",
      sourceId: "channel:telegram:message-1",
      receivedAt: "2026-08-20T00:00:00.000Z",
    });
    const exec = createOpenClawCodingTools({
      cwd: process.cwd(),
      contentProvenance: provenance,
      exec: { security: "allowlist", ask: "on-miss" },
      toolConstructionPlan: {
        includeBaseCodingTools: false,
        includeShellTools: true,
        includeChannelTools: false,
        includeOpenClawTools: false,
        includePluginTools: false,
      },
    }).find((tool) => tool.name === "exec");

    expect(exec).toBeDefined();
    await exec?.execute("call-1", { command: "git status --short" });
    expect(createExecTool).toHaveBeenCalledWith(
      expect.objectContaining({
        contentProvenance: provenance,
        security: "allowlist",
        ask: "on-miss",
      }),
    );
  });
});
