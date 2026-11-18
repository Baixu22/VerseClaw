// Semantic rewrite of ragcode-context-engine's src/graph/sqlite-graph-store.ts (MIT),
// https://github.com/MarshallEriksen-Neura/ragcode — trimmed to the FactStore contract
// (SPEC §2/§4): the single source of truth for code facts with provenance/heat accounting
// and a hash-compare freshness gate. Producers write through upsertFileFacts; Views read.
// Uses this repo's node:sqlite conventions (infra/node-sqlite, sqlite-transaction, sqlite-wal).
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { requireNodeSqlite } from "../../infra/node-sqlite.js";
import { runSqliteImmediateTransactionWithRetrySync } from "../../infra/sqlite-transaction.js";
import {
  configureSqliteWalMaintenance,
  type SqliteWalMaintenance,
} from "../../infra/sqlite-wal.js";
import type {
  CodeChunk,
  CodeFile,
  EdgeKind,
  GraphEdge,
  ProjectIdentity,
  SymbolNode,
} from "../fact-types.js";
import { projectIdForRoot } from "../producers/hash.js";
import {
  checkFileFreshness,
  gateFreshness,
  type FreshnessGateOptions,
  type FreshnessReport,
} from "./freshness.js";
import { factStoreIgnoreReason, normalizeFactPath } from "./ignore.js";
import { FactStoreStatements, migrateFactStoreSchema } from "./statements.js";

/** Producer names allowed in files.producer (SPEC §4.1). */
export type FactProducer = "ripgrep" | "treesitter" | "ts-compiler" | "fallback" | "unknown";

export interface UpsertFileFactsInput {
  repoRoot: string;
  file: CodeFile;
  producer: FactProducer;
  symbols: SymbolNode[];
  edges: GraphEdge[];
  chunks: CodeChunk[];
  nowMs?: number;
}

export type UpsertFileFactsResult =
  | {
      stored: true;
      projectId: string;
      path: string;
      counts: { symbols: number; edges: number; chunks: number };
    }
  | { stored: false; projectId: string; path: string; reason: string };

export interface FileFactRecord {
  file: CodeFile;
  status: "fresh" | "stale";
  generation: number;
  indexedAtMs: number;
  provenance: { producer: FactProducer; producedHash: string };
  heat: { touchCount: number; lastTouchMs: number };
}

export interface SymbolProvenance {
  symbolId: string;
  symbolName: string;
  filePath: string;
  producer: FactProducer;
  producedHash: string;
  currentHash: string;
}

export const FACTSTORE_DIRNAME = ".openclaw";
export const FACTSTORE_FILENAME = "factstore.sqlite";

/** Default on-disk location: `<workspaceRoot>/.openclaw/factstore.sqlite` (SEAM_MAP §A). */
export function factStorePathFor(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), FACTSTORE_DIRNAME, FACTSTORE_FILENAME);
}

const storesByDbPath = new Map<string, FactStore>();

/**
 * Lazily opens (and caches) the per-workspace FactStore so Producers and Views share
 * one handle — one .sqlite, one freshness clock (SEAM_MAP §A lifecycle decision).
 */
export function openFactStore(workspaceRoot: string): FactStore {
  const dbPath = factStorePathFor(workspaceRoot);
  const existing = storesByDbPath.get(dbPath);
  if (existing) return existing;
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const store = new FactStore(dbPath);
  storesByDbPath.set(dbPath, store);
  return store;
}

/** Closes every cached store (test hygiene). */
export function closeAllFactStores(): void {
  for (const store of storesByDbPath.values()) {
    store.close();
  }
  storesByDbPath.clear();
}

export class FactStore {
  private readonly db: DatabaseSync;
  private readonly sql: FactStoreStatements;
  private readonly wal: SqliteWalMaintenance;
  private closed = false;

  constructor(readonly dbPath: string) {
    const { DatabaseSync } = requireNodeSqlite();
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.wal = configureSqliteWalMaintenance(this.db, {
      databaseLabel: "factstore",
      databasePath: dbPath,
    });
    migrateFactStoreSchema(this.db);
    this.sql = new FactStoreStatements(this.db);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.wal.close();
    this.db.close();
    storesByDbPath.delete(this.dbPath);
  }

  /**
   * Writes one file's facts transactionally: refreshes the project row, replaces the
   * file's previous rows, and records provenance (producer + produced_hash = the content
   * hash the analysis ran on) plus heat carried over from the previous row.
   * Ignored paths never enter files/symbols/edges/chunks; they land in skipped_files.
   */
  upsertFileFacts(input: UpsertFileFactsInput): UpsertFileFactsResult {
    this.assertOpen();
    const repoRoot = path.resolve(input.repoRoot);
    const relPath = normalizeFactPath(input.file.path);
    const projectId = input.file.projectId || projectIdForRoot(repoRoot);
    const nowMs = input.nowMs ?? Date.now();

    const ignoreReason = factStoreIgnoreReason(relPath);
    if (ignoreReason) {
      runSqliteImmediateTransactionWithRetrySync(this.db, () => {
        this.upsertProjectRow(projectId, repoRoot, nowMs);
        this.sql.upsertSkippedFile.run(projectId, relPath, ignoreReason);
      });
      return { stored: false, projectId, path: relPath, reason: ignoreReason };
    }

    const symbols = dedupeById(input.symbols);
    const chunks = dedupeById(input.chunks);
    const edges = input.edges;

    runSqliteImmediateTransactionWithRetrySync(this.db, () => {
      this.upsertProjectRow(projectId, repoRoot, nowMs);
      const generation = this.projectGeneration(projectId);
      const previous = this.fileRow(projectId, relPath);
      this.deleteFileRows(projectId, relPath);
      this.sql.deleteSkippedFile.run(projectId, relPath);
      this.sql.insertFile.run(
        projectId,
        relPath,
        input.file.absolutePath,
        input.file.language,
        input.file.sizeBytes,
        input.file.contentHash,
        input.file.modifiedAtMs,
        nowMs,
        "fresh",
        generation,
        input.producer,
        input.file.contentHash,
        Number(previous?.touch_count ?? 0),
        Number(previous?.last_touch_ms ?? 0),
      );
      for (const symbol of symbols) {
        this.sql.insertSymbol.run(
          projectId,
          symbol.id,
          relPath,
          symbol.name,
          symbol.kind,
          symbol.language,
          symbol.startLine,
          symbol.endLine,
          symbol.signature ?? null,
          symbol.exported ? 1 : 0,
          generation,
        );
      }
      for (const edge of edges) {
        this.sql.insertEdge.run(
          projectId,
          edge.sourceId,
          edge.targetId,
          edge.kind,
          JSON.stringify(edge.metadata ?? {}),
          relPath,
          generation,
        );
      }
      for (const chunk of chunks) {
        this.sql.insertChunk.run(
          projectId,
          chunk.id,
          repoRoot,
          relPath,
          chunk.language,
          chunk.kind,
          chunk.symbolName ?? null,
          chunk.startLine,
          chunk.endLine,
          chunk.content,
          chunk.contentHash,
          generation,
        );
        this.sql.insertFts.run(
          projectId,
          chunk.id,
          relPath,
          chunk.symbolName ?? null,
          chunk.content,
        );
      }
    });

    return {
      stored: true,
      projectId,
      path: relPath,
      counts: { symbols: symbols.length, edges: edges.length, chunks: chunks.length },
    };
  }

  getProjectByRoot(repoRoot: string): ProjectIdentity | undefined {
    this.assertOpen();
    const root = path.resolve(repoRoot);
    const row = this.sql.selectProjectByRoot.get(root, root) as Record<string, unknown> | undefined;
    return row ? projectFromRow(row) : undefined;
  }

  getFileRecord(repoRoot: string, relPath: string): FileFactRecord | undefined {
    this.assertOpen();
    const projectId = this.projectIdFor(repoRoot);
    if (!projectId) return undefined;
    const row = this.fileRow(projectId, normalizeFactPath(relPath));
    return row ? fileRecordFromRow(row) : undefined;
  }

  getSymbolsByFile(repoRoot: string, relPath: string): SymbolNode[] {
    this.assertOpen();
    const projectId = this.projectIdFor(repoRoot);
    if (!projectId) return [];
    return (
      this.sql.selectSymbolsByFile.all(projectId, normalizeFactPath(relPath)) as Array<
        Record<string, unknown>
      >
    ).map(symbolFromRow);
  }

  getEdgesByFile(repoRoot: string, relPath: string, limit?: number): GraphEdge[] {
    this.assertOpen();
    const projectId = this.projectIdFor(repoRoot);
    if (!projectId) return [];
    return (
      this.sql.selectEdgesByFile.all(projectId, normalizeFactPath(relPath), limit ?? -1) as Array<
        Record<string, unknown>
      >
    ).map(edgeFromRow);
  }

  getEdgesByKind(repoRoot: string, kind: EdgeKind, limit?: number): GraphEdge[] {
    this.assertOpen();
    const projectId = this.projectIdFor(repoRoot);
    if (!projectId) return [];
    return (
      this.sql.selectEdgesByKind.all(projectId, kind, limit ?? -1) as Array<Record<string, unknown>>
    ).map(edgeFromRow);
  }

  getChunksByFile(repoRoot: string, relPath: string): CodeChunk[] {
    this.assertOpen();
    const projectId = this.projectIdFor(repoRoot);
    if (!projectId) return [];
    return (
      this.sql.selectChunksByFile.all(projectId, normalizeFactPath(relPath)) as Array<
        Record<string, unknown>
      >
    ).map(chunkFromRow);
  }

  findSymbolByNameLike(repoRoot: string, name: string): SymbolNode[] {
    this.assertOpen();
    const projectId = this.projectIdFor(repoRoot);
    if (!projectId) return [];
    const needle = `%${escapeLike(name.toLowerCase())}%`;
    return (
      this.sql.selectSymbolByNameLike.all(projectId, needle) as Array<Record<string, unknown>>
    ).map(symbolFromRow);
  }

  /** Gate ③: "symbol X was produced by <producer> at hash H" — file-level provenance joined per symbol. */
  provenanceOfSymbol(repoRoot: string, symbolId: string): SymbolProvenance | undefined {
    this.assertOpen();
    const projectId = this.projectIdFor(repoRoot);
    if (!projectId) return undefined;
    const row = this.sql.selectSymbolProvenance.get(projectId, symbolId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return {
      symbolId: String(row.symbol_id),
      symbolName: String(row.symbol_name),
      filePath: String(row.file_path),
      producer: String(row.producer) as FactProducer,
      producedHash: String(row.produced_hash),
      currentHash: String(row.content_hash),
    };
  }

  /** Heat accounting: bump touch_count / last_touch_ms for LRU eviction (§3 guardrails). */
  recordTouch(repoRoot: string, relPaths: string[], nowMs = Date.now()): void {
    this.assertOpen();
    const projectId = this.projectIdFor(repoRoot);
    if (!projectId || relPaths.length === 0) return;
    runSqliteImmediateTransactionWithRetrySync(this.db, () => {
      for (const relPath of relPaths) {
        this.sql.touchFile.run(nowMs, projectId, normalizeFactPath(relPath));
      }
    });
  }

  /** Persists the observed current hash; status flips to stale when it diverges from produced_hash. */
  observeContentHash(repoRoot: string, relPath: string, currentHash: string): void {
    this.assertOpen();
    const projectId = this.projectIdFor(repoRoot);
    if (!projectId) return;
    runSqliteImmediateTransactionWithRetrySync(this.db, () => {
      this.sql.observeContentHash.run(
        currentHash,
        currentHash,
        projectId,
        normalizeFactPath(relPath),
      );
    });
  }

  /**
   * Hash-compare freshness gate (§4.3): stale ⇔ stored produced_hash differs from the
   * caller-observed current content hash. Missing files are reported, not fabricated.
   */
  freshness(
    repoRoot: string,
    currentHashesByPath: ReadonlyMap<string, string>,
    options: FreshnessGateOptions = {},
  ): FreshnessReport {
    this.assertOpen();
    const projectId = this.projectIdFor(repoRoot);
    const checks = [...currentHashesByPath.entries()].map(([relPath, currentHash]) => {
      const normalized = normalizeFactPath(relPath);
      const row = projectId ? this.fileRow(projectId, normalized) : undefined;
      const check = checkFileFreshness(
        row
          ? {
              path: normalized,
              producedHash: String(row.produced_hash ?? ""),
              producer: String(row.producer ?? "unknown"),
            }
          : undefined,
        currentHash,
      );
      return check.path ? check : { ...check, path: normalized };
    });
    return gateFreshness(checks, options);
  }

  getSkippedFiles(repoRoot: string): Array<{ filePath: string; reason: string }> {
    this.assertOpen();
    const projectId = this.projectIdFor(repoRoot);
    if (!projectId) return [];
    return (this.sql.selectSkippedFiles.all(projectId) as Array<Record<string, unknown>>).map(
      (row) => ({
        filePath: String(row.file_path),
        reason: String(row.reason),
      }),
    );
  }

  countSymbols(repoRoot?: string): number {
    this.assertOpen();
    if (repoRoot === undefined) {
      const row = this.db.prepare("SELECT COUNT(*) AS count FROM symbols").get() as Record<
        string,
        unknown
      >;
      return Number(row.count);
    }
    const projectId = this.projectIdFor(repoRoot);
    if (!projectId) return 0;
    const row = this.sql.countSymbols.get(projectId) as Record<string, unknown>;
    return Number(row.count);
  }

  searchChunks(
    repoRoot: string,
    terms: string[],
    limit = 20,
  ): Array<{ chunk: CodeChunk; rank: number }> {
    this.assertOpen();
    const projectId = this.projectIdFor(repoRoot);
    if (!projectId) return [];
    const ftsQuery = ftsQueryForTerms(terms);
    if (!ftsQuery) return [];
    return (
      this.sql.searchFts.all(projectId, ftsQuery, limit) as Array<Record<string, unknown>>
    ).map((row) => ({
      chunk: chunkFromRow(row),
      rank: Number(row.rank),
    }));
  }

  private assertOpen(): void {
    if (this.closed) throw new Error(`FactStore is closed: ${this.dbPath}`);
  }

  private upsertProjectRow(projectId: string, repoRoot: string, nowMs: number): void {
    this.sql.upsertProject.run(
      projectId,
      repoRoot,
      repoRoot,
      path.basename(repoRoot),
      nowMs,
      nowMs,
      1,
      nowMs,
    );
  }

  private projectGeneration(projectId: string): number {
    const row = this.db
      .prepare("SELECT index_generation FROM projects WHERE project_id = ?")
      .get(projectId) as Record<string, unknown> | undefined;
    return Number(row?.index_generation ?? 1);
  }

  private projectIdFor(repoRoot: string): string | undefined {
    return this.getProjectByRoot(repoRoot)?.projectId;
  }

  private fileRow(projectId: string, relPath: string): Record<string, unknown> | undefined {
    return this.sql.selectFile.get(projectId, relPath) as Record<string, unknown> | undefined;
  }

  private deleteFileRows(projectId: string, relPath: string): void {
    this.sql.deleteEdgesByFile.run(projectId, relPath);
    this.sql.deleteSymbolsByFile.run(projectId, relPath);
    this.sql.deleteFtsByFile.run(projectId, relPath);
    this.sql.deleteChunksByFile.run(projectId, relPath);
    this.sql.deleteFile.run(projectId, relPath);
  }
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

function projectFromRow(row: Record<string, unknown>): ProjectIdentity {
  const repoRoot = String(row.repo_root);
  const canonicalRoot =
    row.canonical_root === null || row.canonical_root === undefined
      ? repoRoot
      : String(row.canonical_root);
  const indexedAtMs = Number(row.indexed_at_ms);
  return {
    projectId: String(row.project_id),
    repoRoot,
    canonicalRoot,
    displayName:
      row.display_name === null || row.display_name === undefined
        ? path.basename(canonicalRoot)
        : String(row.display_name),
    createdAtMs:
      row.created_at_ms === null || row.created_at_ms === undefined
        ? indexedAtMs
        : Number(row.created_at_ms),
    lastIndexedAtMs:
      row.last_indexed_at_ms === null || row.last_indexed_at_ms === undefined
        ? indexedAtMs
        : Number(row.last_indexed_at_ms),
  };
}

function fileRecordFromRow(row: Record<string, unknown>): FileFactRecord {
  return {
    file: {
      projectId: String(row.project_id),
      path: String(row.path),
      absolutePath: String(row.absolute_path),
      language: String(row.language) as CodeFile["language"],
      sizeBytes: Number(row.size_bytes),
      contentHash: String(row.content_hash),
      modifiedAtMs: Number(row.modified_at_ms),
    },
    status: String(row.status) === "stale" ? "stale" : "fresh",
    generation: Number(row.generation),
    indexedAtMs: Number(row.indexed_at_ms),
    provenance: {
      producer: String(row.producer) as FactProducer,
      producedHash: String(row.produced_hash),
    },
    heat: {
      touchCount: Number(row.touch_count),
      lastTouchMs: Number(row.last_touch_ms),
    },
  };
}

function symbolFromRow(row: Record<string, unknown>): SymbolNode {
  return {
    projectId: String(row.project_id),
    id: String(row.id),
    filePath: String(row.file_path),
    name: String(row.name),
    kind: String(row.kind) as SymbolNode["kind"],
    language: String(row.language) as SymbolNode["language"],
    startLine: Number(row.start_line),
    endLine: Number(row.end_line),
    signature:
      row.signature === null || row.signature === undefined ? undefined : String(row.signature),
    exported: Boolean(row.exported),
  };
}

function edgeFromRow(row: Record<string, unknown>): GraphEdge {
  return {
    projectId: String(row.project_id),
    sourceId: String(row.source_id),
    targetId: String(row.target_id),
    kind: String(row.kind) as EdgeKind,
    metadata: parseMetadata(row.metadata_json),
  };
}

function chunkFromRow(row: Record<string, unknown>): CodeChunk {
  return {
    projectId: String(row.project_id),
    id: String(row.id),
    repoRoot: String(row.repo_root),
    filePath: String(row.file_path),
    language: String(row.language) as CodeChunk["language"],
    kind: String(row.kind) as CodeChunk["kind"],
    symbolName:
      row.symbol_name === null || row.symbol_name === undefined
        ? undefined
        : String(row.symbol_name),
    startLine: Number(row.start_line),
    endLine: Number(row.end_line),
    content: String(row.content),
    contentHash: String(row.content_hash),
  };
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      return Object.keys(record).length > 0 ? record : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function ftsQueryForTerms(terms: string[]): string {
  return [...new Set(terms)]
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" OR ");
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
