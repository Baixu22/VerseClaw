/**
 * Shared built-in session tool input/detail contracts.
 *
 * Keeps tool factories, renderers, and callers aligned on typed payload and metadata shapes.
 */
import type { Edit } from "./edit-diff.js";
import type { TruncationResult } from "./truncate.js";
import type { GitPatchArtifactV1, RemoteForgeErrorV1 } from "../../../../../shared/types/remote-forge.js";

/**
 * DCS working-memory producer envelope.
 *
 * Only production mutation tools (edit, write, apply_patch) may emit this
 * envelope in their `details.working_memory` field. The consumer side
 * (`readWorkingMemoryEnvelope` in extensions.ts) validates the shape and
 * enforces the ≤100 char limit on `result_summary`.
 */
export interface WorkingMemoryEnvelope {
  /** Human-readable summary of the mutation, ≤100 characters */
  result_summary: string;
  /** "high" for successful mutations, "medium" for partial/uncertain results */
  significance: "high" | "medium" | "low";
}

export interface BashToolInput {
  command: string;
  timeout?: number;
}

export interface BashToolDetails {
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

export interface EditToolInput {
  path: string;
  edits: Edit[];
}

export interface EditToolDetails {
  /** Display-oriented diff of the changes made */
  diff: string;
  /** Standard unified patch of the changes made */
  patch: string;
  /** Shared read-only patch projection; mutation ownership stays with the tool and journal. */
  patchArtifacts: GitPatchArtifactV1[];
  patchArtifactError?: RemoteForgeErrorV1;
  /** Line number of the first change in the new file (for editor navigation) */
  firstChangedLine?: number;
  /** DCS working-memory producer envelope (emitted only by mutation tools) */
  working_memory?: WorkingMemoryEnvelope;
}

export interface FindToolInput {
  pattern: string;
  path?: string;
  limit?: number;
}

export interface FindToolDetails {
  truncation?: TruncationResult;
  resultLimitReached?: number;
}

export interface GrepToolInput {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  context?: number;
  limit?: number;
}

export interface GrepToolDetails {
  truncation?: TruncationResult;
  matchLimitReached?: number;
  linesTruncated?: boolean;
}

export interface LsToolInput {
  path?: string;
  limit?: number;
}

export interface LsToolDetails {
  truncation?: TruncationResult;
  entryLimitReached?: number;
}

export interface ReadToolInput {
  path: string;
  offset?: number;
  limit?: number;
}

export interface ReadToolDetails {
  truncation?: TruncationResult;
}

export interface WriteToolInput {
  path: string;
  content: string;
}

export interface WriteToolDetails {
  /** Standard unified patch generated from the journal-owned before snapshot. */
  patch?: string;
  /** Shared read-only patch projection; mutation ownership stays with the tool and journal. */
  patchArtifacts?: GitPatchArtifactV1[];
  patchArtifactError?: RemoteForgeErrorV1;
  /** DCS working-memory producer envelope (emitted only by mutation tools) */
  working_memory?: WorkingMemoryEnvelope;
}
