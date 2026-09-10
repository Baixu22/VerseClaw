import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { OPENCLAW_STATE_SCHEMA_SQL } from "../../state/openclaw-state-schema.generated.js";
import type { ContextBlock } from "../block.js";
import { BlockStore } from "../block-store.js";
import { hydrateLifecycleBlock } from "../block-lifecycle.js";
import {
  filterToolRegistryContentByCategory,
  readContext,
} from "./context-read-tool.js";

const databases: DatabaseSync[] = [];
const BASE_TIME = new Date("2026-07-12T00:00:00.000Z");

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
});

function createStore() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(OPENCLAW_STATE_SCHEMA_SQL);
  return {
    db,
    store: new BlockStore(db, {
      now: () => new Date(BASE_TIME),
    }),
  };
}

function makeBlock(
  block_id: string,
  block_type: ContextBlock["block_type"],
  overrides: Partial<ContextBlock> = {},
): ContextBlock {
  return {
    block_id,
    block_type,
    source_system: "task-loop",
    session_id: "session-a",
    presence: { always_on: false, background: true },
    entities: [],
    valid_at: BASE_TIME,
    mutability: "system_managed",
    summary: block_id,
    full_content: `content-for-${block_id}`,
    compression_depth: 0,
    entity_extraction_status: "empty",
    ...overrides,
  };
}

describe("DCS Stage 5 context-read-tool", () => {
  it("reads task_state for the requester session", async () => {
    const { store } = createStore();
    await store.upsert(
      makeBlock("task-state:session-a", "task_state", {
        full_content: JSON.stringify({
          objective: "ship w2",
          current_phase: "running",
          recent_actions: [],
          parent_session_id: "session-a",
        }),
      }),
      { write_origin: "handler", significance: "high" },
    );

    const result = await readContext({
      block_type: "task_state",
      sessionId: "session-a",
      blockStore: store,
    });

    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(result.contents[0]).toContain("ship w2");
  });

  it("reads tool_registry and filters by category", async () => {
    const { store } = createStore();
    const full = JSON.stringify({
      entries: [
        {
          resourceId: "read",
          kind: "fs",
          title: "read",
          purpose: "read files",
          category: "Files",
        },
        {
          resourceId: "web_search",
          kind: "web",
          title: "web_search",
          purpose: "search",
          category: "Web",
        },
      ],
    });
    await store.upsert(
      makeBlock("tool-registry:session-a", "tool_registry", {
        source_system: "cvk",
        full_content: full,
        presence: {
          always_on: true,
          on_demand: { expand_tool: "context_read", auto_register: true },
        },
      }),
      { write_origin: "handler", significance: "high" },
    );

    const result = await readContext({
      block_type: "tool_registry",
      category: "Files",
      sessionId: "session-a",
      blockStore: store,
    });

    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(result.contents[0]).toContain("read");
    expect(result.contents[0]).not.toContain("web_search");
  });

  it("rejects cross-session read without parent handoff authorization", async () => {
    const { store } = createStore();
    await store.upsert(
      makeBlock("task-state:parent", "task_state", {
        session_id: "parent",
        full_content: JSON.stringify({
          objective: "secret",
          current_phase: "running",
          recent_actions: [],
          parent_session_id: "parent",
        }),
      }),
      { write_origin: "handler", significance: "high" },
    );

    const result = await readContext({
      block_type: "task_state",
      sessionId: "child-unrelated",
      targetSessionId: "parent",
      blockStore: store,
    });

    expect(result.ok).toBe(true);
    expect(result.count).toBe(0);
    expect((await store.stats()).authorization_rejections).toBeGreaterThan(0);
  });

  it("allows direct-parent session read when child handoff names parent", async () => {
    const { store } = createStore();
    await store.upsert(
      makeBlock("task-state:parent", "task_state", {
        session_id: "parent",
        full_content: JSON.stringify({
          objective: "parent objective",
          current_phase: "running",
          recent_actions: [],
          parent_session_id: "parent",
        }),
      }),
      { write_origin: "handler", significance: "high" },
    );
    await store.upsert(
      makeBlock("task-state:child", "task_state", {
        session_id: "child",
        full_content: JSON.stringify({
          objective: "child objective",
          current_phase: "running",
          recent_actions: [],
          parent_session_id: "parent",
        }),
      }),
      { write_origin: "handler", significance: "high" },
    );

    const result = await readContext({
      block_type: "task_state",
      sessionId: "child",
      targetSessionId: "parent",
      blockStore: store,
    });

    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(result.contents[0]).toContain("parent objective");
  });

  it("filterToolRegistryContentByCategory is case-insensitive on category", () => {
    const full = JSON.stringify({
      entries: [{ resourceId: "a", kind: "fs", title: "a", purpose: "p", category: "Files" }],
    });
    const filtered = filterToolRegistryContentByCategory(full, "files");
    expect(filtered).toContain('"resourceId":"a"');
  });


  it("excludes archived blocks by default and returns them with includeArchived", async () => {
    const { store } = createStore();
    await store.upsert(
      makeBlock("wm:active", "working_memory", {
        source_system: "working-memory",
        full_content: "active-note",
        presence: { always_on: false, background: true },
      }),
      { write_origin: "handler", significance: "high" },
    );
    await store.upsert(
      makeBlock("wm:archived", "working_memory", {
        source_system: "working-memory",
        full_content: "archived-note",
        presence: {
          always_on: false,
          background: true,
          lifecycle_state: "archived",
          archived_at: BASE_TIME.toISOString(),
          heat: 2,
        },
      }),
      { write_origin: "handler", significance: "high" },
    );

    const activeOnly = await readContext({
      block_type: "working_memory",
      sessionId: "session-a",
      blockStore: store,
      limit: 10,
    });
    expect(activeOnly.ok).toBe(true);
    expect(activeOnly.contents).toEqual(["active-note"]);

    const withArchived = await readContext({
      block_type: "working_memory",
      sessionId: "session-a",
      blockStore: store,
      limit: 10,
      includeArchived: true,
    });
    expect(withArchived.ok).toBe(true);
    expect(withArchived.contents.sort()).toEqual(["active-note", "archived-note"].sort());

    const afterRecall = await readContext({
      block_type: "working_memory",
      sessionId: "session-a",
      blockStore: store,
      limit: 10,
    });
    expect(afterRecall.contents.sort()).toEqual(["active-note", "archived-note"].sort());
    const persisted = (await store.query({
      requester_session_id: "session-a",
      session_id: "session-a",
      block_types: ["working_memory"],
      limit: 10,
    })).find((block) => block.block_id === "wm:archived");
    const recalled = hydrateLifecycleBlock(persisted!);
    expect(recalled.lifecycle_state).toBe("active");
    expect(recalled.archived_at).toBeUndefined();
    expect(recalled.heat).toBe(3);
  });

  it("fails closed when archived recall persistence is unavailable", async () => {
    const result = await readContext({
      block_type: "working_memory",
      sessionId: "session-a",
      blockStore: {
        query: async () => [
          makeBlock("wm:archived", "working_memory", {
            presence: {
              always_on: false,
              lifecycle_state: "archived",
              archived_at: BASE_TIME.toISOString(),
            },
          }),
        ],
      },
      includeArchived: true,
    });
    expect(result).toMatchObject({
      ok: false,
      count: 0,
      reason: "archived recall unsupported by block store",
    });
  });

  it("fails closed when archived recall throws", async () => {
    const result = await readContext({
      block_type: "working_memory",
      sessionId: "session-a",
      blockStore: {
        query: async () => [
          makeBlock("wm:archived", "working_memory", {
            presence: {
              always_on: false,
              lifecycle_state: "archived",
              archived_at: BASE_TIME.toISOString(),
            },
          }),
        ],
        recallArchivedBlocks: async () => {
          throw new Error("storage unavailable");
        },
      },
      includeArchived: true,
    });
    expect(result).toMatchObject({
      ok: false,
      count: 0,
      reason: "archived recall failed",
    });
  });

  it("fails closed when archived recall omits a requested block", async () => {
    const result = await readContext({
      block_type: "working_memory",
      sessionId: "session-a",
      blockStore: {
        query: async () => [
          makeBlock("wm:archived", "working_memory", {
            presence: {
              always_on: false,
              lifecycle_state: "archived",
              archived_at: BASE_TIME.toISOString(),
            },
          }),
        ],
        recallArchivedBlocks: async () => [],
      },
      includeArchived: true,
    });
    expect(result).toMatchObject({
      ok: false,
      count: 0,
      reason: "archived recall incomplete",
    });
  });

  it("does not recall an unauthorized archived parent block", async () => {
    const { store } = createStore();
    await store.upsert(
      makeBlock("wm:parent-archived", "working_memory", {
        session_id: "parent",
        source_system: "working-memory",
        presence: {
          always_on: false,
          lifecycle_state: "archived",
          archived_at: BASE_TIME.toISOString(),
          heat: 2,
        },
      }),
      { write_origin: "handler", significance: "high" },
    );

    const result = await readContext({
      block_type: "working_memory",
      sessionId: "unrelated-child",
      targetSessionId: "parent",
      blockStore: store,
      includeArchived: true,
    });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(0);
    expect((await store.stats()).authorization_rejections).toBeGreaterThan(0);
    const persisted = (await store.query({
      requester_session_id: "parent",
      session_id: "parent",
      block_types: ["working_memory"],
    }))[0];
    expect(hydrateLifecycleBlock(persisted!).lifecycle_state).toBe("archived");
    expect(hydrateLifecycleBlock(persisted!).heat).toBe(2);
  });

  it("returns empty contents when no blocks match", async () => {
    const { store } = createStore();
    const result = await readContext({
      block_type: "notes",
      sessionId: "session-a",
      blockStore: store,
    });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(0);
    expect(result.contents).toEqual([]);
  });
});
