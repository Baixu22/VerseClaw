import { describe, expect, it, vi } from "vitest";
import { createExternalProvenance } from "../../../../shared/security/content-provenance.js";
import { createMessageTool } from "./message-tool.js";

describe("message tool provenance wiring", () => {
  it("passes the run sidecar to the outbound action policy", async () => {
    const provenance = createExternalProvenance({
      sourceKind: "channel",
      sourceId: "channel:telegram:message-1",
      receivedAt: "2026-08-21T00:00:00.000Z",
    });
    const runMessageAction = vi.fn(async () => ({
      kind: "send" as const,
      channel: "telegram" as const,
      action: "send" as const,
      to: "chat:current",
      handledBy: "core" as const,
      payload: { ok: true },
      dryRun: false,
    }));
    const tool = createMessageTool({
      contentProvenanceContext: { provenance },
      currentChannelProvider: "telegram",
      currentChannelId: "chat:current",
      getRuntimeConfig: () => ({}),
      getScopedChannelsCommandSecretTargets: () => ({ targetIds: new Set() }),
      resolveCommandSecretRefsViaGateway: async ({ config }) => ({
        resolvedConfig: config,
        diagnostics: [],
        targetStatesByPath: {},
        hadUnresolvedTargets: false,
      }),
      runMessageAction,
    });

    await tool.execute("call-1", {
      action: "send",
      target: "chat:current",
      message: "hello",
    });

    expect(runMessageAction).toHaveBeenCalledWith(
      expect.objectContaining({ provenanceContext: { provenance } }),
    );
  });
});
