import type { DecodedTextFile } from "./sessions/tools/text-file-codec.js";

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
   * Opaque id from a prior read-only `preview_patch`. When present, the write
   * journal recomputes the preview's change-summary digest immediately before the
   * first mutation and refuses the commit on any drift. Absent means "no preview
   * was taken" and the patch applies exactly as it always has.
   */
  previewId?: string;
};

export type PatchFileOps = {
  exists: (filePath: string) => Promise<boolean>;
  readFile: (filePath: string) => Promise<DecodedTextFile>;
  writeFile: (filePath: string, content: Buffer | string) => Promise<void>;
  remove: (filePath: string) => Promise<void>;
  mkdirp: (dir: string) => Promise<void>;
};
