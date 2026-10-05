// RC-02R inbound entry matrix: the shared inbound dispatch entry that desktop
// chat and the channel surfaces both go through.
//
// Driving this entry in-process needs a bounded runtime bootstrap. The default
// bootstrap loads every bundled plugin and blocks the event loop for roughly
// 210s before the entry can run, so this suite disables bundled plugin discovery
// and seeds the agent's models.json plus the provider API key env instead. The
// entry, the reply path, the guarded transport boundary and the receipts are
// production code; bundled plugin discovery and the channel plugin layer are
// narrowed, and that caveat is recorded in the RC-02 census rather than hidden.
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
import { dispatchInboundMessageWithBufferedDispatcher } from "../auto-reply/dispatch.js";

const tempRoots: string[] = [];

const store = () => new ReceiptStore({ env: process.env });

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rc02-inbound-entry-"));
  tempRoots.push(root);
  const stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, "home");
  process.env.OPENCLAW_STATE_DIR = stateDir;
  process.env.OPENCLAW_RC02_SHADOW_CENSUS = "1";
  // Bounded bootstrap: see the file header. The provider credential comes from
  // the environment because the reply path reads auth from the agent store.
  process.env.OPENCLAW_DISABLE_BUNDLED_PLUGINS = "1";
  process.env.OPENAI_API_KEY = "fixture-key";
});

afterEach(() => {
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

const tempRoot = () => tempRoots.at(-1)!;

type CapturedRequest = { url: string; body: string };

function openAiResponsesTextSse(text = "ok"): string {
  const item = {
    type: "message",
    id: "msg-rc02-inbound",
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
        id: "response-rc02-inbound",
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

const INBOUND_MODEL = {
  id: "gpt-rc02-inbound",
  name: "RC-02 inbound fixture",
  api: "openai-responses",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 4096,
  maxTokens: 128,
};

function inboundConfig(workspaceDir: string) {
  return {
    models: {
      mode: "replace",
      providers: {
        openai: {
          baseUrl: "http://127.0.0.1:40123/v1",
          apiKey: "fixture-key",
          api: "openai-responses",
          models: [INBOUND_MODEL],
        },
      },
    },
    agents: {
      defaults: { workspace: workspaceDir, model: { primary: "openai/gpt-rc02-inbound" } },
    },
  };
}

/**
 * Seed the agent's models.json so the reply path's model catalog can resolve the
 * fixture model without provider discovery (which blocks the event loop).
 */
function seedAgentModelsJson(cfg: ReturnType<typeof inboundConfig>): string {
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
            models: [INBOUND_MODEL],
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return agentDir;
}

function inboundCtx(surface: string) {
  return {
    Body: "hello",
    BodyForAgent: "hello",
    BodyForCommands: "hello",
    From: "user-1",
    To: "agent-1",
    Surface: surface,
    Provider: surface,
    SenderId: "user-1",
    CommandAuthorized: true,
    ChatType: "private",
    SessionKey: `agent:main:rc02-${surface}`,
    MessageSid: "msg-1",
  } as never;
}

async function driveInbound(surface: string): Promise<CapturedRequest[]> {
  const root = tempRoot();
  const workspaceDir = path.join(root, "workspace");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const cfg = inboundConfig(workspaceDir);
  seedAgentModelsJson(cfg);
  const spy = installTransportSpy();
  try {
    const result = await dispatchInboundMessageWithBufferedDispatcher({
      ctx: inboundCtx(surface),
      cfg: cfg as never,
      dispatcherOptions: {
        deliver: async () => ({ ok: true }),
        onReplyStart: async () => {},
      } as never,
    });
    expect(result, `${surface}: dispatch produced no result`).toBeDefined();
  } finally {
    spy.restore();
  }
  return spy.captured;
}

describe("RC-02R inbound entry matrix (bounded bootstrap)", () => {
  it("desktop chat inbound: dispatchInboundMessage drives a real model call with dual receipts", async () => {
    const captured = await driveInbound("webchat");
    const wire = expectDualReceiptsForSurface("desktop-chat-inbound", captured);
    expect(wire.map((row) => row.adapter_id)).toEqual(wire.map(() => "openai-responses"));
  }, 60_000);

  it("channel conformance fixture inbound: the fixture surface reaches the same guarded boundary", async () => {
    const captured = await driveInbound("fixture");
    const wire = expectDualReceiptsForSurface("channel-fixture-inbound", captured);
    expect(wire.map((row) => row.adapter_id)).toEqual(wire.map(() => "openai-responses"));
  }, 60_000);
});
