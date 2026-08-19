import { describe, expect, it } from "vitest";
import { normalizeRequestEnvelope } from "../../shared/types/context-control-plane/artifacts";
import { createCompilePlan } from "../../openclaw_runtime/src/context-engine/compile-plan";
import { RC03_SEAL_POLICY_DIGEST } from "../../openclaw_runtime/src/context-engine/rc03-seal-hook";
import { registerRc03SealProducers } from "../../openclaw_runtime/src/context-engine/rc03-producers";
import {
  buildStage1RequestEnvelope,
} from "../../openclaw_runtime/src/agents/stage1-request-envelope";

describe("stage1 provider guard acceptance surface", () => {
  it("builds and normalizes a golden RequestEnvelope with all five coverage families", () => {
    registerRc03SealProducers();
    const plan = createCompilePlan({
      sessionKey: "sess:golden",
      runId: "run:golden",
      providerId: "deepseek",
      adapterId: "openai-completions",
      policyDigest: RC03_SEAL_POLICY_DIGEST,
      callIndex: { attemptIndex: 0, planRevision: 0, modelCallIndex: 0, wireAttemptIndex: 0 },
      preSealProducers: [
        { producerId: "dcs-knowledge", producerVersion: "1", applied: true },
      ],
      postSealTransformIds: ["transport-wire-serialization"],
    });
    const body = {
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "write sentinel" },
      ],
      tools: [{ type: "function", function: { name: "write" } }],
    };
    const built = buildStage1RequestEnvelope({
      body,
      bodyText: JSON.stringify(body),
      providerId: "deepseek",
      adapterId: "openai-completions",
      modelId: "deepseek-v4-flash",
      url: "https://api.deepseek.com/v1/chat/completions",
      method: "POST",
      endpointClass: "public",
      wireAttemptIndex: 0,
      shadow: {
        enabled: true,
        sessionKey: "sess:golden",
        runId: "run:golden",
        attemptIndex: 0,
        modelCallIndex: 0,
        rc03Plan: plan,
      },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(() => normalizeRequestEnvelope(built.envelope)).not.toThrow();
    expect(built.envelope.system).toHaveLength(1);
    expect(built.envelope.messages).toHaveLength(1);
    expect(built.envelope.tools).toHaveLength(1);
    expect(built.envelope.media).toHaveLength(0);
    expect(built.envelope.transforms.length).toBeGreaterThan(0);
  });
});
