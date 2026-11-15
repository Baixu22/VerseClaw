// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROJECT_RAG_DEFAULTS, normalizeProjectRagConfig } from "../../shared/knowledge/operations";
import {
  resolveMemoryWikiConfig,
  memoryWikiConfigSchema,
  normalizeCompatibilityConfig,
  resolveMemoryWikiStatus,
  buildMemoryWikiDoctorReport,
  createMemoryWikiProjectionService,
  retrieveMemoryWiki,
} from "../../openclaw_runtime/extensions/memory-wiki/runtime-api";
import { createPluginStateKeyedStoreForTests } from "../../openclaw_runtime/src/plugin-sdk/plugin-state-test-runtime";
import {
  closeOpenClawStateDatabase,
  openOpenClawStateDatabase,
} from "../../openclaw_runtime/src/state/openclaw-state-db";
import { closeTrackedSqliteHandlesUnder, requireNodeSqlite } from "../../openclaw_runtime/src/infra/node-sqlite";

let root: string | undefined;
const services: Array<ReturnType<typeof createMemoryWikiProjectionService>> = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
  closeOpenClawStateDatabase();
  vi.unstubAllEnvs();
  if (root) {
    closeTrackedSqliteHandlesUnder(root);
    await rm(root, { recursive: true, force: true });
  }
  root = undefined;
});

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "rag12-owner-"));
  vi.stubEnv("OPENCLAW_STATE_DIR", join(root, "state"));
  const vault = join(root, "vault");
  await mkdir(join(vault, "concepts"), { recursive: true });
  const identity = {
    workspaceId: "agent-rag12-workspace",
    workspaceDir: root,
    agentSessionKey: "agent:main:rag12",
    sessionId: "physical-rag12",
    egressProviderRefs: [],
  };
  const file = join(vault, "concepts/source.md");
  const raw = (revision: number, text: string, acl = "") =>
    `---\ntitle: Agent operations fixture\nrevision: ${revision}\nstatus: active\ntrust: confirmed\nscope:\n  workspaceId: ${identity.workspaceId}\n${acl}---\n# Operations\n\n${text}\n`;
  const make = (maxStorageBytes = PROJECT_RAG_DEFAULTS.maxStorageBytes) => {
    const config = resolveMemoryWikiConfig({
      vault: { path: vault },
      retrieval: { maxStorageBytes },
      search: { backend: "local", corpus: "wiki" },
    });
    const errors: string[] = [];
    const service = createMemoryWikiProjectionService({
      config,
      openKeyedStore: <T>(options: Parameters<typeof createPluginStateKeyedStoreForTests<T>>[1]) =>
        createPluginStateKeyedStoreForTests<T>("memory-wiki", options),
      onError: (error) => errors.push(error.message),
    });
    services.push(service);
    return { config, service, errors };
  };
  return { vault, file, identity, raw, make };
}

describe("Project RAG canonical config and operational recovery", () => {
  it("closes a projection worker's shared database without waiting for another reader", async () => {
    await fixture();
    const database = openOpenClawStateDatabase();
    database.db.exec("CREATE TABLE agent_rag12_reader (value INTEGER)");
    database.db.exec("INSERT INTO agent_rag12_reader VALUES (1), (2)");
    const reader = new (requireNodeSqlite().DatabaseSync)(database.path);
    const cursor = reader.prepare("SELECT value FROM agent_rag12_reader").iterate();
    try {
      expect(cursor.next().done).toBe(false);
      database.db.exec("INSERT INTO agent_rag12_reader VALUES (3)");
      database.db.exec("PRAGMA busy_timeout = 500");
      const started = performance.now();
      closeOpenClawStateDatabase({ checkpoint: false });
      expect(performance.now() - started).toBeLessThan(250);
      expect(database.db.isOpen).toBe(false);
      expect(cursor.next().value).toMatchObject({ value: 2 });
    } finally {
      cursor.return?.();
      reader.close();
    }
    expect(openOpenClawStateDatabase().db.prepare("SELECT count(*) AS n FROM agent_rag12_reader").get())
      .toMatchObject({ n: 3 });
  });

  it("keeps runtime defaults, manifest schema/help and doctor output aligned", async () => {
    const manifest = JSON.parse(
      await readFile("openclaw_runtime/extensions/memory-wiki/openclaw.plugin.json", "utf8"),
    );
    const schema = manifest.configSchema.properties.retrieval;
    const config = resolveMemoryWikiConfig(undefined);
    expect(config.retrieval).toEqual(PROJECT_RAG_DEFAULTS);
    expect(normalizeProjectRagConfig({})).toEqual(PROJECT_RAG_DEFAULTS);
    expect(memoryWikiConfigSchema.safeParse?.({})).toMatchObject({ success: true });
    expect(schema.additionalProperties).toBe(false);
    for (const key of ["profile", "answerMode", "maxStorageBytes"] as const) {
      expect(schema.properties[key].default).toBe(PROJECT_RAG_DEFAULTS[key]);
      expect(manifest.uiHints[`retrieval.${key}`].help.length).toBeGreaterThan(10);
    }
    const status = await resolveMemoryWikiStatus(config, {
      pathExists: async () => false,
      listPublicArtifacts: async () => [],
    });
    expect(buildMemoryWikiDoctorReport(status).status.retrieval).toEqual(PROJECT_RAG_DEFAULTS);
    const migrated = normalizeCompatibilityConfig({
      cfg: {
        plugins: {
          entries: {
            "memory-wiki": {
              config: {
                retrieval: { profile: "quality" },
                bridge: { readMemoryCore: true },
              },
            },
          },
        },
      },
    });
    const pluginConfig = migrated.config.plugins!.entries!["memory-wiki"]!.config;
    expect(resolveMemoryWikiConfig(pluginConfig).retrieval.profile).toBe("quality");
    expect(pluginConfig).toMatchObject({ bridge: { readMemoryArtifacts: true } });
    expect(migrated.changes).toHaveLength(1);
  });

  it.each([
    { scope: "all" },
    { mode: "auto-read" },
    { profile: "unbounded" },
    { answerMode: "unguarded" },
    { maxStorageBytes: 0 },
    { maxStorageBytes: NaN },
    { maxStorageBytes: 1024 ** 6 },
  ])("rejects malformed or duplicated config: %j", (value) => {
    expect(() => normalizeProjectRagConfig(value)).toThrow();
    expect(() => resolveMemoryWikiConfig({ retrieval: value as never })).toThrow();
    expect(memoryWikiConfigSchema.safeParse?.({ retrieval: value })).toMatchObject({
      success: false,
    });
  });

  it("persists pause, keeps current owner pins, and resumes edits after restart", async () => {
    const f = await fixture(),
      first = f.make();
    await writeFile(f.file, f.raw(1, "RAG12_INITIAL"));
    await first.service.enable(f.identity);
    await first.service.idle(f.identity);
    const generation = first.service.status(f.identity).sources[0].activeGeneration;
    await first.service.pause(f.identity);
    expect(first.service.status(f.identity)).toMatchObject({
      status: "paused",
      activeWorker: false,
    });
    expect(first.service.status(f.identity).sources[0].activeGeneration).toBe(generation);
    expect(
      (await first.service.search(f.identity, "RAG12_INITIAL")).candidates.length,
    ).toBeGreaterThan(0);
    await writeFile(f.file, f.raw(2, "RAG12_UPDATED"));
    await first.service.reconcile(f.identity);
    expect(first.service.status(f.identity).lagCount).toBe(1);
    expect((await first.service.search(f.identity, "RAG12_INITIAL")).candidates).toHaveLength(0);
    await first.service.stop();
    await writeFile(f.file, f.raw(3, "RAG12_WHILE_STOPPED"));
    const restored = f.make();
    await restored.service.start();
    expect(restored.service.status(f.identity)).toMatchObject({
      status: "paused",
      activeWorker: false,
      workerThreadIds: [],
    });
    expect(restored.service.status(f.identity).sources.every((source) => !source.eligible)).toBe(true);
    await restored.service.resume(f.identity);
    await restored.service.idle(f.identity);
    expect(
      (await restored.service.search(f.identity, "RAG12_WHILE_STOPPED")).candidates.length,
    ).toBeGreaterThan(0);
    await restored.service.pause(f.identity);
    await writeFile(f.file, f.raw(4, "RAG12_WHILE_STOPPED", "acl:\n  read: [other]\n"));
    expect((await restored.service.search(f.identity, "RAG12_WHILE_STOPPED")).candidates).toHaveLength(0);
    await restored.service.resume(f.identity);
    await unlink(f.file);
    await restored.service.reconcile(f.identity);
    await restored.service.idle(f.identity);
    expect(restored.service.status(f.identity)).toMatchObject({
      logicalDeletedCount: 1,
      cleanupPendingGenerations: 0,
    });
    expect(restored.errors).toEqual([]);
  }, 120000);

  it("keeps paused observation bounded and renews expired work only on resume", async () => {
    const f = await fixture(), { service } = f.make();
    await writeFile(f.file, f.raw(1, "RAG12_PAUSED_TTL"));
    await service.enable(f.identity);
    await service.idle(f.identity);
    await service.pause(f.identity);
    await writeFile(f.file, f.raw(2, "RAG12_PAUSED_CHANGED"));
    await service.reconcile(f.identity);
    const before = service.status(f.identity);
    openOpenClawStateDatabase().db.exec("UPDATE knowledge_index_jobs SET deadline_at = 0 WHERE state = 'pending'");
    await service.reconcile(f.identity);
    await service.reconcile(f.identity);
    expect(service.status(f.identity).jobs.map(job => job.jobId)).toEqual(before.jobs.map(job => job.jobId));
    expect(service.status(f.identity).sources[0].intentSequence).toBe(before.sources[0].intentSequence);
    await service.resume(f.identity);
    await service.idle(f.identity);
    expect((await service.search(f.identity, "RAG12_PAUSED_CHANGED")).candidates.length).toBeGreaterThan(0);
  }, 120000);

  it("preserves the pause intent when a vector service enables the same owner again", async () => {
    const f = await fixture(), { service } = f.make();
    await writeFile(f.file, f.raw(1, "RAG12_VECTOR_PAUSED"));
    await service.enable(f.identity);
    await service.idle(f.identity);
    const generation = service.status(f.identity).sources[0].activeGeneration;
    await service.pause(f.identity);
    await service.enable(structuredClone(f.identity));
    expect(service.status(f.identity)).toMatchObject({ status: "paused", activeWorker: false });
    expect(service.status(f.identity).sources[0].activeGeneration).toBe(generation);
    await service.stop();
    const restored = f.make().service;
    await restored.start();
    await restored.enable(structuredClone(f.identity));
    expect(restored.status(f.identity).status).toBe("paused");
  }, 120000);

  it("hides foreign index inventory and requires explicit owner selection for mutations", async () => {
    const f = await fixture(),
      { service } = f.make();
    await writeFile(f.file, f.raw(1, "RAG12_OWNER"));
    await service.enable(f.identity);
    await service.idle(f.identity);
    const foreign = { ...f.identity, workspaceId: "other" };
    expect(service.status(foreign)).toMatchObject({
      status: "disabled",
      sources: [],
      jobs: [],
      storage: { bytes: null },
    });
    await expect(service.pause(foreign)).rejects.toThrow(/scope/);
    await expect(service.resume(foreign)).rejects.toThrow(/scope/);
    await expect(service.search(foreign, "RAG12_OWNER")).rejects.toThrow(/scope/);
    expect(service.status(f.identity).sources[0].eligible).toBe(true);
  }, 120000);

  it("refuses over-budget publication and rebuilds after configuration rollback", async () => {
    const f = await fixture(),
      initial = f.make();
    const original = f.raw(1, "RAG12_BUDGET");
    await writeFile(f.file, original);
    await initial.service.enable(f.identity);
    await initial.service.idle(f.identity);
    await initial.service.stop();
    const db = openOpenClawStateDatabase().db;
    db.exec("CREATE TABLE agent_rag12_storage_fixture (bytes BLOB)");
    db.prepare("INSERT INTO agent_rag12_storage_fixture VALUES (zeroblob(?))").run(2 * 1024 ** 2);
    const limited = f.make(1024 ** 2);
    await limited.service.start();
    await limited.service.reconcile(f.identity, true);
    await limited.service.idle(f.identity);
    expect(limited.service.status(f.identity)).toMatchObject({
      status: "degraded",
      storage: { budgetExceeded: true },
    });
    expect(
      limited.service
        .status(f.identity)
        .jobs.some((job) => job.error === "index-storage-budget-exceeded"),
    ).toBe(true);
    expect(await readFile(f.file, "utf8")).toBe(original);
    await limited.service.stop();
    const rollback = f.make();
    await rollback.service.start();
    await rollback.service.reconcile(f.identity, true);
    await rollback.service.idle(f.identity);
    expect(rollback.service.status(f.identity).status).toBe("running");
    expect(
      (await rollback.service.search(f.identity, "RAG12_BUDGET")).candidates.length,
    ).toBeGreaterThan(0);
    expect(await readFile(f.file, "utf8")).toBe(original);
    expect(rollback.errors).toEqual([]);
  }, 120000);

  it("rejects new generation growth when the database began below its budget", async () => {
    const f = await fixture(), { service, errors } = f.make(1024 ** 2);
    await writeFile(f.file, f.raw(1, "RAG12_GROWTH owner controlled publication.\n".repeat(5000)));
    await service.enable(f.identity);
    await service.idle(f.identity);
    expect(service.status(f.identity).sources.every(source => !source.eligible)).toBe(true);
    expect(service.status(f.identity).jobs.some(job => job.error === "index-storage-budget-exceeded")).toBe(true);
    expect((await service.search(f.identity, "RAG12_GROWTH")).candidates).toEqual([]);
    expect(errors.some(error => error === "index-storage-budget-exceeded")).toBe(true);
  }, 120000);

  it("uses canonical default profile while explicit requests override it", async () => {
    const f = await fixture(),
      { service, config } = f.make();
    await writeFile(f.file, f.raw(1, "RAG12_PROFILE"));
    await service.enable(f.identity);
    await service.idle(f.identity);
    config.retrieval = normalizeProjectRagConfig({ profile: "quality" });
    const run = (profile?: "local" | "quality") =>
      retrieveMemoryWiki({
        config,
        identity: f.identity,
        query: "RAG12_PROFILE",
        projection: service,
        profile,
      });
    expect((await run()).plan.profile).toBe("quality");
    expect((await run("local")).plan.profile).toBe("local");
  }, 120000);
});
