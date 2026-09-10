import { describe, expect, it, vi } from "vitest";
import { createExternalProvenance } from "../../../../shared/security/content-provenance.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { resolveCommandSecretRefsViaGateway } from "../../gateway/cli-runtime/command-secret-gateway.js";
import type {
  MessageActionRunResult,
  runMessageAction,
} from "../../infra/outbound/message-action-runner.js";
import { createMessageTool } from "./message-tool.js";

const provenance = createExternalProvenance({
  sourceKind: "channel",
  sourceId: "channel:telegram:message-1",
  receivedAt: "2026-08-21T00:00:00.000Z",
});

function createResult(): MessageActionRunResult {
  return {
    kind: "send" as const,
    channel: "telegram" as const,
    action: "send" as const,
    to: "chat:current",
    handledBy: "core" as const,
    payload: { ok: true },
    dryRun: false,
  };
}

function createTool(options: {
  config?: OpenClawConfig;
  resolve?: typeof resolveCommandSecretRefsViaGateway;
  runMessageAction?: typeof runMessageAction;
}) {
  const runMessageAction = options.runMessageAction ?? vi.fn(async () => createResult());
  const resolveSecretRefs: typeof resolveCommandSecretRefsViaGateway =
    options.resolve ??
    (async ({ authorizeSecretRead, config, commandName }) => {
      await authorizeSecretRead?.({
        commandName,
        selectedTargets: [
          {
            path: "channels.telegram.secret",
            pathSegments: ["channels", "telegram", "secret"],
          },
        ],
      });
      return {
        resolvedConfig: config,
        diagnostics: [],
        targetStatesByPath: {},
        hadUnresolvedTargets: false,
      };
    });
  return {
    tool: createMessageTool({
      contentProvenanceContext: { provenance },
      agentAccountId: "default",
      currentChannelProvider: "telegram",
      currentChannelId: "chat:current",
      getRuntimeConfig: () => options.config ?? {},
      getScopedChannelsCommandSecretTargets: () => ({
        targetIds: new Set(["channels.telegram.secret"]),
      }),
      resolveCommandSecretRefsViaGateway: resolveSecretRefs,
      runMessageAction,
    }),
    runMessageAction,
  };
}

describe("message tool secret-read provenance wiring", () => {
  it("rejects a credential read for another account before dispatch", async () => {
    const runMessageAction = vi.fn(async () => createResult());
    const { tool } = createTool({ runMessageAction });

    await expect(
      tool.execute("call-1", {
        action: "send",
        channel: "telegram",
        accountId: "secondary",
        target: "chat:other",
        message: "hello",
      }),
    ).rejects.toThrow(/cross-context permission/u);
    expect(runMessageAction).not.toHaveBeenCalled();
  });

  it("keeps a current-account reply usable with external provenance", async () => {
    const { tool, runMessageAction } = createTool({});
    await tool.execute("call-1", {
      action: "send",
      channel: "telegram",
      accountId: "default",
      target: "chat:current",
      message: "hello",
    });
    expect(runMessageAction).toHaveBeenCalledTimes(1);
  });

  it("honors an explicit operator account override", async () => {
    const { tool, runMessageAction } = createTool({
      config: { tools: { message: { crossContext: { allowWithinProvider: true } } } },
    });
    await tool.execute("call-1", {
      action: "send",
      channel: "telegram",
      accountId: "secondary",
      target: "chat:other",
      message: "hello",
    });
    expect(runMessageAction).toHaveBeenCalledTimes(1);
  });
});
