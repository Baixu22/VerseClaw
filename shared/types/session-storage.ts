import type { GitWorktree, GitOperationResult } from './git';

export type StorageSize = { bytes: number; partial: boolean };
export type SessionStorageEntry = {
  workspaceId: string;
  workspaceName: string;
  sessionKey: string;
  label: string;
  disk: StorageSize;
  memoryBytes: number | null;
  terminals: number;
  browsers: number;
  servers: number;
};
export type StorageWorktree = GitWorktree & {
  repositoryWorkspaceId: string;
  repositoryName: string;
  workspaceIds: string[];
  disk: StorageSize;
  protection: 'primary' | 'active' | 'locked' | 'sessions' | 'resources' | 'dirty' | 'unavailable' | null;
};
export type SessionStorageSnapshot = {
  success: boolean;
  measuredAt: string;
  applicationMemoryBytes: number | null;
  sessions: SessionStorageEntry[];
  worktrees: StorageWorktree[];
};
export type SessionStorageScope = { workspaceId: string; sessionKey: string };
export type StorageReleaseResult = { success: boolean; released: number; failed: number };
export type StorageRemovePayload = { workspaceId: string; path: string; approvalId?: string };
export type SessionStorageContract = {
  snapshot: () => SessionStorageSnapshot;
  release: (payload: SessionStorageScope) => StorageReleaseResult;
  removeWorktree: (payload: StorageRemovePayload) => GitOperationResult;
};
