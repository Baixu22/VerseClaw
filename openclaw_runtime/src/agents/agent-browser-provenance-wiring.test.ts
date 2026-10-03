import { describe, expect, it, vi } from "vitest";

const { createAgentBrowserTool } = vi.hoisted(() => ({
  createAgentBrowserTool: vi.fn(() => null),
}));

vi.mock("./tools/agent-browser-tool.js", () => ({ createAgentBrowserTool }));

import { createExternalProvenance } from "../../../shared/security/content-provenance.js";
import { createOpenClawTools } from "./openclaw-tools.js";

describe("agent_browser provenance wiring", () => {
  it("passes the authoritative run sidecar into the external browser boundary", () => {
    const provenance = createExternalProvenance({
      sourceKind: "channel",
      sourceId: "channel:telegram:message-1",
      receivedAt: "2026-08-21T00:00:00.000Z",
    });
    const invoke = vi.fn();

    createOpenClawTools({
      contentProvenanceContext: { provenance },
      agentBrowserInvoker: invoke,
      disablePluginTools: true,
      wrapBeforeToolCallHook: false,
    });

    expect(createAgentBrowserTool).toHaveBeenCalledWith({
      contentProvenanceContext: { provenance },
      invoke,
    });
  });
});
