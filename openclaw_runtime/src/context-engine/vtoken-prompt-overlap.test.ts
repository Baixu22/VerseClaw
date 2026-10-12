/**
 * #182: the measurement that VToken's inputs are largely the same content the
 * system prompt already renders. These tests pin the counting rules — including
 * the case/separator-insensitive path comparison, because the prompt renders
 * workspace-remapped paths while `markdownSources` keep the bootstrap file's own
 * spelling.
 */
import { describe, expect, it } from "vitest";
import { computeVtokenPromptOverlap } from "./vtoken-prompt-overlap.js";

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
});