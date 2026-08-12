/**
 * Regression tests for subagent label-collision handling (issue #30).
 *
 * Parallel subagent workers share role labels (orchestrator.run spawns
 * planner/reviewer/skeptic), so a label that is already in use must be
 * auto-disambiguated with a numeric suffix instead of hard-failing the patch.
 * User-facing main sessions keep the strict uniqueness rejection.
 */
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { SessionEntry } from "../config/sessions.js";
import { applySessionsPatchToStore } from "./sessions-patch.js";

function makeEntry(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    sessionId: `session-${Math.random().toString(36).slice(2)}`,
    updatedAt: 1_000,
    ...overrides,
  };
}

const EMPTY_CFG = {} as OpenClawConfig;

describe("sessions-patch label collision handling (issue #30)", () => {
  it("auto-suffixes a colliding label for subagent sessions instead of rejecting", async () => {
    const store: Record<string, SessionEntry> = {
      "agent:main:subagent:worker-1": makeEntry({ label: "Reviewer" }),
    };

    const result = await applySessionsPatchToStore({
      cfg: EMPTY_CFG,
      store,
      storeKey: "agent:main:subagent:worker-2",
      agentId: "main",
      patch: { key: "agent:main:subagent:worker-2", label: "Reviewer" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.entry.label).toBe("Reviewer-2");
  });

  it("increments the suffix past every existing variant", async () => {
    const store: Record<string, SessionEntry> = {
      "agent:main:subagent:worker-1": makeEntry({ label: "Reviewer" }),
      "agent:main:subagent:worker-2": makeEntry({ label: "Reviewer-2" }),
    };

    const result = await applySessionsPatchToStore({
      cfg: EMPTY_CFG,
      store,
      storeKey: "agent:main:subagent:worker-3",
      agentId: "main",
      patch: { key: "agent:main:subagent:worker-3", label: "Reviewer" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.entry.label).toBe("Reviewer-3");
  });

  it("keeps the requested label when it is already free", async () => {
    const store: Record<string, SessionEntry> = {
      "agent:main:subagent:worker-1": makeEntry({ label: "Reviewer" }),
    };

    const result = await applySessionsPatchToStore({
      cfg: EMPTY_CFG,
      store,
      storeKey: "agent:main:subagent:worker-2",
      agentId: "main",
      patch: { key: "agent:main:subagent:worker-2", label: "Planner" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.entry.label).toBe("Planner");
  });

  it("re-patching a subagent session's own label keeps the resolved value", async () => {
    const store: Record<string, SessionEntry> = {
      "agent:main:subagent:worker-1": makeEntry({ label: "Reviewer" }),
      "agent:main:subagent:worker-2": makeEntry({ label: "Reviewer-2" }),
    };

    const first = await applySessionsPatchToStore({
      cfg: EMPTY_CFG,
      store,
      storeKey: "agent:main:subagent:worker-3",
      agentId: "main",
      patch: { key: "agent:main:subagent:worker-3", label: "Reviewer" },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }

    const second = await applySessionsPatchToStore({
      cfg: EMPTY_CFG,
      store: { ...store, "agent:main:subagent:worker-3": first.entry },
      storeKey: "agent:main:subagent:worker-3",
      agentId: "main",
      patch: { key: "agent:main:subagent:worker-3", label: "Reviewer" },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.entry.label).toBe("Reviewer-3");
  });

  it("still rejects duplicate labels on user-facing main sessions", async () => {
    const store: Record<string, SessionEntry> = {
      "agent:main:main": makeEntry({ label: "MySession" }),
    };

    const result = await applySessionsPatchToStore({
      cfg: EMPTY_CFG,
      store,
      storeKey: "agent:main:webchat:abc-123",
      agentId: "main",
      patch: { key: "agent:main:webchat:abc-123", label: "MySession" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("INVALID_REQUEST");
    expect(result.error.message).toContain("label already in use: MySession");
  });
});
