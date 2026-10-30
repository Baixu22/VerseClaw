// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import type { RawMessage } from '@shared/chat/types';
import type {
  ChangeContextComparisonMode,
  ChangeContextComparisonRequest,
  ChangeContextDiffProjection,
  ChangeContextRevisionRef,
} from '@shared/types/change-context';
import { CHANGE_CONTEXT_COMPARISON_MODES } from '@shared/types/change-context';
import { createChangeContextApi } from '@electron/services/change-context-api';
import {
  createDefaultChangeContextSourceReader,
  readRuntimeTurnFacts,
  type ChangeContextComparisonFacts,
  type ChangeContextSourceReader,
} from '@electron/services/change-context-projection';
import { createChangeContextReviewCommentStore, createInMemoryChangeContextReviewCommentBackend } from '@electron/services/change-context-review-store';

const baseCommit: ChangeContextRevisionRef = {
  kind: 'git-commit',
  commit: 'base-commit',
  treeDigest: null,
};

const candidateCommit: ChangeContextRevisionRef = {
  kind: 'git-commit',
  commit: 'candidate-commit',
  treeDigest: null,
};

function requestFor(mode: ChangeContextComparisonMode): ChangeContextComparisonRequest {
  switch (mode) {
    case 'merge-base':
      return { mode, baseRef: 'origin/main' };
    case 'last-commit':
      return { mode, commit: 'candidate-commit' };
    case 'last-turn':
      return { mode };
    case 'checkpoint':
      return { mode, checkpointId: 'checkpoint-1' };
  }
}

function factsFor(mode: ChangeContextComparisonMode): ChangeContextComparisonFacts {
  const diff: ChangeContextDiffProjection = {
    state: 'available',
    files: [{
      path: 'src/example.ts',
      changeKind: 'modified',
      additions: 2,
      deletions: 1,
      patchDigest: 'sha256:example',
      contentState: 'available',
    }],
    patchArtifacts: [],
    stats: { files: 1, additions: 2, deletions: 1, patchBytes: 42 },
    truncated: false,
    issues: [],
  };
  return {
    comparison: {
      mode,
      state: 'available',
      base: baseCommit,
      candidate: candidateCommit,
      resolvedAt: '2026-10-30T00:00:00.000Z',
      issues: [],
    },
    diff,
    ...(mode === 'last-turn'
      ? {
          identity: {
            runId: 'run-1',
            turn: {
              sessionKey: 'agent:main:main',
              runId: 'run-1',
              attemptIndex: 0,
              modelCallIndex: 1,
            },
          },
        }
      : {}),
  };
}

function createReader(): ChangeContextSourceReader {
  return {
    read: vi.fn(async ({ comparison }) => factsFor(comparison.mode)),
  };
}

function createApi(reader: ChangeContextSourceReader) {
  return createChangeContextApi({
    sourceReader: reader,
    store: createChangeContextReviewCommentStore({
      backend: createInMemoryChangeContextReviewCommentBackend(),
    }),
    createRequestId: () => 'request-1',
    now: () => '2026-10-30T00:00:00.000Z',
  });
}

function reviewFactsBundle() {
  return {
    patchArtifacts: [],
    stats: { files: 1, additions: 2, deletions: 1, patchBytes: 42, truncated: false },
  };
}
describe('Change Context projection', () => {
  it.each(CHANGE_CONTEXT_COMPARISON_MODES)('selects deterministic %s comparison facts', async (mode) => {
    const reader = createReader();
    const api = createApi(reader);
    const result = await api.getProjection({
      workspaceId: 'workspace-1',
      sessionKey: 'agent:main:main',
      comparison: requestFor(mode),
    });

    expect(result.success).toBe(true);
    expect(result.projection?.comparison?.mode).toBe(mode);
    expect(result.projection?.comparison?.state).toBe('available');
    expect(result.projection?.diff?.stats).toEqual({
      files: 1,
      additions: 2,
      deletions: 1,
      patchBytes: 42,
    });
    expect(result.projection?.contextId).toMatch(/^change-context:[a-f0-9]{24}$/);
    expect(reader.read).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      sessionKey: 'agent:main:main',
      comparison: requestFor(mode),
    }));
  });

  it('keeps unavailable sources explicit instead of returning an empty successful diff', async () => {
    const reader: ChangeContextSourceReader = {
      read: async ({ comparison }) => ({
        comparison: {
          mode: comparison.mode,
          state: 'unavailable',
          base: null,
          candidate: null,
          resolvedAt: '2026-10-30T00:00:00.000Z',
          issues: [{ code: 'source_unavailable', message: 'source missing', source: 'git' }],
        },
        diff: {
          state: 'unavailable',
          files: [],
          patchArtifacts: [],
          stats: null,
          truncated: false,
          issues: [{ code: 'source_unavailable', message: 'source missing', source: 'git' }],
        },
      }),
    };
    const api = createApi(reader);
    const result = await api.getProjection({
      sessionKey: 'agent:main:main',
      comparison: { mode: 'merge-base', baseRef: 'origin/main' },
    });

    expect(result.success).toBe(false);
    expect(result.projection?.diff?.state).toBe('unavailable');
    expect(result.projection?.diff?.stats).toBeNull();
    expect(result.error?.code).toBe('unavailable');
  });

  it('derives last-turn identity and transcript bounds from runtime messages', () => {
    const messages: RawMessage[] = [
      {
        role: 'user',
        content: 'change it',
        timestamp: 1_000,
        id: 'm1',
        __openclaw: { seq: 11 },
      } as RawMessage,
      {
        role: 'assistant',
        content: 'working',
        timestamp: 2_000,
        id: 'm2',
        __openclaw: { seq: 12 },
        details: { runId: 'run-1', turnId: 'turn-1', attemptIndex: 0, modelCallIndex: 1 },
      } as RawMessage,
    ];

    const facts = readRuntimeTurnFacts('agent:main:main', messages);

    expect(facts).toMatchObject({
      runId: 'run-1',
      runtimeTurnId: 'turn-1',
      transcriptSeq: { start: 11, end: 12 },
      turn: {
        sessionKey: 'agent:main:main',
        runId: 'run-1',
        attemptIndex: 0,
        modelCallIndex: 1,
      },
    });
    expect(facts?.transcriptDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
  it('maps all four modes through the default reader without inventing facts', async () => {
    const collectReviewDiff = vi.fn(async (target: { kind: string; baseBranch?: string; commit?: string }) => ({
      ...reviewFactsBundle(),
      target: target.kind === 'baseBranch'
        ? { kind: 'baseBranch', baseBranch: target.baseBranch, label: target.baseBranch, baseCommit: 'base-1', headCommit: 'head-1' }
        : { kind: 'commit', commit: target.commit, label: target.commit, resolvedCommit: 'head-1', baseCommit: 'base-1' },
    })) as unknown as typeof import('@electron/services/code-review-api').collectCodeReviewDiffForTarget;
    const collectWorktreeDiffAgainstCommit = vi.fn(async () => ({
      ...reviewFactsBundle(),
      target: { kind: 'commit', commit: 'base-1', label: 'worktree', resolvedCommit: 'base-1', baseCommit: 'base-1', headCommit: 'head-1' },
    })) as unknown as typeof import('@electron/services/code-review-api').collectCodeReviewWorktreeDiffAgainstCommit;
    const resolveCommitAtOrBefore = vi.fn(async () => 'base-1') as unknown as typeof import('@electron/services/git-api').resolveGitCommitAtOrBefore;
    const readRuntimeTurn = vi.fn(async () => ({
      runId: 'run-1',
      turn: { sessionKey: 'agent:main:main', runId: 'run-1', attemptIndex: 0, modelCallIndex: 1 },
      runtimeTurnId: 'turn-1',
      transcriptSeq: { start: 11, end: 12 },
      transcriptDigest: 'sha256:turn',
      startedAt: '2026-10-30T00:00:00.000Z',
    }));
    const checkpointDiff = vi.fn(async () => ({
      success: true,
      key: 'agent:main:main',
      checkpointId: 'checkpoint-1',
      files: [{
        filePath: 'src/example.ts',
        status: 'modified' as const,
        unifiedDiff: 'diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new\n',
      }],
      errors: [],
    }));
    const reader = createDefaultChangeContextSourceReader({
      collectReviewDiff,
      collectWorktreeDiffAgainstCommit,
      resolveCommitAtOrBefore,
      readRuntimeTurn,
      checkpointDiff: checkpointDiff as never,
    });

    for (const mode of CHANGE_CONTEXT_COMPARISON_MODES) {
      const facts = await reader.read({
        workspaceId: 'workspace-1',
        sessionKey: 'agent:main:main',
        comparison: requestFor(mode),
        resolvedAt: '2026-10-30T00:00:00.000Z',
        requestId: `request-${mode}`,
      });
      expect(facts.comparison.mode).toBe(mode);
      expect(facts.comparison.state).toBe('available');
    }
    expect(collectReviewDiff).toHaveBeenCalledTimes(2);
    expect(collectWorktreeDiffAgainstCommit).toHaveBeenCalledWith('base-1', 'request-last-turn');
    expect(readRuntimeTurn).toHaveBeenCalledWith('agent:main:main');
    expect(checkpointDiff).toHaveBeenCalledWith({
      sessionKey: 'agent:main:main',
      checkpointId: 'checkpoint-1',
    });
  });
});
