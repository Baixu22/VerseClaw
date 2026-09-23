// RC-02R cron entry: the real cron isolated-agent entry.
//
// The turn's own status is deliberately NOT asserted here. This fixture has no
// delivery channel and the stub SSE yields no assistant text, so the turn ends
// with "Agent couldn't generate a response" — that is orthogonal to the receipt
// census, which is about the guarded boundary. What this row proves is that the
// real cron entry (runCronIsolatedAgentTurn -> runEmbeddedAgent -> guarded
// transport) drives real model calls and that every one of them lands both
// shadow receipts bound to the bytes actually sent.
//
// Bounded bootstrap, same recipe as the inbound row: bundled plugin discovery is
// disabled, the agent models.json is seeded, and the provider credential comes
// from OPENAI_API_KEY. That narrowing is recorded in the RC-02 census.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
import { runCronIsolatedAgentTurn } from "../cron/isolated-agent/run.js";

const tempRoots: string[] = [];

const store = () => new ReceiptStore({ env: process.env });

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rc02-cron-entry-"));
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
    id: "msg-rc02-cron",
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
        id: "response-rc02-cron",
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
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
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

const CRON_MODEL = {
  id: "gpt-rc02-cron",
  name: "RC-02 cron fixture",
  api: "openai-responses",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  // Large enough that the cron prompt does not trip the context-overflow gate.
  contextWindow: 200_000,
  maxTokens: 4096,
};

function cronConfig(workspaceDir: string) {
  return {
    models: {
      mode: "replace",
      providers: {
        openai: {
          baseUrl: "http://127.0.0.1:40123/v1",
          apiKey: "fixture-key",
          api: "openai-responses",
          models: [CRON_MODEL],
        },
      },
    },
    agents: {
      defaults: { workspace: workspaceDir, model: { primary: "openai/gpt-rc02-cron" } },
    },
  };
}

/** Seed models.json so the cron model catalog resolves without provider discovery. */
function seedAgentModelsJson(cfg: ReturnType<typeof cronConfig>): string {
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
            models: [CRON_MODEL],
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

describe("RC-02R cron entry (bounded bootstrap)", () => {
  it("cron isolated-agent entry: the real entry drives model calls through the guarded boundary with dual receipts", async () => {
    const root = tempRoots.at(-1)!;
    const workspaceDir = path.join(root, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    const cfg = cronConfig(workspaceDir);
    seedAgentModelsJson(cfg);
    const spy = installTransportSpy();
    try {
      const result = await runCronIsolatedAgentTurn({
        cfg: cfg as never,
        deps: {} as never,
        job: {
          id: "job-rc02",
          name: "RC-02 cron fixture",
          schedule: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
          sessionTarget: "isolated",
          payload: { kind: "agentTurn", message: "hello" },
        } as never,
        message: "hello",
        sessionKey: "cron:job-rc02",
      });
      expect(result, "cron entry produced no result").toBeDefined();
    } finally {
      spy.restore();
    }
    const wire = expectDualReceiptsForSurface("cron-isolated-agent", spy.captured);
    expect(wire.map((row) => row.adapter_id)).toEqual(wire.map(() => "openai-responses"));
  }, 90_000);
});
