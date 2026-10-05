// RC-02R: the automated entry matrix must drive REAL production entries, not
// labels. An audit finding rejected the previous matrix because six of its eight
// rows called provider transport factories directly while claiming to be
// desktop chat / Cron / CLI / compact / context engine / payload hook. This
// file drives each surface through its real entry point, intercepts the actual
// bytes at the network boundary, and requires that every intercepted model
// request is bound to both shadow receipts (ShadowContextReceipt/v0 and
// ShadowWireReceipt/v0) whose wire digest equals the bytes that were really
// sent.
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
import { runEmbeddedAgent } from "./embedded-agent-runner/run.js";
import {
  createOpenClawTransportStreamFnForModel,
  listSourceRuntimeTransportApis,
} from "./provider-transport-stream.js";
import { attachModelProviderRequestTransport } from "./provider-request-config.js";
import { attachShadowReceiptOptions } from "./shadow-census.js";
import type { Model } from "../llm/types.js";

const tempRoots: string[] = [];
let stateDir = "";

const store = () => new ReceiptStore({ env: process.env });

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rc02-entry-matrix-"));
  tempRoots.push(root);
  stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, "home");
  process.env.OPENCLAW_STATE_DIR = stateDir;
  process.env.OPENCLAW_RC02_SHADOW_CENSUS = "1";
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
  delete process.env.OPENCLAW_CACHE_TRACE;
  delete process.env.OPENCLAW_CACHE_TRACE_FILE;
  for (const root of tempRoots.splice(0)) {
    closeTrackedSqliteHandlesUnder(root);
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch {
      // Windows can still hold a handle on the state sqlite when a dist-inlined
      // instance is loaded through the plugin SDK path. The directory is an OS
      // temp dir, so a failed cleanup must not turn a passing test red.
    }
  }
});

const tempRoot = () => tempRoots.at(-1)!;

type CapturedRequest = { url: string; body: string };

function openAiResponsesTextSse(text = "ok"): string {
  const item = {
    type: "message",
    id: "msg-rc02-matrix",
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
        id: "response-rc02-matrix",
        status: "completed",
        output: [item],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    },
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
}

/** Intercept every outbound model request and keep the exact serialized bytes. */
function installTransportSpy(resolveBody: (url: string) => string = defaultSseBody): {
  captured: CapturedRequest[];
  restore: () => void;
} {
  const captured: CapturedRequest[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    captured.push({ url: request.url, body: await request.clone().text() });
    return new Response(resolveBody(request.url), {
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

function defaultSseBody(url: string): string {
  if (url.includes("/chat/completions")) {
    return 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  }
  return openAiResponsesTextSse();
}

function bodyDigest(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

/**
 * The census contract for one surface: every intercepted model request has
 * exactly one wire receipt bound to the exact bytes that were sent, and that
 * receipt joins a context receipt of the same model call through one
 * correlation digest. Owner classification must be complete (a named adapter,
 * never unknown) and the row must be a source-runtime row.
 */
function expectDualReceiptsForSurface(
  surface: string,
  captured: CapturedRequest[],
  options: { kind?: "shadow" | "rc03" } = {},
): { wire: RuntimeReceiptRow[]; context: RuntimeReceiptRow[] } {
  const kind = options.kind ?? "shadow";
  const wireRows = store().list({ kind: kind === "rc03" ? "wire" : "shadow_wire" });
  const contextRows = store().list({ kind: kind === "rc03" ? "context" : "shadow_context" });
  expect(captured.length, `${surface}: no model request was intercepted`).toBeGreaterThan(0);
  expect(
    wireRows.length,
    `${surface}: ${captured.length} model request(s) but ${wireRows.length} wire receipt(s)`,
  ).toBe(captured.length);
  const wireByDigest = new Map(wireRows.map((row) => [row.wire_digest, row]));
  for (const request of captured) {
    const digest = bodyDigest(request.body);
    const wire = wireByDigest.get(digest);
    expect(
      wire,
      `${surface}: no wire receipt bound to the bytes sent to ${request.url} (${digest.slice(0, 12)})`,
    ).toBeDefined();
    expect(wire!.provider_id, `${surface}: wire receipt lost the provider identity`).toBeTruthy();
    expect(
      wire!.adapter_id,
      `${surface}: owner classification is unknown (no named adapter)`,
    ).toBeTruthy();
    expect(wire!.runtime_mode, `${surface}: source-runtime coverage expected`).toBe("source");
  }
  const contextByCorrelation = new Map(contextRows.map((row) => [row.correlation_digest, row]));
  for (const wire of wireRows) {
    const context = contextByCorrelation.get(wire.correlation_digest);
    expect(
      context,
      `${surface}: wire receipt ${wire.receipt_id} has no correlated context receipt`,
    ).toBeDefined();
    expect(context!.model_call_index, `${surface}: call index drifted across the pair`).toBe(
      wire.model_call_index,
    );
  }
  return { wire: wireRows, context: contextRows };
}

function makeModel(overrides: Record<string, unknown> = {}): Model {
  return attachModelProviderRequestTransport(
    {
      name: "RC-02 matrix fixture",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 4096,
      maxTokens: 128,
      provider: "openai",
      api: "openai-responses",
      id: "gpt-rc02-matrix",
      baseUrl: "http://127.0.0.1:40123/v1",
      ...overrides,
    } as never,
    { allowPrivateNetwork: true },
  ) as Model;
}

function embeddedRunConfig(workspaceDir: string, api = "openai-responses") {
  return {
    models: {
      mode: "replace",
      providers: {
        openai: {
          baseUrl: "http://127.0.0.1:40123/v1",
          apiKey: "fixture-key",
          api,
          models: [
            {
              id: "gpt-rc02-matrix",
              name: "RC-02 matrix fixture",
              api,
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
    agents: { defaults: { workspace: workspaceDir, model: { primary: "openai/gpt-rc02-matrix" } } },
  };
}

function embeddedRunParams(root: string, overrides: Record<string, unknown> = {}) {
  const workspaceDir = path.join(root, "workspace");
  const agentDir = path.join(root, "agent");
  const sessionFile = path.join(root, "session.jsonl");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(sessionFile, "");
  return {
    sessionId: "rc02-matrix-session",
    sessionKey: "agent:main:rc02-matrix",
    sessionFile,
    workspaceDir,
    agentDir,
    config: embeddedRunConfig(workspaceDir),
    prompt: "hello",
    provider: "openai",
    model: "gpt-rc02-matrix",
    timeoutMs: 20_000,
    runId: "rc02-matrix-run",
    disableTools: true,
    disableMessageTool: true,
    modelRun: true,
    promptMode: "none",
    cleanupBundleMcpOnRunEnd: true,
    ...overrides,
  } as never;
}

// Entry x provider rows: the provider list comes from the production registry,
// restricted to the APIs the embedded runner can be driven with in-process.
// Anything excluded here must be covered by the registry denominator test in
// rc02-shadow-census.acceptance.test.ts and named as a gap in the RC-02
// evidence, never silently relabelled as a real entry.
const DRIVABLE_ENTRY_APIS = listSourceRuntimeTransportApis().filter((api) =>
  ["openai-responses", "openai-completions", "openai-chatgpt-responses"].includes(api),
);

describe("RC-02R real-entry matrix (registry-driven providers x real entries)", () => {
  it("embedded attempt: runEmbeddedAgent yields a dual receipt per real model call", async () => {
    const spy = installTransportSpy();
    try {
      const result = await runEmbeddedAgent(embeddedRunParams(tempRoot()));
      expect(result.meta?.error).toBeUndefined();
    } finally {
      spy.restore();
    }
    expectDualReceiptsForSurface("embedded-attempt", spy.captured);
  }, 60_000);

  it("provider payload hook: the production cache-trace hook installs onPayload and receipts still bind the final bytes", async () => {
    const root = tempRoot();
    const traceFile = path.join(root, "cache-trace.jsonl");
    process.env.OPENCLAW_CACHE_TRACE = "1";
    process.env.OPENCLAW_CACHE_TRACE_FILE = traceFile;
    const spy = installTransportSpy();
    try {
      const result = await runEmbeddedAgent(embeddedRunParams(root));
      expect(result.meta?.error).toBeUndefined();
    } finally {
      spy.restore();
    }
    // The hook must really have run: the production cache-trace writer records
    // the provider payload shape it observed through onPayload.
    expect(fs.existsSync(traceFile), "cache-trace hook did not run").toBe(true);
    expect(fs.readFileSync(traceFile, "utf8")).toContain("provider:payload");
    expectDualReceiptsForSurface("provider-payload-hook", spy.captured);
  }, 60_000);

  // The provider axis is the production registry, not a hand-written list: a
  // new source API grows this matrix automatically. The entry axis is the real
  // embedded runner, so these rows prove entry x provider rather than a
  // transport factory called in a loop.
  for (const api of DRIVABLE_ENTRY_APIS) {
    it(`embedded attempt x registry api ${api}: a dual receipt per real model call`, async () => {
      const root = tempRoot();
      const spy = installTransportSpy();
      try {
        const result = await runEmbeddedAgent(
          embeddedRunParams(root, {
            config: embeddedRunConfig(path.join(root, "workspace"), api),
            sessionId: `rc02-matrix-${api}`,
            runId: `rc02-matrix-${api}`,
          }),
        );
        expect(
          result.meta?.error,
          `${api}: embedded run reported ${JSON.stringify(result.meta?.error)}`,
        ).toBeUndefined();
      } finally {
        spy.restore();
      }
      const { wire } = expectDualReceiptsForSurface(`embedded-attempt:${api}`, spy.captured);
      expect(
        wire.map((row) => row.adapter_id),
        `${api}: the registry api must be the named adapter owner`,
      ).toEqual(wire.map(() => api));
    }, 60_000);
  }

  it("context engine: the sealed context bundle and the guarded wire body join through one correlation digest", async () => {
    const { runRc03SealHook, getRc03SealPlan } =
      await import("../context-engine/rc03-seal-hook.js");
    const { buildGuardedModelFetch } = await import("./provider-transport-fetch.js");
    const { resolveEmbeddedAgentStreamFn } =
      await import("./embedded-agent-runner/stream-resolution.js");
    const { getShadowReceiptOptions } = await import("./shadow-census.js");

    const projection = {
      lineage: [
        {
          sourceId: "dcs-knowledge",
          channel: "knowledge",
          target: "message",
          candidateId: "cand-rc02-matrix",
          charsRequested: 10,
          charsApplied: 8,
        },
      ],
      systemPromptAddition: undefined,
    } as never;
    const seal = runRc03SealHook(projection, [{ role: "user", content: "hi" }], {
      enabled: true,
      runId: "run-context-engine",
      sessionKey: "sess-context-engine",
      providerId: "anthropic",
      database: { env: process.env },
    });
    expect(seal.engaged).toBe(true);
    expect(getRc03SealPlan("run-context-engine")).toBeDefined();

    const model = makeModel({
      provider: "anthropic",
      api: "anthropic-messages",
      id: "claude-rc02-matrix",
    });
    let capturedOptions: unknown;
    const wrapped = resolveEmbeddedAgentStreamFn({
      currentStreamFn: ((_m: never, _c: never, o?: never) => {
        capturedOptions = o;
        return {};
      }) as never,
      sessionId: "sess-context-engine",
      runId: "run-context-engine",
      attemptIndex: 0,
      model: model as never,
    });
    await wrapped(
      model as never,
      { systemPrompt: "", messages: [{ role: "user", content: "hi" }] } as never,
      attachShadowReceiptOptions(
        { apiKey: "fixture-key" },
        {
          enabled: true,
          sourceRuntime: true,
          database: { env: process.env },
          runId: "run-context-engine",
          sessionKey: "sess-context-engine",
          providerId: "anthropic",
          adapterId: "anthropic-messages",
          attemptIndex: 0,
          modelCallIndex: 0,
        },
      ) as never,
    );
    const shadow = getShadowReceiptOptions(capturedOptions);
    expect(shadow?.rc03Plan, "context engine did not attach the sealed plan").toBeDefined();

    const spy = installTransportSpy();
    try {
      const fetch = buildGuardedModelFetch(model, 5000, undefined, shadow as never);
      const response = await fetch("http://127.0.0.1:40123/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-rc02-matrix",
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      expect(response.status).toBe(200);
    } finally {
      spy.restore();
    }
    expectDualReceiptsForSurface("context-engine", spy.captured, { kind: "rc03" });
  }, 60_000);
});

type ParityDriveOptions = {
  shadowEnabled: boolean;
  wireAttemptIndex?: number;
  modelCallIndex?: number;
};

/** Drive one production transport and return the exact serialized request bodies. */
async function driveTransport(
  api: string,
  context: Record<string, unknown>,
  options: ParityDriveOptions,
): Promise<CapturedRequest[]> {
  const model = makeModel({ api, id: `${api}-parity`, provider: "openai" });
  const streamFn = createOpenClawTransportStreamFnForModel(model);
  expect(streamFn, `no production transport for ${api}`).toBeTypeOf("function");
  const spy = installTransportSpy();
  try {
    const stream = await streamFn!(
      model,
      context as never,
      attachShadowReceiptOptions(
        { apiKey: "fixture-key", sessionId: "sess-parity", runId: "run-parity" },
        {
          enabled: options.shadowEnabled,
          sourceRuntime: true,
          database: { env: process.env },
          attemptIndex: 0,
          modelCallIndex: options.modelCallIndex ?? 0,
          wireAttemptIndex: options.wireAttemptIndex ?? 0,
        },
      ) as never,
    );
    for await (const _event of stream) {
      // Consume the real production transport to its terminal result.
    }
    await stream.result();
  } finally {
    spy.restore();
  }
  return spy.captured;
}

function toolNamesIn(body: string): string[] {
  const payload = JSON.parse(body) as {
    tools?: Array<{ name?: string; function?: { name?: string } }>;
  };
  return (payload.tools ?? []).map((tool) => tool.name ?? tool.function?.name ?? "");
}

describe("RC-02R parity: observation changes no bytes, order, or identity", () => {
  const parityContext = {
    messages: [
      { role: "user" as const, content: "hello", timestamp: 1 },
      { role: "assistant" as const, content: "hi", timestamp: 2 },
      { role: "user" as const, content: "again", timestamp: 3 },
    ],
    tools: [
      {
        name: "read",
        description: "read a file",
        input_schema: { type: "object", properties: {} },
      },
      {
        name: "write",
        description: "write a file",
        input_schema: { type: "object", properties: {} },
      },
      {
        name: "exec",
        description: "run a command",
        input_schema: { type: "object", properties: {} },
      },
    ],
  };

  it("observer off/on parity: identical serialized bytes and tool order per registry api", async () => {
    for (const api of DRIVABLE_ENTRY_APIS) {
      const off = await driveTransport(api, parityContext, { shadowEnabled: false });
      const on = await driveTransport(api, parityContext, { shadowEnabled: true });
      expect(off.length, `${api}: fixture produced no model request`).toBeGreaterThan(0);
      expect(
        on.map((request) => request.body),
        `${api}: installing the observer changed the sent bytes`,
      ).toEqual(off.map((request) => request.body));
      // Tool order is part of the prompt-cache contract: the transport
      // canonicalizes it deterministically and observation must not change it.
      expect(toolNamesIn(on[0].body), `${api}: tool order changed`).toEqual(
        toolNamesIn(off[0].body),
      );
      expect(toolNamesIn(on[0].body), `${api}: tools were dropped from the payload`).toEqual([
        "exec",
        "read",
        "write",
      ]);
    }
  }, 120_000);

  it("retry identity: a repeated wire attempt keeps the bytes and gets its own receipt", async () => {
    for (const api of DRIVABLE_ENTRY_APIS) {
      const first = await driveTransport(api, parityContext, {
        shadowEnabled: true,
        wireAttemptIndex: 0,
      });
      const retry = await driveTransport(api, parityContext, {
        shadowEnabled: true,
        wireAttemptIndex: 1,
      });
      expect(
        retry.map((request) => request.body),
        `${api}: retry changed the bytes`,
      ).toEqual(first.map((request) => request.body));
      const wire = store()
        .list({ kind: "shadow_wire" })
        .filter((row) => row.adapter_id === api);
      expect(
        wire.map((row) => Number(row.wire_attempt_index)).toSorted((left, right) => left - right),
        `${api}: each wire attempt needs its own identity`,
      ).toEqual([0, 1]);
    }
  }, 120_000);

  it("no approval or delivery traffic is added by observation", async () => {
    const off = await driveTransport("openai-responses", parityContext, { shadowEnabled: false });
    const on = await driveTransport("openai-responses", parityContext, { shadowEnabled: true });
    for (const request of [...off, ...on]) {
      expect(request.url, `unexpected side-effect traffic: ${request.url}`).toContain(
        "127.0.0.1:40123",
      );
    }
    expect(on.map((request) => request.url)).toEqual(off.map((request) => request.url));
  }, 60_000);
});
