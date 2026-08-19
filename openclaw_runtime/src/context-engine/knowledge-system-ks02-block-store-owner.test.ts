import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BlockStore } from "./block-store.js";
import { closeOpenClawStateDatabaseForTest, openOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import type { ContextBlock } from "./block.js";

const roots: string[] = [];

function makeBlock(overrides: Partial<ContextBlock> = {}): ContextBlock {
  const now = new Date("2026-08-17T00:00:00.000Z");
  return {
    block_id: "experience:sekb:experience-projection/v1:agent:alpha:main:principle-1:rev1",
    block_type: "experience",
    source_system: "sekb",
    session_id: "agent:alpha:main",
    presence: { always_on: false, on_demand: { expand_tool: "context_search", auto_register: false }, background: true },
    entities: ["postgresql"],
    valid_at: now,
    created_at: now,
    mutability: "system_managed",
    summary: "Experience",
    full_content: "Check PG access",
    compression_depth: 0,
    entity_extraction_status: "empty",
    ...overrides,
  };
}

function openStore() {
  const root = mkdtempSync(path.join(os.tmpdir(), "clawx-block-owner-"));
  roots.push(root);
  const database = openOpenClawStateDatabase({ path: path.join(root, "state.sqlite") });
  return { root, store: new BlockStore(database.db) };
}

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("KS-02 BlockStore session owner API", () => {
  it("enumerates and hard-deletes all blocks owned by a session", async () => {
    const { store } = openStore();
    await store.upsert(makeBlock(), { confirmed: true, confidence: 0.8, write_origin: 'handler' });
    await store.upsert(makeBlock({ block_id: "experience:sekb:experience-projection/v1:agent:alpha:main:principle-2:rev1", summary: "Second" }), { confirmed: true, confidence: 0.7, write_origin: 'handler' });
    await store.upsert(makeBlock({ block_id: "notes:other", block_type: "notes", mutability: "agent_writable", session_id: "agent:alpha:other" }), { write_origin: "context_write" });

    const enumerated = await store.enumerateBySession("agent:alpha:main");
    expect(enumerated.map((block) => block.block_id).sort()).toEqual([
      "experience:sekb:experience-projection/v1:agent:alpha:main:principle-1:rev1",
      "experience:sekb:experience-projection/v1:agent:alpha:main:principle-2:rev1",
    ]);

    const result = await store.deleteBySession("agent:alpha:main");
    expect(result.deleted).toBe(2);
    expect(result.remaining).toBe(0);
    expect(await store.enumerateBySession("agent:alpha:main")).toHaveLength(0);
    expect(await store.enumerateBySession("agent:alpha:other")).toHaveLength(1);
  });

  it("enumerateBySource accepts session: prefixed source refs", async () => {
    const { store } = openStore();
    await store.upsert(makeBlock(), { confirmed: true, confidence: 0.8, write_origin: 'handler' });
    expect(await store.enumerateBySource("session:agent:alpha:main")).toHaveLength(1);
    expect(await store.enumerateBySource("agent:alpha:main")).toHaveLength(1);
  });

  it("deleteBlock clears entity map rows without touching other sessions", async () => {
    const { store } = openStore();
    await store.upsert(makeBlock(), { confirmed: true, confidence: 0.8, write_origin: 'handler' });
    await store.upsert(makeBlock({ block_id: "other:block", block_type: "experience", session_id: "agent:alpha:other", entities: ["other"] }), { confirmed: true, confidence: 0.6, write_origin: 'handler' });
    await store.deleteBlock("experience:sekb:experience-projection/v1:agent:alpha:main:principle-1:rev1");
    expect(await store.enumerateBySession("agent:alpha:main")).toHaveLength(0);
    expect(await store.enumerateBySession("agent:alpha:other")).toHaveLength(1);
  });

  it("invalidateBySession only invalidates currently-valid owned blocks", async () => {
    const { store } = openStore();
    await store.upsert(makeBlock(), { confirmed: true, confidence: 0.8, write_origin: 'handler' });
    await store.upsert(makeBlock({ block_id: "experience:sekb:experience-projection/v1:agent:alpha:main:principle-2:rev1" }), { confirmed: true, confidence: 0.7, write_origin: 'handler' });
    expect(await store.invalidateBySession("agent:alpha:main")).toBe(2);
    expect(await store.query({ requester_session_id: "agent:alpha:main", session_id: "agent:alpha:main", block_types: ["experience"] })).toHaveLength(0);
    expect(await store.invalidateBySession("agent:alpha:main")).toBe(0);
  });
});
