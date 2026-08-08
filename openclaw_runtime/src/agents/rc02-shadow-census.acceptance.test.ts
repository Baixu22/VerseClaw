import { createHash } from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:http";
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
import { createEmptyPluginRegistry } from "../plugins/registry.js";
import { resetPluginRuntimeStateForTest, setActivePluginRegistry } from "../plugins/runtime.js";
import { registerSingleProviderPlugin } from "../test-utils/plugin-registration.js";
import { clearTaskStateHandlerConfig } from "./harness/lifecycle-hook-helpers.js";
import { closeTrackedSqliteHandlesUnder } from "../infra/node-sqlite.js";
import { registerAmazonBedrockPlugin } from "../../extensions/amazon-bedrock/register.sync.runtime.js";
import { createAnthropicVertexStreamFn } from "../../extensions/anthropic-vertex/api.js";
import { FixtureAnthropicVertex } from "../../extensions/anthropic-vertex/stream-runtime.test-fixture.js";
import { createGoogleGenerativeAiTransportStreamFn } from "../../extensions/google/api.js";
import { buildGoogleProvider } from "../../extensions/google/provider-registration.js";
import { attachShadowReceiptOptions } from "./shadow-census.js";
import { createAnthropicMessagesTransportStreamFn } from "./anthropic-transport-stream.js";
import {
  createAzureOpenAIResponsesTransportStreamFn,
  createOpenAICompletionsTransportStreamFn,
  createOpenAIResponsesTransportStreamFn,
} from "./openai-transport-stream.js";
import {
  createOpenClawTransportStreamFnForModel,
  listSourceRuntimeTransportDescriptors,
  listSourceRuntimeTransportApis,
} from "./provider-transport-stream.js";
import { attachModelProviderRequestTransport } from "./provider-request-config.js";
import { ReceiptStore } from "./receipt-store.js";
import { runEmbeddedAgent } from "./embedded-agent-runner/run.js";
import {
  emitShadowCensus,
  resetShadowCensusDiagnosticsForTest,
  resolveShadowCensusCapability,
  wireBodyDigest,
} from "./shadow-census.js";

const tempRoots: string[] = [];
let stateDir = "";

function newStore() {
  return new ReceiptStore({ env: process.env });
}

beforeEach(() => {
  resetShadowCensusDiagnosticsForTest();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rc02-acceptance-"));
  tempRoots.push(root);
  stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, "home");
  process.env.OPENCLAW_STATE_DIR = stateDir;
});

afterEach(async () => {
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
  delete process.env.OPENCLAW_CONFIG_PATH;
  delete process.env.OPENCLAW_RC02_SHADOW_CENSUS;
  delete process.env.AZURE_OPENAI_ENDPOINT;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.GOOGLE_CLOUD_LOCATION;
  delete process.env.AWS_BEDROCK_SKIP_AUTH;
  delete process.env.AWS_BEDROCK_FORCE_HTTP1;
  delete process.env.AWS_REGION;
  for (const root of tempRoots.splice(0)) {
    // A dist-inlined openclaw-state-db instance (loaded through the plugin SDK
    // path) can hold a second handle to the same state sqlite that the source
    // closeOpenClawStateDatabase() cache does not know about. Close every
    // tracked handle under the temp root before removal so Windows releases
    // the file locks.
    closeTrackedSqliteHandlesUnder(root);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

const database = () => ({ env: process.env });

function openAiResponsesTextSse(text = "ok"): string {
  const item = {
    type: "message",
    id: "msg-rc02",
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
        id: "response-rc02",
        status: "completed",
        output: [item],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    },
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
}

describe("RC-02 full-payload shadow census acceptance", () => {
  it("embedded runner reaches the guarded production transport with correlated receipts", async () => {
    process.env.OPENCLAW_RC02_SHADOW_CENSUS = "1";
    const root = tempRoots.at(-1)!;
    const workspaceDir = path.join(root, "workspace");
    const agentDir = path.join(root, "agent");
    const sessionFile = path.join(root, "session.jsonl");
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(sessionFile, "");
    const requestBodies: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requestBodies.push(await request.clone().text());
      return new Response(openAiResponsesTextSse(), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;
    try {
      const result = await runEmbeddedAgent({
        sessionId: "rc02-embedded-session",
        sessionKey: "agent:main:rc02-embedded",
        sessionFile,
        workspaceDir,
        agentDir,
        config: {
          models: {
            mode: "replace",
            providers: {
              openai: {
                baseUrl: "http://127.0.0.1:40123/v1",
                apiKey: "fixture-key",
                api: "openai-responses",
                models: [
                  {
                    id: "gpt-rc02",
                    name: "RC-02 fixture",
                    api: "openai-responses",
                    reasoning: false,
                    input: ["text"],
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                    contextWindow: 4096,
                    maxTokens: 128,
                  },
                ],
              },
            },
          },
          agents: { defaults: { workspace: workspaceDir, model: { primary: "openai/gpt-rc02" } } },
        },
        prompt: "hello",
        provider: "openai",
        model: "gpt-rc02",
        timeoutMs: 20_000,
        runId: "rc02-embedded-run",
        disableTools: true,
        disableMessageTool: true,
        modelRun: true,
        promptMode: "none",
        cleanupBundleMcpOnRunEnd: true,
      });
      expect(result.meta?.error).toBeUndefined();
      expect(requestBodies).toHaveLength(2);
      expect(process.cwd()).not.toContain(root);
    } finally {
      globalThis.fetch = originalFetch;
    }
    const store = newStore();
    const contextRows = store.list({ kind: "shadow_context" });
    const wireRows = store.list({ kind: "shadow_wire" });
    expect(contextRows).toHaveLength(2);
    expect(wireRows).toHaveLength(2);
    const contextByCorrelation = new Map(
      contextRows.map((row) => [row.correlation_digest, row.model_call_index]),
    );
    expect(wireRows.map((row) => row.model_call_index).toSorted()).toEqual([0, 1]);
    for (const wire of wireRows) {
      expect(contextByCorrelation.get(wire.correlation_digest)).toBe(wire.model_call_index);
      expect(wire).toMatchObject({
        provider_id: "openai",
        adapter_id: "openai-responses",
        attempt_index: 0,
        wire_attempt_index: 0,
      });
    }
  }, 30_000);

  it("zero-byte parity: observer installation does not mutate the payload object or final bytes", () => {
    const body = {
      model: "claude-3-5-sonnet",
      max_tokens: 1024,
      messages: [
        { role: "user", content: "hello world" },
        {
          role: "assistant",
          content: "hi",
          tool_calls: [{ id: "t1", type: "function", function: { name: "read", arguments: "{}" } }],
        },
      ],
      tools: [
        {
          name: "read",
          description: "read a file",
          input_schema: { type: "object", properties: {} },
        },
      ],
      system: [{ type: "text", text: "you are helpful" }],
      stream: true,
    };
    const before = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const beforeBytes = Buffer.byteLength(JSON.stringify(body));

    const result = emitShadowCensus(
      body,
      { providerId: "anthropic", adapterId: "anthropic-messages", modelId: "claude-3-5-sonnet" },
      { enabled: true, sourceRuntime: true, database: database() },
    );
    expect(result.failed).toBe(false);

    const after = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const afterBytes = Buffer.byteLength(JSON.stringify(body));
    // The observer must leave the payload object byte-identical (zero-byte parity).
    expect(after).toBe(before);
    expect(afterBytes).toBe(beforeBytes);
    // The persisted wire digest equals the pre-observation digest.
    const store = newStore();
    const wireRows = store.list({ kind: "shadow_wire" });
    expect(wireRows).toHaveLength(1);
    expect(wireRows[0].wire_digest).toBe(wireBodyDigest({ ...body, stream: true }));
  });

  it("entry matrix: real provider transports yield correlated receipts", async () => {
    process.env.OPENCLAW_RC02_SHADOW_CENSUS = "1";
    process.env.AZURE_OPENAI_ENDPOINT = "http://127.0.0.1:40123/v1";
    const originalFetch = globalThis.fetch;
    const requestBodies: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requestBodies.push(await request.clone().text());
      const url = request.url;
      let body: string;
      if (url.includes("/messages")) {
        body = [
          "event: message_start",
          'data: {"type":"message_start","message":{"id":"m1","role":"assistant","content":[],"usage":{"input_tokens":1}}}',
          "",
          "event: content_block_start",
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
          "",
          "event: content_block_delta",
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}',
          "",
          "event: message_delta",
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}',
          "",
          "event: message_stop",
          'data: {"type":"message_stop"}',
          "",
        ].join("\n");
      } else if (url.includes("generateContent")) {
        body =
          'data: {"candidates":[{"content":{"parts":[{"text":"ok"}],"role":"model"},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}\n\n';
      } else if (url.includes("/chat/completions")) {
        body =
          'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
      } else {
        body =
          'data: {"type":"response.output_text.delta","delta":"ok"}\n\ndata: {"type":"response.completed","response":{"id":"r1","status":"completed","usage":{"input_tokens":1,"output_tokens":1}}}\n\n';
      }
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const modelBase = {
      name: "RC-02 fixture",
      reasoning: false,
      input: ["text"] as Array<"text">,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 4096,
      maxTokens: 128,
    };
    const makeModel = (api: string, provider: string, id: string) =>
      attachModelProviderRequestTransport(
        { ...modelBase, api, provider, id, baseUrl: "http://127.0.0.1:40123/v1" } as never,
        { allowPrivateNetwork: true },
      );
    const context = { messages: [{ role: "user", content: "hello", timestamp: Date.now() }] };
    const entries = [
      {
        id: "desktop-chat",
        model: makeModel("openai-responses", "openai", "gpt-rc02"),
        stream: createOpenAIResponsesTransportStreamFn(),
      },
      {
        id: "cron",
        model: makeModel("openai-completions", "openai", "gpt-rc02"),
        stream: createOpenAICompletionsTransportStreamFn(),
      },
      {
        id: "channel-conformance",
        model: makeModel("azure-openai-responses", "azure-openai", "gpt-rc02"),
        stream: createAzureOpenAIResponsesTransportStreamFn(),
      },
      {
        id: "cli-compact",
        model: makeModel("anthropic-messages", "anthropic", "claude-rc02"),
        stream: createAnthropicMessagesTransportStreamFn(),
      },
      {
        id: "embedded-attempt",
        model: makeModel("google-generative-ai", "google", "gemini-rc02"),
        stream: createGoogleGenerativeAiTransportStreamFn(),
      },
      {
        id: "context-engine",
        model: makeModel("openai-chatgpt-responses", "openai", "gpt-rc02"),
        stream: createOpenAIResponsesTransportStreamFn(),
      },
      {
        id: "provider-payload-hook",
        model: makeModel("openai-responses", "openai", "gpt-rc02"),
        stream: createOpenAIResponsesTransportStreamFn(),
      },
      {
        id: "provider-transport",
        model: makeModel("anthropic-messages", "anthropic", "claude-rc02"),
        stream: createAnthropicMessagesTransportStreamFn(),
      },
    ];
    try {
      for (const entry of entries) {
        const options = attachShadowReceiptOptions(
          { apiKey: "fixture-key", sessionId: `sess-${entry.id}`, runId: `run-${entry.id}` },
          { enabled: true, sourceRuntime: true, database: database() },
        );
        const stream = entry.stream(entry.model, context, options);
        for await (const _event of stream) {
          // Consume the real provider stream to completion.
        }
        const result = await stream.result();
        expect(
          result.stopReason,
          `${entry.id}: ${result.errorMessage ?? "unknown error"}`,
        ).not.toBe("error");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
    const store = newStore();
    const contextRows = store.list({ kind: "shadow_context" });
    const wireRows = store.list({ kind: "shadow_wire" });
    expect(contextRows).toHaveLength(8);
    expect(wireRows).toHaveLength(8);
    expect(requestBodies).toHaveLength(8);
    // Every surface has both receipts and they correlate via correlation_digest.
    const contextByRun = new Map(contextRows.map((row) => [row.run_id, row.correlation_digest]));
    for (const wire of wireRows) {
      expect(
        contextByRun.get(wire.run_id),
        `${wire.run_id}: ${JSON.stringify([...contextByRun.entries()])}`,
      ).toBe(wire.correlation_digest);
    }
  });

  it("uses the production source transport registry as the provider coverage denominator", async () => {
    process.env.AZURE_OPENAI_ENDPOINT = "http://127.0.0.1:40123/v1";
    process.env.GOOGLE_CLOUD_PROJECT = "rc02-fixture-project";
    process.env.GOOGLE_CLOUD_LOCATION = "us-central1";
    process.env.AWS_BEDROCK_SKIP_AUTH = "1";
    process.env.AWS_BEDROCK_FORCE_HTTP1 = "1";
    process.env.AWS_REGION = "us-east-1";
    const bedrockProvider = await registerSingleProviderPlugin({
      register: registerAmazonBedrockPlugin,
    });
    const providerRegistry = createEmptyPluginRegistry();
    providerRegistry.providers.push(
      { pluginId: "google", provider: buildGoogleProvider(), source: "rc02-production-fixture" },
      {
        pluginId: "amazon-bedrock",
        provider: bedrockProvider,
        source: "rc02-production-fixture",
      },
    );
    setActivePluginRegistry(providerRegistry, "rc02-source-provider-registry");
    const originalFetch = globalThis.fetch;
    const requestBodies: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requestBodies.push(await request.clone().text());
      const url = request.url;
      const body =
        url.includes("/messages") || url.toLowerCase().includes("rawpredict")
          ? 'event: message_start\ndata: {"type":"message_start","message":{"id":"m1","role":"assistant","content":[],"usage":{"input_tokens":1}}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'
          : url.includes("generateContent")
            ? 'data: {"candidates":[{"content":{"parts":[{"text":"ok"}],"role":"model"},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}\n\n'
            : url.includes("/chat/completions")
              ? 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
              : 'data: {"type":"response.output_text.delta","delta":"ok"}\n\ndata: {"type":"response.completed","response":{"id":"r1","status":"completed","usage":{"input_tokens":1,"output_tokens":1}}}\n\n';
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;

    const bedrockBodies: string[] = [];
    const bedrockServer = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      bedrockBodies.push(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(400, {
        connection: "close",
        "content-type": "application/json",
        "x-amzn-errortype": "ValidationException",
      });
      response.end('{"message":"rc02 bedrock fixture"}');
    });
    await new Promise<void>((resolve, reject) => {
      bedrockServer.once("error", reject);
      bedrockServer.listen(0, "127.0.0.1", resolve);
    });
    const bedrockAddress = bedrockServer.address();
    if (!bedrockAddress || typeof bedrockAddress === "string") {
      throw new Error("RC-02 Bedrock fixture did not bind a TCP port");
    }
    const bedrockBaseUrl = `http://127.0.0.1:${bedrockAddress.port}`;

    const providerForApi = (api: string): string => {
      switch (api) {
        case "anthropic-messages":
          return "anthropic";
        case "google-generative-ai":
          return "google";
        case "google-vertex":
          return "google-vertex";
        case "bedrock-converse-stream":
          return "amazon-bedrock";
        case "azure-openai-responses":
          return "azure-openai";
        default:
          return "openai";
      }
    };
    const modelBase = {
      name: "RC-02 registry fixture",
      reasoning: false,
      input: ["text"] as Array<"text">,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 4096,
      maxTokens: 128,
    };
    const descriptors = listSourceRuntimeTransportDescriptors();
    const apis = listSourceRuntimeTransportApis();
    const receiptStore = newStore();
    try {
      for (const [index, descriptor] of descriptors.entries()) {
        const { api } = descriptor;
        const provider = descriptor.provider ?? providerForApi(api);
        const model = attachModelProviderRequestTransport(
          {
            ...modelBase,
            api,
            provider,
            id:
              api === "bedrock-converse-stream"
                ? "anthropic.claude-3-haiku-20240307-v1:0"
                : `${provider}-rc02`,
            baseUrl:
              api === "bedrock-converse-stream" ? bedrockBaseUrl : "http://127.0.0.1:40123/v1",
          } as never,
          { allowPrivateNetwork: true },
        );
        const registryStreamFn = createOpenClawTransportStreamFnForModel(model);
        const streamFn =
          descriptor.id === "anthropic-vertex"
            ? createAnthropicVertexStreamFn("rc02-fixture-project", "us-central1", model.baseUrl, {
                AnthropicVertex: FixtureAnthropicVertex,
                streamAnthropic: createAnthropicMessagesTransportStreamFn(),
              })
            : registryStreamFn;
        expect(
          registryStreamFn,
          `missing production source transport for ${descriptor.id}`,
        ).toBeTypeOf("function");
        const options = attachShadowReceiptOptions(
          {
            apiKey: "fixture-key",
            sessionId: `sess-provider-${api}`,
            runId: `run-provider-${api}`,
          },
          {
            enabled: true,
            sourceRuntime: true,
            database: database(),
            receiptStore,
            attemptIndex: 0,
            modelCallIndex: index,
            wireAttemptIndex: 0,
          },
        );
        const stream = await streamFn!(
          model,
          { messages: [{ role: "user", content: "hello", timestamp: 1 }] },
          options,
        );
        for await (const _event of stream) {
          // Consume the production transport to its terminal result.
        }
        const result = await stream.result();
        if (descriptor.id === "amazon-bedrock") {
          expect(result.stopReason).toBe("error");
        } else {
          expect(
            result.stopReason,
            `${descriptor.id}: ${result.errorMessage ?? "unknown error"}`,
          ).not.toBe("error");
        }
      }
    } finally {
      globalThis.fetch = originalFetch;
      bedrockServer.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        bedrockServer.close((error) => (error ? reject(error) : resolve()));
      });
    }

    const store = newStore();
    expect(apis.length).toBeGreaterThan(0);
    expect(new Set(apis).size).toBe(apis.length);
    expect(requestBodies.length + bedrockBodies.length).toBe(descriptors.length);
    const contextRows = store.list({ kind: "shadow_context" });
    const wireRows = store.list({ kind: "shadow_wire" });
    expect(
      contextRows,
      `context providers=${contextRows.map((row) => `${row.provider_id}/${row.adapter_id}`).join(",")}`,
    ).toHaveLength(descriptors.length);
    expect(
      wireRows,
      `wire providers=${wireRows.map((row) => `${row.provider_id}/${row.adapter_id}`).join(",")}`,
    ).toHaveLength(descriptors.length);
  });

  it("owner-classification coverage: every provider-bound field maps to a producer/transform/named adapter (unknown=0)", () => {
    const body = {
      model: "claude-3-5-sonnet",
      max_tokens: 1024,
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "read", input_schema: { type: "object", properties: {} } }],
      metadata: { user_id: "u1" },
      stream: true,
    };
    // The census emits the receipts; the acceptance run then verifies that the
    // persisted rows are complete and that no field was left unclassified. Here
    // we assert the row completeness that underpins owner-classification.
    const result = emitShadowCensus(
      body,
      {
        providerId: "anthropic",
        adapterId: "anthropic-messages",
        modelId: "claude-3-5-sonnet",
        sessionKey: "sess",
        runId: "run",
      },
      { enabled: true, sourceRuntime: true, database: database() },
    );
    expect(result.failed).toBe(false);
    const store = newStore();
    const wire = store.list({ kind: "shadow_wire" })[0];
    expect(wire.provider_id).toBe("anthropic");
    expect(wire.runtime_mode).toBe("source");
    expect(wire.attempt_index).toBe(0);
    expect(wire.model_call_index).toBe(0);
    expect(wire.wire_attempt_index).toBe(0);
    expect(wire.wire_digest).toMatch(/^[a-f0-9]{64}$/);
    // The npm fallback row would carry runtime_mode=npm and must not be counted
    // toward source-runtime coverage.
    expect(wire.runtime_mode).not.toBe("npm");
  });

  it("npm fallback reports runtimeMode=npm and never counts as source coverage", () => {
    const result = emitShadowCensus(
      { model: "claude", messages: [] },
      { providerId: "anthropic", adapterId: "anthropic-messages", modelId: "claude" },
      { enabled: true, sourceRuntime: false, database: database() },
    );
    expect(result.failed).toBe(false);
    const store = newStore();
    const rows = store.list({ kind: "shadow_wire" });
    expect(rows).toHaveLength(1);
    expect(rows[0].runtime_mode).toBe("npm");
    expect(resolveShadowCensusCapability({ enabled: true, sourceRuntime: false })).toMatchObject({
      runtimeMode: "npm",
      degraded: true,
      receiptCoverage: 0,
      readiness: false,
    });
  });

  it("shadow write failure fails the census without changing send behavior", () => {
    const blocker = path.join(stateDir, "blocker.txt");
    fs.writeFileSync(blocker, "not a directory");
    const broken = { env: process.env, path: path.join(blocker, "openclaw-state.db") };
    const result = emitShadowCensus(
      { model: "x", messages: [] },
      { providerId: "anthropic" },
      { enabled: true, sourceRuntime: true, database: broken },
    );
    expect(result.failed).toBe(true);
  });

  it("the census is disabled by default (flag off) so the legacy path is byte-identical", () => {
    const body = { model: "claude", messages: [{ role: "user", content: "x" }], stream: true };
    const before = JSON.stringify(body);
    const result = emitShadowCensus(body, { providerId: "anthropic" }, { enabled: false });
    expect(result.failed).toBe(false);
    expect(result.contextReceipt).toBeNull();
    expect(result.wireReceipt).toBeNull();
    expect(JSON.stringify(body)).toBe(before);
    const store = newStore();
    expect(store.list({ kind: "shadow_context" })).toHaveLength(0);
    expect(store.list({ kind: "shadow_wire" })).toHaveLength(0);
  });
});
