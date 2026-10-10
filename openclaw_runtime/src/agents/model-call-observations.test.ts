import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { attachShadowReceiptOptions } from "./shadow-census.js";
import {
  attachModelCallObservation,
  drainUnpersistedModelCalls,
  markModelCallPersisted,
  readModelCallObservation,
  recordModelCallStart,
  resetModelCallObservationsForTests,
  type ModelCallObservation,
} from "./model-call-observations.js";
import { resolveEmbeddedAgentStreamFn } from "./embedded-agent-runner/stream-resolution.js";
import { SessionManager } from "./sessions/session-manager.js";
import { runRc03SealHook } from "../context-engine/rc03-seal-hook.js";
import { ReceiptStore } from "./receipt-store.js";
import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";

const tempRoots: string[] = [];

function assistantMessage(text = "answer") {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "anthropic-messages" as const,
    provider: "anthropic" as const,
    model: "claude-observation-test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: 123,
  };
}

function observation(overrides: Partial<ModelCallObservation> = {}): ModelCallObservation {
  return {
    sessionKey: "agent:main:observations",
    runId: "run-observations",
    providerId: "anthropic",
    adapterId: "anthropic-messages",
    modelId: "claude-observation-test",
    attemptIndex: 2,
    modelCallIndex: 3,
    wireAttemptIndex: 0,
    correlationDigest: "a".repeat(64),
    ...overrides,
  };
}

beforeEach(() => {
  resetModelCallObservationsForTests();
});

afterEach(() => {
  closeOpenClawStateDatabase();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("model call observations", () => {
  it("persists the producing call on the transcript entry across reopen", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-call-observation-"));
    tempRoots.push(root);
    const manager = SessionManager.create(root, path.join(root, "sessions"));
    const message = assistantMessage();
    const expected = observation();
    attachModelCallObservation(message, expected);
    const entryId = manager.appendMessage(message as never);
    const toolResult = {
      role: "toolResult" as const,
      toolCallId: "tool-1",
      toolName: "read",
      content: [{ type: "text" as const, text: "result" }],
      isError: false,
      timestamp: 124,
    };
    const toolEntryId = manager.appendMessage(toolResult as never, expected);
    const sessionFile = manager.getSessionFile();
    expect(sessionFile).toBeDefined();
    expect(JSON.stringify(message)).not.toContain(expected.correlationDigest!);

    const reopened = SessionManager.open(sessionFile!);
    const entry = reopened.getEntry(entryId);
    const toolEntry = reopened.getEntry(toolEntryId);
    expect(entry?.type).toBe("message");
    expect(toolEntry?.type).toBe("message");
    if (entry?.type !== "message" || toolEntry?.type !== "message") return;
    expect(entry.modelCall).toEqual(expected);
    expect(toolEntry.modelCall).toEqual(expected);
    expect(entry.message).not.toHaveProperty("correlationDigest");
  });

  it("keeps parallel session registries isolated and leaves old transcripts readable", () => {
    const first = observation({ runId: "run-a", attemptIndex: 0, modelCallIndex: 0 });
    const second = observation({ runId: "run-b", attemptIndex: 0, modelCallIndex: 1 });
    recordModelCallStart("session-a", first);
    recordModelCallStart("session-b", second);
    markModelCallPersisted("session-a", first, "entry-a");

    expect(drainUnpersistedModelCalls("session-a")).toEqual([]);
    expect(drainUnpersistedModelCalls("session-b")).toEqual([second]);

    const manager = SessionManager.inMemory();
    const oldMessage = assistantMessage("old");
    manager.appendMessage(oldMessage as never);
    const [entry] = manager.getEntries();
    expect(entry?.type).toBe("message");
    if (entry?.type !== "message") return;
    expect(entry.modelCall).toBeUndefined();
    expect(readModelCallObservation(oldMessage)).toBeUndefined();
  });

  it("attaches the sealed correlation to the final assistant message in the stream wrapper", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-call-stream-"));
    tempRoots.push(root);
    const database = { env: process.env, path: path.join(root, "state", "openclaw-state.db") };
    const runId = "run-stream-observation";
    const seal = runRc03SealHook(
      { lineage: [], systemPromptAddition: undefined } as never,
      [{ role: "user", content: "hi" }],
      { enabled: true, runId, sessionKey: "sess-stream-observation", providerId: "anthropic", database },
    );
    expect(seal.contextReceiptPersisted).toBe(true);
    const receipt = new ReceiptStore(database).list({ kind: "context", runId })[0]!;

    const finalMessage = assistantMessage();
    const fakeStream = {
      async *[Symbol.asyncIterator]() {
        // No provider events are needed for this correlation-only test.
      },
      async result() {
        return finalMessage;
      },
    };
    const wrapped = resolveEmbeddedAgentStreamFn({
      currentStreamFn: (() => fakeStream) as never,
      sessionId: "sess-stream-observation",
      runId,
      attemptIndex: 0,
      model: {
        provider: "anthropic",
        api: "test-api",
        id: "claude-observation-test",
        name: "claude-observation-test",
        baseUrl: "http://127.0.0.1:1",
        reasoning: false,
        input: ["text"],
        maxTokens: 1024,
        contextWindow: 200000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      } as never,
      resolvedApiKey: "fixture-key",
    });
    await wrapped(
      {
        provider: "anthropic",
        api: "test-api",
        id: "claude-observation-test",
      } as never,
      { systemPrompt: "", messages: [{ role: "user", content: "hi" }] } as never,
      attachShadowReceiptOptions(
        { apiKey: "fixture-key" },
        {
          enabled: true,
          sourceRuntime: true,
          database,
          runId,
          sessionKey: "sess-stream-observation",
          providerId: "anthropic",
          adapterId: "test-api",
          attemptIndex: 0,
          modelCallIndex: 0,
        },
      ) as never,
    );
    await Promise.resolve();

    expect(readModelCallObservation(finalMessage)).toMatchObject({
      runId,
      attemptIndex: 0,
      modelCallIndex: 0,
      correlationDigest: receipt.correlation_digest,
    });
  });
});