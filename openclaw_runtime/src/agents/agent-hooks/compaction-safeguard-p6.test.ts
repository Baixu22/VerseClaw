import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "../runtime/index.js";
import { buildDeterministicCompressionArtifact } from "../../../packages/agent-core/src/harness/compaction/compression-artifact.js";
import { setCompactionSafeguardRuntime } from "./compaction-safeguard-runtime.js";

const providerSummarize = vi.fn<() => Promise<string>>();

vi.mock("../../plugins/compaction-provider.js", () => ({
  getCompactionProvider: vi.fn(() => ({ id: "p6-provider", summarize: providerSummarize })),
}));

import compactionSafeguardExtension from "./compaction-safeguard.js";

function userMessage(text: string): AgentMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp: 1 } as AgentMessage;
}

function previousArtifactWithMissingDecision() {
  return buildDeterministicCompressionArtifact({
    messages: [userMessage("Objective: ship the pipeline.")],
    previousSummary: undefined,
    summary: "## Goal and Progress\nShip the pipeline.",
    readFiles: [],
    modifiedFiles: [],
    semanticAtoms: [{
      id: "atom-goal-a",
      type: "goal",
      canonicalIdentity: "ship-pipeline",
      severity: "critical",
      confidence: 1,
      scope: "session",
      polarity: "positive",
      status: "verified",
      text: "Ship the validated compaction pipeline.",
      evidenceRefs: [{ type: "session", ref: "m1" }],
    }],
  });
}

type FakeHandler = (event: unknown, ctx: unknown) => Promise<{
  cancel?: boolean;
  compaction?: { details: { validatedPipeline: { mode: string } } };
}>;

type FakeApi = { on: ReturnType<typeof vi.fn>; handlers: Record<string, FakeHandler> };

function registerHandler(): { api: FakeApi; handler: FakeHandler } {
  const api: FakeApi = { on: vi.fn(), handlers: {} };
  api.on.mockImplementation((event: string, handler: FakeHandler) => {
    api.handlers[event] = handler;
  });
  compactionSafeguardExtension(api as never);
  const handler = api.handlers["session_before_compact"];
  if (!handler) throw new Error("session_before_compact not registered");
  return { api, handler };
}

function preparation() {
  return {
    firstKeptEntryId: "keep-1",
    messagesToSummarize: [
      userMessage("Objective: ship the validated compaction pipeline."),
      userMessage("Constraint: keep the pipeline deterministic."),
    ],
    turnPrefixMessages: [],
    isSplitTurn: false,
    tokensBefore: 2_000,
    previousSummary: undefined,
    previousArtifact: previousArtifactWithMissingDecision(),
    fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() },
    settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
  };
}

describe("compaction safeguard P6 enforcement", () => {
  beforeEach(() => {
    providerSummarize.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("would-retry provider stage retries a provider summary that drops the critical ledger", async () => {
    const sessionManager = {};
    setCompactionSafeguardRuntime(sessionManager, {
      provider: "p6-provider",
      promotionStage: "would-retry",
      qualityGuardMaxRetries: 1,
    });
    providerSummarize
      .mockResolvedValueOnce("General progress only; no critical ledger retained.")
      .mockResolvedValueOnce("## Goal and Progress\nShip the validated compaction pipeline.");

    const { handler } = registerHandler();
    const result = await handler(
      { preparation: preparation(), customInstructions: undefined, signal: new AbortController().signal } as never,
      { sessionManager } as never,
    );

    expect(providerSummarize).toHaveBeenCalledTimes(2);
    expect(result).not.toHaveProperty("cancel");
    expect(result.compaction.details.validatedPipeline.mode).toBe("would-retry");
  });

  it("critical-only provider stage cancels instead of persisting a critical-loss summary", async () => {
    const sessionManager = {};
    setCompactionSafeguardRuntime(sessionManager, {
      provider: "p6-provider",
      promotionStage: "critical-only",
      qualityGuardMaxRetries: 1,
    });
    providerSummarize.mockResolvedValueOnce("General progress only; no critical ledger retained.");

    const { handler } = registerHandler();
    const result = await handler(
      { preparation: preparation(), customInstructions: undefined, signal: new AbortController().signal } as never,
      { sessionManager } as never,
    );

    expect(providerSummarize).toHaveBeenCalledTimes(1);
    expect(result.cancel).toBe(true);
  });

  it("shadow stage never retries or cancels", async () => {
    const sessionManager = {};
    setCompactionSafeguardRuntime(sessionManager, { provider: "p6-provider" });
    providerSummarize.mockResolvedValueOnce("General progress only; no critical ledger retained.");

    const { handler } = registerHandler();
    const result = await handler(
      { preparation: preparation(), customInstructions: undefined, signal: new AbortController().signal } as never,
      { sessionManager } as never,
    );

    expect(providerSummarize).toHaveBeenCalledTimes(1);
    expect(result.cancel).toBeUndefined();
    expect(result.compaction.details.validatedPipeline.mode).toBe("shadow");
  });
});
