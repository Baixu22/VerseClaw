import { describe, expect, it } from "vitest";
import { SessionManager } from "./session-manager.js";

describe("SessionManager persisted tool-result cap", () => {
  it("bounds tool result text before adding it to the transcript tree", () => {
    const manager = SessionManager.inMemory();
    manager.appendMessage({
      role: "toolResult",
      toolCallId: "tool-1",
      toolName: "flood",
      isError: false,
      content: [{ type: "text", text: "x".repeat(200_000) }],
      timestamp: Date.now(),
    });
    const entry = manager.getEntries().find((candidate) => candidate.type === "message");
    expect(entry?.type).toBe("message");
    if (!entry || entry.type !== "message") return;
    const content = entry.message.role === "toolResult" ? entry.message.content : [];
    const text = Array.isArray(content) && content[0]?.type === "text" ? content[0].text : "";
    expect(text.length).toBeLessThanOrEqual(80_000);
    expect(text).toContain("truncated before persistence");
  });
});
