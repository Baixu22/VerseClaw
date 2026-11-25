import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadSessionStore,
  updateSessionStoreAtomic,
  mergeSessionEntryWithPolicy,
  type SessionEntry,
} from "../../config/sessions.js";
import { closeOpenClawAgentDatabasesForTest } from "../../state/openclaw-agent-db.js";
import { closeOpenClawStateDatabase } from "../../state/openclaw-state-db.js";
import { derivePersistedSessionLifecyclePatch } from "../../gateway/session-lifecycle-state.js";
import { handleMessageUpdate } from "../embedded-agent-subscribe.handlers.messages.js";
import type { EmbeddedAgentSubscribeContext } from "../embedded-agent-subscribe.handlers.types.js";
import { encodeAssistantTextSignature } from "../../shared/chat-message-content.js";
import { runAgentHarnessLifecycleAttempt } from "../harness/lifecycle.js";
import { setRuntimeConfigSnapshot, clearRuntimeConfigSnapshot } from "../../config/config.js";
import { persistGatewaySessionLifecycleEvent } from "../../gateway/session-lifecycle-state.js";
import { isNonProviderRuntimeCoordinationError } from "../failover-error.js";
import { persistSessionEntry } from "../command/attempt-execution.shared.js";
import { getRecoveryAdmissionIdentity } from "./owner-admission.js";
import { hasPersistedToolRecoveryAdmission } from "../execution-phase/recovery.js";
import { runWithModelFallback } from "../model-fallback.js";
import {
  createSubscribedSessionHarness,
  emitAssistantTextDeltaAndEnd,
  emitAssistantLifecycleErrorAndEnd,
} from "../embedded-agent-subscribe.e2e-harness.js";
import {
  admitMainSessionRecovery,
  beginMainSessionRun,
  beginUnguardedMainSessionRun,
  finishMainSessionRecovery,
  recordMainSessionOutputBoundary,
} from "./main-session-admission.js";

const key = "agent:main:main";
let dir: string;
let storePath: string;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "main-owner-"));
  storePath = join(dir, "sessions.json");
  vi.stubEnv("OPENCLAW_STATE_DIR", dir);
  vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "authority");
  const base: SessionEntry = { sessionId: "generation", updatedAt: 1 };
  await updateSessionStoreAtomic(storePath, (store) => {
    store[key] = {
      ...base,
      ...derivePersistedSessionLifecyclePatch({
        entry: base,
        event: {
          runId: "original",
          sessionId: base.sessionId,
          ts: 1,
          data: { phase: "start", startedAt: 1 },
        },
      }),
      abortedLastRun: true,
      recoveryOutput: {
        sessionId: "generation",
        runId: "original",
        effect: "not_applied",
        visibleOutputObserved: false,
      },
    };
  });
});
afterEach(() => {
  clearRuntimeConfigSnapshot();
  closeOpenClawAgentDatabasesForTest();
  closeOpenClawStateDatabase();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});
const entry = () => loadSessionStore(storePath, { skipCache: true })[key];
const request = (snapshot = entry()) => ({
  entry: snapshot,
  storePath,
  sessionKey: key,
  boundary: "durable-intent",
  phase: { action: "none" as const, phases: [], reason: "no pending original tool" },
  resumeBlockReason: null,
  maxAttempts: 3,
});

describe("main recovery through the real Session owner", () => {
  it.each([
    { guarded: false, asynchronous: false },
    { guarded: false, asynchronous: true },
    { guarded: true, asynchronous: false },
    { guarded: true, asynchronous: true },
  ])(
    "stops provider fallback after block delivery rejects (guarded=$guarded, async=$asynchronous)",
    async ({ guarded, asynchronous }) => {
      let calls = 0;
      const result = runWithModelFallback({
        provider: "fixture",
        model: "primary",
        skipAuthProfileRuntime: true,
        cfg: {
          agents: {
            defaults: { model: { primary: "fixture/primary", fallbacks: ["fixture/backup"] } },
          },
        },
        run: async () => {
          calls++;
          if (calls > 1) return "repeated turn";
          const { emit, subscription } = createSubscribedSessionHarness({
            runId: "original",
            ...(guarded ? { onBeforeVisibleOutput: async () => {} } : {}),
            blockReplyChunking: { minChars: 1, maxChars: 80, breakPreference: "paragraph" },
            onBlockReply: () => {
              if (asynchronous) return Promise.reject(new Error("block delivery failed"));
              throw new Error("block delivery failed");
            },
          });
          try {
            emitAssistantTextDeltaAndEnd({ emit, text: "public output" });
            emit({ type: "agent_end", messages: [] });
            await subscription.waitForPendingEvents();
            throw new Error("model not found");
          } finally {
            subscription.unsubscribe();
          }
        },
      });
      await expect(result).rejects.toThrow("block delivery failed");
      expect(calls).toBe(1);
    },
  );

  it.each([
    { deferred: false, failed: false, phase: "end" },
    { deferred: false, failed: true, phase: "error" },
    { deferred: true, failed: false, phase: "finishing" },
    { deferred: true, failed: true, phase: "finishing" },
  ])(
    "emits $phase for an attempt (deferred=$deferred, failed=$failed)",
    async ({ deferred, failed, phase }) => {
      const events: Array<Record<string, unknown>> = [];
      const { emit, subscription } = createSubscribedSessionHarness({
        runId: "original",
        terminalLifecyclePhase: deferred ? "finishing" : "end",
        onAgentEvent: (event) => {
          if (event.stream === "lifecycle") events.push(event.data);
        },
      });
      try {
        if (failed) {
          emitAssistantLifecycleErrorAndEnd({ emit, errorMessage: "model not found" });
        } else {
          emitAssistantTextDeltaAndEnd({ emit, text: "completed answer" });
          emit({ type: "agent_end", messages: [] });
        }
        await subscription.waitForPendingEvents();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ phase });
        if (failed) expect(events[0].error).toEqual(expect.any(String));
      } finally {
        subscription.unsubscribe();
      }
    },
  );

  it("rejects a completed admitted recovery before its delayed start can reopen it", async () => {
    const admitted = await admitMainSessionRecovery(request());
    if (admitted.kind !== "admitted") throw Error("missing admission");
    const identity = getRecoveryAdmissionIdentity(admitted.record);
    await beginMainSessionRun({
      storePath,
      sessionKey: key,
      sessionId: "generation",
      runId: identity.idempotencyKey,
      expectedRunId: "original",
      startedAt: 2,
      recoveryAdmission: identity,
    });
    await updateSessionStoreAtomic(storePath, (sessions) => {
      sessions[key].status = "done";
      sessions[key].abortedLastRun = false;
    });
    setRuntimeConfigSnapshot({ session: { store: storePath } });
    await persistGatewaySessionLifecycleEvent({
      sessionKey: key,
      agentId: "main",
      event: {
        sessionId: "generation",
        runId: identity.idempotencyKey,
        ts: 3,
        data: { phase: "start", startedAt: 3 },
      },
    });
    await expect(
      beginMainSessionRun({
        storePath,
        sessionKey: key,
        sessionId: "generation",
        runId: identity.idempotencyKey,
        expectedRunId: identity.idempotencyKey,
        startedAt: 3,
        recoveryAdmission: identity,
      }),
    ).rejects.toThrow("no longer owns");
    expect(entry()).toMatchObject({ status: "done", lifecycleRunId: identity.idempotencyKey });
  });

  it.each(["delivery failed", "429 Too Many Requests"])(
    "never retries a model after a public output callback rejects (%s)",
    async (message) => {
      let calls = 0;
      const result = runWithModelFallback({
        provider: "fixture",
        model: "primary",
        skipAuthProfileRuntime: true,
        cfg: {
          agents: {
            defaults: { model: { primary: "fixture/primary", fallbacks: ["fixture/backup"] } },
          },
        },
        run: async () => {
          calls++;
          if (calls > 1) return "repeated turn";
          const { emit, subscription } = createSubscribedSessionHarness({
            runId: "original",
            onBeforeVisibleOutput: async () => {},
            onPartialReply: async () => {
              throw new Error(message);
            },
          });
          try {
            emitAssistantTextDeltaAndEnd({ emit, text: "public output" });
            await subscription.waitForPendingEvents();
            return "completed";
          } finally {
            subscription.unsubscribe();
          }
        },
      });
      await expect(result).rejects.toThrow(message);
      expect(calls).toBe(1);
    },
  );

  it.each([false, true])(
    "rejects a queued admitted recovery after a newer turn has completed (delayed start=%s)",
    async (delayedStart) => {
      const admitted = await admitMainSessionRecovery(request());
      if (admitted.kind !== "admitted") throw Error("missing admission");
      await updateSessionStoreAtomic(storePath, (sessions) => {
        Object.assign(sessions[key], {
          lifecycleRunId: "newer-turn",
          status: "done",
          startedAt: 2,
          abortedLastRun: false,
        });
        sessions[key].recoveryOutput = {
          sessionId: "generation",
          runId: "newer-turn",
          effect: "unknown",
          visibleOutputObserved: true,
        };
      });
      expect(
        hasPersistedToolRecoveryAdmission(entry(), "generation", admitted.record.idempotencyKey),
      ).toBe(false);
      if (delayedStart) {
        setRuntimeConfigSnapshot({ session: { store: storePath } });
        await persistGatewaySessionLifecycleEvent({
          sessionKey: key,
          agentId: "main",
          event: {
            sessionId: "generation",
            runId: admitted.record.idempotencyKey,
            ts: 3,
            data: { phase: "start", startedAt: 3 },
          },
        });
      }
      const start = {
        storePath,
        sessionKey: key,
        sessionId: "generation",
        runId: admitted.record.idempotencyKey,
        expectedRunId: "newer-turn",
        startedAt: 3,
        recoveryAdmission: getRecoveryAdmissionIdentity(admitted.record),
      };
      await expect(beginMainSessionRun(start)).rejects.toThrow("no longer owns");
      expect(entry()).toMatchObject({
        lifecycleRunId: "newer-turn",
        status: "done",
        recoveryOutput: { runId: "newer-turn", effect: "unknown" },
      });
    },
  );

  it("does not resume an admitted owner that completed before recovery execution", async () => {
    const admitted = await admitMainSessionRecovery(request());
    if (admitted.kind !== "admitted") throw Error("missing admission");
    await updateSessionStoreAtomic(storePath, (sessions) => {
      sessions[key].status = "done";
      sessions[key].abortedLastRun = false;
    });
    const expected = getRecoveryAdmissionIdentity(admitted.record);
    await expect(
      beginMainSessionRun({
        storePath,
        sessionKey: key,
        sessionId: "generation",
        runId: expected.idempotencyKey,
        expectedRunId: "original",
        startedAt: 2,
        recoveryAdmission: expected,
      }),
    ).rejects.toThrow("no longer owns");
    setRuntimeConfigSnapshot({ session: { store: storePath } });
    await persistGatewaySessionLifecycleEvent({
      sessionKey: key,
      agentId: "main",
      event: {
        sessionId: "generation",
        runId: expected.idempotencyKey,
        ts: 2,
        data: { phase: "start", startedAt: 2 },
      },
    });
    expect(entry()).toMatchObject({ lifecycleRunId: "original", status: "done" });
  });

  it("keeps the committed successor when a stale metadata predicate still matches", async () => {
    const stale = entry();
    await updateSessionStoreAtomic(storePath, (sessions) => {
      sessions[key] = mergeSessionEntryWithPolicy(
        sessions[key],
        {
          sessionId: "successor",
          usageFamilySessionIds: ["generation", "successor"],
        },
        { identityTransition: "compaction" },
      );
    });
    await persistSessionEntry({
      sessionStore: { [key]: stale },
      sessionKey: key,
      storePath,
      entry: { ...stale, modelOverride: "primary-model" },
      shouldPersist: () => true,
    });
    expect(entry()).toMatchObject({
      sessionId: "successor",
      recoveryOutput: { runId: "original", effect: "not_applied" },
    });
  });

  it("starts the durable output boundary only after the queued message-start callback settles", async () => {
    let release!: () => void;
    const control = new Promise<void>((resolve) => {
      release = resolve;
    });
    const failure = Promise.reject(new Error("durable boundary failure"));
    void failure.catch(() => {});
    const before = vi.fn(() => failure);
    const { emit, subscription } = createSubscribedSessionHarness({
      runId: "original",
      onBeforeVisibleOutput: before,
      onAssistantMessageStart: () => control,
    });
    try {
      emit({ type: "message_start", message: { role: "assistant", content: [] } });
      emitAssistantTextDeltaAndEnd({ emit, text: "answer" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(before).not.toHaveBeenCalled();
      release();
      await expect(subscription.waitForPendingEvents()).rejects.toThrow("durable boundary failure");
    } finally {
      release();
      await subscription.waitForPendingEvents().catch(() => {});
      subscription.unsubscribe();
    }
  });

  it("does not record output when a hidden reasoning boundary only resets the draft", async () => {
    const before = vi.fn();
    const observed = vi.fn();
    const reset = vi.fn();
    const { emit, subscription } = createSubscribedSessionHarness({
      runId: "original",
      reasoningMode: "off",
      onReasoningEnd: reset,
      onBeforeVisibleOutput: before,
      onVisibleOutputObserved: observed,
    });
    try {
      emit({
        type: "message_update",
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_end" },
      });
      await subscription.waitForPendingEvents();
      expect(reset).toHaveBeenCalledOnce();
      expect(before).not.toHaveBeenCalled();
      expect(observed).not.toHaveBeenCalled();
    } finally {
      subscription.unsubscribe();
    }
  });

  it("keeps Responses message-boundary resets between queued text callbacks", async () => {
    let release!: () => void;
    const boundary = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const { emit, subscription } = createSubscribedSessionHarness({
      runId: "original",
      onBeforeVisibleOutput: () => boundary,
      onPartialReply: (payload) => {
        order.push(String(payload.text));
      },
      onAssistantMessageStart: () => {
        order.push("reset");
      },
    });
    const text = (id: string, delta: string) =>
      emit({
        type: "message_update",
        message: {
          role: "assistant",
          api: "openai-responses",
          content: [
            {
              type: "text",
              text: delta,
              textSignature: encodeAssistantTextSignature({ id, phase: "final_answer" }),
            },
          ],
        },
        assistantMessageEvent: { type: "text_delta", delta, contentIndex: 0 },
      });
    try {
      text("first-item", "first");
      text("second-item", "second");
      expect(order).toEqual([]);
      release();
      await subscription.waitForPendingEvents();
      expect(order).toEqual(["first", "reset", "second"]);
    } finally {
      release();
      await subscription.waitForPendingEvents().catch(() => {});
      subscription.unsubscribe();
    }
  });

  it("rejects an unguarded start event before it can replace an active owner", async () => {
    setRuntimeConfigSnapshot({ session: { store: storePath } });
    await updateSessionStoreAtomic(storePath, (sessions) => {
      sessions[key].abortedLastRun = false;
    });
    await persistGatewaySessionLifecycleEvent({
      sessionKey: key,
      agentId: "main",
      event: {
        sessionId: "generation",
        runId: "competitor",
        ts: 2,
        data: { phase: "start", startedAt: 2 },
      },
    });
    await expect(
      beginUnguardedMainSessionRun({
        sessionStorePath: storePath,
        sessionKey: key,
        sessionId: "generation",
        runId: "competitor",
      }),
    ).rejects.toThrow("no longer owns");
    expect(entry().lifecycleRunId).toBe("original");
  });

  it("does not record public output for hidden reasoning without an end consumer", async () => {
    const before = vi.fn();
    const observed = vi.fn();
    const { emit, subscription } = createSubscribedSessionHarness({
      runId: "original",
      reasoningMode: "off",
      onBeforeVisibleOutput: before,
      onVisibleOutputObserved: observed,
    });
    try {
      emit({
        type: "message_update",
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_end" },
      });
      await subscription.waitForPendingEvents();
      expect(before).not.toHaveBeenCalled();
      expect(observed).not.toHaveBeenCalled();
    } finally {
      subscription.unsubscribe();
    }
  });

  it("keeps a rejected run's newer terminal from replacing the active owner", async () => {
    setRuntimeConfigSnapshot({ session: { store: storePath } });
    await updateSessionStoreAtomic(storePath, (sessions) => {
      sessions[key].abortedLastRun = false;
    });
    let rejected: unknown;
    try {
      await beginMainSessionRun({
        storePath,
        sessionKey: key,
        sessionId: "generation",
        runId: "rejected-run",
        expectedRunId: "original",
        startedAt: 2,
        outputBoundaryGuarded: false,
      });
    } catch (error) {
      rejected = error;
    }
    expect(isNonProviderRuntimeCoordinationError(rejected)).toBe(true);
    await persistGatewaySessionLifecycleEvent({
      sessionKey: key,
      agentId: "main",
      event: {
        sessionId: "generation",
        runId: "rejected-run",
        ts: 3,
        data: { phase: "error", startedAt: 2, endedAt: 3 },
      },
    });
    expect(entry()).toMatchObject({ lifecycleRunId: "original", status: "running", startedAt: 1 });
  });

  it("commits the main owner before a local plugin harness emits output", async () => {
    await updateSessionStoreAtomic(storePath, (sessions) => {
      sessions[key].status = "done";
      sessions[key].abortedLastRun = false;
    });
    const runAttempt = vi.fn(async () => {
      expect(entry()).toMatchObject({
        status: "running",
        lifecycleRunId: "plugin-run",
        recoveryOutput: { runId: "plugin-run", effect: "unknown" },
      });
      throw new Error("plugin turn interrupted after output");
    });
    await expect(
      runAgentHarnessLifecycleAttempt(
        {
          id: "fixture-plugin",
          label: "Fixture plugin",
          supports: () => ({ supported: true }),
          runAttempt,
        },
        {
          sessionStorePath: storePath,
          sessionKey: key,
          sessionId: "generation",
          runId: "plugin-run",
          provider: "fixture",
          modelId: "fixture-model",
          workspaceDir: dir,
        } as never,
      ),
    ).rejects.toThrow("plugin turn interrupted after output");
    expect(runAttempt).toHaveBeenCalledOnce();
  });

  it("rejects a new run while another non-aborted main run owns the session", async () => {
    await updateSessionStoreAtomic(storePath, (sessions) => {
      sessions[key].abortedLastRun = false;
    });
    await expect(
      beginMainSessionRun({
        storePath,
        sessionKey: key,
        sessionId: "generation",
        runId: "competitor",
        expectedRunId: "original",
        startedAt: 2,
        outputBoundaryGuarded: false,
      }),
    ).rejects.toThrow("main run no longer owns the session start");
    expect(entry().lifecycleRunId).toBe("original");
  });

  it.each([false, true])(
    "waits for async partial delivery before terminal (reject=%s)",
    async (reject) => {
      let release!: () => void;
      const pending = new Promise<void>((resolve, rejectPromise) => {
        release = () => (reject ? rejectPromise(new Error("partial delivery failed")) : resolve());
      });
      const lifecycle: string[] = [];
      const observed = vi.fn();
      const partial = vi.fn(() => pending);
      const { emit, subscription } = createSubscribedSessionHarness({
        runId: "original",
        onBeforeVisibleOutput: async () => {},
        onVisibleOutputObserved: observed,
        onPartialReply: partial,
        onAgentEvent: (event) => {
          if (event.stream === "lifecycle") lifecycle.push(String(event.data.phase));
        },
      });
      try {
        emitAssistantTextDeltaAndEnd({ emit, text: "public answer" });
        emit({ type: "agent_end", messages: [] });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(partial).toHaveBeenCalled();
        expect(lifecycle).not.toContain("end");
        expect(observed).not.toHaveBeenCalled();
        release();
        if (reject) {
          await expect(subscription.waitForPendingEvents()).rejects.toThrow(
            "partial delivery failed",
          );
          expect(lifecycle).toContain("error");
        } else {
          await subscription.waitForPendingEvents();
          expect(lifecycle).toContain("end");
          expect(observed).toHaveBeenCalledOnce();
        }
      } finally {
        release();
        await subscription.waitForPendingEvents().catch(() => {});
        subscription.unsubscribe();
      }
    },
  );

  it("preserves output uncertainty when a failed CLI attempt returns to native under the same run", async () => {
    await updateSessionStoreAtomic(storePath, (sessions) => {
      sessions[key].status = "failed";
      sessions[key].recoveryOutput = {
        sessionId: "generation",
        runId: "original",
        effect: "unknown",
        visibleOutputObserved: true,
      };
    });
    await beginMainSessionRun({
      storePath,
      sessionKey: key,
      sessionId: "generation",
      runId: "original",
      startedAt: 2,
    });
    expect(entry()).toMatchObject({
      status: "running",
      recoveryOutput: { effect: "unknown", visibleOutputObserved: true },
    });
    await updateSessionStoreAtomic(storePath, (sessions) => {
      sessions[key].abortedLastRun = true;
    });
    expect((await admitMainSessionRecovery(request())).kind).toBe("reconcile");
  });

  it("invalidates native certainty when the same logical run starts an unguarded runtime", () => {
    const nativeEntry = entry();
    const patch = derivePersistedSessionLifecyclePatch({
      entry: nativeEntry,
      event: {
        runId: "original",
        sessionId: "generation",
        ts: 2,
        data: { phase: "start", startedAt: 2 },
      },
    });
    expect(patch.recoveryOutput?.effect).toBe("unknown");
  });

  it("serializes reasoning-end after queued reasoning and before the next reasoning block", async () => {
    let release!: () => void;
    const boundary = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const { emit, subscription } = createSubscribedSessionHarness({
      runId: "original",
      reasoningMode: "stream",
      onBeforeVisibleOutput: () => boundary,
      onReasoningStream: (payload) => {
        order.push(String(payload.text));
      },
      onReasoningEnd: () => {
        order.push("end");
      },
    });
    const event = (type: string, delta = "") =>
      emit({
        type: "message_update",
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type, delta },
      });
    try {
      event("thinking_delta", "first block");
      event("thinking_end");
      event("thinking_delta", "next block");
      expect(order).toEqual([]);
      release();
      await subscription.waitForPendingEvents();
      expect(order).toEqual(["first block", "end", "next block"]);
    } finally {
      release();
      await subscription.waitForPendingEvents().catch(() => {});
      subscription.unsubscribe();
    }
  });

  it("handles a detached Responses item-change flush rejection", async () => {
    const rejectedFlush = Promise.reject(new Error("failed output boundary"));
    void rejectedFlush.catch(() => {});
    const observedCatch = vi.spyOn(rejectedFlush, "catch");
    const ctx = {
      params: { runId: "original", session: {}, onAssistantMessageStart: vi.fn() },
      state: {
        lastAssistantStreamItemId: "prior-item",
        assistantTexts: [],
        assistantMessageIndex: 0,
        deltaBuffer: "",
        replayState: {},
        blockState: {},
        partialBlockState: {},
      },
      log: { debug: vi.fn() },
      noteLastAssistant: vi.fn(),
      flushBlockReplyBuffer: () => rejectedFlush,
      resetAssistantMessageState: vi.fn(),
      emitAssistantMessageStart: vi.fn(),
    } as unknown as EmbeddedAgentSubscribeContext;
    handleMessageUpdate(ctx, {
      type: "message_update",
      message: {
        role: "assistant",
        api: "openai-responses",
        content: [
          {
            type: "text",
            text: "",
            textSignature: encodeAssistantTextSignature({ id: "next-item" }),
          },
        ],
      },
      assistantMessageEvent: { type: "text_start", contentIndex: 0 },
    } as never);
    expect(observedCatch).toHaveBeenCalledTimes(1);
  });
  it("keeps an unguarded runtime start uncertain even when an earlier native run had no output", () => {
    const nativeEntry = entry();
    const patch = derivePersistedSessionLifecyclePatch({
      entry: nativeEntry,
      event: {
        runId: "plugin-run",
        sessionId: "generation",
        ts: 2,
        data: { phase: "start", startedAt: 2 },
      },
    });
    expect(patch.recoveryOutput?.effect).toBe("unknown");
  });

  it("crosses the public output boundary before sending streamed reasoning", async () => {
    const params = { storePath, sessionKey: key, sessionId: "generation", runId: "original" };
    const reasoning = vi.fn(() => {
      expect(entry().recoveryOutput?.effect).toBe("unknown");
    });
    const { emit, subscription } = createSubscribedSessionHarness({
      runId: "original",
      reasoningMode: "stream",
      onReasoningStream: reasoning,
      onBeforeVisibleOutput: () => recordMainSessionOutputBoundary(params),
      onVisibleOutputObserved: () => recordMainSessionOutputBoundary({ ...params, observed: true }),
    });
    try {
      emit({
        type: "message_update",
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_delta", delta: "public reasoning" },
      });
      await subscription.waitForPendingEvents();
      expect(reasoning).toHaveBeenCalledTimes(1);
      expect(entry().recoveryOutput).toMatchObject({
        effect: "unknown",
        visibleOutputObserved: true,
      });
    } finally {
      subscription.unsubscribe();
    }
  });
  it("holds terminal lifecycle until gated public output has crossed its owner boundary", async () => {
    let release!: () => void;
    const boundary = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const { emit, subscription } = createSubscribedSessionHarness({
      runId: "original",
      onBeforeVisibleOutput: () => boundary,
      onAgentEvent: (event) => {
        order.push(event.stream === "lifecycle" ? String(event.data.phase) : event.stream);
      },
    });
    try {
      emitAssistantTextDeltaAndEnd({ emit, text: "public answer" });
      emit({ type: "agent_end", messages: [] });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(order).not.toContain("end");
      release();
      await subscription.waitForPendingEvents();
      expect(order.indexOf("assistant")).toBeGreaterThanOrEqual(0);
      expect(order.indexOf("end")).toBeGreaterThan(order.indexOf("assistant"));
    } finally {
      release();
      await subscription.waitForPendingEvents().catch(() => {});
      subscription.unsubscribe();
    }
  });

  it("reports output-boundary failure before a terminal can claim completion", async () => {
    const lifecycle: string[] = [];
    const { emit, subscription } = createSubscribedSessionHarness({
      runId: "original",
      onBeforeVisibleOutput: async () => {
        throw new Error("failed durable output boundary");
      },
      onAgentEvent: (event) => {
        if (event.stream === "lifecycle") lifecycle.push(String(event.data.phase));
      },
    });
    try {
      emitAssistantTextDeltaAndEnd({ emit, text: "public answer" });
      emit({ type: "agent_end", messages: [] });
      await expect(subscription.waitForPendingEvents()).rejects.toThrow(
        "failed durable output boundary",
      );
      expect(lifecycle).not.toContain("end");
      expect(lifecycle).toContain("error");
    } finally {
      subscription.unsubscribe();
    }
  });

  it("retains main admission and output ownership through an explicit compaction successor", async () => {
    const snapshot = entry();
    const admitted = await admitMainSessionRecovery(request(snapshot));
    if (admitted.kind !== "admitted") throw Error("missing admitted owner");
    await updateSessionStoreAtomic(storePath, (store) => {
      store[key].lifecycleRunId = admitted.record.idempotencyKey;
      store[key] = mergeSessionEntryWithPolicy(
        store[key],
        {
          sessionId: "compacted",
          usageFamilySessionIds: ["generation", "compacted"],
          recoveryOutput: {
            sessionId: "generation",
            runId: admitted.record.idempotencyKey,
            effect: "not_applied",
          },
        },
        { identityTransition: "compaction" },
      );
    });
    expect(
      await finishMainSessionRecovery({
        entry: snapshot,
        storePath,
        sessionKey: key,
        record: admitted.record,
        state: "accepted",
      }),
    ).toBe(true);
    await recordMainSessionOutputBoundary({
      storePath,
      sessionKey: key,
      sessionId: "generation",
      runId: admitted.record.idempotencyKey,
    });
    expect(entry().restartRecovery).toMatchObject({
      runId: admitted.record.idempotencyKey,
      attempts: 1,
    });
    expect(entry().recoveryOutput).toMatchObject({ sessionId: "compacted", effect: "unknown" });
  });
  it("keeps the existing three-attempt ceiling durable without dispatching a fourth continuation", async () => {
    await updateSessionStoreAtomic(storePath, (store) => {
      store[key].restartRecovery = {
        sessionId: "generation",
        boundary: "durable-intent",
        runId: "prior",
        attempts: 3,
        state: "admitted",
      };
    });
    expect((await admitMainSessionRecovery(request())).kind).toBe("wedged");
    expect(entry()).toMatchObject({
      status: "failed",
      restartRecovery: { attempts: 3, state: "wedged", authority: { attempts: 3 } },
    });
  });
  it("admits one concurrent continuation and retains its consumed attempt after an unknown ACK", async () => {
    const snapshot = entry();
    const results = await Promise.all([
      admitMainSessionRecovery(request(snapshot)),
      admitMainSessionRecovery(request(snapshot)),
    ]);
    const admitted = results.find((r) => r.kind === "admitted");
    expect(results.filter((r) => r.kind === "admitted")).toHaveLength(1);
    expect(entry().restartRecovery?.attempts).toBe(1);
    if (admitted?.kind !== "admitted") throw Error("missing admitted owner");
    await finishMainSessionRecovery({
      entry: snapshot,
      storePath,
      sessionKey: key,
      record: admitted.record,
      state: "reconcile",
    });
    expect(entry().restartRecovery).toMatchObject({
      attempts: 1,
      authority: { state: "reconcile" },
    });
    expect((await admitMainSessionRecovery(request())).kind).toBe("reconcile");
  });

  it("cannot finish an old admission after a new lifecycle owns the same session", async () => {
    const snapshot = entry();
    const admitted = await admitMainSessionRecovery(request(snapshot));
    if (admitted.kind !== "admitted") throw Error("missing admitted owner");
    await updateSessionStoreAtomic(storePath, (store) => {
      store[key].lifecycleRunId = "new-user-run";
    });
    expect(
      await finishMainSessionRecovery({
        entry: snapshot,
        storePath,
        sessionKey: key,
        record: admitted.record,
        state: "accepted",
      }),
    ).toBe(false);
    expect(entry().abortedLastRun).toBe(true);
    expect(entry().lifecycleRunId).toBe("new-user-run");
  });

  it("commits output uncertainty before dispatching response data and records observation afterwards", async () => {
    const consumer = vi.fn(() => {
      expect(entry().recoveryOutput?.effect).toBe("unknown");
    });
    const params = { storePath, sessionKey: key, sessionId: "generation", runId: "original" };
    const { emit, subscription } = createSubscribedSessionHarness({
      runId: "original",
      onAgentEvent: consumer,
      onBeforeVisibleOutput: () => recordMainSessionOutputBoundary(params),
      onVisibleOutputObserved: () => recordMainSessionOutputBoundary({ ...params, observed: true }),
    });
    try {
      emitAssistantTextDeltaAndEnd({ emit, text: "public response" });
      await subscription.waitForPendingEvents();
      expect(consumer).toHaveBeenCalled();
      expect(entry().recoveryOutput).toMatchObject({
        effect: "unknown",
        visibleOutputObserved: true,
      });
      expect((await admitMainSessionRecovery(request())).kind).toBe("reconcile");
    } finally {
      subscription.unsubscribe();
    }
  });

  it("reports a rejected output owner before any response data leaves the subscriber", async () => {
    const consumer = vi.fn();
    await updateSessionStoreAtomic(storePath, (store) => {
      store[key].sessionId = "replacement";
    });
    const { emit, subscription } = createSubscribedSessionHarness({
      runId: "original",
      onAgentEvent: consumer,
      onBeforeVisibleOutput: () =>
        recordMainSessionOutputBoundary({
          storePath,
          sessionKey: key,
          sessionId: "generation",
          runId: "original",
        }),
    });
    try {
      emitAssistantTextDeltaAndEnd({ emit, text: "stale response" });
      await expect(subscription.waitForPendingEvents()).rejects.toThrow("no longer owns");
      expect(consumer).not.toHaveBeenCalled();
      expect(entry().sessionId).toBe("replacement");
    } finally {
      subscription.unsubscribe();
    }
  });
});
