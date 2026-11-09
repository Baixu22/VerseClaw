// RC-02R CLI entry: the real `agentCommand` entry used by the CLI.
//
// Same bounded bootstrap as the inbound and cron rows: bundled plugin discovery
// is disabled, the agent models.json is seeded so the model catalog resolves, the
// provider credential comes from OPENAI_API_KEY, and the runtime config is read
// from a fixture openclaw.json. The entry, the embedded run, the guarded
// transport boundary and the receipts are production code; bundled plugin
// discovery is not exercised, and that narrowing is recorded in the RC-02 census.
//
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { closeOpenClawAgentDatabasesForTest } from "../state/openclaw-agent-db.js";
import { closeAllFactStores } from "../context-engine/factstore/store.js";
import { __resetWorkspaceFactServiceRegistry } from "../context-engine/factstore/workspace-fact-service.js";
import { resetPluginStateStoreForTests } from "../plugin-state/plugin-state-store.js";
import { clearPluginLoaderCache } from "../plugins/loader.js";
import { testing as providerRuntimeTesting } from "../plugins/provider-runtime.js";
import { resetPluginRuntimeStateForTest } from "../plugins/runtime.js";
import { clearTaskStateHandlerConfig } from "./harness/lifecycle-hook-helpers.js";
import { closeTrackedSqliteHandlesUnder } from "../infra/node-sqlite.js";
import { ReceiptStore, type RuntimeReceiptRow } from "./receipt-store.js";
import { resolveDefaultAgentDir } from "./agent-scope-config.js";
import { agentCommand, agentCommandFromIngress } from "./agent-command.js";
import {
  loadSessionStore,
  resolveStorePath,
  updateSessionStoreAtomic,
} from "../config/sessions.js";
import { clearRuntimeConfigSnapshot } from "../config/config.js";
import { buildRunClaudeCliAgentParams, runCliAgent } from "./cli-runner.js";
import { LegacyContextEngine } from "../context-engine/legacy.js";
import {
  getContextEngineFactory,
  registerContextEngineForOwner,
} from "../context-engine/registry.js";
import { ensureContextEnginesInitialized } from "../context-engine/init.js";
import { SessionManager } from "./sessions/index.js";
import type { AssistantMessage } from "../llm/types.js";
import { CONTEXT_RUNTIME_KIT_ENGINE_ID } from "../context-engine/cvk/engine.js";
import { admitMainSessionRecovery } from "./recovery-authority/main-session-admission.js";
import { getRecoveryAdmissionIdentity } from "./recovery-authority/owner-admission.js";
import { onAgentEvent } from "../infra/agent-events.js";
import { mergeSessionEntryWithPolicy } from "../config/sessions.js";

const tempRoots: string[] = [];

// This generic CLI fixture does not load the bundled Anthropic provider facade.
vi.mock("../plugin-sdk/anthropic-cli.js", () => ({
  CLAUDE_CLI_BACKEND_ID: "claude-cli",
  isClaudeCliProvider: (provider: string) => provider === "claude-cli",
}));

const store = () => new ReceiptStore({ env: process.env });

beforeEach(() => {
  clearRuntimeConfigSnapshot();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rc02-cli-entry-"));
  tempRoots.push(root);
  const stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, "home");
  process.env.OPENCLAW_STATE_DIR = stateDir;
  process.env.OPENCLAW_RC02_SHADOW_CENSUS = "1";
  process.env.OPENCLAW_DISABLE_BUNDLED_PLUGINS = "1";
  process.env.OPENAI_API_KEY = "fixture-key";
  process.env.OPENCLAW_TEST_FAST = "1";
});

afterEach(() => {
  clearRuntimeConfigSnapshot();
  resetPluginRuntimeStateForTest();
  clearTaskStateHandlerConfig();
  providerRuntimeTesting.clearProviderRuntimePluginCacheForTest();
  clearPluginLoaderCache();
  closeOpenClawAgentDatabasesForTest();
  resetPluginStateStoreForTests();
  __resetWorkspaceFactServiceRegistry();
  closeAllFactStores();
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_RC02_SHADOW_CENSUS;
  delete process.env.OPENCLAW_DISABLE_BUNDLED_PLUGINS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENCLAW_TEST_FAST;
  delete process.env.OPENCLAW_CONFIG_PATH;
  vi.unstubAllEnvs();
  for (const root of tempRoots.splice(0)) {
    closeTrackedSqliteHandlesUnder(root);
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch {
      // Windows can hold a handle on the state sqlite; an OS temp dir failing to
      // be removed must not turn a passing test red.
    }
  }
});

type CapturedRequest = { url: string; body: string };

function openAiResponsesTextSse(text = "ok"): string {
  const item = {
    type: "message",
    id: "msg-rc02-cli",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  };
  return [
    { type: "response.output_item.added", item: { ...item, status: "in_progress", content: [] } },
    {
      type: "response.content_part.added",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "" },
    },
    {
      type: "response.output_text.delta",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      delta: text,
    },
    {
      type: "response.output_text.done",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      text,
    },
    { type: "response.output_item.done", item },
    {
      type: "response.completed",
      response: {
        id: "response-rc02-cli",
        status: "completed",
        output: [item],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    },
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
}

function installTransportSpy(): { captured: CapturedRequest[]; restore: () => void } {
  const captured: CapturedRequest[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    captured.push({ url: request.url, body: await request.clone().text() });
    return new Response(openAiResponsesTextSse(), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof fetch;
  return {
    captured,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function expectDualReceiptsForSurface(
  surface: string,
  captured: CapturedRequest[],
): RuntimeReceiptRow[] {
  const wireRows = store().list({ kind: "shadow_wire" });
  const contextRows = store().list({ kind: "shadow_context" });
  expect(captured.length, `${surface}: no model request was intercepted`).toBeGreaterThan(0);
  expect(
    wireRows.length,
    `${surface}: ${captured.length} model request(s) but ${wireRows.length} wire receipt(s)`,
  ).toBe(captured.length);
  const wireByDigest = new Map(wireRows.map((row) => [row.wire_digest, row]));
  for (const request of captured) {
    const digest = createHash("sha256").update(request.body).digest("hex");
    const wire = wireByDigest.get(digest);
    expect(
      wire,
      `${surface}: no wire receipt bound to the bytes sent to ${request.url}`,
    ).toBeDefined();
    expect(wire!.provider_id, `${surface}: wire receipt lost the provider identity`).toBeTruthy();
    expect(wire!.adapter_id, `${surface}: owner classification is unknown`).toBeTruthy();
    expect(wire!.runtime_mode, `${surface}: source-runtime coverage expected`).toBe("source");
  }
  const contextByCorrelation = new Map(contextRows.map((row) => [row.correlation_digest, row]));
  for (const wire of wireRows) {
    const context = contextByCorrelation.get(wire.correlation_digest);
    expect(context, `${surface}: wire receipt has no correlated context receipt`).toBeDefined();
    expect(context!.model_call_index, `${surface}: call index drifted across the pair`).toBe(
      wire.model_call_index,
    );
  }
  return wireRows;
}

const CLI_MODEL = {
  id: "gpt-rc02-cli",
  name: "RC-02 cli fixture",
  api: "openai-responses",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 4096,
};

function cliConfig(workspaceDir: string) {
  return {
    models: {
      mode: "replace",
      providers: {
        openai: {
          baseUrl: "http://127.0.0.1:40123/v1",
          apiKey: "fixture-key",
          api: "openai-responses",
          models: [CLI_MODEL],
        },
      },
    },
    agents: {
      defaults: { workspace: workspaceDir, model: { primary: "openai/gpt-rc02-cli" } },
    },
  };
}

describe("RC-02R CLI entry (bounded bootstrap)", () => {
  it("keeps an admitted recovery open through provider fallback and commits one command terminal", async () => {
    vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "authority");
    const root = tempRoots.at(-1)!;
    const workspaceDir = path.join(root, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    const cfg = cliConfig(workspaceDir);
    const fallbackModel = {
      ...CLI_MODEL,
      id: "gpt-admission-fallback",
      name: "admission fallback",
    };
    cfg.models.providers.openai.models.push(fallbackModel);
    Object.assign(cfg.agents.defaults.model, { fallbacks: ["openai/gpt-admission-fallback"] });
    const agentDir = resolveDefaultAgentDir(cfg as never);
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "models.json"),
      JSON.stringify({ providers: cfg.models.providers }),
    );
    const configPath = path.join(root, "openclaw.json");
    fs.writeFileSync(configPath, JSON.stringify(cfg));
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    const key = "agent:main:admitted-fallback";
    const storePath = resolveStorePath(undefined, { agentId: "main" });
    await updateSessionStoreAtomic(storePath, (sessions) => {
      sessions[key] = {
        sessionId: "admitted-generation",
        updatedAt: 1,
        status: "running",
        startedAt: 1,
        lifecycleRunId: "original",
        abortedLastRun: true,
        recoveryOutput: {
          sessionId: "admitted-generation",
          runId: "original",
          effect: "not_applied",
          visibleOutputObserved: false,
        },
      };
    });
    const admitted = await admitMainSessionRecovery({
      entry: loadSessionStore(storePath, { skipCache: true })[key],
      storePath,
      sessionKey: key,
      boundary: "original-intent",
      phase: { action: "none", phases: [], reason: "no pending tool" },
      resumeBlockReason: null,
      maxAttempts: 3,
    });
    if (admitted.kind !== "admitted") throw Error("missing admitted fixture");
    const phases: string[] = [];
    const unsubscribe = onAgentEvent((event) => {
      if (event.runId === admitted.record.idempotencyKey && event.stream === "lifecycle") {
        phases.push(String(event.data.phase));
      }
    });
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body = JSON.parse(await request.clone().text());
      calls++;
      return new Response(
        body.model === CLI_MODEL.id
          ? `data: ${JSON.stringify({ type: "response.failed", response: { status: "failed", error: { code: "model_not_found", message: "model not found" } } })}\n\n`
          : openAiResponsesTextSse(),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    }) as typeof fetch;
    try {
      await agentCommand({
        message: "original intent",
        sessionKey: key,
        sessionId: "admitted-generation",
        runId: admitted.record.idempotencyKey,
        recoveryAdmission: getRecoveryAdmissionIdentity(admitted.record),
        deliver: false,
        json: true,
      });
      expect(calls).toBe(2);
      expect(phases.filter((phase) => phase === "end" || phase === "error")).toEqual(["end"]);
      expect(loadSessionStore(storePath, { skipCache: true })[key]).toMatchObject({
        status: "done",
        lifecycleRunId: admitted.record.idempotencyKey,
      });
    } finally {
      globalThis.fetch = originalFetch;
      unsubscribe();
    }
  }, 90_000);

  it.each(["local", "ingress"])(
    "commits a failed command terminal before another turn starts (%s)",
    async (entrypoint) => {
      vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "authority");
      const root = tempRoots.at(-1)!;
      const workspaceDir = path.join(root, "workspace");
      fs.mkdirSync(workspaceDir, { recursive: true });
      const cfg = cliConfig(workspaceDir);
      const agentDir = resolveDefaultAgentDir(cfg as never);
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(
        path.join(agentDir, "models.json"),
        JSON.stringify({ providers: cfg.models.providers }),
      );
      const configPath = path.join(root, "openclaw.json");
      fs.writeFileSync(configPath, JSON.stringify(cfg));
      process.env.OPENCLAW_CONFIG_PATH = configPath;
      const key = `agent:main:failed-${entrypoint}`;
      const originalFetch = globalThis.fetch;
      let fail = true;
      globalThis.fetch = vi.fn(
        async () =>
          new Response(
            fail
              ? `data: ${JSON.stringify({ type: "response.failed", response: { status: "failed", error: { code: "model_not_found", message: "model not found" } } })}\n\n`
              : openAiResponsesTextSse(),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
      ) as typeof fetch;
      const command = entrypoint === "local" ? agentCommand : agentCommandFromIngress;
      try {
        const options = {
          message: "first turn",
          sessionKey: key,
          sessionId: "failed-generation",
          runId: "failed-run",
          provider: "openai",
          model: CLI_MODEL.id,
          deliver: false,
          json: true,
          allowModelOverride: true,
        };
        await expect(command(options)).rejects.toThrow();
        expect(
          loadSessionStore(resolveStorePath(undefined, { agentId: "main" }), { skipCache: true })[
            key
          ],
        ).toMatchObject({ status: "failed", lifecycleRunId: "failed-run" });
        fail = false;
        await command({ ...options, message: "next turn", runId: "next-run" });
        expect(
          loadSessionStore(resolveStorePath(undefined, { agentId: "main" }), { skipCache: true })[
            key
          ],
        ).toMatchObject({ status: "done", lifecycleRunId: "next-run" });
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
    90_000,
  );

  it("preserves the visible Session binding through the public Claude wrapper", () => {
    const params = {
      sessionId: "generation",
      sessionKey: "agent:main:wrapper",
      sessionStorePath: "D:/tmp/wrapper-session-store.json",
      sessionFile: "D:/tmp/wrapper-transcript.jsonl",
      workspaceDir: "D:/tmp",
      prompt: "request",
      timeoutMs: 20_000,
      runId: "wrapper-run",
    };
    expect(buildRunClaudeCliAgentParams(params).sessionStorePath).toBe(params.sessionStorePath);
  });

  it.each(["new-local-turn", "same-run-fallback"])(
    "commits unknown output before the actual CLI backend starts (%s)",
    async (turn) => {
      vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "authority");
      const root = tempRoots.at(-1)!;
      const workspaceDir = path.join(root, "workspace");
      fs.mkdirSync(workspaceDir, { recursive: true });
      const cfg = cliConfig(workspaceDir);
      const script = path.join(root, "cli-fixture.cjs");
      fs.writeFileSync(script, 'process.stdout.write("cli fixture completed");');
      Object.assign(cfg.agents.defaults, {
        cliBackends: {
          "fixture-cli": {
            command: process.execPath,
            args: [script],
            input: "stdin",
            output: "text",
            sessionMode: "none",
            systemPromptWhen: "never",
          },
        },
      });
      const sessionKey = "agent:main:cli-output-owner";
      const storePath = resolveStorePath(undefined, { agentId: "main" });
      await updateSessionStoreAtomic(storePath, (sessions) => {
        sessions[sessionKey] = {
          sessionId: "cli-generation",
          updatedAt: 1,
          startedAt: 1,
          status: turn === "new-local-turn" ? "done" : "running",
          lifecycleRunId: turn === "new-local-turn" ? "old-run" : "current-run",
          recoveryOutput: {
            sessionId: "cli-generation",
            runId: turn === "new-local-turn" ? "old-run" : "current-run",
            effect: "not_applied",
            visibleOutputObserved: false,
          },
        };
      });
      const observed = vi.fn(() => {
        expect(loadSessionStore(storePath, { skipCache: true })[sessionKey]).toMatchObject({
          lifecycleRunId: "current-run",
          status: "running",
          recoveryOutput: { runId: "current-run", effect: "unknown" },
        });
      });
      const result = await runCliAgent({
        sessionId: "cli-generation",
        sessionKey,
        sessionStorePath: storePath,
        sessionFile: path.join(root, "cli-transcript.jsonl"),
        workspaceDir,
        config: cfg as never,
        provider: "fixture-cli",
        prompt: "run the local fixture",
        timeoutMs: 20_000,
        runId: "current-run",
        onExecutionStarted: observed,
      });
      expect(observed).toHaveBeenCalledOnce();
      expect(result.payloads?.[0]?.text).toBe("cli fixture completed");
    },
    90_000,
  );

  it("starts each sequential local turn with its own running lifecycle", async () => {
    vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "authority");
    const root = tempRoots.at(-1)!;
    const workspaceDir = path.join(root, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    const cfg = cliConfig(workspaceDir);
    const agentDir = resolveDefaultAgentDir(cfg as never);
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "models.json"),
      JSON.stringify({ providers: cfg.models.providers }),
    );
    const configPath = path.join(root, "openclaw.json");
    fs.writeFileSync(configPath, JSON.stringify(cfg));
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    const sessionKey = "agent:main:local-sequential";
    const observed: Array<{ status?: string; runId?: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      const current = loadSessionStore(resolveStorePath(undefined, { agentId: "main" }), {
        skipCache: true,
      })[sessionKey];
      observed.push({ status: current.status, runId: current.lifecycleRunId });
      return new Response(openAiResponsesTextSse(), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;
    try {
      for (const message of ["first turn", "second turn"])
        await agentCommand({
          message,
          sessionKey,
          sessionId: "same-session",
          provider: "openai",
          model: CLI_MODEL.id,
          deliver: false,
          json: true,
        } as never);
      expect(observed).toHaveLength(2);
      expect(observed.map((row) => row.status)).toEqual(["running", "running"]);
      expect(new Set(observed.map((row) => row.runId)).size).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 90_000);

  it.each([
    "retry",
    "outer-fallback",
    "primary-probe",
    "legacy-retry",
    "legacy-primary-probe",
    "subagent-retry",
    "omitted-file",
    "pending-delivery",
  ])(
    "persists a native compaction successor before retries (path=%s)",
    async (pathKind) => {
      const outerFallback = pathKind === "outer-fallback";
      const primaryProbe = pathKind === "primary-probe" || pathKind === "legacy-primary-probe";
      const subagent = pathKind === "subagent-retry";
      const omittedFile = pathKind === "omitted-file";
      const pendingDelivery = pathKind === "pending-delivery";
      const authority = !pathKind.startsWith("legacy-");
      vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", authority ? "authority" : "legacy");
      const root = tempRoots.at(-1)!;
      const workspaceDir = path.join(root, "workspace");
      fs.mkdirSync(workspaceDir, { recursive: true });
      const cfg = cliConfig(workspaceDir);
      const fallbackModel = { ...CLI_MODEL, id: "gpt-fallback-fixture", name: "fallback fixture" };
      if (outerFallback || primaryProbe) {
        cfg.models.providers.openai.models.push(fallbackModel);
        Object.assign(cfg.agents.defaults.model, { fallbacks: ["openai/gpt-fallback-fixture"] });
      }
      const agentDir = resolveDefaultAgentDir(cfg as never);
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(
        path.join(agentDir, "models.json"),
        JSON.stringify({ providers: cfg.models.providers }),
      );
      const configPath = path.join(root, "openclaw.json");
      fs.writeFileSync(configPath, JSON.stringify(cfg));
      process.env.OPENCLAW_CONFIG_PATH = configPath;
      ensureContextEnginesInitialized();
      const originalFactory = getContextEngineFactory(CONTEXT_RUNTIME_KIT_ENGINE_ID)!;
      const sessionKey = subagent
        ? "agent:main:subagent:compaction-retry"
        : `agent:main:compaction-${pathKind}`;
      if (subagent)
        await updateSessionStoreAtomic(
          resolveStorePath(undefined, { agentId: "main" }),
          (sessions) => {
            sessions[sessionKey] = {
              sessionId: "compaction-predecessor",
              updatedAt: 1,
              status: "running",
              lifecycleRunId: "subagent-owner",
              abortedLastRun: true,
            };
          },
        );
      if (primaryProbe)
        await updateSessionStoreAtomic(
          resolveStorePath(undefined, { agentId: "main" }),
          (sessions) => {
            sessions[sessionKey] = {
              sessionId: "compaction-predecessor",
              updatedAt: 1,
              providerOverride: "openai",
              modelOverride: fallbackModel.id,
              modelOverrideSource: "auto",
              modelOverrideFallbackOriginProvider: "openai",
              modelOverrideFallbackOriginModel: CLI_MODEL.id,
            };
          },
        );
      let successor: string | undefined;
      let successorFile: string | undefined;
      let compactCalls = 0;
      let requestCalls = 0;
      const storedIdsBeforeRetry: Array<string | undefined> = [];
      registerContextEngineForOwner(
        CONTEXT_RUNTIME_KIT_ENGINE_ID,
        () => {
          const engine = new LegacyContextEngine(cfg, workspaceDir);
          Object.assign(engine.info, { ownsCompaction: true });
          engine.compact = async ({ sessionFile }) => {
            compactCalls++;
            const manager = SessionManager.open(sessionFile);
            manager.appendMessage({
              role: "user",
              content: "compacted original intent",
              timestamp: Date.now(),
            });
            manager.appendMessage({
              role: "assistant",
              content: [{ type: "text", text: "context summary" }],
              api: "openai-responses",
              provider: "openai",
              model: CLI_MODEL.id,
              stopReason: "stop",
              timestamp: Date.now(),
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
            } as AssistantMessage);
            successorFile = manager.createBranchedSession(manager.getLeafId()!);
            if (!successorFile) {
              throw new Error("Compaction fixture did not create a transcript");
            }
            successor = manager.getSessionId();
            if (omittedFile) {
              const ownedFile = path.join(path.dirname(sessionFile), `${successor}.jsonl`);
              fs.renameSync(successorFile, ownedFile);
              successorFile = ownedFile;
            }
            return {
              ok: true,
              compacted: true,
              result: {
                tokensBefore: 200_001,
                tokensAfter: 10,
                summary: "compaction fixture",
                sessionId: successor,
                ...(!omittedFile ? { sessionFile: successorFile } : {}),
              },
            };
          };
          return engine;
        },
        "core",
        { allowSameOwnerRefresh: true },
      );
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        if (request.url.includes("/responses")) {
          requestCalls++;
          const body = JSON.parse(await request.clone().text());
          if (body.model === CLI_MODEL.id && (requestCalls === 1 || outerFallback))
            return new Response(
              `data: ${JSON.stringify({
                type: "response.failed",
                response: {
                  status: "failed",
                  error: {
                    code: requestCalls === 1 ? "context_length_exceeded" : "model_not_found",
                    message:
                      requestCalls === 1 ? "maximum context length exceeded" : "model not found",
                  },
                },
              })}\n\n`,
              { status: 200, headers: { "content-type": "text/event-stream" } },
            );
          storedIdsBeforeRetry.push(
            loadSessionStore(resolveStorePath(undefined, { agentId: "main" }), { skipCache: true })[
              sessionKey
            ]?.sessionId,
          );
        }
        return new Response(openAiResponsesTextSse(), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }) as typeof fetch;
      const deliveryModule = pendingDelivery ? await import("./command/delivery.js") : undefined;
      const deliverSpy = deliveryModule
        ? vi.spyOn(deliveryModule, "deliverAgentCommandResult").mockImplementation(async () => {
            expect(
              loadSessionStore(resolveStorePath(undefined, { agentId: "main" }), {
                skipCache: true,
              })[sessionKey],
            ).toMatchObject({
              sessionId: successor,
              pendingFinalDelivery: true,
              pendingFinalDeliveryText: "ok",
            });
            return { deliverySucceeded: true } as never;
          })
        : undefined;
      try {
        await agentCommand({
          message: "original request",
          sessionKey,
          sessionId: "compaction-predecessor",
          ...(!outerFallback && !primaryProbe ? { provider: "openai", model: CLI_MODEL.id } : {}),
          agentId: "main",
          runId: "compaction-fixture-run",
          deliver: pendingDelivery,
          ...(pendingDelivery ? { channel: "telegram", to: "fixture-target" } : {}),
          ...(subagent ? { sessionEffects: "visible" } : {}),
          json: true,
          timeout: "20",
        } as never);
        expect(compactCalls).toBe(1);
        expect(requestCalls).toBe(outerFallback ? 3 : 2);
        expect(storedIdsBeforeRetry).toEqual([
          authority && !subagent ? successor : "compaction-predecessor",
        ]);
        expect(
          loadSessionStore(resolveStorePath(undefined, { agentId: "main" }), { skipCache: true })[
            sessionKey
          ],
        ).toMatchObject({
          sessionId: successor,
          sessionFile: successorFile,
          ...(authority && !subagent
            ? {
                status: "done",
                lifecycleRunId: "compaction-fixture-run",
                recoveryOutput: {
                  runId: "compaction-fixture-run",
                  effect: "unknown",
                  visibleOutputObserved: true,
                },
              }
            : {}),
        });
        if (pendingDelivery) {
          expect(deliverSpy).toHaveBeenCalledOnce();
          const completed = loadSessionStore(resolveStorePath(undefined, { agentId: "main" }), {
            skipCache: true,
          })[sessionKey];
          expect(completed.pendingFinalDelivery).toBeUndefined();
          expect(completed.restartRecoveryDeliveryContext).toBeUndefined();
        }
        if (primaryProbe) {
          const completed = loadSessionStore(resolveStorePath(undefined, { agentId: "main" }), {
            skipCache: true,
          })[sessionKey];
          expect(completed.modelOverride).toBeUndefined();
          expect(completed.modelOverrideFallbackOriginModel).toBeUndefined();
        }
      } finally {
        deliverSpy?.mockRestore();
        globalThis.fetch = originalFetch;
        registerContextEngineForOwner(CONTEXT_RUNTIME_KIT_ENGINE_ID, originalFactory, "core", {
          allowSameOwnerRefresh: true,
        });
      }
    },
    90_000,
  );

  it("adopts the committed identity returned by post-turn CLI compaction", async () => {
    vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "authority");
    const root = tempRoots.at(-1)!;
    const workspaceDir = path.join(root, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    const cfg = cliConfig(workspaceDir);
    const agentDir = resolveDefaultAgentDir(cfg as never);
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "models.json"),
      JSON.stringify({ providers: cfg.models.providers }),
    );
    const configPath = path.join(root, "openclaw.json");
    fs.writeFileSync(configPath, JSON.stringify(cfg));
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    const sessionKey = "agent:main:post-turn-compaction";
    const storePath = resolveStorePath(undefined, { agentId: "main" });
    let successor: string | undefined;
    let successorFile: string | undefined;
    const terminalIds: Array<string | undefined> = [];
    const unsubscribe = onAgentEvent((event) => {
      if (
        event.runId === "post-turn-run" &&
        event.stream === "lifecycle" &&
        event.data.phase === "end"
      )
        terminalIds.push(event.sessionId);
    });
    const module = await import("./command/cli-compaction.js");
    const compact = vi
      .spyOn(module, "runCliTurnCompactionLifecycle")
      .mockImplementation(async () => {
        const current = loadSessionStore(storePath, { skipCache: true })[sessionKey];
        const manager = SessionManager.open(current.sessionFile!);
        successorFile = manager.createBranchedSession(manager.getLeafId()!);
        successor = manager.getSessionId();
        await updateSessionStoreAtomic(storePath, (sessions) => {
          sessions[sessionKey] = mergeSessionEntryWithPolicy(
            sessions[sessionKey],
            { sessionId: successor!, sessionFile: successorFile },
            { identityTransition: "compaction" },
          );
        });
        return loadSessionStore(storePath, { skipCache: true })[sessionKey];
      });
    const transport = installTransportSpy();
    try {
      await agentCommand({
        message: "post-turn request",
        sessionKey,
        sessionId: "post-turn-predecessor",
        runId: "post-turn-run",
        deliver: false,
        json: true,
      });
      expect(compact).toHaveBeenCalledOnce();
      expect(terminalIds).toEqual([successor]);
      expect(loadSessionStore(storePath, { skipCache: true })[sessionKey]).toMatchObject({
        sessionId: successor,
        sessionFile: successorFile,
        status: "done",
      });
    } finally {
      transport.restore();
      compact.mockRestore();
      unsubscribe();
    }
  }, 90_000);

  it.each(["legacy", "authority"])(
    "cli agentCommand entry: real model call and durable completion in %s mode",
    async (mode) => {
      vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", mode);
      const root = tempRoots.at(-1)!;
      const workspaceDir = path.join(root, "workspace");
      fs.mkdirSync(workspaceDir, { recursive: true });
      const cfg = cliConfig(workspaceDir);
      const agentDir = resolveDefaultAgentDir(cfg as never);
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(
        path.join(agentDir, "models.json"),
        `${JSON.stringify(
          {
            providers: {
              openai: {
                baseUrl: "http://127.0.0.1:40123/v1",
                api: "openai-responses",
                apiKey: "fixture-key",
                models: [CLI_MODEL],
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      // agentCommand reads the runtime config from the config path.
      const configPath = path.join(root, "openclaw.json");
      fs.writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
      process.env.OPENCLAW_CONFIG_PATH = configPath;

      const spy = installTransportSpy();
      try {
        await agentCommand({
          message: "hello",
          sessionKey: "agent:main:rc02-cli",
          sessionId: "rc02-cli-session",
          runId: "rc02-cli-fixture-run",
          agentId: "main",
          provider: "openai",
          model: "gpt-rc02-cli",
          deliver: false,
          json: true,
        } as never);
      } finally {
        spy.restore();
      }
      const wire = expectDualReceiptsForSurface("cli-agent-command", spy.captured);
      expect(wire.map((row) => row.adapter_id)).toEqual(wire.map(() => "openai-responses"));
      if (mode === "authority") {
        const actual = loadSessionStore(resolveStorePath(undefined, { agentId: "main" }), {
          skipCache: true,
        })["agent:main:rc02-cli"];
        expect(
          actual,
          JSON.stringify({
            runId: actual.lifecycleRunId,
            status: actual.status,
            endedAt: actual.endedAt,
            output: actual.recoveryOutput,
          }),
        ).toMatchObject({
          lifecycleRunId: "rc02-cli-fixture-run",
          status: "done",
          abortedLastRun: false,
          recoveryOutput: {
            runId: "rc02-cli-fixture-run",
            effect: "unknown",
            visibleOutputObserved: true,
          },
        });
      }
    },
    90_000,
  );
});
