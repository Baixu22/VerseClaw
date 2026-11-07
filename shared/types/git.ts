import type { PermissionApprovalEvent } from './workspace';
import type { GitPatchArtifactV1, RemoteForgeErrorV1 } from './remote-forge';

export type GitChangeBucket = 'staged' | 'unstaged' | 'untracked' | 'conflicted';
export type GitDiffMode = 'unstaged' | 'staged';

export type GitCommandCapability = {
  available: boolean;
  version?: string;
  error?: string;
};

export type GitCapabilities = {
  git: GitCommandCapability;
  gh: GitCommandCapability;
};

export type GitFileChange = {
  path: string;
  absolutePath: string;
  originalPath?: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
  bucket: GitChangeBucket;
  additions?: number | null;
  deletions?: number | null;
  binary?: boolean;
};

export type GitRepositoryStatus = {
  isRepository: boolean;
  workspaceRoot: string;
  repoRoot?: string;
  branch?: string;
  detached?: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
  clean: boolean;
  hasConflicts: boolean;
  changes: GitFileChange[];
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictedCount: number;
  error?: string;
};

export type GitDiffResult = {
  path?: string;
  mode: GitDiffMode;
  patch: string;
  patchArtifacts: GitPatchArtifactV1[];
  patchArtifactError?: RemoteForgeErrorV1;
  original?: string;
  modified?: string;
  tooLarge?: boolean;
  binary?: boolean;
};

export type GitBranch = {
  name: string;
  current: boolean;
  upstream?: string;
  commit?: string;
  updatedAt?: number;
};

export type GitCommitInfo = {
  hash: string;
  shortHash: string;
  subject: string;
  author?: string;
  /** Committer date in epoch milliseconds. */
  date?: number;
};

/** A reflog entry describes repository movement, not only committed changes. */
export type GitReflogEntry = {
  hash: string;
  shortHash: string;
  selector: string;
  subject: string;
  /** Reflog timestamp in epoch milliseconds. */
  date?: number;
};

export type GitWorktree = {
  path: string;
  branch?: string;
  head?: string;
  bare?: boolean;
  detached?: boolean;
  prunable?: boolean;
  locked?: boolean;
  reason?: string;
};

export type GitStashEntry = {
  index: number;
  selector: string;
  branch?: string;
  message: string;
};

export type GitOperationResult = {
  success: boolean;
  worktree?: GitWorktree;
  blocked?: boolean;
  approvalRequired?: boolean;
  approval?: PermissionApprovalEvent;
  reason?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  status?: GitRepositoryStatus;
};

export type GitCommitResult = GitOperationResult & {
  commit?: string;
};

export type GitApplyPatchMode = 'preflight' | 'apply' | 'revert';

export type GitApplyPatchPayload = {
  /** Unified diff text (git format). */
  patch: string;
  mode?: GitApplyPatchMode;
  approvalId?: string;
  /** Explicit review operation; ordinary Git apply retains its existing path. */
  reviewBinding?: { workspaceId: string; sessionKey: string; contextId: string; expectedHead: string; patchDigest: string };
};

export type GitApplyPatchResult = GitOperationResult & {
  writeJournalId?: string;
  recoveryRequired?: boolean;
  stale?: boolean;
  destinationHead?: string;
  /** Paths successfully written/reverted by `git apply`. */
  appliedPaths: string[];
  /** Paths git skipped (already applied, missing, etc.). */
  skippedPaths: string[];
  /** Paths with conflicts that were NOT written. */
  conflictedPaths: string[];
  /** True when run in preflight mode: no filesystem mutation occurred. */
  preflight: boolean;
};

/** How the comparison base was determined, so callers never guess. */
export type GitBaseResolution =
  /** Caller passed an explicit base ref and it resolved. */
  | 'explicit'
  /** Upstream tracking branch of the current HEAD. */
  | 'upstream'
  /** The remote declared this its default branch, via refs/remotes/<r>/HEAD. */
  | 'remote-default'
  /** Nearest remote-tracking ref that is an ancestor of HEAD. Weaker than
   * 'remote-default': no remote declared this branch, it was inferred as the
   * closest available ancestor. Kept distinct so callers can say which. */
  | 'remote-ancestor'
  /** No remote ancestor could be derived: comparison is unavailable. */
  | 'unavailable';

export type GitDiffToBasePayload = {
  /** Explicit base ref; when omitted the nearest remote ancestor is derived. */
  base?: string;
  /** Restrict the diff to these repo-relative paths. */
  paths?: string[];
  /** Include each file's patch text. Off by default: patches cost one `git
   * diff` per file, and callers that only render counts do not need them. */
  includePatches?: boolean;
};

/** One file's diff between the merge base and HEAD. Distinct from
 * GitDiffResult because both sides are commits, so the staged/unstaged
 * distinction does not apply. Side-by-side content is intentionally omitted:
 * callers that need it request that one file through git.fileDiff. */
export type GitBaseDiffFile = {
  path: string;
  /** Raw git status letter: A, M, D, R, C, T. */
  changeKind: string;
  /** Empty unless the request set includePatches. */
  patch: string;
  /** Line counts from `git diff --numstat`; null for binary files, which git
   * reports as `-` because line counts do not apply. */
  additions?: number | null;
  deletions?: number | null;
  /** True when the patch was clipped at the size limit. */
  tooLarge?: boolean;
  binary?: boolean;
};

export type GitDiffToBaseResult = {
  success: boolean;
  /** How `base` was chosen; 'unavailable' means no comparison was produced. */
  resolution: GitBaseResolution;
  /** The ref actually diffed against, absent when unavailable. */
  base?: string;
  /** Merge-base commit between base and HEAD, absent when unavailable. */
  mergeBase?: string;
  files: GitBaseDiffFile[];
  /** Aggregate over the reported files, so a header does not re-sum them.
   * Binary files contribute to `files` but not to the line counts. */
  totals?: { files: number; additions: number; deletions: number };
  /** True when the file list was capped. */
  truncated?: boolean;
  /** Why the comparison is unavailable; set only for 'unavailable'. */
  reason?: string;
  error?: string;
};


export type GithubAuthStatus = {
  available: boolean;
  authenticated: boolean;
  user?: string;
  hosts: string[];
  error?: string;
};

export type GithubRepository = {
  owner?: string;
  name?: string;
  url?: string;
  defaultBranch?: string;
};

export type GithubPrSummary = {
  number: number;
  title: string;
  state: string;
  author?: string;
  headRefName?: string;
  baseRefName?: string;
  url?: string;
  isDraft?: boolean;
  updatedAt?: string;
};

export type GithubPrCreateInput = {
  title: string;
  body: string;
  base?: string;
  head?: string;
  draft?: boolean;
  approvalId?: string;
};
