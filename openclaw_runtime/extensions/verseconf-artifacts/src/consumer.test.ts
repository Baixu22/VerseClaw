import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VerseConfComputeEngine } from "./engine.js";
import { createVerseConfTools } from "./tools.js";
import { VerseConfArtifactStore } from "./store.js";
import type { ArtifactContext, ArtifactOperation } from "./types.js";
import type { VerseConfToolContext } from "./runtime.js";

const fixturePath = new URL("../fixtures/research-before.json", import.meta.url);

async function setup() {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "verseconf-consumer-"));
  const sourcePath = "research.json";
  await writeFile(path.join(workspaceDir, sourcePath), await readFile(fixturePath), "utf8");
  const store = new VerseConfArtifactStore({ path: path.join(workspaceDir, ".state", "artifacts.sqlite") });
  const engine = new VerseConfComputeEngine();
  const context: VerseConfToolContext = {
    workspaceDir,
    sessionKey: "agent:main:consumer",
    sessionId: "session-consumer",
    agentId: "main",
  };
  const tools = createVerseConfTools({ store, engine, api: {} as never, context });
  const byName = (name: string) => {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`missing tool ${name}`);
    return tool;
  };
  return { workspaceDir, sourcePath, store, engine, context, byName };
}

describe("VerseConf structured artifact runtime consumer", () => {
  it("compares complete nested revision requests after reopening the store", async () => {
    const env = await setup();
    let store = env.store;
    try {
      await env.byName("structured_artifact_create").execute("create-idempotency", { artifactId: "artifact-idempotency", kind: "research-table", sourcePath: env.sourcePath });
      type RevisionChange = {
        recordId: string;
        fieldPath: string[];
        op: string;
        expect: { kind: string; value: unknown };
        value: unknown;
      };
      const request: { artifactId: string; idempotencyKey: string; changes: RevisionChange[] } = {
        artifactId: "artifact-idempotency",
        idempotencyKey: "nested-revision-key",
        changes: [
          { recordId: "rec-managed", fieldPath: ["evidenceState"], op: "setValue", expect: { kind: "value", value: "unlinked" }, value: "linked" },
          { recordId: "rec-managed", fieldPath: ["evidenceRefs"], op: "setValue", expect: { kind: "value", value: [] }, value: ["src-synthetic-check"] },
        ],
      };
      const committed = await env.byName("structured_artifact_revise").execute("revise-idempotency", request);
      expect(committed).toMatchObject({ details: { ok: true, state: "committed" } });
      const source = await readFile(path.join(env.workspaceDir, env.sourcePath));
      const revisions = store.listRevisions(request.artifactId);
      const operation = store.getOperationByIdempotency(request.artifactId, request.idempotencyKey);
      store.close();
      store = new VerseConfArtifactStore({ path: path.join(env.workspaceDir, ".state", "artifacts.sqlite") });
      const revise = createVerseConfTools({ store, engine: env.engine, api: {} as never, context: env.context }).find((tool) => tool.name === "structured_artifact_revise")!;
      const reordered = {
        changes: request.changes.map((change) => ({ value: change.value, expect: { value: change.expect.value, kind: change.expect.kind }, op: change.op, fieldPath: change.fieldPath, recordId: change.recordId })),
        idempotencyKey: request.idempotencyKey,
        artifactId: request.artifactId,
      };
      expect(await revise.execute("same-request-reordered", reordered)).toEqual(committed);
      const first = request.changes[0]!;
      for (const changes of [
        [{ ...first, value: "unlinked" }, request.changes[1]],
        [{ ...first, expect: { kind: "value", value: "linked" } }, request.changes[1]],
        [{ ...first, recordId: "rec-baseline" }, request.changes[1]],
        [{ ...first, fieldPath: ["finding"] }, request.changes[1]],
        [...request.changes].reverse(),
      ]) {
        const rejected = await revise.execute("different-nested-request", { ...request, changes });
        expect(rejected).toMatchObject({ details: { ok: false, state: "rejected", diagnostics: [{ code: "idempotency_conflict" }] } });
        expect(await readFile(path.join(env.workspaceDir, env.sourcePath))).toEqual(source);
        expect(store.listRevisions(request.artifactId)).toEqual(revisions);
        expect(store.getOperationByIdempotency(request.artifactId, request.idempotencyKey)).toEqual(operation);
      }
    } finally {
      store.close();
      await env.engine.dispose();
      await rm(env.workspaceDir, { recursive: true, force: true });
    }
  });

  it("rejects a changed nested record under an existing record-operation key", async () => {
    const env = await setup();
    try {
      await env.byName("structured_artifact_create").execute("create-record-idempotency", { artifactId: "artifact-record-idempotency", kind: "research-table", sourcePath: env.sourcePath });
      const record = { id: "rec-inserted", subject: "Agent fixture", finding: "Original finding", evidenceState: "unlinked", evidenceRefs: [], limitations: null };
      const request = { artifactId: "artifact-record-idempotency", idempotencyKey: "nested-record-key", operations: [{ op: "insertRecord", record, afterId: "rec-managed" }] };
      const tool = env.byName("structured_artifact_record_ops");
      const committed = await tool.execute("record-idempotency", request);
      expect(committed).toMatchObject({ details: { ok: true, state: "committed" } });
      expect(await tool.execute("same-record-request", request)).toEqual(committed);
      const source = await readFile(path.join(env.workspaceDir, env.sourcePath));
      const rejected = await tool.execute("different-record-request", { ...request, operations: [{ ...request.operations[0], record: { ...record, finding: "Different finding" } }] });
      expect(rejected).toMatchObject({ details: { ok: false, state: "rejected", diagnostics: [{ code: "idempotency_conflict" }] } });
      expect(await readFile(path.join(env.workspaceDir, env.sourcePath))).toEqual(source);
      expect(env.store.listRevisions(request.artifactId)).toHaveLength(2);
    } finally {
      env.store.close();
      await env.engine.dispose();
      await rm(env.workspaceDir, { recursive: true, force: true });
    }
  });

  it("runs create -> revise -> history -> export -> restore through tool factories", async () => {
    const env = await setup();
    const create = await env.byName("structured_artifact_create").execute("create-1", {
      artifactId: "artifact-research",
      kind: "research-table",
      sourcePath: env.sourcePath,
    });
    expect(JSON.stringify(create)).toMatch(/"state":"(?:committed|unchanged)"/);

    const first = env.store.getArtifact("artifact-research");
    expect(first?.currentRevisionId).toBeTruthy();
    const firstRevision = env.store.getRevision(first!.currentRevisionId)!;

    const revise = await env.byName("structured_artifact_revise").execute("revise-1", {
      artifactId: "artifact-research",
      baseRevisionId: firstRevision.revisionId,
      idempotencyKey: "revise-key-1",
      changes: [
        { recordId: "rec-managed", fieldPath: ["evidenceState"], op: "setValue", expect: { kind: "value", value: "unlinked" }, value: "linked" },
        { recordId: "rec-managed", fieldPath: ["evidenceRefs"], op: "setValue", expect: { kind: "value", value: [] }, value: ["src-synthetic-check"] },
      ],
    });
    expect(JSON.stringify(revise)).toContain('"state":"committed"');
    const after = env.store.getArtifact("artifact-research")!;
    const secondRevision = env.store.getRevision(after.currentRevisionId)!;
    expect(secondRevision.sequence).toBe(2);
    expect(secondRevision.sourceText).toContain('"linked"');

    const replay = await env.byName("structured_artifact_revise").execute("revise-retry", {
      artifactId: "artifact-research",
      baseRevisionId: firstRevision.revisionId,
      idempotencyKey: "revise-key-1",
      changes: [
        { recordId: "rec-managed", fieldPath: ["evidenceState"], op: "setValue", expect: { kind: "value", value: "unlinked" }, value: "linked" },
        { recordId: "rec-managed", fieldPath: ["evidenceRefs"], op: "setValue", expect: { kind: "value", value: [] }, value: ["src-synthetic-check"] },
      ],
    });
    expect(JSON.stringify(replay)).toContain('"state":"committed"');
    expect(env.store.listRevisions("artifact-research")).toHaveLength(2);

    const exported = await env.byName("structured_artifact_export").execute("export-1", { artifactId: "artifact-research", format: "xlsx" });
    expect(JSON.stringify(exported)).toContain('"format":"xlsx"');
    expect(env.store.listOutputs("artifact-research")).toHaveLength(1);

    const restored = await env.byName("structured_artifact_restore").execute("restore-1", { artifactId: "artifact-research", revisionId: firstRevision.revisionId, idempotencyKey: "restore-key-1" });
    expect(JSON.stringify(restored)).toContain('"state":"committed"');
    expect(env.store.listRevisions("artifact-research")).toHaveLength(3);

    env.store.close();
    const reopened = new VerseConfArtifactStore({ path: path.join(env.workspaceDir, ".state", "artifacts.sqlite") });
    expect(reopened.listRevisions("artifact-research")).toHaveLength(3);
    expect(reopened.listOutputs("artifact-research")).toHaveLength(1);
    reopened.close();
    await env.engine.dispose();
  });


  it("reconciles prepared operations, rejects unknown schema versions, and preserves disabled history", async () => {
    const env = await setup();
    await env.byName("structured_artifact_create").execute("create-recovery", { artifactId: "artifact-recovery", kind: "research-table", sourcePath: env.sourcePath });
    const artifact = env.store.getArtifact("artifact-recovery")!;
    const revision = env.store.getRevision(artifact.currentRevisionId)!;
    const prepared: ArtifactOperation = {
      operationId: "prepared-op", artifactId: artifact.artifactId, kind: "revise", state: "prepared", request: { source: "test" },
      beforeSha256: revision.sourceSha256, candidateSha256: revision.sourceSha256, afterSha256: null, journalRef: "write-journal:test", recoveryRef: null,
      context: { workspaceDir: env.workspaceDir, sessionKey: env.context.sessionKey!, sessionId: env.context.sessionId!, agentId: env.context.agentId! },
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    env.store.insertOperation(prepared, "prepared-key");
    env.store.close();

    const reopened = new VerseConfArtifactStore({ path: path.join(env.workspaceDir, ".state", "artifacts.sqlite") });
    expect(reopened.reconcilePreparedOperations()).toEqual([{ operationId: "prepared-op", artifactId: "artifact-recovery", state: "recovery_required" }]);
    expect(reopened.getOperationByIdempotency("artifact-recovery", "prepared-key")?.state).toBe("recovery_required");
    const artifactContext: ArtifactContext = {
      workspaceDir: env.context.workspaceDir!,
      sessionKey: env.context.sessionKey!,
      sessionId: env.context.sessionId!,
      agentId: env.context.agentId!,
      requestId: "disable-recovery",
    };
    reopened.disableArtifact("artifact-recovery", artifactContext);
    expect(reopened.getArtifact("artifact-recovery")?.disabledAt).toBeTypeOf("number");
    expect(reopened.listRevisions("artifact-recovery")).toHaveLength(1);
    reopened.db.prepare("UPDATE verseconf_schema_meta SET value = '999' WHERE key = 'version'").run();
    reopened.close();
    expect(() => new VerseConfArtifactStore({ path: path.join(env.workspaceDir, ".state", "artifacts.sqlite") })).toThrow(/unsupported verseconf artifact store schema version/);
    await env.engine.dispose();
  });

  it("rejects external source drift and does not overwrite it", async () => {
    const env = await setup();
    await env.byName("structured_artifact_create").execute("create-2", { artifactId: "artifact-drift", kind: "research-table", sourcePath: env.sourcePath });
    await writeFile(path.join(env.workspaceDir, env.sourcePath), "{\"external\":true}\n", "utf8");
    await expect(env.byName("structured_artifact_inspect").execute("inspect-drift", { artifactId: "artifact-drift" })).rejects.toThrow(/drifted/);
    env.store.close();
    await env.engine.dispose();
  });
});
