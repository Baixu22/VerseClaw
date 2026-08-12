import { describe, expect, it, vi } from "vitest";
import type { CompactResult } from "../../../context-engine/types.js";
import { executeManualCompactionRequest } from "./manual-compaction.js";

describe("executeManualCompactionRequest", () => {
  it("forces threshold compaction for the bound current session", async () => {
    const before = vi.fn(async () => {});
    const after = vi.fn(async () => {});
    const onCompacted = vi.fn(async () => {});
    const compact = vi.fn(async () => ({
      ok: true,
      compacted: true,
      result: {
        tokensBefore: 12_000,
        tokensAfter: 3_000,
        sessionId: "session-next",
        sessionFile: "next.jsonl",
      },
    }));

    const result = await executeManualCompactionRequest({
      request: { customInstructions: "Preserve open tasks" },
      sessionId: "session-current",
      sessionKey: "agent:main:current",
      sessionFile: "current.jsonl",
      tokenBudget: 32_000,
      runtimeContext: { trigger: "manual" },
      compact,
      before,
      after,
      onCompacted,
    });

    expect(compact).toHaveBeenCalledOnce();
    expect(compact).toHaveBeenCalledWith({
      sessionId: "session-current",
      sessionKey: "agent:main:current",
      sessionFile: "current.jsonl",
      tokenBudget: 32_000,
      force: true,
      compactionTarget: "threshold",
      customInstructions: "Preserve open tasks",
      runtimeContext: { trigger: "manual" },
    });
    expect(before).toHaveBeenCalledOnce();
    expect(onCompacted).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, compacted: true }),
    );
    expect(after).toHaveBeenCalledWith(expect.objectContaining({ ok: true, compacted: true }));
    expect(result).toMatchObject({
      ok: true,
      compacted: true,
      sessionId: "session-next",
      sessionFile: "next.jsonl",
    });
  });

  it("returns a bounded failure and still runs the after hook", async () => {
    const after = vi.fn(async () => {});
    const compact = vi.fn(async () => {
      throw new Error("summary provider unavailable");
    });

    const result = await executeManualCompactionRequest({
      request: {},
      sessionId: "session-current",
      sessionFile: "current.jsonl",
      tokenBudget: 32_000,
      runtimeContext: {},
      compact,
      after,
    });

    expect(result).toMatchObject({
      ok: false,
      compacted: false,
      reason: "summary provider unavailable",
      sessionId: "session-current",
      sessionFile: "current.jsonl",
    });
    expect(after).toHaveBeenCalledWith(expect.objectContaining({ ok: false, compacted: false }));
  });

  it("preserves a successful compaction when post-processing fails", async () => {
    const after = vi.fn(async () => {});
    const onPostProcessingError = vi.fn();
    const compact = vi.fn(
      async (): Promise<CompactResult> => ({
        ok: true,
        compacted: true,
        result: {
          tokensBefore: 12_000,
          sessionId: "session-next",
          sessionFile: "next.jsonl",
        },
      }),
    );

    const result = await executeManualCompactionRequest({
      request: {},
      sessionId: "session-current",
      sessionFile: "current.jsonl",
      tokenBudget: 32_000,
      runtimeContext: {},
      compact,
      onCompacted: async () => {
        throw new Error("maintenance unavailable");
      },
      onPostProcessingError,
      after,
    });

    expect(result).toMatchObject({
      ok: true,
      compacted: true,
      sessionId: "session-next",
      sessionFile: "next.jsonl",
    });
    expect(onPostProcessingError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "maintenance unavailable" }),
    );
    expect(after).toHaveBeenCalledWith(expect.objectContaining({ ok: true, compacted: true }));
  });
});
