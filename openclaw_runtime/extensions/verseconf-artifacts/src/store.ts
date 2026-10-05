import { DatabaseSync } from "node:sqlite";
import { closeVerseConfStateDatabase, openVerseConfStateDatabase, runVerseConfStateWriteTransaction, type VerseConfStateDatabaseOptions } from "./state-db.js";
import type {
  ArtifactContext,
  ArtifactKind,
  ArtifactListResult,
  ArtifactOperation,
  ArtifactOutput,
  ArtifactRecord,
  ArtifactRevision,
  SchemaIdentity,
} from "./types.js";

const STORE_SCHEMA_VERSION = 1;
const MAX_ARTIFACTS = 256;
const MAX_REVISIONS_PER_ARTIFACT = 512;
const MAX_OUTPUTS_PER_REVISION = 32;

type Row = Record<string, unknown>;

function json(value: unknown): string {
  return JSON.stringify(value);
}

function parse<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value) throw new Error(`verseconf sqlite row missing ${key}`);
  return value;
}

function optionalText(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value ? value : null;
}

function integer(row: Row, key: string): number {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`verseconf sqlite row missing ${key}`);
}


function operationFromRow(row: Row): ArtifactOperation {
  return {
    operationId: text(row, "operation_id"),
    artifactId: text(row, "artifact_id"),
    kind: text(row, "kind") as ArtifactOperation["kind"],
    state: text(row, "state") as ArtifactOperation["state"],
    request: parse(row.request_json, {}),
    beforeSha256: optionalText(row, "before_sha256"),
    candidateSha256: optionalText(row, "candidate_sha256"),
    afterSha256: optionalText(row, "after_sha256"),
    journalRef: optionalText(row, "journal_ref"),
    recoveryRef: optionalText(row, "recovery_ref"),
    context: parse(row.context_json, {} as ArtifactOperation["context"]),
    createdAt: integer(row, "created_at"),
    updatedAt: integer(row, "updated_at"),
  };
}

export class VerseConfArtifactStore {
  readonly db: DatabaseSync;
  readonly path: string;

  constructor(options: { env?: NodeJS.ProcessEnv; path?: string } = {}) {
    const dbOptions: VerseConfStateDatabaseOptions = {
      ...(options.env ? { env: options.env } : {}),
      ...(options.path ? { path: options.path } : {}),
    };
    const database = openVerseConfStateDatabase(dbOptions);
    this.path = database.path;
    this.db = database.db;
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.ensureSchema();
  }

  close(): void {
    closeVerseConfStateDatabase(this.db);
  }

  private transaction<T>(fn: () => T): T {
    return runVerseConfStateWriteTransaction(this.db, () => fn());
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS verseconf_schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS verseconf_artifacts (
        artifact_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        workspace_dir TEXT NOT NULL,
        source_path TEXT NOT NULL,
        current_revision_id TEXT NOT NULL,
        schema_text TEXT NOT NULL,
        schema_identity_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        disabled_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS verseconf_revisions (
        revision_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES verseconf_artifacts(artifact_id),
        sequence INTEGER NOT NULL,
        parent_revision_id TEXT,
        source_text TEXT NOT NULL,
        source_sha256 TEXT NOT NULL,
        schema_identity_json TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        journal_ref TEXT,
        status TEXT NOT NULL,
        context_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(artifact_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS idx_verseconf_revisions_artifact
        ON verseconf_revisions(artifact_id, sequence DESC);
      CREATE TABLE IF NOT EXISTS verseconf_operations (
        operation_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES verseconf_artifacts(artifact_id),
        idempotency_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        state TEXT NOT NULL,
        request_json TEXT NOT NULL,
        before_sha256 TEXT,
        candidate_sha256 TEXT,
        after_sha256 TEXT,
        journal_ref TEXT,
        recovery_ref TEXT,
        context_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(artifact_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS verseconf_outputs (
        output_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES verseconf_artifacts(artifact_id),
        revision_id TEXT NOT NULL REFERENCES verseconf_revisions(revision_id),
        format TEXT NOT NULL,
        renderer_version TEXT NOT NULL,
        output_path TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        journal_ref TEXT,
        validation_status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_verseconf_outputs_revision
        ON verseconf_outputs(artifact_id, revision_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS verseconf_events (
        event_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES verseconf_artifacts(artifact_id),
        revision_id TEXT,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    this.ensureOutputJournalColumn();
    const existingVersion = this.db.prepare("SELECT value FROM verseconf_schema_meta WHERE key = 'version'").get() as Row | undefined;
    if (existingVersion && Number(existingVersion.value) > STORE_SCHEMA_VERSION) {
      throw new Error(`unsupported verseconf artifact store schema version: ${String(existingVersion.value)}`);
    }
    this.db.prepare(
      `INSERT INTO verseconf_schema_meta(key, value, updated_at) VALUES('version', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(String(STORE_SCHEMA_VERSION), Date.now());
  }

  assertArtifactCapacity(): void {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM verseconf_artifacts").get() as Row;
    if (integer(row, "count") >= MAX_ARTIFACTS) throw new Error(`artifact capacity exceeded (${MAX_ARTIFACTS})`);
  }

  assertRevisionCapacity(artifactId: string): void {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM verseconf_revisions WHERE artifact_id = ?").get(artifactId) as Row;
    if (integer(row, "count") >= MAX_REVISIONS_PER_ARTIFACT) throw new Error(`revision capacity exceeded (${MAX_REVISIONS_PER_ARTIFACT})`);
  }

  assertOutputCapacity(artifactId: string, revisionId: string): void {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM verseconf_outputs WHERE artifact_id = ? AND revision_id = ?").get(artifactId, revisionId) as Row;
    if (integer(row, "count") >= MAX_OUTPUTS_PER_REVISION) throw new Error(`output capacity exceeded (${MAX_OUTPUTS_PER_REVISION})`);
  }

  createArtifact(params: {
    artifactId: string;
    kind: ArtifactKind;
    context: ArtifactContext;
    sourcePath: string;
    schemaText: string;
    schemaIdentity: SchemaIdentity;
    revision: Omit<ArtifactRevision, "artifactId">;
    operation: ArtifactOperation;
    idempotencyKey: string;
  }): ArtifactRecord {
    const now = Date.now();
    return this.transaction(() => {
      this.assertArtifactCapacity();
      this.db.prepare(`INSERT INTO verseconf_artifacts
        (artifact_id, kind, workspace_dir, source_path, current_revision_id, schema_text, schema_identity_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(params.artifactId, params.kind, params.context.workspaceDir, params.sourcePath,
          params.revision.revisionId, params.schemaText, json(params.schemaIdentity), now, now);
      this.insertRevision({ artifactId: params.artifactId, ...params.revision });
      this.insertOperation(params.operation, params.idempotencyKey);
      this.insertEvent(params.artifactId, params.revision.revisionId, "artifact.created", {
        actor: params.context.agentId, sessionKey: params.context.sessionKey,
      });
      return this.getArtifact(params.artifactId)!;
    });
  }

  getArtifact(artifactId: string): ArtifactRecord | null {
    const row = this.db.prepare("SELECT * FROM verseconf_artifacts WHERE artifact_id = ?").get(artifactId) as Row | undefined;
    if (!row) return null;
    return {
      artifactId: text(row, "artifact_id"),
      kind: text(row, "kind") as ArtifactKind,
      workspaceDir: text(row, "workspace_dir"),
      sourcePath: text(row, "source_path"),
      currentRevisionId: text(row, "current_revision_id"),
      schemaText: text(row, "schema_text"),
      schemaIdentity: parse(row.schema_identity_json, {} as SchemaIdentity),
      createdAt: integer(row, "created_at"),
      updatedAt: integer(row, "updated_at"),
      ...(typeof row.disabled_at === "number" ? { disabledAt: row.disabled_at } : {}),
    };
  }

  listArtifacts(workspaceDir?: string): ArtifactListResult {
    const rows = (workspaceDir
      ? this.db.prepare("SELECT artifact_id, kind, source_path, current_revision_id, updated_at, disabled_at FROM verseconf_artifacts WHERE workspace_dir = ? ORDER BY updated_at DESC").all(workspaceDir)
      : this.db.prepare("SELECT artifact_id, kind, source_path, current_revision_id, updated_at, disabled_at FROM verseconf_artifacts ORDER BY updated_at DESC").all()) as Row[];
    return {
      artifacts: rows.map((row) => ({
        artifactId: text(row, "artifact_id"),
        kind: text(row, "kind") as ArtifactKind,
        sourcePath: text(row, "source_path"),
        currentRevisionId: text(row, "current_revision_id"),
        updatedAt: integer(row, "updated_at"),
        ...(typeof row.disabled_at === "number" ? { disabledAt: row.disabled_at } : {}),
      })),
    };
  }

  getRevision(revisionId: string): ArtifactRevision | null {
    const row = this.db.prepare("SELECT * FROM verseconf_revisions WHERE revision_id = ?").get(revisionId) as Row | undefined;
    if (!row) return null;
    return {
      revisionId: text(row, "revision_id"),
      artifactId: text(row, "artifact_id"),
      sequence: integer(row, "sequence"),
      parentRevisionId: optionalText(row, "parent_revision_id"),
      sourceText: text(row, "source_text"),
      sourceSha256: text(row, "source_sha256"),
      schemaIdentity: parse(row.schema_identity_json, {} as SchemaIdentity),
      operationId: text(row, "operation_id"),
      journalRef: optionalText(row, "journal_ref"),
      status: text(row, "status") as ArtifactRevision["status"],
      context: parse(row.context_json, {} as ArtifactRevision["context"]),
      createdAt: integer(row, "created_at"),
    };
  }

  listRevisions(artifactId: string): ArtifactRevision[] {
    const rows = this.db.prepare("SELECT revision_id FROM verseconf_revisions WHERE artifact_id = ? ORDER BY sequence DESC").all(artifactId) as Row[];
    return rows.flatMap((row) => {
      const revision = this.getRevision(text(row, "revision_id"));
      return revision ? [revision] : [];
    });
  }

  getOperationByIdempotency(artifactId: string, idempotencyKey: string): ArtifactOperation | null {
    const row = this.db.prepare("SELECT * FROM verseconf_operations WHERE artifact_id = ? AND idempotency_key = ?").get(artifactId, idempotencyKey) as Row | undefined;
    return row ? operationFromRow(row) : null;
  }

  insertOperation(operation: ArtifactOperation, idempotencyKey: string): void {
    this.db.prepare(`INSERT OR REPLACE INTO verseconf_operations
      (operation_id, artifact_id, idempotency_key, kind, state, request_json, before_sha256, candidate_sha256, after_sha256, journal_ref, recovery_ref, context_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(operation.operationId, operation.artifactId, idempotencyKey, operation.kind, operation.state, json(operation.request), operation.beforeSha256,
        operation.candidateSha256, operation.afterSha256, operation.journalRef, operation.recoveryRef, json(operation.context), operation.createdAt, operation.updatedAt);
  }

  reconcilePreparedOperations(): Array<{ operationId: string; artifactId: string; state: "recovery_required" }> {
    const rows = this.db.prepare("SELECT operation_id, artifact_id FROM verseconf_operations WHERE state = 'prepared'").all() as Row[];
    const reconciled: Array<{ operationId: string; artifactId: string; state: "recovery_required" }> = [];
    this.transaction(() => {
      for (const row of rows) {
        const operationId = text(row, "operation_id");
        const artifactId = text(row, "artifact_id");
        this.db.prepare("UPDATE verseconf_operations SET state = 'recovery_required', recovery_ref = ?, updated_at = ? WHERE operation_id = ?")
          .run(`startup-reconciliation:${operationId}`, Date.now(), operationId);
        this.insertEvent(artifactId, null, "artifact.operation.recovery_required", { operationId, reason: "prepared operation found after process restart; automatic replay is forbidden" });
        reconciled.push({ operationId, artifactId, state: "recovery_required" });
      }
    });
    return reconciled;
  }

  updateOperation(operationId: string, patch: Partial<ArtifactOperation>): void {
    const current = this.db.prepare("SELECT * FROM verseconf_operations WHERE operation_id = ?").get(operationId) as Row | undefined;
    if (!current) throw new Error(`operation not found: ${operationId}`);
    const next = { ...operationFromRow(current), ...patch, updatedAt: Date.now() };
    this.db.prepare(`UPDATE verseconf_operations SET state = ?, request_json = ?, before_sha256 = ?, candidate_sha256 = ?, after_sha256 = ?, journal_ref = ?, recovery_ref = ?, context_json = ?, updated_at = ? WHERE operation_id = ?`)
      .run(next.state, json(next.request), next.beforeSha256, next.candidateSha256, next.afterSha256, next.journalRef, next.recoveryRef, json(next.context), next.updatedAt, operationId);
  }

  commitRevision(params: { artifactId: string; revision: ArtifactRevision; operation: ArtifactOperation; idempotencyKey: string }): void {
    this.transaction(() => {
      this.assertRevisionCapacity(params.artifactId);
      this.insertRevision(params.revision);
      this.db.prepare("UPDATE verseconf_artifacts SET current_revision_id = ?, updated_at = ? WHERE artifact_id = ?")
        .run(params.revision.revisionId, Date.now(), params.artifactId);
      this.insertOperation(params.operation, params.idempotencyKey);
      this.insertEvent(params.artifactId, params.revision.revisionId, "artifact.revision.committed", {
        operationId: params.operation.operationId, sequence: params.revision.sequence,
      });
    });
  }

  addOutput(output: ArtifactOutput): void {
    this.assertOutputCapacity(output.artifactId, output.revisionId);
    this.db.prepare(`INSERT INTO verseconf_outputs
      (output_id, artifact_id, revision_id, format, renderer_version, output_path, content_sha256, bytes, journal_ref, validation_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(output.outputId, output.artifactId, output.revisionId, output.format, output.rendererVersion, output.path, output.contentSha256, output.bytes, output.journalRef, output.validationStatus, output.createdAt);
  }

  listOutputs(artifactId: string, revisionId?: string): ArtifactOutput[] {
    const rows = (revisionId
      ? this.db.prepare("SELECT * FROM verseconf_outputs WHERE artifact_id = ? AND revision_id = ? ORDER BY created_at DESC").all(artifactId, revisionId)
      : this.db.prepare("SELECT * FROM verseconf_outputs WHERE artifact_id = ? ORDER BY created_at DESC").all(artifactId)) as Row[];
    return rows.map((row) => ({
      outputId: text(row, "output_id"), artifactId: text(row, "artifact_id"), revisionId: text(row, "revision_id"),
      format: text(row, "format") as ArtifactOutput["format"], rendererVersion: text(row, "renderer_version"), path: text(row, "output_path"),
      contentSha256: text(row, "content_sha256"), bytes: integer(row, "bytes"), journalRef: optionalText(row, "journal_ref"), validationStatus: text(row, "validation_status") as ArtifactOutput["validationStatus"], createdAt: integer(row, "created_at"),
    }));
  }

  disableArtifact(artifactId: string, context: ArtifactContext): void {
    const now = Date.now();
    this.transaction(() => {
      this.db.prepare("UPDATE verseconf_artifacts SET disabled_at = ?, updated_at = ? WHERE artifact_id = ?").run(now, now, artifactId);
      this.insertEvent(artifactId, null, "artifact.disabled", { actor: context.agentId, sessionKey: context.sessionKey });
    });
  }

  private ensureOutputJournalColumn(): void {
    const columns = new Set((this.db.prepare("PRAGMA table_info(verseconf_outputs)").all() as Row[]).map((row) => row.name));
    if (!columns.has("journal_ref")) this.db.exec("ALTER TABLE verseconf_outputs ADD COLUMN journal_ref TEXT");
  }

  private insertRevision(revision: ArtifactRevision): void {
    this.db.prepare(`INSERT INTO verseconf_revisions
      (revision_id, artifact_id, sequence, parent_revision_id, source_text, source_sha256, schema_identity_json, operation_id, journal_ref, status, context_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(revision.revisionId, revision.artifactId, revision.sequence, revision.parentRevisionId, revision.sourceText, revision.sourceSha256, json(revision.schemaIdentity), revision.operationId, revision.journalRef, revision.status, json(revision.context), revision.createdAt);
  }

  private insertEvent(artifactId: string, revisionId: string | null, kind: string, payload: Record<string, unknown>): void {
    this.db.prepare("INSERT INTO verseconf_events(event_id, artifact_id, revision_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(`${Date.now()}-${Math.random().toString(16).slice(2)}`, artifactId, revisionId, kind, json(payload), Date.now());
  }
}
