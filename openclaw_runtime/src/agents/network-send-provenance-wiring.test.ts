import { describe, expect, it, vi } from "vitest";

const { createOpenClawTools } = vi.hoisted(() => ({
  createOpenClawTools: vi.fn(() => []),
}));

vi.mock("./openclaw-tools.js", () => ({ createOpenClawTools }));

import { createExternalProvenance } from "../../../shared/security/content-provenance.js";
import { createOpenClawCodingTools } from "./agent-tools.js";

describe("network-send provenance run wiring", () => {
  it("carries the authoritative run sidecar into OpenClaw message tools", () => {
    const provenance = createExternalProvenance({
      sourceKind: "channel",
      sourceId: "channel:telegram:message-1",
      receivedAt: "2026-08-21T00:00:00.000Z",
    });

    createOpenClawCodingTools({
      cwd: process.cwd(),
      contentProvenance: provenance,
      toolConstructionPlan: {
        includeBaseCodingTools: false,
        includeShellTools: false,
        includeChannelTools: false,
        includeOpenClawTools: true,
        includePluginTools: false,
      },
    });

    expect(createOpenClawTools).toHaveBeenCalledWith(
      expect.objectContaining({ contentProvenanceContext: { provenance } }),
    );
  });
});
