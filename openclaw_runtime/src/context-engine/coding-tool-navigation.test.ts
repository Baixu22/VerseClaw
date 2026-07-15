import { describe, expect, it } from "vitest";
import {
  CODING_FACT_TOOL_NAMES,
  CODING_NAV_PROMPT_MAX_CHARS,
  buildCodingToolNavigationPrompt,
  codingFactToolCount,
} from "./coding-tool-navigation.js";

describe("coding tool navigation (C1-1/C1-3)", () => {
  it("lists seven default coding fact/context tools", () => {
    expect(CODING_FACT_TOOL_NAMES).toHaveLength(7);
    expect(codingFactToolCount([...CODING_FACT_TOOL_NAMES])).toBe(7);
  });

  it("includes navigation and routing hints under budget", () => {
    const prompt = buildCodingToolNavigationPrompt();
    expect(prompt).toContain("[Coding Tool Navigation]");
    expect(prompt).toContain("context_impact");
    expect(prompt).toContain("Routing:");
    expect(prompt.length).toBeLessThanOrEqual(CODING_NAV_PROMPT_MAX_CHARS);
  });

  it("returns empty when active tools omit coding tools", () => {
    expect(buildCodingToolNavigationPrompt({ activeToolNames: ["read", "write"] })).toBe("");
  });

  it("respects maxChars truncation", () => {
    const prompt = buildCodingToolNavigationPrompt({ maxChars: 40 });
    expect(prompt.length).toBeLessThanOrEqual(40);
    expect(prompt.endsWith("…")).toBe(true);
  });
});
