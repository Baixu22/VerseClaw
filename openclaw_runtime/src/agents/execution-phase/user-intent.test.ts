import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { fsyncSync } from "node:fs";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, fsyncSync: vi.fn(fs.fsyncSync) };
});
import { SessionManager } from "../sessions/session-manager.js";
import { prepareSessionManagerForRun } from "../embedded-agent-runner/session-manager-init.js";
import { guardSessionManager } from "../session-tool-result-guard-wrapper.js";

it("persists and preserves the first user intent through restart before any assistant turn", async () => {
  const dir = mkdtempSync(join(tmpdir(), "recovery-user-"));
  const file = join(dir, "session.jsonl");
  try {
    const manager = SessionManager.open(file, dir);
    manager.appendMessage({ role: "user", content: "durable request", timestamp: 1 });
    expect(readFileSync(file, "utf8")).toContain("durable request");
    const restored = SessionManager.open(file, dir);
    await prepareSessionManagerForRun({
      sessionManager: restored,
      sessionFile: file,
      hadSessionFile: true,
      sessionId: manager.getSessionId(),
      cwd: dir,
    });
    expect(restored.buildSessionContext().messages).toMatchObject([
      { role: "user", content: "durable request" },
    ]);
    expect(SessionManager.open(file, dir).buildSessionContext().messages).toHaveLength(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("flushes assistant dispatch and real results, and propagates a failed flush", () => {
  const dir = mkdtempSync(join(tmpdir(), "recovery-message-"));
  const file = join(dir, "session.jsonl");
  try {
    const manager = SessionManager.open(file, dir);
    vi.mocked(fsyncSync).mockClear();
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "toolCall", id: "call", name: "read", arguments: {} }],
      api: "openai-completions",
      provider: "openai",
      model: "fixture",
      stopReason: "toolUse",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: 1,
    });
    manager.appendMessage({
      role: "toolResult",
      toolCallId: "call",
      toolName: "read",
      content: [{ type: "text", text: "real result" }],
      isError: false,
      timestamp: 2,
    });
    expect(fsyncSync).toHaveBeenCalledTimes(2);
    expect(SessionManager.open(file, dir).buildSessionContext().messages).toHaveLength(2);
    vi.mocked(fsyncSync).mockImplementationOnce(() => {
      throw new Error("EIO: flush failed");
    });
    expect(() =>
      manager.appendMessage({ role: "user", content: "next request", timestamp: 3 }),
    ).toThrow("flush failed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("propagates the synchronous lifecycle-owner failure through the real transcript guard", () => {
  const dir = mkdtempSync(join(tmpdir(), "recovery-owner-"));
  try {
    const manager = guardSessionManager(SessionManager.open(join(dir, "session.jsonl"), dir), {
      onMessagePersisted: () => {
        throw new Error("dispatch commit failed");
      },
    });
    expect(() => manager.appendMessage({ role: "user", content: "request", timestamp: 1 })).toThrow(
      "dispatch commit failed",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
