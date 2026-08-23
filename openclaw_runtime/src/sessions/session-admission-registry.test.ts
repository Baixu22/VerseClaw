import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  acquireSessionAdmissionPermit,
  SessionAdmissionFencedError,
  sessionAdmissionRegistry,
} from "./session-admission-registry.js";

const identity = {
  agentId: "agent-a",
  canonicalSessionKey: "agent:agent-a:main",
  expectedSessionId: "session-1",
};

beforeEach(() => {
  sessionAdmissionRegistry.clearForTests();
});

afterEach(() => {
  sessionAdmissionRegistry.clearForTests();
});

describe("SessionAdmissionRegistry", () => {
  it("uses agentId + canonicalSessionKey + expectedSessionId as identity", () => {
    const release = sessionAdmissionRegistry.acquirePermit(identity, "chat-send");
    expect(sessionAdmissionRegistry.snapshot(identity)?.active).toBe(1);
    expect(
      sessionAdmissionRegistry.snapshot({ ...identity, expectedSessionId: "session-2" })?.active ?? 0,
    ).toBe(0);
    release();
    expect(sessionAdmissionRegistry.snapshot(identity)?.active).toBe(0);
  });

  it("release is idempotent and rejects new permits while fenced", async () => {
    const release = sessionAdmissionRegistry.acquirePermit(identity, "chat-send");
    release();
    release();
    expect(sessionAdmissionRegistry.snapshot(identity)?.active).toBe(0);

    const fence = sessionAdmissionRegistry.fence(identity);
    await fence;
    expect(() => sessionAdmissionRegistry.acquirePermit(identity, "chat-send")).toThrow(
      SessionAdmissionFencedError,
    );
    expect(sessionAdmissionRegistry.snapshot(identity)?.totalRejectedWhileFenced).toBe(1);

    const token = await sessionAdmissionRegistry.fence(identity).catch(() => null);
    expect(token).toBeNull();
    const awaited = await fence;
    awaited.release();
    expect(sessionAdmissionRegistry.snapshot(identity)?.fenced).toBe(false);
    expect(sessionAdmissionRegistry.acquirePermit(identity, "chat-send")).toBeTypeOf("function");
  });

  it("fence waits for in-flight admission critical sections before returning the token", async () => {
    const first = sessionAdmissionRegistry.acquirePermit(identity, "chat-send");
    const second = sessionAdmissionRegistry.acquirePermit(identity, "embedded-agent");
    let fenceSettled = false;
    const fencePromise = sessionAdmissionRegistry.fence(identity).then((token) => {
      fenceSettled = true;
      return token;
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fenceSettled).toBe(false);
    first();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fenceSettled).toBe(false);
    second();
    const token = await fencePromise;
    expect(token).toBeTruthy();
    token.release();
  });

  it("fence-vs-spawn TOCTOU cannot admit a spawn after fence closes", async () => {
    const token = await sessionAdmissionRegistry.fence(identity);
    const rejected: unknown[] = [];
    for (let index = 0; index < 100; index += 1) {
      try {
        sessionAdmissionRegistry.acquirePermit(identity, "subagent-spawn");
        rejected.push("admitted");
      } catch (error) {
        rejected.push(error instanceof SessionAdmissionFencedError ? "fenced" : "other");
      }
    }
    expect(rejected).toHaveLength(100);
    expect(rejected.every((value) => value === "fenced")).toBe(true);
    expect(sessionAdmissionRegistry.snapshot(identity)?.active).toBe(0);
    token.release();
  });

  it("required production hook acquires permits without an env opt-in", () => {
    const release = acquireSessionAdmissionPermit(identity, "chat-send");
    expect(sessionAdmissionRegistry.snapshot(identity)?.totalPermits).toBe(1);
    release();
  });

  it("required production hook respects fences without an env opt-in", async () => {
    const release = acquireSessionAdmissionPermit(identity, "chat-send");
    expect(sessionAdmissionRegistry.snapshot(identity)?.active).toBe(1);
    release();
    const token = await sessionAdmissionRegistry.fence(identity);
    expect(() => acquireSessionAdmissionPermit(identity, "chat-send")).toThrow(
      SessionAdmissionFencedError,
    );
    token.release();
  });


  it("resolves agentId from the canonical session key and rejects malformed identity", () => {
    const release = sessionAdmissionRegistry.acquirePermit(
      {
        canonicalSessionKey: "agent:agent-b:main",
        expectedSessionId: "session-1",
      },
      "chat-send",
    );
    release();
    expect(
      sessionAdmissionRegistry.snapshot({
        agentId: "agent-b",
        canonicalSessionKey: "agent:agent-b:main",
        expectedSessionId: "session-1",
      })?.totalPermits,
    ).toBe(1);

    expect(() =>
      sessionAdmissionRegistry.acquirePermit(
        { canonicalSessionKey: "unscoped-key", expectedSessionId: "session-1" },
        "chat-send",
      ),
    ).toThrow(/unable to resolve agentId/);
    expect(() =>
      sessionAdmissionRegistry.acquirePermit(
        { agentId: "agent-a", canonicalSessionKey: "agent:agent-a:main", expectedSessionId: "  " },
        "chat-send",
      ),
    ).toThrow(/expectedSessionId/);
  });

  it("isFenced and removeFence are informational/test helpers, not admission checks", async () => {
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(false);
    const token = await sessionAdmissionRegistry.fence(identity);
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(true);
    sessionAdmissionRegistry.removeFence(identity);
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(false);
    // A token whose fence was removed by a different owner cannot reopen it.
    sessionAdmissionRegistry.removeFence(identity);
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(false);
    token.release();
  });

  it("permit release is scoped to the exact lifecycle identity", () => {
    const other = { ...identity, agentId: "agent-b" };
    const first = sessionAdmissionRegistry.acquirePermit(identity, "chat-send");
    const second = sessionAdmissionRegistry.acquirePermit(other, "chat-send");
    expect(sessionAdmissionRegistry.snapshot(identity)?.active).toBe(1);
    expect(sessionAdmissionRegistry.snapshot(other)?.active).toBe(1);
    first();
    expect(sessionAdmissionRegistry.snapshot(identity)?.active).toBe(0);
    expect(sessionAdmissionRegistry.snapshot(other)?.active).toBe(1);
    second();
  });

  it("required hook fail-closes malformed identity", () => {
    expect(() =>
      acquireSessionAdmissionPermit(
        { canonicalSessionKey: "unscoped", expectedSessionId: "session-1" },
        "chat-send",
      ),
    ).toThrow(/unable to resolve agentId/);
  });

  it("fence token release is idempotent and cannot reopen after a competing fence", async () => {
    const firstToken = await sessionAdmissionRegistry.fence(identity);
    firstToken.release();
    firstToken.release();
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(false);

    const secondToken = await sessionAdmissionRegistry.fence(identity);
    sessionAdmissionRegistry.removeFence(identity);
    secondToken.release();
    expect(sessionAdmissionRegistry.isFenced(identity)).toBe(false);
  });

  it("records admissionPermitP95Ms benchmark", () => {
    const samples: number[] = [];
    for (let index = 0; index < 2_000; index += 1) {
      const started = performance.now();
      const release = sessionAdmissionRegistry.acquirePermit(identity, "chat-send");
      release();
      samples.push(performance.now() - started);
    }
    samples.sort((left, right) => left - right);
    const p95 = samples[Math.floor(samples.length * 0.95) - 1];
    console.log(`[runtime-lifecycle-audit] admissionPermitP95Ms=${p95.toFixed(4)}`);
    expect(p95).toBeGreaterThanOrEqual(0);
  });
});
