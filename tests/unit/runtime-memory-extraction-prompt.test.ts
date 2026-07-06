// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
  parseExtractionResponse,
} from "../../openclaw_runtime/src/runtime-core/memory-extraction-prompt";

describe("memory-extraction-prompt", () => {
  describe("buildExtractionSystemPrompt", () => {
    it("includes base instructions without sessionDate", () => {
      const prompt = buildExtractionSystemPrompt();
      expect(prompt).toContain("memory extraction system");
      expect(prompt).toContain("atomic, self-contained facts");
      expect(prompt).toContain("third-person perspective");
      expect(prompt).toContain("JSON array");
      expect(prompt).not.toContain("relative time expressions");
    });

    it("includes time normalization instructions when sessionDate is provided", () => {
      const sessionDate = Date.UTC(2023, 4, 8); // 8 May 2023
      const prompt = buildExtractionSystemPrompt({ sessionDate });
      expect(prompt).toContain("relative time expressions");
      expect(prompt).toContain("absolute dates");
      expect(prompt).toContain("yesterday");
    });

    it("includes example fact in both modes", () => {
      const withoutDate = buildExtractionSystemPrompt();
      const withDate = buildExtractionSystemPrompt({ sessionDate: Date.UTC(2023, 0, 1) });
      expect(withoutDate).toContain('"Alice"');
      expect(withDate).toContain('"Alice"');
    });
  });

  describe("buildExtractionUserPrompt", () => {
    it("builds prompt with conversation metadata", () => {
      const prompt = buildExtractionUserPrompt("Alice: Hello", {
        conversationId: "conv1",
        chunkNum: 1,
        totalChunks: 3,
      });
      expect(prompt).toContain("part 1/3");
      expect(prompt).toContain("conv1");
      expect(prompt).toContain("Alice: Hello");
      expect(prompt).toContain("Return ONLY a JSON array");
    });

    it("includes session date when provided", () => {
      const sessionDate = Date.UTC(2023, 4, 8); // 8 May 2023
      const prompt = buildExtractionUserPrompt("Alice: Hello", {
        conversationId: "conv1",
        chunkNum: 1,
        totalChunks: 1,
        sessionDate,
      });
      expect(prompt).toContain("2023-05-08");
      expect(prompt).toContain("absolute dates");
    });

    it("omits session date when not provided", () => {
      const prompt = buildExtractionUserPrompt("Alice: Hello", {
        conversationId: "conv1",
        chunkNum: 1,
        totalChunks: 1,
      });
      expect(prompt).not.toContain("occurred on");
    });
  });

  describe("parseExtractionResponse", () => {
    it("parses valid JSON array", () => {
      const content = 'Some text\n[{"subject":"Alice","predicate":"job","objectSummary":"is a nurse"}]\nMore text';
      const facts = parseExtractionResponse(content);
      expect(facts).toHaveLength(1);
      expect(facts[0].subject).toBe("Alice");
      expect(facts[0].predicate).toBe("job");
      expect(facts[0].objectSummary).toBe("is a nurse");
    });

    it("returns empty array when no JSON array found", () => {
      const content = "No JSON here";
      expect(parseExtractionResponse(content)).toEqual([]);
    });

    it("returns empty array for invalid JSON", () => {
      const content = "[invalid json]";
      expect(parseExtractionResponse(content)).toEqual([]);
    });

    it("filters out non-object elements", () => {
      const content = '[{"subject":"A","predicate":"b","objectSummary":"c"}, "not an object", 42]';
      const facts = parseExtractionResponse(content);
      expect(facts).toHaveLength(1);
      expect(facts[0].subject).toBe("A");
    });

    it("parses multiple facts", () => {
      const content = JSON.stringify([
        { subject: "Alice", predicate: "occupation", objectSummary: "nurse" },
        { subject: "Bob", predicate: "hobby", objectSummary: "plays chess" },
        { subject: "Alice", predicate: "lives", objectSummary: "in London" },
      ]);
      const facts = parseExtractionResponse(content);
      expect(facts).toHaveLength(3);
      expect(facts.map((f) => f.subject)).toEqual(["Alice", "Bob", "Alice"]);
    });
  });
});
