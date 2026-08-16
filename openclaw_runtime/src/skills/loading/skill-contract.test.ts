import { describe, expect, it } from "vitest";
import {
  createSyntheticSourceInfo,
  formatSkillsForPrompt,
  type Skill,
} from "./skill-contract.js";

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "docx",
    description: "Create and edit Word documents.",
    filePath: "/tmp/skills/docx/SKILL.md",
    baseDir: "/tmp/skills/docx",
    sourceInfo: createSyntheticSourceInfo("/tmp/skills/docx/SKILL.md", { source: "test" }),
    disableModelInvocation: false,
    source: "test",
    ...overrides,
  };
}

describe("formatSkillsForPrompt description budget", () => {
  it("keeps short descriptions intact", () => {
    const prompt = formatSkillsForPrompt([makeSkill()]);
    expect(prompt).toContain("<description>Create and edit Word documents.</description>");
  });

  it("truncates long descriptions to the prompt-facing budget", () => {
    const long = "x".repeat(600);
    const prompt = formatSkillsForPrompt([makeSkill({ description: long })]);
    const match = prompt.match(/<description>([^<]+)<\/description>/);
    expect(match?.[1]).toBe(`${"x".repeat(480)}...`);
    expect(match?.[1]?.length).toBe(483);
  });

  it("does not break XML escaping after truncation", () => {
    const prompt = formatSkillsForPrompt([makeSkill({ description: "<script>alert(1)</script>" })]);
    expect(prompt).toContain("&lt;script&gt;");
    expect(prompt).not.toContain("<script>");
  });
});
