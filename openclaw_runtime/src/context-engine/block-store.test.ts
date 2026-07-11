import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { OPENCLAW_STATE_SCHEMA_SQL } from "../state/openclaw-state-schema.generated.js";
import type { ContextBlock } from "./block.js";
import { BlockStore } from "./block-store.js";

const databases: DatabaseSync[] = [];
const BASE_TIME = new Date("2026-07-10T00:00:00.000Z");

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
});

describe("DCS BlockStore", () => {
  it("does not create shared-state schema during construction", () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);

    new BlockStore(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all();
    expect(tables).toEqual([]);
  });

  it("创建收敛后的表、治理列和 6 个显式索引", () => {
    const { db } = createStore();

    const columns = db.prepare("PRAGMA table_info(context_blocks)").all() as Array<{
      name: string;
      notnull: number;
    }>;
    expect(columns.map((column) => column.name)).toEqual([
      "block_id",
      "block_type",
      "source_system",
      "session_id",
      "summary",
      "full_content",
      "presence_json",
      "mutability",
      "role_scope",
      "entities_json",
      "entity_extraction_status",
      "compression_depth",
      "fallback_mode",
      "retention_confidence",
      "valid_at",
      "invalid_at",
      "created_at",
    ]);
    expect(columns.find((column) => column.name === "block_id")).toMatchObject({
      notnull: 1,
    });

    const contextIndexes = db.prepare("PRAGMA index_list(context_blocks)").all() as Array<{
      name: string;
    }>;
    const entityIndexes = db.prepare("PRAGMA index_list(block_entity_map)").all() as Array<{
      name: string;
    }>;
    const explicitIndexes = [...contextIndexes, ...entityIndexes]
      .map((index) => index.name)
      .filter((name) => name.startsWith("idx_"))
      .toSorted();
    expect(explicitIndexes).toEqual([
      "idx_block_type_source",
      "idx_block_type_valid",
      "idx_entity",
      "idx_invalid",
      "idx_session",
      "idx_source",
    ]);
  });

  it("rejects null context block ids at the SQLite boundary", () => {
    const { db } = createStore();

    expect(() =>
      db
        .prepare(
          `INSERT INTO context_blocks (
            block_id,
            block_type,
            source_system,
            summary,
            presence_json,
            mutability,
            valid_at,
            created_at
          ) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "task_state",
          "task-loop",
          "null block id",
          '{"always_on":false}',
          "system_managed",
          BASE_TIME.getTime(),
          BASE_TIME.getTime(),
        ),
    ).toThrow(/NOT NULL constraint failed: context_blocks\.block_id/u);
  });

  it("在写事务前执行 P0 准入，并记录静默拒绝", async () => {
    const { store } = createStore();

    expect(await store.upsert(makeBlock("wm-missing", "working_memory"))).toMatchObject({
      accepted: false,
    });
    expect(
      await store.upsert(makeBlock("wm-low", "working_memory"), { significance: "low" }),
    ).toMatchObject({ accepted: false });
    expect(
      await store.upsert(makeBlock("wm-medium", "working_memory"), {
        significance: "medium",
      }),
    ).toEqual({ accepted: true });

    expect(
      await store.upsert(makeBlock("note-handler", "notes", { mutability: "agent_writable" }), {
        write_origin: "handler",
      }),
    ).toMatchObject({ accepted: false });
    expect(
      await store.upsert(makeBlock("note-tool", "notes", { mutability: "agent_writable" }), {
        write_origin: "context_write",
      }),
    ).toEqual({ accepted: true });
    expect(
      await store.upsert(makeBlock("invalid-mutability", "task_state", {
        mutability: "agent_writable",
      })),
    ).toMatchObject({ accepted: false });

    expect(
      await store.upsert(makeBlock("experience-unconfirmed", "experience", {
        source_system: "sekb",
      }), {
        confirmed: false,
        confidence: 0.9,
      }),
    ).toMatchObject({ accepted: false });

    expect(
      await store.upsert(makeBlock("compass-unverified", "knowledge", {
        source_system: "compass",
      }), {
        verification_status: "unverified",
        confidence: 0.9,
        audn_state: "ACTIVE",
      }),
    ).toMatchObject({ accepted: false });
    expect(
      await store.upsert(makeBlock("role-memory", "knowledge", {
        source_system: "role-memory",
      })),
    ).toEqual({ accepted: true });

    expect(
      await store.upsert(makeBlock("environment-no-path", "environment", {
        source_system: "codegraph",
      }), {
        hint_entities: ["symbolName"],
      }),
    ).toMatchObject({ accepted: false });
    expect(
      await store.upsert(makeBlock("environment-path", "environment", {
        source_system: "codegraph",
      }), {
        hint_entities: ["src/context-engine/block.ts"],
      }),
    ).toEqual({ accepted: true });

    const stats = await store.stats();
    expect(stats.admission_rejections).toBe(7);
    expect(stats.total_blocks).toBe(4);
  });

  it("尝试提取实体并记录 success、empty、failed 状态", async () => {
    const { store } = createStore({
      extractEntities(text) {
        if (text.includes("throw")) {
          throw new Error("extract failed");
        }
        return text.includes("entity") ? new Set(["EntityOne"]) : new Set();
      },
    });

    await store.upsert(makeBlock("entity-success", "task_state", { summary: "entity" }));
    await store.upsert(makeBlock("entity-empty", "task_state", { summary: "plain" }));
    await store.upsert(makeBlock("entity-failed", "task_state", { summary: "throw" }));

    const blocks = await store.query({ requester_session_id: "session-a" });
    expect(Object.fromEntries(blocks.map((block) => [block.block_id, block.entity_extraction_status])))
      .toEqual({
        "entity-empty": "empty",
        "entity-failed": "failed",
        "entity-success": "success",
      });
    expect(
      await store.queryByEntity({
        requester_session_id: "session-a",
        entities: ["entityone"],
      }),
    ).toMatchObject([{ block_id: "entity-success" }]);

    const stats = await store.stats();
    expect(stats.entity_extraction_status).toMatchObject({
      empty: 1,
      failed: 1,
      success: 1,
    });
  });

  it("同 ID 原位更新保留 created_at，并在同一事务中替换 entity map", async () => {
    const { store } = createStore({
      extractEntities(text) {
        return new Set(text.includes("second") ? ["Beta"] : ["Alpha"]);
      },
    });

    await store.upsert(makeBlock("same-id", "task_state", {
      summary: "first",
      created_at: new Date("2026-07-01T00:00:00.000Z"),
    }));
    await store.upsert(makeBlock("same-id", "task_state", {
      summary: "second",
      created_at: new Date("2026-07-09T00:00:00.000Z"),
    }));

    const [stored] = await store.query({ requester_session_id: "session-a" });
    expect(stored).toMatchObject({
      block_id: "same-id",
      summary: "second",
      created_at: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(
      await store.queryByEntity({
        requester_session_id: "session-a",
        entities: ["alpha"],
      }),
    ).toEqual([]);
    expect(
      await store.queryByEntity({
        requester_session_id: "session-a",
        entities: ["beta"],
      }),
    ).toMatchObject([{ block_id: "same-id" }]);
  });

  it("按持久化 confidence 和时间确定性限制 experience/environment 容量", async () => {
    const { db, store } = createStore();

    for (const [index, confidence] of [0.8, 0.2, 0.9, 0.7].entries()) {
      await store.upsert(
        makeBlock(`experience-${index}`, "experience", {
          source_system: "sekb",
          valid_at: new Date(BASE_TIME.getTime() - (4 - index) * 1_000),
        }),
        { confirmed: true, confidence },
      );
    }
    expect(
      (await store.query({
        requester_session_id: "session-a",
        block_types: ["experience"],
      })).map((block) => block.block_id).toSorted(),
    ).toEqual(["experience-0", "experience-2", "experience-3"]);
    expect(
      db.prepare(
        "SELECT invalid_at, retention_confidence FROM context_blocks WHERE block_id = ?",
      ).get("experience-1"),
    ).toMatchObject({
      invalid_at: BASE_TIME.getTime(),
      retention_confidence: 0.2,
    });

    for (const index of [0, 1, 2]) {
      await store.upsert(
        makeBlock(`environment-${index}`, "environment", {
          source_system: "codegraph",
          valid_at: new Date(BASE_TIME.getTime() - (3 - index) * 1_000),
        }),
        { hint_entities: [`src/file-${index}.ts`] },
      );
    }
    expect(
      (await store.query({
        requester_session_id: "session-a",
        block_types: ["environment"],
      })).map((block) => block.block_id),
    ).toEqual(["environment-2", "environment-1"]);
  });

  it("counts future-invalid experience and environment blocks toward capacity", async () => {
    const { db, store } = createStore();
    const futureInvalidAt = new Date(BASE_TIME.getTime() + 60_000);

    await store.upsert(
      makeBlock("experience-future-invalid", "experience", {
        source_system: "sekb",
        valid_at: new Date(BASE_TIME.getTime() - 4_000),
        invalid_at: futureInvalidAt,
      }),
      { confirmed: true, confidence: 0.1 },
    );
    for (const [index, confidence] of [0.8, 0.9, 0.7].entries()) {
      await store.upsert(
        makeBlock(`experience-active-${index}`, "experience", {
          source_system: "sekb",
          valid_at: new Date(BASE_TIME.getTime() - (3 - index) * 1_000),
        }),
        { confirmed: true, confidence },
      );
    }

    expect(
      (
        await store.query({
          requester_session_id: "session-a",
          block_types: ["experience"],
        })
      ).map((block) => block.block_id),
    ).toEqual(["experience-active-2", "experience-active-1", "experience-active-0"]);

    await store.upsert(
      makeBlock("environment-future-invalid", "environment", {
        source_system: "codegraph",
        valid_at: new Date(BASE_TIME.getTime() - 3_000),
        invalid_at: futureInvalidAt,
      }),
      { hint_entities: ["src/future.ts"] },
    );
    for (const index of [0, 1]) {
      await store.upsert(
        makeBlock(`environment-active-${index}`, "environment", {
          source_system: "codegraph",
          valid_at: new Date(BASE_TIME.getTime() - (2 - index) * 1_000),
        }),
        { hint_entities: [`src/active-${index}.ts`] },
      );
    }

    expect(
      (
        await store.query({
          requester_session_id: "session-a",
          block_types: ["environment"],
        })
      ).map((block) => block.block_id),
    ).toEqual(["environment-active-1", "environment-active-0"]);
    expect(
      db
        .prepare(
          "SELECT block_id, invalid_at FROM context_blocks WHERE block_id IN (?, ?) ORDER BY block_id",
        )
        .all("environment-future-invalid", "experience-future-invalid"),
    ).toEqual([
      {
        block_id: "environment-future-invalid",
        invalid_at: BASE_TIME.getTime(),
      },
      {
        block_id: "experience-future-invalid",
        invalid_at: BASE_TIME.getTime(),
      },
    ]);
  });

  it("默认只读本 session，global 需显式开启，invalidate 后不再返回", async () => {
    const { store } = createStore();
    await store.upsert(makeBlock("self", "task_state"));
    await store.upsert(makeBlock("other", "task_state", { session_id: "session-b" }));
    await store.upsert(makeBlock("global", "task_state", { session_id: undefined }));

    expect(
      (await store.query({ requester_session_id: "session-a" })).map((block) => block.block_id),
    ).toEqual(["self"]);
    expect(
      (
        await store.query({
          requester_session_id: "session-a",
          include_global: true,
        })
      ).map((block) => block.block_id),
    ).toEqual(["global", "self"]);

    await store.invalidate("self");
    expect(await store.query({ requester_session_id: "session-a" })).toEqual([]);
  });

  it("invalidate immediately overrides a future invalid_at", async () => {
    const { db, store } = createStore();
    await store.upsert(
      makeBlock("future-invalid", "task_state", {
        invalid_at: new Date(BASE_TIME.getTime() + 60_000),
      }),
    );

    expect(
      (await store.query({ requester_session_id: "session-a" })).map(
        (block) => block.block_id,
      ),
    ).toEqual(["future-invalid"]);

    await store.invalidate("future-invalid");

    expect(await store.query({ requester_session_id: "session-a" })).toEqual([]);
    expect(
      db.prepare("SELECT invalid_at FROM context_blocks WHERE block_id = ?").get("future-invalid"),
    ).toEqual({ invalid_at: BASE_TIME.getTime() });
  });

  it("仅允许 child 根据自己的 HandoffPack 查询直接 parent", async () => {
    const { store } = createStore();
    await store.upsert(makeBlock("grand-data", "task_state", { session_id: "grand" }));
    await store.upsert(makeBlock("parent-data", "task_state", {
      session_id: "parent",
      valid_at: new Date(BASE_TIME.getTime() - 1_000),
    }));
    await store.upsert(
      makeBlock("parent-handoff", "task_state", {
        session_id: "parent",
        full_content: JSON.stringify(handoffPack("grand")),
      }),
    );
    await store.upsert(
      makeBlock("child-handoff", "task_state", {
        session_id: "child",
        full_content: JSON.stringify(handoffPack("parent")),
      }),
    );

    expect(
      (
        await store.query({
          requester_session_id: "child",
          session_id: "parent",
        })
      ).map((block) => block.block_id),
    ).toEqual(["parent-handoff", "parent-data"]);
    expect(
      await store.query({
        requester_session_id: "child",
        session_id: "grand",
      }),
    ).toEqual([]);
    expect(
      await store.query({
        requester_session_id: "child",
        session_id: "unrelated",
      }),
    ).toEqual([]);
    expect((await store.stats()).authorization_rejections).toBe(2);
  });

  it("畸形 HandoffPack 不授予直接 parent 查询权限", async () => {
    const { store } = createStore();
    await store.upsert(makeBlock("parent-data", "task_state", { session_id: "parent" }));

    const malformedPacks = [
      {
        ...handoffPack("parent"),
        objective: "x".repeat(2_001),
      },
      {
        ...handoffPack("parent"),
        recent_actions: [
          {
            tool: "exec",
            result_summary: "x".repeat(101),
            significance: "high",
          },
        ],
      },
      {
        ...handoffPack("parent"),
        block_ids: ["parent-data"],
      },
    ];

    for (const [index, pack] of malformedPacks.entries()) {
      const childSessionId = `malformed-child-${index}`;
      await store.upsert(
        makeBlock(`malformed-handoff-${index}`, "task_state", {
          session_id: childSessionId,
          full_content: JSON.stringify(pack),
        }),
      );
      expect(
        await store.query({
          requester_session_id: childSessionId,
          session_id: "parent",
        }),
      ).toEqual([]);
    }

    expect((await store.stats()).authorization_rejections).toBe(3);
  });
});

function createStore(options?: {
  extractEntities?: (text: string) => Iterable<string>;
}) {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(OPENCLAW_STATE_SCHEMA_SQL);
  return {
    db,
    store: new BlockStore(db, {
      now: () => new Date(BASE_TIME),
      extractEntities: options?.extractEntities,
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
    compression_depth: 0,
    entity_extraction_status: "pending",
    ...overrides,
  };
}

function handoffPack(parent_session_id: string) {
  return {
    objective: "continue the task",
    current_phase: "running",
    recent_actions: [],
    parent_session_id,
  };
}
