// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiptStore } from "../../openclaw_runtime/src/agents/receipt-store";
import { closeOpenClawStateDatabase } from "../../openclaw_runtime/src/state/openclaw-state-db";
import {
  getRc03SealPlan,
  nextRc03ModelCallIndex,
  resetRc03SealPlansForTest,
} from "../../openclaw_runtime/src/context-engine/rc03-seal-hook";
import { resetSealRegistryForTests } from "../../openclaw_runtime/src/context-engine/seal-registry";
import { runBtwSideQuestion } from "../../openclaw_runtime/src/agents/btw";

const fixtures = vi.hoisted(() => ({
  model: {
    provider: "fixture",
    api: "fixture",
    id: "fixture",
    name: "fixture",
    baseUrl: "http://127.0.0.1",
    reasoning: false,
    input: ["text"],
    contextWindow: 32000,
    maxTokens: 1024,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  stream: vi.fn(),
}));
vi.mock("../../openclaw_runtime/src/agents/btw-transcript", () => ({
  resolveBtwSessionTranscriptPath: () => "/fixture/session.jsonl",
  readBtwTranscriptMessages: async () => [
    { role: "user", content: "Prior task context", timestamp: 1 },
  ],
}));
vi.mock("../../openclaw_runtime/src/agents/agent-model-discovery", () => ({
  discoverAuthStorage: () => ({}),
  discoverModels: () => ({}),
}));
vi.mock("../../openclaw_runtime/src/agents/embedded-agent-runner/model", () => ({
  resolveModelWithRegistry: () => fixtures.model,
}));
vi.mock("../../openclaw_runtime/src/agents/models-config", () => ({
  ensureOpenClawModelsJson: async () => {},
}));
vi.mock("../../openclaw_runtime/src/agents/harness/selection", () => ({
  selectAgentHarness: () => ({ id: "default" }),
  resolveAvailableAgentHarnessPolicy: () => ({ runtime: "default" }),
}));
vi.mock("../../openclaw_runtime/src/agents/auth-profiles/session-override", () => ({
  resolveSessionAuthProfileOverride: async () => undefined,
}));
vi.mock("../../openclaw_runtime/src/agents/auth-profiles/external-cli-auth-selection", () => ({
  resolveExternalCliAuthOverlayScopeFromSelection: () => ({}),
}));
vi.mock("../../openclaw_runtime/src/agents/model-auth", () => ({
  ensureAuthProfileStore: () => ({}),
  ensureAuthProfileStoreWithoutExternalProfiles: () => ({}),
  getApiKeyForModel: async () => ({ mode: "aws-sdk" }),
  requireApiKey: () => undefined,
}));
vi.mock("../../openclaw_runtime/src/agents/provider-stream", () => ({
  registerProviderStreamForModel: () => fixtures.stream,
}));

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "tf0739-btw-"));
  vi.stubEnv("OPENCLAW_STATE_DIR", directory);
  vi.stubEnv("OPENCLAW_CONFIG_PATH", join(directory, "absent.json"));
  vi.stubEnv("VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH", "");
  vi.stubEnv("OPENCLAW_RC02_SHADOW_CENSUS", "");
  fixtures.stream.mockReset();
  resetRc03SealPlansForTest();
  resetSealRegistryForTests();
});
afterEach(() => {
  closeOpenClawStateDatabase();
  resetRc03SealPlansForTest();
  resetSealRegistryForTests();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("TF-0739 real BTW entry with agent-driven provider response", () => {
  it.each([false, true])(
    "answers the side question with seal=%s and releases its owned run",
    async (enabled) => {
      vi.stubEnv("OPENCLAW_RC03_SEAL", enabled ? "1" : "");
      let observedRunId: string | undefined;
      fixtures.stream.mockImplementation((_model: unknown, context: { systemPrompt: string }) => {
        expect(context.systemPrompt).toContain("ephemeral /btw side question");
        const rows = new ReceiptStore()
          .list({ kind: "context" })
          .filter((row) => row.version === "1");
        expect(rows).toHaveLength(enabled ? 1 : 0);
        if (enabled) {
          observedRunId = rows[0]?.run_id ?? undefined;
          expect(getRc03SealPlan(observedRunId)?.preSealProducers).toContainEqual({
            producerId: "btw-side-question",
            producerVersion: "1",
            applied: true,
          });
        }
        const message = {
          role: "assistant",
          content: [{ type: "text", text: "Side answer" }],
          stopReason: "stop",
        };
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: "done", message, reason: "stop" };
          },
          result: async () => message,
        };
      });
      const reply = await runBtwSideQuestion({
        cfg: {
          agents: { defaults: { workspace: directory } },
          runtime: { rc03: { seal: enabled } },
        } as never,
        agentDir: directory,
        provider: "fixture",
        model: "fixture",
        question: "What is the status?",
        sessionEntry: { sessionId: "btw-session" } as never,
        sessionKey: "agent:main:btw",
        resolvedReasoningLevel: "off",
        isNewSession: false,
      });
      expect(reply?.text).toBe("Side answer");
      expect(fixtures.stream).toHaveBeenCalledTimes(1);
      if (observedRunId) {
        expect(getRc03SealPlan(observedRunId)).toBeUndefined();
        expect(nextRc03ModelCallIndex(observedRunId, 0, 0)).toBe(0);
      }
    },
  );
});
