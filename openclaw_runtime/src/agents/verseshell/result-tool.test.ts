import { describe, expect, it } from "vitest";
import { createOpenClawCodingTools } from "../agent-tools.js";
import { createVerseShellResultTool } from "./result-tool.js";

const ENABLED_FLAGS = {
  verifiedRuntime: true,
  typedAci: true,
  facade: true,
  governedExec: true,
  artifactResults: true,
};

function config(flags: Record<string, boolean>) {
  return {
    tools: { profile: "full" },
    runtime: { verseShellFoundation: flags },
  } as never;
}

describe("verseshell_result tool registration", () => {
  it("is absent by default and when the kill switch is engaged", () => {
    expect(createVerseShellResultTool({ cwd: process.cwd(), config: {} })).toBeNull();
    expect(createVerseShellResultTool({
      cwd: process.cwd(),
      config: {
        runtime: {
          verseShellFoundation: {
            ...ENABLED_FLAGS,
            killSwitch: true,
          },
        },
      },
    })).toBeNull();
  });

  it("uses a provider-safe flat enum when all artifact flags are enabled", () => {
    const tool = createVerseShellResultTool({
      cwd: process.cwd(),
      config: config(ENABLED_FLAGS),
    });
    expect(tool?.name).toBe("verseshell_result");
    const schema = tool?.parameters as unknown as {
      properties?: { mode?: Record<string, unknown> };
    };
    expect(schema.properties?.mode).toMatchObject({
      type: "string",
      enum: ["meta", "head", "tail", "slice", "grep", "raw"],
    });
    expect(schema.properties?.mode).not.toHaveProperty("anyOf");
  });

  it("is included in the effective Agent tool surface only for the enabled rollout", () => {
    const disabled = createOpenClawCodingTools({
      cwd: process.cwd(),
      config: config({}),
    });
    expect(disabled.map((tool) => tool.name)).not.toContain("verseshell_result");

    const enabled = createOpenClawCodingTools({
      cwd: process.cwd(),
      config: config(ENABLED_FLAGS),
    });
    expect(enabled.map((tool) => tool.name)).toContain("verseshell_result");
  });
});
