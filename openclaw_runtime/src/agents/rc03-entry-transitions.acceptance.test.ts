// RC-03R: the seal and both v1 receipts must be produced by REAL entries, not by
// calling the seal hook by hand. Each identity transition named by the spec
// (tool loop, same-provider retry, provider fallback, compact, fork, handoff) is
// driven through a production entry, the exact bytes are intercepted at the
// network boundary, and every request must be bound to a WireReceipt/v1 that
// joins a ContextReceipt/v1 of the same model call.
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
import { runEmbeddedAgent } from "./embedded-agent-runner/run.js";
import { runWithModelFallback } from "./model-fallback.js";
import { forkSessionFromParent } from "../auto-reply/reply/session-fork.js";
import { buildChildCompletionFindings, readSubagentOutput } from "./subagent-announce-output.js";
import { getShadowCensusDiagnostics, resetShadowCensusDiagnosticsForTest } from "./shadow-census.js";
import { RC03_PRE_SEAL_PRODUCERS } from "../context-engine/rc03-producers.js";
import {
  recordRc03SystemPromptContribution,
  resetRc03SealPlansForTest,
} from "../context-engine/rc03-seal-hook.js";

const tempRoots: string[] = [];
const store = () => new ReceiptStore({ env: process.env });

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rc03-entry-"));
  tempRoots.push(root);
  const stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, "home");
  process.env.OPENCLAW_STATE_DIR = stateDir;
  process.env.OPENCLAW_RC02_SHADOW_CENSUS = "1";
  process.env.OPENCLAW_RC03_SEAL = "1";
});

afterEach(() => {
  resetRc03SealPlansForTest();
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
  delete process.env.OPENCLAW_RC03_SEAL;
  for (const root of tempRoots.splice(0)) {
    closeTrackedSqliteHandlesUnder(root);
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch {
      // Windows may still hold the state sqlite; the dir is an OS temp dir.
    }
  }
});

const tempRoot = () => tempRoots.at(-1)!;

type CapturedRequest = { url: string; body: string };

function responsesTextSse(text = "ok"): string {
  const item = {
    type: "message",
    id: "msg-rc03",
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
    { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: text },
    { type: "response.output_text.done", item_id: item.id, output_index: 0, content_index: 0, text },
    { type: "response.output_item.done", item },
    {
      type: "response.completed",
      response: {
        id: "resp-rc03",
        status: "completed",
        output: [item],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    },
  ]
    .map((event) => `data: ${JSON.stringify(event)}

`)
    .join("");
}

type Reply = { status?: number; body: string };

function installTransportSpy(replies: (index: number) => Reply): {
  captured: CapturedRequest[];
  restore: () => void;
} {
  const captured: CapturedRequest[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const index = captured.length;
    captured.push({ url: request.url, body: await request.clone().text() });
    const reply = replies(index);
    return new Response(reply.body, {
      status: reply.status ?? 200,
      headers: {
        "content-type": reply.status && reply.status >= 400 ? "application/json" : "text/event-stream",
      },
    });
  }) as typeof fetch;
  return { captured, restore: () => void (globalThis.fetch = original) };
}

const digest = (body: string) => createHash("sha256").update(body).digest("hex");

/** Every intercepted request has one WireReceipt/v1 bound to its exact bytes,
 * and each WireReceipt/v1 joins a ContextReceipt/v1 of the same model call. */
function expectV1Pairs(label: string, captured: CapturedRequest[]) {
  const wire = store().list({ kind: "wire" });
  const context = store().list({ kind: "context" });
  expect(captured.length, `${label}: no model request intercepted`).toBeGreaterThan(0);
  expect(wire.length, `${label}: ${captured.length} request(s) vs ${wire.length} WireReceipt/v1`).toBe(
    captured.length,
  );
  const wireByDigest = new Map(wire.map((row) => [row.wire_digest, row]));
  for (const request of captured) {
    expect(wireByDigest.get(digest(request.body)), `${label}: request bytes not bound`).toBeDefined();
  }
  const contextByCorrelation = new Map(context.map((row) => [row.correlation_digest, row]));
  for (const row of wire) {
    const pair = contextByCorrelation.get(row.correlation_digest);
    expect(pair, `${label}: WireReceipt ${row.receipt_id} has no ContextReceipt/v1`).toBeDefined();
    expect(pair!.model_call_index).toBe(row.model_call_index);
  }
  return { wire, context };
}

function runConfig(workspaceDir: string, contextWindow = 200_000, extra: Record<string, unknown> = {}) {
  return {
    models: {
      mode: "replace",
      providers: {
        openai: {
          baseUrl: "http://127.0.0.1:40123/v1",
          apiKey: "fixture-key",
          api: "openai-responses",
          models: [
            {
              id: "gpt-rc03",
              name: "RC-03 fixture",
              api: "openai-responses",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow,
              maxTokens: 128,
            },
            {
              id: "gpt-rc03-fallback",
              name: "RC-03 fallback fixture",
              api: "openai-responses",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow,
              maxTokens: 128,
            },
          ],
        },
      },
    },
    agents: { defaults: { workspace: workspaceDir, model: { primary: "openai/gpt-rc03" } } },
    ...extra,
  };
}

function runParams(root: string, overrides: Record<string, unknown> = {}) {
  const workspaceDir = path.join(root, "workspace");
  const agentDir = path.join(root, "agent");
  const sessionFile = path.join(root, "session.jsonl");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(sessionFile, "");
  return {
    sessionId: "rc03-session",
    sessionKey: "agent:main:rc03",
    sessionFile,
    workspaceDir,
    agentDir,
    config: runConfig(workspaceDir),
    prompt: "hello",
    provider: "openai",
    model: "gpt-rc03",
    timeoutMs: 20_000,
    runId: `rc03-run-${path.basename(root)}`,
    disableTools: true,
    disableMessageTool: true,
    modelRun: true,
    promptMode: "none",
    cleanupBundleMcpOnRunEnd: true,
    ...overrides,
  } as never;
}

const v1Identity = (rows: RuntimeReceiptRow[]) =>
  rows
    .map((row) => [row.attempt_index, row.model_call_index, row.wire_attempt_index])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);

function functionCallSse(name: string, args: Record<string, unknown>): string {
  const item = {
    type: "function_call",
    id: "fc_rc03",
    call_id: "call_rc03",
    name,
    arguments: JSON.stringify(args),
    status: "completed",
  };
  return [
    { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "", status: "in_progress" } },
    { type: "response.function_call_arguments.delta", item_id: item.id, output_index: 0, delta: item.arguments },
    { type: "response.function_call_arguments.done", item_id: item.id, output_index: 0, arguments: item.arguments },
    { type: "response.output_item.done", output_index: 0, item },
    {
      type: "response.completed",
      response: {
        id: "resp-rc03-fc",
        status: "completed",
        output: [item],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    },
  ]
    .map((event) => `data: ${JSON.stringify(event)}

`)
    .join("");
}

describe("RC-03R real-entry seal and dual v1 receipts", () => {
  it("plain turn: runEmbeddedAgent seals from real config and pairs v1 receipts", async () => {
    const spy = installTransportSpy(() => ({ body: responsesTextSse() }));
    try {
      const result = await runEmbeddedAgent(runParams(tempRoot()));
      expect(result.meta?.error).toBeUndefined();
    } finally {
      spy.restore();
    }
    expectV1Pairs("plain-turn", spy.captured);
  }, 60_000);

  it("tool loop: the follow-up model call after a tool result gets its own sealed bundle", async () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, "workspace"), { recursive: true });
    fs.writeFileSync(path.join(root, "workspace", "note.txt"), "rc03 note");
    const spy = installTransportSpy((index) => ({
      body: index === 0 ? functionCallSse("read", { path: "note.txt" }) : responsesTextSse("done"),
    }));
    try {
      const result = await runEmbeddedAgent(runParams(root, { disableTools: false }));
      expect(result.meta?.error).toBeUndefined();
    } finally {
      spy.restore();
    }
    // The fixture registers no workspace tools, so the runner answers the call
    // with a tool-not-found result; the loop (call -> result -> follow-up) is real.
    expect(spy.captured[1]?.body, "no tool result reached the follow-up call").toContain(
      '"type":"function_call_output","call_id":"call_rc03"',
    );
    const { context, wire } = expectV1Pairs("tool-loop", spy.captured);
    expect(v1Identity(context)).toEqual([[0, 0, 0], [0, 1, 0]]);
    expect(v1Identity(wire)).toEqual([[0, 0, 0], [0, 1, 0]]);
  }, 60_000);

  it("same-provider retry: a retried wire attempt is bound to its own WireReceipt/v1", async () => {
    const spy = installTransportSpy((index) =>
      index === 0
        ? { status: 500, body: JSON.stringify({ error: { message: "rc03 transient", type: "server_error" } }) }
        : { body: responsesTextSse() },
    );
    try {
      const result = await runEmbeddedAgent(runParams(tempRoot()));
      expect(result.meta?.error).toBeUndefined();
    } finally {
      spy.restore();
    }
    // A same-provider wire retry reuses the sealed bundle; only wireAttemptIndex moves.
    const { context, wire } = expectV1Pairs("retry", spy.captured);
    expect(v1Identity(context)).toEqual([[0, 0, 0]]);
    expect(v1Identity(wire)).toEqual([[0, 0, 0], [0, 0, 1]]);
  }, 60_000);

  it("provider fallback: the fallback model call starts a new attempt with its own seal", async () => {
    const root = tempRoot();
    const workspaceDir = path.join(root, "workspace");
    const config = runConfig(workspaceDir);
    (config.agents.defaults.model as Record<string, unknown>).fallbacks = ["openai/gpt-rc03-fallback"];
    const params = runParams(root, { config }) as unknown as Record<string, unknown>;
    const spy = installTransportSpy((index) =>
      index === 0
        ? { status: 429, body: JSON.stringify({ error: { message: "rc03 rate limited", type: "rate_limit_error" } }) }
        : { body: responsesTextSse() },
    );
    try {
      const outcome = await runWithModelFallback({
        cfg: config as never,
        provider: "openai",
        model: "gpt-rc03",
        runId: params.runId as string,
        sessionId: params.sessionId as string,
        sessionKey: params.sessionKey as string,
        agentDir: params.agentDir as string,
        run: (provider, model) => runEmbeddedAgent({ ...params, provider, model } as never),
      });
      expect(outcome.model).toBe("gpt-rc03-fallback");
    } finally {
      spy.restore();
    }
    const { context, wire } = expectV1Pairs("fallback", spy.captured);
    expect(v1Identity(context), "fallback must open a new attempt identity").toEqual([[0, 0, 0], [1, 0, 0]]);
    expect(v1Identity(wire)).toEqual([[0, 0, 0], [1, 0, 0]]);
  }, 60_000);

  it("seal plans are released at run end, so a reused runId cannot bind a stale plan", async () => {
    const { getRc03SealPlan } = await import("../context-engine/rc03-seal-hook.js");
    const root = tempRoot();
    const params = runParams(root) as unknown as Record<string, unknown>;
    const spy = installTransportSpy(() => ({ body: responsesTextSse() }));
    try {
      await runEmbeddedAgent(params as never);
    } finally {
      spy.restore();
    }
    expect(getRc03SealPlan(params.runId as string), "sealed plan outlived its run").toBeUndefined();
  }, 60_000);

  it("compact: the threshold compaction summarizer call is sealed and paired", async () => {
    const root = tempRoot();
    const spy = installTransportSpy(() => ({ body: responsesTextSse() }));
    try {
      const result = await runEmbeddedAgent(
        runParams(root, { config: runConfig(path.join(root, "workspace"), 4096) }),
      );
      expect(result.meta?.error).toBeUndefined();
    } finally {
      spy.restore();
    }
    expect(spy.captured[1]?.body).toContain("CONTEXT CHECKPOINT COMPRESSION");
    const { context } = expectV1Pairs("compact", spy.captured);
    expect(v1Identity(context)).toEqual([[0, 0, 0], [0, 1, 0]]);
  }, 60_000);

  it("seal off: identical request bytes and zero v1 receipts (legacy path parity)", async () => {
    const drive = async (sealOn: boolean) => {
      if (sealOn) process.env.OPENCLAW_RC03_SEAL = "1";
      else delete process.env.OPENCLAW_RC03_SEAL;
      const root = tempRoot();
      fs.mkdirSync(path.join(root, "workspace"), { recursive: true });
      fs.writeFileSync(path.join(root, "workspace", "note.txt"), "rc03 note");
      const spy = installTransportSpy((index) => ({
        body: index === 0 ? functionCallSse("read", { path: "note.txt" }) : responsesTextSse("done"),
      }));
      try {
        await runEmbeddedAgent(runParams(root, { disableTools: false, runId: "rc03-parity" }));
      } finally {
        spy.restore();
      }
      return spy.captured.map((request) => request.body);
    };
    const off = await drive(false);
    expect(store().list({ kind: "context" })).toHaveLength(0);
    expect(store().list({ kind: "wire" })).toHaveLength(0);
    const on = await drive(true);
    expect(on).toEqual(off);
  }, 120_000);

  it("system prompt: COMPASS output written outside the orchestrator is attributed and sealed unchanged", async () => {
    resetShadowCensusDiagnosticsForTest();
    const ssp = "[COMPASS SSP rc03] goal=ship the seal; decisions=2";
    const top5 = "[COMPASS top-5 rc03] 1. seal: bound by digest (conf: 0.9)";
    recordRc03SystemPromptContribution(RC03_PRE_SEAL_PRODUCERS.compassSsp, ssp);
    recordRc03SystemPromptContribution(RC03_PRE_SEAL_PRODUCERS.compassRetrieval, top5);
    const spy = installTransportSpy(() => ({ body: responsesTextSse() }));
    try {
      const result = await runEmbeddedAgent(
        runParams(tempRoot(), {
          modelRun: false,
          promptMode: "minimal",
          extraSystemPrompt: `${ssp}\n\n${top5}`,
        }),
      );
      expect(result.meta?.error).toBeUndefined();
    } finally {
      spy.restore();
    }
    expect(spy.captured[0]?.body).toContain("COMPASS SSP rc03");
    const { context } = expectV1Pairs("compass", spy.captured);
    const selected = JSON.parse(context[0]!.selected_json ?? "[]") as string[];
    expect(selected).toEqual(
      expect.arrayContaining([
        "ref:context:producer:compass-retrieval",
        "ref:context:producer:compass-ssp",
      ]),
    );
    expect(
      getShadowCensusDiagnostics().failures,
      "the provider-bound system prompt changed after the seal",
    ).toEqual([]);
  }, 60_000);

  it("fork: a child run on a transcript forked from the parent seals its own attempt identity", async () => {
    const root = tempRoot();
    const sessionsDir = path.join(root, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const parentFile = path.join(sessionsDir, "rc03-parent.jsonl");
    const parent = runParams(root, {
      sessionId: "rc03-parent",
      sessionFile: parentFile,
      runId: "rc03-parent-run",
      prompt: "parent question rc03",
      // A raw model run (modelRun or promptMode "none") does not replay history.
      modelRun: false,
      promptMode: "minimal",
    }) as unknown as Record<string, unknown>;
    fs.writeFileSync(parentFile, "");
    const spy = installTransportSpy((index) => ({
      body: responsesTextSse(index === 0 ? "parent answer" : "child answer"),
    }));
    try {
      await runEmbeddedAgent(parent as never);
      const forked = await forkSessionFromParent({
        parentEntry: { sessionId: "rc03-parent", sessionFile: parentFile, updatedAt: Date.now() } as never,
        agentId: "main",
        sessionsDir,
      });
      expect(forked, "the production fork did not produce a child transcript").not.toBeNull();
      await runEmbeddedAgent({
        ...parent,
        sessionId: forked!.sessionId,
        sessionFile: forked!.sessionFile,
        // A thread/session fork replays the forked history; a subagent key would
        // switch the child to task_state-only context.
        sessionKey: "agent:main:rc03:thread:fork",
        runId: "rc03-fork-run",
        prompt: "child task rc03",
      } as never);
    } finally {
      spy.restore();
    }
    expect(spy.captured[1]?.body, "the forked history did not reach the child call").toContain(
      "parent question rc03",
    );
    const { context, wire } = expectV1Pairs("fork", spy.captured);
    const byRun = (rows: RuntimeReceiptRow[], runId: string) =>
      v1Identity(rows.filter((row) => row.run_id === runId));
    expect(byRun(context, "rc03-parent-run")).toEqual([[0, 0, 0]]);
    expect(byRun(context, "rc03-fork-run")).toEqual([[0, 0, 0]]);
    expect(byRun(wire, "rc03-fork-run")).toEqual([[0, 0, 0]]);
    expect(new Set(context.map((row) => row.correlation_digest)).size).toBe(2);
  }, 90_000);

  it("handoff: the child's completion handed to the parent is a new sealed, paired parent call", async () => {
    const root = tempRoot();
    const sessionsDir = path.join(root, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const parentFile = path.join(sessionsDir, "rc03-parent.jsonl");
    const childFile = path.join(sessionsDir, "rc03-child.jsonl");
    fs.writeFileSync(parentFile, "");
    fs.writeFileSync(childFile, "");
    const base = runParams(root, { modelRun: false, promptMode: "minimal" }) as unknown as Record<
      string,
      unknown
    >;
    const replies = ["delegating", "child result rc03: 3 files", "parent wrap-up"];
    const spy = installTransportSpy((index) => ({ body: responsesTextSse(replies[index] ?? "ok") }));
    let handoff: string | undefined;
    try {
      await runEmbeddedAgent({
        ...base,
        sessionId: "rc03-parent",
        sessionFile: parentFile,
        runId: "rc03-parent-run",
        prompt: "delegate the count",
      } as never);
      await runEmbeddedAgent({
        ...base,
        sessionId: "rc03-child",
        sessionFile: childFile,
        sessionKey: "agent:main:subagent:rc03-child",
        runId: "rc03-child-run",
        prompt: "count the files",
      } as never);
      const childOutput = await readSubagentOutput("agent:main:subagent:rc03-child", undefined, {
        sessionFile: childFile,
      });
      expect(childOutput).toContain("child result rc03");
      handoff = buildChildCompletionFindings([
        {
          childSessionKey: "agent:main:subagent:rc03-child",
          task: "count the files",
          createdAt: 1,
          endedAt: 2,
          outcome: { status: "ok" },
          frozenResultText: childOutput,
        } as never,
      ]);
      expect(handoff).toBeDefined();
      await runEmbeddedAgent({
        ...base,
        sessionId: "rc03-parent",
        sessionFile: parentFile,
        runId: "rc03-handoff-run",
        prompt: handoff,
      } as never);
    } finally {
      spy.restore();
    }
    expect(spy.captured[2]?.body, "the handoff did not reach the parent call").toContain(
      "child result rc03",
    );
    expect(spy.captured[2]?.body, "the parent history was not continued").toContain(
      "delegate the count",
    );
    const { context, wire } = expectV1Pairs("handoff", spy.captured);
    const runs = ["rc03-parent-run", "rc03-child-run", "rc03-handoff-run"];
    for (const runId of runs) {
      expect(v1Identity(context.filter((row) => row.run_id === runId)), runId).toEqual([[0, 0, 0]]);
      expect(v1Identity(wire.filter((row) => row.run_id === runId)), runId).toEqual([[0, 0, 0]]);
    }
    const handoffWire = wire.find((row) => row.run_id === "rc03-handoff-run")!;
    const handoffContext = context.find((row) => row.run_id === "rc03-handoff-run")!;
    expect(handoffWire.correlation_digest).toBe(handoffContext.correlation_digest);
  }, 120_000);
});
