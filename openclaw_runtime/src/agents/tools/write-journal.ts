/**
 * C2-8: write-journal snapshots + undo_write tool.
 * Fail-open: journal failures never block the write path.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { Type } from "typebox";
import { codingObservability } from "../../context-engine/coding-observability.js";
import { getToolParamsRecord } from "../agent-tools.params.js";
import type { AnyAgentTool } from "../agent-tools.types.js";
import { jsonResult } from "./common.js";
import { toFactRelPath } from "../fact-rel-path.js";

export const UNDO_WRITE_TOOL_NAME = "undo_write";

export type WriteJournalEntry = {
  seq: number;
  relPath: string;
  absPath: string;
  snapshotPath: string;
  /** true when a pre-image existed and was snapshotted */
  hadPrior: boolean;
  toolName: string;
  createdAtMs: number;
};

export type WriteJournal = {
  sessionId: string;
  rootDir: string;
  entries: WriteJournalEntry[];
  nextSeq: number;
};

const journals = new Map<string, WriteJournal>();

export function journalDirFor(workspaceRoot: string, sessionId: string): string {
  return path.join(workspaceRoot, ".openclaw", "journal", sessionId);
}

export function getOrCreateWriteJournal(
  workspaceRoot: string,
  sessionId: string,
): WriteJournal {
  const sid = sessionId.trim() || "default";
  const key = `${path.resolve(workspaceRoot)}::${sid}`;
  let journal = journals.get(key);
  if (!journal) {
    const rootDir = journalDirFor(workspaceRoot, sid);
    journal = { sessionId: sid, rootDir, entries: [], nextSeq: 1 };
    journals.set(key, journal);
  }
  return journal;
}

export function __resetWriteJournals(): void {
  journals.clear();
}

/**
 * Snapshot target file before mutation. Returns entry or null if fail-open.
 */
export function snapshotBeforeWrite(params: {
  workspaceRoot: string;
  sessionId?: string;
  filePath: string;
  toolName: string;
}): WriteJournalEntry | null {
  const sessionId = params.sessionId?.trim() || "default";
  const started = performance.now();
  try {
    const journal = getOrCreateWriteJournal(params.workspaceRoot, sessionId);
    const absPath = path.isAbsolute(params.filePath)
      ? path.resolve(params.filePath)
      : path.resolve(params.workspaceRoot, params.filePath);
    const rel =
      toFactRelPath(params.filePath, params.workspaceRoot) ??
      path.relative(params.workspaceRoot, absPath).replace(/\\/g, "/");
    mkdirSync(journal.rootDir, { recursive: true });
    const seq = journal.nextSeq++;
    const base = path.basename(rel || "file");
    const hashHint = String(seq).padStart(4, "0");
    const snapshotPath = path.join(journal.rootDir, `${hashHint}-${base}.pre`);
    let hadPrior = false;
    if (existsSync(absPath) && statSync(absPath).isFile()) {
      copyFileSync(absPath, snapshotPath);
      hadPrior = true;
    } else {
      // Marker for create: empty snapshot file with sidecar meta.
      writeFileSync(snapshotPath, "", "utf8");
    }
    const entry: WriteJournalEntry = {
      seq,
      relPath: rel,
      absPath,
      snapshotPath,
      hadPrior,
      toolName: params.toolName,
      createdAtMs: Date.now(),
    };
    // meta sidecar
    writeFileSync(
      `${snapshotPath}.meta.json`,
      JSON.stringify({
        seq,
        relPath: rel,
        absPath,
        hadPrior,
        toolName: params.toolName,
        createdAtMs: entry.createdAtMs,
      }),
      "utf8",
    );
    journal.entries.push(entry);
    codingObservability.recordJournalLatency(performance.now() - started, true);
    return entry;
  } catch {
    codingObservability.recordJournalLatency(performance.now() - started, false);
    return null;
  }
}

export function undoLastWrites(params: {
  workspaceRoot: string;
  sessionId?: string;
  steps?: number;
}): { restored: string[]; errors: string[] } {
  const sessionId = params.sessionId?.trim() || "default";
  const journal = getOrCreateWriteJournal(params.workspaceRoot, sessionId);
  const steps = Math.max(1, Math.floor(params.steps ?? 1));
  const restored: string[] = [];
  const errors: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    const entry = journal.entries.pop();
    if (!entry) {
      break;
    }
    try {
      if (entry.hadPrior && existsSync(entry.snapshotPath)) {
        mkdirSync(path.dirname(entry.absPath), { recursive: true });
        copyFileSync(entry.snapshotPath, entry.absPath);
      } else {
        // Was a create: remove the file if present.
        if (existsSync(entry.absPath)) {
          unlinkSync(entry.absPath);
        }
      }
      restored.push(entry.relPath);
      codingObservability.recordUndo();
    } catch (error) {
      errors.push(
        `${entry.relPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { restored, errors };
}

export function clearWriteJournal(params: {
  workspaceRoot: string;
  sessionId?: string;
}): void {
  const sessionId = params.sessionId?.trim() || "default";
  const key = `${path.resolve(params.workspaceRoot)}::${sessionId}`;
  const journal = journals.get(key);
  if (journal) {
    try {
      rmSync(journal.rootDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    journals.delete(key);
  }
}

/** Best-effort path list from apply_patch input (for pre-write snapshots). */
export function extractPatchTargetPaths(input: string): string[] {
  const paths: string[] = [];
  const re =
    /^\*\*\*\s+(?:Add|Update|Delete|Move)\s+File:\s+(.+?)\s*$/gim;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    const p = match[1]?.trim();
    if (p) {
      paths.push(p);
    }
  }
  // Move File may have "Move to:" lines
  const moveTo = /^\*\*\*\s+Move\s+to:\s+(.+?)\s*$/gim;
  while ((match = moveTo.exec(input)) !== null) {
    const p = match[1]?.trim();
    if (p) {
      paths.push(p);
    }
  }
  return [...new Set(paths)];
}

export function wrapToolWithWriteJournal(
  tool: AnyAgentTool,
  options: {
    workspaceRoot: string;
    sessionId?: string;
    enabled?: boolean;
  },
): AnyAgentTool {
  if (options.enabled === false) {
    return tool;
  }
  return {
    ...tool,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const record = getToolParamsRecord(args);
      const paths: string[] = [];
      if (tool.name === "apply_patch") {
        const input = typeof record?.input === "string" ? record.input : "";
        paths.push(...extractPatchTargetPaths(input));
      } else if (typeof record?.path === "string" && record.path.trim()) {
        paths.push(record.path);
      }
      const snapshots: WriteJournalEntry[] = [];
      for (const filePath of paths) {
        const entry = snapshotBeforeWrite({
          workspaceRoot: options.workspaceRoot,
          sessionId: options.sessionId,
          filePath,
          toolName: tool.name,
        });
        if (entry) {
          snapshots.push(entry);
        }
      }
      const result = await tool.execute(toolCallId, args, signal, onUpdate);
      if (snapshots.length === 0) {
        return result;
      }
      const prevDetails =
        result.details && typeof result.details === "object" && !Array.isArray(result.details)
          ? (result.details as Record<string, unknown>)
          : {};
      return {
        ...result,
        details: {
          ...prevDetails,
          write_journal: {
            undoable: true,
            snapshots: snapshots.map((s) => ({
              seq: s.seq,
              path: s.relPath,
              hadPrior: s.hadPrior,
            })),
          },
        },
      };
    },
  };
}

export function createUndoWriteTool(options: {
  workspaceRoot: string;
  sessionId?: string;
  enabled?: boolean;
}): AnyAgentTool | null {
  if (options.enabled === false || !options.workspaceRoot) {
    return null;
  }
  return {
    name: UNDO_WRITE_TOOL_NAME,
    label: "Undo Write",
    description:
      "Roll back the last N write/edit/apply_patch mutations using the write journal for this session.",
    // Reversible restore of prior file content.
    risk: "write",
    parameters: Type.Object({
      steps: Type.Optional(
        Type.Number({ description: "Number of journal steps to undo (default 1)." }),
      ),
    }),
    execute: async (_id, args) => {
      const record = getToolParamsRecord(args) ?? {};
      const steps = typeof record.steps === "number" ? record.steps : 1;
      const outcome = undoLastWrites({
        workspaceRoot: options.workspaceRoot,
        sessionId: options.sessionId,
        steps,
      });
      return jsonResult({
        ok: outcome.errors.length === 0,
        restored: outcome.restored,
        errors: outcome.errors,
      });
    },
  } as AnyAgentTool;
}

/** Test helper: list journal snapshot files on disk. */
export function listJournalSnapshotFiles(workspaceRoot: string, sessionId: string): string[] {
  const dir = journalDirFor(workspaceRoot, sessionId);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).filter((name) => name.endsWith(".pre"));
}
