import { describe, expect, it } from "vitest";
import {
  resolveMemoryIndexIdentityState,
  shouldAttemptMissingMemoryIndexRecovery,
} from "./manager-reindex-state.js";

const baseParams = {
  provider: { id: "openai", model: "text-embedding-3-small" },
  providerKey: "provider-key",
  providerKeyKnown: true,
  configuredSources: ["memory"] as const,
  configuredScopeHash: "scope",
  chunkTokens: 400,
  chunkOverlap: 80,
  vectorReady: false,
  hasIndexedChunks: true,
  ftsTokenizer: "unicode61",
};

describe("memory index identity recovery", () => {
  it("attempts recovery when metadata is missing but indexed chunks remain", () => {
    const identity = resolveMemoryIndexIdentityState({ ...baseParams, meta: null });

    expect(shouldAttemptMissingMemoryIndexRecovery({ identity, hasIndexedChunks: true })).toBe(
      true,
    );
  });

  it("does not auto-rebuild a mismatched index", () => {
    const identity = resolveMemoryIndexIdentityState({
      ...baseParams,
      meta: {
        model: "different-model",
        provider: "openai",
        scopeHash: "scope",
        chunkTokens: 400,
        chunkOverlap: 80,
      },
    });

    expect(identity.status).toBe("mismatched");
    expect(shouldAttemptMissingMemoryIndexRecovery({ identity, hasIndexedChunks: true })).toBe(
      false,
    );
  });
});
