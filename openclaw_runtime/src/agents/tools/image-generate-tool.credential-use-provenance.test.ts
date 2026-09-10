import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExternalProvenance } from "../../../../shared/security/content-provenance.js";
import type { ImageGenerationProvider } from "../../image-generation/types.js";

const {
  generateImage,
  listRuntimeImageGenerationProviders,
  resolveCapabilityModelConfigForTool,
  saveMediaBuffer,
} = vi.hoisted(() => ({
  generateImage: vi.fn(),
  listRuntimeImageGenerationProviders: vi.fn(),
  resolveCapabilityModelConfigForTool: vi.fn(),
  saveMediaBuffer: vi.fn(),
}));

vi.mock("../../image-generation/runtime.js", () => ({
  generateImage,
  listRuntimeImageGenerationProviders,
}));

vi.mock("../../media/store.js", () => ({ saveMediaBuffer }));

vi.mock("./media-tool-shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./media-tool-shared.js")>()),
  hasGenerationToolAvailability: () => true,
  resolveCapabilityModelConfigForTool,
}));

import { createImageGenerateTool } from "./image-generate-tool.js";

const provenance = createExternalProvenance({
  sourceKind: "web",
  sourceId: "web:article-1",
  receivedAt: "2026-08-21T00:00:00.000Z",
});

function provider(id: string, defaultModel: string): ImageGenerationProvider {
  return {
    id,
    defaultModel,
    models: [defaultModel, `${defaultModel}-alt`],
    capabilities: {
      generate: { maxCount: 4 },
      edit: { enabled: true, maxCount: 4, maxInputImages: 10 },
    },
    isConfigured: () => true,
    generateImage: vi.fn(),
  };
}

function requireTool(options: Parameters<typeof createImageGenerateTool>[0]) {
  const tool = createImageGenerateTool(options);
  if (!tool) throw new Error("image_generate was not created");
  return tool;
}

describe("image_generate credential-use provenance boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRuntimeImageGenerationProviders.mockReturnValue([
      provider("openai", "image-v1"),
      provider("other-provider", "image-v2"),
    ]);
    resolveCapabilityModelConfigForTool.mockImplementation(
      ({ modelConfig }: { modelConfig?: { primary?: string; fallbacks?: string[] } }) =>
        modelConfig?.primary
          ? modelConfig
          : {
              primary: "openai/image-v1",
              fallbacks: ["other-provider/image-v2"],
            },
    );
    generateImage.mockResolvedValue({
      images: [{ buffer: Buffer.from("image"), mimeType: "image/png" }],
      provider: "openai",
      model: "image-v1-alt",
      attempts: [],
      metadata: {},
    });
    saveMediaBuffer.mockResolvedValue({
      id: "generated.png",
      path: "C:/tmp/generated.png",
      contentType: "image/png",
    });
  });

  it("denies an external cross-provider override before provider execution", async () => {
    const tool = requireTool({
      config: {
        agents: { defaults: { imageGenerationModel: { primary: "openai/image-v1" } } },
      },
      contentProvenanceContext: { provenance },
    });

    await expect(
      tool.execute("call-1", {
        prompt: "draw a diagram",
        model: "other-provider/image-v2",
      }),
    ).rejects.toMatchObject({ name: "ToolAuthorizationError", status: 403 });
    expect(resolveCapabilityModelConfigForTool).toHaveBeenCalledTimes(1);
    expect(generateImage).not.toHaveBeenCalled();
    expect(saveMediaBuffer).not.toHaveBeenCalled();
  });

  it("denies a discovered cross-provider override before provider credential resolution", async () => {
    const tool = requireTool({
      config: {},
      contentProvenanceContext: { provenance },
    });

    await expect(
      tool.execute("call-1", {
        prompt: "draw a diagram",
        model: "other-provider/image-v2",
      }),
    ).rejects.toMatchObject({ name: "ToolAuthorizationError", status: 403 });
    expect(resolveCapabilityModelConfigForTool).toHaveBeenCalledTimes(1);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("keeps the resolved default primary provider usable without explicit config", async () => {
    resolveCapabilityModelConfigForTool.mockReturnValue({
      primary: "other-provider/image-v2",
      fallbacks: ["openai/image-v1"],
    });
    const tool = requireTool({
      config: {},
      contentProvenanceContext: { provenance },
    });

    await tool.execute("call-1", {
      prompt: "draw a diagram",
      model: "other-provider/image-v2-alt",
    });

    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ modelOverride: "other-provider/image-v2-alt" }),
    );
  });

  it("keeps an operator-configured fallback provider usable", async () => {
    const tool = requireTool({
      config: {
        agents: {
          defaults: {
            imageGenerationModel: {
              primary: "openai/image-v1",
              fallbacks: ["other-provider/image-v2"],
            },
          },
        },
      },
      contentProvenanceContext: { provenance },
    });

    await tool.execute("call-1", {
      prompt: "draw a diagram",
      model: "other-provider/image-v2-alt",
    });

    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ modelOverride: "other-provider/image-v2-alt" }),
    );
  });

  it("keeps a same-provider model override usable", async () => {
    const tool = requireTool({
      config: {
        agents: { defaults: { imageGenerationModel: { primary: "openai/image-v1" } } },
      },
      contentProvenanceContext: { provenance },
    });

    await tool.execute("call-1", {
      prompt: "draw a diagram",
      model: "openai/image-v1-alt",
    });

    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ modelOverride: "openai/image-v1-alt" }),
    );
  });

  it("keeps the resolved default provider and automatic fallback when no override is supplied", async () => {
    const tool = requireTool({
      config: {},
      contentProvenanceContext: { provenance },
    });

    await tool.execute("call-1", { prompt: "draw a diagram" });

    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        modelOverride: undefined,
        autoProviderFallback: undefined,
      }),
    );
  });
});
