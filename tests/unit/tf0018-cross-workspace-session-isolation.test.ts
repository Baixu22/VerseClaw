// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRoleMemoryContextProvider } from "../../openclaw_runtime/src/context-engine/role-memory-context-provider";
import {
  clearMemoryCards,
  proposeMemoryCard,
  simulateMemoryInjection,
  setMemoryStorePath,
} from "../../openclaw_runtime/src/memory/memory-store";

describe("TF-0018 workspace and session isolation", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tf0018-scope-isolation-"));
    setMemoryStorePath(join(tempDir, "role-memory.sqlite"));
    clearMemoryCards();
  });

  afterEach(() => {
    clearMemoryCards();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("injects only cards whose workspace and session keys match the turn", async () => {
    const cards = [
      { scope: "workspace" as const, scopeKey: "workspace-a", content: "Workspace A uses release lane alpha." },
      { scope: "workspace" as const, scopeKey: "workspace-b", content: "Workspace B uses release lane beta." },
      { scope: "session" as const, scopeKey: "session-a", content: "Session A approved migration step one." },
      { scope: "session" as const, scopeKey: "session-b", content: "Session B approved migration step two." },
    ];
    for (const card of cards) {
      const decision = proposeMemoryCard({
        type: "constraint",
        ...card,
        roleTags: ["operator"],
        confidence: 0.95,
        importance: 0.6,
        source: "user",
        evidenceRefs: [{ type: "manual", ref: `review:${card.scopeKey}` }],
      });
      expect(decision.accepted).toBe(true);
    }

    const provider = createRoleMemoryContextProvider({ resolveRoleName: () => "operator" });
    const resultA = await provider.getContext({
      goal: "Operate workspace A",
      workspace: "workspace-a",
      tokenBudget: 2048,
      metadata: { sessionKey: "session-a" },
    });
    const resultB = await provider.getContext({
      goal: "Operate workspace B",
      workspace: "workspace-b",
      tokenBudget: 2048,
      metadata: { sessionKey: "session-b" },
    });
    const injectedA = resultA.contextItems.map((item) => item.text).join("\n");
    const injectedB = resultB.contextItems.map((item) => item.text).join("\n");

    expect(resultA.metadata?.cardCount).toBe(2);
    expect(injectedA).toContain("Workspace A uses release lane alpha");
    expect(injectedA).toContain("Session A approved migration step one");
    expect(injectedA).not.toContain("Workspace B uses release lane beta");
    expect(injectedA).not.toContain("Session B approved migration step two");

    expect(resultB.metadata?.cardCount).toBe(2);
    expect(injectedB).toContain("Workspace B uses release lane beta");
    expect(injectedB).toContain("Session B approved migration step two");
    expect(injectedB).not.toContain("Workspace A uses release lane alpha");
    expect(injectedB).not.toContain("Session A approved migration step one");
  });

  it("does not create conflicts across different workspace or session keys", () => {
    const workspaceEnabled = proposeMemoryCard({
      type: "fact",
      scope: "workspace",
      scopeKey: "workspace-a",
      roleTags: ["operator"],
      content: "Feature X is enabled.",
      confidence: 0.95,
      importance: 0.6,
      source: "user",
      evidenceRefs: [{ type: "manual", ref: "review:workspace-a" }],
    });
    const workspaceDisabled = proposeMemoryCard({
      type: "fact",
      scope: "workspace",
      scopeKey: "workspace-b",
      roleTags: ["operator"],
      content: "Feature X is not enabled.",
      confidence: 0.95,
      importance: 0.6,
      source: "user",
      evidenceRefs: [{ type: "manual", ref: "review:workspace-b" }],
    });
    const sessionOwner = proposeMemoryCard({
      type: "constraint",
      scope: "session",
      scopeKey: "session-a",
      roleTags: ["operator"],
      content: "Use the approved deployment lane.",
      confidence: 0.95,
      importance: 0.6,
      source: "user",
      evidenceRefs: [{ type: "manual", ref: "review:session-a" }],
    });
    const sessionOtherRole = proposeMemoryCard({
      type: "constraint",
      scope: "session",
      scopeKey: "session-b",
      roleTags: ["reviewer"],
      content: "Use the approved deployment lane.",
      confidence: 0.95,
      importance: 0.6,
      source: "user",
      evidenceRefs: [{ type: "manual", ref: "review:session-b" }],
    });

    expect(workspaceEnabled.accepted).toBe(true);
    expect(workspaceDisabled.accepted).toBe(true);
    expect(sessionOwner.accepted).toBe(true);
    expect(sessionOtherRole.accepted).toBe(true);
  });

  it("keeps the diagnostic injection simulation fail-closed without scope", () => {
    const scoped = proposeMemoryCard({
      type: "constraint",
      scope: "workspace",
      scopeKey: "workspace-a",
      roleTags: ["operator"],
      content: "Simulation must stay inside workspace A.",
      confidence: 0.95,
      importance: 0.6,
      source: "user",
      evidenceRefs: [{ type: "manual", ref: "review:simulation-a" }],
    });
    expect(scoped.accepted).toBe(true);

    const withoutScope = simulateMemoryInjection({
      roleName: "operator",
      task: "preview",
      dualGate: { useEnabled: true },
    });
    expect(withoutScope.selectedCards).toHaveLength(0);

    const withScope = simulateMemoryInjection({
      roleName: "operator",
      task: "preview",
      dualGate: { useEnabled: true },
      scope: { workspace: "workspace-a" },
    });
    expect(withScope.selectedCards.map((card) => card.id)).toContain(scoped.card!.id);
  });
});
