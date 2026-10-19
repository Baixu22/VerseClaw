import { describe, expect, it } from "vitest";
import { parseRetryAfterMsFromText } from "./retry-after.js";

describe("parseRetryAfterMsFromText", () => {
  it("keeps fractional millisecond hints", () => {
    expect(parseRetryAfterMsFromText("retry-after-ms: 1.4")).toBe(1.4);
  });
  it("converts second hints to milliseconds", () => {
    expect(parseRetryAfterMsFromText("Retry-After: 3")).toBe(3000);
  });
  it("reads natural language waits", () => {
    expect(parseRetryAfterMsFromText("rate limited; try again in 2 seconds")).toBe(2000);
    expect(parseRetryAfterMsFromText("wait 750ms")).toBe(750);
  });
  it("does not invent a hint for invalid or missing text", () => {
    expect(parseRetryAfterMsFromText("429")).toBeUndefined();
    expect(parseRetryAfterMsFromText("retry-after: -1")).toBeUndefined();
    expect(parseRetryAfterMsFromText(undefined)).toBeUndefined();
  });
});
