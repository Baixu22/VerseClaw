/**
 * C2-8: write-journal snapshots + undo_write tool.
 * Fail-open: journal failures never block the write path.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { Type } from "typebox";
import { getToolParamsRecord } from "../agent-tools.params.js";
import { acquirePatchBatchLocks } from "../apply-patch-batch-lock.js";
import type { AnyAgentTool } from "../agent-tools.types.js";
import { toRelativeWorkspacePath } from "../path-policy.js";
import { FsSafeError, root as fsRoot } from "../../infra/fs-safe.js";
import { generateUnifiedPatch } from "../sessions/tools/edit-diff.js";
import { jsonResult } from "./common.js";
import {
  isGitPatchArtifactV1,
  type GitPatchArtifactV1,
} from "../../../../shared/types/remote-forge.js";
import {
  adaptUnifiedDiffToGitPatchArtifacts,
  GIT_PATCH_ADAPTER_LIMITS,
} from "../../../../shared/remote-forge/unified-diff-adapter.js";
import { createRemoteForgeErrorV1 } from "../../../../shared/remote-forge/error-envelope.js";
import type {
  RemoteForgeErrorCode,
  RemoteForgeErrorV1,
} from "../../../../shared/types/remote-forge.js";

import { journalEntryId, journalDirFor, snapshotBeforeWrite, snapshotPreparedWrite, undoLastWrites as undoJournalWrites, type WriteJournalEntry } from "./write-journal-core.js";
export * from "./write-journal-core.js";

/** Preserve the original workspace path policy at the existing tool entrypoint. */
export function undoLastWrites(params: Parameters<typeof undoJournalWrites>[0]) {
  return undoJournalWrites(params, toRelativeWorkspacePath);
}

export const UNDO_WRITE_TOOL_NAME = "undo_write";

function bindPatchArtifactLineage(params: {
  details: Record<string, unknown>;
  snapshots: WriteJournalEntry[];
  requestId: string;
}): { patchArtifacts?: GitPatchArtifactV1[]; patchArtifactError?: RemoteForgeErrorV1 } {
  if (!Array.isArray(params.details.patchArtifacts)) return {};
  if (!params.details.patchArtifacts.every(isGitPatchArtifactV1)) {
    return {
      patchArtifacts: [],
      patchArtifactError: createRemoteForgeErrorV1({
        code: "incomplete_response",
        requestId: params.requestId,
      }),
    };
  }

  const patchArtifacts = params.details.patchArtifacts.map((artifact) => {
    if (artifact.lineage?.requestId && artifact.lineage.requestId !== params.requestId) {
      return null;
    }
    const snapshot = params.snapshots.find((entry) => entry.relPath === artifact.file);
    if (!snapshot) return null;
    const next: GitPatchArtifactV1 = {
      ...artifact,
      lineage: {
        ...artifact.lineage,
        requestId: params.requestId,
        journalEntryId: journalEntryId(snapshot.lineage?.sessionId ?? "default", snapshot.seq),
      },
    };
    return isGitPatchArtifactV1(next) ? next : null;
  });
  if (patchArtifacts.some((artifact) => artifact === null)) {
    return {
      patchArtifacts: [],
      patchArtifactError: createRemoteForgeErrorV1({
        code: "incomplete_response",
        requestId: params.requestId,
      }),
    };
  }
  return { patchArtifacts: patchArtifacts as GitPatchArtifactV1[] };
}

type FullFileWriteProjection = {
  patch?: string;
  patchArtifacts: GitPatchArtifactV1[];
  patchArtifactError?: RemoteForgeErrorV1;
};

function unavailableFullFileWrite(
  code: RemoteForgeErrorCode,
  requestId: string | undefined,
): FullFileWriteProjection {
  return {
    patchArtifacts: [],
    patchArtifactError: createRemoteForgeErrorV1({ code, requestId }),
  };
}

function decodeUtf8Strict(value: Buffer): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    return undefined;
  }
}

function projectFullFileWrite(params: {
  args: unknown;
  requestId?: string;
  snapshots: WriteJournalEntry[];
}): FullFileWriteProjection {
  if (!params.requestId) {
    return unavailableFullFileWrite("incomplete_response", params.requestId);
  }
  if (params.snapshots.length !== 1) {
    return unavailableFullFileWrite("incomplete_response", params.requestId);
  }
  const snapshot = params.snapshots[0]!;
  const record = getToolParamsRecord(params.args);
  const expectedContent = typeof record?.content === "string" ? record.content : undefined;
  if (expectedContent === undefined) {
    return unavailableFullFileWrite("invalid_request", params.requestId);
  }

  try {
    if (!existsSync(snapshot.absPath) || !statSync(snapshot.absPath).isFile()) {
      return unavailableFullFileWrite("incomplete_response", params.requestId);
    }
    const beforeBytes = readFileSync(snapshot.snapshotPath);
    const afterBytes = readFileSync(snapshot.absPath);
    const expectedBytes = Buffer.from(expectedContent, "utf8");
    if (!afterBytes.equals(expectedBytes)) {
      return unavailableFullFileWrite("incomplete_response", params.requestId);
    }
    if (beforeBytes.byteLength + afterBytes.byteLength > GIT_PATCH_ADAPTER_LIMITS.maxInputBytes) {
      return unavailableFullFileWrite("truncated_response", params.requestId);
    }
    const beforeContent = decodeUtf8Strict(beforeBytes);
    if (beforeContent === undefined) {
      return unavailableFullFileWrite("incomplete_response", params.requestId);
    }
    if (snapshot.hadPrior && beforeBytes.equals(afterBytes)) {
      return unavailableFullFileWrite("conflict", params.requestId);
    }

    const patch = generateUnifiedPatch(
      snapshot.relPath,
      snapshot.hadPrior ? beforeContent : "",
      expectedContent,
      4,
      snapshot.hadPrior ? "modified" : "added",
    );
    const projection = adaptUnifiedDiffToGitPatchArtifacts({
      patch,
      sourceCompleteness: "complete",
      lineage: { requestId: params.requestId },
    });
    if (projection.kind === "unavailable") {
      return unavailableFullFileWrite("incomplete_response", params.requestId);
    }
    if (projection.artifacts.some((artifact) => artifact.completeness !== "complete")) {
      return unavailableFullFileWrite("incomplete_response", params.requestId);
    }
    return { patch, patchArtifacts: projection.artifacts };
  } catch {
    return unavailableFullFileWrite("incomplete_response", params.requestId);
  }
}

/** Best-effort path list from apply_patch input (for pre-write snapshots). */
export function extractPatchTargetPaths(input: string): string[] {
  const paths: string[] = [];
  const re = /^\*\*\*\s+(?:Add|Update|Delete|Move)\s+File:\s+(.+?)\s*$/gim;
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
    workspaceOnly?: boolean;
    sessionId?: string;
    enabled?: boolean;
    /** FP-P1-04: coding flags in force, recorded into each entry's lineage. */
    flags?: Record<string, boolean | string>;
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
      const lockTargets =
        tool.name === "apply_patch"
          ? []
          : paths.map((filePath) =>
              path.isAbsolute(filePath)
                ? path.resolve(filePath)
                : path.resolve(options.workspaceRoot, filePath),
            );
      const release = await acquirePatchBatchLocks(lockTargets);
      try {
        const snapshots: WriteJournalEntry[] = [];
        const confinedRoot = options.workspaceOnly && paths.length > 0
          ? await fsRoot(options.workspaceRoot)
          : undefined;
        for (const filePath of paths) {
          const metadata = {
            workspaceRoot: options.workspaceRoot,
            sessionId: options.sessionId,
            filePath,
            toolName: tool.name,
            ...(toolCallId ? { requestId: toolCallId } : {}),
            ...(options.flags ? { flags: options.flags } : {}),
          };
          // Read through the existing rooted file handle after acquiring the
          // lease: a path swapped while waiting must not leak into a snapshot.
          let entry: WriteJournalEntry | null;
          if (confinedRoot) {
            const relative = toRelativeWorkspacePath(options.workspaceRoot, filePath);
            let prior: Buffer | undefined;
            try {
              prior = (await confinedRoot.read(relative)).buffer;
            } catch (error) {
              if (!(error instanceof FsSafeError && error.code === "not-found")) throw error;
            }
            entry = snapshotPreparedWrite({ ...metadata, hadPrior: prior !== undefined, ...(prior !== undefined ? { priorContent: prior } : {}) });
          } else {
            entry = snapshotBeforeWrite(metadata);
          }
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
        const detailsForLineage =
          tool.name === "write"
            ? (() => {
                const {
                  patch: _untrustedPatch,
                  patchArtifacts: _untrustedArtifacts,
                  patchArtifactError: _untrustedError,
                  ...otherDetails
                } = prevDetails;
                return {
                  ...otherDetails,
                  ...projectFullFileWrite({ args, requestId: toolCallId, snapshots }),
                };
              })()
            : prevDetails;
        const patchLineage = toolCallId
          ? bindPatchArtifactLineage({ details: detailsForLineage, snapshots, requestId: toolCallId })
          : {};
        return {
          ...result,
          details: {
            ...detailsForLineage,
            ...patchLineage,
            write_journal: {
              undoable: true,
              snapshots: snapshots.map((s) => ({
                seq: s.seq,
                journalEntryId: journalEntryId(s.lineage?.sessionId ?? "default", s.seq),
                path: s.relPath,
                hadPrior: s.hadPrior,
              })),
            },
          },
        };
      } finally {
        release();
      }
    },
  };
}

export function createUndoWriteTool(options: {
  workspaceRoot: string;
  sessionId?: string;
  enabled?: boolean;
  workspaceOnly?: boolean;
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
        workspaceOnly: options.workspaceOnly,
      });
      // FP-P1-04: partial restore is a FAILURE; the journal dir is reported so
      // a human can recover from the preserved snapshots.
      return jsonResult({
        ok: outcome.errors.length === 0,
        restored: outcome.restored,
        errors: outcome.errors,
        journalDir: outcome.journalDir,
        remainingEntries: outcome.remainingEntries,
        ...(outcome.errors.length > 0
          ? {
              recovery:
                "Undo stopped at the first failure. Nothing was discarded: snapshots and metadata remain in journalDir for manual restore.",
            }
          : {}),
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
