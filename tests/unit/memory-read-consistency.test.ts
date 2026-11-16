// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import * as memoryContext from "../../openclaw_runtime/src/runtime-core/memory-context";
import * as persistenceModule from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import * as integrationModule from "../../openclaw_runtime/src/runtime-core/memory-runtime-integration";
import * as preReply from "../../openclaw_runtime/src/runtime-core/memory-pre-reply-injection";
import * as retrieval from "../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";
import { createMemoryRuntimeConfig } from "../../openclaw_runtime/src/runtime-core/memory-runtime-config";
import { createMemoryQueryTool } from "../../openclaw_runtime/src/runtime-core/memory-query-tool";
import { createMemorySelfEditTools } from "../../openclaw_runtime/src/runtime-core/memory-self-edit-adapter";
import { closeOpenClawStateDatabaseForTest, openOpenClawStateDatabase } from "../../openclaw_runtime/src/state/openclaw-state-db";
import type { AnyAgentTool } from "../../openclaw_runtime/src/agents/tools/common";

const directories: string[] = [];
const readers: DatabaseSync[] = [];
const subscriptions: Array<() => void> = [];
const observations: unknown[] = [];
afterEach(() => {
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  for (const db of readers.splice(0)) db.close();
  preReply.clearCompassFactsCache();
  closeOpenClawStateDatabaseForTest();
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
afterAll(() => {
  if (process.env.MEMORY_READ_TRACE_PATH) writeFileSync(process.env.MEMORY_READ_TRACE_PATH,
    JSON.stringify({ driven_by: "agent", actor: "codex/tf0743", observations }, null, 2));
});

type ToolPayload = {
  ok: boolean;
  facts?: Array<{ factId: string; objectSummary: string }>;
  data?: Array<{ factId: string; objectSummary: string }>;
  freshness?: { loadedAt: number; sourceRevision: string | null; scope: string; stale: boolean };
};
async function call(tool: AnyAgentTool, args: Record<string, unknown>): Promise<ToolPayload> {
  return (await tool.execute("tf0743", args)).details as ToolPayload;
}

function fixture() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(5000);
  const flags = memoryContext.resolveRuntimeMemoryFeatureFlags(undefined);
  vi.spyOn(memoryContext, "resolveRuntimeMemoryFeatureFlags").mockReturnValue({ ...flags, persist: true });
  vi.spyOn(memoryContext, "runtimeMemoryFlagEnabled").mockImplementation((_config, flag) => flag === "persist");
  vi.spyOn(preReply, "resolveCompassConfig").mockReturnValue({
    ...createMemoryRuntimeConfig(),
    featureFlags: { ...createMemoryRuntimeConfig().featureFlags, enableSessionStatePage: true },
  });
  const directory = mkdtempSync(join(tmpdir(), "tf0743-"));
  directories.push(directory);
  const dbPath = join(directory, "memory.sqlite");
  const writer = persistenceModule.createRuntimeMemoryPersistenceStore({ database: { path: dbPath } });
  const fact = memoryContext.buildRuntimeMemoryTemporalFactFixture({ factId: "old", subject: "profile", predicate: "color", objectSummary: "blue color", valid_at: 100, reference_time: 100, acceptedAt: 100 });
  expect(writer.appendFact(fact).status).toBe("persisted");
  vi.spyOn(integrationModule, "createRuntimeMemoryRuntimeIntegration").mockImplementation(options =>
    new integrationModule.RuntimeMemoryRuntimeIntegration({ ...options, persistence: writer }));
  const query = createMemoryQueryTool({ config: {} });
  const tools = createMemorySelfEditTools({ config: {} });
  expect(query).not.toBeNull();
  const tool = (name: string) => tools.find(tool => tool.name === name)!;
  const external = new DatabaseSync(dbPath);
  readers.push(external);
  const externalUpdate = (summary: string) => {
    const row = external.prepare("SELECT record_json FROM runtime_memory_facts WHERE fact_id = 'old'").get()!;
    const record = JSON.parse(String(row.record_json));
    external.prepare("UPDATE runtime_memory_facts SET object_summary = ?, record_json = ? WHERE fact_id = 'old'")
      .run(summary, JSON.stringify({ ...record, objectSummary: summary }));
  };
  return { writer, query: query!, tool, externalUpdate, dbPath };
}

describe("TF-0743 committed reads", () => {
  it("sees a self-edit replacement from query and recall immediately inside the TTL", async () => {
    const { query, tool } = fixture();
    const before = await call(query, { query: "color" });
    expect(before.facts?.map(fact => fact.objectSummary)).toEqual(["blue color"]);
    const updated = await call(tool("memory_update"), { factId: "old", object: "green color" });
    expect(updated.ok).toBe(true);
    const after = await call(query, { query: "color" });
    const recall = await call(tool("memory_recall"), {});
    observations.push({ case: "self-edit-query-recall", before, updated, after, recall, elapsedMs: 0 });
    expect(after.facts?.map(fact => fact.objectSummary)).toEqual(["green color"]);
    expect(recall.data?.map(fact => fact.objectSummary)).toEqual(["green color"]);
    expect(after.freshness).toMatchObject({ loadedAt: 5000, stale: false });
    expect(recall.freshness).toMatchObject({ scope: after.freshness?.scope, stale: false });
    expect(recall.freshness?.sourceRevision).toBeTypeOf("string");
  });

  it("does not return a forgotten fact from a cached query", async () => {
    const { query, tool } = fixture();
    await call(query, { query: "color" });
    expect((await call(tool("memory_forget"), { factId: "old" })).ok).toBe(true);
    const after = await call(query, { query: "color" });
    observations.push({ case: "forget-query", after, elapsedMs: 0 });
    expect(after.facts).toEqual([]);
    expect((await call(tool("memory_recall"), {})).data).toEqual([]);
  });

  it("invalidates after a direct owner append rather than relying on adapter-only hooks", async () => {
    const { writer, query } = fixture();
    await call(query, { query: "color" });
    const next = memoryContext.buildRuntimeMemoryTemporalFactFixture({ factId: "next", subject: "other", predicate: "color", objectSummary: "red color", valid_at: 100, reference_time: 100, acceptedAt: 100 });
    writer.appendFact(next);
    const after = await call(query, { query: "color" });
    expect(after.facts?.map(fact => fact.factId).sort()).toEqual(["next", "old"]);
  });

  it("reuses an unchanged snapshot until TTL expiry and exposes its load time", async () => {
    const { writer, query } = fixture();
    const load = vi.spyOn(writer, "loadStore");
    const before = await call(query, { query: "color" });
    vi.setSystemTime(6000);
    const cached = await call(query, { query: "color" });
    expect(load).toHaveBeenCalledTimes(1);
    expect(cached.freshness).toEqual(before.freshness);
    vi.setSystemTime(35_001);
    const expired = await call(query, { query: "color" });
    expect(load).toHaveBeenCalledTimes(2);
    expect(expired.freshness?.loadedAt).toBe(35_001);
  });
});

describe("TF-0743 external revision boundaries", () => {
  it("refreshes the cache when another SQLite connection commits", async () => {
    const { query, externalUpdate } = fixture();
    const before = await call(query, { query: "color" });
    externalUpdate("violet color");
    const after = await call(query, { query: "color" });
    observations.push({ case: "external-connection", before, after, elapsedMs: 0 });
    expect(after.facts?.[0].objectSummary).toBe("violet color");
    expect(after.freshness?.sourceRevision).not.toBe(before.freshness?.sourceRevision);
    expect(after.freshness?.stale).toBe(false);
  });

  it("refreshes after a separate Node process commits and exits", async () => {
    const { query, dbPath } = fixture();
    await call(query, { query: "color" });
    execFileSync(process.execPath, ["-e", `
      const {DatabaseSync}=require('node:sqlite');
      const db=new DatabaseSync(process.argv[1]);
      const fact=JSON.parse(db.prepare("SELECT record_json FROM runtime_memory_facts WHERE fact_id='old'").get().record_json);
      fact.objectSummary='orange color';
      db.prepare("UPDATE runtime_memory_facts SET object_summary=?,record_json=? WHERE fact_id='old'").run(fact.objectSummary,JSON.stringify(fact));
      db.close();
    `, dbPath], { windowsHide: true, timeout: 15_000, stdio: "pipe" });
    const after = await call(query, { query: "color" });
    observations.push({ case: "external-process", after, elapsedMs: 0 });
    expect(after.facts?.[0].objectSummary).toBe("orange color");
    expect(after.freshness?.scope).toBe("sqlite-connection-snapshot");
  });

  it("marks a snapshot stale when an external commit occurs during async retrieval", async () => {
    const { query, externalUpdate } = fixture();
    const search = retrieval.hybridSearchFactsWithEmbedding;
    vi.spyOn(retrieval, "hybridSearchFactsWithEmbedding").mockImplementationOnce(async (...args) => {
      externalUpdate("violet color");
      return search(...args);
    });
    const during = await call(query, { query: "color" });
    observations.push({ case: "changed-during-retrieval", during });
    expect(during.facts?.[0].objectSummary).toBe("blue color");
    expect(during.freshness?.stale).toBe(true);
    expect((await call(query, { query: "color" })).facts?.[0].objectSummary).toBe("violet color");
  });

  it("does not label old rows with a newer revision after the read transaction commits", async () => {
    const { query, writer, externalUpdate } = fixture();
    const load = writer.loadStore.bind(writer);
    vi.spyOn(writer, "loadStore").mockImplementationOnce(() => {
      const snapshot = load();
      externalUpdate("violet color");
      return snapshot;
    });
    const raced = await call(query, { query: "color" });
    observations.push({ case: "changed-after-snapshot-commit", raced });
    expect(raced.facts?.[0].objectSummary).toBe("blue color");
    expect(raced.freshness?.stale).toBe(true);
    expect((await call(query, { query: "color" })).facts?.[0].objectSummary).toBe("violet color");
  });
});

it("publishes only the outer committed mutation and allows subscription cleanup", () => {
  const { writer } = fixture();
  const notify = vi.fn();
  expect(persistenceModule.subscribeRuntimeMemoryChanges).toBeTypeOf("function");
  const unsubscribe = persistenceModule.subscribeRuntimeMemoryChanges(notify);
  subscriptions.push(unsubscribe);
  const fact = memoryContext.buildRuntimeMemoryTemporalFactFixture({ factId: "next", valid_at: 100, reference_time: 100, acceptedAt: 100 });
  expect(() => writer.runAtomic(() => { writer.appendFact(fact); expect(notify).not.toHaveBeenCalled(); throw new Error("rollback"); })).toThrow("rollback");
  expect(notify).not.toHaveBeenCalled();
  writer.runAtomic(() => { writer.appendFact(fact); expect(notify).not.toHaveBeenCalled(); });
  expect(notify).toHaveBeenCalledTimes(1);
  unsubscribe();
  writer.recordFactAccess("next");
  expect(notify).toHaveBeenCalledTimes(1);
});

it("does not claim fresh when a persistence port supplies no revision evidence", async () => {
  const { writer, query } = fixture();
  const load = writer.loadStore.bind(writer);
  vi.spyOn(writer, "loadStore").mockImplementation(() => {
    const result = load();
    if (result.status === "loaded") delete result.readSnapshot;
    return result;
  });
  expect((await call(query, { query: "color" })).freshness).toMatchObject({ stale: true, sourceRevision: null, scope: "unverified" });
});

it("a failed observer cannot turn a committed write into an apparent failure", () => {
  const { writer } = fixture();
  subscriptions.push(persistenceModule.subscribeRuntimeMemoryChanges(() => { throw new Error("observer"); }));
  const fact = memoryContext.buildRuntimeMemoryTemporalFactFixture({ factId: "next", valid_at: 100, reference_time: 100, acceptedAt: 100 });
  expect(writer.appendFact(fact).status).toBe("persisted");
  expect(writer.loadStore().store.getFactById("next")).toBeDefined();
});

it("does not cache or claim fresh for an uncommitted outer transaction", async () => {
  const { writer, query } = fixture();
  await call(query, { query: "color" });
  expect(() => writer.runAtomic(() => {
    writer.appendFact(memoryContext.buildRuntimeMemoryTemporalFactFixture({ factId: "pending", objectSummary: "pending color", valid_at: 100, reference_time: 100, acceptedAt: 100 }));
    expect(preReply.loadCompassFactsSnapshot({}).freshness.stale).toBe(true);
    throw new Error("rollback outer");
  })).toThrow("rollback outer");
  expect((await call(query, { query: "color" })).facts?.map(fact => fact.factId)).toEqual(["old"]);
});

it("observes a shared outer transaction when the Node 24 transaction property is unavailable", () => {
  const { dbPath } = fixture();
  const database = openOpenClawStateDatabase({ path: dbPath });
  const legacyDb = new Proxy(database.db, {
    get(target, key) {
      if (key === "isTransaction") return undefined;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const options = { openDatabase: () => ({ ...database, db: legacyDb }) };
  const writer = persistenceModule.createRuntimeMemoryPersistenceStore(options);
  const otherOwner = persistenceModule.createRuntimeMemoryPersistenceStore(options);
  const notify = vi.fn();
  subscriptions.push(persistenceModule.subscribeRuntimeMemoryChanges(notify));
  expect(() => writer.runAtomic(() => {
    otherOwner.appendFact(memoryContext.buildRuntimeMemoryTemporalFactFixture({ factId: "pending", valid_at: 100, reference_time: 100, acceptedAt: 100 }));
    expect(otherOwner.getReadRevision()).toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
    throw new Error("rollback shared");
  })).toThrow("rollback shared");
  expect(notify).not.toHaveBeenCalled();
});

it("keeps persistence retired and never registers the tools without test spies", () => {
  expect(memoryContext.resolveRuntimeMemoryFeatureFlags({ runtime: { memory: { persist: true } } }).persist).toBe(false);
  expect(createMemoryQueryTool({ config: { runtime: { memory: { persist: true } } } })).toBeNull();
  expect(createMemorySelfEditTools({ config: { runtime: { memory: { persist: true } } } })).toEqual([]);
});
