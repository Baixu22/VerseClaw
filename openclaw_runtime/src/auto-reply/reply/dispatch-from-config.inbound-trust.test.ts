import { describe, expect, it, vi } from "vitest";
import { dispatchReplyFromConfig } from "./dispatch-from-config.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { FinalizedMsgContext } from "../templating.js";
import type { ReplyDispatcher } from "./reply-dispatcher.types.js";

function createDispatcher(): ReplyDispatcher {
  const counts = () => ({ tool: 0, block: 0, final: 0 });
  return {
    sendToolResult: vi.fn(() => true),
    sendBlockReply: vi.fn(() => true),
    sendFinalReply: vi.fn(() => true),
    waitForIdle: vi.fn(async () => {}),
    getQueuedCounts: vi.fn(counts),
    getFailedCounts: vi.fn(counts),
    markComplete: vi.fn(),
  };
}

describe("dispatchReplyFromConfig inbound admission", () => {
  it.each(["feishu", "wecom", "discord", "telegram"])(
    "rejects unauthorized %s traffic before reply resolution",
    async (surface) => {
      const replyResolver = vi.fn();
      const ctx = {
        Body: "untrusted content",
        BodyForAgent: "untrusted content",
        BodyForCommands: "untrusted content",
        From: "unpaired-sender",
        Surface: surface,
        Provider: surface,
        SenderId: "unpaired-sender",
        CommandAuthorized: false,
        ChatType: "private",
        SessionKey: "agent:test:session",
      } as unknown as FinalizedMsgContext;

      const result = await dispatchReplyFromConfig({
        cfg: {} as OpenClawConfig,
        ctx,
        dispatcher: createDispatcher(),
        replyResolver,
      });

      expect(result.queuedFinal).toBe(false);
      expect(replyResolver).not.toHaveBeenCalled();
    },
  );
});
