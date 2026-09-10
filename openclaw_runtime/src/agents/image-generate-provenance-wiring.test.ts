import { describe, expect, it, vi } from "vitest";

const { createImageGenerateTool } = vi.hoisted(() => ({
  createImageGenerateTool: vi.fn(() => null),
}));

vi.mock("./tools/image-generate-tool.js", () => ({ createImageGenerateTool }));

import { createExternalProvenance } from "../../../shared/security/content-provenance.js";
import { createOpenClawTools } from "./openclaw-tools.js";

describe("image_generate provenance wiring", () => {
  it("passes the authoritative run sidecar into the image provider boundary", () => {
    const provenance = createExternalProvenance({
      sourceKind: "channel",
      sourceId: "channel:telegram:message-1",
      receivedAt: "2026-08-21T00:00:00.000Z",
    });

    createOpenClawTools({
      contentProvenanceContext: { provenance },
      config: {
        agents: { defaults: { imageGenerationModel: { primary: "openai/image-v1" } } },
      },
      disablePluginTools: true,
      wrapBeforeToolCallHook: false,
    });

    expect(createImageGenerateTool).toHaveBeenCalledWith(
      expect.objectContaining({ contentProvenanceContext: { provenance } }),
    );
  });
});
