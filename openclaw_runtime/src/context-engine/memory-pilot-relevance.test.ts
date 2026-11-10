import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildContextPack } from "../memory/context-pack.js";
import type { MemoryCard } from "../memory/types.js";
import { resetContextCandidateCollectionsForTests } from "./context-candidate.js";
import {
  computeContextExtraSystemPrompt,
  finalizeContextOrchestratorTurn,
  resetContextOrchestratorLineageForTests,
} from "./context-orchestrator.js";
import {
  createMemoryContextProviders,
  defaultMainSessionRoleResolver,
} from "./register-memory-providers.js";
import { resetTurnInjectionBudgetsForTests } from "./turn-injection-budget.js";

const store = vi.hoisted(() => ({
  ensureMemoryCardsLoaded: vi.fn(),
  getMemoryCards: vi.fn<() => MemoryCard[]>(),
  isMemoryStoreConfigured: vi.fn(() => true),
  isRoleMemoryEnabled: vi.fn(() => true),
  listMemoryConflicts: vi.fn(() => []),
  recordMemoryInjection: vi.fn(),
}));

vi.mock("../memory/memory-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../memory/memory-store.js")>()),
  ...store,
}));

function acceptedCard(): MemoryCard {
  return {
    id: "accepted-workspace-fact",
    type: "fact",
    scope: "workspace",
    scopeKey: "/memory-workspace",
    roleTags: ["main"],
    applicableRoles: ["main"],
    content: "Accepted Archivist launch fact: use the violet release tag.",
    evidence: [],
    confidence: 0.6,
    importance: 0.9,
    status: "active",
    sensitivity: "normal",
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    accessCount: 0,
    version: 1,
  };
}

function resetContext() {
  resetContextOrchestratorLineageForTests();
  resetContextCandidateCollectionsForTests();
  resetTurnInjectionBudgetsForTests();
}

describe("role-memory pilot query relevance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH", "0");
    vi.stubEnv("VERSE_VTOKEN_ASSEMBLY_ENABLED", "0");
    resetContext();
  });
  afterEach(() => {
    resetContext();
    vi.unstubAllEnvs();
  });

  it.each([
    { taskHint: "Recall the accepted Archivist launch fact", selected: true },
    { taskHint: "Investigate ocean salinity measurements", selected: false },
  ])(
    "selects relevant facts without echoing the query: $selected",
    async ({ taskHint, selected }) => {
      const card = acceptedCard();
      store.getMemoryCards.mockReturnValue([
        card,
        { ...card, id: "revoked", status: "tombstone", content: "REVOKED-MEMORY" },
        {
          ...card,
          id: "foreign",
          scope: "session",
          scopeKey: "other-session",
          content: "FOREIGN-MEMORY",
        },
      ]);
      const turnId = `memory-query-${selected}`;
      await computeContextExtraSystemPrompt(
        "base",
        {
          runtime: {
            memory: { injectPilot: { enabled: true, providers: ["role-memory"], sessions: "all" } },
          },
        },
        {
          turnId,
          sessionKey: "agent:main:session-memory",
          workspaceDir: card.scopeKey!,
          taskHint,
          memoryProviderFactory: () =>
            createMemoryContextProviders({
              roleMemory: { resolveRoleName: defaultMainSessionRoleResolver },
            }),
          deferProjection: true,
        },
        { stages: ["memory"] },
      );
      const { projection } = finalizeContextOrchestratorTurn({ turnId, messages: [], seal: false });
      const prompt = projection.systemPromptAddition ?? "";
      expect(prompt.includes(card.content)).toBe(selected);
      expect(prompt).not.toContain(taskHint);
      expect(prompt).not.toContain("REVOKED-MEMORY");
      expect(prompt).not.toContain("FOREIGN-MEMORY");
      if (!selected) expect(prompt).toBe("");
      expect(store.recordMemoryInjection).toHaveBeenCalledTimes(selected ? 1 : 0);
      if (selected)
        expect(store.recordMemoryInjection.mock.calls[0]?.[0]).toMatchObject({
          cards: [{ id: card.id }],
        });
    },
  );

  it("keeps explicitly supplied task state in the existing context-pack output", () => {
    const taskState = "Recall the accepted Archivist launch fact";
    const pack = buildContextPack({ memories: [acceptedCard()], roleName: "main", taskState });
    expect(pack.buckets.projectFacts).toContain(acceptedCard().content);
    expect(pack.buckets.taskState).toEqual([taskState]);
  });
});
