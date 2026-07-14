import { afterEach, describe, expect, it, vi } from "vitest";
import { dcsObservability } from "./dcs-observability.js";
import {
  bindSessionWorkspaceFingerprint,
  computeWorkspaceFingerprint,
  getSessionWorkspaceFingerprint,
  resetSessionWorkspaceFingerprints,
  workingMemoryBlockIdForSession,
} from "./workspace-fingerprint.js";

afterEach(() => {
  resetSessionWorkspaceFingerprints();
  dcsObservability.reset();
});

describe("DCS workspace fingerprint (D3 slice)", () => {
  it("computes stable 16-hex fingerprint from absolute path (case/slash insensitive)", () => {
    const a = computeWorkspaceFingerprint("C:\\Repos\\App");
    const b = computeWorkspaceFingerprint("c:/Repos/App");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toBe(b);
    expect(computeWorkspaceFingerprint("C:\\Repos\\Other")).not.toBe(a);
  });

  it("working-memory block id is deterministic", () => {
    expect(workingMemoryBlockIdForSession("sess-1")).toBe("working-memory:sess-1");
  });

  it("binds fingerprint on first observation without invalidate", async () => {
    const invalidate = vi.fn(async () => undefined);
    const result = await bindSessionWorkspaceFingerprint({
      sessionKey: "agent:main:sess",
      sessionId: "sess",
      fingerprint: "abc123def4567890",
      invalidate,
    });
    expect(result.action).toBe("bound");
    expect(invalidate).not.toHaveBeenCalled();
    expect(getSessionWorkspaceFingerprint("agent:main:sess")).toBe("abc123def4567890");
    expect(dcsObservability.snapshot().workspaceScopeBound).toBe(1);
    expect(dcsObservability.snapshot().workspaceScopeInvalidated).toBe(0);
  });

  it("unchanged fingerprint does not re-bind or invalidate", async () => {
    const invalidate = vi.fn(async () => undefined);
    await bindSessionWorkspaceFingerprint({
      sessionKey: "agent:main:sess",
      sessionId: "sess",
      fingerprint: "abc123def4567890",
      invalidate,
    });
    const second = await bindSessionWorkspaceFingerprint({
      sessionKey: "agent:main:sess",
      sessionId: "sess",
      fingerprint: "abc123def4567890",
      invalidate,
    });
    expect(second.action).toBe("unchanged");
    expect(invalidate).not.toHaveBeenCalled();
    expect(dcsObservability.snapshot().workspaceScopeBound).toBe(1);
    expect(dcsObservability.snapshot().workspaceScopeInvalidated).toBe(0);
  });

  it("mismatch invalidates working-memory block and counts workspace_scope_invalidated", async () => {
    const invalidate = vi.fn(async () => undefined);
    await bindSessionWorkspaceFingerprint({
      sessionKey: "agent:main:sess",
      sessionId: "sess",
      fingerprint: "aaaaaaaaaaaaaaaa",
      invalidate,
    });
    const result = await bindSessionWorkspaceFingerprint({
      sessionKey: "agent:main:sess",
      sessionId: "sess",
      fingerprint: "bbbbbbbbbbbbbbbb",
      invalidate,
    });
    expect(result.action).toBe("invalidated");
    expect(result.workingMemoryBlockId).toBe("working-memory:sess");
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith("working-memory:sess");
    expect(getSessionWorkspaceFingerprint("agent:main:sess")).toBe("bbbbbbbbbbbbbbbb");
    expect(dcsObservability.snapshot().workspaceScopeInvalidated).toBe(1);
    expect(dcsObservability.snapshot().workspaceScopeBound).toBe(2);
  });

  it("runs invalidate through S1-B enqueue when provided", async () => {
    const order: string[] = [];
    const invalidate = vi.fn(async () => {
      order.push("invalidate");
    });
    const enqueue = async <T>(op: () => Promise<T>): Promise<T> => {
      order.push("enqueue");
      return op();
    };
    await bindSessionWorkspaceFingerprint({
      sessionKey: "agent:main:sess",
      sessionId: "sess",
      fingerprint: "aaaaaaaaaaaaaaaa",
      invalidate,
    });
    await bindSessionWorkspaceFingerprint({
      sessionKey: "agent:main:sess",
      sessionId: "sess",
      fingerprint: "bbbbbbbbbbbbbbbb",
      invalidate,
      enqueue,
    });
    expect(order).toEqual(["enqueue", "invalidate"]);
  });

  it("missing fingerprint skips binding (agent-config fallback path)", async () => {
    const invalidate = vi.fn(async () => undefined);
    const result = await bindSessionWorkspaceFingerprint({
      sessionKey: "agent:main:sess",
      sessionId: "sess",
      fingerprint: "",
      invalidate,
    });
    expect(result.action).toBe("skipped_no_fingerprint");
    expect(invalidate).not.toHaveBeenCalled();
    expect(getSessionWorkspaceFingerprint("agent:main:sess")).toBeUndefined();
  });
});
