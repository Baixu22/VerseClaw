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
