import { describe, expect, it } from "vitest";
import {
  extractAgentMapTagsFromSources,
  rankAgentMapTags,
} from "../../openclaw_runtime/src/runtime-core";
import {
  buildAgentMapFixtureRequest,
  readAgentMapFixtureFiles,
} from "../fixtures/agent-map/fixture-loader";

describe("AgentMap TS/TSX readonly ranking", () => {
  it("extracts TypeScript and TSX definition/reference tags without writing runtime state", async () => {
    const tags = await extractAgentMapTagsFromSources({
      files: readAgentMapFixtureFiles(),
    });

    expect(tags).toEqual(expect.arrayContaining([
      expect.objectContaining({
        file: "src/shared/host-api.ts",
        kind: "definition",
        name: "sendMessage",
        symbolKind: "function",
      }),
      expect.objectContaining({
        file: "src/renderer/SettingsPanel.tsx",
        kind: "definition",
        name: "SettingsPanel",
        symbolKind: "component",
      }),
      expect.objectContaining({
        file: "src/renderer/Composer.tsx",
        kind: "reference",
        name: "sendMessage",
      }),
    ]));
    expect(tags.filter((tag) =>
      tag.kind === "reference" &&
      tag.file === "src/renderer/Composer.tsx" &&
      tag.name === "sendMessage"
    )).toHaveLength(3);
  });

  it("raises definitions referenced from the active file", async () => {
    const tags = await extractAgentMapTagsFromSources({
      files: readAgentMapFixtureFiles(),
    });
    const ranked = rankAgentMapTags({
      request: buildAgentMapFixtureRequest(),
      tags,
    });
    const sendMessage = ranked.find((item) => item.tag.name === "sendMessage");
    const registerChatIpc = ranked.find((item) => item.tag.name === "registerChatIpc");

    expect(sendMessage?.reasons.map((reason) => reason.kind)).toContain(
      "fromActiveFileReference",
    );
    expect(sendMessage?.score).toBeGreaterThan(registerChatIpc?.score ?? 0);
  });

  it("raises exact mentioned identifiers ahead of token-only neighbors", async () => {
    const tags = await extractAgentMapTagsFromSources({
      files: readAgentMapFixtureFiles(),
    });
    const ranked = rankAgentMapTags({
      request: buildAgentMapFixtureRequest({
        activeFiles: [],
        mentionedSymbols: ["SettingsPanel"],
        promptPresentFiles: [],
      }),
      tags,
    });

    expect(ranked[0]?.tag.name).toBe("SettingsPanel");
    expect(ranked[0]?.reasons.map((reason) => reason.kind)).toEqual(
      expect.arrayContaining(["mentionedByUser", "pathComponentMatch"]),
    );
    expect(ranked.find((item) => item.tag.name === "useSettingsPanel")?.rank)
      .toBeGreaterThan(ranked[0]?.rank ?? 0);
  });
});
