import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearMemoryCards,
  proposeMemoryCard,
  setMemoryStorePath,
} from "../../openclaw_runtime/src/memory/memory-store";
import {
  createRoleMemoryContextProvider,
  ROLE_MEMORY_CONTEXT_PROVIDER_ID,
} from "../../openclaw_runtime/src/context-engine/role-memory-context-provider";
import {
  isRuntimeContextProviderManifest,
  isRuntimeContextProviderResult,
} from "../../openclaw_runtime/src/runtime-core";

const enabledConfig = {
  runtime: {
    memory: {
      provider: true,
    },
  },
};

describe("role memory context provider", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "clawx-role-memory-provider-"));
    setMemoryStorePath(join(tempDir, "role-memory.sqlite"));
    clearMemoryCards();
  });

  afterEach(() => {
    clearMemoryCards();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("exposes a valid manifest with correct metadata", () => {
    const provider = createRoleMemoryContextProvider({
      resolveRoleName: () => "main",
    });
    expect(isRuntimeContextProviderManifest(provider.manifest)).toBe(true);
    expect(provider.manifest).toMatchObject({
      id: ROLE_MEMORY_CONTEXT_PROVIDER_ID,
      kind: "context",
      enabledByDefault: false,
      shadowOnly: false,
      capabilities: ["context.memory", "context.role-memory"],
      outputKinds: ["memory", "evidence"],
      dependsOnIndexing: false,
    });
  });

  it("returns fallback when role name cannot be resolved", async () => {
    const provider = createRoleMemoryContextProvider({
      resolveRoleName: () => undefined,
    });
    const result = await provider.getContext({
      goal: "test query",
      tokenBudget: 256,
    });
    expect(isRuntimeContextProviderResult(result)).toBe(true);
    expect(result.status).toBe("fallback");
    expect(result.contextItems).toHaveLength(0);
    expect(result.diagnostics[0].reason).toBe("no_result");
  });

  it("returns fallback when no injectable cards exist for the role", async () => {
    const provider = createRoleMemoryContextProvider({
      resolveRoleName: () => "architect",
    });
    const result = await provider.getContext({
      goal: "test query",
      tokenBudget: 256,
    });
    expect(result.status).toBe("fallback");
    expect(result.contextItems).toHaveLength(0);
    expect(result.diagnostics[0].reason).toBe("no_result");
  });

  it("injects role memory cards as context items when cards exist", async () => {
    proposeMemoryCard({
      type: "constraint",
      scope: "role",
      roleTags: ["architect"],
      content: "Architects must review schema changes before applying them.",
      confidence: 0.9,
      importance: 0.8,
      source: "user",
      evidenceRefs: [{ type: "manual", ref: "test" }],
    });
    proposeMemoryCard({
      type: "project_fact",
      scope: "project",
      roleTags: ["architect"],
      content: "The project uses PostgreSQL with JSONB columns.",
      confidence: 0.85,
      importance: 0.7,
      source: "user",
      evidenceRefs: [{ type: "manual", ref: "test" }],
    });

    const provider = createRoleMemoryContextProvider({
      resolveRoleName: () => "architect",
    });
    const result = await provider.getContext({
      goal: "How should I handle schema changes?",
      tokenBudget: 512,
    });

    expect(result.status).toBe("success");
    expect(result.contextItems.length).toBeGreaterThan(0);
    expect(result.contextItems.every((item) => item.kind === "memory")).toBe(true);
    expect(result.diagnostics[0].status).toBe("ok");
    expect(result.diagnostics[0].reason).toBe("registered");
    expect(result.metadata?.roleName).toBe("architect");
    expect(result.metadata?.cardCount).toBe(2);
  });

  it("adapts context pack buckets to distinct context items", async () => {
    proposeMemoryCard({
      type: "constraint",
      scope: "role",
      roleTags: ["architect"],
      content: "Hard constraint: never drop tables in production.",
      confidence: 0.95,
      importance: 0.9,
      source: "user",
      evidenceRefs: [{ type: "manual", ref: "test" }],
    });
    proposeMemoryCard({
      type: "procedural",
      scope: "role",
      roleTags: ["architect"],
      content: "Run migrations with --dry-run first.",
      confidence: 0.8,
      importance: 0.6,
      source: "user",
      evidenceRefs: [{ type: "manual", ref: "test" }],
    });

    const provider = createRoleMemoryContextProvider({
      resolveRoleName: () => "architect",
    });
    const result = await provider.getContext({
      goal: "schema migration",
      tokenBudget: 512,
    });

    expect(result.status).toBe("success");
    const bucketNames = result.contextItems.map((item) => item.metadata?.bucket);
    expect(bucketNames).toContain("hardConstraints");
  });

  it("does not throw when resolveRoleName throws — returns fallback", async () => {
    const provider = createRoleMemoryContextProvider({
      resolveRoleName: () => {
        throw new Error("resolver crashed");
      },
    });
    const result = await provider.getContext({
      goal: "test",
      tokenBudget: 256,
    });
    expect(result.status).toBe("fallback");
    expect(result.diagnostics[0].reason).toBe("no_result");
  });

  it("respects token budget from query when provided", async () => {
    proposeMemoryCard({
      type: "project_fact",
      scope: "project",
      roleTags: ["architect"],
      content: "Fact that should be budgeted.",
      confidence: 0.8,
      importance: 0.5,
      source: "user",
      evidenceRefs: [{ type: "manual", ref: "test" }],
    });

    const provider = createRoleMemoryContextProvider({
      resolveRoleName: () => "architect",
      defaultTokenBudget: 1024,
    });
    const result = await provider.getContext({
      goal: "test",
      tokenBudget: 64,
    });

    expect(result.status).toBe("success");
    expect(result.metadata?.budgetTotal).toBe(64);
  });

  it("uses default token budget when query does not provide one", async () => {
    proposeMemoryCard({
      type: "project_fact",
      scope: "project",
      roleTags: ["architect"],
      content: "Fact for default budget test.",
      confidence: 0.8,
      importance: 0.5,
      source: "user",
      evidenceRefs: [{ type: "manual", ref: "test" }],
    });

    const provider = createRoleMemoryContextProvider({
      resolveRoleName: () => "architect",
      defaultTokenBudget: 333,
    });
    const result = await provider.getContext({
      goal: "test",
    });

    expect(result.status).toBe("success");
    expect(result.metadata?.budgetTotal).toBe(333);
  });

  it("ignores the runtime memory config — role memory is gated by its own env flag", async () => {
    proposeMemoryCard({
      type: "project_fact",
      scope: "project",
      roleTags: ["architect"],
      content: "Fact that should surface regardless of runtime.memory.provider flag.",
      confidence: 0.8,
      importance: 0.5,
      source: "user",
      evidenceRefs: [{ type: "manual", ref: "test" }],
    });

    const provider = createRoleMemoryContextProvider({
      resolveRoleName: () => "architect",
    });
    // Even with runtime.memory.provider: false (runtime memory disabled),
    // role memory should still inject because it is gated by OPENCLAW_ROLE_MEMORY_ENABLED.
    const result = await provider.getContext({
      goal: "test",
      metadata: enabledConfig,
    });

    expect(result.status).toBe("success");
    expect(result.contextItems.length).toBeGreaterThan(0);
  });
});
