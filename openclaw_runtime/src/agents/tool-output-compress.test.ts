import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  compressToolOutputText,
  DEFAULT_TOOL_OUTPUT_CHAR_LIMIT,
} from "./tool-output-compress.js";
import { codingObservability } from "../context-engine/coding-observability.js";

describe("tool-output-compress (C6-2)", () => {
  beforeEach(() => codingObservability.reset());
  afterEach(() => codingObservability.reset());

  it("passes through under default limit", () => {
    const text = "ok".repeat(10);
    const out = compressToolOutputText(text);
    expect(out.truncated).toBe(false);
    expect(out.text).toBe(text);
  });

  it("truncates at configurable threshold", () => {
    const text = "z".repeat(DEFAULT_TOOL_OUTPUT_CHAR_LIMIT + 500);
    const out = compressToolOutputText(text, { limit: 1000 });
    expect(out.truncated).toBe(true);
    expect(out.originalChars).toBe(text.length);
    expect(out.text.length).toBeLessThan(text.length);
  });
});
