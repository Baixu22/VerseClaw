import type { DecodedTextFile } from "./sessions/tools/text-file-codec.js";
import type { FileVersion } from "../../../shared/coding-runtime/types.js";

export type AddFileHunk = {
  kind: "add";
  path: string;
  contents: string;
};

export type DeleteFileHunk = {
  kind: "delete";
  path: string;
};

export type UpdateFileChunk = {
  changeContext?: string;
  oldLines: string[];
  newLines: string[];
  isEndOfFile: boolean;
};

export type UpdateFileHunk = {
  kind: "update";
  path: string;
  movePath?: string;
  chunks: UpdateFileChunk[];
};

export type Hunk = AddFileHunk | DeleteFileHunk | UpdateFileHunk;

export type ApplyPatchSummary = {
  added: string[];
  modified: string[];
  deleted: string[];
};

export type ApplyPatchJournalOptions = {
  workspaceRoot: string;
  sessionId?: string;
  enabled?: boolean;
  requestId?: string;
  flags?: Record<string, boolean | string>;
};

export type ApplyPatchBatchOptions = {
  signal?: AbortSignal;
  journal?: ApplyPatchJournalOptions;
  /**
   * Internal optimistic-concurrency inputs for affected files. Never exposed
   * through the model-facing apply_patch TypeBox schema.
   */
  baseVersions?: FileVersion[];
};

export type PatchFileOps = {
  exists: (filePath: string) => Promise<boolean>;
  readFile: (filePath: string) => Promise<DecodedTextFile>;
  /** Optional stat used by optimistic baseVersions checks; absent => hash-only fallback. */
  stat?: (filePath: string) => Promise<{ size: number; mtimeMs: number } | null>;
  writeFile: (filePath: string, content: Buffer | string) => Promise<void>;
  remove: (filePath: string) => Promise<void>;
  mkdirp: (dir: string) => Promise<void>;
};
