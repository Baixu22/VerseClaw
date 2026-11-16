// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import * as memoryContext from "../../openclaw_runtime/src/runtime-core/memory-context";
import * as curation from "../../openclaw_runtime/src/runtime-core/memory-write-curation";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import { createRuntimeMemoryRuntimeIntegration } from "../../openclaw_runtime/src/runtime-core/memory-runtime-integration";
import { executeMemorySelfEditTool } from "../../openclaw_runtime/src/runtime-core/memory-self-edit-tools";
import { RuntimeMemoryStore } from "../../openclaw_runtime/src/runtime-core/memory-store";
import { closeOpenClawStateDatabaseForTest, openOpenClawStateDatabase } from "../../openclaw_runtime/src/state/openclaw-state-db";

const directories: string[] = [];
const readers: DatabaseSync[] = [];
const observations: Array<Record<string, unknown>> = [];
afterEach(() => {
  for (const reader of readers.splice(0)) reader.close();
  closeOpenClawStateDatabaseForTest();
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
afterAll(() => {
  if (process.env.MEMORY_ATOMIC_TRACE_PATH) writeFileSync(process.env.MEMORY_ATOMIC_TRACE_PATH,
    JSON.stringify({ driven_by: "agent", actor: "codex/tf0742", scope: "isolated SQLite with test-only mocked flag resolver", observations }, null, 2));
});

function fixture(action: "UPDATE" | "SUPERSEDE" | "DELETE" = "UPDATE") {
  // Exercise the retired implementation only in this test process. The product
  // resolver still rejects persist=true and is tested without this spy elsewhere.
  const flags = memoryContext.resolveRuntimeMemoryFeatureFlags(undefined);
  vi.spyOn(memoryContext, "resolveRuntimeMemoryFeatureFlags").mockReturnValue({ ...flags, persist: true });
  const dir = mkdtempSync(join(tmpdir(), "tf0742-"));
  directories.push(dir);
  const dbPath = join(dir, "memory.sqlite");
  const persistence = createRuntimeMemoryPersistenceStore({ database: { path: dbPath }, now: () => 2000 });
  const old = memoryContext.buildRuntimeMemoryTemporalFactFixture({ factId: "old", subject: "test", predicate: "value", objectSummary: "old value", valid_at: 100, reference_time: 100, acceptedAt: 100 });
  expect(persistence.appendFact(old).status).toBe("persisted");
  const candidate = memoryContext.buildRuntimeMemoryTemporalFactCandidateFixture({ factId: "replacement", subject: "test", predicate: "value", objectSummary: "new value", proposedAt: 2000, valid_at: 2000, reference_time: 2000 });
  vi.spyOn(curation, "decideAUDN").mockReturnValue(action === "DELETE"
    ? { action, targetFactId: old.factId, reason: "retracted" }
    : action === "SUPERSEDE"
      ? { action, candidate, supersedes: old.factId, supersessionReason: "contradiction" }
      : { action, candidate, supersedes: old.factId });
  const integration = createRuntimeMemoryRuntimeIntegration({ persistence, curation: { enabled: true } });
  const db = openOpenClawStateDatabase({ path: dbPath }).db;
  const reader = new DatabaseSync(dbPath, { readOnly: true });
  readers.push(reader);
  const snapshot = () => ({
    facts: reader.prepare("SELECT fact_id FROM runtime_memory_facts ORDER BY fact_id").all().map(row => row.fact_id),
    invalidations: reader.prepare("SELECT fact_id FROM runtime_memory_invalidations ORDER BY fact_id").all().map(row => row.fact_id),
    relations: reader.prepare("SELECT relation_id FROM runtime_memory_fact_relations ORDER BY relation_id").all().map(row => row.relation_id),
  });
  const update = (route: "self-edit" | "curation") => route === "self-edit"
    ? executeMemorySelfEditTool("memory_update", { factId: old.factId, objectSummary: "new value" }, { store: persistence.loadStore().store, persistence: integration, now: 2000 })
    : integration.appendFact(candidate);
  return { db, persistence, integration, candidate, snapshot, update };
}

describe.each(["self-edit", "curation"] as const)("TF-0742 SQLite atomic %s", route => {
  it.each(["fact", "invalidation", "relation"] as const)("rolls back when the %s write fails", async stage => {
    const { db, snapshot, update } = fixture();
    const before = snapshot();
    const table = { fact: "runtime_memory_facts", invalidation: "runtime_memory_invalidations", relation: "runtime_memory_fact_relations" }[stage];
    db.exec(`CREATE TEMP TRIGGER fail_write BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'injected-${stage}'); END`);
    let error: unknown;
    let result: unknown;
    try { result = await update(route); } catch (caught) { error = caught; }
    if (route === "self-edit") {
      expect(result).toMatchObject({ ok: false, message: expect.stringContaining(`injected-${stage}`) });
    } else {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(`injected-${stage}`);
    }
    const after = snapshot();
    observations.push({ route, stage, before, after, result, error: error instanceof Error ? error.message : undefined });
    expect(after).toEqual(before);
    db.exec("DROP TRIGGER fail_write");
    const recovered = await update(route);
    expect(route === "self-edit" ? (recovered as { ok: boolean }).ok : (recovered as { status: string }).status === "persisted").toBe(true);
  });

  it("commits the complete replacement and hides intermediate writes from another connection", async () => {
    const { persistence, snapshot, update } = fixture();
    const before = snapshot();
    const intermediate: ReturnType<typeof snapshot>[] = [];
    const append = persistence.appendFact.bind(persistence);
    const invalidate = persistence.invalidateFact.bind(persistence);
    const relation = persistence.persistRelation.bind(persistence);
    vi.spyOn(persistence, "appendFact").mockImplementation(fact => { const r = append(fact); intermediate.push(snapshot()); return r; });
    vi.spyOn(persistence, "invalidateFact").mockImplementation(value => { const r = invalidate(value); intermediate.push(snapshot()); return r; });
    vi.spyOn(persistence, "persistRelation").mockImplementation(value => { const r = relation(value); intermediate.push(snapshot()); return r; });
    const result = await update(route);
    expect(route === "self-edit" ? (result as { ok: boolean }).ok : (result as { status: string }).status === "persisted").toBe(true);
    expect(intermediate).toHaveLength(3);
    expect(intermediate.every(value => JSON.stringify(value) === JSON.stringify(before))).toBe(true);
    const after = snapshot();
    expect(after.facts).toHaveLength(2);
    expect(after.invalidations).toEqual(["old"]);
    expect(after.relations).toHaveLength(1);
    observations.push({ route, stage: "success", before, intermediate, after });
  });
});

describe.each(["self-edit", "curation"] as const)("TF-0742 rejected/skipped %s writes", route => {
  it.each(["rejected", "skipped"] as const)("rolls back an earlier write when the relation returns %s", async status => {
    const { persistence, snapshot, update } = fixture();
    const before = snapshot();
    vi.spyOn(persistence, "persistRelation").mockReturnValue(status === "rejected"
      ? { status, reason: "invalid_relation_type", message: "relation rejected", persisted: false }
      : { status, reason: "flag_disabled", persisted: false });
    const result = await update(route);
    expect(route === "self-edit" ? (result as { ok: boolean }).ok : (result as { persisted: boolean }).persisted).toBe(false);
    expect(snapshot()).toEqual(before);
  });
});

it("rolls back SUPERSEDE when its second relation fails", () => {
  const { db, snapshot, update } = fixture("SUPERSEDE");
  const before = snapshot();
  db.exec("CREATE TEMP TRIGGER fail_contradicts BEFORE INSERT ON runtime_memory_fact_relations WHEN NEW.relation_type = 'contradicts' BEGIN SELECT RAISE(ABORT, 'second relation'); END");
  expect(() => update("curation")).toThrow(/second relation/);
  expect(snapshot()).toEqual(before);
});

it("rejects a non-atomic port before writes and keeps the production flag retired", async () => {
  const { persistence, snapshot } = fixture();
  const before = snapshot();
  const append = vi.spyOn(persistence, "appendFact");
  Object.defineProperty(persistence, "runAtomic", { value: undefined });
  const result = await executeMemorySelfEditTool("memory_update", { factId: "old", objectSummary: "new" }, { store: persistence.loadStore().store, persistence, now: 2000 });
  expect(result).toMatchObject({ ok: false });
  expect(result.message).toContain("unsupported");
  expect(append).not.toHaveBeenCalled();
  expect(snapshot()).toEqual(before);
  vi.restoreAllMocks();
  expect(memoryContext.resolveRuntimeMemoryFeatureFlags({ runtime: { memory: { persist: true } } }).persist).toBe(false);
});

it.each(["appendFact", "invalidateFact", "appendRelation"] as const)("restores in-memory state, including eviction and usage, when %s throws", async method => {
  const store = new RuntimeMemoryStore({ maxFacts: 1, now: () => 2000 });
  store.appendFact(memoryContext.buildRuntimeMemoryTemporalFactFixture({ factId: "old", valid_at: 100, reference_time: 100, acceptedAt: 100 }));
  store.recordFactAccess("old");
  const before = { facts: store.queryFacts(), invalidations: store.listInvalidations(), usage: store.getUsageStats(), lastWriteAt: store.getLastWriteAt() };
  vi.spyOn(store, method).mockImplementation(() => { throw new Error(`injected ${method}`); });
  const result = await executeMemorySelfEditTool("memory_update", { factId: "old", objectSummary: "new" }, { store, now: 2000 });
  expect(result.ok).toBe(false);
  expect({ facts: store.queryFacts(), invalidations: store.listInvalidations(), usage: store.getUsageStats(), lastWriteAt: store.getLastWriteAt() }).toEqual(before);
  expect(store.queryRelations("old_superseded_2000")).toEqual([]);
});

it("reports applied and already_applied for DELETE without inserting the candidate", () => {
  const { integration, candidate, snapshot } = fixture("DELETE");
  expect(integration.appendFact(candidate)).toMatchObject({ status: "applied", persisted: true, factId: "old" });
  expect(integration.appendFact(candidate)).toMatchObject({ status: "already_applied", persisted: true, factId: "old" });
  expect(snapshot()).toEqual({ facts: ["old"], invalidations: ["old"], relations: [] });
});

it("does not claim a deletion when its target is missing or loading was skipped", () => {
  const { integration, persistence, candidate, snapshot } = fixture("DELETE");
  const before = snapshot();
  vi.mocked(curation.decideAUDN).mockReturnValue({ action: "DELETE", targetFactId: "missing", reason: "retracted" });
  expect(integration.appendFact(candidate)).toMatchObject({ status: "rejected", persisted: false });
  vi.spyOn(persistence, "loadStore").mockReturnValue({ status: "skipped", reason: "flag_disabled", store: new RuntimeMemoryStore() });
  expect(integration.appendFact(candidate)).toMatchObject({ status: "skipped", persisted: false });
  expect(snapshot()).toEqual(before);
});

it("defers eviction callbacks until the outer memory transaction commits", () => {
  const notify = vi.fn();
  const store = new RuntimeMemoryStore({ maxFacts: 1, evictionPolicy: "importance", evictionComplianceHook: notify, now: () => 2000 });
  const old = memoryContext.buildRuntimeMemoryTemporalFactFixture({ factId: "old" });
  const next = memoryContext.buildRuntimeMemoryTemporalFactFixture({ factId: "next" });
  store.appendFact(old);
  expect(() => store.runAtomic(() => {
    store.runAtomic(() => store.appendFact(next));
    expect(notify).not.toHaveBeenCalled();
    throw new Error("rollback");
  })).toThrow("rollback");
  expect(notify).not.toHaveBeenCalled();
  expect(store.getFactById("old")).toEqual(old);
  store.runAtomic(() => { store.appendFact(next); expect(notify).not.toHaveBeenCalled(); });
  expect(notify).toHaveBeenCalled();
});

it("rejects async callbacks before their first instruction on both transaction owners", async () => {
  const { persistence, snapshot } = fixture();
  const before = snapshot();
  const store = new RuntimeMemoryStore();
  const fact = memoryContext.buildRuntimeMemoryTemporalFactFixture({ factId: "escaped" });
  const invoked = vi.fn();
  for (const owner of [store, persistence]) {
    expect(() => owner.runAtomic(async () => {
      invoked();
      await Promise.resolve();
      owner.appendFact(fact);
    })).toThrow(/synchronous/);
  }
  await Promise.resolve();
  expect(invoked).not.toHaveBeenCalled();
  expect(store.stats().facts).toBe(0);
  expect(snapshot()).toEqual(before);
});

it.each(["candidate", "different-target", "future"] as const)("rejects a conflicting %s DELETE invalidation ID", kind => {
  const { integration, persistence, candidate, snapshot } = fixture("DELETE");
  const conflicting = memoryContext.buildRuntimeMemoryInvalidationProposalFixture({
    invalidationId: "old-deleted-by-replacement",
    factId: kind === "different-target" ? "other" : "old",
    invalid_at: kind === "future" ? 5000 : 2000,
    verificationStatus: kind === "candidate" ? "candidate" : "deterministic_rule",
  });
  expect(persistence.invalidateFact(conflicting).status).toBe("persisted");
  const before = snapshot();
  expect(integration.appendFact(candidate)).toMatchObject({ status: "rejected", persisted: false });
  expect(snapshot()).toEqual(before);
});
