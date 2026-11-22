import { describe, expect, it } from "vitest";
import { parseMarkdownSourceBlocks } from "./ir.js";

describe("parseMarkdownSourceBlocks", () => {
  it("returns structural source line maps for CRLF markdown", () => {
    const markdown = [
      "# Root",
      "",
      "Intro.",
      "",
      "- one",
      "- 二",
      "",
      "1. first",
      "2. second",
      "",
      "```ts",
      "const value = 1;",
      "```",
      "",
      "| Key | Value |",
      "| --- | --- |",
      "| 中 | 😀 |",
      "",
      "> quoted",
      "",
    ].join("\r\n");

    expect(parseMarkdownSourceBlocks(markdown)).toEqual([
      { kind: "heading", startLine: 0, endLine: 1, headingLevel: 1, headingText: "Root" },
      { kind: "paragraph", startLine: 2, endLine: 3 },
      { kind: "list", startLine: 4, endLine: 5 },
      { kind: "list", startLine: 5, endLine: 6 },
      { kind: "step", startLine: 7, endLine: 8 },
      { kind: "step", startLine: 8, endLine: 9 },
      { kind: "code", startLine: 10, endLine: 13 },
      { kind: "table", startLine: 14, endLine: 17 },
      { kind: "blockquote", startLine: 18, endLine: 19 },
    ]);
  });

  it("keeps nested and ordered list items as separate source boundaries", () => {
    const markdown = "- parent\r\n  - child\r\n\r\n1. first\r\n";
    expect(parseMarkdownSourceBlocks(markdown)).toEqual([
      { kind: "list", startLine: 0, endLine: 2 },
      { kind: "list", startLine: 1, endLine: 2 },
      { kind: "step", startLine: 3, endLine: 4 },
    ]);
  });
});
