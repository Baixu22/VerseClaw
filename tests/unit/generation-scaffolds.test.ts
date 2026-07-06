import { describe, expect, it } from "vitest";
import {
  EVIDENCE_INSUFFICIENT_SIGNAL,
  buildCategoryAwareDualTrackPrompt,
  stripEvidenceInsufficientSignal,
} from "./helpers/runtime-memory-generation-scaffolds";

describe("runtime memory generation scaffolds", () => {
  it("builds temporal prompts with dated evidence and arithmetic instructions", () => {
    const prompt = buildCategoryAwareDualTrackPrompt(
      "What year was that?",
      "temporal",
      "[said on 2023-05-14] Alice mentioned five years ago.",
      [
        {
          subject: "Alice",
          predicate: "mentioned",
          objectSummary: "five years ago",
          valid_at: Date.UTC(2023, 4, 14),
        } as never,
      ],
    );

    expect(prompt.system).toContain("compute the absolute date");
    expect(prompt.user).toContain("[said on 2023-05-14]");
  });

  it("adds and strips the internal abstention signal", () => {
    const prompt = buildCategoryAwareDualTrackPrompt("Q", "single_hop", "", [], [], {
      allowInternalAbstention: true,
    });
    expect(prompt.system).toContain(EVIDENCE_INSUFFICIENT_SIGNAL);
    expect(
      stripEvidenceInsufficientSignal(`${EVIDENCE_INSUFFICIENT_SIGNAL} best guess`),
    ).toEqual({ insufficient: true, answer: "best guess" });
  });

  it("does not include profile context in Stage 1/2 prompts", () => {
    const prompt = buildCategoryAwareDualTrackPrompt(
      "What does Alice like?",
      "open_domain",
      "",
      [],
      ["PROFILE: Alice likes stale context."],
    );

    expect(prompt.user).not.toContain("PROFILE:");
    expect(prompt.user).not.toContain("stale context");
  });

  it("multi_hop prompt enforces specific entity extraction and hop answer chaining", () => {
    const prompt = buildCategoryAwareDualTrackPrompt(
      "What pets wouldn't cause discomfort?",
      "multi_hop",
      "",
      [],
      [],
      { reasoningHints: ["hairless cats", "pigs"] },
    );

    // Grounding rules
    expect(prompt.system).toContain("EXTRACT, do not GENERATE");
    expect(prompt.system).toContain("hairless cats and pigs");
    expect(prompt.system).toContain("List ALL specific items");

    // Hop answer usage guidance
    expect(prompt.system).toContain("TREAT THEM AS FACTS");
    expect(prompt.system).toContain("Substitute it into the hop 2 question");

    // Hop answers appear in user message
    expect(prompt.user).toContain("[SELF-ASK DECOMPOSITION]");
    expect(prompt.user).toContain("Hop 1 answer: hairless cats");
    expect(prompt.user).toContain("Hop 2 answer: pigs");
  });
});
