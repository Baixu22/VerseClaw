// Semantic rewrite of ragcode-context-engine's src/graph/sqlite-statements.ts (MIT),
// https://github.com/MarshallEriksen-Neura/ragcode — schema + prepared statement pool
// for the FactStore. All SQL lives here (single source of truth for schema access).
//
// Deltas vs ragcode (SPEC §4):
// - files gains the provenance/heat safety-belt columns
//   producer / produced_hash / touch_count / last_touch_ms (§4.1).
// - ragcode's watcher machinery (dirty_files/watcher_state) and the semantic_* project
//   columns are not carried over: T1 has no watcher and the embedding layer is frozen out.
import type { DatabaseSync, StatementSync } from "node:sqlite";

export const FACTSTORE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projects (
    project_id TEXT PRIMARY KEY,
    repo_root TEXT NOT NULL,
    canonical_root TEXT,
    display_name TEXT,
    created_at_ms INTEGER,
    last_indexed_at_ms INTEGER,
    index_generation INTEGER,
    indexed_at_ms INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS files (
    project_id TEXT NOT NULL,
    path TEXT NOT NULL,
    absolute_path TEXT NOT NULL,
    language TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    modified_at_ms REAL NOT NULL,
    indexed_at_ms INTEGER NOT NULL,
    status TEXT NOT NULL,
    generation INTEGER NOT NULL,
    producer TEXT NOT NULL DEFAULT 'unknown',
    produced_hash TEXT NOT NULL DEFAULT '',
    touch_count INTEGER NOT NULL DEFAULT 0,
    last_touch_ms INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(project_id, path)
  );
  CREATE TABLE IF NOT EXISTS symbols (
    project_id TEXT NOT NULL,
    id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    language TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    signature TEXT,
    exported INTEGER NOT NULL,
    generation INTEGER NOT NULL,
    PRIMARY KEY(project_id, id)
  );
  CREATE TABLE IF NOT EXISTS edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    file_path TEXT,
    generation INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chunks (
    project_id TEXT NOT NULL,
    id TEXT NOT NULL,
    repo_root TEXT NOT NULL,
    file_path TEXT NOT NULL,
    language TEXT NOT NULL,
    kind TEXT NOT NULL,
    symbol_name TEXT,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    generation INTEGER NOT NULL,
    PRIMARY KEY(project_id, id)
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(project_id UNINDEXED, id UNINDEXED, file_path, symbol_name, content);
  CREATE TABLE IF NOT EXISTS skipped_files (
    project_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    reason TEXT NOT NULL,
    PRIMARY KEY(project_id, file_path)
  );
  CREATE INDEX IF NOT EXISTS idx_files_project_touch ON files(project_id, last_touch_ms);
  CREATE INDEX IF NOT EXISTS idx_symbols_project_name ON symbols(project_id, name);
  CREATE INDEX IF NOT EXISTS idx_symbols_project_file ON symbols(project_id, file_path);
  CREATE INDEX IF NOT EXISTS idx_edges_project_kind ON edges(project_id, kind);
  CREATE INDEX IF NOT EXISTS idx_edges_project_file ON edges(project_id, file_path);
  CREATE INDEX IF NOT EXISTS idx_chunks_project_file ON chunks(project_id, file_path);
  CREATE INDEX IF NOT EXISTS idx_projects_repo_root ON projects(repo_root);
  CREATE INDEX IF NOT EXISTS idx_projects_canonical_root ON projects(canonical_root);
`;

export function migrateFactStoreSchema(db: DatabaseSync): void {
  db.exec(FACTSTORE_SCHEMA_SQL);
}

/** Prepared statement pool for FactStore. */
export class FactStoreStatements {
  readonly upsertProject: StatementSync;
  readonly selectProjectByRoot: StatementSync;
  readonly listProjects: StatementSync;

  readonly selectFile: StatementSync;
  readonly selectFilesByProject: StatementSync;
  readonly insertFile: StatementSync;
  readonly deleteFile: StatementSync;
  readonly touchFile: StatementSync;
  readonly observeContentHash: StatementSync;

  readonly selectSymbolsByFile: StatementSync;
  readonly selectSymbolByNameLike: StatementSync;
  readonly selectSymbolProvenance: StatementSync;
  readonly insertSymbol: StatementSync;
  readonly deleteSymbolsByFile: StatementSync;
  readonly countSymbols: StatementSync;

  readonly selectEdgesByFile: StatementSync;
  readonly selectEdgesByKind: StatementSync;
  readonly insertEdge: StatementSync;
  readonly deleteEdgesByFile: StatementSync;

  readonly selectChunksByFile: StatementSync;
  readonly insertChunk: StatementSync;
  readonly deleteChunksByFile: StatementSync;

  readonly searchFts: StatementSync;
  readonly insertFts: StatementSync;
  readonly deleteFtsByFile: StatementSync;

  readonly selectSkippedFiles: StatementSync;
  readonly upsertSkippedFile: StatementSync;
  readonly deleteSkippedFile: StatementSync;

  constructor(db: DatabaseSync) {
    this.upsertProject = db.prepare(
      `INSERT INTO projects(
        project_id, repo_root, canonical_root, display_name,
        created_at_ms, last_indexed_at_ms, index_generation, indexed_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        repo_root = excluded.repo_root,
        canonical_root = excluded.canonical_root,
        display_name = excluded.display_name,
        created_at_ms = COALESCE(projects.created_at_ms, excluded.created_at_ms),
        last_indexed_at_ms = excluded.last_indexed_at_ms,
        index_generation = COALESCE(projects.index_generation, excluded.index_generation),
        indexed_at_ms = excluded.indexed_at_ms`,
    );
    this.selectProjectByRoot = db.prepare(
      `SELECT * FROM projects
       WHERE lower(repo_root) = lower(?) OR lower(COALESCE(canonical_root, repo_root)) = lower(?)
       ORDER BY indexed_at_ms DESC
       LIMIT 1`,
    );
    this.listProjects = db.prepare(
      "SELECT * FROM projects ORDER BY lower(COALESCE(canonical_root, repo_root)), project_id",
    );

    this.selectFile = db.prepare("SELECT * FROM files WHERE project_id = ? AND path = ?");
    this.selectFilesByProject = db.prepare("SELECT * FROM files WHERE project_id = ? ORDER BY path");
    this.insertFile = db.prepare(
      `INSERT INTO files(
        project_id, path, absolute_path, language, size_bytes, content_hash,
        modified_at_ms, indexed_at_ms, status, generation,
        producer, produced_hash, touch_count, last_touch_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.deleteFile = db.prepare("DELETE FROM files WHERE project_id = ? AND path = ?");
    this.touchFile = db.prepare(
      "UPDATE files SET touch_count = touch_count + 1, last_touch_ms = ? WHERE project_id = ? AND path = ?",
    );
    // Records the currently observed content hash; flips status to stale when it no
    // longer matches the hash the facts were produced from (§4.3 hash-compare gate).
    this.observeContentHash = db.prepare(
      `UPDATE files
       SET content_hash = ?,
           status = CASE WHEN produced_hash = ? THEN 'fresh' ELSE 'stale' END
       WHERE project_id = ? AND path = ?`,
    );

    this.selectSymbolsByFile = db.prepare(
      "SELECT * FROM symbols WHERE project_id = ? AND file_path = ? ORDER BY start_line",
    );
    this.selectSymbolByNameLike = db.prepare(
      "SELECT * FROM symbols WHERE project_id = ? AND lower(name) LIKE ? ESCAPE '\\' ORDER BY name",
    );
    this.selectSymbolProvenance = db.prepare(
      `SELECT s.id AS symbol_id, s.name AS symbol_name, s.file_path AS file_path,
              f.producer AS producer, f.produced_hash AS produced_hash, f.content_hash AS content_hash
       FROM symbols s
       JOIN files f ON f.project_id = s.project_id AND f.path = s.file_path
       WHERE s.project_id = ? AND s.id = ?`,
    );
    this.insertSymbol = db.prepare(
      "INSERT INTO symbols(project_id, id, file_path, name, kind, language, start_line, end_line, signature, exported, generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    this.deleteSymbolsByFile = db.prepare("DELETE FROM symbols WHERE project_id = ? AND file_path = ?");
    this.countSymbols = db.prepare("SELECT COUNT(*) AS count FROM symbols WHERE project_id = ?");

    this.selectEdgesByFile = db.prepare(
      "SELECT * FROM edges WHERE project_id = ? AND file_path = ? ORDER BY id",
    );
    this.selectEdgesByKind = db.prepare(
      "SELECT * FROM edges WHERE project_id = ? AND kind = ? ORDER BY id",
    );
    this.insertEdge = db.prepare(
      "INSERT INTO edges(project_id, source_id, target_id, kind, metadata_json, file_path, generation) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    this.deleteEdgesByFile = db.prepare("DELETE FROM edges WHERE project_id = ? AND file_path = ?");

    this.selectChunksByFile = db.prepare(
      "SELECT * FROM chunks WHERE project_id = ? AND file_path = ? ORDER BY start_line",
    );
    this.insertChunk = db.prepare(
      "INSERT INTO chunks(project_id, id, repo_root, file_path, language, kind, symbol_name, start_line, end_line, content, content_hash, generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    this.deleteChunksByFile = db.prepare("DELETE FROM chunks WHERE project_id = ? AND file_path = ?");

    this.searchFts = db.prepare(
      `SELECT c.*, bm25(chunks_fts) AS rank
       FROM chunks_fts
       JOIN chunks c ON c.project_id = chunks_fts.project_id AND c.id = chunks_fts.id
       WHERE chunks_fts.project_id = ? AND chunks_fts MATCH ?
       ORDER BY rank, c.file_path, c.start_line
       LIMIT ?`,
    );
    this.insertFts = db.prepare(
      "INSERT INTO chunks_fts(project_id, id, file_path, symbol_name, content) VALUES (?, ?, ?, ?, ?)",
    );
    this.deleteFtsByFile = db.prepare("DELETE FROM chunks_fts WHERE project_id = ? AND file_path = ?");

    this.selectSkippedFiles = db.prepare(
      "SELECT file_path, reason FROM skipped_files WHERE project_id = ? ORDER BY file_path",
    );
    this.upsertSkippedFile = db.prepare(
      `INSERT INTO skipped_files(project_id, file_path, reason) VALUES (?, ?, ?)
       ON CONFLICT(project_id, file_path) DO UPDATE SET reason = excluded.reason`,
    );
    this.deleteSkippedFile = db.prepare("DELETE FROM skipped_files WHERE project_id = ? AND file_path = ?");
  }
}
