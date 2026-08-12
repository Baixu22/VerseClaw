import { describe, expect, it } from "vitest";
import { resolveMainSessionResumeBlockReason } from "./main-session-restart-recovery-boundary.js";

describe("main session restart recovery transcript boundary", () => {
  it.each([
    ["provider turn aborted by restart", { role: "assistant", stopReason: "aborted" }],
    ["assistant tool call awaiting results", { role: "assistant", stopReason: "toolUse" }],
    ["latest user input", { role: "user", content: "continue" }],
    ["latest tool output", { role: "toolResult", content: [] }],
  ])("resumes %s", (_label, message) => {
    expect(resolveMainSessionResumeBlockReason([message])).toBeNull();
  });

  it.each([
    ["assistant turn without terminal marker", { role: "assistant", content: "partial" }],
    ["completed response", { role: "assistant", stopReason: "stop" }],
    ["length-limited response", { role: "assistant", stopReason: "length" }],
    ["terminal provider error", { role: "assistant", stopReason: "error" }],
    ["system-only transcript", { role: "system", content: "Compaction" }],
  ])("blocks %s", (_label, message) => {
    expect(resolveMainSessionResumeBlockReason([message])).toBe("transcript tail is not resumable");
  });

  it("does not block a transcript whose tail is an interrupted assistant turn", () => {
    expect(
      resolveMainSessionResumeBlockReason([
        { role: "user", content: "run a long task" },
        { role: "assistant", content: [{ type: "toolUse", id: "call-1" }], stopReason: "toolUse" },
      ]),
    ).toBeNull();
  });

  it("keeps approval-pending tool results blocked", () => {
    expect(
      resolveMainSessionResumeBlockReason([
        { role: "user", content: "approve this" },
        { role: "toolResult", details: { status: "approval-pending" } },
      ]),
    ).toBe("transcript tail is a stale approval-pending tool result");
  });
});
