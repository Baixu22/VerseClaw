// R1-02: DeepSeek V4 reasoning-effort payload mapping must match the
// provider's documented effort semantics instead of silently promoting
// low to high and xhigh to max.
import { describe, expect, it } from "vitest";
import { createDeepSeekV4OpenAICompatibleThinkingWrapper } from "./provider-stream-shared.js";

type PayloadPatchFn = (payload: Record<string, unknown>) => void;

function renderPatchedPayload(thinkingLevel: string): Record<string, unknown> {
  let patched: Record<string, unknown> | undefined;
  const baseStreamFn = ((_model: unknown, _context: unknown, options: unknown) => {
    const opts = options as { onPayload?: (payload: Record<string, unknown>) => void };
    const payload: Record<string, unknown> = {
      messages: [
        { role: "assistant", content: "x" },
        { role: "assistant", content: "x", reasoning_content: "drop" },
      ],
    };
    opts.onPayload?.(payload);
    patched = payload;
    return undefined;
  }) as unknown as Parameters<typeof createDeepSeekV4OpenAICompatibleThinkingWrapper>[0]["baseStreamFn"];

  const wrapper = createDeepSeekV4OpenAICompatibleThinkingWrapper({
    baseStreamFn,
    thinkingLevel: thinkingLevel as Parameters<
      typeof createDeepSeekV4OpenAICompatibleThinkingWrapper
    >[0]["thinkingLevel"],
    shouldPatchModel: () => true,
  });
  wrapper?.("deepseek-v4-pro", {}, {});
  if (!patched) {
    throw new Error("expected payload patch to run");
  }
  return patched;
}

describe("DeepSeek V4 reasoning effort payload mapping", () => {
  it.each([
    ["minimal", "low"],
    ["low", "low"],
    ["medium", "high"],
    ["high", "high"],
    ["xhigh", "high"],
    ["max", "max"],
  ])("maps thinking level %s to reasoning_effort %s", (level, expected) => {
    const payload = renderPatchedPayload(level);
    expect(payload.thinking).toEqual({ type: "enabled" });
    expect(payload.reasoning_effort).toBe(expected);
  });

  it("disables thinking and removes stale reasoning fields for off/none", () => {
    for (const level of ["off", "none"]) {
      const payload = renderPatchedPayload(level);
      expect(payload.thinking).toEqual({ type: "disabled" });
      expect(payload.reasoning_effort).toBeUndefined();
      expect(payload.reasoning).toBeUndefined();
    }
  });

  it("backfills empty assistant reasoning_content without deleting existing content", () => {
    const payload = renderPatchedPayload("high");
    const messages = payload.messages as Array<Record<string, unknown>>;
    expect(messages[0]?.reasoning_content).toBe("");
    expect(messages[1]?.reasoning_content).toBe("drop");
  });
});
