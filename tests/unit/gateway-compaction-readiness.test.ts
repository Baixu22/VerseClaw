// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { transformWithEsbuild } from "vite";
import { resolveDefaultAgentId } from "../../openclaw_runtime/src/agents/agent-scope";
import { resolveSessionStoreAgentId } from "../../openclaw_runtime/src/gateway/session-store-key";
import {
  normalizeAgentId,
  resolveAgentIdFromSessionKey,
} from "../../openclaw_runtime/src/routing/session-key";
import {
  hasTrackedActiveSessionRun,
  isSessionBusyForManualCompaction,
} from "../../openclaw_runtime/src/gateway/server-methods/session-active-runs";
import { sessionAdmissionRegistry } from "../../openclaw_runtime/src/sessions/session-admission-registry";

const runs = vi.hoisted(() => ({ active: vi.fn(() => false) }));
vi.mock("../../openclaw_runtime/src/agents/embedded-agent-runner/runs.js", () => ({
  isEmbeddedAgentRunActive: runs.active,
}));

const canonicalKey = "agent:main:readiness";
const identity = {
  agentId: "main",
  canonicalSessionKey: canonicalKey,
  expectedSessionId: "readiness-1",
};
const params = {
  cfg: {},
  context: { chatAbortControllers: new Map() },
  requestedKey: canonicalKey,
  canonicalKey,
  sessionId: identity.expectedSessionId,
};

beforeEach(() => runs.active.mockReset().mockReturnValue(false));

describe("manual compaction admission readiness", () => {
  it.each(["tracked", "embedded", "permit", "fence", "idle"] as const)(
    "checks %s and becomes idle after release",
    async (kind) => {
      const context = { chatAbortControllers: new Map() };
      if (kind === "tracked") context.chatAbortControllers.set("run", { sessionKey: canonicalKey });
      runs.active.mockReturnValue(kind === "embedded");
      const release =
        kind === "permit"
          ? sessionAdmissionRegistry.acquirePermit(identity, "chat-send")
          : undefined;
      const held = kind === "fence" ? await sessionAdmissionRegistry.fence(identity) : undefined;
      try {
        expect(isSessionBusyForManualCompaction({ ...params, context })).toBe(kind !== "idle");
        if (held) expect(sessionAdmissionRegistry.ownsFence(held)).toBe(true);
      } finally {
        release?.();
        held?.release();
        context.chatAbortControllers.clear();
        runs.active.mockReturnValue(false);
      }
      expect(isSessionBusyForManualCompaction({ ...params, context })).toBe(false);
    },
  );

  it("keeps invisible run projection separate from admission safety", () => {
    const context = {
      chatAbortControllers: new Map([
        ["run", { sessionKey: canonicalKey, controlUiVisible: false }],
      ]),
    };
    const release = sessionAdmissionRegistry.acquirePermit(identity, "embedded-agent");
    try {
      expect(hasTrackedActiveSessionRun({ ...params, context })).toBe(false);
      expect(isSessionBusyForManualCompaction({ ...params, context })).toBe(true);
    } finally {
      release();
    }
  });

  it("resolves the canonical agent and excludes other agents and generations", async () => {
    const cfg = { agents: { list: [{ id: "reviewer", default: true }, { id: "main" }] } };
    const scoped = { ...params, cfg, requestedKey: "main", canonicalKey: "agent:reviewer:main" };
    const current = { ...identity, agentId: "reviewer", canonicalSessionKey: scoped.canonicalKey };
    const release = sessionAdmissionRegistry.acquirePermit(current, "chat-send");
    try {
      expect(isSessionBusyForManualCompaction(scoped)).toBe(true);
      expect(isSessionBusyForManualCompaction({ ...scoped, sessionId: "readiness-2" })).toBe(false);
      expect(isSessionBusyForManualCompaction({ ...scoped, sessionId: undefined })).toBe(false);
    } finally {
      release();
    }
    const held = await sessionAdmissionRegistry.fence({
      ...current,
      canonicalSessionKey: "global",
    });
    try {
      expect(
        isSessionBusyForManualCompaction({
          ...scoped,
          canonicalKey: "global",
          agentId: "reviewer",
        }),
      ).toBe(true);
      expect(
        isSessionBusyForManualCompaction({ ...scoped, canonicalKey: "global", agentId: "main" }),
      ).toBe(false);
    } finally {
      held.release();
    }
  });
});

describe("session lifecycle source owner", () => {
  it.each([
    ["global fork", "sourceAgentId", 0, "global", undefined, "reviewer"],
    ["global parent reset", "parentAgentId", 0, "global", undefined, "reviewer"],
    ["global parent inheritance", "parentAgentId", 1, "global", undefined, "reviewer"],
    ["explicit global fork", "sourceAgentId", 0, "global", "main", "main"],
    ["scoped fork", "sourceAgentId", 0, "agent:main:topic", undefined, "main"],
    ["canonical main alias", "sourceAgentId", 0, "agent:reviewer:main", undefined, "reviewer"],
  ] as const)(
    "resolves %s from the captured configuration",
    (_name, variable, occurrence, canonicalKey, agentId, expected) => {
      const source = readFileSync(
        resolve("openclaw_runtime/src/gateway/server-methods/sessions.lifecycle.ts"),
        "utf8",
      );
      let start = source.indexOf(`const ${variable} =`);
      if (occurrence) start = source.indexOf(`const ${variable} =`, start + 1);
      const end = source.indexOf(";", start);
      expect(start >= 0 && end > start).toBe(true);
      // Execute the production caller's selection with its real key/config resolvers.
      const select = new Function(
        "cfg",
        "requestedAgent",
        "source",
        "parentSelectedAgentId",
        "canonicalParentSessionKey",
        "normalizeAgentId",
        "resolveAgentIdFromSessionKey",
        "resolveSessionStoreAgentId",
        "resolveDefaultAgentId",
        `${source.slice(start, end + 1)}; return ${variable};`,
      );
      const cfg = { agents: { list: [{ id: "reviewer", default: true }, { id: "main" }] } };
      expect(
        select(
          cfg,
          { agentId },
          { canonicalKey },
          agentId,
          canonicalKey,
          normalizeAgentId,
          resolveAgentIdFromSessionKey,
          resolveSessionStoreAgentId,
          resolveDefaultAgentId,
        ),
      ).toBe(expected);
    },
  );
});

describe("live readback readiness budget", () => {
  async function loadTurn(
    settledAt: number,
    statuses: boolean[],
    generation = identity.expectedSessionId,
  ) {
    const file = resolve("tests/e2e/recovery-longsession-eval.spec.ts");
    const source = readFileSync(file, "utf8");
    const start = source.indexOf("async function turn(");
    const end = source.indexOf("test.describe(", start);
    expect(start >= 0 && end > start).toBe(true);
    const { code } = await transformWithEsbuild(source.slice(start, end), file, {
      target: "es2022",
      format: "cjs",
    });
    let now = 0;
    let reads = 0;
    const budgets: number[] = [];
    const disk = {
      main: { sessionId: identity.expectedSessionId, status: "done" },
      entries: [
        { id: "answer", message: { role: "assistant", stopReason: "stop", content: "ACK" } },
      ],
      branch: [
        { id: "answer", message: { role: "assistant", stopReason: "stop", content: "ACK" } },
      ],
    };
    const read = () => {
      reads += 1;
      if (reads === 1) return { entries: [] };
      if (reads === 2) now = settledAt;
      return reads > 2 ? { ...disk, main: { ...disk.main, sessionId: generation } } : disk;
    };
    const host = vi.fn(async (_app, service) =>
      service === "chat"
        ? {}
        : {
            success: true,
            available: true,
            canCompact: statuses.shift() ?? false,
            inProgress: false,
          },
    );
    const eventualFile = resolve("tests/e2e/fixtures/recovery-contract-probe.ts");
    const eventualSource = readFileSync(eventualFile, "utf8");
    const eventualStart = eventualSource.indexOf("export async function eventually<");
    const eventualEnd = eventualSource.indexOf("\nexport ", eventualStart + 1);
    expect(eventualStart >= 0 && eventualEnd > eventualStart).toBe(true);
    const eventualCode = (
      await transformWithEsbuild(
        eventualSource.slice(eventualStart, eventualEnd).replace(/^export /, ""),
        eventualFile,
        { target: "es2022", format: "cjs" },
      )
    ).code;
    const clock = { now: () => now };
    const schedule = (callback: () => void, ms: number) => {
      now += ms;
      callback();
    };
    const eventually = new Function("Date", "setTimeout", `${eventualCode}; return eventually;`)(
      clock,
      schedule,
    );
    const wait = (
      readValue: () => unknown,
      accept: (value: unknown) => boolean,
      label: string,
      timeout: number,
    ) => {
      budgets.push(timeout);
      return eventually(readValue, accept, label, timeout);
    };
    const turn = new Function(
      "readRecoveryDisk",
      "hostInvoke",
      "eventually",
      "text",
      "Date",
      `${code}; return turn;`,
    )(read, host, wait, (message: { content: string }) => message.content, clock) as (
      ...args: unknown[]
    ) => Promise<{ sessionId: string; text: string }>;
    return { run: () => turn({}, "state", canonicalKey, "seed", "send-1"), budgets, host, clock };
  }

  it("waits past the terminal answer using the remaining original turn budget", async () => {
    const probe = await loadTurn(210_000, [false, true]);
    expect(await probe.run()).toMatchObject({ sessionId: identity.expectedSessionId, text: "ACK" });
    expect(probe.budgets).toEqual([240_000, 30_000]);
    expect(probe.host.mock.calls.filter((call) => call[1] === "sessions")).toHaveLength(2);
  });

  it("does not start another wait when the original turn budget is exhausted", async () => {
    const probe = await loadTurn(240_000, [true]);
    await expect(probe.run()).rejects.toThrow("same-generation compaction readiness timed out");
    expect(probe.budgets).toEqual([240_000, 0]);
    expect(probe.host.mock.calls.filter((call) => call[1] === "sessions")).toHaveLength(0);
  });

  it("rejects a ready status belonging to a replacement generation", async () => {
    const probe = await loadTurn(239_800, [true, true], "replacement");
    await expect(probe.run()).rejects.toThrow("same-generation compaction readiness timed out");
    expect(probe.clock.now()).toBe(240_000);
  });
});
