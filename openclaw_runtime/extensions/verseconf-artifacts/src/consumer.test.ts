import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { VerseConfComputeEngine } from "./engine.js";
import { createVerseConfTools } from "./tools.js";
import { VerseConfArtifactStore } from "./store.js";
import type { ArtifactOperation } from "./types.js";

const fixturePath = new URL("../fixtures/research-before.json", import.meta.url);

async function setup() {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "verseconf-consumer-"));
  const sourcePath = "research.json";
  await writeFile(path.join(workspaceDir, sourcePath), await readFile(fixturePath), "utf8");
  const store = new VerseConfArtifactStore({ path: path.join(workspaceDir, ".state", "artifacts.sqlite") });
  const engine = new VerseConfComputeEngine();
  const context: OpenClawPluginToolContext = {
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
      context: { workspaceDir: env.workspaceDir, sessionKey: env.context.sessionKey, sessionId: env.context.sessionId, agentId: env.context.agentId },
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    env.store.insertOperation(prepared, "prepared-key");
    env.store.close();

    const reopened = new VerseConfArtifactStore({ path: path.join(env.workspaceDir, ".state", "artifacts.sqlite") });
    expect(reopened.reconcilePreparedOperations()).toEqual([{ operationId: "prepared-op", artifactId: "artifact-recovery", state: "recovery_required" }]);
    expect(reopened.getOperationByIdempotency("artifact-recovery", "prepared-key")?.state).toBe("recovery_required");
    reopened.disableArtifact("artifact-recovery", env.context);
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
