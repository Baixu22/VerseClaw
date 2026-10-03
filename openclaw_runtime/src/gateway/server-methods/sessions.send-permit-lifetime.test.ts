/**
 * TF-0082 owner path 4: send/steer admission permit lifetime.
 *
 * The permit must fence the whole run-start window — steer interrupt,
 * transcript seq read, and the chat.send preamble — instead of being released
 * before chat.send runs. A reset/delete racing mid-send fences the same
 * identity, so its fence must not drain until the run is armed. The permit is
 * then released exactly once, whether the send acks, fails, or throws.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";

const sendMocks = vi.hoisted(() => ({
  resolveRequestedGlobalAgentId: vi.fn(),
  interruptSessionRunIfActive: vi.fn(),
  loadSessionEntry: vi.fn(),
  readSessionMessageCountAsync: vi.fn(),
  resolveDeletedAgentIdFromSessionKey: vi.fn(),
  chatSend: vi.fn(),
  emitSessionsChanged: vi.fn(),
  reactivateCompletedSubagentSession: vi.fn(),
}));

vi.mock("./sessions.shared.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./sessions.shared.js")>();
  return {
    ...original,
    resolveRequestedGlobalAgentId: sendMocks.resolveRequestedGlobalAgentId,
    interruptSessionRunIfActive: sendMocks.interruptSessionRunIfActive,
  };
});

vi.mock("../session-utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../session-utils.js")>();
  return {
    ...original,
    loadSessionEntry: sendMocks.loadSessionEntry,
    readSessionMessageCountAsync: sendMocks.readSessionMessageCountAsync,
    resolveDeletedAgentIdFromSessionKey: sendMocks.resolveDeletedAgentIdFromSessionKey,
  };
});

vi.mock("./chat.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./chat.js")>();
  return {
    ...original,
    chatHandlers: { ...original.chatHandlers, "chat.send": sendMocks.chatSend },
  };
});

vi.mock("./session-change-event.js", () => ({
  emitSessionsChanged: sendMocks.emitSessionsChanged,
}));

vi.mock("../session-subagent-reactivation.js", () => ({
  reactivateCompletedSubagentSession: sendMocks.reactivateCompletedSubagentSession,
}));

import {
  sessionAdmissionRegistry,
  type SessionAdmissionIdentity,
} from "../../sessions/session-admission-registry.js";
import { sessionsRunControlHandlers } from "./sessions.run-control.js";

const CANONICAL_KEY = "agent:agent-a:main";
const CURRENT_SESSION_ID = "session-generation-1";

const identity: SessionAdmissionIdentity = {
  agentId: "agent-a",
  canonicalSessionKey: CANONICAL_KEY,
  expectedSessionId: CURRENT_SESSION_ID,
};

/** Reads the live permit count for the session identity under test. */
function activePermits(): number {
  return sessionAdmissionRegistry.snapshot(identity)?.active ?? 0;
}

/** Lets the event loop turn so a pending `fence()` drain loop can advance. */
async function settleFenceLoop(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function makeRespond() {
  const calls: Array<{ ok: boolean; payload: unknown; error?: unknown }> = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    calls.push({ ok, payload, error });
  };
  return { calls, respond };
}

const context = {
  getRuntimeConfig: () => ({}) as OpenClawConfig,
} as never;

type ChatSendOptions = {
  respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: { cached?: boolean }) => void;
};

async function invokeSend(method: "sessions.send" | "sessions.steer") {
  const { calls, respond } = makeRespond();
  await sessionsRunControlHandlers[method]!({
    params: { key: CANONICAL_KEY, message: "hello" },
    respond,
    context,
  } as never);
  return calls;
}

describe("sessions.send/steer admission permit lifetime", () => {
  beforeEach(() => {
    for (const mock of Object.values(sendMocks)) {
      mock.mockReset();
    }
    sessionAdmissionRegistry.clearForTests();
    sendMocks.resolveRequestedGlobalAgentId.mockReturnValue({ ok: true, agentId: "agent-a" });
    sendMocks.resolveDeletedAgentIdFromSessionKey.mockReturnValue(null);
    sendMocks.loadSessionEntry.mockReturnValue({
      entry: { sessionId: CURRENT_SESSION_ID },
      canonicalKey: CANONICAL_KEY,
      storePath: "/tmp/sessions.json",
    });
    sendMocks.readSessionMessageCountAsync.mockResolvedValue(0);
    sendMocks.interruptSessionRunIfActive.mockResolvedValue({ interrupted: false });
    sendMocks.reactivateCompletedSubagentSession.mockResolvedValue(undefined);
  });

  it("holds the permit through the chat.send preamble and releases it at the run ack", async () => {
    let activeInsideChatSend: number | undefined;
    let activeAfterAck: number | undefined;
    sendMocks.chatSend.mockImplementation(async (options: ChatSendOptions) => {
      // Preamble: the run is not armed yet, so the permit must still be held.
      await Promise.resolve();
      activeInsideChatSend = activePermits();
      options.respond(true, { runId: "run-1", status: "started" });
      activeAfterAck = activePermits();
    });

    const calls = await invokeSend("sessions.send");

    expect(activeInsideChatSend).toBe(1);
    expect(activeAfterAck).toBe(0);
    expect(activePermits()).toBe(0);
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({ runId: "run-1", messageSeq: 1 });
  });

  it("blocks a mid-send reset fence until the run-start window closes", async () => {
    let fenceDrained = false;
    let fenceDrainedBeforeAck: boolean | undefined;
    sendMocks.chatSend.mockImplementation(async (options: ChatSendOptions) => {
      // A reset lands while chat.send is still in its preamble.
      const fencePromise = sessionAdmissionRegistry.fence(identity).then((handle) => {
        fenceDrained = true;
        return handle;
      });
      await settleFenceLoop();
      fenceDrainedBeforeAck = fenceDrained;
      options.respond(true, { runId: "run-2", status: "started" });
      const handle = await fencePromise;
      handle.release();
    });

    await invokeSend("sessions.send");

    // The fence was pending across the whole preamble and only drained once the
    // run was armed — the stale-generation seed window is closed.
    expect(fenceDrainedBeforeAck).toBe(false);
    expect(fenceDrained).toBe(true);
    expect(activePermits()).toBe(0);
  });

  it("keeps the steer interrupt inside the same permit window", async () => {
    let activeDuringInterrupt: number | undefined;
    let activeInsideChatSend: number | undefined;
    sendMocks.interruptSessionRunIfActive.mockImplementation(async () => {
      activeDuringInterrupt = activePermits();
      return { interrupted: true };
    });
    sendMocks.chatSend.mockImplementation(async (options: ChatSendOptions) => {
      activeInsideChatSend = activePermits();
      options.respond(true, { runId: "run-3", status: "started" });
    });

    const calls = await invokeSend("sessions.steer");

    expect(activeDuringInterrupt).toBe(1);
    expect(activeInsideChatSend).toBe(1);
    expect(activePermits()).toBe(0);
    expect(calls[0]?.payload).toMatchObject({ interruptedActiveRun: true });
  });

  it("releases the permit when the steer interrupt fails before any send", async () => {
    sendMocks.interruptSessionRunIfActive.mockResolvedValue({
      interrupted: true,
      error: { code: "UNAVAILABLE", message: "still active" },
    });

    const calls = await invokeSend("sessions.steer");

    expect(calls[0]?.ok).toBe(false);
    expect(sendMocks.chatSend).not.toHaveBeenCalled();
    expect(activePermits()).toBe(0);
    // A reset arriving right after the failed steer fences immediately.
    const handle = await sessionAdmissionRegistry.fence(identity);
    handle.release();
  });

  it("does not leak the permit when chat.send throws", async () => {
    sendMocks.chatSend.mockRejectedValue(new Error("chat.send exploded"));

    await expect(invokeSend("sessions.send")).rejects.toThrow("chat.send exploded");

    expect(activePermits()).toBe(0);
    const handle = await sessionAdmissionRegistry.fence(identity);
    handle.release();
  });

  it("releases exactly one permit even though both the ack and the finally run", async () => {
    // A second in-flight send on the same identity must survive this send's
    // release; a double release would drop its permit and let a reset fence
    // drain while that send is still in its own run-start window.
    const releaseConcurrentSend = sessionAdmissionRegistry.acquirePermit(identity, "sessions-send");
    sendMocks.chatSend.mockImplementation(async (options: ChatSendOptions) => {
      options.respond(true, { runId: "run-4", status: "started" });
    });

    await invokeSend("sessions.send");

    expect(activePermits()).toBe(1);
    expect(sessionAdmissionRegistry.snapshot(identity)?.totalPermits).toBe(2);
    releaseConcurrentSend();
    expect(activePermits()).toBe(0);
  });
});
