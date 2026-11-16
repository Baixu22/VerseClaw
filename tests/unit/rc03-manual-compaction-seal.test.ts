// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { testing } from "../../openclaw_runtime/src/agents/embedded-agent-runner/compact";
import {
  getRc03SealPlan,
  releaseRc03Run,
  resetRc03SealPlansForTest,
} from "../../openclaw_runtime/src/context-engine/rc03-seal-hook";
import { closeOpenClawStateDatabase } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { SUMMARIZATION_SYSTEM_PROMPT } from "../../openclaw_runtime/packages/agent-core/src/harness/compaction/compaction";
import type { StreamFn } from "../../openclaw_runtime/src/agents/runtime";

let directory: string | undefined;
afterEach(() => {
  closeOpenClawStateDatabase();
  resetRc03SealPlansForTest();
  vi.unstubAllEnvs();
  if (directory) rmSync(directory, { recursive: true, force: true });
});
it("prepares a standalone compaction stream with a valid fallback run identity", async () => {
  directory = mkdtempSync(join(tmpdir(), "tf0739-manual-compact-"));
  vi.stubEnv("OPENCLAW_STATE_DIR", directory);
  vi.stubEnv("OPENCLAW_CONFIG_PATH", join(directory, "absent.json"));
  vi.stubEnv("OPENCLAW_RC03_SEAL", "1");
  vi.stubEnv("VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH", "");
  const model = {
    id: "fixture",
    name: "fixture",
    provider: "fixture",
    api: "fixture",
    baseUrl: "http://127.0.0.1",
    reasoning: false,
    input: ["text"],
    contextWindow: 32000,
    maxTokens: 1024,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const inner = vi.fn(() => ({}) as never);
  const session: { agent: { streamFn?: unknown } } = { agent: {} };
  testing.prepareCompactionSessionAgent({
    session,
    providerStreamFn: inner,
    sessionId: "manual-session",
    signal: new AbortController().signal,
    effectiveModel: model as never,
    authStorage: undefined,
    config: { runtime: { rc03: { seal: true } } } as never,
    provider: "fixture",
    modelId: "fixture",
    thinkLevel: "off",
    sessionAgentId: "main",
    effectiveWorkspace: directory,
    agentDir: directory,
  });
  await (session.agent.streamFn as StreamFn)(
    model as never,
    { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: [] } as never,
  );
  expect(inner).toHaveBeenCalledTimes(1);
  expect(getRc03SealPlan("manual-session", 0)?.preSealProducers).toContainEqual({
    producerId: "compaction-summarizer",
    producerVersion: "1",
    applied: true,
  });
  releaseRc03Run("manual-session");
});
