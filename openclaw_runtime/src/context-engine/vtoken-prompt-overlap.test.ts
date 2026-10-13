/**
 * #182: the measurement that VToken's inputs are largely the same content the
 * system prompt already renders. These tests pin the counting rules — including
 * the case/separator-insensitive path comparison, because the prompt renders
 * workspace-remapped paths while `markdownSources` keep the bootstrap file's own
 * spelling.
 */
import { describe, expect, it } from "vitest";
import { computeVtokenPromptOverlap, normalizeVtokenOverlapKey } from "./vtoken-prompt-overlap.js";

describe("#182 VToken prompt-overlap measurement", () => {
  it("counts sources whose path the prompt already rendered", () => {
    const overlap = computeVtokenPromptOverlap({
      markdownSources: [
        { sourcePath: "AGENTS.md", text: "12345" },
        { sourcePath: "docs/extra.md", text: "999" },
      ],
      toolSchemaNames: [],
      promptSourcePaths: ["agents.md"],
      promptToolNames: [],
    });

    expect(overlap.sourceCount).toBe(2);
    expect(overlap.overlappingSourceCount).toBe(1);
    expect(overlap.overlappingSourceChars).toBe(5);
  });

  it("normalizes separators and case (Windows vs workspace-remapped paths)", () => {
    const overlap = computeVtokenPromptOverlap({
      markdownSources: [{ sourcePath: "src\\Memory\\Store.md", text: "abc" }],
      toolSchemaNames: [],
      promptSourcePaths: ["src/memory/store.md"],
      promptToolNames: [],
    });

    expect(overlap.overlappingSourceCount).toBe(1);
    expect(overlap.overlappingSourceChars).toBe(3);
  });

  it("counts tool schemas whose name the prompt already listed", () => {
    const overlap = computeVtokenPromptOverlap({
      markdownSources: [],
      toolSchemaNames: ["read", "write", "extra_tool"],
      promptSourcePaths: [],
      promptToolNames: ["READ", "write"],
    });

    expect(overlap.toolSchemaCount).toBe(3);
    expect(overlap.overlappingToolSchemaCount).toBe(2);
  });

  it("reports zero overlap without losing the totals", () => {
    const overlap = computeVtokenPromptOverlap({
      markdownSources: [{ sourcePath: "only-vtoken.md", text: "abc" }],
      toolSchemaNames: ["solo_tool"],
      promptSourcePaths: [],
      promptToolNames: [],
    });

    expect(overlap).toEqual({
      sourceCount: 1,
      overlappingSourceCount: 0,
      overlappingSourceChars: 0,
      toolSchemaCount: 1,
      overlappingToolSchemaCount: 0,
    });
  });

  it("ignores blank paths/names instead of treating them as matches", () => {
    const overlap = computeVtokenPromptOverlap({
      markdownSources: [{ sourcePath: "", text: "abc" }],
      toolSchemaNames: [""],
      promptSourcePaths: ["", "   "],
      promptToolNames: [" "],
    });

    expect(overlap.overlappingSourceCount).toBe(0);
    expect(overlap.overlappingToolSchemaCount).toBe(0);
  });

  it("after the cut, re-running the overlap on the filtered inputs reports ~0", () => {
    // The measured reading on the real workspace was 7/7 sources and 5/5 tool
    // schemas overlapping; Option B drops exactly those keys from VToken's input,
    // so the same measurement on the filtered input must report zero overlap.
    const markdownSources = [
      { sourcePath: "AGENTS.md", text: "prompt-carried" },
      { sourcePath: "docs/notes.md", text: "prompt-external" },
    ];
    const toolSchemaNames = ["read_file", "memory_search"];
    const promptSourcePaths = ["agents.md"];
    const promptToolNames = ["read_file"];

    const before = computeVtokenPromptOverlap({ markdownSources, toolSchemaNames, promptSourcePaths, promptToolNames });
    expect(before.overlappingSourceCount).toBe(1);
    expect(before.overlappingToolSchemaCount).toBe(1);

    const sourceKeys = new Set(promptSourcePaths.map(normalizeVtokenOverlapKey));
    const toolKeys = new Set(promptToolNames.map(normalizeVtokenOverlapKey));
    const after = computeVtokenPromptOverlap({
      markdownSources: markdownSources.filter((s) => !sourceKeys.has(normalizeVtokenOverlapKey(s.sourcePath))),
      toolSchemaNames: toolSchemaNames.filter((n) => !toolKeys.has(normalizeVtokenOverlapKey(n))),
      promptSourcePaths,
      promptToolNames,
    });
    expect(after.overlappingSourceCount).toBe(0);
    expect(after.overlappingToolSchemaCount).toBe(0);
    // The prompt-external material survives, which is the point of the cut.
    expect(after.sourceCount).toBe(1);
    expect(after.toolSchemaCount).toBe(1);
  });
});
