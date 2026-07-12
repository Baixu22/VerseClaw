import { describe, expect, it, vi } from "vitest";
import type {
  BlockEntityQuery,
  BlockQuery,
  BlockStoreApi,
  BlockStoreStats,
  BlockWriteResult,
  ContextBlock,
} from "../block.js";
import {
  extractEntities,
  searchContext,
} from "./context-search-tool.js";

function makeBlock(overrides: Partial<ContextBlock> = {}): ContextBlock {
  return {
    block_id: "block-001",
    block_type: "experience",
    source_system: "sekb",
    session_id: "session-a",
    presence: {
      always_on: false,
      on_demand: { expand_tool: "context_search", auto_register: false },
      background: true,
    },
    entities: ["postgresql"],
    valid_at: new Date("2026-07-12T00:00:00.000Z"),
    mutability: "system_managed",
    summary: "## Experience\nCheck PG access",
    full_content: "When connecting to PostgreSQL, verify config first",
    compression_depth: 0,
    entity_extraction_status: "empty",
    ...overrides,
  };
}

function makeBlockStore(
  overrides: {
    query?: (params: BlockQuery) => Promise<ContextBlock[]>;
    queryByEntity?: (params: BlockEntityQuery) => Promise<ContextBlock[]>;
  } = {},
): BlockStoreApi {
  const defaultStats: BlockStoreStats = {
    total_blocks: 0,
    valid_blocks: 0,
    entity_extraction_status: { pending: 0, failed: 0, empty: 0, success: 0 },
    admission_rejections: 0,
    authorization_rejections: 0,
  };
  return {
    upsert: vi.fn(async (): Promise<BlockWriteResult> => ({ accepted: true })),
    query: overrides.query ?? vi.fn(async (): Promise<ContextBlock[]> => []),
    queryByEntity: overrides.queryByEntity ??
      vi.fn(async (): Promise<ContextBlock[]> => []),
    invalidate: vi.fn(async () => {}),
    stats: vi.fn(async () => defaultStats),
  };
}

describe("DCS Stage 5 context-search-tool", () => {
  describe("extractEntities", () => {
    it("returns empty array for empty query", () => {
      expect(extractEntities("")).toEqual([]);
    });

    it("returns empty array for whitespace-only query", () => {
      expect(extractEntities("   ")).toEqual([]);
    });

    it("extracts lowercased tokens filtering stop words", () => {
      const entities = extractEntities("How to connect PostgreSQL database");
      expect(entities).toContain("postgresql");
      expect(entities).toContain("database");
      expect(entities).toContain("connect");
      expect(entities).not.toContain("how");
      expect(entities).not.toContain("to");
    });

    it("handles special case: query='principles' returns empty entities (block_types filter instead)", () => {
      const entities = extractEntities("principles");
      expect(entities).toEqual([]);
    });
  });

  describe("searchContext", () => {
    it("uses queryByEntity (SAG mode) when entities are extracted", async () => {
      const queryByEntity = vi.fn(async (): Promise<ContextBlock[]> => [makeBlock()]);
      const query = vi.fn(async (): Promise<ContextBlock[]> => []);
      const store = makeBlockStore({ query, queryByEntity });

      const results = await searchContext({
        query: "PostgreSQL connection",
        sessionId: "session-a",
        blockStore: store,
      });

      expect(queryByEntity).toHaveBeenCalledTimes(1);
      expect(query).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0].block_type).toBe("experience");
    });

    it("uses query (fallback mode) when no entities extracted", async () => {
      const query = vi.fn(async (): Promise<ContextBlock[]> => [makeBlock()]);
      const queryByEntity = vi.fn(async (): Promise<ContextBlock[]> => []);
      const store = makeBlockStore({ query, queryByEntity });

      const results = await searchContext({
        query: "   ",
        sessionId: "session-a",
        blockStore: store,
      });

      expect(query).toHaveBeenCalledTimes(1);
      expect(queryByEntity).not.toHaveBeenCalled();
      expect(results[0].fallback_mode).toBe("vector_only");
    });

    it("query='principles' filters for experience block_types", async () => {
      const query = vi.fn(async (_params: BlockQuery): Promise<ContextBlock[]> => [
        makeBlock({ block_type: "experience" }),
      ]);
      const queryByEntity = vi.fn(async (_params: BlockEntityQuery): Promise<ContextBlock[]> => []);
      const store = makeBlockStore({ query, queryByEntity });

      const results = await searchContext({
        query: "principles",
        sessionId: "session-a",
        blockStore: store,
      });

      expect(query).toHaveBeenCalledTimes(1);
      const callArg = query.mock.calls[0][0];
      expect(callArg.block_types).toEqual(["experience"]);
      expect(results[0].block_type).toBe("experience");
    });

    it("returns at most top-K (K <= 5)", async () => {
      const blocks = Array.from({ length: 8 }, (_, i) =>
        makeBlock({ block_id: `block-${i}` }),
      );
      const queryByEntity = vi.fn(async (): Promise<ContextBlock[]> => blocks);
      const store = makeBlockStore({ queryByEntity });

      const results = await searchContext({
        query: "PostgreSQL",
        sessionId: "session-a",
        blockStore: store,
      });

      expect(results.length).toBeLessThanOrEqual(5);
    });

    it("respects explicit limit when provided (<= 5)", async () => {
      const blocks = Array.from({ length: 8 }, (_, i) =>
        makeBlock({ block_id: `block-${i}` }),
      );
      const queryByEntity = vi.fn(async (): Promise<ContextBlock[]> => blocks);
      const store = makeBlockStore({ queryByEntity });

      const results = await searchContext({
        query: "PostgreSQL",
        sessionId: "session-a",
        blockStore: store,
        limit: 3,
      });

      expect(results).toHaveLength(3);
    });

    it("clamps limit to 5 maximum", async () => {
      const blocks = Array.from({ length: 10 }, (_, i) =>
        makeBlock({ block_id: `block-${i}` }),
      );
      const queryByEntity = vi.fn(async (): Promise<ContextBlock[]> => blocks);
      const store = makeBlockStore({ queryByEntity });

      const results = await searchContext({
        query: "PostgreSQL",
        sessionId: "session-a",
        blockStore: store,
        limit: 20,
      });

      expect(results).toHaveLength(5);
    });
  });
});
