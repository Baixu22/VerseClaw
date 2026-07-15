import { describe, expect, it } from "vitest";
import { testing } from "./openai-transport-stream.js";

describe("OpenAI Responses transport event compatibility", () => {
  it("prefers SDK response event type and keeps legacy event fallback", () => {
    expect(testing.resolveResponsesEventType({ type: "response.completed" })).toBe(
      "response.completed",
    );
    expect(testing.resolveResponsesEventType({ event: "response.completed" })).toBe(
      "response.completed",
    );
  });

  it("uses call_id for function outputs and marks completed tool calls as toolUse", () => {
    expect(testing.resolveResponsesFunctionCallId({ id: "fc_1", call_id: "call_1" })).toBe(
      "call_1",
    );
    expect(testing.resolveResponsesStopReason("completed", true)).toBe("toolUse");
    expect(testing.resolveResponsesStopReason("incomplete", false)).toBe("length");
    expect(testing.resolveResponsesStopReason("completed", false)).toBe("stop");
  });
});
